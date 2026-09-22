# Release 1.1 — deterministic bounded placement search

Status: bounded search and corpus calibration are implemented in the 1.0.2
composition checkpoint. Fluid slot materialization is implemented; deriving
additional movement bounds from those capabilities remains follow-up work.

## Goal

Make the existing movable insertion/graphic search predictable and capable of
handling several declared movable placements without unbounded cross-product
growth. Calibrate the existing evaluator so its ranking agrees with an
explicitly reviewed editorial corpus.

## Fixed decisions

- Release 1.1 does not introduce a global document solver.
- Search changes only placements for which request/template policy supplies
  `MovablePlacementBounds`.
- A reusable `fluid-y` insertion capability derives those bounds from its
  selected page-template region. Content authors do not provide candidate
  counts or movement windows for ordinary insertions.
- A candidate is a complete set of insertion and graphic proposals from which
  the ordinary planner produces a complete `CompositionPlan`.
- The engine remains the only evaluator/selection loop.
- Hard legality and content coverage always precede score comparison.
- Search stopping is based on deterministic count/round budgets. Wall-clock
  time is recorded for observability but never decides which candidate wins or
  where search stops.
- The seed/authored proposal is always a candidate.
- Equal evaluated candidates preserve deterministic generation order.
- Item 08–10 defines the stable score evidence before this expansion lands.

## Current implementation

- `contracts/planner-policy.ts` defines a map of movement bounds with axis,
  preferred coordinate, candidate count and refinement settings.
- `layout/planner-candidates.ts` creates evenly spaced positions per movable
  item and incrementally expands the bounded product, truncating each
  dimension before another one is added.
- Initial and refinement batches are bounded by the typed global search budget.
- Proposal identity and document order are deterministic; repeated effective
  proposals are planned once per request.
- `composition-engine.ts` evaluates complete candidates only, applies legal-
  first ordering, and records budget/round stop reasons.
- General search limits and generic movable-placement defaults are loaded from
  YAML; no quote-specific production configuration is required.

## Target search policy

Use typed general settings under the existing `composition_search` group:

```yaml
composition_search:
  max_initial_candidates: <number>
  max_refinement_rounds: <number>
  max_candidates_per_refinement: <number>
  max_full_plan_recalculations: <number>
  max_page_local_refinement_rounds: <number>
  movable_window_ratio: <number>
  movable_candidate_count: <number>
  movable_refinement_rounds: <number>
  movable_refinement_candidate_count: <number>
```

Movement-window density remains part of each `MovablePlacementBounds`; the
global configuration limits combined work. Candidate and recalculation values
are positive integers; refinement rounds are non-negative integers. They are
validated in `adapters/render-config.ts`. The movable defaults are shared by
insertion and graphic fixtures; a deliberate authored placement may still
provide an explicit `MovablePlacementBounds`.

Extend planner policy without introducing an object-oriented solver:

```ts
interface CompositionSearchBudget {
  maxInitialCandidates: number;
  maxRefinementRounds: number;
  maxCandidatesPerRefinement: number;
  maxFullPlanRecalculations: number;
}
```

Pass it through `TextCompositionPlannerPolicy` to the existing candidate
functions and engine configuration.

The page-template adapter materializes each fluid insertion capability into a
bounded, deterministic set of page-local slots after the selected region is
known. Explicit `MovablePlacementBounds` still control candidate movement;
the search does not silently invent additional movement windows. Alternative
width or column forms are separate named slot capabilities, so the search can
combine a finite capability choice with a bounded position choice instead of
sampling an arbitrary continuous width.

## Candidate identity and order

Introduce a proposal signature, not a serialized-plan signature. It contains
every selected movable item sorted by stable document order:

```text
kind:id@page:slot:x,y,width,height
```

Stable document order means flow declaration order, block order inside a flow,
then graphic declaration order. It is calculated from `CompositionDocument`;
lexical IDs are only the final tie-break for malformed duplicate ordering.

The generator operates as follows:

1. start with the unchanged seed proposal;
2. enumerate each item's unique positions with preferred/authored position
   first, then increasing distance from it, then coordinate;
3. combine items in stable document order;
4. after adding each dimension, deduplicate by proposal signature and truncate
   to the configured initial/refinement limit;
5. never construct the full unbounded cross-product before truncation.

This is a deterministic beam over declared coordinates, not a global solver.
It does not invent pages, slots or movement bounds.

## Planning and evaluation loop

Refactor the existing loop procedurally:

```text
generate unique proposal batch
  -> skip signatures already evaluated
  -> stop before exceeding max_full_plan_recalculations
  -> build one complete plan per remaining proposal
  -> evaluate each plan once
  -> retain legal-first best using existing comparison
  -> refine only around the selected legal proposal
  -> stop on no improvement, no candidates, round limit or calculation budget
```

Extend the planner candidate return boundary with one data record:

```ts
interface CompositionPlanCandidate {
  signature: string;
  plan: CompositionPlan;
}
```

`planCandidates()` and `planRefinedCandidates()` return these records. The
single `plan()` fallback is wrapped with the fixed signature `seed`. The engine
keeps a map from signature to planned/evaluated result for the current request.
The cache is request-local and is not a new service.

Update trace stop reasons to the closed set:

```ts
type CompositionSearchStopReason =
  | 'no-movable-placements'
  | 'no-new-candidates'
  | 'no-improvement'
  | 'round-limit'
  | 'calculation-budget';
```

Trace records generated, unique, skipped, planned, legal and selected counts
per round plus selected proposal signature. `planningTimeMs` remains telemetry.

If budget is exhausted, selection uses only completely planned/evaluated
candidates. A partially prepared candidate is never returned. If none is
legal, the normal rejected result is returned with search-exhaustion evidence;
the engine does not render the best illegal candidate.

## Calibration corpus

Add `server/scripts/fixtures/composition-ranking-corpus.yml`. Each entry names:

- an existing deterministic fixture builder;
- two or more proposal variants;
- hard legality expected for every variant;
- a human-reviewed best-to-worst ordering;
- the quality reasons that justify the order.

Initial corpus families:

1. quote movement avoiding an isolated line;
2. image movement balancing two columns;
3. fit-content insertion leaving avoidable empty space;
4. two movable insertions whose individually best coordinates conflict;
5. legal aesthetic candidate versus aesthetically attractive illegal one;
6. exact tie preserving stable order.

Calibration changes YAML weights only. A test evaluates every corpus entry and
requires the configured scorer to produce the approved ordering. The corpus
does not assert an arbitrary absolute score. Any changed ranking requires a
human-reviewed corpus update in the same commit.

## Implementation sequence

1. Land stable evidence/scoring from item 08–10.
2. Add the corpus with current rankings and mark mismatches before changing
   weights.
3. Add typed search-budget loading while retaining old generator behavior.
4. Add stable movable-item order and proposal signatures.
5. Include the seed and preferred positions explicitly; deduplicate positions.
6. Replace full cross-product construction with bounded incremental expansion.
7. Pass proposal signatures into the planner result used by the engine.
8. Add request-local evaluated-result reuse and calculation-budget stopping.
9. Update trace fields/stop reasons and CLI/MCP full diagnostics.
10. Calibrate YAML weights against the approved corpus.
11. Keep proposal signatures as the sole candidate identity and delete any
    obsolete complete-plan serialization signature code.

Every step runs plan-only tests before the next. Rendering is unchanged until
the final selected plan reaches the existing backend.

## Files changed

| File | Responsibility |
|---|---|
| `contracts/planner-policy.ts` | movement bounds and count budget types |
| `contracts/engine-contracts.ts` | proposal identity and search trace fields |
| `adapters/render-config.ts` | validate/map YAML search values |
| `layout/planner-candidates.ts` | ordered, bounded proposal enumeration/refinement |
| planner entrypoint | associate proposal signature with complete plan |
| `composition-engine.ts` | request-local dedup, budget and selection |
| `evaluation/scoring.ts` | existing score formulas; calibrated weights only |
| ranking corpus fixture | approved relative expectations |

## Test matrix

| Requirement | Proof | Target test |
|---|---|---|
| seed is always included | pure proposals | `test-text-composition-engine.mjs` |
| enumeration is deterministic | repeated pure generation | `test-text-composition-engine.mjs` |
| cross-product never exceeds cap | three-item policy, no PDF | `test-dynamic-insertion-slots.mjs` |
| duplicate proposals are planned once | engine counters | `test-text-composition-engine.mjs` |
| every stop reason is reachable | synthetic planner/evaluator | `test-text-composition-engine.mjs` |
| illegal plan cannot win | plan-only evaluator | `test-structure-scoring.mjs` |
| approved rankings hold | corpus runner, no PDF | new ranking-corpus test |
| selected plan renders unchanged | one selected candidate PDF | `test-editorial-parity.mjs` |

## Completion criteria

- No candidate batch exceeds its configured cap.
- No proposal signature is fully planned more than once per request.
- Same input/configuration produces identical candidate order, winner and stop
  reason independent of machine speed.
- Search never moves content lacking explicit bounds and never creates slots.
- Every ranking corpus case matches its human-reviewed order.
- Full diagnostics expose candidate counts, signatures, scores and stop reason.
- Routine search/calibration tests do not render PDFs.
