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

A quote, graphic, KPI, chart, table, or image block can be a separate
insertion. Quote content is always owned by a named non-`main` flow; `main` is
reserved for the primary text and cannot declare insertion slots. An insertion's
measured box is an obstacle for text, while its content is materialized through
the capability for its own block kind. This allows the element type to change
without rewriting column-text mechanics.

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

## Jednorazowe insertiony mogą pochodzić z requestu

Reusable page templates remain the default owner of page geometry. A document
may nevertheless need one authored insertion whose frame is not worth adding
to a persistent template. The request may then provide a
`placement_requests` entry containing `flow_id`, `block_id`, page and a
normalized frame. The adapter
materializes an in-memory slot and non-`main` insertion route for that one
composition run; it does not mutate or persist the selected template.

W publicznym kontrakcie ta geometria powinna nazywać się `frame`, zgodnie z
terminologią template'u. `box` pozostaje nazwą zmaterializowanego prostokąta
(`CompositionRect`) w planie i placementach; nie jest osobną domenową encją ani
rodzajem slotu.

The block itself remains content-only in `data.flows`. A raw `frame` on a
`CompositionBlock` is not accepted, because it would mix content with layout
and bypass slot ownership, legality checks and obstacle synchronization. The
same insertion measurement, fit-content, obstacle and evaluator pipeline is
used for both template-owned and request-owned slots. If the requested box has
no legal placement, the plan is rejected.

The contract is exposed as optional `placement_requests` on `render_report`
and the report CLI. The input schema remains strict and content-only; the
request adapter builds a per-run overlay and the renderer still selects only
the built-in A4 template. Auto-height and fixed sizing are both validated
before planning. Downstream obstacle movement after a genuine runtime growth
remains a separate follow-up; the current proposal pass already prevents
unrelated overlapping boxes.

## Sloty insertionu są pulą pojemności

`insertionSlots` opisuje dostępne miejsca na każdej stronie, a nie listę
slotów tworzonych dla każdego bloku. Dwa sloty cytatów powtarzane na stronach
mogą więc obsłużyć piętnaście cytatów w dłuższym artykule. Planner przechodzi po
slotach w kolejności stron i pozycji, przypisując kolejne bloki flow do
pierwszego legalnego miejsca. Konkretne przypisanie bloku do slotu może być
preferencją albo twardym wymaganiem, ale przekroczenie całkowitej pojemności
nie może usuwać treści — kończy się odrzuceniem planu.

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
