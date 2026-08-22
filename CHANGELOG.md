# Changelog

## v0.9.0

- Added a committed one-shot `server/cli-bundle.cjs` exposing all 13 render,
  brand, template, and update tools without MCP registration or npm at runtime.
- Added the `report-baby-web` skill and documented raw GitHub bundle
  distribution for web, sandbox, and CI sessions.
- The one-shot CLI can shallow-clone a brand repository with `--brand-url` and
  `--brand-path`, caching the checkout by repository, ref, and path.
- `pages/editorial-two-column` now reports warnings instead of silently
  overlapping unsupported KPI and chart blocks.

## v0.8.3

- Table rows get widow control. `renderTable` measures the table on a throwaway
  document before drawing it; when the tail page would carry fewer than
  `pdf.table_widow_min_rows` body rows and the table fits on one page, the whole
  table moves to a fresh page instead of leaving two rows behind a repeated
  header.
- A report that would end on a near-empty page is re-rendered with the gaps
  between blocks scaled by `pdf.last_page_gap_factor_1`, then `_2`, and the
  shorter result wins. Type sizes and leading are never touched — they are brand
  decisions. The applied factor is reported as a warning; if no factor saves a
  page, the original layout is kept.
- Three blocks now keep their heading: a table caption moves with the table, and
  the highlights list is paginated as a plan computed before its heading is
  drawn, so the heading can no longer stay behind on the previous page while the
  bullets move on.
- New `page-fill` QA gate with four synthetic cases (paragraph, bullet list,
  table tail, gap tightening) that fail when a report page carries less than
  `pdf.page_fill_min` of its content area.

## v0.8.2

- Widow and orphan control for A4 body copy, the Word rule the renderer was
  missing: a paragraph no longer breaks so that a single line is left at the
  bottom of a page or carried alone onto the next one. Blank lines between
  paragraphs do not count towards the minimum, and a page never opens on one.
  Thresholds: `pdf.widow_min_lines`, `pdf.orphan_min_lines`.
- The highlights list is paginated as a block rather than bullet by bullet: a
  single trailing bullet is no longer stranded on a page of its own
  (`pdf.widow_min_bullets`).

## v0.8.1

- A4 body text is drawn from styled runs instead of whole lines, which fixes
  three things at once:
  - `**bold**` (and `__bold__`) inside `intro`, `sections[].body`, section
    headings, highlights and the table caption now renders bold instead of
    printing the asterisks. `*italic*` renders upright and reports a warning:
    no bundled or brand font ships an italic face.
  - characters the brand font does not carry are drawn with the bundled DejaVu
    Sans rather than silently dropped. A real draft lost every `→` because
    Source Serif 4 has no U+2192 and jsPDF emits the notdef glyph without a
    word of complaint. `render_report` now reports which code points fell back.
  - table cells keep the same guarantee one step down: inline markup is
    stripped to plain text and a cell that needs a missing glyph is drawn
    entirely in DejaVu Sans. Both are reported as warnings, because neither is
    what the author asked for.
- New optional `sections[].level`: `2` renders a subheading under the preceding
  `level: 1` chapter, so a source draft with `##` chapters holding `###`
  sections no longer flattens into one list of identical headings. A level 1
  section may now carry an empty `body` and act as a chapter opener.
- `render_report` returns render warnings in `structuredContent.warnings`
  alongside the brand diagnostics.
- New QA case `inline-markup-report` with two gates that fail when either fix
  regresses: `render-warnings` matches the expected warning set, and
  `font-fallback` counts the baselines drawn with more than one font.

## v0.8.0

- A4 KPI grid no longer leaves a single orphan card in the last row: the column
  count is chosen so the remainder is never one.
- KPI notes that do not fit on one line are truncated with an ellipsis instead
  of being cut mid-phrase.
- New optional `highlights_title` in the `render_report` data shape; the bullet
  list heading is no longer hard-coded to "Highlights".

## v0.7.1
- `pdf.keep_together_waste_ratio` drops from 0.25 to 0.15. At 0.25 a section that missed the bottom of a page by a little still jumped to the next one, leaving up to a quarter of the sheet blank — 49 mm of empty cream in a replay of a real editorial draft. At 0.15 the block starts on the page it reaches and flows over; `pdf.section_min_lead_lines` still keeps a heading from stranding alone at the foot of a page.

## v0.7.0
- Slides take `notes`: per-slide narration that never appears in the layout. `render_slides_pptx` writes it to the PPTX notes slide, where PowerPoint, Google Slides, Keynote and LibreOffice all show it in presenter view, so a deck of numbers can carry the sentence that explains them. PDF and PNG have no notes channel and say so — they report the count and return one counted warning naming `render_slides_pptx`, rather than dropping the text silently.
- Page chrome no longer leaks its text style into the body. The repeated A4 header set a bold font and the header ink and never restored them, so any paragraph that continued past a page break kept drawing in the header colour: on an `image-band` profile with a light page, entire pages of body text rendered white-on-cream and bold. Confirmed across three real documents before the fix.
- A long block that does not fit the rest of a page now starts there and flows over, instead of jumping to the next page and leaving the remainder blank. Keeping a block together is still the default; it is abandoned only when the space left behind exceeds `pdf.keep_together_waste_ratio` of the usable page and the block's lead still fits. A five-page editorial fixture became three pages with no change to its content.
- Report content starts below the header band rather than at whatever offset the title and subtitle happened to end on, so a single-line title on an image band no longer puts the first paragraph inside the photograph.
- The `contrast-pdf-text` QA gate's stream parser tracks the clip path, the transformation matrix an image is drawn under, and `TL`/`T*` line advances. Previously it read no image geometry at all — every `Do` fell back to an empty operand list — so image bounds were unknown and text drawn near one was measured against the wrong background.
- New synthetic QA fixture: the `pyrus/editorial` profile renders an A4 report through an image band with a page-crossing body, which is the shape that produced the two header-band bugs in 0.6.0 and this release's contrast bug. `examples/brand-showcase` gains a synthetic dark band asset for it.

## v0.6.0
- Slide tool responses are compact by default. `render_slides_pdf`, `render_slides_png` and `render_slides_pptx` return the path, slide count, resolved brand/profile/template/surface, non-empty applied overrides and warnings deduplicated across slides; a warning that repeated once per slide is now one entry with a slide count. A ten-slide PPTX response fell from 32,726 to 230 characters, and the payload is O(1) in slide count instead of O(n). The full per-slide layout plans are still available through `diagnostics: "full"`, which is what a caller reading `slidePlans` must now pass. `list_templates` no longer duplicates its listing in `structuredContent`.
- A4 header images are clipped to their band. jsPDF does not clip, so a header image whose aspect ratio was taller than the band was cover-fitted and then drawn in full: a 3.9:1 image in the 210x34 mm repeated band rendered 54 mm tall and spilled over the page body, drawing dark photography across the first line of running text. Every page after the first was affected wherever `report_header_style: image-band` was set.
- `image-band` report headers pick readable ink. The brand name took `color.primary`, which on dark photography meant navy on navy; it now uses the image text colour, and the accent rule that was being drawn inside the band is omitted.
- New brandbook key `layout.show_report_brand_name`. Setting it to `false` keeps the logo asset and drops the repeated text brand name next to it, for lockups where the logo already carries the wordmark.
- Narrative and conclusion text on slides that carry a cover or an image band now uses the image text colour instead of `color.foreground`, matching the title, and the narrative bullet follows it. A light brand drew dark body text over dark photography.
- Line charts flip a value label below its point when the label would cross the top of the plot. A first data point equal to the rounded axis maximum used to print its value over the top axis tick.

## v0.5.0
- Brandbooks: external brand directories with named profiles, profile inheritance (`extends`), published release snapshots and asset resolution behind a path boundary. Four read-only tools expose them: `list_brandbooks`, `inspect_brand`, `list_brand_templates`, `inspect_brand_template`. MCP never writes to a brandbook.
- Brand-owned template language: normalised frames, named regions and slots, and `reject` / `shrink-to-fit` overflow per slot. The built-in slide templates (`standard`, `compact`, `centered-title`, `two-column`) and every visual constant now live in `server/templates/` and are embedded in the bundle at build time, so a copied `bundle.cjs` boots with no source tree next to it. `REPORT_BABY_TEMPLATE_DIR` overrides the embedded copy.
- Charts take their text, grid, axis and font from the brand theme instead of a fixed palette, and axis ticks land on round numbers.
- Text ink is measured rather than assumed. Table headers, table bodies and band text pick the candidate that clears the WCAG minimum for their size; a dark brand used to draw white body text onto the white row fill that `jspdf-autotable` supplies by default, leaving report tables unreadable.
- Chart category labels sit below the plot again. A constant migration had swapped the label gap with the truncation reserve, so labels overlapped the bars.
- PPTX: SVG assets are rasterised (`pptxgenjs` stored an SVG logo as `.png` with a PNG content type, which PowerPoint would not draw), media are deduplicated by digest, the slide background is written once per slide, and the logo lockup uses the same geometry as the SVG renderer. A deck with photography went from 28.2 MB to 3.3 MB.
- New brand directory settings: `REPORT_BABY_BRAND_DIR`, `REPORT_BABY_BRAND_STORE` and `REPORT_BABY_BRAND_SOURCE_ROOTS`, the allow-list that governs absolute `assets.source_root` values.
- Development harnesses: `scripts/render-example.js` for prototyping from an external brandbook without npm, `brand-tool` for authoring and publishing, and a visual QA suite whose gates cover three-format rendering, text overflow, slot geometry, determinism, WCAG contrast measured from rendered pixels and from the A4 PDF content stream, and a LibreOffice PPTX round-trip.

## v0.4.4
- `scripts/start-mcp.js` no longer updates the plugin on every start. Updates happen only through `update_plugin`; the wrapper downloads the bundle exactly once, when there is none on disk. A stale CDN cache used to let a start-up fetch overwrite a freshly installed newer copy — twice in practice, once degrading a 0.4.3 install to 0.4.2 files.
- `update_plugin` compares versions with semver ordering instead of string inequality, so a copy newer than the update server is left untouched with an explicit message instead of being silently downgraded.
- `.mcp.json` in this repo pins `CLAUDE_PLUGIN_ROOT` to `~/.report-baby/dev-plugin-root`, so a development server started from the checkout can never write update artifacts into the working tree.

## v0.4.3
- `update_plugin` now reports the version installed on disk separately from the version the process is actually running. A running MCP server cannot swap its own bundle — Node keeps the loaded module in memory — so a download that has not been activated yet says so instead of reading as done. The server version is compiled into the bundle (`version.ts`), which is what makes the two comparable.
- Downloads are now atomic: each file lands in `<name>.download` and is renamed into place, so an interrupted update leaves the previous working file instead of a truncated one. Applies to both `update_plugin` and the auto-update in `scripts/start-mcp.js`.

## v0.4.2
- Dependency audit: patched the five fixable advisories in the dependency tree — `dompurify` 3.4.12 → 3.4.13 (the only one that actually reaches the shipped bundle, via `jspdf`), plus `hono`, `@hono/node-server`, `fast-uri`, and `ip-address` under `@modelcontextprotocol/sdk`, none of which are bundled because the stdio transport never imports the HTTP paths.
- Known remaining: two high advisories in `image-size` via `pptxgenjs@4.0.1` (DoS in the ICNS/JXL/HEIF parsers). The only npm-offered fix is a breaking downgrade to `pptxgenjs@1.1.5`, which would drop PPTX export; the render engine only ever feeds it its own resvg PNGs, so it stays until pptxgenjs updates the dependency.

## v0.4.1
- Fixed PDF size: `render_report` and `render_slides_pdf` now deflate their content streams, so embedded chart rasters are no longer stored uncompressed. A 14-chart report drops from 46.3 MB to 0.51 MB and an 11-slide deck from 45.6 MB to 0.37 MB, with pixel-identical output.
- Synced the plugin manifest versions with the server version; they had lagged behind since v0.4.0.

## v0.4.0
- Added one bounded slide model covering title, KPI, chart, table, narrative, and conclusion slides while preserving the existing A4 `render_report` contract.
- Added local 16:9 `render_slides_pdf` and deterministic 1600×900 `render_slides_png`, including selected-slide rendering.
- Added `render_slides_pptx`; text, KPI cards, tables, and basic shapes remain editable, while charts are embedded as deterministic images.
- Added public MCP behavior coverage for A4 compatibility and all PDF/PNG/PPTX slide outputs.

## v0.3.2
- Updated `jspdf` to 4.2.1, `jspdf-autotable` to 5.0.8, and transitive `dompurify` to 3.4.12, clearing the production dependency audit.
- Added an MCP-level public behavior gate for chart text escaping and multi-page PDF generation.

## v0.3.1
- PDF page-break control in `render_report`: section headings, the table caption, and the "Highlights" heading are never orphaned at the bottom of a page — each block moves to the next page whole when it fits, and text longer than a page now flows across pages instead of overflowing past the bottom margin.
- `render_report` now declares the full `data` schema (kpis, charts, sections, table, highlights…) instead of an opaque object, so MCP clients see the exact shape and malformed input fails with a clear validation error instead of a runtime crash.
- New `report-authoring` skill: tool selection, full data example, layout guardrails (label length limits, table/chart data shape), and common mistakes.

## v0.3.0
- Renamed the self-update MCP tool from `check_update` to `update_plugin` and updated docs to match the exposed tool name.

## v0.2.0
- Replaced the headless-Chromium/Playwright engine with a fully self-contained one: `resvg-wasm` (SVG → PNG) + `jsPDF`/`jspdf-autotable` (PDF), with DejaVu Sans embedded for full diacritics. The bundle now has zero runtime dependencies — no browser download, no `npm install` on first run. This fixes the startup crash on machines without Playwright/Chromium.
- New native chart engine (`svg.ts`): bar, line (with area), and donut charts plus KPI metric cards, rendered straight from data values — no HTML, no external chart library.
- New tools: `render_chart`, `render_metric_cards`, `render_svg`. `render_report` now builds a multi-page A4 PDF (branded header, KPI grid, embedded charts, narrative sections, styled data table, highlights, footer) from structured data.
- Removed HTML/URL tools (`render_html_to_pdf/image`, `render_url_to_pdf/image`) and the `REPORT_BABY_CHROMIUM_CHANNEL` setting — the engine no longer uses a browser.

## v0.1.1
- Implemented Playwright rendering for HTML and URL inputs to PDF/PNG.
- Added generated output paths, image return content, report template rendering, and option mapping.
- Expanded built-in report templates with a campaign summary layout.
- Fixed STDIO server lifetime for bundled MCP startup.

## v0.1.0
- Initial skeleton: headless-Chromium HTML→PDF/PNG render MCP.
- Render tools return file paths (deliverable for humans), not images pulled into context.
- Optional `return_image` flag for layout/aesthetics review.
- Opinionated `render_report` tool with a built-in styled `default-report` template.
- `update_plugin` self-update tool; `start-mcp.js` auto-update + Chromium detection.
