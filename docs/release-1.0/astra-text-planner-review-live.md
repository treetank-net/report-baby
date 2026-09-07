# Astra review: text planner and flow planner

Status: delegated review started.

This file is the live handoff log for Astra's read-only architectural review.
Luna records milestone reports here; Astra must not edit repository files.

## Review scope

- Decide how to refactor `server/src/composition/text-planner.ts` and
  `server/src/composition/flow-planner.ts` into a maintainable 1.0 design.
- Identify current architectural mistakes, responsibility leaks, accidental
  duplication, and risky migration steps.
- Produce a small, ordered implementation plan with tests and verification.

## Initial status

- The worktree already contains uncommitted user/branch changes. The review is
  read-only and must not revert or modify them.
- `text-planner.ts` imports `planFlow` from `flow-planner.ts`.
- `flow-planner.ts` still imports types and implementation details from
  `text-planner.ts`, so the current split may be a transitional seam rather
  than a clean ownership boundary.
- The project is moving toward flow-based composition for release 1.0, with
  planner/evaluator cooperation, movable insertions and graphics, and a
  maintainable renderer architecture.

## Progress reports

### Start — 2026-09-05

- Astra model: `gpt-6-astra`, reasoning effort: `high`.
- Delegated agent id: `01a07262-5de4-7ad3-b135-602af5a6d560`.
- Technical nickname assigned by the delegation runtime: `Lorentz`.
- Read-only review requested; no implementation delegated.
- Expected milestones: scope confirmation, dependency map, diagnosis,
  proposed sequence, final review.

### Interim report — Astra — 2026-09-05

**Scope accepted.** The decision concerns the architecture of the planner,
evaluator, and composition system for release 1.0.

**Reviewed:** the release-1.0 documents; `text-planner.ts`,
`flow-planner.ts`, `text-planner-candidates.ts`, `evaluator.ts`, `engine.ts`,
`model.ts`, `planning-trace.ts`, `text-engine.ts`; slot and structured-block
modules; and the contract, engine, oracle, page-limit, adapter, and module
documentation tests. The requested `test-report-composition-shadow.mjs` does
not exist; the harness uses other editorial/oracle tests. TypeScript and the
documentation test pass. The full artifact-generating test suite was not run.

**Confirmed dependency findings:**

- `engine.ts` is the main renderer-neutral seam: it obtains candidates,
  invokes the evaluator, rejects illegal plans, chooses a legal plan by score,
  and handles refinement.
- `text-planner.ts` owns graphic and insertion seeding, candidate planning,
  reflow, `planDocumentOnce`, page creation, plan normalization, trace, and
  the `planFlow` call.
- `flow-planner.ts` owns block order, cursor, slot routing, wrapping,
  insertions, graphics, tables, atomic blocks, slot growth, local reflow, and
  diagnostics.
- `flow-planner.ts` imports many runtime functions from `text-planner.ts`,
  while `text-planner.ts` imports `planFlow`; this is a real module cycle and
  an unclear ownership boundary.
- `text-planner-candidates.ts` is a sensible deep seam for deterministic
  positional variants; it does not know the document, evaluator, or renderer.
- `evaluator.ts` observes the complete plan, checks legality, and scores
  quality. Contrast remains a continuous score component, not a separate
  pass/fail result.
- Renderer and jsPDF are behind a capability/backend interface. Configuration
  is mapped through `text-engine.ts`, although the evaluator reads its own
  configuration groups directly.

**Diagnosis:** moving `planFlow` into a separate file was a technical
extraction, not yet a correct dependency direction. The flow planner still
controls or invokes document/page operations, including `ensurePage` and
growth/mutation of shared page state. The smallest safe next step is a
single-run document/plan owner that controls page lifecycle and exposes the
flow planner only a small page/geometry access interface. Only afterward
should the runtime `flow-planner -> text-planner` imports be removed. Astra
does not recommend another mechanical split, a new domain entity without a
need, or another wrapper around the existing wrappers.

**Read-only probes found:**

- A graphic policy with `candidateCount: 1` did not apply its declared
  position; the result stayed at the seed position.
- Refining one movable element resets the other inactive element to its seed
  position.
- Page layout depends on flow iteration order when flows have competing
  layouts.
- Configured `blockGap` between blocks in overlapping slots was not preserved.
- A stable insertion with `maxPlanningIterations: 1` reports
  `PLANNER_DID_NOT_STABILIZE`; with two iterations, two identical candidates
  are produced and the earlier one wins the tie.
- The evaluator accepted a plan with missing repeated text when the plan was
  manually marked with `repeatFlowIds`; whether this state is reachable in
  production remains to be checked.

**Unknowns:** full composition-gate behavior; impact on real editorial PDFs;
the intended contract for competing flow routes; and whether repeated flows
should be validated by the evaluator or guaranteed earlier. Astra did not
compare the full HEAD snapshot against the current state. She confirmed that
the extraction moved existing functions and changed, among other things,
`insertionSlotFor` and the former `occupiedBottom` helper.

**Remaining work:** define and test the small document-owner interface; move
page orchestration behind that seam; remove the runtime cycle; add separate
tests for the six findings; clarify the two insertion paths; update the module
map and documentation tests; then run `tsc`, the composition gate, the oracle,
and a manual real-editorial check.

## Focused follow-up: code reduction and reuse

Status: active follow-up; the previous report was interim, not completion.

- Target only: reduce lines of code and increase reuse in the planner/flow
  planner area without introducing imports as the reuse mechanism.
- Explicitly out of scope: broad architectural issues, full dependency
  redesign, evaluator changes, and unrelated correctness findings.
- Astra remains read-only. She emits short `REPORT_COMMENT` messages at each
  finding; Luna appends them here immediately.
- Runtime model configuration was changed to
  `model_reasoning_effort = "low"` in the personal Astra agent definition.
- Awaiting the first focused report comment.

### Follow-up correction — 2026-09-07

The previous focused report contained unresolved unknowns and must not be
treated as a completed review. Astra is being resumed to resolve them and to
cover the missing design question: how services, adapters, and data structures
should connect the planning, evaluation, selection, and refinement loop while
still reducing duplication and avoiding wrapper-on-wrapper abstractions.

### Focused interim report — Astra — 2026-09-07

**Scope accepted.** The review is limited to reducing duplication and line
count in `text-planner.ts` and `flow-planner.ts`. No files were edited and no
mutating commands were run.

**Confirmed:**

- `text-planner.ts` imports `planFlow` from `flow-planner.ts`.
- `flow-planner.ts` still imports many execution functions and types from
  `text-planner.ts`, so the split is transitional and has a confusing reverse
  dependency.
- `text-planner.ts` owns document, candidate, reflow, graphic, and line
  placement orchestration.
- `flow-planner.ts` owns flow cursor, slot selection and growth, collisions,
  and block traversal, but uses many text operations from `text-planner.ts`.
- `text-planner-candidates.ts` already contains sensible shared candidate
  logic for insertions and graphics; another wrapper is not needed.

**Concrete duplication candidates:**

- nearly identical `collapseUnusedInsertions` and
  `collapseInsertionBeforeContinuation`;
- nearly identical boundary validators for insertions and graphics;
- repeated computation of insertion candidate slots in two places;
- repeated `fit-content` computation for insertions;
- small, narrowly used `wordsOf` and `textOf` helpers;
- repeated `wordsForBlock(block)` calls inside one flow iteration.

A local data context in `planFlow` could reduce parameter count as a plain
object or closure. A new public entity or wrapper around existing wrappers
would add risk. Moving functions to another file alone is not a reduction;
do not create a generic geometry module or another shared planner now.

**Unknowns:** all external call sites of exported helpers have not yet been
checked; line-count diffs have not been measured per reduction; and tests were
not run, so there is no execution evidence for the current state.

**Next focused work:** order reductions from smallest and safest, assign exact
tests to each, define stop conditions if the diff does not shrink code or
changes diagnostics/behavior, and produce the final recommendation without
expanding scope.

### Immediate concrete comment — Astra

First concrete duplication: `flow-planner.ts` contains nearly identical
helpers `collapseUnusedInsertions` and `collapseInsertionBeforeContinuation`.
They can be combined into one local helper with a reason parameter while
preserving current diagnostics. Estimated reduction: approximately 12–20
lines, with no imports between the planners.

### Paused checkpoint — Astra — 2026-09-07

This is an interim report. The architectural recommendation and migration plan
are not complete.

**Read so far:**

- Full `text-planner.ts`, including proposal seeding, validation, insertion
  layers, page lifecycle, placement helpers, finalization, candidate
  generation, stabilization, and refinement.
- All 874 lines of `flow-planner.ts`.
- All functions in `text-planner-candidates.ts`, including rereading coarse
  position and refinement-box calculations.
- All 511 lines of `engine.ts`, including interfaces, comparison, rendering
  guard, selection, refinement, and evaluation trace.
- Complete `model.ts`, `planning-trace.ts`, and `text-engine.ts`.
- `evaluator.ts` legality, coverage, ordering, scoring, and orchestration;
  lines outside the later verified range still need uninterrupted coverage.
- Complete `release-1.0-flow-composition-plan.md` and substantive sections of
  `06-planner-maintainability.md` and this live report.
- Public exports and repository call sites, `report-composition-entrypoint.ts`,
  module documentation, package/test harness, selected template adapter and
  validation sections, structured-block placement interfaces, and relevant
  test assertions.

**Concrete architectural findings:**

- The runtime cycle is real: `text-planner` imports `planFlow`, while
  `flow-planner` imports numerous implementations from `text-planner`.
- `engine.ts` already owns candidate evaluation, legal-first comparison,
  stable tie-breaking, refinement rounds, and final selection. A second
  search/orchestration service would duplicate that responsibility.
- A per-candidate document-layout boundary is justified. It should own pages,
  page creation, insertion/graphic layers, shared slot geometry changes, and
  finalization. Flow planning should retain authored order, route progression,
  cursor, and local placement decisions.
- Shared text measurement and line placement can sit below both planners. This
  is a real transformation from measured wrapped lines into placements, glyph
  sampling geometry, and occupancy, not a forwarding wrapper.
- Existing `CompositionDocument`, `CompositionTemplate`, proposal maps,
  `PageState`, `FlowCursor`, `CompositionPlan`, `CompositionEvaluation`, and
  `CompositionPlanResult` cover most of the lifecycle. No replacement engine or
  new domain entity is justified yet.
- Existing input, template, jsPDF capability/backend, configuration, and
  report-runtime adapters already have useful boundaries. `text-engine.ts`
  owns PDF-policy translation; the evaluator still reads its own score/contrast
  configuration.
- Evaluation depends on planner decisions as evidence for legal route
  transitions. Diagnostic codes, fields, reasons, and ordering cannot be
  discarded just to shorten code.

**Behavior and reduction findings:**

- Page layout is established by whichever operation first creates the page;
  graphics, insertion reservation, and flows can participate.
- Ordinary flows run before repeated flows; each group follows document
  enumeration. An explicit competing-layout contract remains undecided.
- Repeated-text coverage checks only pages where that block already has lines.
  Ordinary-flow `startPage` validation is absent from the repeated branch. A
  start beyond the current document can mean no occurrence; exceeding template
  limits is a separate validation gap.
- Single-position generated candidates can be bypassed because generated sets
  are used only when a set has more than one member.
- Refinement starts from seeds, allowing inactive elements to reset instead of
  retaining selected positions.
- Stabilization compares against the previous derived signature, initially
  undefined, rather than immediately checking the current proposal set.
- The two collapse helpers can share a loop, but their payloads differ because
  only one currently includes `slotId`.
- Bounds validation, insertion-slot enumeration, and insertion fit measurement
  contain reusable calculations. Similar occupancy queries have different
  semantics and must not be merged blindly.
- No external callers of the flow occupancy exports were found inside the
  repository; consumers outside the repository remain unverified.

**Verification:** `tsc --noEmit --incremental false` passed. No files were
edited, no mutating commands or subagents were launched, and artifact-writing
suites were not run.

**Still outstanding:** final module/interface signatures; independently
verifiable repeated-flow expectations; complete evaluator read coverage;
ordered migration steps with exact tests and stop conditions; and defensible
line-count estimates distinguishing deletion from relocation. The page-layout
authority question is resolved below; its concrete `layoutForPage(page)` rule
and strict versus next-legal request types remain implementation details.

### Decision update — user clarification — 2026-09-07

The previously open question about competing page layouts is resolved at the
contract level. Layouts are not candidates selected by flow order or by the
evaluator. The initial document/template planning process defines the page
schedule and the requirements for each page. The normal rule is a first-page
layout followed by continuation layouts; exceptions such as a title page or a
page reserved for an advertisement are explicit template requirements.

The current `CompositionTemplate` is the closest existing carrier of this
contract: it comes from the compiled template and page geometry and contains
layouts, routes, `startPage`, and `slotsByLayout`. The page-management module
should expose `layoutForPage(page)` based on those data and any page
exceptions. This is a template/module contract, not a new runtime entity
spawned by the planner.

Flow planning supplies the reason for needing a page: remaining text,
continuation, an image or insertion requirement, or repeated page chrome. It
does not choose an arbitrary layout. `ensurePage` is an enforcement operation:
it must create a page only according to the page schedule and return a typed
error when a strict page/layout/slot requirement cannot be met. A separate
next-legal-page operation may skip a reserved page and create page 6 after
page 5 only when the requesting flow allows continuation and the schedule
declares page 6 legal for that need. A strict requirement for page 5 must not
be silently moved to page 6.

The effective authority is therefore separated as follows:

```text
template / layoutForPage -> page and slot requirements
flow planner             -> content-driven page need
ensurePage / scheduler   -> enforcement of the schedule
planner                  -> placement candidate within legal requirements
evaluator                -> final complete-plan legality check
engine                   -> legal-plan selection or no feasible plan
```

If the template requirements contradict one another, preflight should fail
before candidate generation. If the template is valid but no candidate can
place the supplied content, the engine must report that no feasible plan
exists; it must not present the first rejected candidate as a renderable
selection. The current evaluator marks such plans `rejected` and rendering
blocks them, but the engine result still needs an explicit no-feasible-plan
contract.

This resolves the intended page-layout policy, while the following details
remain implementation work: the exact `layoutForPage(page)` rule, strict
versus next-legal request types, preflight diagnostics, and tests for
title/first/continuation pages, reserved page 5, exact-page requirements,
and `maxPages` exhaustion.

### Scope correction — user decisions — 2026-09-07

The implementation target is narrower than the previous architectural
questions suggested:

- No new runtime entities are to be introduced for page planning or text
  fragments. The page-management module may expose `layoutForPage(page)` and
  enforce it from `ensurePage`; the page layout is a module responsibility and
  a template requirement, not an object with its own lifecycle.
- A plan is not a successful result when hard requirements are unmet. Only a
  candidate whose pages and placements satisfy the hard requirements may be
  considered legal. If no such candidate exists, the engine must report that
  no feasible plan was produced. Keeping rejected candidates for diagnostics
  is separate from selecting a plan for rendering.
- Quote insertion has one supported runtime path: quote blocks belong to a
  named non-`main` flow that declares insertion slots; those slots are planned
  and materialized before ordinary flow placement. The legacy path that placed `role: quote`
  blocks inline in `main` (including `routes.main.insertionSlots`) is removed.
  Public input and templates reject that shape; callers needing an insertion
  must provide a separate flow such as `quotes`.
- The target planning shape is one generation phase followed by evaluation.
  A possible later search over several distant, similarly scored starting
  candidates is outside the current work and has not been reached. Terms such
  as `previousSignature`, planner stabilization, and inactive refinement
  positions are current implementation details or exploratory findings, not
  accepted domain concepts or new responsibilities for the refactor.
- The goal is preservation of the current flow. Existing growth behavior,
  diagnostic functions, evaluator observations, and event payloads are moved
  without changing their meaning. `growSlot` remains the behavior to preserve;
  no separate invalidation policy is introduced at this stage.

### Current repeated-flow behavior — verified from code — 2026-09-07

Repeated flows are not currently attached to `ensurePage` at the moment a new
page is created. `planDocumentOnce` first materializes graphic pages and the
first page, reserves and places insertions, and plans all non-repeated flows.
Only then does it read `pages.length` and invoke each `repeat: 'each-page'`
flow once for every existing page, with `continuation: 'forbidden'`.

Consequently, ordinary flow growth determines the page count before the
repeated header/footer pass. A repeated flow normally does not create future
pages itself. If its `startPage` is beyond the already materialized page count,
the current loop can perform no invocation; validation of that case is an
existing gap identified by Astra. Moving repeated placement into page creation
would change this flow and is out of scope for the behavior-preserving split.

### Review scope clarification — 2026-09-07

Astra was asked for a read-only architectural review, so she was not expected
to generate code or commit an implementation. Artifact-generation gates and a
manual editorial PDF are verification steps for the later code migration, not
missing deliverables from the review. The immediate unresolved architectural
task is a single focused interface decision: define the smallest
page-management, flow-planner, structured-block, and text-placement seams that
preserve the current calls, mutations, diagnostics, and ordering. This must
be answered from the existing call graph before code is moved.

The agreed migration method is deliberately mechanical first: expand the
current large functions into named constituent functions without changing
behavior; map each function to its domain; move the unchanged implementations
to the appropriate modules; then run equivalence checks. No behavioral bug
fixes or planner redesign are part of that migration.

### Mechanical decomposition milestone — 2026-09-07

The first decomposition pass was applied on top of `cdb5cc6` without moving
modules or changing the planning contract:

- `planDocumentOnce` now delegates preflight, obstacle reservation, insertion
  placement, ordered flow planning, and final plan projection to named
  document-layout functions.
- `placeGraphicsForPage` delegates slot lookup, shape validation, bounds
  validation, placement construction, and per-graphic materialization.
- `placeInsertionLayer` delegates per-insertion target resolution, measuring,
  fit-content sizing, obstacle synchronization, and placement.
- `prepareTextPlacement`, heading-cluster probing, `placeLines`, and the
  insertion-slot reservation loop now expose their separate calculations as
  named functions with the existing target-module annotations.
- `collapseUnusedInsertions` and `collapseInsertionBeforeContinuation` were
  unified as one range helper with an explicit reason parameter.
- The duplicated insertion-slot enumeration and movable-frame validation are
  shared helpers. The type-specialized candidate wrappers in
  `text-planner-candidates.ts` remain public API adapters rather than being
  collapsed, because their signatures carry different proposal types.

The inventory after this pass reports no target-different function above 80
lines. The two remaining functions above that threshold are
`placeStructuredBlock` and `createTextCompositionPlanner`; both remain in
their current target file and were therefore not split under the agreed rule.

### Flow-planner decomposition correction — 2026-09-07

Historical snapshot from before the quote-path removal below; its
insertion-boundary and route-range statements are no longer active.

The follow-up pass is focused on the large functions that still lived in
`flow-planner.ts`, rather than expanding more of `text-planner.ts`:

- `planTextBlockAttempt` now only coordinates one text-placement attempt. It
  delegates capacity calculation, the keep/list/heading decision sequence,
  line selection, placement, insertion-boundary handling, and cursor advance
  to named functions. The decision sequence is annotated for the future
  `flow-text-decision.ts` seam; the orchestration remains in `flow-planner.ts`.
- `resolveFlowTarget` now delegates slot selection and target construction to
  named helpers, then performs only page preparation and route-range cleanup.
  An unavailable slot has an explicit `continue`/`stop` result type instead
  of pretending that it can produce a ready target.
- `handleNonTextFlowPlacement` now delegates collision pushing and unsupported
  inline-asset rejection before invoking structured placement. The structured
  placement call remains the flow planner's orchestration boundary.

The remaining `planFlow` and `createFlowPlanningContext` functions are
orchestration/context-construction functions of roughly 30–40 lines. Their
parts do not currently belong to different target modules, so splitting them
further would only add same-file indirection and would not advance the agreed
mechanical relocation. The refreshed inventory records each extracted
function's inputs, output, direct calls, and intended target module.

### Quote-path removal — 2026-09-07

The decomposition notes above are historical snapshots. The active
implementation now removes the inline quote path entirely: deferred quotes,
continuous quote obstacles, insertion-boundary routing, and optional quote
collapse decisions no longer live in `flow-planner.ts`. Quote text is
materialized only by a named non-`main` insertion flow. The template and input
contracts reject `routes.main.insertionSlots` and `role: quote` blocks in the
`main` flow, and the affected fixtures assert this rejection or use a
dedicated `quotes` flow.
