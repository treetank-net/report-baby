# Plan 02 — geometry and shared frames

Status: functionally complete for the current 1.0 scope; chrome, placement and
candidate geometry is shared and validated. Dynamic page-chrome behavior is a
separate scope under point 12. Release evidence: the release harness passes
39/39 checks and the default `npm test` passes 23/23 checks (2026-09-09).

## Goal

The planner, evaluator, debug output and backend must refer to the same computed
frames: slots, segments, placements, obstacles, flow barriers, block frames,
graphics and chrome.

We do not add another geometry model. We define ownership of the existing
representations and remove repeated reinterpretations.

## Current state

Geometry passes through several stages:

1. `template/contracts.ts` validates and normalizes the template;
2. `template/geometry.ts` calculates physical page geometry, segments, bands,
   obstacles and continuation;
3. `composition/adapters/page-template.ts` builds `CompositionTemplate` from it:
   slots, routes and part of the insertion rules;
4. the planner creates actual `flowPlacements` and the collision-derived
   `flowBarrierBoxCandidates`;
5. the renderer and debug output draw the result in separate locations.

Sources: [`template/contracts.ts`](../../server/src/template/contracts.ts),
[`template/geometry.ts`](../../server/src/template/geometry.ts),
[`page-template.ts`](../../server/src/composition/adapters/page-template.ts).

## Responsibility map

| Stage | Owner | Input | Result used downstream |
|---|---|---|---|
| template compilation | `compileTemplateSource` in `template/contracts.ts` | template YAML/object | validated `CompiledTemplate` with normalized frames, flows and slots |
| physical page geometry | `pageGeometryFromTemplate` in `template/geometry.ts` | `CompiledTemplate.page` | `PageGeometry`: margins, content, bands, obstacles, segments and block frames |
| composition adaptation | `compositionTemplateFromPageGeometry` in `composition/adapters/page-template.ts` | `CompiledTemplate` + `PageGeometry` | layouts, slots and routes for first and subsequent pages |
| insertion reservation | `placeInsertionLayer` in `composition/layout/insertion-layout.ts` | flows, proposals, slots and measurements | insertion placements and graphics that act as obstacles for ordinary flow |
| flow layout | `planFlow` in `composition/layout/flow-planner.ts` | route, slots, obstacles and text metrics | text lines, placements and planner decisions |
| flow-place registry | `registerFlowPlacements` in `composition/layout/flow-space.ts` | slots and actual placements | ordered registry including empty places |
| collision split | `registerFlowBarrierBoxCandidates` in `composition/layout/flow-space.ts` | flow placements + graphic placements | segment candidates between flow and obstacle edges |
| legality | `evaluateCompositionPlan` in `composition/evaluation/evaluator.ts` | complete plan | accepted/rejected status and diagnostics |
| PDF observation | `drawCompositionDebugOverlay` and `renderReportPdfDetailed` in `report/renderer.ts` | plan result | ordinary PDF, debug overlay and QA artifact |

This map describes existing functions; it does not introduce new entities. If a
later stage needs the same information, it should extend the owner’s result
instead of reconstructing geometry in the evaluator, debug overlay or backend.

## Completed in this pass

- The report CLI stores the `compositionPlan` and `compositionEvaluation` used
  for rendering in the manifest.
- `page-layout-editorial-two-column` reads `main` `flowPlacements` from that
  plan; it no longer reads `editorial-two-column/template.yml` separately.
- The artifact gate converts plan units (mm) to PDF-reading units (pt) only at
  the measurement boundary. The plan itself remains in composition geometry
  units.
- The geometry adapter test and the complete composition gate pass. Together
  with the release evidence above, this confirms the current 1.0 geometry
  contract.
- `CompositionPagePlan.chrome` contains computed frames for the header band, the
  optional header rule, the footer rule, the page number and the lockup.
- The ordinary renderer and the debug overlay use the same chrome frames; the
  `test-report-chrome` test checks their agreement with the drawn PDF.
- The trace stores the same `flowBarrierBoxCandidates` list as the executable
  plan. The planner uses them to determine space available to ordinary flow,
  and the editorial parity test checks their identifiers and order.
- The evaluator checks the `flowPlacements` registry independently of the
  declared `hasContent`: it compares metadata with actual lines and rejects a
  placement outside its slot; the regression is in
  `test-editorial-numbered-flow`.
- The evaluator also checks barrier candidates: positive geometry, membership in
  a placement and references to existing obstacles with `wrap: around`.

## Follow-up verification (not a 1.0 scope expansion)

1. Draw an input-to-output table for every geometry function: template, page,
   flow, slot, segment, obstacle and placement.
2. Establish where the following are created:
   - boundaries of the complete flow;
   - collisions inside a flow;
   - actual places containing content;
   - empty places unavailable to content;
   - candidates resulting from contact with an obstacle.
3. For every calculation, identify its owner and prohibit reconstruction in the
   evaluator, debug overlay or backend.
4. Pay particular attention to moving `blockFrames`, splitting segments,
   insertion routes, growth and chrome.
5. Add geometry tests for rectangular graphics, ellipses, polygons, multiple
   obstacles and page transitions. These are coverage follow-ups, not new 1.0
   behavior.
6. Add a test comparing a candidate frame with the actual first and last
   `flowPlacement` on both sides of an obstacle.
7. Expose in the trace which geometry produced a given placement and candidate.
8. Establish the geometry source for visual-QA measurements. A page gate must
   not reconstruct columns from a separate YAML file when `CompositionPlan`
   already resolves flows and placements. The
   `page-layout-editorial-two-column` test must compare actual text-flow starts
   with this plan.
9. For `page-fill-table`, separate the content area from the header, footer and
   other chrome elements during measurement. Then record which table placements
   reached each page so a valid split can be distinguished from an excessively
   sparse final page.

## 1.0 completion criteria

- a template change passes through geometry, planner, evaluator, debug and
  backend without changing its meaning;
- the evaluator can detect a placement outside its frame independently of what
  the placement declares as its slot;
- a candidate box is visualized as diagnostic geometry, but does not become an
  obstacle for text merely because it was drawn; the actual barrier is only the
  obstacle placement used by the planner;
- debug output distinguishes flow, obstacle, actual placement and candidate;
- a test confirms agreement between computed and drawn coordinates;
- the adapter test confirms the template → `PageGeometry` transition and
  obstacle-based segment splitting; currently this is
  [`test-page-template-adapter.mjs`](../../server/scripts/test-page-template-adapter.mjs);
- the release harness passes 39/39 checks and default `npm test` passes 23/23
  checks.

## Notes deferred to later points

- The final owner of the `blockFrames` moving rule requires completion after
  points 1 and 2. Do not move this rule earlier.
- Dynamic header/footer height, chrome planning order and complete chrome
  ownership in the plan are covered by
  [`12-dynamic-page-chrome.md`](12-dynamic-page-chrome.md).
- The use of `flowBarrierBoxCandidates` for insertion-position optimization
  requires further tests under plan 04. They already feed the selection of
  places where ordinary flow may continue; a global solver for all element
  positions is explicitly deferred to a follow-up/1.1 scope.

## Out of scope

We do not build a general geometry solver or full CSS-float semantics.
