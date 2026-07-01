# Changelog

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
