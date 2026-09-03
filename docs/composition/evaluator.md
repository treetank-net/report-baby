# Composition evaluator

## Responsibility

The evaluator accepts a complete `CompositionDocument` and `CompositionPlan`,
then returns a `CompositionEvaluation`. It does not change the plan or trace and
does not render an artifact.

The implementation is in
[`composition/evaluator.ts`](../../server/src/composition/evaluator.ts), and the
result interface is in
[`composition/engine.ts`](../../server/src/composition/engine.ts).

## Two independent questions

1. Is the plan legal?
2. If it is legal, which variant looks better?

Diagnostics with severity `error` become `hardViolations`. A plan with a hard
violation or residual content receives `-Infinity` and cannot win through a high
score. Only a plan without such an error receives a quality score.

The comparator uses this order:

```text
legal plan > illegal plan
higher score > lower score
tie → stable candidate order
```

## Hard rejection rules

Any diagnostic with severity `error` is a hard violation. There is no minimum
quality score that can rescue such a plan. The evaluator also treats every item
left in `residualContent` as `RESIDUAL_CONTENT`, so a plan that loses content is
rejected even if its remaining geometry looks good.

### Plan and geometry integrity

| Codes | Rejection rule | Why it is hard |
|---|---|---|
| `FLOW_PLACEMENT_TARGET_MISSING`, `FLOW_PLACEMENT_OUTSIDE_SLOT`, `FLOW_PLACEMENT_CONTENT_MISMATCH` | A registered flow placement must target its slot, stay inside it, and agree with its actual lines/blocks. | The plan would describe a different geometry or content assignment than the renderer receives. |
| `FLOW_BARRIER_CANDIDATE_INVALID`, `FLOW_BARRIER_CANDIDATE_PLACEMENT_MISSING`, `FLOW_BARRIER_CANDIDATE_OUTSIDE_PLACEMENT`, `FLOW_BARRIER_CANDIDATE_SOURCE_MISSING`, `FLOW_BARRIER_CANDIDATE_SOURCE_NOT_WRAPPING` | A barrier candidate must have positive geometry, belong to an existing flow placement, and reference an existing wrapping obstacle. | Ordinary text must not wrap against fabricated or malformed collision geometry. |
| `LINE_TARGET_MISSING`, `LINE_OUTSIDE_SLOT`, `PLACEMENT_TARGET_MISSING`, `PLACEMENT_OUTSIDE_SLOT` | Every line and ordinary placement must target an existing slot and fit inside it. | The renderer cannot safely execute a placement outside its declared region. |
| `GRAPHIC_TARGET_MISSING`, `GRAPHIC_OUTSIDE_SLOT` | Every graphic must target an existing slot and fit inside it. | A graphic outside its slot invalidates both rendering and collision calculations. |

Containment is checked with a machine-precision guard derived from
`Number.EPSILON` and the coordinate scale. This is not a visual allowance: it
only prevents floating-point noise from rejecting an edge that should coincide.
Touching an edge is therefore legal; positive-area escape is not. The
composition geometry tolerance in YAML is used by planning/search and tests,
not as permission for evaluator geometry to leave a slot.

### Collision, order, and flow continuity

| Codes | Rejection rule | Why it is hard |
|---|---|---|
| `DUPLICATE_CONTENT`, `CONTENT_COVERAGE_GAP`, `CONTENT_RANGE_INVALID`, `CONTENT_NOT_FULLY_PLACED`, `RESIDUAL_CONTENT` | A source word range must be valid, continuous, appear once, and be fully placed. | Prevents loss, duplication, or invented content. |
| `LINE_OVERLAP`, `LINE_GRAPHIC_OVERLAP`, `BLOCK_TEXT_OVERLAP`, `BLOCK_OVERLAP`, `TABLE_TEXT_OVERLAP`, `TABLE_BLOCK_OVERLAP`, `TABLE_OVERLAP` | Positive-area overlaps between incompatible lines, blocks, tables, or wrapping graphics are rejected. | The final artifact would visibly collide or become ambiguous. |
| `CONTENT_ORDER_VIOLATION`, `QUOTE_ORDER_VIOLATION`, `INSERTION_SOURCE_ORDER_VIOLATION` | Blocks, quotes, and content on either side of an insertion must preserve source/visual order, except for an explicit planner defer/reposition decision. | The document would no longer mean what the authored flow says. |
| `BLOCK_SPLITS_ACROSS_INSERTION` | A non-table block cannot be split across a full-width insertion. | The insertion is an obstacle outside the ordinary route; crossing it would make the block’s flow semantics ambiguous. |
| `FLOW_COLUMN_ADVANCE_EARLY` | A block cannot continue in a later route segment while more than two line-heights remain unused in the previous segment. | One line-height plus fractional inter-block spacing is tolerated; a larger blank band indicates an unjustified column advance. |
| `ROUTE_SEGMENT_GAP` | On continuation pages, an unoccupied route index between occupied indexes is rejected unless explicitly collapsed or blocked. | Prevents text from silently skipping a physical segment. |

### Minimum useful flow fragments

The default planner value is
`pdf.planner_minimum_fragment_lines: 3`. The evaluator uses the
`plan.minimumFragmentLines` carried by the planner. It rejects
`EMPTY_FLOW_PLACEMENT`, `EMPTY_FLOW_SLOT`, `FLOW_SLOT_UNDERFILLED`, or
`FLOW_FRAGMENT_UNDERFILLED` only when all of the following are true:

- later content exists and is eligible for the skipped slot;
- the slot is not fully covered by an obstacle;
- at least the configured minimum number of usable lines remain; and
- the planner has not recorded that the required fragment could not fit after
  considering the obstacle, list keep, or keep cluster.

The value `3` is a product/layout heuristic inherited from the editorial
fragment policy: fewer lines make an early column or slot transition visibly
weak. It is not a universal typography law and must be calibrated against the
editorial corpus. A naturally empty final tail is allowed.

### Tables, atomic blocks, and assets

| Codes | Rejection rule | Why it is hard |
|---|---|---|
| `TABLE_SOURCE_MISSING`, `TABLE_KIND_MISMATCH`, `TABLE_PLACEMENT_TARGET_MISSING`, `TABLE_PLACEMENT_OUTSIDE_SLOT` | A table placement must reference its table source and fit its target slot. | The renderer cannot know which table or region the placement represents. |
| `TABLE_ROW_RANGE_INVALID`, `TABLE_ROW_COVERAGE_GAP`, `TABLE_NOT_FULLY_PLACED` | Row ranges must be integer, non-empty, within the table, continuous, and complete. | A partial or duplicated row sequence changes the table’s data. |
| `BLOCK_SOURCE_MISSING`, `NON_ATOMIC_BLOCK_PLACED`, `BLOCK_KIND_MISMATCH`, `DUPLICATE_BLOCK_PLACEMENT`, `BLOCK_PLACEMENT_TARGET_MISSING`, `BLOCK_PLACEMENT_OUTSIDE_SLOT`, `ATOMIC_BLOCK_NOT_FULLY_PLACED` | Atomic placements must have a matching atomic source, valid kind/slot, unique placement, and complete coverage. | Atomic blocks cannot be silently split or substituted by another block kind. |
| `IMAGE_ASSET_NOT_FOUND`, `GRAPHIC_ASSET_NOT_FOUND` | A referenced asset must exist in the document asset set. | The planned content cannot be rendered without its required asset. |

### What is deliberately not hard

`paragraph-fragmentation`, `orphan-lines`, `insertion-spacing`, column balance,
and heading-following are quality components, not rejection rules. In
particular, `orphan_min_gap_mm: 10` is the current threshold for counting a
one-line obstacle-separated fragment in the score; it does not reject the
plan. Similarly, a legal but ugly gap caused by an immovable obstacle remains
a score penalty rather than becoming a hard violation.

The hard thresholds above exist to protect executable correctness and authored
meaning. The soft thresholds exist to rank legal alternatives. Where a numeric
value expresses an aesthetic preference rather than an invariant, it is
deliberately provisional and must be tested before being changed.

## Current score

The score is a deterministic Report Baby product heuristic. It is not a CSS/W3C
standard, a statistical model, or the result of psychovisual calibration. It is
used to rank legal alternatives within the same template and configuration.

```text
score = composition_score.base + sum(component points)
```

All values come from
[`render-config.yml`](../../server/templates/render-config.yml), and all
measurements are computed from plan geometry:

| Code | Measurement | Scoring |
|---|---|---|
| `column-balance` | Average `min(lineCount) / max(lineCount)` on pages with at least two columns | positive: `value * column_balance_weight` |
| `heading-following-line` | Headings followed by text in the same page/slot | positive: count * `heading_following_line_bonus` |
| `paragraph-fragmentation` | Paragraphs split across different pages/slots | negative: count * `paragraph_fragmentation_penalty` |
| `orphan-lines` | One-line paragraph fragments separated by at least `orphan_min_gap_mm` when an obstacle causes the gap | negative: count * `orphan_penalty` |
| `insertion-spacing` | Uneven insertion padding, gaps before/after it, and spread between streams | negative: sum of measurements * the relevant weights |

A gap may be legal and caused by an immovable object, while still being
aesthetically unfavorable. Its cause remains in the evaluation details and
planner decisions; it does not waive the quality penalty.

## Origin of the weights

The first heuristic was created in the debug composition-score prototype. The
production weights were then moved to `render-config.yml` and extended in
later experiments with fragmentation, spacing, and orphan lines. The current
range — `base: 100`, `column_balance_weight: 12`, bonus `4`, penalties `3` and
`4`, and spacing weights `1/1/1` — is a manually selected working range.

Tests show that the components affect candidate selection, but do not yet prove
that the proportions are right for every article. Calibration requires a larger
corpus and comparison with human ratings. Do not change a weight without a test
showing which variant wins because of it.

## Observability

`CompositionEvaluation.scoreBreakdown` contains the value, points, and details
for every component. The engine trace records this for every candidate together
with insertion placements, status, hard-violation count, and `reflowPasses`.
Raster PDF/PNG is a separate artifact test; the evaluator does not derive score
from the image.
