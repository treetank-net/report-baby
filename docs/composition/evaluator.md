# Composition evaluator

## Responsibility

The evaluator accepts a complete `CompositionDocument` and `CompositionPlan`,
then returns a `CompositionEvaluation`. It does not change the plan or trace and
does not render an artifact.

The implementation is in
[`composition/evaluation/evaluator.ts`](../../server/src/composition/evaluation/evaluator.ts), and the
result interface is in
[`composition/contracts/engine-contracts.ts`](../../server/src/composition/contracts/engine-contracts.ts).

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

Every evaluated result also exposes `passedMetrics`: the score components that
did not incur a penalty. Public report responses include a compact
`compositionQuality` summary with those passed metrics, composition diagnostics
and actionable suggestions; requesting full diagnostics additionally exposes
the complete plan and score evidence.

This is product output, not test-only output. `render_report` includes the same
quality summary in MCP `structuredContent` and text content for both `dry_run`
drafts and rendered PDFs. The CLI keeps the PDF path on stdout for shell
compatibility and writes the quality summary to stderr, so a normal render still
tells the caller what was accepted, penalized, or needs fixing.

The low-level `renderReportPdf` helper intentionally remains a buffer-only
primitive for embedding callers. It must not write to stdout or stderr as a
side effect. Public adapters call the detailed renderer and are responsible for
returning or printing its evaluation; test scripts may assert that contract but
are not the product reporting channel.

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
| `GRAPHIC_TARGET_MISSING`, `GRAPHIC_OUTSIDE_SLOT`, `GRAPHIC_BOX_OUTSIDE_SLOT` | Every graphic must target an existing slot and fit inside it, including an explicitly sized or movable graphic box. | A graphic outside its slot invalidates both rendering and collision calculations. |

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
| `CONTENT_ORDER_VIOLATION`, `QUOTE_ORDER_VIOLATION`, `INSERTION_SOURCE_ORDER_VIOLATION` | Blocks, quotes, and content on either side of an insertion must preserve source/visual order. Insertions are supplied by their separate named flow; there is no inline defer/reposition exception. | The document would no longer mean what the authored flow says. |
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

### Planner-originated hard rules

The evaluator preserves `error` diagnostics already produced by the planner,
so these are also hard rejections even though their implementation lives in
the planner. They describe an inability to construct an executable plan, not a
quality preference.

| Codes | Rejection rule | Why it is hard |
|---|---|---|
| `PLANNER_ITERATION_POLICY_INVALID`, `PLANNER_DID_NOT_STABILIZE` | The planner policy must be valid and the bounded planning/reflow process must reach a stable result. | The returned plan is not a reliable result of the planning contract. |
| `MAX_PAGES_EXCEEDED`, `FLOW_CONTINUATION_FORBIDDEN`, `FLOW_START_PAGE_INVALID` | Content cannot exceed the configured page limit, continue through a forbidden route, or start outside the route’s allowed page. | The plan cannot be rendered within the template’s declared page/route contract. |
| `FLOW_ROUTE_NOT_FOUND`, `FLOW_SLOT_NOT_FOUND`, `LAYOUT_NOT_FOUND` | Every flow continuation must resolve to a route, slot, and page layout. | There is no physical destination for the content. |
| `GROW_POLICY_INVALID`, `GROW_TARGET_NOT_FOUND` | A growing slot must have a valid growth policy and every pushed target must exist. | The planner cannot execute the declared displacement relationship. |
| `MAIN_FLOW_INSERTIONS_FORBIDDEN`, `MAIN_FLOW_QUOTE_FORBIDDEN`, `QUOTE_INSERTION_FLOW_REQUIRED` | `main` cannot declare insertion slots or contain quote blocks; every quote must belong to a non-main flow that declares insertion slots. | The planner cannot safely assign an inline quote to the ordinary main stream. |
| `INSERTION_ROUTE_NOT_FOUND`, `INSERTION_SLOT_NOT_FOUND`, `INSERTION_PLAN_MISSING`, `INSERTION_OVERFLOW`, `INSERTION_MEASUREMENT_UNAVAILABLE`, `INSERTION_MEASUREMENT_FAILED` | An insertion block must have a valid non-main flow route/slot, a renderer-neutral measurement, remain synchronized with its plan, and fit its measured box. | The obstacle and the flow would disagree about what is on the page. |
| `MOVABLE_INSERTION_TARGET_NOT_FOUND`, `MOVABLE_INSERTION_BOUNDS_INVALID` | A movable insertion must resolve to a planned insertion and its candidate frame must contain the measured box with a valid candidate count. | Candidate evaluation would otherwise compare fabricated or incomplete geometry. |
| `MOVABLE_GRAPHIC_TARGET_NOT_FOUND`, `MOVABLE_GRAPHIC_BOUNDS_INVALID` | A movable graphic must resolve to an authored graphic with a measured box, and its frame must contain that box with a valid candidate count. | Candidate evaluation would otherwise compare fabricated or incomplete graphic geometry. |
| `GRAPHIC_ROUTE_NOT_FOUND`, `GRAPHIC_SLOT_NOT_FOUND`, `GRAPHIC_PAGE_OUT_OF_RANGE`, `GRAPHIC_SHAPE_PARAMETER_INVALID`, `GRAPHIC_ASSET_NOT_FOUND` | A graphic must have a valid route, slot, page, shape parameters, and asset. | Text wrapping and rendering cannot be trusted without a valid obstacle. |
| `UNSUPPORTED_INLINE_ASSET` | Inline assets must have an asset-to-slot mapping before text planning. | The planner has no legal geometry for the inline content. |
| `NON_ATOMIC_BLOCK_IN_BLOCK_SLOT`, `BLOCK_MEASUREMENT_UNAVAILABLE`, `BLOCK_MEASUREMENT_FAILED`, `BLOCK_MEASUREMENT_INVALID` | Block slots may only receive supported atomic blocks with a successful, valid measurement. | An unmeasured or malformed block cannot be placed deterministically. |
| `TABLE_MEASUREMENT_UNAVAILABLE`, `TABLE_MEASUREMENT_FAILED`, `TABLE_MEASUREMENT_INVALID` | A table fragment must have an available, successful, and valid renderer-neutral measurement. | Row coverage and collision checks would be based on unknown geometry. |
| `MINIMUM_FRAGMENT_UNSATISFIED`, `OVERFULL_LINE` | The planner must not commit a fragment below its configured minimum or a line that exceeds its usable width. | The result violates the text-flow execution contract, not merely its visual preference. |

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

### Element proximity

The spacing report also exposes `element-proximity` observations. Each
observation identifies the measured `from` and `to` subjects (for example an
`intro` block and an insertion graphic), the signed vertical `gap`, the
configured `minimumGap`, the resulting `deficit`, required movement,
`movementBudget`, and whether the insertion has a declared movement capability.
`fluid-y` capacity alone does not imply a movable position: its bounded page
instances are currently materialized as concrete boxes. Movement is reported
available only when the plan contains a matching explicit movable insertion
frame.

The evaluator scores the deficit as `element-proximity` and publishes an
`ELEMENTS_TOO_CLOSE` suggestion with the pair identities and remediation. This
is advisory quality evidence, not a legality error. The evaluator never chooses
between moving and deferring, removes authored content, or mutates a plan.
Candidate generation must provide legal nearby-move and optional-insertion
reassignment alternatives; the composition engine then compares complete legal
plans by total score. Leaving a page capability unused must not discard the
source block: the block still needs a complete placement elsewhere in the plan.

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
| `element-proximity` | Pairwise gap deficit between an intro, insertion or other material element and a nearby peer | negative: summed deficit * `element_proximity_penalty` |
| `contrast` | Monte Carlo contrast measurements for every planned glyph cell, resolving the supplied page background and painted image graphics at each sample point with the glyph's own foreground color when available | continuous negative adjustment based on normalized measured quality; no binary plan failure |

A gap may be legal and caused by an immovable object, while still being
aesthetically unfavorable. Its cause remains in the evaluation details and
planner decisions; it does not waive the quality penalty.

## Origin of the weights

The first heuristic was created in the debug composition-score prototype. The
production weights were then moved to `render-config.yml` and extended in
later experiments with fragmentation, spacing, and orphan lines. The current
range — `base: 100`, `column_balance_weight: 12`, bonus `4`, penalties `3` and
`4`, spacing weights `1/1/1`, and contrast maximum penalty `6` — is a manually
selected working range.

Tests show that the components affect candidate selection, but do not yet prove
that the proportions are right for every article. Calibration requires a larger
corpus and comparison with human ratings. Do not change a weight without a test
showing which variant wins because of it.

## Observability

`CompositionEvaluation.scoreBreakdown` contains the value, points, and details
for every component. The engine trace records this for every candidate together
with insertion placements, status, hard-violation count, and `reflowPasses`.
Raster PDF/PNG is a separate artifact test; the evaluator does not decode
image bytes. When an injected asset adapter supplies a contrast assessment, the
evaluator records it in this component and converts measured ratios to a
normalized quality value. The current normalization is asymptotic. For
glyph-aware measurements, each glyph's sampled average ratio contributes to
the diffuse mean quality through `x = max(0, (averageRatio - 1) /
(targetRatio - 1))`, then normalizes with `x / (x + response)`. The response
comes from `composition_score.contrast_quality_response`, so finite ratios
never reach quality `1` and remain distinguishable above the target. Local
visibility does not use that average: the worst sampled point in each glyph
is normalized separately and drives the worst-point signal and the affected
glyph count. The final quality combines three continuous signals: mean glyph
quality, the quality of the worst sampled point, and the saturated breadth of
severely affected glyphs. Their weights are `contrast_mean_quality_weight`,
`contrast_worst_glyph_weight`, and `contrast_affected_glyph_weight`. This keeps
one nearly invisible glyph visible in a large corpus while still making ten
affected glyphs worse than one. `contrast_severe_ratio` defines severe damage
and `contrast_affected_glyph_saturation` controls the scale of the asymptotic
affected-glyph breadth term. The component contributes
`-contrast_penalty * (1 - quality)` to the general plan score. With weights
that sum to one, the penalty approaches but does not reach the configured
maximum for finite measurements. The evaluator uses each glyph's `minimumRatio`
for the local worst-point and affected-glyph terms, while the number of sampled
pixels is not multiplied into the score. Legacy line-box measurements use the
single normalized assessment quality. Unknown measurements remain visible but
neutral until a product policy gives missing evidence a calibrated cost.
Contrast never turns a legal plan into a rejected plan. A renderer supplies the
known page background even when there are no graphics, so the same mechanism
covers the complete text corpus. A uniform background normally gives every
candidate the same high-quality contribution; it still matters when a
candidate moves text across a colored or image-backed region.

The contrast adapter's raster is a representation of an image asset, not a
rasterized candidate page. It keeps the Monte Carlo point in continuous page
coordinates, then converts that coordinate to an integer source-pixel index
only when reading the asset color. Rasterizing the debug PDF happens afterward
for visual inspection and is not part of the score calculation.

The per-glyph frame used by this screening is deliberately a layout cell, not
an exact glyph mask: the measured character advance supplies its width and the
planned line height supplies its height. Monte Carlo offsets are continuous
values in `[-1, 1]` relative to the center of that cell. This makes the
measurement stable across renderer backends and inexpensive enough to use for
candidate ranking; it estimates contrast-risk probability rather than proving
the contrast of every painted pixel.
