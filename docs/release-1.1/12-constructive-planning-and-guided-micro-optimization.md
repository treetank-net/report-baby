# Release 1.1 — constructive planning and guided micro-optimization

Status: planned. This work is intentionally separate from items 08–10. Items
08–10 establish the evidence, scoring and repair-proposal machinery; this item
changes how the planner uses that machinery to avoid rebuilding a complete
document for every speculative placement combination.

## Goal

Build one legal document plan (or report that no legal plan exists) before
spending search budget on aesthetic alternatives. Once the document is legal
and has no critical composition defects, use evaluator findings to try a small
number of local improvements such as moving an insertion, reducing an orphan,
or omitting an explicitly optional block.

The final decision remains global: the complete document is re-evaluated and
the highest-scoring legal result is selected. This item changes candidate
generation and search order, not the legality contract or the global score.

## High-level model

```text
construct one legal baseline
  -> reject only when hard requirements cannot be satisfied
  -> identify critical composition defects
  -> request bounded evaluator-guided repairs
  -> materialize and evaluate only those local alternatives
  -> keep a strictly better legal plan
  -> stop at no improvement, minimum step, or configured budget
  -> perform final whole-document evaluation and render
```

Page-local construction may be used internally, but the planner must carry the
remaining flow cursors, insertion availability and next-page risk forward. A
locally attractive page must not be committed if it makes the following page
illegal or materially worse. A bounded beam of intermediate states is allowed
if a single greedy state is insufficient.

## Non-goals

- Do not remove the final whole-plan legality and score evaluation.
- Do not let the evaluator mutate plans or become a template author.
- Do not introduce a second public planner/evaluator service.
- Do not silently omit authored content; omission remains legal only when the
  input explicitly allows it.
- Do not make continuous global optimization a requirement for Release 1.1.

## Expected outcome

The common case should require one constructive planning pass and a small,
evidence-driven repair neighborhood instead of an exhaustive cross-product of
all insertion and graphic positions. Search trace output must explain which
baseline was accepted, which repairs were attempted, and why the process
stopped.

## Current implementation seams

The current engine deliberately materializes a complete plan for every initial
proposal combination. `layout/text-planner.ts` calls `planDocumentOnce()` while
mapping insertion/graphic combinations, and `composition-engine.ts` then calls
`evaluator.evaluate()` for every returned plan. Refinement repeats the same
pattern for every movement or omission proposal. This is the source of the
large per-candidate cost; PDF rendering is a later backend step and is not part
of candidate comparison.

The migration must keep these existing responsibilities:

- `insertion-layout.ts`, `graphic-planning.ts` and `planner-candidates.ts`
  describe possible placement changes;
- `document-layout.ts` materializes pages, slots, flows and placements;
- `composition-engine.ts` owns evaluation, comparison, refinement acceptance and
  the global calculation budget;
- `evaluation/evaluator.ts` owns legality, quality evidence, score and repair
  proposals;
- backends render only the selected accepted plan.

## Operational plan

### Stage A — measure the existing loop

1. Add optional trace timings around proposal generation,
   `planDocumentOnce()`, `evaluator.evaluate()` and each refinement round.
2. Keep timing disabled by default and expose it through the existing plan trace
   when explicitly requested; do not require an ad-hoc debug script.
3. Record generated, deduplicated, materialized and evaluated candidate counts
   separately. A generated proposal that is rejected before full planning must
   remain distinguishable from a complete plan.
4. Establish representative budgets for a short document, a multi-page
   editorial document and a document with many reusable insertion instances.

### Stage B — construct a baseline before broad search

1. Add a planner entry point that requests one deterministic seed proposal
   set, respecting authored hard page/slot/frame constraints and flow priority.
2. Materialize that seed through the existing `planDocumentOnce()` path.
3. Evaluate the seed once. If it is legal and has no critical composition
   findings, make it the baseline for Stage C.
4. If it is illegal, use only the smallest bounded set of corrective placement
   changes needed to satisfy hard requirements. Do not enumerate every legal
   insertion position at this stage.
5. If no bounded correction produces a legal plan, return the existing failure
   contract with hard diagnostics and remediation evidence; do not return a
   visually plausible but illegal plan.

The baseline gate must be explicit. “No critical findings” is a configured
severity/category decision, not a subjective shortcut. Terminal-page underfill
and other accepted soft warnings must not block baseline acceptance.

### Stage C — guided local repair loop

1. Pass the baseline evaluation to the existing refinement seam.
2. Convert only measurable, actionable evaluator findings into repair
   proposals: proximity, orphan/fragmentation, excessive empty region,
   insertion rhythm and similar existing quality families.
3. Materialize a candidate only after validating that its movement, omission or
   slot change is allowed by the input and template capability.
4. Evaluate candidates one at a time or in a small bounded batch. Each
   candidate remains a complete `CompositionPlan`; local estimates never
   replace the final global evaluation.
5. Accept a candidate only when it is legal and its total document score is
   strictly better, with deterministic tie-breaking preserved.
6. Repeat while a repair improves the selected plan and the configured round,
   geometry-step and full-plan budgets remain available.
7. Stop with a trace reason such as `no-improvement`, `minimum-step`,
   `critical-findings-cleared`, `calculation-budget` or `no-new-candidates`.

### Stage D — optional page-local construction

Page-by-page construction may be introduced only after the baseline and guided
repair path is correct. It must carry a state record containing the current
flow cursors, remaining insertion blocks, materialized slot usage, selected
template identity and a one-page lookahead summary. The record is an internal
optimization state, not a new public domain entity.

For each page, retain a small bounded beam of states when one greedy choice can
damage the next page. A state can be committed only when its next-page risk is
within configured limits. The final assembled document still goes through the
existing whole-plan evaluator.

### Stage E — remove exhaustive work from the common path

1. Stop creating the full insertion/graphic cross-product before a legal
   baseline exists.
2. Retain signature deduplication and calculation budgets as safety nets, not
   as the primary optimization strategy.
3. Cache immutable template geometry, text metrics, line wrapping and other
   facts shared by all local repairs. Cache keys must include every input that
   affects the fact.
4. Reject only provably dominated or no-op proposals before materializing a
   complete plan. A candidate must not be discarded merely because its local
   estimate is lower unless the upper bound cannot beat the selected score.
5. Keep full legality checks for every candidate that reaches comparison and
   one final full evaluation before rendering.

### Stage F — public trace and diagnostics

Extend the existing candidate-search trace rather than adding a second report
format. It must expose:

- baseline signature and evaluation status;
- number of proposals generated, pruned, materialized and evaluated;
- repair proposal identifiers and measured score deltas;
- per-round elapsed time;
- whether a page-local state was committed or retained only in the beam;
- the exact stop reason and remaining budget.

Compact CLI/MCP responses should expose the summary and highest-impact reason.
Full responses should retain the complete evidence needed to understand why a
candidate was not tried or why a repair was rejected.

## Migration and deletion list

- Preserve `planDocumentOnce()` as the complete-plan materializer during the
  migration; do not change its legality semantics in the first slice.
- Change `planCandidateRecords()` so the ordinary path produces a seed first
  and does not eagerly materialize every proposal combination.
- Change `planRefinedCandidateRecords()` to consume evaluator-guided repairs
  through the existing bounded seam, retaining configured movement policies.
- Keep `compareCompositionEvaluations()` and global score selection unchanged.
- Remove only the exhaustive initial-combination branch after replacement tests
  prove equivalent legal-plan behavior and bounded quality regressions.
- Do not delete `max_full_plan_recalculations` or refinement limits; they remain
  recovery safeguards and operational controls.

## Acceptance checks

The implementation is complete when:

1. A legal document with no critical findings is accepted after one baseline
   pass and does not trigger broad initial enumeration.
2. An illegal seed either reaches a legal plan through bounded corrective
   proposals or returns a clear unsatisfiable result.
3. A measurable evaluator finding produces only allowed local repair attempts,
   and a repair is retained only when the total score improves.
4. A repair that improves one page but creates an illegal next page is rejected
   by whole-plan legality.
5. The final plan score equals the selected evaluation score and remains stable
   under deterministic reruns.
6. Search trace and public CLI/MCP output explain baseline acceptance, skipped
   proposals, repair attempts and the stop reason.
7. Representative plan-only tests prove legality, orphan handling, insertion
   omission policy, page transitions and terminal-page underfill without
   rendering PDFs. One representative visual artifact remains for visual QA.
8. Timing evidence shows that the common path no longer materializes dozens of
   complete plans when no quality repair requires them.
