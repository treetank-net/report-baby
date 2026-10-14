# Release 1.1 — implementation plan

Status: implementation checkpoint completed in 1.0.2 for items 04, 08–10 and
11. Item 15's coarse assignment and geometry rewards are implemented; broader
aesthetic calibration remains open (see its progress document). Items 01, 03,
05, 12 and 14 remain planned work for the later 1.1 release.

Release 1.1 changes existing procedural composition processes. It does not add
service classes or parallel planner/evaluator abstractions. New TypeScript
types and helper functions are introduced only when an existing data boundary
needs to become explicit.

## Scope

| Item | Deliverable | Status |
|---|---|---|
| [01](01-paint-order-contract.md) | explicit PDF paint phases while preserving the current default result | planned |
| [02](02-layout-variants-and-continuation.md) | page-template scheduling without `continuation_*` geometry | complete in 1.0.1; historical plan remains unchanged |
| [03](03-brand-lockup-and-legacy-chrome.md) | planned lockup/header/footer content and removal of implicit renderer content | planned |
| [04](04-planner-search-and-evaluator-calibration.md) | deterministic bounded search over existing movable-placement policies | implemented in 1.0.2; corpus maintained |
| [05](05-contract-cleanup-and-test-consolidation.md) | public-contract inventory and cheaper equivalent tests | planned |
| [08–10](08-composition-quality-diagnostics-and-optimization.md) | reusable insertion capabilities plus one evidence, scoring and iterative candidate-refinement process | implemented and verified in 1.0.2; representative artifact and public CLI/MCP evidence covered |
| [11](11-document-layout-contract.md) | one public document `layout`; removal of route-owned template selection | implemented in 1.0.2 |
| [12](12-constructive-planning-and-guided-micro-optimization.md) | legal baseline first, then bounded evaluator-guided local quality repairs | planned |
| [13](13-placement-policy-contract.md) | automatic content-progress distribution, cross-flow rhythm, visual-load balancing, cheap gravity relaxation and optional placement-policy overrides | implementation checkpoint: policy evidence, measured score components, bounded stable group assignment, source-relation legality and weighted gravity implemented; representative PDF accepted, mixed-flow calibration remains |
| [14](14-page-map-visual-verification.md) | post-materialization page geometry and rendered-PDF verification/calibration | planned; downstream of item 15 |
| [15](15-coarse-geometry-first-planning.md) | coarse global assignment and rectangle displacement before exact planning, with measured geometry rewards | bounded global assignment, break-aware projections and exact macro comparison implemented; article preferences pending — [progress](15-implementation-progress.md) |

Floats, RTL/CJK and broad visual calibration are deferred to
[`docs/release-1.2`](../release-1.2/README.md). Runtime planner telemetry has no
separate Release 1.1 task: existing `decisions`, `trace`, `diagnostics` and
`spacing` fields are changed only where an active item explicitly requires it.

## Process boundaries

The release keeps the existing execution model:

```text
request + brand + template catalogue
  -> normalize document input and document layout
  -> compile templates and materialize pages/slots
  -> generate a bounded set of placement proposals
  -> create a complete CompositionPlan for each proposal
  -> evaluate hard legality and content coverage
  -> calculate soft composition quality for legal plans
  -> select and locally refine the best legal plan until no better bounded
     candidate exists or the configured search budget is exhausted
  -> render the selected accepted plan
```

Ownership remains procedural:

- input and template adapters normalize external data;
- layout modules materialize pages, slots and placements;
- `composition-engine.ts` evaluates and selects complete candidates;
- evaluation modules decide legality and quality;
- backend adapters paint accepted placements;
- CLI and MCP serialize the same plan and evaluation.

## Implementation order

1. **Document layout contract (11).** Rename the public schedule, remove
   `route.layouts`, and make selected templates explicit per page. This removes
   the competing template-selection path before later work adds fields.
2. **Bounded-search safety slice (04).** Cap proposal counts, deduplicate
   equivalent signatures and expose search exhaustion before adding any new
   movement dimensions. This keeps the existing planner behavior while making
   its cost finite.
3. **Composition-quality facts and hard diagnostics (08–10, stages A–B).**
   Inventory structural versus content-sized template values, make spacing and
   obstacle evidence complete, and expose actionable hard failures without
   changing candidate positions.
4. **Chrome content migration (03).** Materialize lockup/header/footer blocks
   through the normal flow path and remove renderer-authored content once all
   built-in page templates are classified.
5. **Quality scoring and existing-candidate comparison (08–10, stages C–E).**
   Measure dynamic intro/chrome/insertion geometry, report pairwise proximity
   between material elements, turn the facts into score components and prove
   the existing moving insertion path can select the better legal candidate.
   This stage starts only after the chrome boxes it measures are part of the
   plan.
6. **Evaluator-guided iterative refinement (08–10, stage F — implemented).** Attribute score
   contributions to placements, derive repair proposals from measurable
   spacing/orphan evidence, generate bounded complete-plan alternatives, and
   continue refinement after incremental improvement until a local stop
   condition or the item 04 calculation budget is reached. Keep whole-plan
   legality and total score authoritative.
7. **Paint order (01 — planned).** Normalize existing backend operations to explicit
   phases, preserving the old order as YAML configuration. Implement this only
   where a concrete layering requirement exists.
8. **Contract and test consolidation (05 — planned).** The inventory and timing checks
   run during every preceding item; the final pass removes redundant tests and
   keeps one representative rendered-artifact check.
9. **Content-aware placement policies (13 — implementation checkpoint).** Replace ambiguous
    page-local `balanced` insertion handling with automatic content-progress
    distribution, mixed-flow visual-load balancing and page-local rhythm. Use
    the policy contract, source relations and complete-plan scoring as the
    foundation for the coarse estimator.
10. **Coarse geometry-first planning (15 — highest-priority composition
    follow-up).** Estimate the unobstructed main-flow body using aggregate
    rectangles, assign insertions across legal capacity, subtract their
    occupied spans and push text mass forward in one pass. Replace duplicated
    seed/gravity/reassignment stages, then seed exact line planning. Keep the
    exact plan/evaluator authoritative.
11. **Constructive planning and guided micro-optimization (12 — planned).**
    Use the coarse seed to materialize one exact legal baseline, then run
    bounded evaluator-guided page-local repairs. Preserve whole-document
    legality and score decisions.
12. **Page-map visual verification (14 — planned, downstream).** Compare exact
    planned geometry and selected rendered PDFs, and use the resulting evidence
    to calibrate coarse-estimate error. This remains a separate post-layout
    verification responsibility; it is not the initial placement model.

## Definition of ready for implementation

Each active document must contain:

- verified current symbols and behavior;
- fixed decisions and explicit non-goals;
- target data shapes and function boundaries;
- an ordered mutation sequence in which every stage builds;
- an explicit deletion/migration list;
- a requirement-to-test matrix using plan-only checks whenever sufficient;
- measurable completion criteria; and
- no unresolved decision hidden inside an implementation step.

If code inspection disproves a documented current-state fact, update the
active plan before implementing it. Do not modify the completed item 02; record
new work in the active item that owns it.
