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
