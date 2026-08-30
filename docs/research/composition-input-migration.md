# CompositionInput migration boundary

Date: 2026-08-28

## Current contract

The production `render_report` path accepts a semantic `CompositionInput`:

```text
flows + semantic blocks
  → compositionDocumentFromInput
  → template/page geometry adapter
  → planner + evaluator
  → jsPDF metrics and drawing capabilities
  → PDF
```

The input contains named flows such as `main`, `header`, `footer`, `title` and
application-defined flows. Blocks are `text`, `heading`, `list-item`, `image`,
`table`, `chart` and `metric`. `headerContent` and `footerContent` are small
aliases for the same flow vocabulary; they are not compatibility with the
former report object.

The former `sections`/`charts`/`kpis`/`title_page` object is not accepted by
production code. This is intentional: old scenarios are translated only in
the test harness by `server/scripts/lib/legacy-fixture-to-composition-input.mjs`.
`fixtureDocument()` hides that test-only translation and the production
normalization from low-level planner tests. No legacy translator is bundled
into MCP, CLI or the renderer.

## Responsibilities

- `CompositionInput` expresses content and meaning, not coordinates.
- The template declares page layouts, named slots, flow routes, repetition and
  continuation policy.
- The planner measures and places content, preserving flow order and deciding
  the next legal slot or page.
- The evaluator rejects collisions, out-of-bounds placements, missing content
  and unsupported atomic blocks before drawing.
- The jsPDF adapter supplies real font measurements and renderers for images,
  metrics, charts and row-fragmented tables. It draws the accepted plan; it
  does not choose a new column or silently reflow content.
- The brand supplies fonts, colors, spacing/theme values and asset resolution;
  it does not supply a second report data model.

Headers, footers, intro boxes, sidebars and quotes are ordinary semantic blocks
assigned to flows and slots. A title page is likewise a layout/flow choice,
not a separate procedural renderer. A template can expose a sidebar on its
opening layout and omit it on a continuation layout while keeping `main` in a
named flow. If a flow has no legal destination, the evaluator returns the
conflict/residual content instead of dropping it.

Images are rectangular assets. `wrap: left|right` reserves a measured
rectangular boundary in the text slot; image clipping and non-rectangular
source graphics are outside this contract. A chart is generated as an image
before planning, so it still follows the same block/slot rules.

## Verification

The current gates are:

- `npm run build`
- `npm test`
- `npm run goals:input-errors`
- `npm run arch:check`
- `npm run test:report-images`

The editorial harness currently exercises 506 migrated fixture variants,
including multi-page continuation, unequal columns, intro expansion, tables,
images, floats and brand ZIP assets. The test-only fixture translator remains
deliberately separate so these cases can be retained without making the
production contract harder for an LLM to use.

## Selecting a page template

`render_report` uses `template` or `template_ref`; when neither is supplied,
it selects `default-report`. The chosen report template determines the normal
main-flow route and its continuation layouts. Supplying a `title` flow is the
declarative signal that the selected template should materialize its title-page
layout. Built-in page templates declare that layout with the named
`title-page-content` and `title-page-footer` slots; the adapter routes `title`
there with `continuation: forbidden` and starts `main` on page 2. The caller
therefore does not repeat a title-page switch or add a special continuation
flag to ordinary title content. A page template that opts into title flows must
provide both named slots, otherwise adaptation fails with an actionable error.

For ordinary flow definitions, `continuation` defaults to `allowed`. A template
can still override the route to `forbidden` for a page-local flow such as a
title, footer, or sidebar. This keeps the simple input model permissive while
leaving page policy with the template.

## Slide migration

Slides use the same semantic block vocabulary but have a different document
unit: one slide is one discrete composition surface. The public deck input is:

```text
slides[]
  layout: title | metrics | chart | table | narrative | conclusions | columns
  flows: title, subtitle, eyebrow, main, left, right, footer
```

The selected `layout` determines which flows are required. A `columns` slide
uses `left` and `right`; a `metrics` slide uses metric blocks in `main`; a
`narrative` slide uses one text block followed by `list-item` blocks. A slide
flow defaults to `continuation: forbidden`, because moving a paragraph from
one slide to another would change the authored presentation. Cross-slide
continuation remains a deliberate future template policy, not an accidental
effect of a full text buffer.

The old `type`/`data` showcase wrapper is gone from the repository fixtures.
The old typed shape still exists inside the renderer as an implementation
adapter for the existing drawing code, which is why PDF, PNG and editable PPTX
can be migrated together without exposing three backend-specific input models.
Per-slide `footer` flow is materialized independently; deck-level `footer`
remains the fallback for slides that do not declare one.
