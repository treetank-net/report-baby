# Empty-space detection and placement optimization

Status: deferred Release 1.1 task; the current evaluator exposes only part of
this contract.

## Problem

An accepted plan can still contain large unexplained empty regions, excessive
gaps around an insertion, or a column that stops much earlier than its
neighbour. Legality checks alone do not identify these cases, and the planner
does not currently use all of the available spacing evidence to select a
better legal placement.

This task is about plan-level geometry. It must not require rasterizing a PDF
or asking a user to write a diagnostic script. A single visual showcase can
remain a manual regression artifact, but routine detection and candidate
comparison must happen before rendering.

## Scope boundary

This task complements, rather than replaces, the existing contracts:

- `08-diagnostics-and-remediation.md` defines how a problem is explained and
  returned through the API;
- `09-pdf-aesthetic-rules.md` defines the initial spacing and fragmentation
  rules;
- legality remains fail-closed and is evaluated before aesthetic scoring;
- authored placement requests are not silently moved unless they declare a
  legal movement window;
- template-defined chrome, reserved bands, and intentionally empty slots are
  not counted as unexplained whitespace.

## What the evaluator must measure

For every page and relevant content region, the plan should expose:

1. usable region and its occupied bounds;
2. occupied area and empty-area ratio, excluding configured chrome and
   intentional reservations;
3. top and bottom gaps between neighbouring flow streams;
4. per-column fill and the difference between columns;
5. obstacle boxes for images, tables, charts, and quotes, including the
   before/after gap on every intersecting stream;
6. isolated fragments and the amount of text left on either side of an
   obstacle; and
7. fit-content envelopes that remain unused after content measurement.

Measurements must retain the source page, template, flow, block, slot, and
route identifiers. Unknown or inapplicable values are omitted, not replaced
with invented zeroes.

## Suspicious whitespace versus intentional whitespace

The evaluator must distinguish an intentional empty area from a layout defect.
An area is intentional when it is explained by at least one of these facts:

- a configured chrome or footer band reserves it;
- a template slot or obstacle explicitly reserves it;
- the page or stream ends there and no later content is available;
- the insertion has no following stream because it is the final content on
  that page; or
- the template explicitly opts into the spacing.

Otherwise, a large empty region or an unexplained gap becomes a scored finding
and, when it is material, an actionable suggestion.

## Diagnostic codes

The following stable codes should be added to the diagnostic catalogue:

- `EXCESSIVE_EMPTY_REGION`: a content region contains an unexplained empty
  area above the configured threshold;
- `UNBALANCED_COLUMN_FILL`: neighbouring columns have materially different
  occupied heights or line counts;
- `UNBALANCED_INSERTION_GAP`: an insertion leaves materially different gaps
  before and after itself across one or more text streams;
- `UNUSED_FIT_CONTENT_ENVELOPE`: a measured fit-content slot retains a large
  unused envelope that affects surrounding placement; and
- `PLACEMENT_CANDIDATE_IMPROVEMENT`: a legal alternative improves the
  configured aesthetic score without violating authored order or coverage.

Each finding must include the measured boxes, thresholds, affected page and
flow/block/slot identifiers where known, the score impact, and ordered
remedies. Typical remedies are to evaluate a nearby legal insertion position,
reduce an insertion width, choose a template with a more suitable slot, or
allow the flow to continue on a later page.

## Candidate selection

Placement optimization must operate only on candidates that are legal under
the existing template and input contracts. The selection order is:

1. preserve hard legality and complete content coverage;
2. preserve authored flow order and explicit page/template requirements;
3. minimize orphan fragments, unexplained empty regions, and insertion-gap
   imbalance;
4. improve column fill and balance; and
5. use the existing deterministic tie-breakers.

Candidate generation is bounded by the declared movement window and configured
candidate count. If no movement window exists, the authored position remains
fixed and the evaluator reports the problem instead of moving it implicitly.

The scorer must not reward a superficially full page by creating overlaps,
breaking a flow, splitting a protected block, or consuming a reserved chrome
region. A candidate with a hard violation is never an optimization winner.

## Implementation seams

- Extend the renderer-neutral composition score details with page/region
  occupancy and empty-area measurements.
- Reuse the existing insertion-spacing, orphan-line, column-balance, and
  fit-content geometry queries instead of introducing pixel-based heuristics.
- Add a placement-quality pass after legal candidate evaluation and before the
  final candidate is selected; do not create a second planner or evaluator.
- Expose a compact summary through CLI and MCP, while retaining full boxes and
  candidate traces behind `diagnostics: full`.
- Keep thresholds and penalties in `server/templates/render-config.yml`.

## Acceptance criteria

- A plan-only test detects a large unexplained empty region without rendering a
  PDF and reports its page, box, threshold, and remedy.
- A plan-only test distinguishes intentional chrome/footer space and a final
  stream gap from a defect.
- A legal alternative insertion position is selected when it improves the
  score and stays inside the declared movement window.
- When no movement window exists, the authored position is retained and the
  response explains why optimization was not attempted.
- CLI and MCP return equivalent compact findings; `diagnostics: full` adds the
  underlying geometry and candidate evidence.
- The visual showcase remains a single manual regression artifact rather than
  a prerequisite for every composition test.

## Implementation map

### What exists today

- Plan geometry and page/slot projections are defined in
  `server/src/composition/contracts/engine-contracts.ts` and materialised by
  `layout/document-layout.ts` and `layout/page-state.ts`.
- `observability/spacing-report.ts` and
  `observability/planning-observability.ts` already expose occupied boxes,
  slot gaps, text gaps, flow placements, and obstacle fragments.
- Existing score components in `evaluation/scoring.ts` cover column balance,
  orphan lines, insertion spacing, header spacing, tiny fragments, contrast,
  and legal-plan status. `evaluation/plan-queries.ts` and
  `evaluation/legality-geometry.ts` provide reusable box queries.
- Candidate generation and selected placement refinement live in
  `layout/planner-candidates.ts`; insertion geometry is prepared by
  `insertion-planning.ts` and `insertion-placement.ts`; final ranking is in
  `composition-engine.ts`.

### Changes required

1. Add a renderer-neutral occupancy projection for each page, region, slot, and
   route: usable box, occupied bounds/area, intentional reservations, and
   signed neighbouring gaps. Reuse `spacing-report.ts` and plan queries rather
   than scanning pixels.
2. Add the stable empty-space findings from this document to the shared
   diagnostic catalogue (item 08), including thresholds, evidence boxes, score
   impact, and remedies. Distinguish chrome, explicit reservations, final
   streams, and template-opted spacing from unexplained whitespace.
3. Extend `evaluation/scoring.ts` with empty-region, unbalanced-column, unused
   fit-content envelope, and candidate-improvement components. Keep hard
   legality separate and never reward a superficially full but illegal page.
4. Run the quality pass inside the existing `composition-engine.ts` candidate
   loop after legality and before final selection. Generate alternatives only
   through the declared movement window in `planner-candidates.ts`; authored
   positions remain fixed when no window is present.
5. Return a compact summary by default and full boxes/traces behind
   `diagnostics: full` through the MCP/CLI adapters. Keep thresholds and
   penalties in `server/templates/render-config.yml`.
6. Add plan-only tests to `test-text-composition-engine.mjs`,
   `test-editorial-plan-contract.mjs`, and `test-structure-scoring.mjs` for
   intentional versus unexplained whitespace, column imbalance, fit-content
   envelopes, and a legal improved insertion candidate. Retain one visual
   showcase test only to verify that the selected plan paints as reported.

### Resulting ownership and dependencies

Observability measures geometry, evaluator scores it, the shared diagnostic
catalogue explains it, and the existing planner/engine selects among legal
candidates. This is the optimisation layer of the combined 08–10 workstream;
it must land after the rules/evidence layer (09 and 08) and before the broader
search expansion in item 04.
