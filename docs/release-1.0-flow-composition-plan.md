# Release 1.0 plan: stable flow and composition model

Status: completed; the numbered documents in [`docs/release-1.0/`](release-1.0/)
are the execution record and current release evidence.

## Goal

Release 1.0 completes the migration to one content-layout pipeline:

```text
CompositionInput → flows → planner → placements → evaluator → renderer
```

The pipeline is deterministic and maintainable:

- input uses named flows and ordered blocks;
- templates describe geometry, slots, routes, and reserved areas;
- the planner measures content and selects placements before drawing;
- graphics and other occupying elements affect text layout;
- the evaluator rejects illegal plans and scores legal layouts;
- bounded candidate alternatives may be compared;
- regular PDF, debug PDF, and `dry_run` describe the same plan;
- the renderer executes the plan and does not make post-hoc wrapping decisions.

The old `Cursor` and flat `ReportData` models are not restored. No new domain
vocabulary or entity is introduced merely to rename existing behavior.

## Governing decisions

1. The planner–evaluator loop is in scope. The planner prepares candidates, the
   evaluator checks legality and score, and selection considers legal plans only.
2. Hard violations outrank score; an illegal plan can never win because it looks
   better in another dimension.
3. The first loop is bounded and deterministic; there is no unrestricted global
   document solver.
4. Existing behavior is protected by tests before code is moved by
   responsibility. Functions are not split mechanically.
5. Layout, score, threshold, and visual-QA values come from the existing YAML
   configuration seam.
6. Canonical planner/evaluator/decision documentation is updated with each
   contract or rule change; this index is not the only source of truth.
7. Header and footer are ordinary repeating flows. Their height is content- and
   padding-driven in `fit_content` mode, while a template may choose a fixed
   frame. Existing `{{page.number}}` and `{{page.count}}` placeholders remain
   the canonical page-number contract.

## Execution documents

1. [Pipeline and contract](release-1.0/01-pipeline-and-contract.md)
2. [Geometry and shared frames](release-1.0/02-geometry-and-frames.md)
3. [Evaluator and score](release-1.0/03-evaluator-and-scoring.md)
4. [Planner–evaluator loop](release-1.0/04-planner-evaluator-loop.md)
5. [Render, dry_run, and debug](release-1.0/05-render-dry-run-debug-parity.md)
6. [Planner maintainability](release-1.0/06-planner-maintainability.md)
7. [Block kinds and soft insertions](release-1.0/07-block-kinds-and-soft-insertions.md)
8. [Candidate-search depth](release-1.0/08-candidate-search-depth.md)
9. [Structural continuity and image formats](release-1.0/09-structure-penalties-and-image-formats.md)
10. [Composition module migration](release-1.0/10-composition-module-migration.md)
11. [Domain organization of `server/src`](release-1.0/11-src-domain-organization.md)
12. [Dynamic page chrome and repeating flow](release-1.0/12-dynamic-page-chrome.md)
13. [Test-cost audit](release-1.0/13-test-cost-audit.md)

The current system contract is documented separately in
[Composition](composition/README.md). Execution documents describe work order;
Composition documents describe current behavior and rule rationale. Both must
be updated when a planner, evaluator, or public contract changes.

## Audited regressions

These cases remain in the harness with explicit contracts. A failure is
classified as a test defect, an unsupported capability, or a real quality
signal; it is never hidden by recording a new baseline.

| Case | Contract | Current status |
| --- | --- | --- |
| `page-layout-editorial-two-column` | selectable flow text and both columns | parser accepts compressed and uncompressed streams; gate passes |
| `page-fill-table` | page count and content fill | parser and plan checks pass; sparse-tail policy remains an explicit quality follow-up |
| `inline-markup-report` | bold/italic fallback, glyphs, and table/list markup | renderer-neutral runs and selectable text pass |
| `page-fill-gap-tightening` | response to a sparse last page | legacy warning is not a composition rule; keep as an explicit contract decision |

The quick harness uses composition-native assertions. The full editorial matrix
and visual checks remain available as separate gates.

## Dependencies

```text
01 pipeline and contract
        ↓
02 geometry and shared frames
        ↓
03 evaluator and score
        ↓
04 planner–evaluator loop
        ↓
05 render, dry_run, and debug
        ↓
06 planner maintainability
        ↓
07 block kinds and soft insertions
        ↓
08 candidate-search depth
        ↓
09 structural continuity and image formats
        ↓
10–11 module and domain organization
        ↓
12 dynamic page chrome and repeating flow
        ↓
13 test-cost audit
```

## Release criteria and evidence

- one documented flow-based input format;
- every supported block kind passes validation, measurement, placement,
  evaluation, and rendering;
- no content loss, illegal overlap, or unexplained placement gaps;
- planner, evaluator, debug, and renderer use the same frames;
- each candidate is evaluated once and the evaluator does not mutate it;
- the best legal plan is selected with deterministic tie-breaking;
- `dry_run` and render expose the same plan;
- composition tests and manual real-editorial review are available;
- maintainers can find each rule owner and rationale in canonical Composition
  documentation rather than only in history or code comments.

The release gates provide the current evidence: `npm run test:release` passes
39/39 checks, `npm test` passes 23/23 checks, and
`npm run test:editorial-full` passes 506/506 fixtures on 2026-09-09.

## Scope boundary

The bounded loop works without replacing the PDF backend. An unrestricted
global solver, full floats, arbitrary constraints, and full RTL/CJK remain
outside Release 1.0. See the
[feasibility research](research/release-1.0-feasibility-research.md).

Remaining optimization work is documented in Plan 09: structural continuity
weight calibration, decoder limits, and further test feedback reductions without
removing the complete release gate.
