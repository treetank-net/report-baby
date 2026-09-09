# Plan 09 — structural continuity, image formats, and feedback cost

Status: implemented for the Release 1.0 scope. Continuity scoring for lists,
tables, and tiny fragments, WebP/AVIF ingestion, the image contract gate, and
the fast/full feedback split are implemented. CI-host weight calibration is
Release 1.1 optimization, not a missing 1.0 contract.

## Goals

1. Lower the score of visually poor list/table splits without creating a second
   rule system.
2. Handle WebP and AVIF through the same image and contrast path as existing
   formats.
3. Keep routine feedback cheap while retaining a complete release gate.

## Structural continuity scoring

The evaluator measures lists split between pages or columns, tables split
between containers, a table header without enough following rows, a split table
row where the renderer permits it, and tiny fragments such as a lone heading or
single list item. A natural split between items is less costly than an orphaned
header; splitting a row is worse than moving the complete row.

These are soft penalties on legal plans, not automatic failures. The components
`list-continuity`, `table-continuity`, and `tiny-fragments` return a penalty and
trace/debug detail. All weights live in `composition_score` in
`server/templates/render-config.yml`; code must not duplicate numeric values.
Calibrate list-container, table-container, orphan-header, row-split, and tiny-
fragment weights against manual PDF review on short, long, and boundary
editorials. A score-only improvement is not considered visual success.

Tests cover each breakdown component, legal natural splits, ranking two plans
that differ only in continuity, the existing `page-fill-table` regression, and
debug evidence for the selected plan.

## WebP and AVIF

The image resolver accepts WebP and AVIF from HTTP(S), `root://` content roots,
`brand://` directories or ZIPs, and direct image blocks. It supplies one shared
decoded raster to renderer and contrast sampler. In this release, WebP and AVIF
are transcoded to PNG by the process `ffmpeg` decoder; `ffmpeg` availability is
an environment requirement, not an npm runtime dependency. Downstream modules
must not branch on PNG/JPEG/WebP/AVIF.

The contract covers minimal WebP/AVIF decode fixtures, PDF rendering, brand ZIP
assets, cache reuse across candidates, contrast over a known background and
contain/crop placement, and readable errors for corrupt or unsupported files.
Production, CLI-bundle, and test environments must all check decoder
availability explicitly.

## Test feedback cost

Brand and artifact contracts still perform expensive CLI/tool/PDF paths, so the
harness exposes separate commands:

- `npm run test:smoke` — fast composition, flow, and structure checks;
- `npm test` — the normal non-brand suite;
- `npm run test:release` — all current release suites;
- `npm run test:editorial-full` — the 506-fixture editorial matrix, intended
  before release or overnight.

The ordinary editorial flow gate uses 26 representative fixtures. The full
matrix uses 506 fixtures (480 plan-only variants and 26 PDF cases). The harness
reports every check and group duration, warns at
`quality.test_feedback.check_warning_ms`, and reads `smoke_budget_ms` and
`release_budget_ms` from `server/templates/render-config.yml`.

`npm run test:timings` writes incremental records to
`server/qa/test-timings.jsonl`, including start/end, status, and suite
aggregates. The 2026-09-09 reference without build was 503.6 s for 39 unique
harness checks and 242.32 s for the separate 506-fixture matrix; these times
must not be added because the representative editorial check is shared.

## Artifact-necessity decision

For each assertion, classify the required evidence rather than preserving the
current execution mechanically:

- `not-generated`: plan-only facts such as page, flowId, slotId, placement
  order, legality, or residuals; assert `CompositionPlan`/`Evaluation` without
  PDF backend, rasterization, or `pdftotext`;
- `retain`: assertions about the artifact/backend, such as selectable glyphs,
  image presence, ink occupancy, raster contrast, PDF/PNG/PPTX validity, or
  deterministic artifact parity;
- `split`: mixed checks become one smallest artifact fixture plus plan/process
  assertions;
- `remove`: duplicate coverage with no distinct contract.

The CLI/MCP process contract alone does not justify rendering. Use one shared
fixture and configuration at the renderer-neutral seam wherever possible.
Run the timing audit, classify every check, migrate plan assertions, retain one
small backend proof per property, and measure before/after in JSONL. No plan-
only assertion should render an artifact, and every retained render must name
its reason. Equivalent plan assertions must preserve coverage rather than merely
making the suite shorter.

## Completion criteria

- List/table continuity is one documented soft score with configurable weights.
- Tests prove penalties affect ranking without creating a hard failure.
- WebP and AVIF pass resolver, renderer, debug, and contrast screening.
- Regular PDF, `dry_run`, and debug share the decoded asset.
- Composition/planner/evaluator docs describe continuity, orphan, and contrast
  interactions.
- Every artifact-producing assertion has a documented reason; plan-only checks
  use the plan/evaluation seam.

## Follow-up

Remaining work is limited to calibrating weights on real editorial, deciding
whether row splits are supported by the target renderer, selecting a decoder
after bundle-size/licensing checks, and setting decode limits from real-image
benchmarks.
