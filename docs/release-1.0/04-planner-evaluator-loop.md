# Plan 04 — planner–evaluator loop

Status: functionally complete for the explicit 1.0 scope; candidate selection
and refinement are connected to normal rendering for explicit movable
insertions and graphics. Global feedback-driven rewrites remain out of scope.
Release evidence: the release harness passes 39/39 checks and the default
`npm test` passes 23/23 checks (2026-09-09). Multi-insertion/global solving and
full cost benchmarking remain follow-ups or 1.1 work.

## Goal

The planner and evaluator must cooperate when choosing a layout:

```text
planner prepares a variant
  → one-pass plan
  → evaluator scores it once
  → feedback reports legality and quality
  → planner prepares a bounded change
  → choose the best legal plan
```

This does not require an LLM conversation. “Conversation” means deterministic
transfer of an evaluation result to the next planner step.

## Current state

`createTextCompositionPlanner` exposes deterministic candidates for an existing
insertion proposal. The engine evaluates each candidate once, rejects illegal
variants, chooses the legal plan with the highest score and, on a tie, keeps the
earlier variant. After selection, the planner can perform one bounded local
refinement round around the best candidate, and the engine evaluates only that
finite list again. A single-plan path remains compatible with other planners.

This is evaluator feedback in a controlled form: the evaluator returns legality,
score and breakdown, and the planner uses the selected placement as the center
of a local range. It is not yet a global rewrite of all layout decisions.
Reflow remains a separate cost of preparing one candidate and is reported
separately in `reflowPasses`.

## Findings from the current mechanism

- Fixed slots `A/B/C` do not yet create a meaningful optimization space. With
  quote order preserved, selection is effectively greedy and deterministic.
- Candidates for a movable insertion are independent position alternatives in
  explicit bounds. They are no longer merely stabilization passes. Without
  `movableInsertionBounds`, the one-plan path or stabilization reflow remains.
- Reflow is needed only when an insertion position depends on earlier content or
  another obstacle. If a box already has a fixed legal position, one complete
  planning pass and one evaluation are sufficient.
- A real optimization experiment should describe, in the existing placement
  proposal, the preferred position, allowed bounds, measured size and alignment
  method. The planner can then generate a finite set of positions in those
  bounds, preferably aligned to the line grid, deduplicate them and evaluate
  every complete plan.
- Reflow remains an internal preparation stage for one candidate when that
  candidate has a text-dependent anchor. It should not itself be treated as a
  quality alternative.
- The first experiment is limited to one movable quote and a fixture with many
  small paragraphs. Measure the number of unique candidates, legality, reflow
  passes, score and a text-fragmentation measure. Considering multiple movable
  insertions is explicitly deferred to a follow-up/1.1 scope.

The experimental seam in the planner is `movableInsertionBounds`, keyed by the
same `flow:block` that already identifies the insertion. Each definition
contains `bounds`, an optional preferred position, an axis (`x` or `y`) and
`candidateCount`. The frame is the legal area, not the quote size: the planner
keeps the measured quote size and moves its rectangle so it fits entirely in the
frame. Each generated rectangle receives a separate complete plan. The selected
plan retains the frame in `movableInsertionFrames`, allowing the ordinary
composition debug output to draw it in red. In the first experiment all six
positions were legal, the `y` positions were `25, 37, 49, 61, 73, 85`, and the
reflow pass count was `0` for every candidate because the frame did not depend on
text. In the controlled movable-insertion fixture the engine generated five
coarse candidates and three refinement candidates. All were legal, and their
scores differed through balance, spacing and text fragmentation. In real
editorial content, moving the quote removed detected orphan lines and improved
the score relative to its fixed position; details are in the trace and in
`test-editorial-numbered-flow.mjs`.

Existing data that can seed the first candidate neighborhood:

- insertion proposals;
- route and slots;
- flow barriers and `flowBarrierBoxCandidates`;
- existing text breakpoints;
- growth/defer rules for elements that already have them.

### Search configuration

`composition_search` currently describes values used by tests and experiments to
construct `movableInsertionBounds`. The production planner does not read this
group from YAML; it receives policy through its interface. This is an
intentional but unfinished seam, not a reason for the planner to import
`render-config.yml`, and it does not expand the current 1.0 scope.

## Immediate priority: describe and run actual element movement

Before increasing the candidate count or moving multiple elements, describe
explicitly what may change for one concrete insertion. Do not introduce a new
entity. Use the existing block, its placement, box, related flow and existing
obstacles/barriers.

### What can be declared

| Area | Example declaration | What the planner checks |
|---|---|---|
| Position | “prefer this position, but allow up to 10 mm above or below” | generates positions in the specified range without leaving the bounds |
| Movement direction | only `x`, only `y`, or both directions | does not create variants in a forbidden direction |
| Attachment | the graphic’s bottom edge is attached to the area’s bottom edge; the quote is attached to the text start | preserves the stated relation in every candidate |
| Alignment | left, right or centered edge relative to a box/slot | changes only the permitted coordinate |
| Size | fixed width and height or a `min`–`max` range | rejects a variant outside the range; does not change a dimension that must remain fixed |
| Aspect ratio | fixed graphic ratio or independent width/height | preserves the ratio unless the user relaxed it |
| Padding | minimum and maximum content padding | the quote box is not smaller than its content and required padding |
| Text inside | width no smaller than the longest required word; height calculated from font and line count | remeasures and wraps text after a width change; disallows overflow or lost words |
| Flow impact | a graphic/quote box obscures a defined flow area | recalculates available text areas after every box change |

### What is already possible

The current code can, without changing the basic model:

1. take an existing insertion and measure its actual size;
2. determine its allowed bounds;
3. generate several deterministic positions on one axis;
4. keep the element entirely inside the bounds;
5. use its box as an obstacle for text;
6. recalculate the complete layout for each position;
7. reject illegal variants;
8. compare legal variants by score and select the best;
9. perform local refinement around the selected variant;
10. record position, score and recalculation cost in the trace.

This is the scope of the first production implementation. We do not yet assume
that the size of every element can be changed safely.

### What the current code does not guarantee

The following capabilities require separate tests and must not be added as loose
options without defining their effects:

- changing a text insertion’s width together with remeasuring its height;
- shrinking a box to the minimum dictated by font, padding and the longest word;
- maintaining attachment to an edge while changing size;
- moving simultaneously on the `x` and `y` axes;
- optimizing multiple insertions in one pass (follow-up/1.1);
- automatically deriving bounds from a relation to any other element;
- unbounded search across the whole page.

### Separating legality from appearance

The planner checks whether it can build a variant. The evaluator answers two
separate questions:

- does the variant violate a hard constraint, such as leaving the bounds,
  losing words or breaking a forbidden relation;
- if it is legal, does it look better than other legal variants?

Violating bounds, minimum text width, padding, aspect ratio or attachment is a
rejection. A larger gap, worse paragraph wrapping or poorer column balance stays
as negative points but does not reject the variant.

### Completion criterion for this priority

A production-render test must show the complete path: measured box → candidates
→ text re-layout → evaluation → selected PDF. The trace must also show which
positions were checked, which were rejected, which were accepted and why the
selected variant was best.

## Minimal implementation variant

1. Keep `planDocumentOnce()` as the execution of one variant.
2. Keep feedback bounded: the selected candidate and round number are the only
   feedback to local refinement. Do not make the evaluator responsible for
   mutating the plan.
3. Generate only deterministic variants of existing decisions. For the first
   experiment choose one case, preferably:
   - moving a graphic/quote relative to existing flow barriers; or
   - selecting a breakpoint when the next line reaches an obstacle.
4. Limit the number of variants and iterations with YAML values.
5. Deduplicate variants using the existing placement/proposal signature.
6. Evaluate each variant exactly once.
7. Reject hard violations before comparing scores.
8. Keep the best legal plan, not the last plan.
9. If there is no legal plan, return `rejected` with an aggregate diagnostic.
10. Record trial order, result, score and the reason for the next change in the
    trace.
11. Keep `page-fill-table` as a future controlled case for other insertions. Do
    not optimize the table, quotes and all flows simultaneously in 1.0.
12. Resolve the runtime source of `composition_search`. If it controls
    production search, add it to the typed render-config seam and pass it
    through the adapter to the planner policy. If it remains experimental,
    remove it from production `render-config.yml` or explicitly mark it as
    test-only so that configuration does not promise behavior that is not used.
    This seam is a follow-up and does not block the current 1.0 contract.

## Pseudoflow

```text
initial variant
  → planDocumentOnce
  → evaluate
  → record result
  → generate the next allowed change
  → repeat until there is no change, stabilization or a limit
  → return the best legal plan
```

At the beginning, do not change graphic positions, quotes, breakpoints, growth
and routing simultaneously across the whole document. Otherwise it will be
impossible to tell which decision improved or damaged the layout.

## Tests and completion criteria

- two legal variants select the variant with the higher score;
- an illegal variant cannot win through a high score;
- real insertion reflow and movable positions are observable separately;
- the trace reports `reflowPasses` separately for each candidate so selection
  cost can be measured before optimization;
- a boundary test distinguishes the first source-order rejected plan from the
  second plan accepted after moving the insertion;
- the iteration limit is respected;
- variant order is deterministic;
- one variant has exactly one evaluation;
- the trace shows every trial;
- real editorial content shows a visible, justified layout change;
- planning cost is exposed in the trace; benchmarking full editorial planning
  and setting a cost budget is a follow-up/1.1 item;
- a test shows that the difference between two legal variants comes from
  explicit evaluator feedback, not accidental drawing order;
- the `composition_search` policy source is unambiguous and tested; runtime has
  no configuration that it does not actually use;
- the release harness passes 39/39 checks and default `npm test` passes 23/23
  checks.

## Follow-ups after point X

- The global feedback scope requires a benchmark with multiple movable
  insertions. Experiment 1 intentionally limits itself to one quote. A
  multi-insertion/global solver is follow-up/1.1 work.
- Exact mapping of score components to planner decisions requires further tests;
  score breakdown, placements and trace are currently sufficient for 1.0.
- The cost limit requires a benchmark of a real editorial, not just the
  `planner_max_iterations` limit. This is follow-up/1.1 work.
- The runtime `composition_search` seam requires a comparison of global
  configuration cost with configuration for a particular insertion/template.

## Out of scope

We do not build a global solver, random search or allow an illegal plan as a
“least bad” fallback.
