# Composition — canonical documentation

This directory describes the current production composition model. It is the
source of truth for module responsibilities, planning, evaluation, and the
reasons behind decisions. Release plans describe work sequencing; research
describes historical investigations and does not replace these documents.

## Pipeline

```text
CompositionInput → flows → planner → CompositionPlan → evaluator → renderer
```

The planner computes a complete plan before drawing. The evaluator checks
legality and then the quality of legal variants. The renderer executes the
selected plan and does not make after-the-fact text-flow decisions.

## Documents

- [Planner](planner.md) — inputs, planning stages, flow barriers, insertions,
  candidates, and refinement.
- [Evaluator](evaluator.md) — the hard gate, scoring, configuration, and
  result observability.
- [Configuration](configuration.md) — documented quality, search, scoring,
  and composition-linked PDF fields, including their interactions.
- [Module map](modules.md) — ownership, interfaces, dependency direction, and
  the current planner/evaluator/renderer seams.
- [Decisions](decisions.md) — why the system has this division of
  responsibilities and which trade-offs were accepted.

## Update rule

Changing a contract, stage order, scoring method, legality rule, or geometry
source requires updating the relevant document in this directory and the
implementation plan that delivers the change. A test and a code comment may
clarify behavior, but they must not be the only place where a rule is described.

Every new block kind or insertion type must be added to the input → measurement
→ placement → collision → evaluation → rendering map before its support is
considered stable.
