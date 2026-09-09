# Plan 03 — evaluator and score

Status: functionally complete for the current 1.0 scope; the hard gate,
configurable score and candidate comparison are implemented and verified by
experiment 1. The weights remain heuristics and require later calibration on a
corpus. Release evidence: the release harness passes 39/39 checks and the
default `npm test` passes 23/23 checks (2026-09-09). Weight calibration and
additional orphan edge cases are follow-ups, not 1.0 blockers.

## Goal

The evaluator must answer two separate questions:

1. Is the plan legal?
2. If it is legal, how good is its layout?

A hard violation always eliminates a plan, regardless of its score. The score
must not be a way to push through lost content, overlap or a placement outside
its frame.

## Current state

`CompositionEvaluation` contains `status`, `diagnostics`, `hardViolations`,
`score`, `scoreBreakdown` and `residualContent`. The evaluator checks
containment, overlap, order, coverage, graphics, tables, atomic blocks and
residual content. The score uses only plan data and the `composition_score`
configuration in `render-config.yml`.

A score prototype exists in
[`prototype-composition-debug.mjs`](../../server/scripts/prototype-composition-debug.mjs),
but it is not a production contract. The production evaluator reads only
`composition_score` from `render-config.yml`.

Planner-originated `severity: error` diagnostics are part of the same hard gate,
because the evaluator transfers `plan.diagnostics` into its result and rejects
a plan containing any error. The documentation test checks both evaluator
codes and codes emitted by `diagnostic('error', ...)` in the planner.

## Decision after experiment 1: score source

This is not a CSS standard, a W3C function, a statistical model or a result of
data calibration. It is an explicit, deterministic Report Baby product
heuristic derived from the earlier debug prototype and observations of actual
editorial artifacts. Its role is to order legal alternatives, not to declare a
document objectively “beautiful”.

The score is calculated as:

```text
base + sum of quality-component points
```

The current components are:

| Component | Measurement | Effect |
|---|---|---|
| `column-balance` | For multi-column pages, the average of `min(lineCount) / max(lineCount)` | positive, through `column_balance_weight` |
| `heading-following-line` | Number of headings followed by text in the same page/slot | positive, through `heading_following_line_bonus` |
| `paragraph-fragmentation` | Number of paragraphs split across different page/slot locations | negative, through `paragraph_fragmentation_penalty` |
| `orphan-lines` | Number of one-line paragraph fragments separated from the rest by a gap of at least `orphan_min_gap_mm`, when an obstacle causes the gap | negative, through `orphan_penalty` |
| `insertion-spacing` | Uneven insertion padding, gaps before/after it and the spread of those gaps between streams | negative, through three spacing weights |

All measurements come from plan geometry in millimeters. The evaluator does not
read a rasterized PDF, infer positions from an image or change the plan during
evaluation. Raster output belongs to a separate artifact test.

An important aesthetic decision: a gap can be completely legal because an
immovable obstacle is below it, while still lowering the score as an ugly gap.
The cause is recorded in `details.graphicId`/planner decisions, but it does not
cancel the quality penalty. Moving another element can change the gap, so a
legal cause is not an exemption from appearance scoring.

The weights `100`, `12`, `4`, `3`, `4` and `1/1/1` are an initial manually
selected working range. Experiment 1 shows that moving a quote changes the
result and that orphan and spacing penalties affect the choice, but this is not
psychovisual calibration and does not prove that the proportions are right for
every template. Therefore the configuration is versioned, and later weight
calibration requires a case corpus and comparison with visual assessments.

## Implementation rules

1. Extend the existing `CompositionEvaluation` with:
   - score;
   - score components;
   - explicit hard violations;
   - enough information to associate the result with a candidate.
2. Do not create a new domain model. If a technical variant identifier is
   needed, it belongs in the trace or evaluation result.
3. Do not append an `evaluation` phase directly to `plan.trace`. The evaluator
   returns data, and the engine assembles the trace.
4. Use this order:
   - hard gate first;
   - residuals and warnings next;
   - score the legal layout next;
   - deterministic tie-break last.
5. Keep quality components in YAML configuration. The current scope is column
   balance, heading-following, paragraph fragmentation, orphan lines and local
   insertion spacing. Hyphenation, empty places and further measures require
   separately observable definitions.
6. Do not add or change weights without a test showing which layout the weight
   changes. Experiment 1 satisfies this condition only for the current scope.
7. Define whether residual content is always a hard violation. Recommendation:
   yes for release 1.0.
8. Add regression cases where a plan is legal but may be unfavorable: a sparse
   final table page, an uneven local gap after an insertion and an unnecessary
   split between a heading and its first line. Do not automatically turn these
   into hard violations.
9. For every score component, document an observable measure and an example
   from `page-fill-table` or a real editorial. If a measure cannot yet be
   reliably derived from the plan, mark it as requiring completion rather than
   evaluating it from raster guesses.
10. Maintain the configuration-seam audit: `composition_score` belongs to the
    evaluator, fragment policy and tolerance belong to the planner adapter in
    the `pdf` group, and `quality` belongs to artifact controls. Every new field
    must have one owner and a documented interaction.

## Minimal selection contract

```text
legality
  → no hard violations
  → no residual content
  → higher score
  → stable tie-break
```

There is no universal, standard score for whole-document quality. This is a
Report Baby contract, so weights must be explicit, versioned and configurable.

## Tests and completion criteria

- the evaluator does not modify the plan or trace; the engine assembles the
  `evaluation` phase;
- legality and score are separate: a hard violation yields `-Infinity`,
  regardless of potential quality points;
- the comparator prefers a legal plan, then a higher score, and leaves an equal
  result to the stable tie-break described above;
- a legal plan with a lower score loses to a legal plan with a higher score;
- an illegal plan with a high score always loses to a legal plan;
- ties are deterministic;
- the breakdown explains where the score came from;
- evaluator documentation lists every active hard rule, its threshold and its
  rejection reason;
- the documentation test detects both evaluator hard rules and hard rules
  generated by the planner;
- the current editorial score can be read from JSON/trace/debug output;
- reevaluating the same plan produces the same result without new trace entries;
- the release harness passes 39/39 checks and default `npm test` passes 23/23
  checks.

## Follow-ups after point X

- Score weights require calibration on a larger editorial corpus and comparison
  with human assessment. The current values are an intentional heuristic, not
  a reference value; calibration is a follow-up/1.1 item.
- The hard-violation list requires completion after point 5 tests: every code
  needs a test case and a clear decision about whether it blocks the plan.
- The configuration-source → rule-owner matrix needs completion for remaining
  `pdf` fields that indirectly affect plan geometry through styles and
  capability adapters.
- Quality components for quotes, graphics and charts require completion after
  plan 07; do not assume them before common placements are defined.
- The orphan detector needs boundary cases for a natural paragraph ending, a
  fragment crossing different slots and several neighboring obstacles. These
  are follow-up/1.1 robustness cases, not new 1.0 scoring rules.

## Out of scope

We do not infer one objective function from W3C, nor optimize the whole document
without a cost limit.
