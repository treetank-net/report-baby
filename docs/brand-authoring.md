# Creating and prototyping a brand

A brandbook does not belong in the `report-baby` repository. This repository
contains the renderer and neutral instructions; a concrete brand should live
next to its source, for example in a client repository or in a directory
managed by `marketing-context-mcp`.

## Do you need npm?

Not to use the installed plugin. Runtime distribution is the ready-made
`server/bundle.cjs`, so Node.js 18+ is enough.

`npm install` and `npm run build` are needed only by a developer changing
report-baby sources or building a new bundle.

## Minimal structure

```text
brands/acme/
  # schema_version: 1 in _brand.yml and showcase.yml
  _brand.yml
  profiles/primary.yml
  templates/slides/innovation-story/template.yml
  templates/slides/innovation-story/cases.yml
  assets/logos/acme.svg
```

`_brand.yml` describes shared identity, profiles describe meaningful variants,
and assets stay with the brand. Paths should be relative to `source_root` or
the brand directory.

Describe colors, typography, logo, and the basic background first. Add profiles
such as `dark`, `investor`, `campaign`, or `ecommerce` only when they express a
real use case. Composition belongs in a brand-owned template, not in an
accidental renderer override.

The brand directory does not have to contain the assets. Set
`assets.source_root` when the brand deliberately uses an existing asset library
owned by another directory or repository, for example a HubSpot theme:

```yaml
assets:
  source_root: /path/to/hubspot-trans/themes/ecommercetheme
  logo: images/logo-transeu.svg
  background_image: images/radar/rates-bg-hero.png
  cover_image: images/radar/rates-bg-hero.png
```

The loader checks that relative asset paths stay inside this explicitly chosen
root. This prevents a typo such as `../../.ssh/...` from silently changing the
meaning of the brand. It does not require the root itself to be inside the
brandbook directory: an explicitly configured external asset library is a
supported and intended setup.

An **absolute** `source_root`, as in the example above, additionally has to be
allow-listed by the environment. List its directory (or a parent) in
`REPORT_BABY_BRAND_SOURCE_ROOTS`, a `:`-separated list, otherwise the loader
rejects the brandbook with an explicit error. The reason is that a brandbook is
data that may arrive from outside: without the allow-list, an absolute
`source_root` would let a brand file name any path on the machine. A
`source_root` written relative to the brand directory needs no configuration.

Use separate visual roles when a report has a cover. `cover_image` belongs to
the first page; `layout.report_header_style` controls the ordinary report
pages. A report can therefore use a full-page image or gradient on its cover
and a simple accent band on later pages. If a report header should use an
image, set `report_header_style: image-band` and provide
`assets.report_header_image`. For a graphic-free cover, set
`layout.cover_background` to a deliberate solid color. Do not rely on
stretching the same image into both shapes.

## Start with the external tool

The easiest way to create a first working brand is to let the bundled
Node-only tool create a starter directory. It needs Node.js 18+, not npm:

```bash
node scripts/brand-tool.js init \
  --out /path/to/brands \
  --brand acme \
  --name "Acme" \
  --preset starter
```

Use `--preset campaign` for a dark navy, blue and orange starting point. The
command refuses to overwrite an existing brand directory and creates a logo
placeholder, one profile, one editable title template, template cases,
showcase data and a local README. Replace the placeholder asset before using
the brand for real work.

## Prototyping without MCP or npm

Prepare a report or deck JSON file and run:

```bash
node scripts/render-example.js \
  --kind deck \
  --brand-root /path/to/brands \
  --brand brand://acme/primary \
  --input ./deck.json \
  --out ./prototype/acme-primary \
  --formats pdf,png,pptx
```

For a report:

```bash
node scripts/render-example.js \
  --kind report \
  --brand-root /path/to/brands \
  --brand brand://acme/primary \
  --input ./report.json \
  --out ./prototype/acme-primary
```

Reports can start with a brand-controlled cover page. The cover is part of the
input data, while its colors, logo, image, alignment, and typography come from
the selected brand profile:

```json
{
  "title_page": {
    "eyebrow": "ACME · PRODUCT",
    "title": "A clear title for the decision",
    "subtitle": "One short sentence explaining the report",
    "period": "Q2 2026"
  },
  "title": "A clear title for the decision",
  "intro": "The regular report content starts on page two."
}
```

When `title_page` is present, the PDF always puts it on its own first page and
starts the normal report flow on page two. This is useful for testing real
reports rather than only isolated pages: long content can still continue over
later pages, with the regular header, footer, and page count applied there.

This runs a separate prototype bundle built from the same resolver and
renderer modules as the MCP bundle. Only the CLI entry point differs; the
rendering logic is shared. The result contains `manifest.json`, PDFs, PNGs,
and, for a deck, an editable PPTX.

## Brand showcase

If a brand has more than one meaningful use, add `showcase.yml` next to
`_brand.yml`. It defines sample data and surface profiles instead of forcing a
single appearance for the entire deck:

```yaml
showcase:
  decks:
    - id: mixed-surfaces
      slides:
        - template_ref: slides/title-hero
          profile: surfaces/graphic
          type: title
          data: { title: "Cover", subtitle: "Graphic surface" }
        - template_ref: slides/metrics-light
          profile: surfaces/light
          type: metrics
          data: { title: "Light mode", metrics: [...] }
        - template_ref: slides/chart-dark
          profile: surfaces/dark
          type: chart
          data: { title: "Dark mode", chart: {...} }
  reports:
    - id: light-report
      profile: surfaces/light
      data: { title: "Light report", ... }
```

Running `--kind showcase` generates every declared case and records the
selected profile beside each result. This is the intended demonstration
mechanism: a brand may define light, dark, gray, accent, and graphic surfaces,
while sample data shows why each exists.

The manifest stores paths relative to the output directory, and the generator
replaces the complete directory only after a successful render. Results can
therefore move between machines without `/home/...` paths or a partial
showcase.

## Brand-owned templates, composition, and RTL

Composition belongs to a versioned brand template. A profile selects tokens
and a surface; a template defines regions, slots, relations, constraints, and
behavior for longer content. Geometry is allowed in the template as normalized
frames, grids, and anchors; it is not allowed in a profile, MCP request, or
one-off override.

A brand may contain:

```text
templates/slides/innovation-story/template.yml
templates/slides/innovation-story/cases.yml
templates/pages/blog-article/template.yml
templates/fragments/slide-chrome.yml
```

Example template fragment:

```yaml
schema_version: 1
kind: slide
id: innovation-story
surface: slide-16x9
regions:
  copy: { frame: { x: 0.06, y: 0.08, width: 0.56, height: 0.38 } }
  visual: { frame: { x: 0.65, y: 0.06, width: 0.29, height: 0.46 } }
slots:
  title: { type: text, region: copy, role: heading-display, max_lines: 3, overflow: shrink-to-fit }
  graphic: { type: image, region: visual }
constraints:
  inside_canvas: true
  no_overlap: true
```

Built-in `slides/standard`, `slides/compact`, and `slides/centered-title` are
only the initial renderer catalog. `top-start` and `top-end` are logical
positions: `top-end` means the right side in LTR and the left side in RTL.
`direction: rtl` is used for Arabic or Hebrew. Templates use
`inline-start`/`inline-end`, not hand-written left/right exceptions. Charts
keep data order by default, and a graphic mark is not mirrored automatically.

The compiler creates one physical document plan containing boxes, text lines,
fonts, assets, render order, and diagnostics. Every renderer uses that plan.
Change composition in `template.yml`; change colors, fonts, or logos in the
brand or profile.

## Authoring a template

Use the external `brand-tool`, launched through the skill, to prototype and
publish templates. It is not a mutating tool in the `report-baby` MCP. The
current tool does not require npm; the ready-made bundle requires only Node.js:

```bash
node scripts/brand-tool.js validate \
  --brand-root /path/to/brands \
  --brand brand://acme/primary
node scripts/brand-tool.js template inspect \
  --brand-root /path/to/brands \
  --brand brand://acme/primary \
  --template slides/innovation-story
node scripts/brand-tool.js preview \
  --kind deck \
  --brand-root /path/to/brands \
  --brand brand://acme/primary \
  --input ./deck.json \
  --out ./prototype/acme \
  --formats png,pdf,pptx
node scripts/brand-tool.js publish \
  --brand-root /path/to/brands \
  --brand brand://acme/primary \
  --store /path/to/brand-store \
  --release 0.1.0
```

The LLM edits a small, named part of the template, validates it, and inspects
the showcase. `publish` writes compiled templates to a new immutable release
directory and switches the local `active.json`. Set
`REPORT_BABY_BRAND_STORE` to that store so MCP reads the active snapshot.
`REPORT_BABY_BRAND_DIR` remains the working-tree and prototyping directory.
MCP only reads brands and templates; creation and changes belong to this
external authoring tool or to the repository that owns the brand.

### Starting from a built-in fallback

Shared defaults are data, not TypeScript decisions. The standalone bundle
loads `server/templates/render-config.yml` and the built-in slide recipes at
runtime. To make a fallback your own, copy it into the brand and edit the
resulting `template.yml`:

```bash
node scripts/brand-tool.js template copy \
  --brand-root /path/to/brands \
  --brand brand://acme/primary \
  --from slides/two-column \
  --to slides/decision-two-column
```

The two-column fallback is intentionally a slide template. It is not offered
as an A4 page recipe, because an A4 version would need an explicit rule for
how text flows from one column to the next.

For small, explicit changes to an existing YAML file, the tool also provides a
guarded setter. It rewrites only a named key inside the selected brand:

```bash
node scripts/brand-tool.js set \
  --brand-root /path/to/brands \
  --brand brand://acme/primary \
  --path layout.title_align \
  --value center
```

The default target is the selected profile. Use `--file brand` for `_brand.yml`,
`--file showcase` for `showcase.yml`, or pass a relative YAML file path. The
setter is intentionally small: use normal file editing for larger template or
asset changes, then run `validate` and `preview`.

## Evaluating the result

For every new brand, check:

- logo and background are real brand assets;
- page, text, line, card, and chart colors match the profile;
- title, headings, footers, and pagination have the intended positions;
- fonts and text sizes are readable in PDF and preserved as font names in PPTX;
- `layout.image_text_color` provides contrast on light or dark image backgrounds;
- `layout.image_text_safe_area` and `image_scrim` keep graphics away from text;
- the same input is sensible in PDF, PNG, and PPTX;
- profile differences come from brand decisions, not accidental overrides.

Do not treat a different file hash as sufficient evidence. Judge composition
visually first, then inspect the manifest and resolver warnings.

When a brandbook contains font files, PDF and PNG use them in raster rendering,
while PPTX receives their names in editable text fields. The renderer does not
guarantee that PPTX embeds fonts self-sufficiently; recipients need the font or
must accept a fallback. The manifest and resolver warnings show the asset state.
For PDF/PNG embedding, provide a real TTF or OTF file in `assets.font_regular`
and, when needed, `assets.font_bold`. Browser-only WOFF/WOFF2 files are not a
safe substitute for editable report exports.
