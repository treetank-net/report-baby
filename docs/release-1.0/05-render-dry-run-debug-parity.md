# Plan 05 — render, dry_run, and debug

Status: largely complete. The shared render/dry_run/debug plan and PDF parser
are working. Renderer-neutral inline runs are implemented and covered by a
passing contract test. Gap-tightening remains unresolved. Full dynamic chrome
ownership is tracked in [Plan 12](12-dynamic-page-chrome.md).

## Goal

Every observable result must describe the same plan:

- regular PDF;
- debug PDF with frames;
- the `dry_run` response;
- plan and trace JSON.

Debug is an observation layer over regular rendering, not a second geometry
calculation mechanism.

## Current state

- the regular render uses the composition planner/evaluator and the jsPDF backend;
- `drawCompositionDebugOverlay()` draws frames on the actual PDF;
- `dry_run` uses the same `prepareReportComposition()` stage as regular
  rendering; `resolveReportPlanOnly()` remains only a legacy diagnostic result;
- some chrome is still drawn in `report-renderer.ts` outside the composition
  plan; removing that split is covered by point 12;
- `report-composition-entrypoint.ts` is the production composition entry point,
  not an alternative renderer;
- the overlay already shows placements, obstacles, flow barriers, padding, and
  margins, but frame ownership must continue to be checked against the plan;
- the report manifest carries `compositionPlan` and `compositionEvaluation`,
  and the page-layout gate uses the plan instead of reconstructing columns from
  the template.

## Steps

1. Use the same planning result for `dry_run` and regular rendering.
2. Define a shared plan signature for render/dry_run/debug comparisons.
3. Test that all three paths expose the same placements, pages, word ranges,
   and frames.
4. Mark these items separately in the debug PDF:
   - flow bounds;
   - obstacle bounds;
   - actual placements;
   - flow barrier candidates;
   - padding/margins that affect the decision;
   - chrome elements that constrain the flow.
5. Move technical labels outside frames or reserve dedicated label space so
   they cannot cover text.
6. Keep frames behind text when that improves readability, without changing
   rendering geometry.
7. Check the PDF text layer, PDF bounding boxes, and raster for real editorial.
8. Keep the PDF parser compatible with both valid stream forms: `/Filter` and
   uncompressed streams. If no text run can be read, the gate must fail
   explicitly rather than pass an empty measurement.
9. Treat the four audited cases as regressions with different contracts:
   column layout, table fill, inline markup/glyph fallback, and sparse-page
   behavior. Expectations must come from the current composition contract, not
   warnings emitted by the removed renderer.
10. Keep three evidence layers for every regression: plan/manifest output,
    selectable PDF text, and a reviewable raster. Missing one layer is missing
    data, not success.
11. Confirm that the composition entry point has no historical alias or parallel
    planning path.

## Completion criteria

- debug does not reproduce geometry with private rules;
- every frame label has an owner in the plan or trace;
- no line/frame exists without a documented source;
- `dry_run` points to the same plan that is sent to the PDF;
- debug overlay does not move or clip text;
- the real PDF preserves selectable text and correct page assignments.
- no gate skips an uncompressed PDF stream;
- `page-layout-editorial-two-column` passes because measured runs are present,
  not because an empty measurement list was accepted;
- `inline-markup-report` is green and covered by the renderer-neutral inline-runs
  contract; `page-fill-gap-tightening` remains unresolved and must be tracked as
  an explicit open item rather than reported as both complete and failing.
- the production adapter name and exports do not suggest a second renderer; any
  retained alias is covered by a public-usage test.

## Completed

- `prepareReportComposition()` is the shared render and `dry_run` planning
  stage; it creates one jsPDF metrics set, capability set, and `CompositionPlan`.
- `scripts/lib/pdf-text.mjs` is the shared selectable-text and word-bound seam
  for the oracle; it distinguishes a valid empty result from a `pdftotext`
  failure, and the oracle test covers both cases.
- `dry_run` returns `compositionPlan` and `compositionEvaluation`; a rejected
  plan produces no PDF and does not terminate the process with an exception—
  rejection is inspection data.
- The CLI test compares the complete `compositionPlan` from `dry_run` and the
  full render for the same fixture.
- `test-report-chrome.mjs` checks a public PDF with a variable main flow:
  header/footer/main anchors against planned placements, the footer rule,
  lockup on every page, and the debug numbering label `{page} / {pages}`.
  This label is not a public template placeholder. The test does not compare a
  text hash of the whole article, so the fixture may change text and wrapping.
- Regression `test:editorial-flow` passes for the fast set of 26 fixtures; the
  full 506-fixture matrix is available through `npm run test:editorial-full`.
- `npm run test:editorial-full` passes all 506 fixtures after the evaluator was
  corrected to count occupied table/block placements as unavailable capacity.

## Follow-up after point X

- The complete list of frame colors and types follows point 02, once every
  geometry owner is final.
- CompositionPlan chrome coverage and dynamic header/footer height belong to
  point 12; this document covers only render/dry_run/debug parity.
- A stable plan signature follows point 04, once a plan may contain multiple
  attempts and a selected winner.

## Out of scope

We do not create a separate debug planner or alternative layout solely for the
overlay.
