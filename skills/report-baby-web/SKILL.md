---
name: report-baby-web
description: Render a report, deck, chart, PDF, PNG, or PPTX with report-baby when the report-baby MCP server is not available as a tool in a web, sandbox, or CI session. Use when a brand URL and structured data must produce a branded artifact without installing npm dependencies or registering an MCP server.
---

# Run report-baby without MCP

Use this skill when report-baby is not registered as an MCP tool. The one-shot
CLI uses the same handlers and renderer as the MCP server. It needs Node.js 18+
and a brandbook directory, but no npm install and no build.

## Bootstrap the bundled engine

The committed bundle is the distribution artifact. Download it from the raw
GitHub mirror; do not clone report-baby or build it in the target session.

```bash
BASE=https://raw.githubusercontent.com/treetank-net/report-baby/main
mkdir -p /tmp/rb/server /tmp/rb/scripts
curl -sfL "$BASE/server/bundle.cjs" -o /tmp/rb/server/bundle.cjs
curl -sfL "$BASE/server/cli-bundle.cjs" -o /tmp/rb/server/cli-bundle.cjs
curl -sfL "$BASE/server/example-bundle.cjs" -o /tmp/rb/server/example-bundle.cjs
curl -sfL "$BASE/scripts/start-mcp.js" -o /tmp/rb/scripts/start-mcp.js
curl -sfL "$BASE/package.json" -o /tmp/rb/package.json

export CLAUDE_PLUGIN_ROOT=/tmp/rb
export REPORT_BABY_DATA=/tmp/rb-data
```

The `-f` flag matters: a blocked or unavailable URL must fail during download,
not save an HTML error page that Node reports later as a confusing syntax error.

## Fetch and verify a brandbook

A brand is a directory containing YAML/JSON metadata, profile files, templates, and
binary assets. Clone the repository sparsely and shallowly:

```bash
git clone --depth 1 --filter=blob:none --sparse <BRAND_REPOSITORY_URL> /tmp/brands
cd /tmp/brands
git sparse-checkout set <PATH_TO_BRAND_DIRECTORY>
export REPORT_BABY_BRAND_DIR=/tmp/brands/<PATH_TO_BRAND_DIRECTORY>
```

For the neutral demo brandbook:

```bash
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/treetank-net/report-baby.git /tmp/brands
cd /tmp/brands
git sparse-checkout set examples/brand-showcase
export REPORT_BABY_BRAND_DIR=/tmp/brands/examples/brand-showcase/brands
```

Always discover before rendering. Do not guess profile or template names:

```bash
node /tmp/rb/server/cli-bundle.cjs list_brandbooks
node /tmp/rb/server/cli-bundle.cjs list_templates
node /tmp/rb/server/cli-bundle.cjs inspect_brand '{"brand_ref":"brand://flux/primary"}'
```

Use the path-based `brand://<directory>/<profile>` explicitly, for example
`brand://flux/primary`. `flux` is a directory and `primary` resolves to
`primary.yml` inside it; it is not a host name or an implicit `profiles/`
lookup.

## Render from a JSON file

Pass structured input through stdin. This avoids shell quoting failures with
apostrophes, Polish characters, and multiline text:

```bash
node /tmp/rb/server/cli-bundle.cjs render_report < report.json
```

When a render writes an artifact, stdout contains only its path so shell
composition stays simple. Any `structuredContent.warnings` are printed to
stderr; use `--json` when the complete structured result is needed on stdout:

```bash
node /tmp/rb/server/cli-bundle.cjs --json render_report < report.json
```

The report input has this shape:

```json
{
  "template": "default-report",
  "brand_ref": "brand://flux/primary",
  "output_path": "/tmp/rb-data/out/report.pdf",
  "data": {
    "title": "Monthly performance report",
    "subtitle": "Results and next actions",
    "brand": "Client name",
    "period": "Q2 2026",
    "intro": "One short lead paragraph.",
    "kpis": [{"label":"Revenue","value":"124 300 zł","delta":"+18%","trend":"up"}],
    "charts": [{"type":"bar","title":"Spend by channel","data":[{"label":"Search","value":18200}]}],
    "sections": [{"heading":"What worked","body":"The narrative supports **bold** inline text and ![a chart](root://assets/chart.png)."}],
    "table": {"head":["Channel","Result"],"body":[["SEO",42]]},
    "highlights": ["One short takeaway"],
    "footer": "Source: verified analytics data"
  }
}
```

The tool accepts `default-report`, `campaign-summary`, and the built-in
`pages/editorial-two-column` report template. Slide references such as
`slides/two-column` belong to `render_slides_pdf`, `render_slides_png`, and
`render_slides_pptx`, not `render_report`. Use `list_templates` for the current
complete list.

For a structured image, use a section's `content` instead of `body`, for
example `{ "type": "image", "src": "brand://assets/map.png", "alt": "Map", "caption": "Source map", "width": "80%", "fit": "contain" }`.
`root://` resolves under `content_root`, `brand://` under the selected brand
directory, and `source://` under the complete materialized ZIP/Git source.

`render_slides_pdf` produces the selectable-text PDF. `render_slides_png` takes
the same slide model, renders that canonical PDF, and rasterizes its pages for
visual inspection by an LLM. `render_slides_pptx` produces the editable text
surface. The slide PNG path needs the system `pdftoppm` command from Poppler.
LibreOffice is only needed for optional PPTX round-trip visual QA.

The checkout can be automated when the brandbook lives in a Git repository:

```bash
node /tmp/rb/server/cli-bundle.cjs \
  --brand-url https://github.com/example/client-brand.git \
  --brand-path brands \
  render_report < report.json
```

The CLI materializes the complete Git or ZIP source and caches the immutable
result under the configured data directory by source identity. Pass
`--git-ref main` (or another branch/tag) for Git sources and `--brand-path` to
select a subdirectory. The JSON still needs an explicit path-based
`brand_ref`, such as `brand://client/primary`.

Charts use raw numeric values. Keep KPI labels below roughly 28 characters,
periods short, and footers below roughly 120 characters. TTF/OTF fonts work in
PDF/PNG; WOFF and WOFF2 are browser formats and do not.

## Traps

- Do not use `scripts/start-mcp.js` for a one-shot render. The MCP server is
  intentionally long-lived and keeps stdin/event processing open; a successful
  render through it can look like a timeout. Use `cli-bundle.cjs`.
- A no-argument tool such as `list_templates` must be called without piping an
  empty stdin. The CLI avoids waiting for EOF for no-argument tools.
- Export expanded environment values. A literal value containing `${` is
  rejected as an unresolved placeholder; do not pass strings such as
  `${REPORT_BABY_DATA:-}`.
- `REPORT_BABY_BRAND_DIR` points to the directory containing brand folders, not
  directly to one `_brand.yml`. `REPORT_BABY_BRAND_STORE` takes precedence.
- The three template namespaces are separate: unprefixed names and `pages/*`
  go to `render_report`; `slides/*` goes to the slide tools.
- `pages/editorial-two-column` is a text-flow composition. Its `kpis` and
  `charts` blocks are not drawn; the CLI returns warnings for them. Move those
  blocks to `default-report` or express the content in `sections`/`highlights`.
- Keep output paths in a writable directory. The CLI prints the artifact path
  on stdout and errors on stderr with a non-zero exit code.
- Distribution uses `raw.githubusercontent.com`. Do not replace it with
  `api.github.com` or `codeload.github.com`; those hosts are unavailable in
  some target web/sandbox environments.
