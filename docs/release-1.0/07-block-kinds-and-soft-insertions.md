# Plan 07 — block kinds and soft insertions

Status: implemented for the Release 1.0 scope. The block-kind map, authored
graphics, movable insertions, renderer-neutral inline runs, and glyph fallback
are implemented. Every supported block kind can be assigned to explicit
`insertionSlots` when the slot allows its role and kind. The planner measures
and materializes text, tables, and atomic blocks (image, metric, chart) through
one obstacle-aware path.

Quotes are not a legacy path in `main`. A quote belongs to a named non-main
flow with declared `insertionSlots`; `main` may neither contain quote blocks nor
declare insertion slots. Preflight and evaluator checks enforce this boundary.
New block kinds remain outside the current capability model.

## Goal

Use one flow/placement model for content such as:

- quotes;
- graphics;
- KPIs and metric boxes;
- charts;
- tables and future block kinds.

An insertion may live outside the main flow, but its measured box must affect
the space available to main text. A quote is not hard-coded as “the third item
on every page”.

## Current implementation

`CompositionGraphic.size` provides the measured graphic box. Both authored
graphics and movable insertion requests use the same coarse/refinement search,
slot validation, capability measurement, placement materialization, and
obstacle registration. The main flow is planned around the resulting obstacle.

Public input accepts authored graphics through `graphics`; the input adapter
maps them to the internal `CompositionGraphic` model. For currently supported
content kinds, the shared capability measures the block and the placement layer
materializes the corresponding text, table, or atomic placement.

## One-off insertion with a request frame

A one-off custom placement does not require adding a permanent template slot.
The public request may declare a placement next to `data.flows`:

```json
{
  "template": "pages/editorial-two-column",
  "data": {
    "flows": {
      "main": { "blocks": [] },
      "quotes": {
        "blocks": [{
          "id": "quote-1",
          "type": "text",
          "role": "quote",
          "text": "A one-off quote."
        }]
      }
    }
  },
  "placement_requests": {
    "insertions": [{
      "flow_id": "quotes",
      "block_id": "quote-1",
      "page": 1,
      "frame": { "x": 0.1, "y": 0.333, "width": 0.8, "height": "auto" },
      "sizing": { "mode": "fit-content", "max_height": "page" }
    }]
  }
}
```

The template route owns the `continuation` policy. A request cannot override
it. With `continuation: forbidden`, remaining quote-flow content becomes a
residual/error instead of silently continuing. With continuation allowed, the
template must expose a compatible slot on subsequent layouts.

`placement_requests` creates no persisted template and does not mutate global
configuration. The adapter creates a per-run immutable overlay route and slot
and sends it through the ordinary insertion pipeline. The quote remains in a
non-main flow; the request supplies only its one-off geometry and page.

The public term is `frame`, matching template terminology. `CompositionBlock`
remains content-only. A `slot` is a named place with rules, a `frame` is the
declared geometry, and a `box` is the materialized `CompositionRect` used by
state, placements, and obstacles. A box is not another slot kind.

## Auto-height and fit-content

`height: "auto"` fixes position and width in the request while content
measurement determines height. Text, table, chart, metric, and image
measurements must produce the natural height; the obstacle receives exactly the
same final box. Growth must push declared following insertions or fail with a
collision.

`sizing.mode: "fit-content"` bounds the measurement by the available content
area and synchronizes the slot, placement, and obstacle. A fixed slot requires
a numeric height and reports `INSERTION_OVERFLOW` instead of growing. Any
`grow.pushes` relation is validated; overlapping dynamic slots are legal only
when an explicit push relation exists.

If “custom block” means a new block kind, a request frame alone is insufficient:
schema, measurement capability, placement, and renderer support are required.
Existing `text`, `table`, `chart`, `metric`, and `image` blocks use the shared
path.

## Repeated slot pools

A slot can be a repeated capacity rather than a one-to-one document slot. A
template may define `[quote-a, quote-b]`; the planner enumerates those two slots
for every applicable page layout. Five pages with seven quotes then consume the
first seven of ten available instances. Flow order remains assignment order:
the first two quotes use page one, the next two page two, and so on. If no legal
capacity remains for required content, the plan is rejected.

A one-off request can declare the same repeated pool:

```json
{
  "placement_requests": {
    "insertion_flows": [{
      "flow_id": "quotes",
      "start_page": 1,
      "repeat": "each-page",
      "slots": [
        { "id": "quote-a", "frame": { "x": 0.1, "y": 0.25, "width": 0.8, "height": "auto" } },
        { "id": "quote-b", "frame": { "x": 0.1, "y": 0.55, "width": 0.8, "height": "auto" } }
      ]
    }]
  }
}
```

This is a capacity pool, not a global solver. The planner preserves editorial
block order and chooses the first legal location. A block may optionally prefer
or require a particular `slot_id`/page. Growth must push subsequent slots or
reject the plan; it may not cover another quote.

## Dynamic-slot test scope

The control fixture uses five pages, seven synthetic quotes, and two slots per
page. The main flow contains enough text to reach all five pages. It does not
use an external article or brand. The baseline must be legal before each
negative mutation is applied, so every failure isolates one rule.

Both fixed and growing slots are covered:

| Mode | Contract |
| --- | --- |
| fixed (`fit_content` off, no `grow`) | the box keeps its declared size; oversized content yields `INSERTION_OVERFLOW` |
| growing (`fit_content` + `grow`) | the final box comes from measurement; growth pushes the next slot or rejects when capacity ends |
| auto-height | frame supplies position and width; measurement supplies height; a fixed final height is not an auto-height implementation |

Every mode requires the obstacle and insertion placement to have the same final
rectangle. A fixed slot is not moved merely to save a composition.

Here `continuation` is the template route policy for the insertion flow.
`placement_requests.insertion_flows` may select slots and pages but cannot create
a second flow policy. A contradictory `data.flows[id].continuation` declaration
must be rejected rather than silently becoming a second source of truth.

## Illegal-case matrix

Each case belongs to the request/preflight, planning, or evaluator seam and has
an explicit rejection result:

| Category | Mutation | Expected result |
| --- | --- | --- |
| identity | unknown `flow_id` | request rejected; no route |
| identity | `flow_id: main` | rejected; insertions cannot belong to `main` |
| identity | unknown `block_id` | rejected; no block assignment |
| identity | block assigned twice | rejected; no duplicate placement |
| flow | quote flow has no `insertionSlots` | `QUOTE_INSERTION_FLOW_REQUIRED` |
| flow | forbidden continuation requires another page | rejected; no silent continuation |
| geometry | non-positive x/y/width/fixed height | rejected before planning |
| geometry | frame outside page or overlapping chrome | rejected before assignment |
| geometry | dynamic frames overlap without a push relation | rejected |
| geometry | invalid `grow.max_height` or `grow.pushes` | rejected as invalid growth policy |
| slot | role/kind/id is not allowed by the slot | slot skipped; no legal target rejects the plan |
| capacity | seven quotes in ten slots is legal; eleven is not | residual plus rejected plan |
| measurement | capability missing, throws, or returns non-positive height | explicit insertion measurement error |
| measurement | table or fixed text exceeds its box | `INSERTION_OVERFLOW` and residual |
| growth | quote growth covers the next quote or footer | pushed according to policy or rejected |
| plan | placement/obstacle box is inconsistent or main text intersects it | evaluator rejects |
| plan | required insertion remains residual despite a legal slot | assignment test fails |

The dynamic-slot test and public insertion smoke cover the accepted plan, seven
placements, ten slot instances, no residuals, and the important negative cases.
The PDF check is an artifact check, not a replacement for plan assertions.

The canonical block-kind map is in
[`docs/composition/block-kinds.md`](../composition/block-kinds.md). The older
[`soft-insertion-placement-plan.md`](../research/soft-insertion-placement-plan.md)
is research input, not a second source of truth.

## Inline AST and styled runs

The current pipeline preserves the normalized AST and maps it to renderer-
neutral styled runs:

```text
markdown-normalizer
  → NormalizedContentNode[]
  → composition/adapters/input.ts
  → CompositionBlock.content + inlineRuns + plain block.text
  → text layout copies run ranges into CompositionLine
  → the PDF adapter measures and renders each run with its style
```

`CompositionInlineRun` carries text and semantic markers (`strong`, `emphasis`,
and `link`). Missing italic faces use an explicit upright fallback and warning;
missing glyphs use a registered fallback font per run (or table cell) with a
diagnostic code. The selectable PDF text layer is retained. The
`inline-markup-report` regression is green and confirms separate font resources,
glyph preservation, and table text without literal markdown delimiters.

## Release criteria

- Every supported block kind has one input-to-renderer mapping.
- Measurements are available before collision decisions.
- Preferred locations are declared rather than hard-coded to page numbers.
- Legality distinguishes impossible layouts from legal but lower-scoring ones.
- Real editorial and the 506-fixture editorial matrix pass the full gate.
- New block kinds require explicit capability seams; they are not automatically
  treated as insertions.
- No global document solver is introduced, and `main` has no insertion slots.
