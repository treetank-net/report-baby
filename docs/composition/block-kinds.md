# Composition block kinds

This is the canonical map of the block kinds currently accepted by the
composition model. A block kind describes the meaning of one content unit;
the template and renderer decide how that unit is shown. A quote is not a
separate block kind: it is a text block with `role: quote`, supplied by a
named insertion flow. The `main` flow is reserved for ordinary document text
and cannot contain quote blocks or insertion slots. Glyphs are renderable
decorations attached to a planned block or graphic, not content blocks.

## Common path

```text
CompositionInput
  → composition/adapters/input.ts
  → CompositionBlock
  → planner measurement and placement
  → evaluator legality and quality
  → jsPDF capability/backend rendering
```

Every block that can affect geometry must expose its size before the planner
checks collisions or commits its placement. The renderer receives the
selected plan and must not invent a different text break or silently discard a
block.

## Current block map

| Kind | Input and normalized data | Measurement | Placement and collisions | Evaluation | Rendering |
|---|---|---|---|---|---|
| `heading` | `type: heading`, text, optional level; normalized to a text block | `CompositionTextMetrics.measureText` and `lineHeight` for the heading style | Lines occupy a text slot; heading keep-with-next may require a later slot; it cannot overlap graphics or another line | Source coverage/order, containment and line legality are hard; following-line bonus and fragmentation are quality terms | Ordinary text backend with heading style; glyphs may target its final line if explicitly declared |
| `paragraph` | `type: text`, normalized Markdown/structured runs and plain searchable text | Text width, line height, padding, indent and optional glyph metadata from `CompositionTextMetrics` | Ordinary paragraphs use route slots; a `role: quote` paragraph is materialized only by a named non-`main` insertion flow | Full word coverage/order and geometry are hard; fragmentation, orphan lines, spacing and contrast affect score | Ordinary text backend; normalized runs are retained for styled rendering where supported |
| `list-item` | `type: list-item`, text and optional keep-with-next policy | Same text metrics as a paragraph, with list-item style and keep-together policy | Text lines use ordinary route slots; the planner may keep the item together or split only at a legal line boundary | Same text-flow hard rules; list keep decisions affect whether a candidate is legal or leaves a quality gap | Ordinary text backend with list-item style |
| `image` | `type: image`, asset reference or source, width, `contain`, optional wrap/caption | Image capability resolves asset dimensions, available width, caption lines and fitted height before placement | Atomic placement occupies a block slot or a growing text slot; `wrap: left/right` creates a graphic obstacle for later text; caption belongs to the image placement | Missing asset, invalid bounds, incomplete atomic placement and collisions are hard; scaling is recorded as a decision, not a failure | Image capability paints the asset and caption; the backend may expose the image as a graphic placement for wrapping |
| `table` | `type: table`, header and body rows, optional caption | Table capability measures one row fragment at a time and returns `endRow`; header repetition is explicit | Table placement consumes a block slot or a text-slot remainder; continuation is only at row boundaries and its box participates in collision checks | Row coverage/order, source kind, bounds and overlap are hard; table height is never guessed by the planner | Table capability paints header and selected rows using the planned row range |
| `metric` | `type: metric`, label/value and optional delta, trend and note | Metric capability validates usable width and returns configured atomic height | Atomic block placement in a compatible block slot; it does not enter ordinary text wrapping | Missing capability, invalid measurement, wrong slot/kind or incomplete placement are hard | Metric capability paints one metric block/card through the block renderer registry |
| `chart` | `type: chart`, chart type, optional title/subtitle and ordered data | Chart capability validates data and measures its raster/block height in the available box | Atomic block placement in a compatible block slot; a chart does not become a text-flow obstacle unless its template exposes it as a graphic | Missing capability, invalid data/measurement, wrong slot/kind or incomplete placement are hard | Chart capability paints the chart asset and optional searchable invisible title layer |

## Roles, insertions and graphics

`role` is an editorial relationship, not a replacement for `kind`. A paragraph
with `role: quote` remains a paragraph for measurement and text rendering, but
it must belong to a named insertion flow other than `main`. That flow declares
the insertion slots; the planner measures the quote, reserves its resulting box
as an obstacle, and then wraps the ordinary `main` flow around that box. The
evaluator checks the resulting complete plan; it does not give a quote a
special pass.

An authored `CompositionGraphic` is different from an image block. It is a
template-addressed graphic or background obstacle with a shape and optional
asset. Its shape may split available text intervals. An image block is content
that must be placed and covered; a graphic is a geometry/paint object that may
or may not wrap text.

Public `CompositionInput.graphics` entries are the accepted input form for
these authored graphics. They use `slot_id` and `asset_id` because the
template owns page geometry and the asset list owns source resolution. A
provided `size` is the measured painted box used by movable placement; without
it, the graphic occupies its whole template slot. The input adapter maps this
form into `CompositionGraphic` before planning.

Glyph definitions are resolved after final block/graphic geometry exists. The
glyph target identifies the existing block or graphic, while its anchor and
target mode determine whether its position follows a box, the first line or
the last line. A glyph is non-colliding unless the target explicitly makes it
part of an obstacle contract.

## Capability ownership

- `composition/adapters/input.ts` owns conversion from public input to normalized
  blocks and assets.
- `composition/layout/text-planner.ts` owns routing, text wrapping, block placement,
  obstacles, residual content and planning decisions.
- `composition/composition-engine.ts` owns planner/evaluator candidate orchestration.
- `composition/evaluation/evaluator.ts` owns hard legality and quality scoring. It does
  not measure or render blocks.
- `composition/adapters/pdf/backend.ts` owns jsPDF measurement and painting
  capabilities. `combineJsPdfCompositionBlockCapabilities` dispatches by the
  normalized block kind, so registering one capability cannot replace another.
- `composition/report-composition-entrypoint.ts` supplies capabilities to the
  production path; it does not contain a second block-kind implementation.

Adding a block kind requires updating this table, the input conversion,
compatibility rules, measurement capability, renderer dispatch and public
composition tests. A block kind is not stable merely because a PDF was
produced; the plan must also prove complete coverage and legal geometry.

## Current limits

The current model supports the seven kinds listed above. It does not yet make
every block kind a movable soft insertion. Images and quote-role text have
the most complete obstacle path; metrics and charts are atomic blocks whose
placement is currently selected by compatible template slots. Generalizing
that movement policy is the separate soft-insertion work in
`docs/release-1.0/07-block-kinds-and-soft-insertions.md`.
