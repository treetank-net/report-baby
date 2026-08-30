# Report Baby corpus through the composition-kernel prototype

Status: prototype result; no production renderer was changed.

## Question

Can the composition-kernel prototype consume the same synthetic report shapes
that already exercise Report Baby, instead of relying only on its own lorem
fixtures? The adapter reuses `server/scripts/lib/fixtures.mjs` and converts
sections, tables, highlights, Markdown images, and multipage content into the
kernel's source/blocks/images model.

Run it from `server/` with:

```sh
npm run test:prototype-report-baby -- --out /tmp/report-baby-report-baby-adapter-v1
```

The run leaves `fixtures.json`, one `source.json`, `plan.json`,
`outcome.json`, PDF, and PNG files per fixture, plus a machine-readable report.

## Result

The latest run passed 19 adapted Report Baby fixtures and 127 assertions. It covered:

- `editorialRegressionReport` variants A–I;
- `standardReport`, `multipageReport`, `inlineMarkupReport`;
- section, highlights, table, and gap-tightening page-fill cases;
- the existing Markdown image case as a block image;
- the same image case as a prototype float/exclusion variant.
- an explicitly positioned page-relative star frame.

The same adapter corpus passed with the Flux, Pyrus, Orbit, and Parcelia
editorial/primary profiles. The planner reports the selected family, regular
font, bold font, sizes, and line-heights in each persisted plan.

The current Report Baby controls also passed during the comparison:

- `test:editorial-flow`: 505 fixture variants;
- `test:report-layout`: footer containment, coverage, and continuation flow;
- `test:report-images`: Markdown, structured, and ZIP-sourced images.
- the 16-case boundary sweep, 20-case star-occlusion corpus, and 124-case
  breaking-policy corpus with independent PNG QA.

## What was confirmed

The prototype can currently:

- accept the product corpus through an explicit adapter;
- preserve product fixture identity and brand references at the composition
  boundary;
- place every authored text block without evaluator violations;
- continue content across multiple pages and columns;
- place a block image once;
- place a float once and reduce line measure beside its shape;
- place an image absolutely using a page-relative or anchor-relative frame;
- keep a table-like atomic block together when it fits a fragmentainer;
- return a PDF with `accepted-with-warnings` for soft conflicts such as
  underfill, a single-line continuation, or an overfull token;
- emit inspectable PDF/PNG/plan/outcome artifacts.

## What was not confirmed

The prototype is not yet a product renderer. The adapter report intentionally
records these capabilities as false:

- brand theme applied to colors and full component styling;
- real brand/content image bytes loaded and resolved;
- preservation of styled inline runs.

The prototype now loads the selected brand's declared regular/bold TTF files
and reads report sizing and line-height values from `render-config.yml`. It
still uses its own experimental page geometry, placeholder shapes, and colors.
This separates “the planner can consume our content shape and real font
metrics” from “the planner is already compatible with the whole product
rendering contract.”

## Image notation

The prototype accepts the following normalized shape for a placed image:

```yaml
shape: star
position:
  mode: absolute
  reference: page       # or anchor-box
  page: 0
  frame: { x: 104, y: 82, width: 32, height: 48 }
  wrap: true
```

`reference: page` uses page coordinates. `reference: anchor-box` uses the
rectangle where the anchored flow item would start. The image's declared shape
is then the exclusion mask; its rectangular frame is only the placement
reference. Flow placement remains available as the default.

## Important interpretation

The existing product tests do not become invalid because the prototype passes
these cases. They answer different questions:

- product tests verify current PDF behavior, brand resolution, and artifact
  containment;
- adapter tests verify that the new planner can preserve content identity and
  flow constraints on the same source families.

The next parity step is therefore a renderer adapter that feeds the resolved
Report Baby normalized content AST and content assets into the planner, followed
by PDF text and pixel comparison against the product controls. The full
124-case breaking corpus now also passes in a resource-safe host run: 124/124
cases, four policy profiles, two explicit `accepted-with-warnings` underfill
outcomes, and no pixel-QA errors. Its disposable artifacts are under
`/tmp/report-baby-breaking-policy-corpus-v5`.

The planner/backend seam is now exercised separately: `planFixture(fixture,
metrics)` accepts only a renderer-neutral text measurement adapter, while the
CLI creates the `jsPDF` adapter only for the render pass. The seam smoke test
passes with a synthetic metrics implementation; details are in
`composition-planner-seam.md`.
