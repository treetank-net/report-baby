# Plan 06 — planner maintainability

Status: implemented for release 1.0. `planFlow` has its own module and
responsibilities have been moved to domain seams. The current release harness
passes all 39 checks. Further work is targeted auditing, not mechanical LOC
splitting.

## Criteria review — 2026-09-08

The current inventory contains 404 named functions in 45 modules:

| Module | LOC | Functions | Responsibility |
| --- | ---: | ---: | --- |
| `composition/layout/flow-planner.ts` | 408 | 15 | One-flow orchestration; no measurement or keep policy. |
| `composition/layout/flow-text-decision.ts` | 588 | 25 | Explicit text-decision policy. |
| `composition/layout/document-layout.ts` | 310 | 14 | One document-plan lifecycle. |
| `composition/layout/movable-placement-validation.ts` | 51 | 1 | Frame and candidate-count validation. |
| `composition/layout/movable-placement-frames.ts` | 67 | 3 | Result-frame materialization. |
| `composition/evaluation/legality.ts` | 659 | 28 | Hard-legality contract. |
| `composition/evaluation/scoring.ts` | 441 | 18 | Quality scoring and named components. |

The seam-maintainability criterion is satisfied and the release gate is green
at 39/39. No known `EMPTY_FLOW_SLOT` failure remains in the current checkpoint.

## Completed responsibility seams

The responsibility map is maintained in
[`docs/composition/modules.md`](../composition/modules.md). Completed seams
include:

- movable insertion candidate generation and frame validation;
- word wrapping, available intervals, and continuation through flow barriers;
- `flowPlacements` projection and text regions around wrapped graphics;
- authored and generated glyph resolution against final frames;
- contrast-sampling cells for visible glyphs;
- block-to-slot compatibility and first compatible route-slot selection;
- next-insertion lookup and insertion boundaries;
- planning-trace projection and full-line capacity calculation;
- structured-block placement for tables and atomic blocks;
- the first `flow-planner.ts` boundary and flow-specific state;
- PDF text extraction, including the distinction between empty text and decoder failure.

The `createTextCompositionPlanner` interface is unchanged. The extracted seams
do not introduce a new domain entity or content type. A movable-placement module
receives existing proposals and movement policy and returns a constrained,
deterministic set of variants; it does not know the source domain of a proposal.

## Adapter and runtime ownership

`report-composition-entrypoint.ts` is an application adapter, not a second
planner or renderer. It combines normalized input, jsPDF metrics, capabilities,
policy, and the composition engine. PDF policy is mapped in `text-engine.ts`.

`report-composition-runtime.ts` combines assets, fonts, contrast, capabilities,
and backend state around the entrypoint. It does not make layout decisions.
Chrome and final artifact writing remain outside the composition planner until
the dynamic-chrome work is complete.

The composition entrypoint is the single documented planning seam. No legacy
alias or parallel renderer name should be retained.

## Maintainability decision

Large files are not automatically defects. A coherent domain may require a
large module; length is a review signal, not a split criterion. The accepted
sequence is:

1. Move complete existing functions to the owner of their responsibility.
2. Inspect call sites and identify exact or semantic duplicates.
3. Turn repeated manual calculations into named calculation functions.
4. Share a function only when the shared contract is real and testable.
5. Remove a duplicate only after one owner and its callers are explicit.

Splitting is a consequence of crossing a responsibility boundary, never the
goal itself. Do not move document operations into the cursor or create wrappers
only to reduce a line count.

Decision recording uses one seam. `recordFlowDecision` accepts the existing
`FlowPlanningContext`, event name, and optional `FlowRuntime` and `FlowTarget`
objects already held by the caller. It derives optional `flowId`, `blockId`,
`page`, `slotId`, and `routeIndex`. Callers do not construct a decision object
or repeat identifiers; they may provide only `reason`. Missing fields are
omitted rather than replaced with synthetic values.

After each extraction, regenerate the dependency inventory and verify that the
evaluator does not depend on a removed decision field. The dependency graph is
part of the refactoring evidence.

## Flow-planner responsibility map

Before migration, `flow-planner.ts` combined preflight, page limits, page
creation, slot selection, structural placement, text capacity, line selection,
cursor advancement, diagnostics, and residual content:

```text
document planning
  preflight and page limits
  current-page creation
  compatible slot selection
  structural placement: tables and atomic blocks
  text placement: capacity, lines, and cursor advancement
  diagnostics and residual content
```

The current orchestration is explicit:

| Question | Owner |
| --- | --- |
| Is a block compatible with a slot? | `route-slots.ts` |
| What space is occupied? | `flow-occupancy.ts` |
| How is a movable frame validated? | `movable-placement-validation.ts` |
| How is a result frame projected? | `movable-placement-frames.ts` |
| How are lines placed? | `text-placement.ts` and the text planner |
| How are graphics and barriers represented? | `graphic-planning.ts` and `flow-barriers.ts` |
| How are tables and atomic blocks placed? | `structured-block-placement.ts` |
| How is the final trace projected? | `planning-trace.ts` |

These modules share existing contracts. They do not create transient entities
merely to hold a text fragment or cursor state.

## Shared calculations and duplicate detection

Geometry primitives such as `rectBottom`, `rectsOverlap`, and horizontal-overlap
checks have one geometry owner. Slot occupancy and text capacity keep separate
named functions because their semantic questions differ. Do not replace them
with a generic `isAnythingColliding`: a graphic collision, occupied text slot,
and illegal insertion are different domain decisions and must remain distinct
in diagnostics and trace output.

If profiling shows that `previousBlockInSlot` repeatedly rebuilds a document-wide
map, add a cache only with an explicit lifetime and invalidation rule. It must
not alter placement order or observable decisions.

## Testing and completion criteria

Behavior is protected at the seam where it is decided:

- composition tests cover legality, placement, continuation, residuals, and
  diagnostics without requiring a PDF for every variant;
- one backend smoke test proves that an accepted plan can be materialized;
- editorial tests cover flow order, page creation, and continuation;
- PDF extraction is isolated from planner rules and scoring;
- the public entrypoint is one planning path, without a legacy alias;
- configuration thresholds have one owner and are not copied as literals.

Further work is explicitly outside release 1.0 unless a separate accepted
contract is introduced: mechanical LOC splitting, a global solver for all
movable insertions, a new entity for a transient text fragment, moving layout
decisions into a renderer or cursor, or a second composition entrypoint.

Further splitting of `planFlow` requires a behavior test and a clear owner for
the extracted responsibility. The decision must come from call sites and domain
contracts, not function length alone.

## Open follow-ups

- benchmark planner feedback and update the performance budget from host data;
- audit future style-capability seams without duplicating render-config values;
- revisit a module only when a new independent behavior contract appears;
- keep full visual and compatibility checks separate from the fast composition
  gate while preserving release artifact evidence.
