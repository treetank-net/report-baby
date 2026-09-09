# Plan 10 — `composition` module categories and migration

Status: mostly complete. The target `composition/` map and adapter migration
are in place. Remaining work is a behavior audit and deliberate removal of
legacy paths.

## Objective

Organize `server/src/composition` by responsibility and dependency direction,
without introducing new domain entities or changing planner behavior. The
`runtime/` directory is not created: the public runtime remains directly under
`composition/`.

The migration joins functions that share the same domain knowledge even when
they currently live in several files and are called from different places. We
do not split files solely by line count, and we do not create ownerless
`helpers`, `utils`, or `types` bags.

## Target directory map

```text
server/src/composition/
├── contracts/
│   ├── model.ts
│   ├── engine-contracts.ts
│   ├── flow-planning.ts
│   ├── planner-policy.ts
│   └── pdf.ts
├── geometry/
│   ├── rectangles.ts
│   ├── visual-geometry.ts
│   └── glyph-geometry.ts
├── text/
│   ├── tokenization.ts
│   ├── text-layout.ts
│   └── style-name.ts
├── layout/
│   ├── page-state.ts
│   ├── flow-space.ts
│   ├── plan-lines.ts
│   ├── insertion-layout.ts
│   ├── flow-planner.ts
│   ├── flow-text-decision.ts
│   ├── document-layout.ts
│   ├── text-planner.ts
│   ├── planner-candidates.ts
│   ├── movable-placement-validation.ts
│   ├── movable-placement-frames.ts
│   ├── graphic-planning.ts
│   ├── structured-block-placement.ts
│   └── glyph-objects.ts
├── evaluation/
│   ├── evaluator.ts
│   ├── content.ts
│   ├── legality.ts
│   ├── scoring.ts
│   ├── diagnostics.ts
│   ├── plan-queries.ts
│   └── contrast.ts
├── observability/
│   └── planning-observability.ts
├── adapters/
│   ├── input.ts
│   ├── page-template.ts
│   ├── render-config.ts
│   ├── text-engine.ts
│   └── pdf/
│       ├── backend.ts
│       ├── text.ts
│       ├── image.ts
│       ├── metric.ts
│       ├── chart.ts
│       └── table.ts
├── composition-engine.ts
├── report-composition-entrypoint.ts
└── index.ts
```

No `index.ts` files are added inside the subdirectories. Direct imports must
expose the real dependency. Existing `composition/index.ts` remains the only
public facade when package consumers require one.

## Responsibility owners

### `contracts/`

Types and interface declarations only. This directory must not import runtime,
adapters, or the evaluator.

- `model.ts` — blocks, pages, slots, layouts, plans, and placements;
- `engine-contracts.ts` — engine, evaluator, planner, and backend interfaces;
- `flow-planning.ts` — `FlowPlanningContext`, `FlowRuntime`, `FlowTarget`, and
  related flow-state records;
- `planner-policy.ts` — planner input types and policy;
- `pdf.ts` — style, asset, renderer, and PDF capability adapter contracts;
  the jsPDF implementation must not own these types.

Engine contracts live in `contracts/engine-contracts.ts`, while orchestration
lives in `composition-engine.ts`. The thin compatibility path `engine.ts` has
been removed; new modules import contracts directly from `contracts/` or the
implementation from its proper seam.

### `geometry/`

Pure spatial and visual calculations only. Functions do not mutate the plan,
page, or slots.

- `rectangles.ts` — `rectBottom`, intersections, overlap, and containment;
- `visual-geometry.ts` — image and graphic geometry (`graphic-geometry` and
  `image-geometry`);
- `glyph-geometry.ts` — pure glyph-sampling boxes (`glyph-sampling`).

If a function knows `CompositionPlan`, `PageState`, or a flow, it does not
belong in this directory, even if it returns a rectangle.

### `text/`

Text knowledge: tokenization, metrics, wrapping, and placement calculations.

- `tokenization.ts` — the single owner of `wordsOf` and derived tokens;
- `text-layout.ts` — the combination of `text-measurement`, `text-wrapping`,
  `text-placement`, and `line-capacity`;
- `style-name.ts` — mapping a block kind to a style name.

`text-layout.ts` may remain a larger module, but its functions must each have
one responsibility: measurement, wrapping, capacity, or materialization.

### `layout/`

Document-layout state and rules.

- `page-state.ts` — the combination of `page-management`, `route-slots`,
  `flow-cursor`, and `slot-growth`;
- `flow-space.ts` — the combination of `flow-occupancy` and `flow-barriers`;
- `insertion-layout.ts` — the combination of `insertion-planning` and
  `insertion-order`;
- `flow-planner.ts` — orchestration of one flow;
- `flow-text-decision.ts` — text decision rules;
- `document-layout.ts` — the complete document-planning cycle;
- `text-planner.ts` — public orchestration of candidate generation and plan
  selection;
- `planner-candidates.ts` — creation and refinement of variants;
- `movable-placement-validation.ts` — shared frame and candidate-count
  validation for movable insertions and authored graphics; it does not generate
  variants;
- `movable-placement-frames.ts` — materialization of result frames from policy
  and measured proposals; it does not decide legality or choose positions;
- `graphic-planning.ts` — graphic planning;
- `structured-block-placement.ts` — placement of tables, KPIs, and other
  atomic blocks;
- `glyph-objects.ts` — materialization of authored/generated glyph placements;
  it remains in layout because it knows `CompositionPlan` and mutates its
  result.

We do not merge all of `flow-planner.ts` and `flow-text-decision.ts`: the first
coordinates a flow, while the second implements decision policy. We also do
not merge `document-layout.ts` with `text-planner.ts`, because that would
recreate the former god module.

### `evaluation/`

The evaluator remains read-only with respect to the plan.

- `content.ts` — content completeness and continuity;
- `legality.ts` — hard requirements and legality;
- `scoring.ts` — quality of a legal plan;
- `contrast.ts` — contrast measurement and raster sampling;
- `diagnostics.ts` — diagnostic construction;
- `plan-queries.ts` — named queries against the plan artifact;
- `evaluator.ts` — orchestration.

`evaluation-support.ts` is not a target module. Every function from that file
belongs in its proper owner instead of another generic helper bag.

### `observability/`

`planning-records` and `planning-trace` form one observability module. Decisions
are recorded through `recordFlowDecision`; callers pass the existing context,
not a synthetic decision object.

### `adapters/`

Adapters translate external data into composition contracts and do not contain
layout-selection rules.

The PDF adapter implementation was the largest bag. It is divided by backend
capability into `pdf/backend`, `pdf/text`, `pdf/image`, `pdf/metric`,
`pdf/chart`, and `pdf/table`. Each adapter implements the existing contract;
the planner does not import jsPDF.

These capability contracts live in `contracts/pdf.ts`. The implementation is
split into capability modules; the capability assembly function remains in
`adapters/pdf/backend.ts` because it is backend orchestration, not a type
contract.

### Runtime in `composition/`

`composition-engine.ts` and `report-composition-entrypoint.ts` remain directly
under `composition/`. They are composition points, not a separate directory
domain. `index.ts` exports only the public contract.

## Dependency rules

```text
contracts
   ↓
geometry / text
   ↓
layout
   ↓
evaluation / observability
   ↓
composition-engine
   ↑
adapters
```

- contracts do not depend on implementations;
- geometry and tokenization are pure;
- layout may mutate planning state;
- the evaluator reads the plan but does not change it;
- observability records decisions and diagnostics through an explicit seam;
- adapters depend inward, never the reverse;
- imports are direct, without internal barrel exporters.

## Migration order

### Stage 0 — protection

1. Preserve the current commit as a reference point.
2. Generate an inventory of imports and public exports.
3. Run composition tests before the first move.

### Stage 1 — contracts

1. Create `contracts/`.
2. Move types from `flow-planning-types.ts` to `contracts/flow-planning.ts`.
3. Separate engine types from implementation; remove the temporary `engine.ts`
   facade after switching importers.
4. Update imports without changing public names.

### Stage 2 — pure calculations

1. Standardize `wordsOf` in `text/tokenization.ts`.
2. Move shared rectangle geometry to `geometry/rectangles.ts`.
3. Join visual and glyph geometry.
4. Run tests after every logical seam.

### Stage 3 — text and layout

1. Join text modules in `text/text-layout.ts`.
2. Join page state in `layout/page-state.ts`.
3. Join occupancy and barriers in `layout/flow-space.ts`.
4. Join insertion planning and ordering in `layout/insertion-layout.ts`.
5. Only then move functions that remain in `flow-planner.ts`.

### Stage 4 — evaluator and observability

1. Remove `evaluation-support.ts` by distributing its functions.
2. Move trace and records to `observability/`.
3. Keep the evaluator read-only with respect to the plan.

### Stage 5 — adapters and runtime

1. Split `js-pdf-adapter.ts` by capability.
2. Separate contract and implementation from the former engine facade.
3. Move adapters to `adapters/` and keep runtime directly in `composition/`.

## Criteria for every step

- no change to public planner behavior;
- no new domain entities;
- no adapter import into pure geometry or contracts;
- no duplicate `wordsOf` or basic geometry operations;
- no decision objects constructed in caller functions;
- TypeScript, composition, and architecture tests pass;
- each change is a small, reproducible commit.

## Completed stages

- `bf7a31c` — recorded this plan and corrected the target: runtime remains
  directly in `composition/`;
- `33ba4f9` — moved `flow-planning-types.ts` to
  `contracts/flow-planning.ts`;
- `73019a0` — moved the existing evaluator modules to `evaluation/`;
- `74671e7` and `ca753e0` — moved text modules to `text/`, created shared
  tokenization, joined image and graphic geometry in
  `geometry/visual-geometry.ts`, and removed old paths;
- `4b4f65d` — moved page-state, flow-space, and insertion modules to `layout/`
  and extracted `contracts/layout-state.ts`;
- `182056a` — joined page management, route slots, cursor, and slot growth in
  `layout/page-state.ts`;
- `22e4664` — joined flow occupancy and barriers in `layout/flow-space.ts`;
- `24eb756` — joined insertion planning and ordering in
  `layout/insertion-layout.ts`;
- `9fa1f70` — distributed the former `evaluation-support.ts` bag into
  diagnostics, plan queries, and legality geometry;
- `e3cd97a` — moved the jsPDF implementation to `adapters/pdf/`;
- `3f0ff4b` — extracted PDF adapter contracts to `contracts/pdf.ts` and
  detached types from the jsPDF implementation;
- `7b0c43d` — split PDF implementation by capability into `backend.ts`,
  `text.ts`, `image.ts`, `metric.ts`, `chart.ts`, and `table.ts`; removed the
  monolithic `js-pdf-adapter.ts` and updated imports to the concrete owners;
- `64a65c9` — separated engine contracts from implementation: types moved to
  `contracts/engine-contracts.ts`, orchestration to `composition-engine.ts`;
- `7f29533` — joined measurement, wrapping, capacity, and line materialization
  in `text/text-layout.ts`; `tokenization.ts` and `style-name.ts` remained
  independent pure modules, with dependencies expressed through
  `WrappedLine[]`;
- `ae7df91` — moved planner policy and movable-frame types to
  `contracts/planner-policy.ts`; candidate implementations no longer own the
  policy contract;
- `033883c` — organized remaining modules by target domain: flow, document,
  graphic, structured-block, planner-candidates, and text-planner moved to
  `layout/`; the evaluator received `content.ts`, `legality.ts`, and
  `scoring.ts`, and records and trace were joined in
  `observability/planning-observability.ts`;
- `ea333ea` — separated glyph sampling from object materialization: pure
  calculations moved to `geometry/glyph-geometry.ts`, while plan-mutating
  functions moved to `layout/glyph-objects.ts`;
- `67e3e3c` — documented glyph-module ownership and the rule that functions
  knowing `CompositionPlan` do not belong in pure geometry;
- `1ab6867` — refreshed inventory so it recursively scans current
  `composition/**/*.ts`, ignores nonexistent historical targets, and reports
  current evaluator paths correctly;
- `bbcddf8` — moved input, template-geometry, renderer-configuration, and text
  engine assembly adapters into `composition/adapters/`: `input.ts`,
  `page-template.ts`, `render-config.ts`, and `text-engine.ts`;
- `adc11c8` — removed old adapter paths after switching all imports;
  `6116673` — updated the canonical module map and configuration/block-kind
  documentation;
- Current seam cleanup — shared plan-line projection moved to
  `layout/plan-lines.ts`, block-text reading is shared by text and
  observability, `pdfNumber` has one owner in the configuration adapter, and
  `insertionKey` is shared by insertion planning and candidates. Flow and
  planner-phase decisions are recorded through
  `recordFlowDecision`/`recordPlanDecision`; callers no longer construct
  decision objects;
- Current contract closure — the renderer-neutral document model moved to
  `contracts/model.ts`, and the unused compatibility facade `engine.ts` was
  removed.

## Release status and verification

The composition module migration is complete for release 1.0. Documentation
and legacy-path audits remain separate follow-up work; they do not reopen the
completed module move. Optimization follow-ups may reduce duplicated work or
test cost, but must preserve the established public flow.

The release gate `npm run test:release` passed **39/39 checks on 2026-09-09**.
The default `npm test` passed **23/23 checks in approximately 122 seconds**.
The separate `npm run test:editorial-full` gate passed **506/506 fixtures in
242.32 seconds on 2026-09-09**; it is not included in the 39-check release
gate and must be reported separately for later snapshots.

`npx tsc --noEmit` and `node server/scripts/architecture-check.mjs` passed
during the migration. The release test includes the current composition,
transport, and artifact contracts. In a restricted sandbox, PDF tests may
still report `spawnSync ... EPERM`; that is an environment limitation and must
be distinguished from a code regression.

## Migration closure and deliberate seams

Analysis of shared calculations in `flow-planner.ts` and
`flow-text-decision.ts` found no safe function that could be joined without
mixing cursor state, slot selection, and text rules. Shared operations already
live behind `page-state.ts`, `flow-space.ts`, `text/text-layout.ts`, and
`observability/planning-observability.ts`; the two planners remain separate
orchestration modules.

The queue of seven functions above 80 lines was reviewed. Each has one coherent
responsibility behind its own interface (template adapter, structured-block
placement, style/PDF adapter, or wrapping algorithm), so it is not split
mechanically. Keeping these as deep modules is deliberate; further splitting
would require a new interface variant or a second adapter that does not exist.

Public exports still pass through the single facade `composition/index.ts`.
After each seam we check compilation, architecture, and the relevant
composition suite.

The former full-test failure note for `public MCP behavior` is historical. The
monolithic test was replaced by `test-public-mcp-contract.mjs`; its MCP smoke
is now covered by the current release gate. Any future failure must be recorded
against the current named test rather than the removed file.

### Current inventory

`server/scripts/planner-function-dependency-report.mjs` scans the current
`composition/` subtree, collects signatures, return values, local-function
calls, and imports, and shows final fan-out against target modules. The report
is stored in `planner-function-dependency-inventory.md`; regenerate it before
the next move with:

```sh
node server/scripts/planner-function-dependency-report.mjs \
  --write-report docs/release-1.0/planner-function-dependency-inventory.md
```

The current snapshot contains 406 named functions in 39 files. The function
size table is a lower bound, not a promise of LOC reduction: relocation is
decided by shared domain knowledge and dependency shape. Including directory
annotations, the largest current modules are `evaluation/legality.ts`
(659 LOC), `adapters/page-template.ts` (422 LOC), `flow-text-decision.ts`
(588 LOC), `text/text-layout.ts` (525 LOC), `insertion-layout.ts` (455 LOC),
`flow-space.ts` (415 LOC), and `flow-planner.ts` (408 LOC). Further work should
look for duplicate calculations, not mechanically cut functions merely to
reduce line count. After removing repeated projections and inventory wrappers,
the inventory shows one potential duplicate group (two typed candidate
wrappers), seven functions above 80 lines, and zero functions without an owner
annotation.

## Deferred to release 1.1

Automatic brand lockup materialization from a brand profile, removal of the
legacy renderer fallback, and an explicit `paintOrder` contract are not release
1.0 work. They require separate contracts and visual compatibility decisions;
they must not be smuggled into the completed composition-module migration.
