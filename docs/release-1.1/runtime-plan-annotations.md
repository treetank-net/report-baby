# Runtime plan annotations

This document defines the runtime annotations that may accompany a
`CompositionPlan`. It is deliberately separate from the page-template
schedule decision in `02-layout-variants-and-continuation.md`: annotations
explain what the planner did, while the schedule and ordinary slots define
what the planner was allowed to do.

## Scope

Runtime annotations are observability data. They are produced while a plan is
being materialised and are consumed by diagnostics, debugging tools, and
tests. They must not become a second source of layout geometry or a hidden
input to legality checks.

The plan already has the following annotation surfaces:

| Surface | Purpose | Owner in the lifecycle |
| --- | --- | --- |
| `decisions` | Short event records explaining a planner choice or cursor move | planner |
| `diagnostics` | User-visible warnings and errors | planner and evaluator |
| `residualContent` | Content that could not be placed, with the reason and remaining range | planner |
| `trace.phases` | Phase and iteration timings/status | planning engine |
| `trace.blocks` | Per-block placement status, fragments, and decisions | trace builder |
| `trace.slots` | Materialised slot state and measured capacity | page/slot state |
| `trace.flowPlacements` | Flow-level summary of occupied route positions | trace builder |
| `trace.candidateSearch` | Candidate generation/evaluation summary | candidate search |
| `spacing` | Measured page, slot, and text-placement gaps | spacing reporter |

The annotation surfaces are optional from a renderer's point of view. A
plan-only caller may request a trace, while the PDF backend only needs the
placements and page geometry.

## Source context and construction

Decision records are created through `recordFlowDecision`, not by assembling a
synthetic object at every call site. The call site supplies the source context
that it already owns and a stable event name:

```ts
recordFlowDecision(context, eventName, runtime, target, reason)
```

The helper derives fields when they are available:

- `flowId` from `FlowPlanningContext`;
- `blockId` from `FlowTarget.block`, or from the runtime cursor's block index;
- `page` from `FlowTarget.currentPage` or the runtime cursor;
- `slotId` from the selected target definition;
- `routeIndex` from the selected target or the cursor;
- `reason` from the optional reason argument.

Missing context is valid. The helper omits fields that cannot be derived; it
does not require callers to manufacture placeholder values. The helper appends
the record to `context.plan.decisions` and returns the record for a caller that
needs to attach it to a trace.

No placement function should call `plan.decisions.push({ ... })` directly. This
keeps event shape construction in one place and prevents debugging fields from
leaking into the placement API.

## Annotation lifecycle

```text
preflight
  -> materialise a scheduled page and its ordinary slots
  -> reserve insertion/obstacle geometry
  -> place insertion flows and blocks
  -> place ordinary flow text and blocks
  -> record decisions, residuals, and diagnostics
  -> run reflow/evaluation
  -> attach spacing and trace summaries
```

The lifecycle has two distinct outcomes:

1. The planner records what happened while constructing a candidate.
2. The evaluator decides whether the resulting artefacts are legal.

`decisions` are therefore explanatory telemetry. A decision such as
`FLOW_SLOT_NOT_FOUND` may explain why a residual was produced, but the
evaluator must determine illegality from `residualContent`, placements,
collisions, page/template constraints, and diagnostics. Deleting or changing a
decision record must not turn an illegal plan into a legal one.

## Stable event rules

Event names should describe an observable transition, not an implementation
branch. The current planner uses names such as:

- `FIRST_LEGAL_SLOT_SEARCH` when a flow has not placed anything and the cursor
  advances to search a later scheduled page;
- `NO_ELIGIBLE_SLOT_ON_PAGE` when the current page has no matching ordinary
  slot;
- `MAX_PAGES_EXCEEDED` when an already-started flow crosses the candidate's
  page limit;
- `FLOW_SLOT_NOT_FOUND` when a flow cannot make its first placement before the
  candidate limit;
- `FLOW_CONTINUATION_FORBIDDEN` when a flow with an existing placement would
  need to cross a page boundary that its route forbids.

These names are not geometry. In particular, `continuation` remains a flow
policy (`allowed` or `forbidden`); there are no runtime annotations named
`continuation_frame` or `continuation_slots`.

The legacy `ResolvedReportPlan` response also has a boolean
`page.continuation` summary flag. It identifies pages after page one for
consumers of that older report-plan projection; it does not select a slot,
frame, or layout and is therefore not the source of composition geometry.

## Runtime annotations versus the public plan contract

The public plan must remain sufficient to reproduce placement and legality:

- `pages` identifies the selected `layoutId` and, when applicable, the
  `templateRef` selected by the page schedule;
- `slots` records the materialised ordinary slots and their state;
- placement collections record the actual boxes and page/slot ownership;
- `residualContent` records unplaced content;
- `diagnostics` records errors and warnings.

The trace and decision collections add explanations, not requirements. They may
be omitted, sampled, or disabled for production rendering, provided that the
same placement and evaluation artefacts remain available.

## Proposed extension point

If later work needs annotations that are not naturally part of the public
plan, add a separate optional object rather than adding ad-hoc fields to every
placement:

```ts
interface CompositionRuntimeAnnotations {
  decisions?: CompositionDecision[];
  phaseTimings?: CompositionPlanningPhase[];
  candidateSearch?: CompositionCandidateSearchTrace;
  notes?: Record<string, unknown>;
}
```

This object is suitable for a debug/plan-report response. It is not a source
for renderer geometry, and it is not accepted as document input. Before adding
it to the public MCP response, define retention, size limits, and whether
annotations are enabled by default.

## Acceptance checks

- Every decision-producing placement path calls `recordFlowDecision` rather
  than constructing an object inline.
- A plan with identical placements remains equally legal when decisions and
  trace data are disabled.
- An illegal plan remains rejected when decision records are removed.
- Page schedule selection is visible through `pages[].templateRef` and is not
  inferred from a continuation-specific slot or frame.
- Runtime annotation documentation stays separate from the completed layout
  schedule plan.
