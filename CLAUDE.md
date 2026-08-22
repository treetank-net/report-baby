# report-baby

Claude Code plugin: an MCP server for rendering polished graphics, A4 reports,
and presentations — data → PNG / PDF / PPTX. It is part of the `*-baby` plugin
family, alongside `google-ads-baby`, `meta-ads-baby`, and
`google-analytics-baby`. It is the simplest member: local rendering compute,
with no network.

## Architecture

The plugin is an MCP server over stdio. **Zero OAuth, zero safety/hooks, zero
external mutations, zero account APIs, and zero runtime network access.** It
takes data (label/value, KPIs, table rows) and returns a path to the rendered
file.

### Rendering engine — fully bundleable, zero runtime dependencies

- **SVG → PNG: `@resvg/resvg-wasm`** — pure-WASM SVG rasterizer. No browser or
  binary.
- **PDF: `jspdf` + `jspdf-autotable`** — programmatically built A4 document
  (text, rectangles, images, tables).
- **Font: embedded DejaVu Sans (regular + bold)** as binary data in the bundle.
  This is required: without it resvg omits all SVG text and jsPDF cannot render
  Polish characters. Files: `server/src/assets/font.ttf` and
  `font-bold.ttf`.
- Charts are generated directly in `svg.ts` (bar, line, donut, metric cards)
  as SVG strings from data, without HTML or an external chart library.
- SVG↔PDF bridge: chart → SVG → PNG (resvg) → `doc.addImage()` in PDF. Reports
  embed charts as rasters.

### Return contract: a file path, not an image in context

- Rendering tools write to `outputDir` and return the path in text content.
- The deliverable is for a human (a graphic to paste or a client report). The
  LLM reads source numbers more accurately than chart pixels, and images are
  expensive context.
- PNG tools have `return_image: boolean` (default `false`) and can also return
  MCP image content. Use it only when the LLM must judge layout or aesthetics.
- `structuredContent` stays a compact summary: the path(s), the resolved
  `brandRef`/`profile`/`templateRef`/`surface`, `slideCount`, non-empty
  `appliedOverrides`, and warnings deduplicated across slides
  (`[{ message, slides }]`). Empty collections are omitted entirely.
- The full per-slide layout plans are opt-in through `diagnostics: 'full'` on the
  `render_slides_*` tools; they cost thousands of tokens per deck and only exist
  for debugging a layout. `server/src/example.ts` keeps writing the full
  `manifest.json` — `server/scripts/visual-qa.mjs` reads `slidePlans`,
  `slotBoxes` and `slideThemes` from it, so that file must stay verbose.

### Source layout (`server/src/`)

```text
index.ts            — entrypoint: McpServer, instructions, tool registration (render + auth), stdio. In async main().
config.ts           — ReportConfig { outputDir }, configFromEnv(), getConfigDir() → .report-baby, getOutputDir() → <data>/out
constants.ts        — (none; report-baby has no OAuth/keys)
errors.ts           — formatError()
version.ts          — SERVER_VERSION compiled into the bundle. update_plugin compares it with package.json on disk to distinguish DOWNLOADED from ACTIVE versions — the process cannot replace its own bundle live.
assets.d.ts         — declare module '*.wasm' / '*.ttf' → Uint8Array (for tsc; esbuild loads binaries)
svg.ts              — chart engine: barChart/lineChart/pieChart/metricCards/renderChart → SVG string. Palette, typography, FONT_FAMILY.
render.ts           — low-level engine: ensureWasm()+renderSvgToPng() (resvg), newPdf()+pdfFont() (jsPDF with embedded font, compress: true — without it chart rasters remain uncompressed and reports grow to tens of MB). applyPlugin(jsPDF) for autotable.
templates.ts        — listTemplates(), renderReportPdf(name, data) → Buffer (multi-page PDF with header/KPI/charts/sections/table/highlights/footer)
slides.ts           — bounded shared slide model and PDF 16:9, PNG 1600×900, and editable PPTX renderers
brand.ts            — brandbook reader: resolveBrandContext() → RenderTheme + RenderComposition + diagnostics, profile inheritance (extends), release snapshots (active.json → releases/<v>/), asset resolution behind safeRelativePath(), listBrandbooks()/inspectBrand()/listBrandTemplates()/inspectBrandTemplate()
template-source.ts  — brand-owned template language: compileTemplateSource() → CompiledTemplate (normalized 0..1 frames, named regions/slots, reject|shrink-to-fit), resolvePlan() → ResolvedTemplatePlan
text-runs.ts        — styled-run text engine: parseInlineRuns() (**bold**), fontCoverage() (TTF cmap format 4/12 → covered code points), splitUncovered() routing missing glyphs to the bundled DejaVu Sans, wrapStyledRuns()/drawStyledLine() measuring and drawing each run with its own font
slide-plan.ts       — resolveSlidePlan(): CompiledTemplate + theme + slide → ResolvedSlidePlan in 1600×900 px; slidePlanSummary() for diagnostics
slide-templates.ts  — built-in slide template refs, logical→physical direction/alignment/lockup helpers
slide-context.ts    — resolveSlideDeck(): validates the deck, resolves brand + template + plan per slide
tool-response.ts    — MCP response contract: brandRenderSummary(), slideRenderDiagnostics(summary|full), countWarnings() deduplicating one warning per slide into a single counted entry
builtin-template-loader.ts — reads server/templates/: readRenderConfig() (all visual constants) and the built-in slide templates, from the files embedded in the bundle or from an on-disk override
generated/          — build output of scripts/generate-builtin-templates.mjs; regenerated, never hand-edited
example.ts          — standalone prototype CLI used by scripts/render-example.js (external brandbook, no npm)
brand-tool.ts       — standalone authoring CLI: init, set, validate, template inspect/copy, preview, publish
cli.ts              — one-shot all-tools CLI adapter for web, sandbox, and CI sessions without MCP registration
assets/
  font.ttf          — DejaVu Sans regular (embedded in bundle)
  font-bold.ttf     — DejaVu Sans bold

tools/
  render-tools.ts   — registerRenderTools(): render_chart, render_metric_cards, render_svg, render_report, render_slides_pdf, render_slides_png, render_slides_pptx, list_templates. Responses go through tool-response.ts; list_templates returns its JSON once, in text content only.
  brand-tools.ts    — registerBrandTools(): list_brandbooks, inspect_brand, list_brand_templates, inspect_brand_template. Read-only; MCP never writes to a brandbook.
  auth.ts           — registerAuthTools(): update_plugin (self-update + changelog). No setup_auth; there is no OAuth.
```

Visual constants live in `server/templates/render-config.yml`, not in the
renderers, and built-in slide templates live in
`server/templates/slides/<name>/template.yml`. Both are embedded into the bundle
at build time by `server/scripts/generate-builtin-templates.mjs`; an on-disk
`templates/` directory or `REPORT_BABY_TEMPLATE_DIR` overrides the embedded copy
for development.

### Tools

- `render_chart` `{ type: bar|line|pie, data: [{label,value,color?}], title?, subtitle?, prefix?, suffix?, width?, output_path?, return_image? }` — chart → PNG, returns a path. **Primary graphics tool.**
- `render_metric_cards` `{ cards: [{label,value,delta?,trend?,note?}], title?, subtitle?, columns?, width?, output_path?, return_image? }` — KPI card grid → PNG.
- `render_svg` `{ svg, width?, output_path?, return_image? }` — arbitrary SVG → PNG (escape hatch; text requires `font-family="DejaVu Sans"`).
- `render_report` `{ template?='default-report', data, output_path? }` — opinionated template + data → multi-page PDF.
- `render_slides_pdf` `{ data, output_path?, diagnostics?='summary' }` — shared slide model → local 16:9 PDF.
- `render_slides_png` `{ data, slide_index?, output_dir?, filename_prefix?, diagnostics?='summary' }` — all slides or one selected slide → 1600×900 PNG.
- `render_slides_pptx` `{ data, output_path?, diagnostics?='summary' }` — same model → PPTX; text/KPIs/tables/shapes are editable and charts are images.
- Every slide of the shared model accepts `notes` (at most 4000 characters, `SLIDE_NOTES_MAX_CHARS` in `slides.ts`): speaker narration that is never drawn on the slide. `render_slides_pptx` writes it to the PowerPoint notes slide (`ppt/notesSlides/notesSlideN.xml` via `pptxgenjs` `slide.addNotes()`), which PowerPoint, Google Slides, Keynote, and LibreOffice show in presenter view. PDF and PNG have no notes channel: they drop it and say so — `notesSlides` counts the slides that carried notes and the warnings list gains one counted entry naming `render_slides_pptx`.
- `diagnostics: 'full'` on the three slide tools adds `slideDiagnostics` and the full `slidePlans`; the default `'summary'` omits them. `inspect_brand_template` is not a substitute — it only compiles brand-owned template sources (normalized 0..1 frames) and throws for built-in templates.
- `list_templates` `{}` — list templates (`default-report`, `campaign-summary`).
- `list_brandbooks` `{}` — locally configured brandbooks and their named profiles.
- `inspect_brand` `{ brand_ref, surface? }` — resolve one profile without rendering; returns the theme and diagnostics.
- `list_brand_templates` `{ brand_ref }` — brand-owned page/slide templates.
- `inspect_brand_template` `{ brand_ref, template_ref }` — compile and validate one brand-owned template without changing the brandbook.
- `update_plugin` `{}` — check/install plugin updates. The only update path is `start-mcp.js`; it does not update on startup, because a stale CDN cache used to overwrite a newer installation. The gate compares semver, so a copy newer than the update server remains untouched.

### One-shot web/sandbox execution

When a session cannot register the stdio MCP server, use the committed
`server/cli-bundle.cjs` with Node.js 18+ and no npm install:

```sh
node server/cli-bundle.cjs list_templates
node server/cli-bundle.cjs render_report < report.json
```

The MCP server is intentionally long-lived; use the CLI for one render so the
process exits after writing the artifact. The CLI exposes all 13 registered
tools and shares their handlers. Its bundle is downloaded from
`raw.githubusercontent.com`, which is the supported web distribution channel.
Do not change this path to `api.github.com` or `codeload.github.com`; those hosts
are blocked in target web/sandbox environments.
For a successful artifact render, stdout contains only the output path and
structured warnings are written to stderr. Pass `--json` when the full
structured result is required on stdout.

### `render_report` data shape

`{ brand?, title?, subtitle?, period?, intro?, kpis?: [{label,value,delta?,trend?,note?}], charts?: [{type,title?,subtitle?,prefix?,suffix?,data}], sections?: [{heading,body,level?}], table?: {head,body,caption?}, highlights?: string[], highlights_title?, footer? }`.

All fields are optional. Only present blocks render, in this order: header →
intro → KPI → charts → sections → table → highlights → footer (the numbered
footer appears on every page).

`intro`, `sections[].body`, section headings, highlights and the table caption
accept `**bold**` inline markup and fall back to the bundled DejaVu Sans for
characters the brand font does not carry; `sections[].level: 2` renders a
subheading under the preceding chapter. Table cells cannot do either — markup is
stripped and a cell needing a missing glyph is drawn wholly in DejaVu Sans, both
reported as warnings in `structuredContent.warnings`. There is no italic face,
so `*italic*` renders upright and reports a warning.

## Distribution — zero-dependency bundle

In v0.1 the engine used Playwright/Chromium and **could not be bundled**;
Chromium is a roughly 150 MB binary outside JavaScript and crashed on a fresh
machine without `node_modules/playwright`. v0.2 dropped the browser: resvg-wasm
and jsPDF are bundled by esbuild and the font is embedded as binary data. The
result is one `server/bundle.cjs` (about 6 MB), no runtime dependencies, and no
first-start download — the same model as `google-ads-baby`.

## How to add things

**New chart type/variant:**

1. Add a builder function in `svg.ts` returning an SVG string (use `open`,
   `text`, `header`, palette, `niceCeil`, and `truncate` helpers).
2. Connect it in `renderChart()` and in the `type` schema in `tools/render-tools.ts`.

**New rendering tool:**

1. Add `server.tool('render_...')` handler in `tools/render-tools.ts`.
2. Build SVG (from `svg.ts`) or PDF (from `templates.ts`), write with
   `writePng()` / `writeFile`, and return the path.

**New report template:**

1. Add an entry to `TEMPLATES` and a branch in `resolveTemplate()` in
   `templates.ts`.
2. Build on existing cursor-based sections (`renderHeader`/`renderKpis`/
   `renderCharts`/`renderSections`/`renderTable`/`renderHighlights`/
   `renderFooter`) with automatic page breaks.

**Conventions:**

- Do not write code comments; function and variable names must document intent.
- Put TODOs and plans in `ROADMAP.md`, not code comments.
- Wrap `index.ts` in `async function main(){...}` + `main()`; CJS bundles do not
  tolerate top-level await.
- SVG text must always use `font-family="DejaVu Sans"` (`FONT_FAMILY`), or resvg
  may omit it.
- Run `npm run build` after every `src/` change; `bundle.cjs` must stay current.

## Rejected options

- **Headless Chromium / Playwright (used in v0.1)** — pixel-perfect CSS, but
  the binary cannot be bundled and crashes without `node_modules`/Chromium.
  Replaced by the zero-dependency engine.
- **wkhtmltopdf** — archived project, old QtWebKit, and poor modern CSS support.
- **External chart libraries (Chart.js, QuickChart, AntV)** — Chart.js needs
  DOM/canvas, and QuickChart/AntV require runtime network. We generate SVG
  ourselves: self-contained, deterministic, offline.
- **Artifact on claude.ai** — attractive HTML, but confined to Claude. We need
  cross-client rendering to a file on disk.
- **Narration on `render_report` A4 pages** — no A4 surface has a presenter
  view, so page narration would either print (defeating its purpose) or vanish
  into a field nobody can read back. PDF text annotations are not a substitute:
  viewers either draw a visible sticky-note icon on the page or hide the text
  entirely. Report commentary belongs in `intro`, `sections`, and `highlights`,
  which are meant to be read. `notes` therefore exists only on the slide model.
- **PDF text annotations for slide notes** (`jsPDF createAnnotation`) — the same
  problem one surface down: an icon on the slide breaks "invisible in the
  layout", and viewers that hide annotations make the notes unreachable.

## Skills

- `skills/report-authoring/SKILL.md` — composing reports: tool selection, full
  `data` example, layout guardrails, table/chart shapes, and common mistakes.
  Loaded by Claude Code from the plugin root; update it whenever the
  `render_report` data shape or template layout changes.
- `skills/brand-authoring/SKILL.md` — creating external brandbooks, profiles,
  assets, and prototypes. Customer brandbooks and customer fixtures cannot be
  added here; only explicitly neutral synthetic
  `examples/brand-showcase` fixtures may test the generic renderer.

## Plugin manifests

- Claude Code: `.claude-plugin/plugin.json` (no `hooks`; there is no safety
  layer) + `.claude-plugin/marketplace.json`.
- Codex: `.codex-plugin/plugin.json` + `.mcp.json`; marketplace
  `.agents/plugins/marketplace.json` → `./plugins/report-baby` (wrapper with a
  separate `start-mcp.js` downloading the bundle to `~/.report-baby`).

## Repository and CI

- GitLab: `treetank/report-baby` (origin, primary).
- GitHub: `treetank-net/report-baby` (mirror, remote `gh`, branch `main`).
- `REPO_RAW` (`start-mcp.js`, `update_plugin`):
  `https://raw.githubusercontent.com/treetank-net/report-baby/main`.
- `.mcp.json` sets `CLAUDE_PLUGIN_ROOT` to `~/.report-baby/dev-plugin-root`, a
  guard so a checkout-launched server cannot write downloaded files into the
  working tree (`getPluginRoot()` without this variable is `process.cwd()`).

## Commands

- `cd server && npm install && npm run build` — install dev dependencies,
  typecheck, and bundle.
- `cd server && npm run dev` — watch typecheck (`tsc --watch --noEmit`);
  rebuild the bundle manually.
- `cd server && npm start` — run the MCP server from `bundle.cjs`.
- `node scripts/render-example.js ...` — prototype PDF/PNG/PPTX from an
  external brandbook; works without npm.
- `cd server && npm run build:example` — build a separate CLI bundle from the
  same modules as MCP.
- `cd server && npm run build:cli` — build the one-shot all-tools CLI bundle.

## Build

1. `cd server && npm install` — dev dependencies (resvg-wasm, jspdf,
   jspdf-autotable, esbuild, typescript).
2. `npm run build` does two things:
   - `tsc --noEmit` — typecheck (`assets.d.ts` recognizes `.wasm`/`.ttf`);
   - `esbuild src/index.ts --bundle --platform=node --target=node18 --format=cjs --minify --loader:.wasm=binary --loader:.ttf=binary --outfile=bundle.cjs` — bundle directly from `src/` rather than `dist/`, so binary loaders embed assets.

### What is and is not in git

- `server/src/` (including `assets/*.ttf`) — source ✓
- `server/bundle.cjs` — self-contained runtime (about 6 MB: code + WASM + fonts) ✓
- `server/dist/` — not created (`tsc --noEmit`) ✗
- `server/node_modules/` — dev dependencies ✗ (`.gitignore`); not required at runtime

## Configuration

Environment variables:

- `REPORT_BABY_DATA` — data/configuration directory (default `~/.report-baby`);
  output goes to `<data>/out`.
- `REPORT_BABY_BRAND_DIR` — brandbook directory (default
  `<REPORT_BABY_DATA>/brands`); profiles use references such as
  `brand://acme/primary`.
- `REPORT_BABY_BRAND_STORE` — published-release directory; takes precedence over
  `REPORT_BABY_BRAND_DIR` so MCP can ignore working-tree drafts.
- `REPORT_BABY_BRAND_SOURCE_ROOTS` — `:`-separated allow-list for absolute
  `assets.source_root` values. Relative roots stay owned by the brand directory;
  an absolute root outside the allow-list is rejected, because `source_root` is
  the trust boundary for externally owned assets.
- `REPORT_BABY_TEMPLATE_DIR` — overrides the render configuration and slide
  recipes embedded in the bundle.
