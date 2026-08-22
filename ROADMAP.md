# Roadmap — report-baby

## Phase 1 — rendering engine (DONE, v0.2.0)

- [x] Drop Playwright/Chromium — it did not bundle reliably and crashed on a
  fresh machine without Chromium.
- [x] SVG → PNG engine using `resvg-wasm` (pure WASM, no browser binary).
- [x] PDF engine using `jsPDF` + `jspdf-autotable`, with embedded DejaVu Sans
  and full diacritics.
- [x] Zero-dependency bundle: `--loader:.wasm=binary --loader:.ttf=binary`,
  esbuild from `src/`.
- [x] `svg.ts`: bar, line, and donut charts plus metric cards from raw data.
- [x] Tools: `render_chart`, `render_metric_cards`, `render_svg`,
  `render_report`, `list_templates`.

## Phase 2 — richer charts and templates

- [ ] Grouped/stacked bar chart (multiple series).
- [ ] Multi-series line chart with legend.
- [ ] Horizontal bar chart for long category labels.
- [ ] More report templates (one-pager, comparison, dashboard-grid).
- [x] Template/chart data validation with zod instead of an untyped `record`
  (v0.3.1).

## Phase 3 — branding and layout

- [ ] Client logo (PNG/SVG data URI) in the report header.
- [ ] Configurable accent palette/theme per client.
- [ ] Lighter font (subset Roboto/Inter) instead of full DejaVu for a smaller
  bundle.
- [ ] Landscape orientation for wide reports with many table columns.

## Phase 4 — integrations

- [ ] Direct data input from `google-ads-baby` / `google-analytics-baby` for
  closed-loop reports.
- [ ] Export individual charts to SVG as well as PNG.

## Phase 5 — presentations

- [x] Shared bounded slide model + `render_slides_pdf` / `render_slides_png` /
  `render_slides_pptx` (v0.4.0).
- [ ] Vector `render_slides_pdf`. Today each slide enters the PDF as one
  full-page 1600×900 raster, about 102 DPI on a 400×225 mm page: text is not
  selectable or searchable and softens when zoomed or printed. Draw text,
  shapes, KPI cards, and tables directly with jsPDF, as `templates.ts` does for
  A4, and rasterize only charts. PNG and PPTX remain unchanged.
- [ ] More selectable fonts for client requests. PPTX stores a font name
  (`fontFace`), so `font_face` on `render_slides_pptx` is cheap, but today it is
  hard-coded to `Aptos` / `Aptos Display`, which Canva replaces and which can
  change layout. PNG/PDF fonts must be embedded (`resvg fontBuffers` and the
  jsPDF VFS), so each family adds roughly 700 KB to the bundle. Keep a palette
  of 2–3 families (see the Inter/Roboto subset in Phase 3) and allow a client
  brand kit to point to its own `.ttf` without bloating the bundle.
- [ ] Deck-as-JSON as the source of truth: the slide model lives in JSON;
  adding a slide means adding an entry and rerendering the deck. Remain
  stateless and deterministic, without risking corruption of another file.
- [ ] Merge into a NEW file: read `source.pptx`, emit `output.pptx` with the
  external and generated slides, and never overwrite input. Generated slides
  use their own layout and do not inherit the client master; fonts and colors
  must be mapped deliberately.
- [x] Per-slide `notes` (speaker notes) in the shared slide model, written to
  the PPTX notes slide (`ppt/notesSlides/notesSlideN.xml`) and reported as a
  counted warning by the PDF and PNG renderers, which have nowhere to keep it.
- [ ] Optional notes companion for the non-PPTX surfaces: either a sibling
  Markdown/text file listing the narration per slide, or jsPDF notes pages
  appended after the deck. Not sticky-note PDF annotations — viewers either
  draw a visible icon on the slide or hide the text entirely, so the notes
  would leak into the deliverable or be unreachable.
- [ ] Edit an existing file with `pptx-automizer` (npm, MIT, 0.9.0), NOT by
  hand-editing XML. Before adoption, check its Node >=20 requirement, its
  dependency on `pptxgenjs@^3.12.0` while this project uses 4.0.1, its temporary
  extraction directory, and its pre-1.0 API.

## Phase 6 — brandbooks, profiles, and resolved render kits

Direction accepted: do not invent a brand format from scratch. Use `_brand.yml`
as the core, DTCG as the token/variant layer, and a Quarto Brand Extension-like
catalog as the package. Keep our own layer limited to references, resolution,
composition, and renderer diagnostics. Contract:
[`BRANDBOOK-PLAN.md`](BRANDBOOK-PLAN.md) and
[`BRANDBOOK-TEMPLATE-CONTRACT.md`](BRANDBOOK-TEMPLATE-CONTRACT.md). Delivery
plan: [`BRANDBOOK-TEMPLATE-IMPLEMENTATION-PLAN.md`](BRANDBOOK-TEMPLATE-IMPLEMENTATION-PLAN.md).
Existing patterns: [`docs/brand-normalization-landscape.md`](docs/brand-normalization-landscape.md).

- [x] Multi-file brandbook directory with base `_brand.yml`, assets, profiles,
  and compositions — contract and catalog implemented.
- [x] Profile references such as `brand://acme/primary`, without loading the
  entire brandbook for every render.
- [x] Resolver: brand base → profile → surface → template → one-off overrides
  → capability/fit checks — MVP implemented.
- [x] Brandbook directory configuration alongside `REPORT_BABY_DATA` through
  `REPORT_BABY_BRAND_DIR`.
- [x] Minimal MCP tools: `list_brandbooks`, `inspect_brand`, and shared
  `brand_ref` on rendering tools.
- [x] Render decks, PDF reports, charts, and metric cards from a selected
  profile; select an individual slide with `slide_index`.
- [x] `template_ref` selects the closed slide-composition catalog;
  `slides/standard`, `slides/compact`, and `slides/centered-title` resolve in
  the shared slide plan.
- [x] First brand-owned template scope: declarative regions/slots language,
  compiler to a resolved plan, `slides/title`, and `slides/metrics-3` with
  frame/overflow tests.
- [ ] Open catalog of brand-owned templates; geometry is allowed only inside a
  versioned template, never in a profile or MCP request.
- [x] Per-render overrides for text fitting, density, typography role, and safe
  layout variants, without mutating the source.
- [x] `render_report`, `render_slides_pdf`, `render_slides_png`, and
  `render_slides_pptx` accept shared brand context; raw `render_svg` remains an
  escape hatch.
- [x] Brand fixtures live outside the renderer repository; neutral
  `scripts/render-example.js` and `example-bundle.cjs` allow runtime
  prototyping without npm.
- [ ] `marketing-context-mcp` as owner of durable per-client brandbooks;
  `report-baby` remains a local deterministic renderer.
- [ ] External `brand-tool`/standalone bundle for scaffolding, validation,
  preview, QA, and publication; `report-baby` does not own mutations.
- [x] First vertical slice: existing-layout inventory, brand-owned
  `slides/title`, shared `CompiledTemplate`/plan,
  `brand-tool validate|inspect|preview|publish`, and read-only MCP discovery.
- [ ] Immutable brand releases/store so MCP reads a published snapshot rather
  than the working tree.
- [ ] Adapters for `_brand.yml`, DTCG, `theme1.xml`, and `brand.json`; PDF/PPTX/
  vibes are evidence or proposal sources, not direct configuration for a binary
  renderer.

## Phase 7 — release hardening (in progress)

Driven by `docs/brand-rendering-review.md`, which holds the full findings.

- [x] Ship-blocking: built-in templates and `render-config.yml` embedded in the
  bundle, so a copied `bundle.cjs` still boots. Before this, wrapper installs
  and `update_plugin` produced a server that died at import time with
  `Render configuration was not found`, because only the bundle was downloaded.
- [x] `server/templates/` tracked in git.
- [x] Path boundary: absolute `brand_ref` and absolute asset paths must not
  bypass `safeRelativePath()`; absolute `assets.source_root` only from a
  configured allow-list.
- [x] One source for the MCP input contract; the zod schemas and
  `validateSlide()` had already drifted, leaving the `columns` slide and
  report `title_page` unreachable through MCP.
- [x] `template_ref` on `render_report` validated against real template names
  instead of failing deep inside `resolveTemplate()`.
- [x] Discoverability: built-in slide templates listed, tagged builtin vs brand.
- [ ] Finish moving visual constants out of TypeScript; retire the `legacy`
  section in favour of `pdf`, `pptx`, `chart`, and `fallbacks`.
- [x] Text ink is measured, not assumed: table headers, table bodies and band
  text pick the candidate that clears the WCAG minimum for their size instead of
  a hardcoded white. A dark brand used to draw white body text on the white row
  fill that `jspdf-autotable` supplies by default.
- [x] `contrast-pdf-text` reads the A4 content stream, pairs every text run with
  the rectangle drawn behind it and measures the real colours. The older
  contrast gates only compared colours declared in the theme, so any fill the
  renderer introduced itself was invisible to them.
- [x] SVG assets are rasterised on the PPTX path. `pptxgenjs` stored an SVG
  logo as `image-N.png` with `ContentType=image/png`; LibreOffice sniffed the
  bytes and drew it, PowerPoint would not.
- [x] PPTX media are deduplicated by digest and the slide background is written
  once per slide, taking a photographic deck from 28.2 MB to 3.3 MB.
- [ ] PPTX adapter owns no geometry of its own — every box comes from the plan,
  so one template edit moves PNG, PDF, and PPTX together.
- [x] Charts consume the brand theme for text, grid, and axis colours plus font,
  not just the series palette; axis ticks land on round numbers.
- [ ] Real font metrics for slide text fitting (jsPDF `getTextWidth` or TTF
  `hmtx`), replacing the estimated `0.56` glyph-width heuristic that both
  rejects text which fits and passes text which overflows.
- [ ] `overflow: reject` reported as per-slide diagnostics instead of throwing
  away the whole deck.
- [ ] `geometry: full | chrome-only` on `CompiledTemplate`, replacing magic
  comparisons against `slides/standard` in `slides.ts` and `slide-plan.ts`;
  `compact` and `centered-title` brought up to full `slots`.
- [x] Visual QA gates: three-format render, text overflow, contrast, slot
  overlap and containment, plus the LibreOffice PPTX round-trip when a
  converter is available.
- [x] Editorial multi-column A4 family (`kind: page`), designed in
  `docs/multi-column-pdf.md` before any renderer change.
- [ ] Image slots with `fit: cover|contain`, normalized `focal_point`, and
  opacity, applied identically by SVG, PDF, and PPTX. Rendered covers currently
  crop brand graphics at the frame edge because no focal point is honoured.
- [ ] `direction` accepted but ignored by `render_chart`, `render_metric_cards`,
  and `render_report`: only slide rendering mirrors for RTL, so an RTL brand
  gets left-aligned charts and A4 pages.
- [ ] Brand-owned `pages/*` templates can be authored and inspected but no
  renderer consumes them; A4 output still comes from `templates.ts` alone.
- [ ] `render_svg` receives no brand fonts, so hand-written SVG cannot use the
  same typography as generated charts.
- [ ] `slideCommonSchema.overrides` and `brandOverrideSchema` describe the same
  override surface twice; one of them should be derived from the other.
- [ ] Slide PDF rasterises each slide whole, so a deck with photography weighs
  several megabytes and its text is not selectable. Either draw slide PDFs as
  vectors or add a JPEG encoder for the photographic layers.
- [ ] Pixel contrast on slides covers title, subtitle, footer and table bodies.
  Slots that paint their own fill — callouts, metric cards — are measured
  against the theme foreground, which is not the ink the renderer uses there.
- [ ] The PPTX round-trip runs for two of the five format decks and skips the
  brands that carry a cover image; skipped cases are not logged.
- [ ] A declared bold font face is trusted without checking it. The `orbit`
  fixture ships `UbuntuSans-Bold.ttf` whose `usWeightClass` is 400, so bold text
  silently renders regular in PNG and PDF while PPTX substitutes a real bold.
- [ ] No synthetic fixture sets `report_header_style: image-band`, so the A4
  header band has no automated coverage. Both bugs fixed in v0.6.0 — the
  unclipped cover image and the unreadable brand name — were found by hand on a
  customer brandbook. A neutral `examples/brand-showcase` profile with an image
  band would let `contrast-pdf-text` catch that whole class of overlap.
- [ ] `layout.show_report_brand_name` governs the A4 header only; the slide
  lockup has no equivalent switch, so a logo that carries its own wordmark still
  gets the text brand name repeated on slides.
- [ ] The `contrast-pdf-text` gate has a dead zone that hides exactly the class
  of bug it was built for. In the `pyrus/editorial` case all 17 ivory-on-ivory
  text runs are discarded as "over an image" even though the header band is
  clipped to 34 mm and the text sits below it. The stream parser now tracks the
  clip path (`W`/`W*` with the `q`/`Q` stack), the `cm` matrix an image is drawn
  under, and `TL`/`T*` line advances, but text positions still drift enough to
  land inside an image box. Either finish the parser (reset the text matrix on
  `BT`, and read the leading per text object rather than per stream) or replace
  it with a rasterised measurement the way the slide gates work — `pdftoppm` is
  not a dependency the harness can assume, so that means an in-process
  rasteriser.
- [x] `render_report` keeps `default-report` single-column and now also offers a
  configurable multi-column `kind: page` family, so a long-form section can use
  an editorial layout when selected.
  edge to edge at 10.5 pt — readable, but not what a newsletter looks like.
  `docs/multi-column-pdf.md` has the research; nothing consumes it yet.
- [ ] No italic face anywhere: `*italic*` in report copy renders upright and
  only reports a warning. A brandbook cannot declare `font_italic_path`, and the
  bundled DejaVu set carries regular and bold only. Adding one means a third and
  fourth embedded face plus an italic slot in the brand font schema.
- [ ] Table cells cannot mix weights or fonts inside one cell: `jspdf-autotable`
  draws a cell with a single font, so inline markup is stripped and a cell that
  needs a glyph the brand font lacks is drawn entirely in DejaVu Sans. Drawing
  cells by hand from `willDrawCell` would fix both, but the row heights are
  measured by autotable before that hook runs.
- [ ] Styled runs are wrapped by measuring each token with its own font, while
  chart labels, KPI values and the PPTX renderer still measure whole strings in
  one font. A line that mixes fonts can therefore be a fraction of a millimetre
  wider than the wrapper assumed.
- [ ] A report can still end on a page holding one indivisible block — a list
  with its heading, or a table that only fits whole. Gap tightening (0.8.3) buys
  a few millimetres and widow control keeps the block together, but nothing will
  split a six-bullet list to fill the previous page, and nothing should: the
  remaining lever is a shorter last page, which means multi-column layout or a
  narrative that ends earlier.

## Phase 8 — refactoring goals

Structural work on the repository itself, planned in
[`docs/quality/`](docs/quality/README.md) as six measurable goals rather than a
phase sequence. Each goal names the effect it produces, carries a number measured
at `a987030`, and is verified by a command with an exit code — no metric is
judged by reading code.

The goals, and the gate that decides each:

- [x] **Page layout is configuration, not code.** A two-column A4 family with
  chosen column widths, driven by a template file. Today `kind: page` compiles but
  nothing renders it, `templates.ts` never reads a template at all, and
  `const CONTENT_W = PAGE_W - MARGIN * 2` is the whole layout model. The research
  in `docs/multi-column-pdf.md` and the 783-line algorithm in
  `server/scripts/prototype-multicolumn.mjs` are complete and unwired. Gate:
  mutating a declared geometry field must move the rendered output.
- [x] **Bad input says what to fix.** The same JSON mistake gives MCP users a
  field path and CLI users `j.forEach is not a function`. Gate: every rejection,
  on every path, names the field and the expected type; zero crash-shaped
  messages.
- [x] **Adding a thing costs fewer files.** One report field is mentioned in nine
  files. Reported, deliberately not gated — grep can be satisfied without
  reducing coupling.
- [x] **Standalone scripts share code.** 14 scripts, 3 729 lines, zero shared
  modules, `findOfficeConverter` in two copies that already disagree. Gate: at
  least one shared module and no identical function bodies across files.
- [x] **The result is reproducible.** Hash parity per format, plus a declared
  shape for `manifest.json`, which has six consumers and no schema — two of them
  run no renderer, so a byte-perfect change can still break them. Gate: zero
  differences.
- [x] **A module can be lifted out.** Explicitly a means to the first and third
  goals, not an end. The six-module import cycle is type-only: five `import type`
  edges carrying `RenderTheme`, `Slide` and `ResolvedSlidePlan`. Gate: zero
  runtime cycles, zero layer violations.

Cut, because nothing in the goals needed it: merging the three bundles into one
entrypoint, a repository-wide formatter, a test-architecture programme, and about
twenty structural metrics kept as proxies. Deferred with named triggers:
untracking the dev bundles, a CI verify stage, structural PDF diffing, corpus
extension, launcher install checks. The reasoning for each is in
[`docs/quality/README.md`](docs/quality/README.md).
