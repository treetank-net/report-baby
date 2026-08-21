# Inventory of current templates

This document describes the starting point before moving composition into
brandbooks. It is not yet a format users are expected to write. Its purpose is
to answer a simple question: what actually affects the output today, and where
is it recorded?

## What we found

### A4 PDF

`server/src/templates.ts` contains two public cases:

- `default-report` — a multi-page report with header, intro, KPI cards, charts,
  text sections, table, highlights, and footer;
- `campaign-summary` — a shorter report that currently uses the same building
  blocks but has its own default title and purpose.

Shared baseline values are A4 `210 × 297 mm`, an `18 mm` margin, a `54 mm`
header, and a footer near the bottom of each page. KPI cards have a `5 mm`
gap and are `26 mm` high. A chart is first created as a `1400 px` image and
then fitted to the PDF content width. Tables and text may continue onto the
next page.

This does not mean that every PDF should use this layout. It means that this is
the first page family to extract from code. Other families, such as three-column
or editorial pages, should be separate templates.

### PPTX, SVG, and PNG

In `server/src/slides.ts` we found three header layout variants:

- `slides/standard`;
- `slides/compact`;
- `slides/centered-title`.

Content is currently rendered in six archetypes:

- `title` — lockup, eyebrow, title, subtitle, and optional graphic;
- `metrics` — one to six cards;
- `chart` — a chart;
- `table` — a table with up to ten rows;
- `narrative` — text and up to four highlights;
- `conclusions` — up to seven conclusions.

The main canvas is `1600 × 900 px`, represented in PPTX as `13.33 × 7.5`
inches. The regular header ends with a line at `202 px`, the band variant at
`230 px`, and the footer uses a line at `842 px` with text at `874 px`.

## How to read this split

Not every number in code is a separate user setting.

- `surface` says whether we are drawing an A4 page or a 16:9 slide;
- the template says where regions and slots are;
- the archetype says what kind of content goes into those slots;
- the brand profile supplies colors, fonts, logo, and background;
- a surface variant may change background and contrast, but should not copy all
  geometry;
- the renderer should receive a finished plan instead of inventing positions
  again.

For that reason this document, rather than a second copy in TypeScript, is
where inventory values live. An earlier transitional
`server/src/template-catalog.ts` held them as code; it was never imported by
the renderer and became a fourth copy of numbers that already existed in
`server/templates/render-config.yml`, the built-in `template.yml` files and the
renderers, so it was removed. Once a value moves to a source template and all
formats pass their tests, the corresponding code branch can be removed too.

## Knowledge needed to create a good template

Before adding a layout, answer these questions in plain language:

1. What should the audience see first?
2. Which elements are always present, and which may disappear?
3. What happens with a long title, a long word, or no graphic?
4. Does every piece of text fit its area and have sufficient contrast?
5. Is the image behind the text, or can it cover the text?
6. Is this a different composition, or only a light/dark version of the same
   composition?
7. Does this case deserve a new template, or can an existing template handle
   it without exceptions?

The first source brand template uses only named slots, frames expressed as
canvas proportions, line limits, and two decisions for overlong text: reject
or shrink. It does not yet allow arbitrary code, CSS, or positions tied to one
file format.

## First working example

`examples/brand-showcase/brands/flux/templates/slides/title/template.yml`
changes the position of the lockup, eyebrow, title, and subtitle on the first
slide of the Flux deck. The same file is used by the SVG/PNG, PDF, and PPTX
renderers.

Changing the example `title.frame` should therefore change all three outputs
without editing `server/src/slides.ts`.
