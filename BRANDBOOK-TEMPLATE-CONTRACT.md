# Brand-owned template contract

This document describes the target model in which a brandbook stores not only
colors, fonts, and assets, but also page and slide composition definitions.

## 1. Two different things

Keep these separate:

- **brand template** — a durable layout definition that an LLM can create and
  improve;
- **renderer request** — data to place into an already selected template.

A showcase runs a template with sample data. It does not store a competing
geometry definition.

```text
brandbook source
  _brand.yml + profiles + assets + templates
              + showcase data
                    ↓
             template compiler
                    ↓
             CompiledTemplate
                    ↓
       profile + render data resolver
                    ↓
             ResolvedRenderPlan
                    ↓
              SVG / PDF / PNG / PPTX
```

`CompiledTemplate` is a data-independent compiled snapshot. A
`ResolvedRenderPlan` is the execution plan for one profile and data set.
Neither is a format users must write by hand.

```ts
compileTemplateSource(source): CompiledTemplate
resolvePlan(compiledTemplate, profile, data): ResolvedDocumentPlan
renderPlan(plan, format): Artifact
```

Published snapshots store `CompiledTemplate`, not a plan tied to one render.
Parsing source, writing files, and publishing belong to the external authoring
tool; MCP needs only a snapshot reader, resolver/planner, and renderers.

## 2. File ownership

The brandbook stays outside the `report-baby` repository, for example in a
client repository or a directory managed by `marketing-context-mcp`:

```text
brands/trans.eu/
  _brand.yml
  profiles/
    primary.yml
    ecommerce.yml
    careers.yml
  templates/
    fragments/
      slide-chrome.yml
      report-header.yml
    slides/
      qbr-title/
        template.yml
        cases.yml
      innovation-story/
        template.yml
        cases.yml
    pages/
      blog-article/
        template.yml
        cases.yml
      executive-report/
        template.yml
        cases.yml
  showcase.yml
  assets/
    logos/
    backgrounds/
    fonts/
  sources/
```

`_brand.yml` and profiles hold identity and variants. Templates hold
composition; `cases.yml` holds test cases for one template; `showcase.yml`
combines cases into representative decks and reports. `fragments/` allows
shared chrome to be fixed once rather than in every template.

For larger brandbooks, tokens may be split into DTCG-like files:

```text
tokens/color.tokens.json
tokens/typography.tokens.json
tokens/spacing.tokens.json
assets/manifest.yml
```

The main contract remains unchanged: templates refer to semantic roles and
profiles resolve their values.

## 3. References

Select a profile with:

```text
brand://trans.eu/ecommerce
```

An embedded template may be selected as:

```text
slides/standard
```

A template owned by the selected brand may be discovered as:

```text
brand://trans.eu/ecommerce/templates/slides/innovation-story
```

In renderer requests, prefer the shorter stable form: resolve the template in
the context of `brand_ref`:

```json
{
  "brand_ref": "brand://trans.eu/ecommerce",
  "template_ref": "slides/innovation-story",
  "data": {
    "title": "Digitization in freight forwarding",
    "metrics": []
  }
}
```

The resolver checks that the template is available for the profile and that its
surface matches the result, such as a 16:9 slide or A4 page. A future
`brand_ref` may pin an immutable release, for example
`brand://trans.eu@2.4.0/ecommerce`; the MVP uses unpinned local references.

## 4. Template language

The language should be small and declarative. It is not CSS or SVG/PPTX. The
LLM describes meaning and relationships; the renderer calculates pixels,
inches, and millimeters.

A minimal template contains:

- `schema_version`, `id`, `kind` (`slide` or `page`), and `surface`;
- optional `extends` for inheritance from a base template;
- `regions` — larger composition areas;
- `slots` — places where content goes;
- `relations` — dependencies between elements;
- `constraints` — minimum sizes, row limits, safe areas, and overflow;
- `variants` — composition variants when the brand profile is not enough;
- `showcase` is stored separately from geometry.

Example:

```yaml
schema_version: 1
id: innovation-story
kind: slide
surface: slide-16x9

canvas:
  direction: ltr
  padding: spacious

regions:
  hero:
    frame: { x: 0.06, y: 0.08, width: 0.56, height: 0.38 }
  visual:
    frame: { x: 0.65, y: 0.06, width: 0.29, height: 0.46 }
  body:
    frame: { x: 0.06, y: 0.52, width: 0.88, height: 0.34 }

slots:
  logo:
    region: hero
    role: logo
    placement: start
  title:
    region: hero
    role: heading-display
    max_lines: 2
    overflow: shrink-to-fit
  subtitle:
    region: hero
    role: body
    max_lines: 3
  graphic:
    region: visual
    role: brand-graphic
    fit: cover
  metrics:
    region: body
    role: metric-grid
    columns: 3
    gap: normal

relations:
  - { from: subtitle, to: title, relation: below, gap: sm }
  - { from: graphic, to: hero, relation: aligned-top }
  - { from: metrics, to: hero, relation: below, gap: xl }

constraints:
  min_text_contrast: AA
  forbid_overlap: true
  keep_slots_inside: [canvas, safe-area]
```

`frame` is normalized source geometry, not a renderer-specific position. It is
allowed because the template is the brand-owned source composition. Geometry is
not allowed in profiles, MCP requests, or one-off overrides. Grids and anchors
such as `top-end`, `region.right`, or `columns: 3` are allowed. CSS, SVG code,
PPTX XML, and DPI-dependent values are not.

## 5. Template behavior

A template describes more than rectangle positions. Each slot may define:

- a brand typography role;
- minimum and preferred size;
- maximum line or item count;
- overflow strategy: `shrink-to-fit`, `wrap`, `paginate`, or `reject`;
- logical alignment: `start`, `center`, or `end`;
- RTL rules;
- required contrast and safe area;
- optionality;
- asset scaling or cropping behavior.

For image and logo slots, keep the first version deliberately small:

```yaml
graphic:
  type: image
  frame: { x: 0.65, y: 0.06, width: 0.29, height: 0.46 }
  fit: cover                 # cover or contain; never implicit stretching
  focal_point: { x: 0.65, y: 0.35 }
  opacity: 0.9

logo:
  type: lockup
  frame: { x: 0.86, y: 0.06, width: 0.10, height: 0.06 }
  fit: contain
```

`cover` fills the slot and crops the excess while preserving proportions;
`contain` keeps the entire asset visible and leaves empty space where needed.
`focal_point` says which normalized point should remain visible when cropping;
it is not a second coordinate system for the layout. If omitted, the renderer
uses the centre. All three output paths must apply the same rule before they
draw the image. A logo must default to `contain` and must never be stretched.

Relations matter more than coordinates. If an LLM moves a graphic, the title
must not remain in an arbitrary place: the plan should know that the title is
above the body and the graphic aligns with the hero's top edge.

### Closed vocabulary

The first version should use a finite vocabulary:

- slots: `text`, `image`, `lockup`, `shape`, `chart`, `table`, `stack`, `grid`,
  `repeat`, `group`;
- relations: `within`, `inset`, `columns`, `after`, `before`, `align`, `stretch`,
  `gap`, `min-size`, `max-size`, `aspect-ratio`;
- constraints: `inside-canvas`, `no-overlap`, `safe-area`, `contrast`,
  `max-lines`, `capacity`, `keep-together`, `required-visible`.

Do not introduce string expressions, executable code, PPTX/SVG-specific
properties, or direct hex colors, fonts, and asset paths. Repeated cards and
rows use constrained `repeat/grid`, not a general programming loop.

## 6. Brand, profile, and template roles

| Layer | Responsibility |
| --- | --- |
| Brand | colors, fonts, logos, graphics, roles, tokens, and brand rules |
| Profile | brand variant: light, dark, ecommerce, careers, campaign |
| Template | geometry, slots, relations, content type, and overflow behavior |
| Showcase | sample data, selected profiles, templates, and test cases |
| Render request | concrete brand, template, and data to render |
| Resolved plan | compiled result ready for every renderer |

A profile may change surface and tokens, but should not copy all template
geometry merely to create a light or dark variant.

## 7. Showcase as a composition test

A showcase selects a template and supplies data plus edge cases:

```yaml
schema_version: 1

decks:
  - id: innovation-story
    template_ref: brand://trans.eu/ecommerce/templates/slides/innovation-story
    cases:
      - id: light
        profile: ecommerce
        data:
          title: Digitization in freight forwarding
          metrics: [...]
      - id: dark
        profile: ecommerce-dark
        data:
          title: Digitization in freight forwarding
          metrics: [...]
      - id: long-copy
        profile: ecommerce
        data:
          title: A very long title testing template behavior
          metrics: [...]
      - id: rtl
        profile: ecommerce
        direction: rtl
        data:
          title: عنوان تجريبي
          metrics: [...]
```

Every case should render to PNG, PDF, and PPTX. The showcase should check more
than color differences:

- boxes are in the expected regions;
- relations and spacing are preserved;
- the logo does not overlap the title or graphic;
- long text follows the declared overflow strategy;
- graphics stay outside the text safe area;
- contrast remains correct for every surface;
- geometry remains sensible after the PPTX LibreOffice round-trip.

Region identifiers may appear in diagnostics, but the showcase must not create
a second manual coordinate definition. Each template should have a baseline
case, minimal data, declared maximum capacity, long text, and every optional
slot absent. RTL and every declared surface are required when the template
supports them.

## 8. How the LLM creates and improves a template

The target cycle is:

1. inspect the existing brand, profiles, assets, and templates;
2. select an existing template or create a draft;
3. let the external authoring tool write the file in the brand repository;
4. validate inheritance, schema, assets, roles, contrast, relations, and limits;
5. generate representative PDF/PNG/PPTX cases with the showcase runner;
6. inspect output and diagnostics, then improve the source template;
7. publish the accepted draft through the repository workflow.

The LLM should edit small named fragments such as `slots.title`, `relations`,
or `constraints`, rather than rewriting the whole file. Validation errors
should identify document location and suggest a correction.

## 9. MCP and the external authoring tool

### External tool / skill

The external tool owns brandbook mutations:

- `brand init` — scaffold a brand directory;
- `brand add-profile` — add a profile;
- `brand template init` — scaffold a slide or page template;
- `brand validate` — validate without rendering;
- `brand template inspect` — input schema, parameters, slots, diagnostics;
- `brand preview` — render cases to PNG/PDF/PPTX;
- `brand qa` — full round-trip and coverage report;
- `brand publish` — atomic snapshot into a brand store;
- `brand rollback` — switch the active release.

It works on files and uses the same standalone bundle as MCP. It needs Node at
runtime, not npm; npm is only needed to build the bundle. A brand working tree
may be unpublished and experimental. Production MCP should read a published
snapshot, not an arbitrary working state.

### report-baby MCP

MCP is a deterministic consumer of the published brandbook:

- render with `brand_ref` and `template_ref`;
- return diagnostics and `ResolvedRenderPlan`;
- list and inspect available templates;
- render preview/showcase;
- never silently write changes to a brandbook.

If template creation must be available “through MCP”, it belongs in the brand
owner's MCP, such as `marketing-context-mcp`, which has permission to write to
the client repository. `report-baby` may provide validation and preview, but
must not become the brand database.

## 10. Versioning and status

Before publication, the directory and its Git history are the source of truth.
After publication, MCP reads an immutable snapshot. Keep three versions apart:

- `schema_version` — template language version;
- `brand_release` — atomic version of tokens, templates, and assets;
- `renderer_contract_version` — plan version supported by report-baby.

```yaml
schema_version: 1
id: innovation-story
version: 0.3.0
status: draft
```

`draft` may be rendered and tested but need not be the default. `published` is
selected explicitly by a profile or reference. Rollback switches the active
release; it is not MCP state:

```text
brand-store/acme/
  active.json
  releases/2.4.0/
    manifest.json
    compiled/
    assets/
```

## 11. Current state and gaps

Present today:

- brand directory, profiles, and assets;
- `showcase.yml` with sample data and surface profiles;
- standalone `example-bundle.cjs` and `scripts/render-example.js`;
- `brand-authoring` skill;
- PDF/PNG/PPTX rendering and LibreOffice round-trip QA;
- closed catalog of three built-in templates;
- internal `ResolvedSlidePlan` with named slots and RTL/LTR.

Still missing:

- parser and validator for brand-owned templates;
- `templates/slides/*.yml` and `templates/pages/*.yml` source files;
- compiler from template language to a resolved plan;
- authoring tool for template scaffolding and editing;
- showcase cases that render brand-owned template geometry;
- MCP `list_templates`/`inspect_template` for brand-owned templates;
- complete inheritance and template-versioning strategy;
- published brand store with immutable releases.

The current `ResolvedSlidePlan` is a useful seam, but must not be mistaken for
the final source language.

## 12. Implementation order

1. Freeze the first slide/page template schema.
2. Add a parser/validator with YAML-path errors.
3. Compile one brand-owned template into the existing resolved plan.
4. Move one neutral example into `templates/slides/` and connect it to the
   showcase.
5. Add standalone scaffold, validate, inspect, and render-showcase commands.
6. Add MCP preview/inspect, while keeping mutations in the authoring tool or
   brand owner.
7. Only then extend the language to A4 pages, pagination, and richer relations.
