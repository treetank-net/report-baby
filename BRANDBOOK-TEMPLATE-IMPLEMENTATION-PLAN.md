# Brand-owned template implementation plan

## Goal

Move from the current brands, profiles, showcases, standalone runner, and
closed renderer catalog to a system where:

1. a slide or page template is a versioned file in an external brandbook;
2. an LLM can create, improve, and prototype it through a standalone tool;
3. a validator catches overflow, overlap, contrast, missing assets, and bad
   relationships before publication;
4. one compiler creates a plan used by SVG, PDF, PNG, and PPTX;
5. the showcase tests both brand values and template geometry;
6. the MCP server remains a read-only deterministic consumer;
7. drafts, publication, and rollback do not create hidden MCP state.

“Done” means one template has completed the full path:

```text
source template → validate → compile → showcase → render all formats
→ LibreOffice round-trip → visual/automatic QA → publish snapshot
→ MCP read-only render
```

## Ordering decision

Do not start by designing the final YAML language. First inventory the existing
renderers and extract a temporary neutral data representation. This preserves
existing numbers, spacing, and behavior while distinguishing historical
hardcoding from a good public contract. The inventory must identify templates,
chrome, content primitives, and renderer fallbacks.

## Sol review rules

Sol reviews scope and quality, rather than implementing a second solution. At
each stage provide the diff, plan, example brand/template, validation and test
results, rendered output, and deferred decisions.

Sol answers:

1. Is this the smallest mechanism solving a real case?
2. Is the correction local and easy for an LLM to make?
3. Is there one compiler and one plan rather than parallel paths?
4. Is showcase/QA evidence that the abstraction is needed?

Each review ends with **accept**, **tasks**, or **stop**. Do not begin the next
stage until the previous stage is accepted.

## Stage 0 — inventory and contract freeze

### 0A. Inventory existing code

Describe what already works without immediately rewriting it as YAML. Record
all numbers, colors, sizes, drawing order, content limits, and fallbacks from
PDF, SVG/PNG, and PPTX renderers. Each value gets a source location and status
`legacy-fact` or `candidate-default`.

Classify the implementation into:

1. tokens and brand values;
2. chrome: lockup/logo, title, header, footer, pagination, and rules;
3. content archetypes: title, metrics, chart, table, narrative, conclusions;
4. page layout: columns, full-width chart, card grid, and similar geometry;
5. renderer fallback or safety behavior.

`slides/title` is an archetype/template, `dark-band` may be a chrome variant,
and `metrics` is a content component. Not every existing `if` branch deserves
its own public template.

Create an internal `ExistingTemplateCatalog` with surface, canvas, regions,
slots, geometry, style roles, limits, and provenance. It is transitional, not
the user-maintained source format.

The catalog must cover the two PDF templates, three existing slide references,
six slide archetypes, and all surface/chrome variants currently scattered
through the renderer. Fix historical cards or tables only when they block the
fixture used by the first vertical slice; track the rest separately.

### 0B. Authoring knowledge

Turn the inventory into a short guide explaining safe areas, hierarchy, reading
order, region/slot/grid/template choices, long titles, missing optional content,
capacity, contrast, drawing order, images over text, color variants versus new
compositions, and showcase data that demonstrates real diversity.

**Gate:** stop if the team cannot tell which behavior belongs to a template and
which is a renderer fallback, or if extraction only copies hardcoded values into
YAML without named regions and semantic roles.

## Stage 1 — minimal vertical slice

Build one synthetic fixture rather than a full DSL. The first `slides/title`
template supports named regions, normalized frames, a title/subtitle/lockup and
graphic, line limits, and `reject` or `shrink-to-fit` overflow. RTL, rich
relations, and dark variants follow only after the basic path works.

The lifecycle must already be real:

```text
template.yml → parser/validator → compiler → resolved plan
→ SVG/PNG/PDF/PPTX renderers → showcase case → diagnostics
```

Acceptance requires that moving the title changes only `template.yml`, no
template box remains hardcoded in `slides.ts`, invalid frames and long content
are rejected or fitted, logo/title/subtitle/graphic do not overlap, and PDF,
PPTX, and PNG agree with the plan. Full round-trip QA and production rollback
are later gates, not reasons to fake a larger first slice.

## Stage 2 — deep compiler seam

Extract one small interface:

```ts
compileTemplateSource(source): CompiledTemplate
resolveDocumentPlan(compiled, profile, data): ResolvedDocumentPlan
renderDocumentPlan(plan, format): Artifact
```

The snapshot is independent of one render's data. The resolved plan is created
only after snapshot, profile, surface, and data are combined. It owns template
registry lookup, input validation, data binding, direction, safe areas, text
fit/overflow, physical boxes, text lines, and render order.

SVG/PDF/PPTX adapters must not recalculate layout or contain brand-specific
branches. Mutation tests must prove that changing one region affects every
renderer and that final font names and lines agree.

**Gate:** stop if a second geometry system appears, if `slides.ts` still owns
template positions, or if adding a template requires renderer-specific edits.

### Immediate visual-parity tasks

The first review of the generated Trans.eu deck exposed two concrete gaps that
belong to this stage:

1. the colour-band height and its separator must come from the same header
   region; a coloured header must not receive a second separator unless the
   template explicitly asks for one;
2. image slots must declare the small, finite set of behaviour needed by real
   brandbooks: `fit: cover|contain`, an optional normalized `focal_point`, and
   optional opacity. The same resolved image box must feed SVG, PDF and PPTX.

The existing renderer has now received the first safety fixes for these cases.
The remaining work is to make the image rules part of the brand-owned source
template and to migrate the Trans.eu examples off the legacy fallback layouts.

## Stage 3 — small vocabulary and page families

Extend the language only when the slice proves a concrete need. Add, in order:

1. title/hero and content blocks;
2. metric grids and repeated cards;
3. charts and tables;
4. narrative/highlight blocks;
5. columns and editorial composition;
6. shared chrome fragments: lockup, footer, and pagination.

PDF is not one universal template. Migrate `default-report` and
`campaign-summary`, then add a three-column or editorial page only as a
separate family with its own slots, showcase data, and limits. Do not create a
“super-template” with dozens of optional fields. Title, metrics, and table
slides may share chrome and tokens without sharing all geometry.

Relations remain a closed vocabulary (`within`, `after`, `before`, `align`,
`gap`, and similar). Do not build a general expression language or equation
solver. Add a primitive only for a second real use case or when the current
primitive cannot handle a fixture without an exception.

## Stage 4 — showcase and per-region QA

Every template receives `cases.yml` with a baseline, minimal data, maximum
capacity, long title/text, every optional slot absent, supported LTR/RTL,
difficult image contrast, and missing asset/font cases.

Extend QA beyond global pixel differences with per-slot/per-region diagnostics:
expected region, forbidden intersections, overflow result, required-element
visibility, plan-to-SVG/PDF/PPTX agreement, and no difference after the
LibreOffice PPTX → PDF → PNG round-trip. Every template must pass automatic
gates and a critical contact-sheet review.

## Stage 5 — standalone brand-tool and lifecycle hardening

Grow a separate bundle/CLI, not another mutating report-baby MCP tool:

```text
brand init
brand template init
brand validate
brand template inspect
brand preview
brand qa
brand publish
brand rollback
```

Runtime needs Node, not npm. The CLI uses the same core as MCP. Working trees
may contain drafts; MCP receives only a published snapshot.

Publication validates the brandbook, compiles templates, runs showcase and
round-trip QA, records source/asset/compiler hashes, writes an immutable
release, switches `active.json`, and supports rollback with a release diff.
The minimal local slice already has basic validate/preview/publish flow; full
QA, round-trip, rollback, remote registry, approvals, and draft cleanup remain
separate work.

## Stage 6 — MCP as read-only consumer

MCP accepts `brand_ref`, `template_ref`, surface, content/data, safe overrides,
and direction/locale when supported. Discovery tools are
`list_brandbooks`, `inspect_brand`, `list_brand_templates`, and
`inspect_brand_template`. Mutations belong to the brand owner, such as
`marketing-context-mcp`.

## Stage 7 — examples and documentation

After the vertical slice passes:

- move one neutral showcase to a brand-owned `template.yml`;
- migrate other examples only when fixtures prove a new primitive is needed;
- remove claims that composition belongs only to the renderer;
- keep all QA outputs outside the repository;
- keep synthetic brands, but never add customer brands.

## Explicitly deferred

- full constraint solver/Cassowary;
- arbitrary expressions and YAML conditions;
- mutating report-baby MCP tools;
- remote registry and multi-user collaboration;
- automatic full-composition inference from PDF/PPTX/vibes.

## Procedure for each round

1. Choose one small stage and one fixture.
2. Change code/documentation without expanding scope in parallel.
3. Run tests, render, showcase, and LibreOffice round-trip for PPTX.
4. Inspect images critically and collect diagnostics.
5. Send Sol the diff, plan, outputs, and an acceptance question.
6. Perform only bounded tasks or close the stage.
7. If Sol has no further tasks, do not add another abstraction.

Sol should say “stop, unnecessary” when a change is an exception for one case,
adds an MCP mutation, duplicates geometry, or does not improve correction
locality, renderer parity, QA, or lifecycle.

## Current status

| Area | Status |
| --- | --- |
| Node-only renderer using shared bundle | prototype exists |
| PDF/PPTX/PNG QA and LibreOffice | procedure and tests exist; converter must be available |
| Closed renderer templates | exist |
| Existing layout inventory | complete; transitional catalog and docs exist |
| Brand-owned `template.yml` | first slice works for `slides/title` |
| Brand-owned metrics template | accepted for `slides/metrics-3`, including card/body/callout and header/footer regions |
| `CompiledTemplate` → `ResolvedDocumentPlan` compiler | first title slice works; full document plan does not yet |
| Standalone `brand-tool` | `validate`, `template inspect`, `preview`, and `publish` work; scaffolding and full QA remain |
| Publish snapshot/rollback | local immutable publish works; rollback remains |
| Read-only MCP template discovery | `list_brand_templates` and `inspect_brand_template` work |
| Header/image parity review | Band boundary and PPTX logo placement fixed; image-slot `fit`/focal-point source fields remain to be wired into brand-owned templates |
| External renderer defaults | Shared spacing, typography and component defaults load from `server/templates/render-config.yml`; built-in slide recipes load from `server/templates/slides/` |
| Slide-only two-column family | `slides/two-column` fallback renders through the shared plan to PDF, PNG and PPTX; A4 column flow remains intentionally unspecified |

### Last gate

The first vertical slice was accepted after fixing card/table text placement,
incomplete PPTX frame use, and weak text-boundary checks. Tests now isolate the
effect of each frame on PNG and PPTX. The `slides/metrics-3` slice was also
accepted: long data is rejected instead of escaping a card, header/footer
regions control separators and footers, and the PDF test covers a section
crossing onto another page.

### Next step

The inventory, first recipe catalog, `slides/title`, and `slides/metrics-3` are
complete and accepted. The fallback geometry/default-token extraction and the
slide-only `slides/two-column` fixture are now also in the shared runtime path.
The next family is a PDF document variant, without
copying geometry between renderers. Do not extend the language with
`repeat`/`grid` until another real case requires it; LibreOffice round-trip

For the next review round, migrate one Trans.eu title/content pair into actual
brand-owned template files, add the minimal image-slot rules above, and run the
same deck through direct PNG/PDF plus LibreOffice PPTX → PDF → PNG inspection.
remains a separate acceptance condition whenever the converter is available.
