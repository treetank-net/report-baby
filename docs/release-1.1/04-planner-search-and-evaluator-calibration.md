# Release 1.1 — planner search and evaluator calibration

Status: scope proposal; a decision on a full solver has not been approved.

## Why this topic is deferred

Release 1.0 has a bounded, deterministic pass: the planner prepares a variant,
the evaluator scores it, and selection operates on a finite candidate set.
There is not yet a safe basis for moving multiple insertions, breakpoints, and
blocks across every page at the same time.

## Candidates for 1.1

- optimisation of multiple moving insertions in one pass;
- explicit, bounded cross-page constraints;
- a possible global document solver, if a cost budget and deterministic stop
  criterion can be defined;
- moving `composition_search` policy into a typed configuration seam once it is
  part of the production contract;
- calibrating `composition_score` weights against a real editorial corpus;
- covering evaluator edge cases, especially orphans, fragments crossing slots,
  and adjacent obstacles;
- measuring full-planning cost and setting a reflow/search budget.

## Invariants

```text
generate bounded candidates
  -> plan each candidate completely
  -> reject hard violations
  -> evaluate legal candidates once
  -> choose the best legal plan deterministically
```

A high score cannot legalise collisions, lost words, or out-of-bounds geometry.
Reflow remains a cost of preparing a concrete candidate, not a separate quality
candidate.

Do not introduce unbounded search merely because a new solver can produce more
variants. Candidate count, rounds, and cost must be explicit, measurable, and
configurable.

## Acceptance criteria

- candidate order is deterministic;
- every candidate has a complete plan and at most one evaluation per round;
- an illegal variant cannot win through a better soft score;
- the log/trace shows candidate count, reflow, and the reason for selection;
- tests cover multiple insertions, no legal variant, and budget exhaustion;
- weight calibration is compared with human assessment, not only a numerical
  improvement;
- the current 1.0 path remains the default until the new solver has its own
  contract and regression gate.

## Sources

The scope comes from deferred items in the geometry, planner–evaluator loop,
scoring, and structural-continuity plans. This document does not change their
completed contracts.

## Implementation map

### What exists today

- `server/src/composition/layout/planner-candidates.ts` generates bounded
  cross-products and local refinement boxes for movable insertions and
  graphics.
- `server/src/composition/layout/insertion-planning.ts` and
  `insertion-placement.ts` measure and reserve insertion obstacles; they do
  not search globally.
- `server/src/composition/composition-engine.ts` evaluates initial candidates,
  optionally runs configured refinement rounds, and records a
  `CompositionCandidateSearchTrace`. `compareCompositionEvaluations()` already
  makes legality a hard gate before score comparison.
- `server/src/composition/evaluation/{evaluator,scoring,legality}.ts` supplies
  the evaluation and current score components. Some aesthetic evidence is
  already present, but it is not yet a complete optimisation objective.
- `composition_search` and `composition_score` values are read from
  `server/templates/render-config.yml` through
  `server/src/composition/adapters/render-config.ts`; candidate limits must
  remain bounded.

### Changes required

1. Freeze the evidence and suggestion contract from the shared 08–10
   workstream before adding new candidate dimensions. Every candidate must
   carry its originating placement window and deterministic signature.
2. Extend `planner-candidates.ts` with a bounded, declarative candidate source
   for multiple insertions and page ranges. Keep authored positions fixed when
   no movement window is declared; never synthesise a slot or move `main` into
   an insertion flow.
3. Keep complete-plan generation in the existing planner. Add a typed search
   budget (candidate count, rounds, full-plan recalculations, and wall-clock
   limit) to `composition_search` and stop with a trace reason when exhausted.
4. Keep selection in `composition-engine.ts`: evaluate each unique candidate
   once per round, reject hard violations first, then compare the calibrated
   soft score and stable candidate order. Do not add a second evaluator.
5. Calibrate weights in `evaluation/scoring.ts` against the editorial fixture
   corpus and record the corpus/expected ranking in a plan-only test. A weight
   change is a contract change, not an incidental refactor.
6. Add focused tests to `test-text-composition-engine.mjs`,
   `test-editorial-plan-contract.mjs`, `test-composition-page-limits.mjs`, and
   `test-dynamic-insertion-slots.mjs` for multiple insertions, no legal
   candidate, deterministic ties, and each budget stop reason. Keep one small
   backend artifact only for a selected-candidate rendering proof.

### Resulting ownership and dependencies

`layout/*` generates legal proposals, `composition-engine.ts` owns search and
selection, `evaluation/*` owns legality and score, and YAML owns limits and
weights. This item consumes the shared 08–10 metrics and precedes the visual
calibration candidate (07). Item 05 then measures the cost of the expanded
search without weakening coverage.
