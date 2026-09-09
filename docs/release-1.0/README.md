# Release 1.0 — execution plans

## Authoritative status — 2026-09-09

Release 1.0 is green at the release-gate level:

| Gate | Result | Evidence |
|---|---|---|
| `npm run test:release` | PASS | 39/39 checks completed on 2026-09-09 |
| `npm test` | PASS | 23/23 checks completed in approximately 122 seconds |
| public MCP contract | PASS | The public MCP contract is green |

There are no known release-blocking test failures. Points 01–05 are largely
complete within the release scope, point 06 is largely complete, and points
07–09 and 12 are complete for the agreed release scope. Point 13 — the test
artifact cost audit and the move to cheaper assertions — is implemented in the
harness and in the first test migrations.

The first test migration distinguishes 39 checks from the separate editorial
fixture matrix. Default paths now write 34 temporary PDFs instead of 84. The
remaining mixed-test migrations are maintenance work and do not change the
product contract.

The remaining legacy migrations are explicitly deferred. The organization of
modules in points 10–11 was completed as maintenance work without changing the
MCP/CLI contract.

This directory breaks the [main Release 1.0 plan](../release-1.0-flow-composition-plan.md)
into executable documents. The documents describe existing concepts: input,
flow, block, template, geometry, placement, obstacle, planner, evaluator,
renderer, debug, and trace. They do not introduce a new domain model.

The current system contract and decision rationale are maintained in the
separate canonical [Composition](../composition/README.md) directory. This
directory describes work order and completion criteria; it does not replace the
documentation of current behavior.

## Release goal

```text
CompositionInput → flows → planner → placements → evaluator → renderer
```

The release aims to provide one deterministic pass in which:

- the planner calculates placements before drawing;
- the evaluator separates legality from layout quality;
- the planner can prepare bounded alternatives and use feedback;
- the regular PDF renderer, debug output, and `dry_run` describe the same plan;
- adding support for another existing block kind does not require knowledge of
  the old `ReportData` or `Cursor` model.

## Order and dependencies

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
07 additional block kinds and soft insertions
        ↓
08 candidate-search depth
        ↓
09 structure continuity, image formats, and test feedback time
        ↓
10 composition module categories and migration
        ↓
11 domain organization of all server/src
        ↓
12 dynamic page chrome and repeating flow
        ↓
13 audit of test artifacts
```

Points 01–03 are the foundation. Point 04 provides the first actual
optimization. Point 06 should not begin with mechanical splitting of
`planFlow`; tests and a working seam for the loop must exist first.

## Implementation status

| Point | Implementation status | Remaining work |
|---|---|---|
| 01 | largely complete | audit exports, aliases, and remaining legacy paths |
| 02 | complete | shared geometry for frames, placements, obstacles, and chrome |
| 03 | functionally complete | calibrate weights and evaluator edge cases |
| 04 | complete within a limited scope | explicit deterministic moves only; no global solver |
| 05 | largely complete | inline runs and gap tightening; full chrome ownership remains in point 12 |
| 06 | largely complete | maintain the public gate; the known earlier `EMPTY_FLOW_SLOT` and further seams require explicit contracts |
| 07 | complete for current block kinds | new block kinds require a separate capability seam |
| 08 | complete for composition search | JPEG/SVG/WebP/AVIF formats remain in point 09 |
| 09 | complete for the release scope | continuity scoring for lists/tables and small fragments, WebP/AVIF resolution, the image gate, and fast/full test separation are ready; artifact-necessity audit and weight calibration remain optimization work |
| 12 | complete for the release scope | dynamic header with zero frame, fit-content, explicit lockup, repeating footer, and ordering before main are ready; automatic brand lockup and removal of the legacy fallback are intentionally deferred |
| 13 | audit and first reduction complete | 39 unique checks are classified as `not-generated`, `remove`, `retain`, or `split`; the 506-fixture editorial matrix is measured separately; 84→34 written PDFs are reduced to plan-only checks or representatives, while the remaining mixed-check reductions are follow-up maintenance without contract changes |

This table is the authoritative summary. The detailed documents retain the
decision history and completion criteria.

## Documents

1. [Pipeline and contract](01-pipeline-and-contract.md) — one planning result,
   one pass, and repair of the contract harness.
2. [Geometry and shared frames](02-geometry-and-frames.md) — where slots,
   segments, obstacles, flow barriers, and candidate boxes are created.
3. [Evaluator and score](03-evaluator-and-scoring.md) — hard violations,
   legal-layout quality, configuration, and evaluator purity.
4. [Planner–evaluator loop](04-planner-evaluator-loop.md) — bounded candidates,
   feedback, selection of the best legal plan, and cost.
5. [Render, dry_run, and debug](05-render-dry-run-debug-parity.md) — parity
   between the plan, PDF, debug output, and tool response.
6. [Planner maintainability](06-planner-maintainability.md) — safely
   separating responsibilities from the current monolith.
7. [Block kinds and soft insertions](07-block-kinds-and-soft-insertions.md) —
   further extension to KPIs, charts, graphics, and quotes.
8. [Candidate-search depth](08-candidate-search-depth.md) — checking whether
   coarse positions and local refinement search accurately enough without
   uncontrolled cost growth.
9. [Structure continuity and image formats](09-structure-penalties-and-image-formats.md) —
   penalties for splitting lists and tables, WebP/AVIF, and final optimization
   of test feedback time.
10. [Composition module categories and migration](10-composition-module-migration.md) —
    target directory map, responsibility owners, and file-move order without a
    `runtime/` directory.
11. [Domain organization of all `server/src`](11-src-domain-organization.md) —
    the map outside `composition/`, MCP-first operation, optional CLI,
    release artifacts, and safe template migration.
12. [Dynamic page chrome and repeating flow](12-dynamic-page-chrome.md) —
    content-driven header/footer, existing page-number placeholders, ordering
    relative to insertions and `main`, and full chrome projection from the plan.
13. [Test-cost audit](13-test-cost-audit.md) — inventory of every check, the
    decision whether its artifact can be removed or reduced, and suite timing.

## Release blockers

No release blocker is currently identified by the passing release gates. The
following remain explicit follow-up items, but they do not block the current
1.0 contract:

- auditing public exports and aliases before any breaking change;
- calibrating evaluator weights and edge cases;
- confirming the complete schema-to-backend path for every current block kind;
- finishing the remaining mixed-test cost reductions without weakening
  assertions.

## Accepted Release 1.0 limitations

Research showed that the bounded loop is feasible without replacing the PDF
backend. Release 1.0 does not include a global solver for the whole document,
arbitrary constraints, full float support, or RTL/CJK. The current release also
accepts that automatic brand lockup and removal of the legacy chrome fallback
are not complete.

These are explicit limitations of the accepted 1.0 scope, not hidden
implementation decisions. Details and sources are in the
[feasibility report](../research/release-1.0-feasibility-research.md).

## Explicitly deferred to Release 1.1

The following work is intentionally not part of Release 1.0:

- a global document solver and arbitrary cross-page constraints;
- full float and advanced text-direction support, including RTL/CJK;
- automatic brand-lockup generation and final removal of the legacy chrome
  fallback;
- breaking removal of public exports or input aliases after call-site evidence
  and a migration path are available;
- further test-suite consolidation beyond the current plan-only and
  representative-artifact split.

If a document says that a point “requires completion after X”, that is not a
hidden implementation decision. It means that the current code does not yet
provide a safe basis for specifying that detail, so it must be clarified after
the referenced point is complete.
