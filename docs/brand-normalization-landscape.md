# Brand-system normalization — landscape review

Review status: 2026-08-19.

## Conclusion

Mature patterns exist for three layers:

1. portable brand values and assets (`brand.yml`);
2. exchange of tokens and variants (DTCG, Resolver, Figma modes);
3. projecting shared sources onto different platforms (Style Dictionary).

There is no single open standard covering brand identity, multiple input
sources, data provenance, brand variants, and report or presentation
composition at the same time. Composition is still usually encoded in a Quarto
template, PPTX slide master, Canva, or a closed platform.

## Patterns worth using

### `brand.yml` / Quarto

`brand.yml` is the closest existing format for a portable brand kit. It covers
metadata, logos, color palettes, and typography, and can then be used by
Quarto, Shiny, and tools for reports, presentations, and dashboards.

Important patterns for us:

- a brand is a directory with a file and assets, not only a text value;
- logo and font paths are relative to the brand file;
- light/dark variants and multiple logo sizes are supported;
- `defaults` is intended for format-specific options;
- Quarto provides brand extensions and brand-directory synchronization.

`defaults` is intentionally incomplete and acts as an extension point for
tools. That is a good precedent for a small namespaced `defaults.report-baby`
extension, but the complete composition graph should not be placed there.

Sources: [brand.yml](https://posit-dev.github.io/brand-yml/), [brand.yml structure](https://posit-dev.github.io/brand-yml/brand/), [defaults](https://posit-dev.github.io/brand-yml/brand/defaults.html), [Quarto brand](https://quarto.org/docs/authoring/brand.html), [Quarto brand extensions](https://quarto.org/docs/extensions/brand.html).

### DTCG Format Module

DTCG defines a portable exchange format for design tokens. Stable version
`2025.10` covers tokens, groups, types, aliases, and extensions. It is not yet
a W3C Recommendation, but it is a stable W3C Community Group report with
multiple implementations.

It is a candidate for the value layer:

- colors and semantic roles;
- typography and sizes;
- spacing, borders, shadows, and other values when a renderer supports them;
- tokens shared by PDF, PPTX, and other surfaces.

It is not a brandbook format or a composition format.

Sources: [DTCG Format Module 2025.10](https://www.designtokens.org/tr/2025.10/format/), [DTCG technical reports](https://www.designtokens.org/technical-reports/), [DTCG FAQ](https://www.designtokens.org/faq/).

### DTCG Resolver Module

The Resolver is close to the need for multiple kits. It describes:

- multiple `sets` with separate sources;
- `modifiers` with named `contexts`;
- resolution order;
- selecting a variant through input;
- merging sources and resolving aliases.

The documentation example supports light/dark and high-contrast variants. This
is a useful pattern for `corporate`, `investor`, `dark`, `campaign`, or
`print/screen`.

The Resolver is still a draft and resolves tokens, not slide layouts. We may
adopt its conceptual model or a compatible subset, but must not present it as a
composition format.

Source: [DTCG Resolver Module](https://www.designtokens.org/tr/drafts/resolver/).

### Figma variables, collections, and modes

Figma uses a practical model: a collection contains variables and modes, and a
mode stores values for a context. Its documentation explicitly uses light/dark,
mobile/desktop, and localization as context examples. Variables can be aliased
and published as a library.

This is a useful UX and domain pattern for variants, but not a portable format
for report-baby. Tokens Studio additionally groups token sets into themes and
maps them to Figma collections/modes.

Sources: [Figma variables, collections and modes](https://help.figma.com/hc/en-us/articles/14506821864087-Overview-of-variables-collections-and-modes), [Tokens Studio themes](https://docs.tokens.studio/manage-themes/themes-overview).

### Style Dictionary

Style Dictionary is not a brand format, but it is a useful architectural
pattern:

```text
multiple source files → shared token vocabulary → per-platform transformation → output
```

Configuration can point to multiple sources, and each platform has its own
transforms and output format. This matches the separation of `BrandSystem` and
`RenderKit`: one set of values, with a separate projection for PDF/PPTX/PNG.

Sources: [Style Dictionary tokens](https://styledictionary.com/info/tokens/), [Style Dictionary configuration](https://styledictionary.com/reference/config/), [Style Dictionary transforms](https://styledictionary.com/reference/hooks/transforms/).

### OOXML theme / `theme1.xml`

Office has its own stable theme mechanism. The theme part affects colors, fonts,
backgrounds, fills, and effects; a presentation separately contains a slide
master and slide layouts. This is the correct output format for preserving a
PPTX theme, but not a shared brand format for PDF and other renderers.

Sources: [Microsoft Open XML — themes](https://learn.microsoft.com/en-us/office/open-xml/presentation/how-to-apply-a-theme-to-a-presentation), [Microsoft Open XML — presentation parts](https://learn.microsoft.com/en-us/office/open-xml/presentation/how-to-create-a-presentation-document-by-providing-a-file-name).

### AdCP `/.well-known/brand.json`

AdCP proposes machine-readable brand identity discovered through a domain. It
covers, among other things, brand portfolios, descriptions, voice, audiences,
logos, colors, and fonts. It is an interesting input adapter for a public brand
and a multi-brand portfolio.

It is not a token or document-composition format. Treat it as an optional
identity source, not as the renderer's internal contract.

Sources: [AdCP tools and standards](https://agenticadvertising.org/registry/tools), [AdCP brand.json builder](https://agenticadvertising.org/brand/builder).

## Recommendation for report-baby

Do not write a new format for brand values from scratch.

Proposed layers:

```text
_brand.yml                 # portable brand core and assets
tokens/                    # DTCG when more tokens are needed
resolver.json              # sets/modifiers/contexts model, preferably DTCG-compatible
compositions/              # small local recipe layer for reports/slides
sources/                   # input files and provenance
resolved/                  # merge result for one render
```

The new local part should be limited to `compositions` and provenance
metadata. There is currently no trustworthy portable standard describing both
“title slide, KPI, chart, comparison, table, closing” and the rules for
choosing among them.

In practice:

1. adapters read existing formats;
2. they write data and hypotheses to the context catalog;
3. the user or agent approves the variant and composition;
4. the resolver combines the selected brand, kit, surface, and composition
   plan;
5. the renderer receives only the deterministic resolved result.

The key boundary is this: tokens and variants can use existing patterns.
Composition must be designed locally, but should remain a small extension over
those patterns rather than a new “brandbook format” competing with DTCG or
`brand.yml`.
