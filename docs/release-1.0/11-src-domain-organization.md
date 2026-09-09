# Plan 11 — domain organization of `server/src`

Status: the first organization stage and first optimization pass are complete;
the remaining items are explicit `composition` seams and legacy audits. The
change must not remove MCP functionality or the optional CLI.

## Migration state — 2026-09-09

The first organization stage was completed without changing the public flow:

- `content`, `brand`, `source`, `template`, `rendering`, `report`, `artifacts`,
  `contracts`, and MCP/CLI interfaces have their own directories;
- bundle entrypoints have been switched to the new locations;
- the architecture guard resolves `.js` imports to `.ts` sources and confirms
  that forbidden cycles are absent;
- `update_plugin` copies all four runtime bundles, both plugin manifests, and
  the complete `server/templates/**` tree from the generated-builtin registry;
- `npm run build` and the full `npm run test:composition` pass on a host that
  permits child processes. In a restricted sandbox, PDF checks may report
  `spawnSync ... EPERM`; that is an environment issue, not a code regression.

This is the organizational checkpoint. Optimization of large modules follows
it; every such change must preserve the same bundles and MCP/CLI tool
contracts.

## Optimization state — 2026-09-09

The first optimization pass did not change data flow or public exports. It
removed two responsibility bags:

| Module | Responsibility after the split | LOC |
| --- | --- | ---: |
| `presentation/svg-renderer.ts` | SVG for one slide | 285 |
| `presentation/pptx-renderer.ts` | PPTX and media deduplication | 327 |
| `presentation/pdf-renderer.ts` | PDF/PNG through rasterization | 127 |
| `presentation/slide-layout.ts` | geometry, RTL, and text fitting | 286 |
| `presentation/slide-validation.ts` | slide-content validation | 18 |
| `presentation/contracts.ts` | deck contracts | 25 |
| `presentation/slides.ts` | stable export facade | 11 |
| `brand/context.ts` | source reading and brand orchestration | 456 |
| `brand/discovery.ts` | recursive template and profile discovery | 34 |
| `brand/theme.ts` | theme/composition resolution | 174 |
| `brand/assets.ts` | asset paths, cache, and warnings | 124 |
| `brand/color.ts` | palette and contrast | 80 |
| `brand/value.ts` | safe document values | 38 |
| `brand/paths.ts` | safe relative paths | 12 |
| `brand/contracts.ts` | `BrandOverrides`, `RenderComposition` | 28 |
| `contracts/render-theme.ts` | shared render-theme contract | 65 |
| `contracts/resolved-slide-plan.ts` | resolved slide plan | 33 |
| `contracts/resolved-report-plan.ts` | resolved report plan | 27 |

The former `slides.ts` (more than 1,000 LOC) and `brand-context.ts` (more than
900 LOC) are no longer places where renderer, layout, assets, and orchestration
are mixed. `slides.ts` remains a compatibility facade, so MCP and CLI do not
need to know the new split. `brand/context.ts` keeps the existing public
operations (`resolveBrandContext`, `inspectBrand`, `listBrandbooks`), while
`brand/discovery.ts` owns recursive directory traversal. Both modules expose
explicit internal seams.

The current `server/src` size is 18,680 TypeScript lines. This is an
orientation metric: the next step is removing duplicate and hand-written
calculations in `composition`, not mechanically splitting every file again.

Verification of this pass:

- `npx tsc --noEmit` — passes;
- `node scripts/architecture-check.mjs` — 110 modules, no forbidden cycles;
- `npm run build` — four bundles and 19 built-in templates;
- `npm run test:composition` on the host — all 13/13 checks pass, including
  oracle, images, contrast, editorial flow, and page limits.

The release gate `npm run test:release` passed **39/39 checks on 2026-09-09**.
The default `npm test` passed **23/23 checks in approximately 122 seconds**.
The separate `npm run test:editorial-full` gate passed **506/506 fixtures in
242.32 seconds on 2026-09-09**; it is not part of the 39-check release gate and
must be reported separately for later snapshots.

The former `public MCP behavior` monolith has been replaced by
`test-public-mcp-contract.mjs`. Its public MCP smoke is now covered by the
current harness; historical references to the old filename describe the prior
state only.

## Product context

`report-baby` is primarily a bundled MCP server. The CLI is a second frontend
to the same operations, not a separate renderer implementation.

```text
MCP:  index.ts → tool registrars → shared operations
CLI:  cli.ts / example.ts / brand-tool.ts → shared operations
```

The model is the same as `meta-ads-baby` and `google-ads-baby`: `index.ts`
starts a long-lived stdio server, while public tools remain available through
stable names and schemas. `report-baby` additionally builds
`cli-bundle.cjs`, `example-bundle.cjs`, and `brand-tool-bundle.cjs`.

Unchanged release contract:

- `server/bundle.cjs` remains the MCP bundle;
- `scripts/start-mcp.js` downloads/builds the bundle only when it is absent;
- `update_plugin` remains a public MCP tool;
- the updater distinguishes the on-disk version from the running process;
- updating is atomic and cannot overwrite a newer local installation;
- the updater copies all MCP/CLI bundles, both plugin manifests, `package.json`,
  the launcher, `CHANGELOG.md`, and `server/templates/**`;
- MCP and CLI use the same contracts and domain operations.

## Organization rules

1. A domain directory groups knowledge, not an accidental file type.
2. Data contracts do not import implementations or MCP/CLI.
3. The MCP registrar is an interface adapter, not the rendering domain.
4. CLI does not import `McpServer` or depend on MCP registration.
5. We do not introduce entities solely to make a file smaller. Existing models
   (`CompositionPlan`, `SlideInput`, `RenderTheme`, `Template`) remain contracts
   or domain values.
6. We do not create `helpers`, `utils`, or generic `types` bags.
7. `composition/` owns planning, placements, and evaluation.
8. `rendering/` knows output formats but does not make planner decisions.
9. Numeric values remain in `server/templates/render-config.yml`.
10. Every file move preserves direct imports; internal barrel exporters are not
    needed.

## Current responsibility split

| Area | Current files | Main risk |
| --- | --- | --- |
| Composition | `composition/**` | closest to the target layout; do not move again without a seam |
| Input/content | `contracts/input/schema.ts`, `content/**` | schema and normalization are separate from composition |
| Template/config | `template/**` | contracts, built-in loading, direction, and geometry share context |
| Brand | `brand/context.ts`, `brand/theme.ts`, `brand/assets.ts`, `brand/asset-preparation.ts` | next seam is template/showcase versus orchestration |
| Source | `source/**` | materialization and source context have a separate contract |
| Presentation | `presentation/**` | layout, SVG, PDF/PNG, PPTX, and validation are split |
| Report | `report/**`, `composition/report-composition-entrypoint.ts` | report renderer and legacy plan are separate from composition |
| Rendering | `rendering/**` | primitives and image resolution do not belong to planners |
| Interfaces | `interfaces/mcp/**`, `interfaces/cli/**` | MCP and CLI registration are separate adapters |

`server/src` currently contains 18,680 TypeScript lines. The largest remaining
modules are `composition/evaluation/legality.ts` (659 LOC),
`composition/layout/flow-text-decision.ts` (588 LOC), `brand/context.ts`
(456 LOC), `composition/evaluation/scoring.ts` (441 LOC),
`composition/adapters/page-template.ts` (422 LOC),
`composition/layout/document-layout.ts` (310 LOC),
`composition/layout/flow-space.ts` (417 LOC), and
`composition/layout/flow-planner.ts` (408 LOC). `text-planner.ts` and
`insertion-layout.ts` are facades at 154 and 17 LOC respectively. Size is not
an independent split criterion; a module's single direction of knowledge and
deep interface matter more.

## Target directory map

```text
src/
├── contracts/
│   ├── render-theme.ts
│   ├── resolved-slide-plan.ts
│   ├── resolved-report-plan.ts
│   ├── input/
│   │   ├── composition.ts
│   │   ├── slides.ts
│   │   ├── brand-source.ts
│   │   └── tool-options.ts
│   └── artifacts/
│       └── manifest.ts
├── content/
│   ├── contracts/normalized-content.ts
│   └── markdown-normalizer.ts
├── template/
│   ├── contracts.ts
│   ├── compiler.ts
│   ├── loader.ts
│   ├── builtins.ts
│   ├── geometry.ts
│   └── direction.ts
├── brand/
│   ├── contracts.ts
│   ├── references.ts
│   ├── documents.ts
│   ├── theme.ts
│   ├── assets.ts
│   ├── templates.ts
│   ├── showcase.ts
│   └── context.ts
├── source/
│   ├── contracts.ts
│   ├── context.ts
│   ├── materialization.ts
│   ├── zip-policy.ts
│   └── transports/
├── composition/
│   └── ... existing map from Plan 10 ...
├── presentation/
│   ├── contracts/
│   ├── planning/
│   │   ├── slide-context.ts
│   │   └── slide-plan.ts
│   ├── layout/
│   │   ├── slide-layout.ts
│   │   └── text-fit.ts
│   └── rendering/
│       ├── slide-svg.ts
│       ├── slide-pdf.ts
│       ├── slide-png.ts
│       ├── slide-pptx.ts
│       └── media.ts
├── report/
│   ├── contracts.ts
│   ├── template-catalog.ts
│   ├── template-resolution.ts
│   ├── composition-runtime.ts
│   ├── chrome.ts
│   ├── debug-overlay.ts
│   ├── renderer.ts
│   └── legacy-plan.ts
├── rendering/
│   ├── fonts.ts
│   ├── pdf.ts
│   ├── raster.ts
│   ├── color.ts
│   ├── image-resolver.ts
│   └── svg/
│       ├── primitives.ts
│       ├── charts.ts
│       └── metric-cards.ts
├── artifacts/
│   ├── manifest.ts
│   └── drawing-recorder.ts
├── application/
│   ├── render/
│   ├── brand-management/
│   ├── update-plugin.ts
│   └── tool-contracts.ts
├── interfaces/
│   ├── mcp/
│   │   ├── server.ts
│   │   ├── render-tools.ts
│   │   ├── brand-tools.ts
│   │   ├── update-tools.ts
│   │   └── responses.ts
│   └── cli/
│       ├── cli.ts
│       ├── example.ts
│       └── brand-tool.ts
└── infrastructure/
    ├── config.ts
    ├── update/
    └── version.ts
```

`application/` is not a new domain. It is the home for operations called by
more than one frontend. MCP and CLI depend on it, but not on each other.

## Function owners

### Presentation

Move from `slides.ts` by responsibility:

- `SlideDeck` and the render model → `presentation/contracts`;
- `slideLayout`, `lockupGeometry`, RTL, boxes, and text fit →
  `presentation/layout`;
- `frame`, SVG text helpers, and `renderSlideSvg` → `rendering/slide-svg`;
- `renderSlidesPdf` and `PdfImage` → `rendering/slide-pdf`;
- `renderSlidesPng` → `rendering/slide-png`;
- `renderSlidesPptx`, header, and footer → `rendering/slide-pptx`;
- `deduplicatePptxMedia` → `rendering/media`;
- `validateSlideContent` → presentation validation, not the renderer.

`SlideInput` (flow-based) and the old archetype-based `Slide` must have
different names. The adapter in `slide-context.ts` remains an explicit,
temporary seam until the old model is removed.

### Brand

Split `brand-context.ts` into documents/profiles, references, theme/colors,
asset paths, brand templates, showcase, and thin `context.ts` orchestration.
`asset-preparation.ts` remains an asset processor; PNG codecs do not belong to
brand context.

### Template

Split `template-contract.ts` into contracts, compiler, loader, and geometry.
`builtin-template-source.ts` becomes the loader for built-ins and configuration,
not the owner of every template contract.

### Report

Split `report-renderer.ts` into catalog and template resolution, chrome, debug
overlay, and PDF orchestration. `report-plan.ts` remains explicitly under
`legacy-plan.ts` until the public response moves completely to
`CompositionPlan`.

### Tools and entrypoints

Registrars in `interfaces/mcp` declare MCP schemas and translate results into
responses. Render, brand-management, and update operations belong in
`application/` and do not know `McpServer`.

`update_plugin` has its own MCP registrar, but semver, download, atomic rename,
and restart messaging are shared operations. It does not move into rendering
or the brand domain.

## Release artifacts and templates

Built-in templates are embedded in
`server/src/generated/builtin-template-files.ts` during
`npm run build:templates`, so a bundle can run without `server/templates`. The
source directory remains important for:

- building and regenerating embedded templates;
- local overrides through `REPORT_BABY_TEMPLATE_DIR`;
- diagnostics and development work;
- installations obtained as a checkout.

Therefore the updater must copy `server/templates/**` together with the
bundles, and the release test must check at least `render-config.yml`,
`slides/standard/template.yml`, and every `pages/*/template.yml`.

Moving `src` sources must not change the names or locations of
`bundle.cjs`, `cli-bundle.cjs`, `example-bundle.cjs`, or
`brand-tool-bundle.cjs`.

## Dependency direction

```text
interfaces/mcp, interfaces/cli
              ↓
        application operations
              ↓
 brand / source / template / content / composition / presentation / report
              ↓
        rendering adapters
              ↓
        infrastructure and files
```

`composition` does not import MCP, CLI, or slide renderers. `rendering` may use
the theme and plan contracts, but not brand orchestration. `contracts` import
no implementations.

## Further-work order

The first nine organizational steps are complete: domain directories,
contracts, brand, presentation, template, rendering, and MCP/CLI adapters now
have explicit boundaries. Further work must not be mechanical file splitting:

1. confirm current public MCP/CLI behavior and resolve the former
   `EMPTY_FLOW_SLOT` case separately;
2. audit `flow-text-decision.ts` and `document-layout.ts` for shared
   calculators, without changing planner decision order;
3. audit `legality.ts` and `scoring.ts` as two different evaluator contexts,
   extracting only seams with their own input/output contracts;
4. remove only confirmed dead paths (the `text-runs.ts` parser has already been
   removed; remaining old models and the legacy plan require a separate audit)
   after measuring coverage and updating tests;
5. at every seam run `tsc --noEmit`, architecture checks, build,
   `npm run test:composition`, and the relevant MCP/CLI/brand/artifact tests.

## Completion boundary

Release 1.0 includes the domain organization and preservation of MCP/CLI
functionality. Documentation and legacy audits are recorded separately.
Optimization follow-ups may reduce duplicate calculations or test cost, but
must preserve the current public flow. Automatic brand lockup materialization,
removal of the legacy fallback, and explicit `paintOrder` remain release 1.1
deferrals and are not implied by this plan.
