# Release 1.1 — explicit paint order

Status: implementation backlog. Item 02 is complete and released in 1.0.1;
the remaining items below are contract proposals with implementation work still
to be scheduled.

Release 1.0 focuses on geometry: `priority` expresses how strongly a placement
claims an earlier reservation and materialisation of space. When a migrated
template omits the value, it comes from `composition_priority.default` in YAML
(currently `100`), never from a code-level `0`. The physical PDF drawing order
remains the 1.0-compatible baseline.

An explicit, configurable paint order is a separate Release 1.1 scope and is
described in [01-paint-order-contract.md](01-paint-order-contract.md).

## Consolidated Release 1.1 scope

The documents below collect topics explicitly deferred in the Release 1.0
documentation. They are separate contracts and migration tasks; they do not
change the completed 1.0 plan.

| Document | Scope | Deferral source |
|---|---|---|
| [01-paint-order-contract.md](01-paint-order-contract.md) | explicit backend paint order, independent from `priority` | Plan 12, paint-order section |
| [02-layout-variants-and-continuation.md](02-layout-variants-and-continuation.md) | **complete in 1.0.1:** page-template schedule, stable slot names, and removal of `continuation_slots` and `continuation_frame` | Plan 12, dynamic chrome |
| [03-brand-lockup-and-legacy-chrome.md](03-brand-lockup-and-legacy-chrome.md) | automatic lockup from the brand profile and removal of the old renderer fallback | Plans 10–12 |
| [04-planner-search-and-evaluator-calibration.md](04-planner-search-and-evaluator-calibration.md) | multiple moving insertions, bounded solver/global constraints, and evaluator calibration | Plans 02–04 and 09 |
| [05-contract-cleanup-and-test-consolidation.md](05-contract-cleanup-and-test-consolidation.md) | public alias/export audit and further consolidation of expensive tests | 1.0 README, plans 01 and 13 |
| [06-floats-and-text-direction.md](06-floats-and-text-direction.md) | full floats and RTL/CJK | 1.0 README, 1.0 limitations |
| [08-diagnostics-and-remediation.md](08-diagnostics-and-remediation.md) | explanatory diagnostics, actionable remedies, and skill/CLI/MCP guidance | Release 1.0 test and planner follow-up |
| [09-pdf-aesthetic-rules.md](09-pdf-aesthetic-rules.md) | measurable PDF spacing rules, dynamic intro/header behavior, and aesthetic evaluator feedback | editorial artifact review |
| [10-empty-space-and-placement-optimization.md](10-empty-space-and-placement-optimization.md) | detect unexplained whitespace and choose better legal placements using plan geometry | editorial artifact review |
| [11-document-layout-contract.md](11-document-layout-contract.md) | replace `page_template_schedule` and route-level `layouts` with one document `layout` that assigns templates to page ranges | terminology and ownership follow-up to 02 |
| [runtime-plan-annotations.md](runtime-plan-annotations.md) | runtime-only plan decisions, traces, diagnostics, and their lifecycle | 02 layout migration |

Each document remains a proposal until a separate decision is made about its
contract and acceptance criteria. The mere presence of a field in code is not
evidence that the scope is ready.

## Candidate after 1.1

The repository has no approved Release 1.2 scope. The only unambiguous note
points to full visual calibration after dynamic chrome and lockup migration.
It is collected as a candidate in
[07-visual-calibration.md](07-visual-calibration.md). It is not treated as a
1.1 execution task until a separate decision is made.

## Implementation workstreams

The numbered documents are product contracts; the following workstreams are
the implementation units. They prevent the same evaluator, template adapter,
or test fixture from being redesigned independently in several tasks.

### A. Document layout vocabulary (11)

Current code already selects page geometry through `page_template_schedule`,
`CompositionTemplate.layouts`, and the transitional
`CompositionFlowRoute.layouts`. Implement the singular document `layout`
contract in the order described by
[11-document-layout-contract.md](11-document-layout-contract.md): migrate the
input schema and adapters, move MCP/CLI plumbing, remove route-owned selection,
then migrate fixtures and diagnostics. Item 02 remains the behavioural
reference; its completed document is not edited by this workstream.

### B. Renderer execution order (01)

Add the typed YAML phase list and an internal PDF `RenderCommand` normalizer,
then replace the separate-array loop in
`server/src/composition/adapters/pdf/backend.ts`. The plan, planner priority,
and legality checks stay unchanged. This workstream can start after the layout
contract names are frozen and must preserve the current default command order.

### C. Dynamic chrome and lockup (03, with 07 as a later candidate)

The lockup capability and fit-content slots already exist, while automatic
brand materialisation and the old renderer fallback still coexist. First make
the brand/template adapter emit the explicit lockup, migrate every supported
template, and only then remove the fallback. Full cross-brand visual tuning is
the separate, not-yet-approved candidate in item 07.

### D. Diagnostics, aesthetic scoring, and placement search (08–10)

Items 08, 09, and 10 are one implementation plan with three layers:

1. extend the renderer-neutral diagnostic and geometry evidence contract;
2. calculate spacing, fragmentation, empty-region, and fit-content signals and
   turn negative signals into remediation suggestions; and
3. feed those signals into the existing bounded candidate selection loop.

The shared seams are `engine-contracts.ts`, `evaluation/{legality,evaluator,
scoring,plan-queries}.ts`, `observability/{spacing-report,planning-observability}.ts`,
`layout/{planner-candidates,insertion-planning,insertion-placement}.ts`, and
the CLI/MCP response adapters. Do not create a second evaluator or silently
move authored placements. Thresholds and penalties belong in
`server/templates/render-config.yml`.

Item 04 consumes this workstream's stable score/evidence model when it expands
the search space. Its solver changes remain separately gated and bounded.

### E. Public contracts and test cost (05)

After each contract workstream, audit exports and aliases, split mixed tests
into plan-only and minimal-backend proofs, and merge only tests that assert the
same contract. The harness and timing registry are the source of truth for
cost; MCP, CLI, brand, and release gates remain fail-closed.

### F. Floats and writing systems (06)

This is independent functional scope after the geometry and evidence seams are
stable: define obstacle/return-to-column and direction contracts in the model,
text layout, evaluator, debug projection, and backend, then add plan-only RTL,
CJK, and float proofs before any artifact test.

## Ordered implementation sequence

1. Freeze the document `layout` vocabulary and migrate the input/adapter
   plumbing (11).
2. Introduce explicit paint phases while keeping the 1.0 default order (01).
3. Materialise lockups from brand profiles and remove migrated-template
   fallbacks (03).
4. Implement the shared 08–10 evidence/scoring/placement workstream.
5. Expand bounded candidate search and calibrate weights against the editorial
   corpus (04).
6. Audit public contracts and consolidate test execution (05).
7. Implement floats and RTL/CJK only after their geometry contract is explicit
   (06).
8. Consider promoting visual calibration (07) once the preceding mechanisms
   have stable baselines.
