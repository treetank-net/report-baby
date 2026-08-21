# Brandbook and render kits — plan

The target template contract is described in
[`BRANDBOOK-TEMPLATE-CONTRACT.md`](BRANDBOOK-TEMPLATE-CONTRACT.md), and the
implementation order in
[`BRANDBOOK-TEMPLATE-IMPLEMENTATION-PLAN.md`](BRANDBOOK-TEMPLATE-IMPLEMENTATION-PLAN.md).

## Goal

`report-baby` should render slides, complete decks, A4 reports, charts, and
other graphics from a selected slice of a brandbook, without copying the brand
into every request or forcing one brand onto an entire project.

Example request:

```json
{
  "brand_ref": "brand://acme/primary",
  "template_ref": "slides/qbr/executive-summary",
  "surface": "pptx-16x9",
  "content": {
    "title": "New transport platform",
    "body": "..."
  },
  "overrides": {
    "fit": {
      "strategy": "shrink-to-fit",
      "min_body_pt": 14
    }
  }
}
```

## Domain model

- **Brandbook** — the complete multi-file brand directory: values, assets,
  variants, sources, compositions, and decisions.
- **Brand** — a named identity node, such as `acme` or a sub-brand.
- **Profile** — an inheriting slice of a brand, such as `primary`, `investor`,
  `campaign`, or `dark`.
- **Template** — the layout and composition of a rendered artifact, independent
  of a specific brand.
- **Render kit** — the resolved result: brand/profile + surface + template +
  overrides, ready for one renderer.
- **Override** — a validated one-off change for one request; it does not modify
  the brandbook or template.

`brand://acme/primary` points to a profile, not a physical file. The resolver
may also accept a local path, but normalizes both inputs to the same internal
reference.

## Brandbook structure

A brandbook is not one source file. `_brand.yml` remains the portable core and
the rest lives beside it:

```text
brands/
  acme/
    _brand.yml
    manifest.yml
    profiles/
      primary.yml
      investor.yml
      campaign.yml
    tokens/
      colors.json
      typography.json
    compositions/
      qbr.yml
      campaign-review.yml
    assets/
      logos/
      fonts/
    sources/
    resolved/
```

External patterns:

- `_brand.yml` — metadata, logo, colors, typography, and assets;
- DTCG — tokens and aliases;
- DTCG Resolver — sets, modifiers, contexts, and merge order;
- Quarto catalog/Brand Extension — distribution of multiple files and assets.

Only the reference registry, report/slide compositions, provenance, and
projection into renderer capabilities are local to this project.

## Resolver

The resolver composes the result in this order:

```text
brand base
  → profile / kit
  → surface
  → template
  → one-time overrides
  → renderer safety / fit checks
```

Minimal module interface:

```text
resolveBrand({ brandRef, surface, templateRef, overrides })
  → ResolvedRenderKit | diagnostics
```

The resolver should:

1. find the brandbook in the configured directory;
2. read `_brand.yml` and related assets;
3. apply the selected profile by inheritance/overlay;
4. resolve tokens and variants;
5. choose the template and surface;
6. apply only allowed overrides;
7. return the kit and warnings for values unsupported by the renderer.

`resolved/` may hold a one-off snapshot for a render. It is not the source of
truth and must not overwrite input files.

## Configuration and data ownership

`marketing-context-mcp` is the natural owner of per-client brandbooks, in the
same way it owns the existing `clients/<slug>/` context. `report-baby` remains
the renderer and does not take ownership of client knowledge.

Target flow:

1. the brandbook lives in the client's context directory;
2. configuration points to the brandbook or context directory;
3. the render request supplies `brand_ref`;
4. report-baby resolves the reference locally or receives a ready snapshot;
5. the renderer uses no network, LLM, or process from another plugin.

There is no stateful `load_brandbook` that changes later requests. Persistent
state lives in the directory and configuration; every request remains explicit
and repeatable.

Minimal report-baby configuration:

- default directory in `REPORT_BABY_DATA/brands`;
- optional `REPORT_BABY_BRAND_DIR`;
- later, optional shared directory through `MARKETING_CONTEXT_DIR`.

## Minimal MCP tools

Do not add a separate brand-management system first. The required pieces are:

1. `list_brandbooks` — discover brands/profiles and capabilities;
2. `inspect_brand` — validate a reference and show resolved elements without
   rendering;
3. shared `brand_ref` on existing render tools;
4. `template_ref` and `overrides` on slide, report, and graphics tools where
   meaningful.

Not every tool needs every field. `render_svg` remains a low-level escape hatch
   and does not have to apply a brand automatically.

### Single slide

```json
{
  "brand_ref": "brand://acme/primary",
  "template_ref": "slides/qbr/executive-summary",
  "surface": "pptx-16x9",
  "content": {},
  "overrides": {}
}
```

### Complete deck

```json
{
  "brand_ref": "brand://acme/primary",
  "surface": "pptx-16x9",
  "defaults": {
    "template_ref": "slides/qbr/default"
  },
  "slides": [
    { "template_ref": "slides/title", "content": {} },
    {
      "template_ref": "slides/metric-grid",
      "content": {},
      "overrides": {
        "layout": { "density": "compact" },
        "typography": { "body": { "scale": 0.9, "min_pt": 14 } }
      }
    }
  ]
}
```

### PDF report

```json
{
  "brand_ref": "brand://acme/primary",
  "template_ref": "reports/monthly-performance",
  "surface": "pdf-a4",
  "data": {}
}
```

## Overrides

Overrides are structural, schema-limited, and one-off. Supported categories:

- `fit` — `shrink-to-fit`, minimum font size, maximum line count;
- `typography` — role scale or a registered font choice;
- `layout` — density, grid variant, selected safe-area presets;
- `emphasis` — semantic role, such as `innovation-display`;
- `content` — local visibility or ordering decision when the template permits
  it.

Direct values such as `fontSize: 3` or arbitrary CSS are not public contract.
If an override violates minimum size, safe area, contrast, or renderer
capability, the resolver returns diagnostics instead of silently producing a
broken result.

Every render should report at least the selected `brand_ref`, profile, surface,
and template; applied overrides; fallback/unsupported-field warnings; and
whether text was fitted automatically. Overrides are not saved. Persisting a
variant requires an explicit brandbook update.

## Work order

### Stage 1 — contract and catalog

- [x] Define `brand://...` and local-path references.
- [x] Define brandbook manifest, profiles, and inheritance.
- [x] Set brandbook directory configuration.
- [x] Add `list_brandbooks` and `inspect_brand`.

### Stage 2 — resolver

- [x] Read `_brand.yml` and relative assets.
- [ ] Add DTCG token sets/aliases and sets/modifiers/contexts variants.
- [ ] Materialize `ResolvedRenderKit` into a temporary directory.
- [x] Add fallbacks and capability diagnostics; source provenance remains later.

### Stage 3 — renderer integration

- [x] Add shared `brand_ref` to `render_report`.
- [x] Add `brand_ref`, `template_ref`, and per-slide overrides to the deck model.
- [x] Add the same fields to `render_slides_pdf`, `render_slides_png`, and
  `render_slides_pptx`.
- [ ] Add `render_slide` only if one slide has real value beyond a one-item deck.
- [ ] Add full projection of fonts, colors, logos, tables, and safe areas to
  existing renderers; MVP covers colors, palettes, PPTX typography, and font
  diagnostics.

### Stage 4 — composition and fit

- [x] Define the closed minimal slide-template catalog:
  `slides/standard`, `slides/compact`, `slides/centered-title`.
- [x] Add shared `ResolvedSlidePlan` with named slots, logical RTL/LTR,
  lockup placement, and spacing.
- [ ] Define brand-owned template language: regions, slots, relations,
  constraints, input schema, fragments, and template cases.
- [ ] Compile brand-owned templates to resolved plans; normalized geometry is
  allowed only in the template file.
- [ ] Add an external standalone `brand-tool` for scaffold, validate, preview,
  QA, and publish; do not add mutating tools to the report-baby MCP.
- [ ] Add immutable brand releases/store and release pinning in the resolver.
- [x] Add `fit` and `density` as safe overrides.
- [x] Add typography roles such as `innovation-display`.
- [x] Add brandbook → profile → render and per-slide override flow tests.
- [x] Add a neutral Node-only brandbook prototype runner using a separate
  bundle that shares renderer modules.

### Stage 5 — sources and marketing-context-mcp integration

- [ ] Establish `clients/<slug>/brands/` in marketing-context-mcp.
- [ ] Add source adapters for `_brand.yml`, DTCG, `theme1.xml`, and `brand.json`.
- [ ] Treat PDF/PPTX/vibes as evidence/proposal sources, not direct
  configuration for a deterministic renderer.
- [ ] Pass a local reference or snapshot to report-baby, with no network and no
  runtime dependency between servers.

## Success criterion

The user can say:

> “Render a QBR for `brand://acme/primary` as an A4 PDF and a 16:9 PPTX deck;
> use higher density and the `innovation-display` role on the recommendation
> slide.”

The agent supplies explicit references and data, the resolver selects the
right brandbook slice, and every format receives a consistent deterministic
result without manually copying colors, fonts, logos, or layout settings.

## Out of scope for the first version

- An LLM inside report-baby.
- Automatically guessing complete composition from a PDF or sample PPTX.
- Stateful brandbook loading that affects later requests.
- Arbitrary CSS or XML as a public override.
- Editing the source brandbook during rendering.
