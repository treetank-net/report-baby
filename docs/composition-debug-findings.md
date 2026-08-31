# Composition debug: findings and follow-up work

This note records what the composition overlay can currently prove and which
layout questions remain open. It is intentionally a working investigation
list, not a promise that every item is already solved.

## What the overlay must distinguish

- `FLOW placement` — a legal route location offered to one named flow.
- `RESERVED quotes` — an empty quote insertion slot. It is not content and is
  not an obstacle; it is a reservation the planner may leave unused.
- `BLOCK` — an atomic block placement, such as the full image block.
- `IMAGE` and `CAPTION` — the measured sub-boxes owned by an image block.
- `OBSTACLE` — a graphic or insertion boundary that excludes main-flow text.
- `CHROME header band` and `CHROME footer {page}/{pages}` — page chrome, not
  editorial flow content.
- line boxes — the concrete rectangles where a particular flow line was
  painted; their labels are outside the rectangles so they cannot obscure the
  text being inspected.

The same plan coordinates are now drawn by the normal jsPDF renderer when the
request contains `composition_debug: true`. The separate geometry map remains
available for cases where the actual article text would make the overlay too
dense.

## Findings from the current editorial

1. The orange-looking boundary beneath `AdobeStock` belongs to the image's
   `captionBox`, not to an unexplained main-flow block. The overlay now labels
   it as `CAPTION article-intro:image-1`.
2. The page number was painted by `drawReportChrome`, outside the footer flow
   placement. The overlay now frames it explicitly as
   `CHROME footer {page}/{pages}`.
3. The large top boundary is a fixed template-owned header band. It is not a
   hidden main paragraph. The overlay now marks that ownership separately.
4. Red empty rectangles were quote reservations. They are now labelled
   `RESERVED quotes rN`; red remains reserved for an actually empty, unblocked
   placement that is not a quote reservation.
5. After a full-width quote, the main flow resumes in the next legal line
   rectangles. The left and right columns can differ by a paragraph/heading
   gap even when both are legal. This is an aesthetic optimization problem,
   not evidence that the quote became part of main flow.
6. A heading can legally start near the bottom of a column when its configured
   keep cluster fits. The existing hard rule protects the configured heading
   cluster; moving the whole cluster to improve page balance belongs to the
   soft scoring/search phase.
7. The header title overflow was a real planner/renderer contract bug. The
   planner classified `type: heading, role: header` as the normal `header`
   style, while the jsPDF backend classified the same block as bold `heading`.
   The shared style resolver now makes both sides use `heading`, and a PDF
   regression checks the rendered glyph bounds against the planned title box.

## Follow-up tasks

- [x] Make overlay labels external to the rectangles.
- [x] Show image, caption, flow reservation, block and chrome ownership.
- [x] Keep ordinary PDF rendering and debug rendering on the same jsPDF path.
- [x] Use one shared block-to-style resolver in the planner and jsPDF backend.
- [x] Reject the old header-style mismatch with a rendered-PDF bounds test.
- [ ] Add an explicit post-obstacle anchor to the plan trace, recording the
  first main-flow placement after each full-width insertion.
- [ ] Add a soft score for vertical alignment of the first post-obstacle lines
  in the two columns; do not turn this aesthetic preference into a legality
  rule.
- [ ] Evaluate moving a complete heading cluster up or down when the current
  placement has enough space but creates an avoidable visual hole.
- [ ] Decide whether the repeated header band should remain fixed by this
  editorial template or become a growable chrome region. This is a template
  decision, not a renderer-side cursor adjustment.
- [ ] Add a PDF-level regression assertion that every debug frame has an
  identifiable owner and that the footer page-number frame exists on every
  rendered page.

## Interpretation rule

An overlay frame is evidence of a planned rectangle, not evidence that the
rectangle contains ink. Content occupancy must still be read from the plan's
`hasContent`, `lineCount`, `blockIds`, and line records, and verified against
the rendered PDF when needed. A reserved or intentionally unused slot is
different from an internal empty placement between two occupied placements.
