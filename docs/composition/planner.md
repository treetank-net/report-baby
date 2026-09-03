# Composition planner

## Responsibility

The planner accepts a `CompositionDocument` with named flows and text metrics
and returns a complete `CompositionPlan`. It computes pages, slots, line boxes,
placements, obstacles, flow placements, decisions, and trace. It does not draw
the PDF and does not select a winner based on quality.

The main interfaces are in
[`composition/engine.ts`](../../server/src/composition/engine.ts), and the text
planner is in [`composition/text-planner.ts`](../../server/src/composition/text-planner.ts).

## Planning order

1. Preflight validates the input, template, flow roles, and available metrics.
2. The planner measures and reserves insertions and graphics that affect the
   available text area. Content dimensions must be known before collisions are
   computed.
3. Each flow is assigned a route through slots and page continuations.
4. `flowBarrierBoxCandidates` split an ordinary flow placement at the edges of
   a flow and an obstacle. Ordinary text wrapping consumes them; drawing a
   candidate in debug does not create a barrier by itself.
5. The planner lays out lines using measured font metrics, preserving word
   order, heading keeps, minimum fragments, and slot-transition rules.
6. Reflow is an internal pass that stabilizes one plan when a placement depends
   on previously computed content or an obstacle. Its count is recorded as
   `reflowPasses`.
7. The planner also registers empty and blocked locations so the evaluator can
   distinguish a natural flow tail from an illegal gap.

## Candidates and movable insertions

The default path produces one plan. Alternatives are generated only when the
policy contains `movableInsertionBounds` for an existing insertion proposal.
The frame describes the allowed area, not the element size. The planner:

- preserves the measured insertion size;
- generates a finite, deterministic list of positions on the `x` or `y` axis;
- keeps the element entirely within the bounds;
- preserves the preferred position as the tie-break and refinement reference;
- builds a complete plan for every position;
- may generate a local refinement neighborhood after evaluation selects the
  best variant.

`planCandidates` generates coarse candidates. `planRefinedCandidates` receives
the selected plan and round number, but cannot mutate the evaluator result. The
engine evaluates every variant and selects the best legal plan.

Experiment 1 used one movable quote, a configured vertical window, five coarse
candidates, and one refinement round with three candidates. This is not yet a
global search over all graphics, quotes, and breakpoints.

## Reflow and candidates

Reflow is not an independent quality criterion. It is the cost of preparing a
specific candidate. When an element already has a legal position and its
geometry does not depend on text, a candidate may require no reflow. When its
position depends on text or an earlier collision, reflow stabilizes that one
variant. The trace must distinguish the number of candidates from the number of
reflow passes.

## Planner guarantees

- text does not enter an obstacle;
- blocks remain in source order;
- insertions remain outside the ordinary route flow when the template declares
  them as a separate flow;
- every line uses geometry based on the same font metrics used by the renderer;
- the planner does not use score to force through an illegal plan;
- the trace describes stages, decisions, placements, barriers, and candidate
  attempts.
