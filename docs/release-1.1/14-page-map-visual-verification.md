# Release 1.1 — page-map visual verification

Status: planned.

This item is downstream of
[`15-coarse-geometry-first-planning.md`](15-coarse-geometry-first-planning.md).
The coarse estimator chooses an initial arrangement before exact line layout;
this page map observes the resulting exact plan and selected rendered PDF. It
may compare estimated, planned and rendered geometry for calibration, but it is
not the source of the initial aesthetic placement and cannot replace the
coarse estimator. Item 15 takes priority when sequencing implementation.

## Goal

Build one page-indexed view of the materialized `CompositionPlan` and use its
measured facts consistently for quality scoring, diagnostics, and rendered-PDF
verification. The page map is a projection of the selected complete plan. It is
not a second planner, placement model, or source of legality.

The current plan already contains page-qualified lines, block and table
placements, graphics, glyphs, and slots. `CompositionPlanSpacingReport`
already projects page geometry, slot occupancy, text placement, and spacing
observations. This item makes that existing evidence page-complete and gives
each measurement a stable subject and explicit source.

## Benefits

- Scoring and diagnostics can consume the same measured distances and box
  relationships instead of re-deriving geometry independently.
- A finding can name its page, both subjects, both boxes, signed gap, profile
  target, deficit, and available movement policy.
- Plan defects can be separated from renderer defects by matching planned
  elements to text and raster measurements from the selected PDF.
- Page balance, whitespace, alignment, and visual-load analysis can expand
  beyond the current insertion-focused metrics without replacing the plan or
  evaluator contracts.
- The same evidence can drive machine-readable CLI/MCP output and a rendered
  diagnostic overlay, so users can inspect why a measurement was reported.

New weights and thresholds do not improve ranking by their existence. Keep new
measurements observational until representative PDF review supports their
calibration.

## Ownership and data flow

Keep the existing lifecycle:

```text
input and template capabilities
  -> complete CompositionPlan candidate
  -> page-indexed visual projection in CompositionPlanSpacingReport
  -> legality and score in CompositionEvaluation
  -> complete-candidate selection by composition-engine.ts
  -> render selected plan
  -> compare the planned projection with PDF text and raster measurements
```

`CompositionPlan` remains the source of planned geometry. Extend
`CompositionPlanSpacingReport` and its existing per-page geometry projection;
do not create a second plan or candidate selector. Keep
`CompositionEvaluation` responsible for legality, score components,
attribution, and repair proposals. Post-render PDF/raster evidence must retain
its own measurement source and must not be presented as if it existed during
candidate planning.

## Page-map contract

Each page entry must expose:

- the resolved page/template reference, page box, margins, content regions,
  columns, bands, and materialized slots;
- an ordered inventory of planned text lines, block/table placements, graphics,
  glyphs, and other material placements, each with a stable reference and box
  in millimetres;
- optional named measurements for boundary clearance, occupancy, visual-load
  inputs, alignment, overlap, and neighbor gaps;
- explicit measurement provenance (`plan`, PDF text layer, or raster) where
  facts from different stages are joined.

Do not duplicate a line and its aggregate block box as interchangeable
elements. Preserve their distinct levels. Missing measurements remain absent;
do not use fabricated zeroes. Pairwise findings identify both subjects and
their measured boxes. Observational records remain extensible, while subject
identity, geometry, legality, and candidate actions stay strongly typed.

Avoid a full pairwise matrix over every text line. Measure meaningful neighbors
within a region and aggregate at block and page level. This bounds work while
retaining local evidence.

## Execution plan

### Stage 1 — freeze fixtures and acceptance facts

Use deterministic plan/PDF fixtures for a single-column page, a multi-column
page, dynamic intro plus insertions, mixed insertion kinds, and a sparse
terminal page. Add controlled variants with a moved line, an overfull box, a
known overlap, and an irregular gap. Keep source content and template fixed in
before/after comparisons.

For each case, list the expected page membership, subject boxes, measured
relationship, and whether the finding is diagnostic-only or score-bearing.

**Gate:** every planned measurement has a fixture and a concrete expected
result; existing baselines are captured before output-affecting changes.

### Stage 2 — build the page projection

Extend the contracts in `server/src/composition/contracts/engine-contracts.ts`
and construct the per-page inventory in
`server/src/composition/observability/spacing-report.ts`. Derive it from the
existing plan arrays and resolved page geometry. Build it before evaluation for
every complete candidate through the existing `beforeEvaluate` seam in
`server/src/composition/report-composition-entrypoint.ts`.

**Gate:** contract tests assert required keys and value domains, every planned
material element is represented exactly once at its declared granularity, page
and box references are correct, and output ordering is deterministic.

### Stage 3 — measure geometry and relationships once

Add page-edge and region clearances, signed neighbor gaps and overlaps,
alignment, and page/column occupancy to the existing projection. Reuse current
insertion, chrome, orphan, and proximity evidence where their semantics match.
Keep different facts separate: box area, measured raster ink, text mass, and
configured visual-load weight are not synonyms.

**Gate:** targeted fixtures verify each geometry calculation, including
negative signed overlap, and each result names the evidence needed to explain
it. No unavailable measurement is replaced by a sentinel.

### Stage 4 — make scoring consume projected facts

Update existing score components in
`server/src/composition/evaluation/scoring.ts` to consume page-map observations
where they currently remeasure the same geometry. Preserve legal-first,
complete-plan ranking in `composition-engine.ts`. Do not add a second penalty
for an existing finding. New page-symmetry and whole-page load components stay
diagnostic-only until calibrated.

**Gate:** score attribution still conserves the total score; existing approved
rankings remain reachable; score differences are explained by named measured
facts; uncalibrated metrics do not silently affect selection.

### Stage 5 — verify rendered output against the plan

Extend `server/scripts/lib/pdf-layout-diff.mjs` and
`server/scripts/lib/pdf-ink-occupancy.mjs` to associate extracted PDF text and
raster ink with page-map subjects where matching is unambiguous. Report
unmatched/ambiguous objects rather than guessing. Detect missing ink, unexpected
movement, clipping beyond a planned box, and meaningful differences between
planned and actual text bounds.

Inspect the selected output and a small representative artifact corpus. Do not
rasterize every planner candidate.

**Gate:** a matching PDF passes; controlled movement, clipping, or missing-ink
mutations produce a finding for the right page and subject; expected text and
required content remain complete.

### Stage 6 — expose and calibrate

Expose the same structured page-map evidence through normal composition quality
outputs and add an optional diagnostic overlay generated from the same data.
Document every new threshold or weight in `server/templates/render-config.yml`
and `docs/composition/configuration.md`. Calibrate weights against reviewed
renders before enabling them as ranking objectives.

**Gate:** CLI/MCP output is self-contained, the overlay agrees with the JSON
coordinates, and each score-bearing threshold has before/after artifact
evidence.

## Verification sequence

During implementation, run the cheapest affected checks after each stage. The
release verification is:

```sh
cd server
npm run build
npm run test:composition
npm run test:artifacts
npm run test:quality
npm run test:release
```

Run process-spawning integration suites in an environment that permits child
process creation. Record generated page-map/PDF artifacts, checks run,
confirmed behavior, environment failures, and unresolved cases separately.

## Completion criteria

- Every evaluated plan has a deterministic, complete page-indexed projection of
  its planned material geometry.
- Existing score components consume shared geometry evidence instead of
  independently calculating the same facts.
- New weights and thresholds affect ranking only after representative visual
  calibration.
- The selected PDF can be compared to its page map, with plan/PDF/raster
  provenance preserved and mismatches tied to named subjects.
- Public output explains geometry, findings, and remediation without requiring
  user-written inspection scripts.
