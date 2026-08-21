# Review: brand system and template rendering

State reviewed: working tree of 2026-08-20 late evening (`main`, uncommitted
brand/template work in progress). Findings reference files and symbols rather
than line numbers, because the renderer was being edited while this review was
written.

Verification performed: `npm run build`, `npm test` and `npm run test:brand` all
passed; the distribution finding below was reproduced by running a copied
`bundle.cjs` outside the repository.

## 1. What the system does today

The pipeline already matches the shape described in
`BRANDBOOK-TEMPLATE-CONTRACT.md`:

```text
_brand.yml + profiles/*.yml   → resolveBrandContext  → RenderTheme + RenderComposition
templates/**/template.yml     → compileTemplateSource → CompiledTemplate
                              → resolvePlan           → ResolvedTemplatePlan
                              → resolveSlidePlan      → ResolvedSlidePlan (1600×900 px)
                              → SVG/PNG, PDF (raster), PPTX
```

Parts that are working well and should not be disturbed:

- **Layer separation** between brand, profile, template and showcase, including
  profile inheritance with `extends` and cycle detection (`brand.ts`,
  `readProfile`).
- **`compileTemplateSource`** (`template-source.ts`) is a small, strict
  validator: YAML-path error messages, normalized frames checked against the
  0..1 canvas, optional `no_overlap`. This is the healthiest module in the
  system.
- **Release snapshots**: `active.json` → `releases/<version>/`, with compiled
  JSON templates preferred over source (`brand.ts`, `activeReleaseDirectory`,
  `readBrandTemplateSource`).
- **`safeRelativePath`** as an explicit trust boundary, `brand://` reference
  parsing, and an MCP surface that never mutates a brandbook.

## 2. What can be authored today

| Layer | Supported | Limits |
| --- | --- | --- |
| Brand | palettes with aliases, light/dark variants, colour roles, `series`, base/heading/role fonts, four logo variants, hero/cover/report-header images, TTF assets | dark variants are selected only by testing whether `surface` contains the substring `dark` (`selectVariant`); there is no explicit field |
| Profile | `layout.*` overrides, asset replacement, asset removal via `null` | removal via `null` works only as a side effect of `merge` plus `asString`; it is undocumented and untested |
| Slide template | own `regions`/`slots`, `max_lines`, `reject`/`shrink-to-fit`, archetypes, RTL mirroring | four slot kinds only; no `relations`, no `extends`, no image `fit`/`focal_point` although the contract specifies them |
| A4 page template | nothing | `kind: page` compiles, but no renderer consumes it |
| Showcase | decks and reports, per-slide profiles | flat validation; `cases.yml` is not read by MCP |

## 3. Blocking defects

### 3.1 The bundle is no longer self-contained (release blocker)

`slides.ts` calls `readRenderConfig()` at module scope, and
`builtin-template-loader.ts` resolves a `templates/` directory on disk.
A `bundle.cjs` copied without that directory fails to start at import time,
before any tool call:

```text
Error: Render configuration was not found in <cwd>/templates
```

Meanwhile `scripts/start-mcp.js` downloads only `server/bundle.cjs`, and
`update_plugin` (`tools/auth.ts`) downloads bundle, `package.json`,
`start-mcp.js` and `CHANGELOG.md` — no file under `server/templates/`. So the
wrapper install (`~/.report-baby`) and any self-update that introduces a new
template yield a server that cannot boot. `server/templates/` is also still
untracked in git.

Recommended fix: generate `src/generated/builtin-templates.ts` from the YAML
files at build time (or use an esbuild text loader with explicit imports), and
keep `REPORT_BABY_TEMPLATE_DIR` as an optional development override. The YAML
files stay the source of truth and the bundle stays a single file. Adding the
files to `update_plugin` and `start-mcp.js` instead is fragile: the list grows
with every new template.

### 3.2 An absolute path bypasses the path boundary

In `resolveBrandContext`, a file-shaped `brand_ref` is used verbatim when it is
absolute: `isAbsolute(reference.filePath) ? reference.filePath : safeRelativePath(...)`.
`assetPath` accepts absolute asset paths the same way. A caller can therefore
point the renderer at an arbitrary YAML file outside the brand root, and any
brand document can name an arbitrary file as `font_regular` or
`background_image`, whose bytes are then embedded into the PDF/PPTX through
`assetDataUri`. `safeRelativePath` exists precisely to prevent this, so the
`isAbsolute` escape removes the guarantee it provides.

Recommended boundary: allow absolute paths only for `assets.source_root`
resolved against a configured allow-list, never for a `brand_ref` arriving from
an MCP request.

### 3.3 Two diverging input schemas

The slide contract is written twice: as Zod schemas in `tools/render.ts` and as
hand-written checks in `slide-context.ts` (`validateSlide`). They have already
drifted:

- `slideSchema` has no `columns` member, so the two-column slide — which has a
  template (`slides/two-column`), validation and a renderer — is unreachable
  through MCP and works only through the `example.ts` CLI.
- `title_page` is part of `ReportData` and handled by `renderTitlePage`, and it
  is documented in `skills/report-authoring/SKILL.md` and used by
  `scripts/test-brand-contract.js`, but it is absent from `reportDataSchema`,
  so MCP callers cannot send it.

One of the two definitions should be generated from the other.

### 3.4 `template_ref` is a trap in `render_report`

`tools/render.ts` passes `template_ref ?? template` into `renderReportPdf`, and
`resolveTemplate` (`templates.ts`) takes the last path segment and throws
`Unknown template` for anything other than `default-report` and
`campaign-summary`. The field description promises a
"composition/template reference", so a caller passing
`brand://acme/pages/executive-report` gets a hard failure. Either reject
`template_ref` for A4 with an explanatory error, or stop exposing the field on
that tool.

## 4. Rendering architecture debt

### 4.1 Two geometry systems still coexist

This is the explicit "stop" gate of Stage 2 in
`BRANDBOOK-TEMPLATE-IMPLEMENTATION-PLAN.md`. `slides.ts` contains roughly a
hundred `plan?.` accesses and about thirty numeric `?? <literal>` fallbacks of
the form:

```ts
const headerTitleBox = plan?.sourceTemplate ? plan.slots.title : { x: 80, y: layout.headerTitleY - 70, width: 1440, height: 100 };
```

Worse, the decision "does this template own its geometry?" is encoded as a magic
identifier comparison in two files:

```ts
const typedSource = Boolean(plan?.sourceTemplate && plan.sourceTemplate.id !== 'slides/standard');   // slides.ts
const legacyTemplateRef = ... !['slides/standard', 'slides/compact', 'slides/centered-title', 'slides/two-column'].includes(...)  // slide-plan.ts
```

That fact belongs in `CompiledTemplate` as a field — for example
`geometry: 'full' | 'chrome-only'` — set by the compiler. Then `slides.ts` no
longer needs to know the names of the built-in templates.

The root cause is inconsistency between the built-in templates themselves:
`standard` and `two-column` declare `kind: slide` plus `slots`, while `compact`
and `centered-title` carry only six `header_*_y` numbers, so
`readBuiltinTemplateSource` returns `undefined` for them and rendering takes a
different code path. Bringing those two files up to the same shape removes a
large share of the fallbacks for free.

### 4.2 `render-config.yml: legacy` is a bag of magic numbers

Sixty-five keys, sixteen of them unused at the time of review
(`conclusion_step`, `name_width`, `footer_text_width`, `table_row_max_height`,
`mono_title_glyph_width`, `title_graphic_max_chars`, and others). The Stage 0
gate says to stop if extraction only copies hardcoded values into YAML without
named regions and semantic roles — the `legacy` section is exactly that. The
extraction is also incomplete: literals such as `25`, `27`, `347`, `442`, `86`,
`500`, `38`, `24`, `48` remain inside `renderSlideSvg`.

Target rule: a number lives either in a template (because it is geometry) or in
`render-config` under a semantic name (because it is typography or rhythm), and
`legacy` disappears together with the branch that read it. Names such as
`conclusion_icon_text_width: 92` are misleading: the value is a character
limit, not a width.

### 4.3 PPTX carries a third copy of the geometry

Despite `PX_PER_INCH` living in the same file, the PPTX path hardcodes
`w: 13.33`, `h: 7.5`, `fontSize: 8/10/22/25`,
`{ x: 80, y: 842, width: 1440, height: 42 }` and offsets `+12`, `-260`, `-120`.
An adapter should know no number that is absent from the plan; today changing
the footer in YAML changes PNG output and leaves PPTX untouched.

### 4.4 Two different ways of measuring text

The A4 path uses `doc.splitTextToSize`, i.e. real metrics of the embedded font.
The slide path estimates width as `value.length * size * 0.56`
(`estimatedTextWidth`) and then *throws* from `assertTextFitsBox` on that
estimate. The renderer therefore fails deterministically for content that would
fit (narrower font) and silently overflows for content that does not (wider
font) — and brands are exactly the feature that swaps fonts, so `0.56` is the
one constant that cannot be trusted.

`newPdf()` already registers the brand font with jsPDF. A single
`measureText(text, font, size)` built on `doc.getTextWidth` (or on the `hmtx`
and `cmap` tables of the TTF already held in memory) removes this entire class
of defects and lets `shrink-to-fit` operate on real widths.

Related: implementing `overflow: reject` as a `throw` from the renderer means
one over-long title destroys a whole deck with no artifact. An MCP-shaped result
is per-slide diagnostics (`rejected: [{ slide, slot, reason }]`) plus an artifact
for the remaining slides, so the caller has something to correct.

### 4.5 A4 is outside the template system

`templates.ts` consumes `RenderTheme`, but its composition is `PAGE_W`,
`MARGIN`, `54`, `22`, `9` in code, with two variants that differ only by a
default title (`resolveTemplate`), and no relationship to `CompiledTemplate`.
This is consistent with the plan — PDF is the next family — but it should be
stated explicitly in `README.md` and `CLAUDE.md`, which currently suggest one
unified system.

## 5. Code quality

- **Density.** `slides.ts` is roughly 800 lines in 81 KB: about 120 lines exceed
  200 characters and the longest exceeds 500. Single expressions carry four
  nested ternaries (`lockupGeometry`). The "no comments, names document intent"
  convention only works when there is something to name; here everything is one
  expression. `renderSlideSvg` (about 160 lines, six archetype branches) wants
  splitting into per-archetype functions sharing one contract
  `(plan, theme, slide) => string[]`.
- **Dead code.** `template-catalog.ts` (about 190 lines,
  `EXISTING_TEMPLATE_CATALOG`, `EXISTING_SLIDE_TEMPLATE_LAYOUTS`) is imported
  nowhere and is a fourth copy of the same numbers; if it is documentation, it
  belongs in `docs/template-inventory.md`. `listBuiltinSlideTemplates` is also
  unused and hardcodes a list of four names next to a loader that can read the
  directory.
- **No caching.** `resolveSlideDeck` calls `resolveBrandContext` once per deck
  and once per slide, so a twenty-slide deck parses the same `_brand.yml` and
  profiles twenty-one times. `resolveSlideTemplate` does a `readFileSync` per
  slide, and `assetDataUri` re-reads and re-base64s the same hero image for
  every slide. A `path → Promise<result>` map for the duration of one render is
  enough.
- **Data model mixed with execution state.** `SlideDeck` carries public `slides`
  next to injected `slideThemes`, `slidePlans` and `slideTemplateSources`, so
  renderers read user input and resolver output from one object. A
  `ResolvedSlideDeck { deck, plans[], themes[] }` is cleaner and half-exists
  already.
- **Dead rule.** `validateSlideContent` rejects table cells longer than 46
  characters while the renderer also does `String(cell).slice(0, 46)`; one of
  those two rules can never execute.
- **Template discoverability.** `list_templates` returns only the two A4
  templates; nothing tells a caller that `slides/standard`, `slides/compact`,
  `slides/centered-title` and `slides/two-column` exist.
  `list_brand_templates` covers brand-owned templates only. One tool returning
  both, tagged `builtin` or `brand`, would close Stage 6.
- **Geometry in profiles.** The contract states that geometry is not allowed in
  profiles, yet `layout` accepts `title_logo_width_px`,
  `title_logo_height_px` and `image_text_safe_area`. Either document these as a
  deliberate exception or move them into `lockup`/`image` slots of a template.
- **The presentation PDF is a raster.** `renderSlidesPdf` places a 1600×900 PNG
  on a 400×225 mm page (about 101 DPI). Acceptable on screen, not for print;
  worth stating in the tool description, since "PDF" implies vector.

## 6. Suggested repair order

1. Templates into the bundle (embedded at build time) and `server/templates/`
   into git — nothing can ship before this.
2. Close the `isAbsolute` escape for `brand_ref` and brand assets.
3. One source for the input schema; while there, unblock `columns` and
   `title_page`, and fix `template_ref` on `render_report`.
4. `measureText` on real font metrics, shared by A4 and slides; turn `reject`
   into diagnostics instead of an exception.
5. `geometry: full | chrome-only` in `CompiledTemplate`, bring `compact` and
   `centered-title` up to full `slots`, then delete the `typedSource` branches
   and the `legacy` entries that die with them.
6. PPTX with no numbers of its own — plan only. A mutation test ("move a region
   in YAML") can then genuinely guard three-format parity.
7. Only then the A4 page family as `kind: page`.

Items 5 and 6 are the conditions that Stage 2 of the implementation plan names
for moving on. They are not met yet, even though the plan marks that stage
accepted. The rest of the brand system is in decent shape and heading the right
way; the debt is concentrated in `slides.ts` and in distribution.
