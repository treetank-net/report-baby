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
