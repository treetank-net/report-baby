# Release 1.1 — implementation plan

Status: planned. Item 02 was implemented and released in 1.0.1. The remaining
items are implementation work for Release 1.1.

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
| [04](04-planner-search-and-evaluator-calibration.md) | deterministic bounded search over existing movable-placement policies | planned |
| [05](05-contract-cleanup-and-test-consolidation.md) | public-contract inventory and cheaper equivalent tests | planned |
| [08–10](08-composition-quality-diagnostics-and-optimization.md) | one evidence, diagnostic, scoring and candidate-comparison process | planned |
| [11](11-document-layout-contract.md) | one public document `layout`; removal of route-owned template selection | planned |

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
  -> select the best legal plan deterministically
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
2. **Composition-quality evidence and diagnostics (08–10, stages A–C).** Make
   the current spacing and placement facts complete and expose actionable
   diagnostics without changing candidate positions.
3. **Chrome content migration (03).** Materialize lockup/header/footer blocks
   through the normal flow path and remove renderer-authored content once all
   built-in page templates are classified.
4. **Paint order (01).** Normalize existing backend operations to explicit
   phases, preserving the old order as YAML configuration.
5. **Quality scoring and existing-candidate comparison (08–10, stages D–E).**
   Turn the measured facts into score components and prove the existing moving
   insertion path can select the better legal candidate.
6. **Bounded search expansion and calibration (04).** Add candidate dimensions
   only after their score/evidence contract is stable.
7. **Contract and test consolidation (05).** This is a final removal pass, but
   its inventory and timing checks run during every preceding item. Public
   behavior is not left unaudited until the end.

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
