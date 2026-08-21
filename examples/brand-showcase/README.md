# Brand showcase

This is a runnable, neutral example set for prototyping brandbooks with `report-baby`. It is intentionally inside the repository so a user can copy a brand directory, edit `_brand.yml`, replace the SVG/PNG assets and render immediately. It contains no Trans.eu or customer assets.

The same renderer is exercised by four fictional brands with deliberately different complexity:

- `orbit` — a basic, deliberately plain system with one primary surface.
- `parcelia` — a segmented navy/orange commerce system with light, dark, gray, accent and graphic surfaces.
- `pyrus` — a segmented premium system with a pear mark, serif typography and multiple editorial surfaces.
- `flux` — a rich dark data-intelligence system with graphic cover art, mono typography and multiple mode changes.

Each `showcase.yml` declares its own example count and surface profiles. The content is deliberately similar where comparison is useful, so output differences are attributable to the brandbook: background, lockup, text colours, heading scale/weight, title alignment, bands, radii, chart series, footer and density.

Each example includes a real font asset used by PDF, PNG and editable outputs: Orbit uses Ubuntu Sans, Parcelia Liberation Sans, Pyrus DejaVu Serif and Flux DejaVu Sans Mono. Mark-only logo assets keep the logo/name lockup consistent across raster, PDF and PPTX renderers. The generated manifests record the resolved font and asset paths.

Every source brand and showcase declares `schema_version: 1`. Graphic profiles may additionally declare `image_text_safe_area` and `image_scrim`; the Pyrus cover exercises the safe area while keeping its editorial background clean. Background artwork is always rendered from the canvas origin so it cannot reveal an uncovered strip at an edge.

## Run it

Node 18+ is the runtime requirement. npm is only needed in the plugin repo to build the standalone bundle:

```bash
cd server
npm run build:example
cd ..

node scripts/render-example.js \
  --kind deck \
  --brand-root examples/brand-showcase/brands \
  --brand brand://orbit/primary \
  --input examples/brand-showcase/content/deck.json \
  --out /tmp/report-baby-orbit \
  --formats pdf,png,pptx
```

To render the report, use `--kind report` and `content/report.json`. To compare brands, change only `--brand`:

```bash
for brand in orbit parcelia pyrus flux; do
  node scripts/render-example.js --kind deck \
    --brand-root examples/brand-showcase/brands \
    --brand "brand://${brand}/primary" \
    --input examples/brand-showcase/content/deck.json \
    --out "/tmp/report-baby-${brand}" --formats pdf,png,pptx
done
```

The more representative path is the brand-native showcase. It does not use one shared deck: each brand’s `showcase.yml` defines sample report data and a mixed deck whose slides select different surface profiles. The same showcase command renders both report modes and the deck:

```bash
node scripts/render-example.js \
  --kind showcase \
  --brand-root examples/brand-showcase/brands \
  --brand brand://parcelia/primary \
  --out /tmp/report-baby-parcelia-showcase \
  --formats pdf,png,pptx
```

The resulting deck intentionally contains a graphic cover, light metrics, dark chart, gray narrative and accent table. A brand with more surface definitions can expose more showcase cases without modifying the renderer.

To render every showcase and run the repeatable audit:

```bash
node scripts/render-brand-showcase.js \
  --out examples/brand-showcase/generated \
  --formats pdf,png,pptx
node scripts/audit-brand-showcase.js examples/brand-showcase/generated
node scripts/inspect-brand-showcase.js \
  --root examples/brand-showcase/generated \
  --qa-root /tmp/report-baby-brand-showcase-qa \
  --require-pptx-render
```

The checked-in showcase outputs live under `generated/<brand>/`. Orbit intentionally has only `reports/primary-report` and `decks/primary-surface`; Parcelia, Pyrus and Flux expose richer surface cases. Flux also includes `reports/pagination-report`, a three-page report whose narrative and table continue across pages with repeated report chrome and table headings. The `/tmp` paths in the earlier examples are disposable scratch directories for quick experiments.

Inspection output is generated outside the repository by default. The small files under `content/` are generic renderer fixtures; the brand-native examples are defined by each brand's `showcase.yml`.

The standalone bundle imports the same resolver and rendering modules as the MCP bundle. Only the CLI entry point is different. Each output directory contains a `manifest.json` with the selected brand and diagnostics, which is useful when prototyping overrides.

## What this proves

This is not a claim that every generated design is production-ready. It is a visual contract test and a starting point for authoring:

1. A brand can be resolved by `brand://brand/profile` without changing the renderer.
2. The same source content can become materially different PDF, PNG and PPTX outputs.
3. SVG logos, white logo variants and raster cover art can be mixed in one brandbook.
4. Profiles can change composition, not merely colours: title alignment, image bands, uppercase treatment, radii and logo contrast are all profile-controlled.
5. A slide can apply a one-off text-fit override while retaining the rest of the selected brand.
