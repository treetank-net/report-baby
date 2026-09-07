# Composition decisions and rationale

This document answers “why does the system work this way?”. A rule remains in
force until it is changed here, in the implementation plan, in code, and in a
test.

## One flow model

Content is passed as named flows and ordered blocks. The planner decides routing
and geometry, the evaluator decides legality and quality, and the renderer
executes the plan. We do not return to the old flat `ReportData`/`Cursor`,
because they did not describe multiline planning, collisions, and controlled
reflow together.

## Hard gate before quality

Illegal overlap, lost content, wrong order, or a placement outside its frame
must not win merely because other parts of the page look good. Hard violations
are therefore decided before scoring, rather than represented as very large
negative penalties.

## Obstacles outside ordinary flow

A quote, graphic, or future KPI can be a separate insertion. Quote content is
always owned by a named non-`main` flow; `main` is reserved for the primary
text and cannot declare insertion slots. The insertion's measured box is an
obstacle for text, but its text does not become ordinary-flow lines. This
allows the element type to change without rewriting column-text mechanics.

## Flow barriers as shared continuation areas

`flowBarrierBoxCandidates` are rectangles created where ordinary flow meets an
obstacle. They explicitly show where text may legally continue before or after
the obstacle. They are not another template slot or another barrier merely
because they were drawn in debug.

## Movable insertions have bounded positions

Fixed slots do not provide a meaningful optimization space. A movable element
does receive a bounded frame, a preferred position, and a finite number of
attempts. The planner generates complete variants, the evaluator compares them,
and refinement searches locally around the best variant. This provides value
without building a global solver.

## A legal gap can still be ugly

The fact that an empty area is forced by an immovable element explains its
cause, but does not improve its aesthetics. The score penalizes unevenness and
size of gaps in this situation as well. Moving another movable element may
later change the gap.

## Reflow is a cost, not quality

Reflow stabilizes one plan when its geometry depends on earlier content. It is
not automatically a better candidate. The trace therefore reports candidate
count and reflow-pass count separately.

## Geometry and configuration are shared

The template, page geometry, planner, evaluator, debug, and renderer must use the
same computed frames. Tunable layout, score, threshold, and visual-QA values
belong in YAML, not as literals in scripts.

## Current scope of experiment 1

The first optimization covers one movable quote and a real editorial with small
paragraphs. We are not yet extending this loop simultaneously to all graphics,
quotes, breakpoints, growth, and routing. First we measure legality, score,
orphans, spacing, changes in line breaking, and reflow cost.
