# Release 1.1 — Plan 15 progress

Plan: [15 — coarse geometry-first planning](15-coarse-geometry-first-planning.md)

**Status: core implemented; broader visual preference calibration remains open.**

## Implemented

- One unobstructed main estimate records unbroken block heights by width and
  protected atomic, heading/following-line and paragraph-edge rectangles.
- Global bounded assignment compares up to eight independent cut/push
  projections. The existing engine compares up to three complete exact seeds,
  within its current budgets, then repairs the selected incumbent.
- Natural final main fragments and empty terminal columns receive no density
  penalty. Natural paragraph transitions receive no fragmentation penalty;
  obstacle-associated splits, orphans, detachment and real spacing deficits
  remain observable. Gravity reward is configured at 60 points.
- Evaluation/MCP exposes reward ceilings and measurement applicability.
  The loose bound is `260 + 4H`; for the representative PDF it is 292
  (measured reward bound 246). Neither is a feasible optimum or quality percent.
- Six synthetic article cases shaped from four trans.info sources exercise
  212–1650 main words, two brands/fonts, 0–5 quotes and three original diagrams.
  Their PDFs, geometry and scores are generated with `npm run score:corpus`.
- Corpus findings fixed atomic image/wrap-obstacle collisions, duplicate
  proximity subjects for an insertion and its own graphic, empty text selection
  after keep rules, caption font/width disagreement between measurement and
  drawing, and raster decoding/zero-padded page filenames.
  A blank raster can no longer pass the line-ink gate.

## Evidence

- Representative PDF: 5 pages, score **111.667**, quotes on **2, 2, 3, 4**.
  The accepted page-5 tail remains intact; no density-only terminal penalty.
  Eight projected configurations feed three initial exact candidates; ten
  complete candidates are evaluated including bounded repairs.
- All six production corpus plans are legal. **1129/1129** production line-box
  ink checks pass after correcting the raster decoder; **1965/1965** across all
  rendered comparisons, plus **13/13** rendered caption baseline checks.
  One legacy mixed-graphics baseline is rejected.
  Wide-truck case: **137.007**; mixed Flux case: **99.237** after removing
  approximately 127 points of false insertion self-proximity cost.
- Build/TypeScript, documentation ownership, configuration reach and MCP
  schema checks pass. Configuration reach and MCP required host execution
  after sandbox child-process failures.
- Full composition suite after the caption fix: **21/21 checks pass** in
  358,198 ms on the host. Image measurement/rendering parity and actual PDF
  caption baselines pass; the accepted reference pages 4–5 were re-inspected.
  Source/docs whitespace checks pass; generated minified third-party bundles
  retain their build-produced trailing whitespace.

## Remaining

- Review and freeze good/bad preference pairs before broader weight tuning;
  all new cases remain `pending-review`. See the
  [corpus guide](../../../examples/composition-calibration/README.md).
- The dense short case exposes insertion capacity versus main continuity;
  caption spacing still requires preference review. Legality and ink checks do not
  establish aesthetic preference. Legacy comparisons use one baseline only.
- Keep break-cost predictions approximate and exact legality authoritative.
  Item 14's rendered page map remains downstream verification work.
