# report-baby

An MCP server for rendering polished reports: **data → PNG charts/metric cards
and PDF reports**. It is part of the `*-baby` plugin family, alongside
`google-ads-baby` and `meta-ads-baby`.

The simplest member of the family: local rendering only — **no OAuth, no
safety/hooks, no advertising-account APIs, and no browser at runtime**. Supply
data and receive a path to a finished PDF or PNG.

## What it is

- Render charts and metric cards to PNG without external services.
- Rasterize custom SVG to PNG.
- Opinionated `render_report`: built-in styled template + your data → a
  multi-page client-facing PDF report.
- One bounded slide model → 16:9 PDF, a PNG of the whole deck or one slide,
  and an editable PPTX.
- Returns a **file path**, not an image in context (a human deliverable).
  Optional `return_image` on PNG tools is available when an LLM must judge the
  layout.
- The response stays small on purpose: the written path plus the resolved brand
  profile, `template_ref`, slide count, and deduplicated warnings. The
  `render_slides_*` tools accept `diagnostics: "full"` to add the per-slide
  pixel layout plans for debugging; that payload is large, so it is opt-in.

## Tools

| Tool | Description |
| --- | --- |
| `render_chart` | data → bar/line/pie chart PNG |
| `render_metric_cards` | KPI → PNG card grid |
| `render_svg` | arbitrary SVG → PNG (`return_image` optional) |
| `render_report` | template + data → multi-page PDF report |
| `render_slides_pdf` | shared slide model → 16:9 PDF |
| `render_slides_png` | whole deck or selected slide → 1600×900 PNG |
| `render_slides_pptx` | shared slide model → editable PPTX |
| `list_templates` | list built-in templates |
| `list_brand_templates` | read-only list of templates owned by a selected brand |
| `inspect_brand_template` | read-only validation and inspection of a brand template |
| `update_plugin` | update the plugin |

## Charts

report-baby includes an SVG engine for bar, line, and pie charts and KPI cards.
Use `render_svg` for custom graphics.

## Build

```sh
cd server
npm install
npm run build
```

`npm` is needed only when developing or rebuilding report-baby. A bundled
installation needs Node.js 18+ and runs with `node`; it does not need `npm` at
runtime.

Set `REPORT_BABY_BRAND_STORE` to a published brand store when MCP must ignore
working-tree brand changes. `REPORT_BABY_BRAND_DIR` remains the working-tree
directory used for prototyping.

## Brandbooks

Brandbooks are external inputs, not plugin content. Keep each customer brand in
its own repository or configured data directory, with `_brand.yml`, profiles,
and assets next to the source brand. Select a profile explicitly with
`brand://...` and configure its parent directory with `REPORT_BABY_BRAND_DIR`.

For a Node-only local prototype, use the same renderer path as MCP:

```sh
node scripts/render-example.js \
  --kind deck \
  --brand-root /path/to/brands \
  --brand brand://acme/primary \
  --input ./deck.json \
  --out ./prototype/acme-primary \
  --formats pdf,png,pptx
```

The script runs a separately built standalone bundle that imports the same
resolver and renderer modules as the MCP bundle, renders the chosen input, and
writes a `manifest.json` with the resolved paths. It does not require `npm`.

Read [`docs/brand-authoring.md`](docs/brand-authoring.md) for the authoring
workflow and [`skills/brand-authoring/SKILL.md`](skills/brand-authoring/SKILL.md)
for the agent workflow. The contract for brand-owned slide/page templates is
documented in [`BRANDBOOK-TEMPLATE-CONTRACT.md`](BRANDBOOK-TEMPLATE-CONTRACT.md);
the external Node-only `brand-tool` can create a starter with `init`, make small
named YAML changes with `set`, validate, preview and publish. Template and
asset mutations belong to that external tool or the repository that owns the
brand, not to the report-baby MCP.

The renderer's shared visual defaults are also external data in
`server/templates/render-config.yml`; the built-in slide fallbacks live below
`server/templates/slides/`. Editing those files does not require changing a
TypeScript constant or rebuilding the design logic. A built-in fallback can be
copied into a brand and then edited there:

```bash
node scripts/brand-tool.js template copy \
  --brand-root /path/to/brands \
  --brand brand://acme/primary \
  --from slides/two-column \
  --to slides/decision-two-column
```

## Install in Claude Code

This repository can be installed as a Claude Code plugin through its marketplace
manifest:

```text
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
```

Add the GitLab repository as a Claude Code plugin marketplace, then install the
plugin:

```bash
/plugin marketplace add https://gitlab.com/treetank/report-baby.git
/plugin install report-baby@report-baby-marketplace
```

After installation, reload or restart Claude Code. The plugin registers the
`report` MCP server.

## Install in Codex

This repository contains Codex plugin metadata:

```text
.codex-plugin/plugin.json
.mcp.json
.agents/plugins/marketplace.json
```

The marketplace entry points to `./plugins/report-baby`, a small Codex wrapper
that downloads the latest built bundle from the GitHub mirror and starts the
MCP server.

Add this repository as a local Codex plugin/marketplace source, then enable
`report-baby`. No OAuth or mutation-safety hooks are required.

Architecture and trade-offs: `CLAUDE.md`. Plans: `ROADMAP.md`.

## Configuration

- `REPORT_BABY_DATA` — data directory (default `~/.report-baby`); output is in
  `<data>/out`.
- `REPORT_BABY_BRAND_DIR` — brandbook directory (default
  `<REPORT_BABY_DATA>/brands`). Renderers accept `brand_ref`, for example
  `brand://acme/primary`; `list_brandbooks` and `inspect_brand` help discover
  and validate profiles.
- `REPORT_BABY_BRAND_STORE` — optional published-release directory; it takes
  precedence over `REPORT_BABY_BRAND_DIR`.
- `REPORT_BABY_BRAND_SOURCE_ROOTS` — `:`-separated allow-list of directories a
  brandbook may reach with an absolute `assets.source_root`. Without it, only
  paths relative to the brand directory are accepted. Use it when brand assets
  live in another repository, for example a website theme checked out beside the
  brandbook.
- `REPORT_BABY_TEMPLATE_DIR` — optional override for the built-in render
  configuration and slide recipes embedded in the bundle.

## License

MIT — Jacek Mariański / Treetank.
