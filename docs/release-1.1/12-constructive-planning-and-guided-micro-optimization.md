# Release 1.1 — constructive planning and guided micro-optimization

Status: implemented and validated for stages A–G. This work is intentionally separate from items 08–10. Items
08–10 establish renderer-neutral evidence, score attribution and repair
proposals. This item changes how the planner schedules complete-plan work so
that those mechanisms replace broad speculative enumeration in the common
path.

## Handoff status

The implementation stages are complete and safe to maintain under the guardrails
below. Stage G is a required bounded refinement phase, not a second planner or a
permission for an unbounded rewrite:

**Handoff gate: green for stages A–G.** The
full composition gate is green, and the ranking corpus asserts planner-level
coverage for all six reviewed ranking families. No further implementation
checkpoint is required for the required plan.

- Stage A instrumentation is active: the plan trace records planning,
  complete-plan materialization, proposal-generation remainder,
  initial/total-evaluation and refinement timings, complete-plan counts,
  repair attempts, and evaluator subphases for contrast, legality, spacing
  evidence and scoring/repair proposals. The ranking corpus now asserts
  planner-level reachability or precedence coverage for all six reviewed
  families.
- Stage B is active in production: the text planner materializes one baseline
  before requesting quality alternatives. The previous eager candidate seam is
  retained only for compatibility tests and oracle comparisons.
- Stage C now has one bounded legality path: `INSERTION_PLAN_MISSING`,
  `INSERTION_SLOT_NOT_FOUND` and `INSERTION_OVERFLOW` diagnostics identify an
  affected insertion block, and the planner compares only compatible alternate
  slots (or an explicitly allowed omission). Unsupported hard diagnostics stop
  recovery and remain visible.
- Stage D has reachability-backed insertion actions: orphan and element-
  proximity findings may propose relocating an insertion to another unoccupied
  compatible slot. The engine evaluates the complete relocated plan and keeps
  it only when it is legal and scores higher. Relocation estimates are typed
  separately from line-step orphan recovery. An illegal incremental baseline
  cannot fall through to the quality-repair path.
- The candidate-search trace now exposes an explicit stop reason, remaining
  calculation budget and whether untested alternatives remain. This is the
  first public-search explanation slice; compact responses now also identify
  the highest-impact unresolved finding.
- Stage E now compares one baseline per permitted document-layout variant,
  refines only the best legal baseline, and retries illegal variants only until
  a legal result is found. The selected trace retains the variant identity.
- Normal report/MCP responses now expose a compact candidate-search summary;
  full diagnostics retain the complete candidate and repair trace. The public
  contract test passes in the host execution environment.
- Normal report/MCP quality summaries now expose the highest-impact unresolved
  hard diagnostic or quality penalty, including its measured score impact and
  available remediation when the evaluator produced one. This keeps the first
  actionable problem visible without requiring a debug script.
- The composition gate passed 19 checks in 136.811 seconds outside the
  sandbox, and `npm run build` passed. The selected quality fixture improved
  from `68.67750670038448` to `89.97015307987077` after bounded repairs.
- Evaluation timing samples are idempotent: reevaluating an already traced
  plan does not append duplicate timing entries or mutate its trace. This was
  required by the editorial plan contract and is covered by the full gate.
- The ranking-corpus harness now has nine planner-level reachability or
  precedence fixtures covering all six reviewed ranking families:
  `quote-movement-improves-distribution` starts from one baseline (`94.25`),
  evaluates bounded insertion moves, and keeps the improved legal result
  (`100`) after eight complete candidates; `image-movement-improves-columns`
  moves a graphic from the baseline score `101.5` to `102.25` after three
  complete candidates; `fit-content-reaches-compact-envelope` verifies that
  the actual planner shrinks the compact insertion envelope to `5` units in a
  one-baseline run; `illegal-insertion-recovers-to-compatible-slot` starts
  rejected and selects the later compatible slot after two complete
  evaluations; `stable-order-preserves-equal-score-baseline` and
  `legal-first-rejects-attractive-illegal-alternative` cover tie and
  legal-first precedence with real document/template plans. The production
  coupled fixture covers the conflicting-insertion rhythm family.
- The planner now materializes a bounded pair of independent move proposals
  when the evaluator exposes them. The named coupled fixture proves the
  scheduler path: each single move scores `-1`, while the paired complete
  candidate scores `10`; the pair is selected and both proposal identifiers
  remain in the trace. A production score-model fixture additionally improves
  from `63` to `83` while each single distribution repair remains below the
  pair. This proves the bounded engine seam, not a universal claim that every
  production score conflict needs a pair.

Stage G page-local refinement is now active. The ranking-corpus
harness now includes nine planner-level reachability or precedence fixtures in
addition to its renderer-free evaluator oracle cases. A focused engine-contract fixture now records parity between
the eager oracle and the incremental winner, but it is not a substitute for
the real ranking corpus. The gated quality-fixture oracle
(`COMPOSITION_QUALITY_ORACLE=1 node scripts/test-composition-quality-e2e.mjs`)
recorded 48 legal eager candidates with a best score of
`87.25029694891285`; the guided path evaluated 23 complete plans and reached
`89.97015307987077` through evaluator-directed repairs. This is evidence that
the guided path reaches and improves on the old eager candidate set, not proof
of a global optimum. The renderer-free movable-insertion fixture provides a
second, cheaper oracle: seven eager candidates had a best score of `96.7`,
while the guided path evaluated three complete plans and retained a score of
`100`. Stage C currently covers only the three insertion diagnostics listed
above; it is not a general legality solver. That bounded scope is intentional
and is not permission to infer actions from unsupported diagnostics.

The ranking corpus now records one approved oracle winner for each of its six
reviewed cases and all 13 compared variants. The winners are `balanced` for
quote movement, image balance and conflicting insertion rhythm; `legal` for
hard-legality precedence; `first` for the deterministic tie; and `compact` for
fit-content envelope waste. The output includes each variant's score and
negative components; the only intentional equal-score case is the stable-order
tie. These remain evaluator-ranking oracles, while the reachability suite now
checks the corresponding structural behavior for every reviewed family using
real document/template plans or an explicit engine precedence fixture. It also
records the production coupled case (`63` to `83`) and insertion legality
recovery.

The coupled fixture demonstrates a case where two individually non-improving
repairs must be applied in the same refinement round. It uses the real planner
candidate materializer and engine trace with both a typed scheduler fixture and
a production score-model calibration case: the latter improves from `63` to
`83`, while each individual repair remains below the paired result. This
justifies the bounded pair seam but not a general beam or an unrestricted
cross-product. The quality fixture also demonstrates sequential refinement of
two independent insertion relocations: the second round starts from the first
round's improved incumbent and raises the score again.

## Handoff safety decision

The required plan is safe for maintenance and bounded follow-up work, not for
an unbounded rewrite. Any future agent must preserve the following guardrails:

- keep the eager generator callable as a test-only oracle until every migrated
  fixture has a recorded before/after winner;
- keep legality recovery and quality repair as separate phases, with unsupported
  diagnostics stopping search rather than being converted into guessed actions;
- keep every new candidate bounded by the configured budget and template/input
  capabilities, and report search exhaustion separately from proven
  unsatisfiable constraints;
- put new budgets, tolerances and regression thresholds in
  `server/templates/render-config.yml`, not in scripts or planner code;
- stop the checkpoint if an approved winner becomes unreachable, a legal score
  regresses outside the configured tolerance, or the public trace loses the
  reason and remediation for an unresolved finding.

The handoff is green for the required stages: all six reviewed ranking
families, the incremental baseline, legality recovery, bounded coupled repair,
layout-variant scheduling and public trace are covered by the current gate.
Stage G is required for every normal quality-search run that has page-local
refinement rounds available. A report-only path may still set its existing
one-recalculation budget; that is an explicit caller budget, not an alternate
planner algorithm.

### Immediate handoff scope

No additional implementation checkpoint is required for stages A–G. A future
agent must not add a beam,
request-local caching, a new planner service/domain entity,
or a second diagnostics format. It must not delete the eager test oracle or
change evaluator weights as a substitute for missing evidence. Request-local
caching remains a separate, optional performance experiment and is deliberately
outside Stage G until a safe cache key is demonstrated.

## Goal

Materialize one deterministic baseline first. If it is illegal, explore a
small diagnostic-directed structural neighborhood until a legal incumbent is
found or the configured search budget is exhausted. Once a legal incumbent
exists, use evaluator findings to explore only plausible quality improvements.

The final decision remains global: every comparable candidate is a complete
`CompositionPlan`, hard legality is evaluated before score, and the selected
result is the best legal plan actually evaluated within the configured search
budget. The planner must not claim that no legal plan exists merely because a
bounded search did not find one.

## Current evidence

The representative composition-quality scenario currently spends almost all
of its time before backend rendering:

| phase | complete plans | observed time |
|---|---:|---:|
| seed planning and evaluation | 8 | 5.57 s |
| movable planning and evaluation | 49 | 22.85 s |
| comparison-template planning and evaluation | 8 | 5.45 s |
| selected PDF rendering | 1 | 0.12 s |

The earlier eager movable run generated 47 initial candidates and two
refinement candidates; only 19 initial candidates were legal, and its selected
result was candidate 14 with score `87.25029694891286`. The current guided run
generates 23 complete candidates across the baseline and two repair rounds and
selects score `89.97015307987077`. This proves both parts of the problem:

- reducing complete-plan recalculations is the dominant performance lever;
- accepting the first legal candidate without a quality-reachability strategy
  can lose a materially better structural arrangement.

The current run exposes evaluator-directed relocation and movement proposals
for orphan and fragmentation findings, and the selected fixture improves after
two sequential repair rounds. The proposal vocabulary still does not cover
every finding that may distinguish a seed from a desired result: empty regions,
fit-content waste, delayed main flow, distribution, narrow text, header/footer
spacing and column imbalance remain diagnostic-only until a legal action is
defined and demonstrated by a reachable fixture.

These values are a dated baseline, not production thresholds. Any numeric
budget or regression tolerance introduced by the implementation belongs in
`server/templates/render-config.yml` and must be loaded through the existing
configuration seam.

The latest host run of the composition suite passed all 19 checks in `136.811 s`.
The targeted ranking-corpus command, including temporary bundling, took about
`11.9 s` in the latest run. The harness prints the remaining per-suite timings
on each host run; this document intentionally records only the stable total and
the ranking-corpus measurement here, because CPU throttling made individual
suite timings vary between runs. Complete planning/evaluation remains the
dominant cost. Stage G now bounds that work by page-scoped repair proposals
while retaining complete-plan lookahead; request-local caching is still a
separate experiment.

## Fixed invariants

- `composition-engine.ts` remains the only search, evaluation and selection
  loop. Do not add another orchestration service.
- Page-local refinement is a scope of the existing loop, not a second planner.
  Every page-scoped candidate is materialized and evaluated as a complete
  document before it can become the incumbent.
- The evaluator reports legality, evidence, score attribution and possible
  actions. It does not mutate plans or author template capabilities.
- The planner materializes only actions permitted by the input and selected
  page templates. It does not invent a slot when no capability exists.
- A legal candidate becomes the incumbent even when it has serious quality
  findings. Those findings start quality repair; they do not make the plan
  illegal unless an existing hard contract says so.
- A quality repair wins only after complete-plan legality and score evaluation.
  Local estimates prioritize work but never replace measured global results.
- Authored content is omitted only when the input explicitly allows omission.
- Deterministic generation order remains the tie-break for equal evaluations.
- The production result means “best evaluated legal plan within budget”, not
  “global optimum”.

## Search phases

```text
materialize one deterministic baseline
  -> evaluate hard legality
  -> if illegal: generate diagnostic-directed structural corrections
  -> stop with a legal incumbent or an honest search-exhaustion result
  -> if legal: generate evaluator-directed quality repairs
  -> evaluate bounded single and compatible coupled repairs
  -> keep the best legal incumbent and continue from it
  -> stop at no improvement, minimum step, or configured budget
  -> reuse the selected whole-document evaluation if the plan stayed immutable
  -> render only the selected plan
```

Legality recovery and aesthetic optimization are deliberately separate. An
illegal evaluation currently has no score and no `repairProposals`, so quality
refinement cannot also be the mechanism that discovers a legal plan.

## Implementation execution contract

This document is not authorization to implement every optional idea in one
change. An implementation agent must work through the following checkpoints in
order and must not skip a failed checkpoint:

1. **Checkpoint A — evidence only.** Implement Stage A without changing
   candidate generation, selection, scores or public legality. Record the
   before-state oracle results and timings in the test output or a focused
   implementation note.
2. **Checkpoint B — incremental baseline.** Add the incremental planner
   contract and execute one baseline, while retaining the old exhaustive path
   as a test-only oracle. Do not delete or rewrite quality repair logic in this
   checkpoint.
3. **Checkpoint C — legality recovery.** Support only hard-diagnostic families
   that have an explicit machine-readable affected placement and a legal
   correction action. An unsupported diagnostic stops candidate generation for
   that cause and remains visible in the result; the agent must not infer an
   action from prose.
4. **Checkpoint D — quality refinement.** Route existing repair actions through
   the incremental loop, then add relocation or a coupled repair only when a
   named reachability fixture fails without it. Sequential multi-round repairs
   are already permitted; they must not be confused with a same-round pair.
5. **Checkpoint E — layout variants.** This is a separate implementation slice.
   Do not change `planReportComposition()` variant scheduling in the same change
   as the baseline/repair migration unless the user explicitly requests the
   combined scope.
6. **Checkpoint F — public explanation.** Before removing the production
   exhaustive path, expose the incremental phase, attempts, outcome, highest-
   impact unresolved finding and stop reason through the existing CLI/MCP
   quality response. Do not create a second diagnostics format.
7. **Checkpoint G — mandatory page-local refinement.** Process the current
   incumbent page by page using a bounded scope and full-plan lookahead. Keep
   request-local caching outside this checkpoint until a separate timing and
   cache-key decision is approved.

At every checkpoint the agent must report:

- files and internal contracts changed;
- generated, materialized and evaluated complete-plan counts;
- exhaustive-oracle and guided-search winners with legality, score and
  signature;
- targeted tests run and any verification not run;
- whether the next checkpoint is still justified by the new measurements.

The agent must stop instead of improvising when:

- the guided result cannot reach the approved oracle winner;
- a previously legal fixture becomes illegal or content coverage changes;
- the proposed action requires a slot or movement capability absent from the
  input/template;
- a hard diagnostic lacks typed evidence identifying the affected placement;
- a new public concept, service or persistent domain entity appears necessary;
- a change would retain two production search paths for compatibility;
- the requested checkpoint would also require Stage E or G work.

The exhaustive implementation may remain callable from tests, but production
must have one search path after the migration gate passes. Existing unrelated
planner refactors, evaluator formula changes and score-weight calibration are
outside this task.

## Operational plan

### Stage A — create the performance and quality oracle

1. Add optional timings for proposal generation, complete-plan materialization,
   spacing-evidence construction, legality evaluation, scoring/repair proposal
   construction and each search round. The current slice records all of these
   plan-level and evaluator-level timings; any further split must preserve
   deterministic reevaluation.
2. Record proposed, deduplicated, materialized, evaluated, legal and selected
   counts separately. Do not call a proposal a candidate plan before
   `planDocumentOnce()` has materialized it.
3. Expose these timings and counts through the existing plan trace and normal
   CLI/MCP quality output when requested. Internal scripts may verify the
   fields, but users must not need an ad-hoc debugger.
4. Preserve the current bounded exhaustive generator as a test-only oracle
   while the new scheduler is introduced. For the ranking corpus and selected
   editorial fixtures, record the oracle winner, score, legality, proposal
   signature and complete-plan count.
5. Add reachability assertions in addition to score-ranking assertions: the new
   strategy must be able to reach the approved structural winner, not merely
   score it correctly after a test constructs it manually.

The first implementation slice ends here if timings show that a different
phase, rather than repeated complete planning, dominates a representative
request.

### Stage B — materialize exactly one baseline

1. Reuse `seedInsertionProposals()` and `seedGraphicProposals()` to create the
   deterministic authored/earliest seed. Do not call
   `seedInsertionProposalCandidates()` for the baseline.
2. Materialize that seed once through `planDocumentOnce()` and evaluate it
   once.
3. If it is legal, store it as the incumbent and proceed directly to quality
   repair. Quality findings do not cause broad initial enumeration.
4. If it is illegal, pass the evaluation and proposal signature to Stage C.
5. Keep stabilization passes inside the single materialization semantics. A
   stabilization pass is not a competing document candidate.

This stage does not require a new public planner. The internal planner contract
must become incremental because the current `planCandidatesWithSignatures()`
returns an already materialized array before the engine can inspect the first
evaluation.

### Stage C — recover legality with affected structural alternatives

1. Define a machine-readable mapping from hard diagnostic evidence to the
   placement or route that can change it. Human `message` and `remedies` text
   must not be parsed to drive search.
2. Generate corrections only for the affected flow/block/graphic. Initially
   supported structural actions are:
   - select the next compatible materialized slot or page-template capability;
   - leave an optional reusable capability unused while preserving its content
     for a later compatible capability;
   - move inside declared bounds when the hard diagnostic is geometric;
   - omit only an input-authorized optional block.
   The first implementation slice may consider only
   `INSERTION_PLAN_MISSING`, `INSERTION_SLOT_NOT_FOUND`,
   `INSERTION_OVERFLOW`, `GRAPHIC_SLOT_NOT_FOUND`,
   `GRAPHIC_BOX_OUTSIDE_SLOT`, `LINE_OVERLAP` and
   `LINE_GRAPHIC_OVERLAP`. Even for these codes, a correction is generated only
   when the diagnostic identifies the affected authored element and the
   input/template exposes a compatible target or movement capability. All
   other hard diagnostic codes remain visible and unsupported by automatic
   recovery in this slice.
3. Materialize one correction at a time in deterministic order. If two
   diagnostics implicate interacting elements, also generate a bounded set of
   compatible paired corrections instead of restoring the whole cross-product.
4. Stop structural recovery when a legal incumbent is found and the current
   bounded correction batch has been compared. Do not keep enumerating every
   legal position before quality evaluation starts.
5. Distinguish these outcomes in the public result:
   - `constraints-unsatisfiable` only when a finite relevant capability space
     was exhaustively checked or a static constraint proves impossibility;
   - `search-budget-exhausted` when untested legal alternatives may remain;
   - ordinary hard diagnostics when the input/template itself must change.

The existing evaluator returns no repair proposals for illegal plans. This
stage therefore requires either typed correction hints on hard diagnostics or
an affected-placement correction function in the planner. It must not be
described as reuse of the existing quality-repair list.

### Stage D — improve a legal incumbent through guided quality repairs

1. Build and test an explicit support matrix from score component to legal
   action. The current implementation covers movement for proximity, symmetry,
   spacing rhythm, fragmentation, orphan and glyph overlap, relocation for
   insertion proximity/orphans, distribution movement for movable insertion
   capabilities, plus authorized omission. It does not yet directly repair
   empty regions, fit-content waste, delayed main start, narrow text
   intervals, header/footer spacing or column imbalance.
2. Extend the existing `CompositionRepairProposal` action union only where a
   measured finding and template capability justify an action. The first
   missing structural action is relocation to another compatible slot/page;
   it is not equivalent to moving inside the current frame or omitting content.
3. Rank proposals by estimated gain, then materialize a small bounded batch.
   Preserve `repairProposalIds` so every candidate can be traced to its causes.
4. For a conflict between two elements, consider the three basic alternatives
   already identified by the quality model: move the first, move the second,
   or omit either one only when omission is authorized. When neither individual
   move improves the score but a compatible pair is predicted to do so,
   materialize the bounded pair as one candidate.
5. Evaluate every materialized candidate completely. Replace the incumbent
   only with a legal, strictly higher-scoring result; preserve stable order on
   ties.
6. Continue from the improved incumbent until there is no measured
   improvement, all proposed steps fall below the configured minimum, no new
   signatures remain, or a round/calculation budget is reached.
7. When a negative finding has no supported legal action, retain it in public
   output with ownership and remediation. Do not silently treat lack of a
   proposal as lack of a problem.

A small bounded frontier of complete legal candidates may be retained if the
calibration corpus proves that greedy single-incumbent refinement misses an
approved coupled result. Add it only with such evidence; do not introduce a
general beam pre-emptively.

### Stage E — coordinate page-template layout variants

`planReportComposition()` currently expands document-layout variants outside
the engine and runs a complete engine search for every resulting template.
Candidate reduction inside one template can therefore still be multiplied by
the number of layout variants.

1. Materialize one baseline for each explicitly permitted layout variant.
2. Compare legal baselines globally using the existing legal-first evaluator
   order.
3. Attempt legality recovery for illegal variants only while no legal baseline
   exists, or when hard requirements make that variant mandatory.
4. Refine only the best legal layout baselines allowed by a configured budget.
   Preserve a distinct variant when its evidence shows a repair opportunity
   that the current best template cannot express.
5. Keep the selected template identity in proposal signatures and trace output
   so candidates from different layouts cannot be deduplicated accidentally.

This is scheduling over existing page-template variants. It does not add a new
layout domain concept.

### Stage F — expose the complete search explanation

Extend the existing candidate-search trace rather than adding a second report
format. It must expose:

- baseline proposal signature, template identity, legality and score when legal;
- proposal, materialization, evaluation and legal counts per phase;
- hard-diagnostic correction actions and whether they were materialized;
- quality repair identifiers, affected placements, estimated gain and measured
  score delta;
- per-phase and per-round elapsed time;
- the selected incumbent after each improving round;
- exact stop reason, remaining budget and whether untested alternatives remain;
- whether failure means proven unsatisfiable constraints or bounded-search
  exhaustion.

Compact CLI/MCP responses expose the outcome, highest-impact unresolved
finding, stop reason and page scope for each recorded refinement round. The
current response slice selects the first hard
error when a plan is illegal, otherwise the largest negative score component
and its matching evaluator suggestion. Full responses retain the evidence
necessary for an LLM or user to change the input or template without writing a
debug script. A richer diagnostic-impact ranking remains possible only if the
score calibration needs it; this slice does not claim that a penalty alone
proves which repair is globally best.

### Stage G — page-by-page micro-optimization with full-plan lookahead

Stage G is the mandatory final refinement phase after the baseline is legal (or
legality recovery has exhausted its bounded corrections). The engine derives the
ordered page numbers from the current incumbent and processes them one at a time:

1. call the existing evaluator-directed quality seam with
   `{ kind: 'page', page }`;
2. generate only movement, relocation, omission or line-recovery proposals that
   affect that page; a relocation is in scope when either its source or its
   destination page is the current page;
3. materialize every proposal as a complete `CompositionPlan`, reflowing the
   whole document and evaluating legality, score and next-page consequences;
4. accept only a legal strict score improvement, retain the resulting full-plan
   incumbent, and continue with the next page;
5. stop the current page when no improving candidate remains, then advance rather
   than reopening an already stabilized page.

The page is a search scope, not a partial document that can be accepted without
lookahead. A locally attractive move that creates a later orphan, overflow,
forbidden continuation or other hard violation is rejected by the same complete
plan evaluator as every other candidate. The next page starts from the full
incumbent selected after the previous page, so page boundaries remain observable
without freezing stale geometry.

The implementation uses the existing `CompositionPlanner` and
`CompositionEngine` seams. `CompositionRefinementScope` is the only new
contract; the quality method accepts it as an optional final argument. The text
planner filters evaluator repair proposals and authored movable-placement
neighborhoods by that scope. The engine records the scope on each search round
and shares the existing `maxFullPlanRecalculations` budget across baseline,
legality, page-local and global refinement candidates.
`composition_search.max_page_local_refinement_rounds` controls the bounded rounds
per page and defaults to one in the render config.

The global quality-repair rounds remain after the page passes for repairs whose
evidence genuinely spans pages. They use the existing document scope and do not
create a second optimization service. Request-local measurement caching remains
optional and is deliberately outside Stage G until a separate timing experiment
proves a safe cache key.

Acceptance evidence for Stage G includes:

- a trace round carrying a page scope for every page with configured refinement
  budget;
- a reachability fixture proving a page-local proposal is materialized and
  improves the complete score;
- a scope fixture proving a proposal belonging only to another page is not
  generated during the current page pass;
- a regression fixture proving that an apparent page improvement is rejected
  when its full reflow makes a later page illegal;
- the ordinary build and composition gate, with no renderer required for these
  planner-level assertions.

## Minimal contract changes

The current planner API eagerly returns arrays of already materialized plans.
That prevents the engine from evaluating the baseline before requesting more
work. Replace that internal boundary with three explicit incremental
operations rather than adding another service or an open-ended `request`
record:

```ts
interface CompositionPlanner {
  planBaselineWithSignature(document, metrics): CompositionPlanCandidate;
  planLegalityCorrectionsWithSignatures(
    document,
    metrics,
    selected,
    rejectedEvaluation,
    round,
    remainingBudget,
  ): CompositionPlanCandidate[];
  planQualityRepairsWithSignatures(
    document,
    metrics,
    selected,
    legalEvaluation,
    round,
    remainingBudget,
    scope?: { kind: 'document' } | { kind: 'page', page: number },
  ): CompositionPlanCandidate[];
}
```

The engine owns when each operation is called, signature deduplication,
complete evaluation, budget accounting and incumbent selection. The legality
method must receive a rejected evaluation and the quality method a legal
evaluation; this distinction must be represented in validation or types rather
than inferred from score values.

During migration, existing batch methods may delegate to the new operations in
tests. Remove the production eager-array path once oracle comparisons pass;
backward compatibility inside the repository is not a reason to keep two
search algorithms.

## File-level implementation map

| File | Required change |
|---|---|
| `composition/layout/text-planner.ts` | split deterministic baseline materialization from diagnostic/quality repair materialization; stop eagerly planning the initial cross-product |
| `composition/layout/insertion-planning.ts` | expose affected-block compatible-slot alternatives lazily and preserve authored order/content |
| `composition/layout/planner-candidates.ts` | retain signatures and bounded movement helpers; add only affected and compatible paired proposal composition |
| `composition/layout/document-layout.ts` | keep `planDocumentOnce()` as the complete-plan materializer; add timings around its existing phases without changing legality |
| `composition/composition-engine.ts` | interleave baseline planning, evaluation, legality recovery and quality refinement; own budgets and the incumbent |
| `composition/evaluation/evaluator.ts` | preserve legal-first evaluation; expose actionable hard-diagnostic correction data or pass it to the planner without parsing prose |
| `composition/evaluation/repair-proposals.ts` | publish the supported score-to-action matrix in code and add evidence-backed relocation/coupled repairs where required |
| `composition/contracts/engine-contracts.ts` | update the incremental planner/search trace contracts and distinguish unsatisfiable constraints from search exhaustion |
| `composition/report-composition-entrypoint.ts` | schedule baselines and refinement across existing document-layout variants without multiplying full searches blindly |
| `interfaces/mcp/responses.ts` | expose concise and full search outcomes through the normal product response |
| `templates/render-config.yml` | own all new numeric budgets, tolerances and any oracle regression threshold |

## Migration sequence

1. Land Stage A timing and oracle evidence without changing candidate selection.
   The timing slice now records `document-materialization` entries on each
   complete plan and aggregates them in `candidateSearch.phaseTimings`.
2. Add incremental planner methods and make the engine evaluate exactly one
   baseline before requesting another candidate.
3. Implement legality recovery for one affected insertion/graphic at a time and
   add honest exhaustion outcomes.
4. Route existing evaluator repairs through the incremental engine loop.
5. Add relocation and the smallest evidenced coupled-repair case needed by the
   corpus.
6. Coordinate layout variants through the same baseline-first policy.
7. Compare every migrated fixture with the eager oracle and public trace.
   The engine contract now proves this parity on a focused three-candidate
   fixture, and the quality fixture records a gated 48-candidate comparison;
   the ranking corpus now records all six reviewed winner families plus the
   planner-level reachability and precedence evidence.
8. Remove the production exhaustive initial-combination path.
9. Run the mandatory page-local refinement pass and record its scoped rounds in
   the public trace. Remeasure before accepting any request-local cache design.

## Acceptance checks

1. A legal document without actionable negative findings performs exactly one
   baseline materialization and one evaluation. Rendering reuses that result;
   reevaluation is required only if a later step mutates the selected plan.
2. An illegal baseline either reaches a legal plan through an affected bounded
   correction or reports search exhaustion without claiming impossibility.
3. The new strategy reaches every approved winner in the existing ranking
   corpus and the new search-reachability cases.
4. On fixtures where the old exhaustive oracle is retained, the selected legal
   score does not regress beyond the configured test tolerance. The tolerance
   defaults to exact parity until a human-reviewed exception is recorded.
5. The representative movable editorial case materially reduces complete-plan
   evaluations from its recorded 49-plan baseline while retaining the approved
   legal quality result.
6. A quality finding produces only actions allowed by its placement and
   template capability; unsupported findings remain visible and actionable.
7. A coupled repair can improve two interacting insertions without restoring
   the unrestricted cross-product.
8. A repair that improves one page but makes another page illegal loses under
   complete-plan evaluation.
9. Multiple document-layout variants do not each trigger an unrestricted
   refinement search before their baselines are compared.
10. Repeated deterministic runs produce the same signatures, incumbent
    sequence, winner and stop reason.
11. Public CLI/MCP output explains baseline status, attempted corrections,
    quality repairs, rejected candidates, unresolved findings and the exact
    stop condition.
12. Routine legality, reachability and ranking tests remain plan-only. One
    representative selected artifact remains for visual review.
