# Release 1.1 — explicit paint order

Status: contract proposal; implementation has not started.

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
| [02-layout-variants-and-continuation.md](02-layout-variants-and-continuation.md) | page-template schedule, stable slot names, and removal of `continuation_slots` and `continuation_frame` | Plan 12, dynamic chrome |
| [03-brand-lockup-and-legacy-chrome.md](03-brand-lockup-and-legacy-chrome.md) | automatic lockup from the brand profile and removal of the old renderer fallback | Plans 10–12 |
| [04-planner-search-and-evaluator-calibration.md](04-planner-search-and-evaluator-calibration.md) | multiple moving insertions, bounded solver/global constraints, and evaluator calibration | Plans 02–04 and 09 |
| [05-contract-cleanup-and-test-consolidation.md](05-contract-cleanup-and-test-consolidation.md) | public alias/export audit and further consolidation of expensive tests | 1.0 README, plans 01 and 13 |
| [06-floats-and-text-direction.md](06-floats-and-text-direction.md) | full floats and RTL/CJK | 1.0 README, 1.0 limitations |
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
