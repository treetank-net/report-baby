# Plan 12 — dynamic page chrome and repeating flows

Status: complete for the release 1.0 scope. Dynamic text-header slots,
repeating footers, and the explicit `lockup` block have zero starting frames,
`fit_content`, shared measurement, and `main`-slot displacement. The legacy
renderer logo fallback remains deliberately for unmigrated fixed templates;
automatic lockup materialization from a brand profile is a separate 1.1 scope.

This plan extracts the remaining work on headers, footers, page numbering, and
other page-chrome elements from earlier documents. Plan 02 remains closed and
covers shared frame geometry. This document describes the new contract for
chrome based on actual content.

## Boundary adopted for release 1.0

In 1.0, dynamic chrome is available where a template declares explicit
`header`/`footer` flows and their slots. Unmigrated templates retain their
fixed renderer logo fallback as deliberate visual compatibility; it is neither
a second planner nor a source of dynamic-template geometry. Automatic creation
of a `brand-lockup` block from the brand profile, removal of the fallback from
all fixed templates, and full visual calibration belong to release 1.1/1.2.
This gives 1.0 one new dynamic contract without unnecessarily changing existing
artifacts.

## Objective

Elements at the top and bottom of a page must be planned like other slots, but
with explicit repeat policy and an explicit height mode. A fixed box is a valid
template choice; the problem is only a hidden fixed band that limits `main`
when the template did not declare that chrome. `fit_content` must derive
geometry from content instead of an empty frame.

Target flow for every page:

```text
layoutForPage(page)
  → create layout slots
  → repeating header
  → required insertions and other higher-priority flows
  → validate collisions and hard requirements
  → main flow in the remaining space
  → repeating footer and final-page-dependent elements
  → project page chrome to the renderer
```

“Header” is not a new entity. It is an ordinary flow with `repeat: each-page`.
The difference is lifecycle policy, not a separate layout or measurement
mechanism.

## Current implementation

- `CompositionPagePlan.chrome` contains `headerBand`, optional `headerRule`,
  `footerRule`, `pageNumber`, and `lockup`;
- `pageChrome()` in `server/src/report/renderer.ts` derives header-band height
  from `reserved_bands.header` and builds the page number outside the text flow;
- `showcase-report` and `showcase-report-band` templates have a separate
  `header` flow, but its title slot is currently a fixed frame;
- most `pages/editorial-*` templates and `default-report` declare only
  `reserved_bands.header` and `reserved_bands.footer`, without a text `header`
  flow; brand/logo then appears only through renderer chrome;
- `document-layout.ts` currently plans ordinary flows before repeated flows, so
  a dynamic header cannot yet displace an already laid-out `main`;
- the backend supports `{{page.number}}` and `{{page.count}}`, but numbering in
  `pageChrome` is still a second implementation shortcut;
- `reserved_bands.header` remains a transitional geometry source until header
  planning owns this responsibility.

## Do we have one unambiguous template and data definition?

Not yet in every runtime path. The parser already has the important building
blocks (`slots`, `flows`, `repeat`, `fit_content`, `overflow`), but the current
code does not yet compose them into one complete chrome contract:

- the template declares frames and slot order, but does not store their content;
- content arrives in `CompositionInput.flows` and is matched to slots;
- `lockup` is an ordinary atomic composition block; a `type: lockup` slot is
  adapted to a compatible `kind: block` slot;
- the page number is currently drawn in parallel by the renderer and is only
  partly described by the `footer` flow;
- `frame.height` is currently required and positive. `fit_content: true` exists
  in the parser, but fully collapsing an empty slot to zero requires layout
  materialization changes.

The following is the Plan 12 contract. It separates data sources from template
geometry so that no second hidden chrome format is introduced.

### Source of truth for each value

| Artifact | Owns | Does not own |
|---|---|---|
| `CompositionInput.flows` | text and blocks to display, and order within a flow | continuation policy, position, size, or page repetition |
| `PlacementRequests.insertion_flows` | one-off/request-owned slots, `start_page`, and `repeat` | continuation policy; the template route defines it, and a dynamic declaration may use only an already permitted route |
| `CompositionInput.assets` / brand profile | logo/mark source and default brand name | page and box selection |
| template `slots` | slot kind, frame, `fit_content`, `grow`, `overflow`, and allowed roles/kinds | block content |
| template `flows` | slot order, `repeat: each-page`, `start_page`, and the route's layout schedule | text measurement and drawing |
| `CompositionPlan` | accepted placements, boxes, obstacles, and diagnostics | inventing missing content |
| `CompositionPagePlan.chrome` | projection of result boxes/decorations for the backend | a second measurement or numbering contract |

### Canonical input example

In the target contract, header and footer are ordinary named flows. Lockup is a
content block like a table or chart; it is not a `Header` class or renderer
exception. Public fields are snake_case, and the adapter normalizes them to
camelCase in `CompositionBlock`.

```yaml
flows:
  header:
    blocks:
      - type: lockup
        id: brand-lockup
        role: header
        lockup:
          mark_asset_id: brand-mark
          label: ACME Logistics
      - type: heading
        id: header-title
        role: header
        text: Freight market outlook
      - type: text
        id: header-period
        role: eyebrow
        text: Q3 2026

  footer:
    blocks:
      - type: text
        id: footer-page-label
        role: footer
        text: "Confidential · {{page.number}} / {{page.count}}"

  main:
    blocks:
      - type: heading
        id: section-1
        role: heading
        text: Capacity and rates
      - type: text
        id: body-1
        role: body
        text: Long-form report content continues here.

assets:
  - id: brand-mark
    source: brand://acme/primary/logo
    alt: ACME Logistics
```

`lockup.mark_asset_id` and `lockup.label` are the only lockup component data.
Missing one removes only that component and its gap; an explicit block with
both values missing is rejected as empty, and missing both values from the
brand profile means the adapter does not materialize the block at all. The
brand profile may provide the same values as defaults; the adapter then
materializes `brand-lockup` before planning. An explicit request block wins
over the default. We do not keep parallel `name`, `asset`, or `description`
fields, nor a separate `Header` object.

Existing `title`, `subtitle`, `period`, `brand`, `header`, and `footer` fields
remain migration input. The adapter maps them to the flows and blocks above;
they are not a second owner of geometry. An optional projection such as
`{{flow.title.blocks[0].text}}` may remain as a restricted read-only migration
seam, but it is not required by the canonical example and must not mean
arbitrary object access.

### Canonical template example

The template describes only *where* and *how* to place these blocks. Content
must not be written into `slots.footer-page` or `slots.header-title`; it comes
from a flow. The fragment uses existing YAML keys (`type`, `frame`,
`continuation_frame`, `fit_content`, `overflow`, `gap`, `role`):

```yaml
slots:
  header-lockup:
    type: lockup
    frame: { x: 0.086, y: 0.024, width: 0.34, height: 0.045 }
    continuation_frame: { x: 0.086, y: 0.0168, width: 0.34, height: 0.045 }
    role: header
    fit_content: true
    overflow: reject
    gap: 4mm
  header-title:
    type: text
    frame: { x: 0.086, y: 0.078, width: 0.828, height: 0.06 }
    continuation_frame: { x: 0.086, y: 0.071, width: 0.828, height: 0.06 }
    role: header
    fit_content: true
    overflow: reject
  header-period:
    type: text
    frame: { x: 0.70, y: 0.024, width: 0.214, height: 0.035 }
    continuation_frame: { x: 0.70, y: 0.0168, width: 0.214, height: 0.035 }
    role: eyebrow
    align: right
    fit_content: true
    overflow: reject
  footer-page:
    type: text
    frame: { x: 0.086, y: 0.94, width: 0.828, height: 0.035 }
    role: footer
    align: right
    fit_content: true
    overflow: reject

flows:
  header:
    slots: [header-lockup, header-period, header-title]
    start_page: 2
    continuation: forbidden
    repeat: each-page
  main:
    slots: [content]
    continuation: allowed
  footer:
    slots: [footer-page]
    continuation: forbidden
    repeat: each-page
```

The `continuation` field appears here only on template flows. It is not in
`CompositionInput`, because input provides content, not route policy. The
current parser may still accept the old input field as migration metadata, but
it must not compete with compiled-template policy.

In this example `frame.height` is the template-selected minimum/fixed frame,
while `fit_content: true` permits growth to measured content. A full migration
must additionally allow `height: 0` for an empty dynamic slot, or calculate
group height after measurement without a false frame minimum. `overflow:
reject` is explicit: exceeding the height or colliding rejects the candidate.

The order in `flows.header.slots` is block consideration order, not a
declaration of three competing headers. Horizontal positions come from frames:
lockup and period occupy the first row, while the title is below. If a
different relationship is needed, change template frames instead of adding a
renderer condition.

### One page — flow and data ownership

```text
1. template_ref → choose first/continuation/title layout
2. route.layouts + slotsByLayout → check whether header/footer is active on this page
3. CompositionInput → normalize header/footer/main blocks and brand assets
4. measure lockup, title, period, and footer-page (placeholders share one resolver)
5. place header and required insertions → obstacles and resulting main boundary
6. place main in the remaining space
7. place footer after the page is known to be legal
8. CompositionPlan → evaluator → pageChrome as a projection to PDF/debug/CLI
```

Header and footer do not compete for the same content. Only their boxes and
obstacles compete; legality comes from geometry, block coverage, overflow
policy, and page limits. `CompositionPlan.decisions` is for observability, not
the source of legality.

### Note on `intro`, metrics, and charts

In current `showcase-report*` templates, `main.slots` contains `intro`,
`metric-1…metric-3`, `chart`, and `content`. This is a historical adapter
shortcut, not the target ownership of that content. In the target, `intro`
should have its own flow, metrics may be a block group in a `metrics` flow, and
the chart may have its own `chart` flow; `main` should carry the primary text
through `content`. We do not create a separate flow for every metric slot. If a
chart is genuinely part of a linear article, it may remain a `chart` block in
`main`; if the template reserves a separate opening area, move it to `chart`.
Lifecycle and route, not the block kind alone, decide ownership.

### What exactly does `continuation` mean?

The repository contains several similarly named fields. They are not
interchangeable, and we do not introduce a new entity or a
`continuation_block` field:

| Field | Meaning | Status |
|---|---|---|
| `CompiledTemplateFlow.continuation` → `CompositionFlowRoute.continuation` | hard policy for crossing the page boundary for the current flow instance; moving between slots on the same page remains allowed | currently used by the planner; the template is the hard constraint |
| `CompositionInput.flows[id].continuation` → `CompositionFlow.continuation` | historical input declaration of whether a flow may continue | conflicts with template ownership; remove from public input and model |
| `PlacementRequests.insertion_flows[*].continuation` | historical attempt to set policy for a request-owned flow | not a target override; a request may point to slots, while policy comes from the template route |
| `continuation_slots` → `continuationSlots` | historical slot list used after moving from the first page/layout | remove; legal slots come from `layoutForPage(page)` and `slotsByLayout` |
| `continuation_frame` → `continuationFrame` | alternate frame for the same slot on a continuation layout | currently used during slot materialization; it does not decide permission to continue |
| `page.continuation` → `PageGeometry.continuation` | alternate page geometry (margins, bands, segments) | currently used by the adapter; geometry, not flow policy |
| `repeat: each-page` | creates an instance of the same flow on every already materialized page | currently planned after ordinary flows; each instance is forced to `continuation: forbidden` |

`continuation` remains template-route metadata. It says whether a flow in this
specific template is intended to continue after the current page is exhausted.
For example, a bottom bar with footnotes may use `continuation: allowed` and a
slot with `grow.max_height: 0.5` (50% of page height); a page-local sidebar of
facts uses `continuation: forbidden`. The flag does not create space by itself:
the layout schedule must still expose a compatible slot on the next page.

`continuation` does not mean “do not use a continuation layout”, “do not move
to the next slot on the same page”, or “do not create a next page for the
whole document”. Document input provides content only and cannot change this
template property.

Examples:

| Flow and route | What one instance may do |
|---|---|
| `main`, route has `content` on subsequent layouts | fill page-1 slot, move to `content` on page 2, and continue |
| `main`, route has `continuation: allowed`, page-2 layout has `content` | move to page 2 if `content` has legal capacity |
| `sidebar`, route has `continuation: forbidden`, content does not fit page 1 | leave a diagnostic/residual instead of page 2 |
| `footer`, `repeat: each-page`, `continuation: forbidden` | plan separately on every already materialized page; do not move one placement to the next |
| `quotes`, `continuation: allowed`, `insertion_slots` on pages 2–5 | assign later quotes to the next pages' slot pool according to the route |
| `quotes`, `continuation: forbidden` | require the whole quote-flow instance to fit the allowed slots of the current page/route |

The target keeps one `continuation` policy flag, only on the template route.
Legal continuation is the intersection of that policy with the layout schedule:
`allowed` without a compatible slot still fails, and `forbidden` blocks the
move even when such a slot exists.

`continuation_slots` is marked for removal during refactoring. It will not be
moved into auxiliary/insertion flows. `continuation_frame` describes geometry
only and may remain during migration until slots are fully selected by the
layout schedule.

### Consistency with existing documentation

Comparison with the [canonical Composition description](../composition/README.md),
Plans 01, 02, and 07, and the Astra audit gives this result:

| Area | Consistency | Conclusion |
|---|---|---|
| `main` does not accept insertion slots or quotes | consistent | Plan 12 does not change this; chrome and insertions remain outside the main stream |
| template owns geometry, planner owns placements, evaluator owns legality, renderer executes | consistent | `pageChrome` remains a projection, not a second planner |
| `{{page.number}}` and `{{page.count}}` as one text placement | consistent | retain existing syntax and add no aliases |
| `reserved_bands` as current geometry source | consistent after temporal separation | active today; Plan 12 may replace it with the boundary from active slots |
| repeated flow planned after ordinary flow | consistent with current state, not with Plan 12 target | Astra documentation records the fact; Plan 12 explicitly proposes a new order and requires regressions |
| `CompositionInput.flows[*].continuation` owns the rule | inconsistent with target ownership | input supplies content; remove the field so it cannot compete with the template route |
| `PlacementRequests.insertion_flows[*].continuation` overrides template | inconsistent with target ownership | request cannot set policy; dynamic flow must use a route with the proper policy |
| `continuation_slots` for every flow | deliberately removed | current parser/adapter still has the field, but target legal slots come from layout scheduling |
| `overflow`, `gap`, `fit_content` for every slot | partially consistent | parser compiles them, but the composition adapter currently drops `overflow`/`gap`, and block slots do not carry `fit_content`; Plan 12 describes future work, not a current guarantee |
| `route.layouts` as allowlist | name needs correction | it is a positional layout schedule; `slotsByLayout` maps slots, not a global allowlist |
| `start_page` always validated | gap | ordinary flow is validated; a repeated flow may currently do nothing when its start is beyond already-created pages |
| `lockup` as a block kind | consistent | input, adapter, slot, PDF capability, and dynamic-chrome test treat lockup as an ordinary atomic block |

There is no contradiction in the architectural direction, but there would be a
contradiction if Plan 12 were read as a description of today's runtime. Each
such difference is marked as `current`, `target`, or a `migration gap` in this
document.

## Audit of current chrome definitions

This migration does not preserve backward compatibility of internal functions
or old code paths. It preserves the existing document's appearance and
meaning unless the new contract deliberately changes them. Current chrome
sources are distributed:

| Source | What it currently defines | Target role |
|---|---|---|
| `page.reserved_bands.header/footer` | fixed area subtracted from flow segments | resulting geometry boundary derived from active header/footer slots |
| `slots.header`, `header-period` | text frames in `showcase-report*` | ordinary slots of a repeating flow measured before `main` |
| `slots.header-lockup` | `block` slot with `allowedBlockKinds: [lockup]` | logo + brand-name group whose geometry is visible in the plan |
| `flows.header` | header repetition from the declared page | only special rule: `repeat: each-page` |
| `slots.footer` + `flows.footer` | fixed slot and repeating footer | ordinary repeating flow with generated placeholders |
| `CompositionPagePlan.chrome` | header-band frame, rules, footer, page number, and lockup | projection of resulting geometry to renderers |
| `pageChrome()` / `drawReportChrome()` | fixed bands, logo, brand name, rules, and `${page} / ${pageCount}` | decoration renderer; no separate owner of content geometry |
| `pdf.header_*` | mixture of active values and historical fallbacks | only values used by the new seam; remove the rest after tests |
| `chrome.report_lockup.*` | logo size, name size, alignment, and `gap_mm` | default internal lockup layout style |

`chrome.lockup.*` in the same `render-config.yml` concerns slides (PPTX/SVG),
not report page chrome. Do not mix the two layouts in one module; only retain
compatible gap semantics.

### Active and transitional pieces

- The active composition contract consists of named flows, slots, `repeat`,
  `fit_content`, `grow`, reserved bands, and resulting placements.
- The active source for report lockup visual spacing is currently
  `chrome.report_lockup.standard.gap_mm` or the `continuation` variant, used
  directly by `drawReportChrome()`.
- `CompiledTemplateSlot.gap` is parsed only for a `lockup` slot, but the
  composition adapter does not pass it to `CompositionSlotTemplate`, and the
  report renderer does not read it. Do not claim the template controls this gap
  yet.
- `PDF_CONFIG.headerBandHeight`, `headerRepeatBandHeight`, `headerTitleTop`,
  `headerBandTitleTop`, `headerRepeatTopLineY`, and `headerRepeatTitleY` are
  candidates for removal or merging after adding the new calculator. Their
  presence in YAML does not mean that each affects report composition.
- `pageChrome()` falls back to `PDF_CONFIG.headerBandHeight` even when a layout
  declares no header band. This causes empty space; it is not a requirement of
  the new model.

## Lockup: logo, brand name, and gap

### Current behavior

The report renderer selects the `standard` or `continuation` variant from
`chrome.report_lockup`. The logo is fitted by `drawContainedImage()` to
`mark_width_mm` or `full_logo_width_mm` and `max_height_mm`. The brand name is
drawn beside the actually rendered logo width with `gap_mm`, and its baseline
is aligned to the logo height.

Retain this appearance as the reference point:

- standard and continuation variants may have different dimensions and fonts;
- the default alignment remains `middle`;
- the gap is horizontal and measured from the actual logo bounds, not an empty
  frame;
- the brand name is uppercase as it is today;
- if the logo asset is missing, the current renderer still reserves its default
  dimensions. Under the new contract the missing element should collapse
  instead of creating invisible space.

### Contract after migration

Lockup is one composite header slot/group, not two independent flows. Its
canonical model has two optional content bounds:

```text
lockup group
  → mark (asset, optional)
  → gap_mm (only when mark and label both exist)
  → label (brand text/description, optional)
```

`mark` is an asset reference and `label` is text beside the mark. Do not add
parallel `name`, `asset`, or `description` fields at the same level. The
current brand name maps to `label`; current uppercase behavior remains a
variant style, not a semantic restriction on the field.

One calculator derives its size:

```text
group.width  = mark.width + gap + label.width
group.height = max(mark.height, label.height)
               + padding_top + padding_bottom
```

In fixed mode the group respects the template box and overflow policy. In
`fit_content` mode the box grows to measured content, but never beyond
configured `max_width` and `max_height`. Missing components leave neither
fictional dimensions nor a gap.

Brand description, period, and header title remain separate slots only when the
template wants independent positioning. Collision with a growing lockup is a
geometry error, not a reason to silently shrink text.

### What “inline” means here

“Inline” describes lockup's relationship to other chrome elements, not a
`CompositionInlineRun` inside one text line. Lockup is not the only block in a
header definition: it may coexist with an article title, period, rule, or other
metadata slot. Each element has its own measurement and box; layout arranges
them in the declared order and with declared gaps.

Example header with lockup, title, and period:

```yaml
flows:
  header:
    repeat: each-page
    slots:
      - header-lockup
      - header-period
      - header-title

slots:
  header-lockup:
    type: lockup
    fit_content: true
  header-period:
    type: text
    fit_content: true
  header-title:
    type: text
    fit_content: true
```

The result is not three competing headers but one repeating flow with three
arranged elements:

```text
┌──────────────────────────────────────────────────────────┐
│ [lockup: mark + brand name]       [publication period]   │
│ Article title, which may occupy one or several lines     │
│ ───────────────────────────────────────────────────────── │
└──────────────────────────────────────────────────────────┘
                         ↓ measured header boundary
                    [main flow / insertions]
```

Slot order alone does not decide the direction of layout. The template must
describe the geometric relationship, for example a horizontal first row and a
title stacked below it:

```yaml
header_layout:
  - row: [header-lockup, header-period]
  - stack: [header-title]
```

This is illustrative notation, not a second configuration format. The only
canonical declaration remains `flows.header.slots` plus slot frames and order
in the template; horizontal arrangement follows their geometric relationship.
Do not add a `header_layout` parser field at this stage. It remains one
`header` flow, and the calculator measures slots using existing frames and
returns one header boundary for `main`.

If the title grows to two lines, only its slot and the resulting header-group
height grow; the lockup keeps its dimensions and `main` starts below the new
boundary. If lockup has neither mark nor label, its slot disappears in
`fit_content` mode while other slots are still arranged.

Page number is an analogous metadata slot, but should normally live in the
footer. Complete repeating chrome:

```yaml
flows:
  footer:
    repeat: each-page
    slots:
      - footer-rule
      - footer-page-number

slots:
  footer-page-number:
    type: text
    text: "{{page.number}} / {{page.count}}"
    fit_content: true
```

Lockup may also be used outside the header when the selected slot allows its
kind. It remains the same measured block; only place and repeat policy change:

```yaml
flows:
  sidebar:
    slots:
      - sidebar-lockup

slots:
  sidebar-lockup:
    type: lockup
    mark: brand-mark
    label: "ACME Logistics"
    fit_content: true
```

These examples are the target planner contract, not necessarily current parser
syntax. Gap, padding, and limit values remain in
`server/templates/render-config.yml`, not as TypeScript literals.

### Content source and old data structures

We do not create a separate data model only for chrome. Existing `title`,
`header`, `footer`, `brand`, `subtitle`, and `period` fields remain content
sources. The adapter normalizes them into named flows (`title`, `header`, and
`footer`), and the template decides which slots and layouts accept those flows.
Old data therefore still describes *what* is shown, while the template flow
describes *where and in what order* it is arranged.

Text slots may accept restricted, read-only variable paths into normalized
flows, for example:

```text
{{flow.title.blocks[0].text}}
```

This path projects content into the selected slot; it is not a second run of
that flow. Arbitrary calls and arbitrary object access are forbidden. Missing
optional source collapses the slot; missing source required by the template
produces a diagnostic and rejects the candidate. The same block cannot be
displayed by both a projection and a normal slot on the same page.

The current report lockup `gap_mm` default is retained without visual change.
The first migration pass adds no second independent gap source. If a template
later needs to override the gap, existing `gap` must be passed explicitly
through the adapter and its precedence relative to `chrome.report_lockup` must
be documented; a seemingly active but ignored definition is not acceptable.

## Chrome and `main` compression in the current implementation

Current behavior is not chrome negotiation with the flow:

- `reserved_bands.header` and `reserved_bands.footer` are subtracted from flow
  segments from the start; they are hard boundaries, not placements moved by
  the planner;
- insertions are materialized before ordinary flow and become real obstacles
  that can reduce space available to `main`;
- repeating `header` is currently planned after ordinary flows and `pageChrome`
  is appended after planning, so changing its height does not re-layout `main`;
- there is no general mechanism that shrinks `main`'s font, line height, or
  arbitrary content to fit chrome. Existing local heading-gap reduction applies
  only to decisions inside a text flow.

In Plan 12, “chrome affects `main`” therefore means changing the available
geometry boundary: a larger header displaces or limits `main`, while a smaller
header releases space. It does not mean compressing content. When hard
requirements or page limits cannot be met, the candidate is rejected or
`ensurePage` creates another legal page according to flow policy.

## Adopted contract

### Header and footer

- header and footer are ordinary flows with `repeat: each-page`;
- target `repeat: each-page` is evaluated after page-layout selection.
  `CompositionFlowRoute.layouts` is a positional layout schedule, and
  `slotsByLayout` selects slots for a particular layout; together they limit
  pages on which the flow has an instance. This is not a global allowlist of
  template names;
- repeating-flow slots are considered before `main` on every page;
- required elements take precedence over soft insertions, and soft insertions
  precede `main` only within the declared page policy;
- `start_page`, `continuation`, and first/subsequent layout differences remain
  flow/template properties, not renderer exceptions;
- a repeating flow does not create pages merely because it repeats;
  `ensurePage` applies ordinary legality and limit rules.

### Canonical space-allocation phases and paint order

We do not describe one list of “what is drawn first”. Each block has two
independent aspects:

- **reservation phase** — when the planner must know its box to calculate legal
  space for other blocks;
- **paint layer** — when the backend technically draws it into the PDF.

The reservation phase must first know all elements that constrain `main`:

```text
1. page geometry and background/decorations
2. fixed chrome: header, lockup, title, other fixed blocks, and footer
3. required auxiliary flows: intro, metrics, chart, and similar blocks
4. required insertions and page-local/sidebar/quote flows
5. soft insertions (within the particular candidate)
6. main — primary text in the remaining legal slots
7. plan finalization
```

Items 2–5 are considered before `main` because their final boxes become
obstacles or change the available geometry boundary. Footer is therefore
reserved before `main`, even if its paint layer is after `main` text or is
simply lower on the page. This does not give footer visual precedence.

`priority` means the strength of a claim to preserve geometry, not the planning
phase itself, paint order, or editorial importance. Higher numbers have higher
priority; levels `500`, `400`, ... leave room for future subphases without
renumbering the whole configuration. The release-1.0 classes are:

The release-1.0 code treats this as an optional template-route field. The
parser accepts a non-negative integer, the adapter carries it into
`CompositionFlowRoute`, and the planner sorts flows descending before
materializing dependent geometry (ties preserve input order). Placements and
lines may carry the value for debugging. Missing value has the explicit
migration meaning `composition_priority.default` from
`server/templates/render-config.yml` (currently `100`), the weakest geometry
claim; input documents cannot silently provide `priority`.

| `priority` | Class | Examples | Conflict effect |
|---|---|---|---|
| `500 template-chrome` | fixed chrome | header, lockup, footer, fixed sidebar | must be satisfied; no legal space rejects the plan or invokes permitted page policy |
| `400 required-auxiliary` | required auxiliary flows | intro, metrics, chart | reserve space before `main`; cannot be silently moved to another flow |
| `300 required-insertion` | required insertion | required quote, page-local sidebar, or other hard insertion | reserve an obstacle before `main`; no legal space makes the candidate illegal |
| `200 primary-flow` | primary flow | `main` | core document content; planned after geometry constraints, but missing content still makes the plan illegal |
| `100 optional-insertion` | optional insertion | optional quote, sidebar, or other soft insertion | may be rejected for a candidate; does not displace required blocks or complete `main` |

`priority` is not a separate template paint-order field. The adapter may derive
or pass it from the route, the planner carries it with the placement and uses it
for materialization order and space claims, and the evaluator checks resulting
legality. Input supplies content and cannot raise a flow's claim. Reservation
still follows geometry dependency: the planner first measures and tentatively
places a higher-claim element, records its box/obstacle, and only then computes
dependent geometry. This is plan materialization, not physical PDF drawing.

When two same-class elements compete for space, their slot order and any
tie-breaker are defined by the template. Flow names do not create a hidden
planner exception. A fixed sidebar belongs to `500 template-chrome`, while
page-local facts belong to `300 required-insertion` or `100 optional-insertion`
depending on the requirement.

The number alone does not resolve two mandatory blocks: both must fit
simultaneously or no plan is created. For `100 optional-insertion`, the number
means a weaker claim and permission to reject the candidate if it would leave
an illegal `main` residual. It does not mean `main` is less important; `main`
is planned later because of geometry dependency, not because it may be
sacrificed.

The direction “higher number = higher `priority`” and separation of the field
from phase and paint follow the study of [priority practices](../research/block-priority-practices.md).
The `500`–`100` scale is this repository's convention, not a standard imposed
by CSS, Kubernetes, or another external system.

In the PDF, distinguish:

- **paint order** — the order in which the backend performs drawing operations;
- **`z-index`/stack level** — depth layer deciding what is visually above what
  when boxes may overlap.

`priority` does not currently define either. With ordinary non-overlapping
boxes, paint order does not change legality. If deliberate overlap requiring
`z-index` appears later, it is a separate backend contract decision; this
migration does not use `priority` for it. This matches the separation of layout
and stacking/painting in CSS ([W3C CSS 2.2, layered presentation](https://www.w3.org/TR/CSS22/visuren.html#layers)).

Current backend paint order remains fixed and independent of `priority`:

```text
tables
→ graphics
→ block placements (frames and other rendered blocks)
→ ordinary text lines
→ insertion lines
→ glyphs
```

Footer may therefore be painted after `main` text even though its box was
reserved earlier. That does not automatically mean a higher `z-index`; without
allowed overlap, the boxes simply cannot intersect. Dynamic header/footer must
not be painted outside the plan as a second independent mechanism.

### Existing `order` and `layer` vocabulary

Documentation already contains names for different orders. They are not
alternatives to `priority` and must not be collapsed into one number:

| Concept | Owner | Meaning | Relation to `priority` |
|---|---|---|---|
| `flow`/route order | template route and slots | order in which a flow's content moves through slots and pages | limits legal places; `priority` may decide which route reserves geometry first |
| source/visual order | evaluator (`CONTENT_ORDER_VIOLATION`, `QUOTE_ORDER_VIOLATION`) | order of authored blocks/fragments after materialization | hard legality check, not paint order |
| `layer: flow \| insertion` | `CompositionLine` and backend | ordinary text versus insertion text; backend currently paints insertion lines after ordinary lines | not depth and not `priority` |
| `paint: boolean` | `CompositionGraphicPlacement` and backend | whether a graphic is physically drawn; `paint: false` may leave only an obstacle geometry | visibility switch, not drawing order |
| `reserved` | `CompositionSlotTemplate` | slot/box occupied by chrome or other geometry without an ordinary flow | space reservation, not paint layer |
| `flowBarrierBoxCandidates` / obstacles | planner and evaluator | geometric barriers around which text may continue | affects space calculations; not paint objects |
| `z_order` in occlusion prototypes | prototype raster/QA for overlapping graphics | which color/shape is visible in a physical overlap | paint-only graphics, outside flow/chrome contract |
| `paintOrder`, `readingOrder`, `selectionGroup` | old research TODO | possible future PDF tags/layers | paint order deferred to [release 1.1](../release-1.1/01-paint-order-contract.md); reading/selection out of scope |

In practice, `priority` is metadata for a claim to earlier geometry
materialization. `order` in routes and evaluators keeps its existing meaning,
and `layer` remains a technical distinction in rendered data. Current backend
order is only a migration baseline; it may later become explicit policy if the
sort direction and tie behavior are defined.

### Owner of `priority` and drawing order

In release 1.0, `priority` is used only for geometry reservation and
materialization order. Explicit paint order is not part of this contract; its
proposal is in [release 1.1](../release-1.1/01-paint-order-contract.md). One
`priority` concept could later also feed paint policy, but that would be an
explicit backend mapping, not an accidental array order:

1. the adapter may derive/pass `priority` for a flow or placement;
2. the planner carries it with geometry and uses it for materialization order
   and space claims;
3. the evaluator checks box legality, coverage, and allowed collisions;
4. the 1.0 backend preserves the fixed operation order; 1.1 may apply explicit
   rendering-phase policy.

`priority` answers “whose geometry and obstacle must be resolved first?”. It is
not a second stacking contract. Footer may have high `priority` so its box is
known before `main`, while the backend still paints it in the current location
and order. If intentional overlap requiring z-index appears, it is a separate
backend extension. If paint is ever linked to `priority`, the contract must
state whether a larger number means later paint (higher layer) or only earlier
reservation; it cannot remain an undocumented array-order effect.

`template_ref` currently selects one compiled template for the whole
composition run, so repeat cannot accidentally switch templates. The route's
layout schedule is sufficient for title and continuation page exceptions; it
is not misrepresented as a validated name list. Only when a document may mix
different `template_ref` values per page should a corresponding mandatory
template allowlist be added; no global renderer exception is introduced.

Until migration is complete, the Astra-audited current behavior applies:
`planDocumentOnce()` first materializes a page and plans ordinary flows and
insertions, then runs each repeating flow over already-created pages. Repeat
does not currently call `ensurePage`; moving it before `main` is a deliberate
Plan 12 change, not behavior already available at runtime.

Current-model repetition example:

| `template_ref` | Page layout | `header` instance |
|---|---|---|
| `pages/showcase-report` | `pages/showcase-report:title` | no; header route does not include the title page |
| `pages/showcase-report` | `pages/showcase-report:first` | only if the route explicitly contains this layout |
| `pages/showcase-report` | `pages/showcase-report:continuation` | yes, if this layout occurs at the page's route position |
| another `template_ref` | any of its layouts | does not inherit the header from `pages/showcase-report` |

### Content-dependent height

- Default mode remains fixed: omitted `fit_content` means the slot respects the
  template frame. Variable mode is explicit `fit_content: true` and cannot be
  enabled merely by longer text.
- An empty header occupies no space unless the template declares a non-zero
  minimum, for example for brand lockup, or uses fixed mode.
- A non-empty header receives measured-content height plus shared
  `padding-top` and `padding-bottom` from render configuration.
- A wrapped title increases header height, and subsequent slots move down
  without changing order.
- `fit_content`, growth, and maximum height belong to slot/layout, not special
  `pageChrome` code.
- `overflow` always comes from the template slot. `fit_content` says whether a
  box may grow; `overflow` says what happens after frame or limit overflow. An
  omitted value normalizes to `reject`. `shrink-to-fit` works only when the
  template explicitly chooses it and is not a planner fallback.
- Exceeding maximum height, page bottom, or a hard obstacle rejects the
  candidate; do not squeeze `main` to hide a violation.
- Padding and limits are configurable in YAML render-config, not TypeScript
  literals.

### Page chrome as a projection

`pageChrome` remains an output structure for the rendering backend, but it does
not own header content or geometry. The renderer may use it to draw:

- header background or band;
- rule below the header;
- lockup/logo;
- footer rule;
- page number and other final-plan-dependent metadata.

Every element must identify its geometry source: a flow slot, measured header
group, or explicitly defined template decoration. No second hidden rectangle
may independently restrict `main`.

## Required changes and consequences

This is the implementation boundary. YAML alone is insufficient because the
current pipeline keeps lockup and page number outside the ordinary block path.

| Location | Change | Consequence / risk |
|---|---|---|
| `server/src/contracts/input/schema.ts` | **done:** `type: lockup` with `lockup.mark_asset_id` and `lockup.label`; extended `allowed_block_kinds` | public `CompositionInput` has an additive block kind; validation rejects both components missing |
| `server/src/composition/contracts/model.ts` | **done:** renderer-neutral `CompositionLockup` and `CompositionBlockKind = ... | 'lockup'` | capability and dispatch are explicitly keyed by `lockup` |
| `server/src/composition/adapters/input.ts` + mark adapter | normalize lockup and materialize the default block from brand profile only when route has a lockup slot | old report without `flows.header` may lose the logo if template receives no explicit slot; intended detectable contract change, not renderer fallback |
| `server/src/composition/adapters/page-template-slots.ts` | **done:** `declaredLockupSlotsForFlow()` returns ordinary `kind: block` slot with `allowedBlockKinds: ['lockup']` | lockup is measured, covered, and evaluated like table/chart; no invisible empty-logo reservation |
| `server/src/composition/adapters/page-template.ts` | pass `fit_content`, `grow`, `gap`, `overflow`, and `continuation_frame`; replace band-only `auxiliaryFrame` for dynamic header | `reserved_bands.header` stops being a second boundary source; old templates without header flow must be classified fixed or receive a flow |
| `server/src/composition/layout/document-layout.ts` | materialize repeating header before insertions and `main`, footer after page; compute new boundary before planning `main` | placement and debug/decision order changes; do not preserve old order only because a test expects a historical offset |
| block measurement capability | **done:** measure mark + label + gap from actual asset bounds | missing logo reserves no width; long label follows slot geometry |
| `server/src/composition/layout/structured-block-placement.ts`, `page-state.ts`, evaluator | **done:** lockup is atomic block with compatibility and slot growth | lockup in `main` is possible only when block kind is explicitly allowed |
| placeholder resolver + PDF backend | one `{{page.number}}`/`{{page.count}}` resolver for measurement, debug, render; footer-page is one text placement | removes mismatch between measured width and `${page} / ${pageCount}`; final count must be known before render, without second planning |
| `server/src/report/renderer.ts` | remove direct logo, brand-name, and page-number drawing from `drawReportChrome()`; keep only decorations not modeled as blocks | PDF no longer silently repairs an incomplete plan; template without footer flow shows no number until explicitly migrated |
| `server/src/composition/contracts/engine-contracts.ts` | retain `CompositionPagePlan.chrome` as projection, but point to source placements/boxes instead of duplicate content dimensions | debug/CLI API may need field updates, but MCP tools and transport names do not change |
| `server/templates/pages/*` + `server/src/generated/builtin-template-files.ts` | add explicit header/footer slots/flows to templates that render chrome; rebuild generated files | unmigrated template keeps only consciously selected fixed band or loses old renderer chrome; `npm run build:templates` is part of migration |
| composition/PDF/visual-QA tests | split fixed and dynamic fixtures; add missing lockup, long title, collision, 1/10+ page, and title-layout cases | assertions based on `headerBandHeight` must move to result `slotBoxes`; tests of a specific fixed band remain unchanged |

### Effects on existing templates

1. `showcase-report*` has a `header` flow and `header-lockup` slot; the dynamic
   template now treats that slot as an ordinary block. Automatic `brand-lockup`
   from the brand profile is still needed when input does not supply it.
2. `default-report` and `editorial-*` currently rely mainly on
   `reserved_bands`. Each must be explicitly kept as a fixed chrome fixture or
   rewritten to an explicit header/footer flow. Two sources with different
   heights must not coexist.
3. A title layout may have a footer, but a header must not appear there by
   inheritance. `route.layouts` and `slotsByLayout` remain the allowlist of
   pages on which repeat is legal.
4. If a template has only `reserved_bands.footer` and no footer flow, page
   numbering is not generated automatically after migration. This is
   intentional: every visible chrome element must have a template owner or be
   explicitly marked decoration.

### Effects on public MCP/CLI

No new tool or invocation mode is required. `render_report`, `dry_run`,
`composition_debug`, and the CLI path keep the same request; only the
additive block union and resulting geometry change. The response may contain a
lockup placement like any other block. A template that previously relied on
renderer logo/page-number fallback has a visual compatibility change, so
template and generated-artifact migration is required before the fallback is
removed.

## Test migration strategy

Existing tests often assert a fixed header height. Do not remove that assumption
mechanically. Give every fixture one explicit classification:

| Fixture type | Setting | Assertion |
|---|---|---|
| tests content-dependent geometry | `fit_content: true` | `main` start and subsequent slots derive from the measured header box |
| tests a specific fixed band/template | omit `fit_content`, fixed frame | preserve the template-declared height and boundary |

A test must not accidentally check fixed height merely because it knows a
historical renderer offset. Derive expected offset from the plan (`slotBoxes`,
obstacle, or resulting chrome boundary). Keep a fixed frame where its behavior
is the test's point, such as a specific-template regression, not as the default
assumption for every test.

## Generated page variables

Retain existing placeholder syntax:

```text
{{page.number}}  — page number starting at 1
{{page.count}}   — page count of the accepted plan
```

Both variables are available in every text slot, including header, footer, and
other repeating flows. Do not introduce `{page}` or `{numberOfPages}` aliases.
`pageCount` remains a local implementation name.

These are not two separate blocks or placements. The template declares one text
slot, for example `footer-page-number`, whose content is
`"{{page.number}} / {{page.count}}"`; the resolver substitutes both values in
that text, and the planner measures the resulting string as one block.

`{{page.number}}` and `{{page.count}}` are substituted after the final accepted
plan is known, but their box is measured earlier with width reserved for the
largest permitted page number (`maxPages`). This avoids a second planner
iteration merely because `9` became `10`. Measurement and rendering use the
same width calculator; a plan beyond the configured page limit is rejected like
any other out-of-limit plan.

Examples:

```text
footer text: "{{page.number}} / {{page.count}}"
header title source: "{{flow.title.blocks[0].text}}"
```

Do not additionally assemble `${page} / ${pageCount}` in the renderer when the
template declares page number as a text slot.

## Cases requiring explicit outcomes

| Case | Expected behavior |
|---|---|
| no title, no lockup, variable mode | header collapses to zero; `main` starts at normal content position |
| no title, fixed mode | declared empty frame remains; deliberate template choice |
| no title, brand lockup | only declared lockup minimum and padding remain |
| short title | one line, shared padding, no empty excess height |
| long title | wrap and slot growth; later insertions and `main` move down |
| title exceeds maximum height | candidate rejected with diagnostics; no content compression |
| `{{page.number}}` changes width from `9` to `10` | box measured with `maxPages` reservation; render uses same calculator |
| `{{page.count}}` is not yet known | box reserves `maxPages` width; final number substituted after plan acceptance |
| footer without content | no empty footer frame unless template requires a minimum |
| footer with page number | ordinary repeating text slot using existing placeholders |
| first page without header | determined by `start_page`/layout, not renderer condition |
| subsequent pages with different header | each page layout measures its own slot set |
| header collides with hard insertion | candidate illegal; insertion must not be covered |
| header pushes `main` beyond page | candidate illegal or next page created by ordinary rules |
| page contains only chrome | do not create an empty continuation page without required content |
| debug PDF and ordinary PDF | both use the same result-plan boxes |
| logo + brand name | lockup keeps variant `gap_mm` and vertical alignment to actual logo |
| logo without brand name | group contains only logo; no trailing gap |
| brand name without logo | group contains only text; no invisible logo width |
| long brand description/name | measure width; exceedance becomes `shrink-to-fit` or rejection according to slot policy |
| standard versus continuation | each variant keeps its own logo size, font, maximum height, and gap |
| lockup collides with `header-period` | candidate illegal; do not move text outside the declared slot without a layout rule |

## Implementation order

1. Define the header/footer group and minimum/maximum/padding configuration in
   template contracts.
2. Extract one resolver for existing placeholders and use it in measurement
   and the PDF backend.
3. Change page planning so header and required insertions resolve before
   `main`. **Done for repeating header:** header is materialized before the
   ordinary flow, and new pages receive it in a second pass without duplicating
   the first page.
4. Add a dynamic header/footer group-geometry calculator. **Done for text
   header:** it returns boxes and reasons for growth or collapse.
5. Feed calculator results into obstacles/frames available to `main` and
   insertions. **Done:** `grow.pushes` moves main slots during header
   materialization.
6. Change `pageChrome()` to project result slots and decorations without
   independently calculating header-band height. **Partly done:** dynamic band
   takes its boundary from active header slots; explicit lockup renders from
   the plan, while fallback remains only for documents without the block.
7. Remove hard-coded page-number assembly where the number is already a text
   slot.
8. Add legality validation for minimum, maximum, collision, overflow, and empty
   pages.
9. Give debug, `dry_run`, manifest, and PDF the same geometry.
10. Rewrite chrome tests for short, long, empty, and multi-page header fixtures
    and number-digit changes. **Done for 1.0 scope:** parser, planner, and PDF
    have long and empty dynamic-header fixtures, explicit lockup, and repeating
    footer; automatic lockup from brand profile remains 1.1.

## Completion criteria

- changing title height changes the header box and `main` start without manual
  correction in another template;
- an empty header leaves no unjustified empty space;
- header and footer are repeating flows, not an alternative renderer path;
- `{{page.number}}` and `{{page.count}}` have one resolver and one contract;
- plan, debug, and PDF use the same chrome frames;
- final page count is known before resolving `{{page.count}}`;
- every illegal collision or overflow rejects the plan with diagnostics, rather
  than silently clipping;
- tests cover no content, lockup without title, multi-line title, limits, first
  page, continuation, footer, and numbering 1–9 and 10+;
- visual QA confirms shared padding and no empty band after header collapse;
- MCP, CLI, `dry_run`, and ordinary PDF retain the existing contract except for
  the intended dynamic chrome geometry change.

## Out of scope

We do not build a global CSS solver or a new `Header` entity. Existing
placeholder syntax is unchanged, and `main` content is not moved into
`insertionSlots`.

## Release boundary and deferred 1.1 work

The release-1.0 implementation and its documentation are complete for dynamic
template-declared chrome. Documentation/legacy audits may still identify old
fields and fixed templates, but those audits do not change the 1.0 contract.
Optimization follow-ups may remove duplicated measurements or expensive test
paths while preserving the current flow. Automatic brand lockup creation from
the profile, removal of the legacy renderer fallback, and explicit `paintOrder`
remain deferred to release 1.1.
