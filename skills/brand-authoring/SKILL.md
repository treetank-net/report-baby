---
name: brand-authoring
description: Create, normalize, inspect, and prototype a local multi-profile brandbook for report-baby. Use when a user wants to define a new brand, map an existing brand source such as HubSpot or a design system into _brand.yml, create brand profiles/kits, validate assets and tokens, or generate PDF/PPTX/PNG examples before exposing the brand to MCP rendering.
---

# Authoring a report-baby brandbook

Keep the brandbook outside the report-baby repository. The renderer is generic; the brandbook belongs to the client, marketing-context project, or another repository that owns the source assets.

## Start with a directory

Use a directory rather than a single file:

```text
brands/acme/
  _brand.yml
  profiles/
    primary.yml
    dark.yml
  templates/
    slides/
      innovation-story/
        template.yml
        cases.yml
  assets/
    logos/
    backgrounds/
  sources/
```

Start with one `_brand.yml` and add profiles only when a real use case needs a distinct composition, sub-brand, surface, or audience. Keep asset paths relative and keep provenance in `x-*` metadata.

Use `schema_version: 1` in both `_brand.yml` and `showcase.yml`. New brandbooks should declare the version explicitly.

## Define the minimum useful contract

Include:

- `meta`: name and short description;
- `color`: background, foreground, primary, secondary, muted, line, surface, success, danger, warning, and optional `palette`/`series`;
- `typography`: base and heading families, plus named roles when a profile needs them;
- `assets`: logo paths, optional white logo, optional background image, and optional `source_root` for assets owned elsewhere;
- font assets used by PDF/PNG should be TTF or OTF; WOFF/WOFF2 files are browser assets and should not be declared as the embedded report font;
- `layout`: `header_style`, `report_header_style` (`plain` | `accent-band` | `dark-band` | `image-band`; defaults to `header_style`, and `image-band` draws the `report_header_image` asset in the A4 header band), `show_report_brand_name` (set `false` when the logo already carries the wordmark), `title_align`, `title_case`, `heading_weight`, `body_weight`, `pptx_heading_scale` (an optional editable-output calibration), `radius`, `logo_variant`, `background_image_opacity`, and (for light/dark artwork) `image_text_color`;
- for artwork behind text, prefer `image_text_safe_area` and `image_scrim`; these settings are shared by SVG/PNG and PPTX. Background artwork always starts at the canvas origin.
- for composition, define brand-owned `templates/slides/*/template.yml` or `templates/pages/*/template.yml`; normalized frames, grids and relations are allowed inside a versioned template, but never in a profile, MCP request or one-time override;
- use a closed primitive vocabulary (`text`, `image`, `lockup`, `shape`, `chart`, `table`, `stack`, `grid`, `repeat`, `group`) and semantic brand roles instead of CSS, SVG, PPTX XML, raw pixels, hex colors or direct font paths;
- express RTL with logical `inline-start`/`inline-end`; preserve chart data order and default logo mirroring to `never`;
- optional profiles using `extends: path/to/parent`.

Do not invent a second token vocabulary for every customer. Prefer aliases in `color.palette`, profiles for meaningful variants, and one-time render overrides for local exceptions.

## Resolve and prototype

The brand is selected explicitly:

```text
brand://acme/primary
```

Use the bundled Node-only prototype runner from the report-baby checkout. It does not require npm at runtime. The standalone bundle imports the same resolver and renderer modules as the MCP bundle; only the CLI entry point differs:

```bash
node scripts/render-example.js \
  --kind deck \
  --brand-root /path/to/brands \
  --brand brand://acme/primary \
  --input deck.json \
  --out ./prototype/acme-primary \
  --formats pdf,png,pptx
```

For a report use `--kind report` and a JSON file containing either the report data directly or `{ "template_ref": "default-report", "data": { ... } }`. The script writes a `manifest.json` with the selected brand, resolved input, formats, and output paths.

When a brand has multiple real surface modes, add `showcase.yml` beside `_brand.yml`. Its `decks[].slides[]` entries contain `profile`, `type`, and example `data`; its `reports[]` entries contain a profile and example report data. Run `--kind showcase` to render every declared case. This keeps the showcase close to the brandbook and makes a mixed light/dark/gray/accent deck a first-class fixture rather than a renderer special case.

Brand-owned templates should also have `cases.yml` with baseline, minimal-data,
long-copy, capacity, optional-slot, profile and RTL cases where supported.
Root `showcase.yml` composes these cases into representative decks and reports;
it does not duplicate template geometry.

For the first brand-owned template slice, use the standalone tool for the
lifecycle around the renderer:

```bash
node scripts/brand-tool.js init --out /path/to/brands --brand acme --name "Acme" --preset starter
node scripts/brand-tool.js validate --brand-root /path/to/brands --brand brand://acme/primary
node scripts/brand-tool.js template inspect --brand-root /path/to/brands --brand brand://acme/primary --template slides/title
node scripts/brand-tool.js preview --kind deck --brand-root /path/to/brands --brand brand://acme/primary --input deck.json --out ./prototype/acme --formats png,pdf,pptx
node scripts/brand-tool.js set --brand-root /path/to/brands --brand brand://acme/primary --path layout.title_align --value center
node scripts/brand-tool.js publish --brand-root /path/to/brands --brand brand://acme/primary --store /path/to/brand-store --release 0.1.0
```

The tool needs Node.js but not npm at runtime. It calls the same source-level
template compiler and renderers as the MCP bundle. It currently covers
initial scaffolding, small token edits, validation, inspection, preview and a
local immutable publish. Larger template and asset changes remain ordinary
file edits followed by validation and preview.

Inspect the generated PNGs before refining tokens. Compare the same input with two profiles; if only the hash changes but the background, logo, typography, layout, and text contrast do not, the brand is not being used meaningfully. Check that logos do not collide with deck labels and that foreground/background roles remain readable on every PDF page.

## Validate before MCP use

Check, in order:

1. every declared logo/background path exists;
2. the selected profile resolves without warnings;
3. text remains readable on every declared background;
4. the same report/deck renders in PDF, PNG, and PPTX;
5. profile differences are intentional and visible, not random color substitutions;
6. the brand directory is configured with `REPORT_BABY_BRAND_DIR` or passed through the prototype runner.

Template mutations belong to the external brand authoring tool or to the MCP
that owns the client's brand repository. `report-baby` MCP only reads published
brand snapshots and renders them. Do not copy customer brand assets into
report-baby. Do not add customer names, logos, colors, paths, or example
outputs to the plugin source.
