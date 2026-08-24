# Report content images — plan

## Status

This is a design and implementation plan. It does not change the renderer, the
input contract, or any generated bundle by itself.

## Decisions agreed jointly

The following decisions were made jointly during planning:

- External `http://` and `https://` image URLs are accepted by default in v1.
  A separate opt-in is not required, and SSRF mitigation is not a v1
  constraint.
- Local paths, `brand://` references, and `source://` references remain valid
  image sources. Fetching, decoding, or rendering failures still produce the
  normal actionable diagnostics.
- Images are block content in the first iteration. Float placement, captions,
  figure numbering, and arbitrary text wrapping are separate later features.

## Goal

Allow an article or report body supplied as Markdown to contain images without
making images a special, fragile exception in the layout engine. The same
content model should support:

- ordinary block figures in reports;
- captions, alternative text, and explicit sizing;
- brand or article assets with or without transparency;
- consistent placement in PDF, PNG, and, where supported, PPTX;
- a later, deliberately constrained form of manual `float` beside text.

The first version should have deterministic placement and flow for the resolved
image bytes. Remote content may change when the same URL is fetched again. It
should not attempt to be a browser, a CSS engine, or a general HTML layout
system.

## Current contract and gap

The structured report contract currently carries fields such as `intro`,
`sections[].body`, `table`, and `highlights`. Some body markup is interpreted
(for example, `**bold**`), but this must not be described as full Markdown
support until image nodes are parsed and tested. The implementation should
therefore make the distinction explicit:

1. Markdown is an accepted source syntax for article content.
2. A normalized content model is the renderer's internal contract.
3. Existing plain strings and structured report fields remain backward
   compatible.

Relevant seams to inspect during implementation are the report schema, the
Markdown/text-run parser, `resolveReportPlan`, the report drawing recorder,
and the PDF/PNG/PPTX adapters. The plan must be independent of a particular
renderer and must not put layout calculations into the Markdown parser.

## Proposed input model

Support Markdown image syntax in fields documented as Markdown content:

```markdown
![Alt text](assets/fleet-map.png "Optional caption")
```

The parser should produce a normalized figure node rather than passing a path
directly to a renderer. A structured escape hatch should also be available for
callers that do not use Markdown, for example:

```json
{
  "type": "image",
  "src": "assets/fleet-map.png",
  "alt": "Map of the fleet",
  "caption": "Fleet distribution, Q2 2026",
  "width": "full",
  "fit": "contain",
  "float": "block"
}
```

The exact public field name may be `content`, `blocks`, or an extension of
`sections[].body`, but there must be one documented normalization path. Do not
silently interpret an arbitrary object in a string field. Preserve the current
string API and define how Markdown and explicit nodes compose in one section.

The normalized image node should be able to carry, at minimum:

  - `src`: a safe local/brand/source reference, an HTTP(S) URL, or an
    explicitly approved data URI;
- `alt`: required for authored content, with a clear rule for decorative
  images;
- `caption`: optional visible text;
- `width` and optional `height`: constrained by the assigned box;
- `fit`: `contain` or `cover`;
- `focal_point`: optional normalized coordinates for `cover`;
- `opacity`: optional, bounded, and configured consistently across surfaces;
- `float`: initially `block`; reserve `left` and `right` for the later phase;
- `clear`: `none` or `both` when float support is enabled;
- `keep_with_caption`: a default-on layout preference.

Names and defaults should be finalized against the existing render schema.
Visual constants, limits, and warnings belong in
`server/templates/render-config.yml`, not in renderer code or test scripts.

## Delivery phases

### Phase 1 — parse and normalize

- Choose and document the Markdown parser and the supported image syntax.
- Parse image nodes, escaped URLs, titles, surrounding emphasis, and adjacent
  text without changing existing plain-text behavior.
- Resolve local image references relative to an explicitly supplied content
  root or the selected brand/source root. Reject traversal and arbitrary
  filesystem access. Treat authored HTTP(S) URLs as normal image sources in v1;
  fetch them during rendering and validate the response as an image.
- Add bounded asset validation: supported formats, byte size, pixel count,
  and decoded dimensions. Report a named, counted warning for an unusable or
  missing image instead of silently drawing a placeholder.
- Normalize PNG alpha, SVG, JPEG, and any deliberately supported formats into
  the common image representation. Transparency must survive PDF and raster
  output, or the input must be rejected with an actionable warning.

### Phase 2 — block figures in the report flow

- Add image/figure blocks to the report plan before drawing begins.
- Give every figure a resolved rectangle, column assignment, fit mode, and
  caption rectangle. The figure must participate in containment, disjointness,
  coverage, and flow assertions just like text, tables, and highlights.
- Keep the caption with the image where possible; move the complete figure to
  the next available column/page when the configured minimum cannot fit.
- Make page and column breaks deterministic. An image must never be placed by
  an independent absolute-positioning path after text flow has advanced.
- Add the same normalized node to the PDF and PNG paths. Define explicitly
  whether PPTX receives a native image or a rasterized equivalent, and keep
  the geometry shared.

### Phase 3 — authored content and diagnostics

- Document Markdown images and the structured figure form in the user-facing
  contract and authoring skill.
- Expose resolved image boxes, source references, fit mode, and warnings in
  `diagnostics: "full"`.
- Add diagnostics for missing alpha support, rejected formats, clipping,
  fallback scaling, and a caption that cannot stay with its figure.
- Keep accessibility metadata in the normalized model even when a target
  format cannot retain it. `alt` is not a substitute for a visible caption.

### Phase 4 — constrained manual float

Float is a future capability, not a reason to make the first image feature a
general-purpose text engine. If implemented, it should support explicit,
deterministic author intent only:

```json
{ "type": "image", "float": "right", "width": "30%", "clear": "both" }
```

The plan for float should define a side rectangle and a reduced text rectangle
for each affected line/segment. It must specify minimum text width, gap,
caption behavior, page/column breaks, `clear`, and what happens when the image
cannot fit. A float may move to the next column/page, but it must never overlap
text or make a later block guess where its ink went. Do not support arbitrary
CSS rules, absolute coordinates, or heuristic “float this because it looks
better” behavior in the first release.

## Safety and compatibility

- Local asset paths must stay within an approved content/brand root.
- Remote HTTP(S) images are in scope by default. SSRF protections are
  explicitly deferred; ordinary fetch, response validation, and failure
  diagnostics remain required. Unrestricted `data:` URLs remain out of scope;
  bounded, explicitly allowed data types may be considered later.
- Enforce limits on bytes, decoded pixels, dimensions, and total images per
  document. Put the limits in render configuration.
- Preserve current reports byte-for-byte where no image node is present, apart
  from intentional baseline updates for the new implementation.
- Keep image handling independent from the brand ZIP source plan. A ZIP may
  supply assets, but content-image resolution must also work with an ordinary
  content directory and with existing brand assets.

## Test plan

Add tests before implementation, then keep them as the contract:

1. Parser tests for Markdown image nodes, captions, escaped paths, adjacent
   prose, malformed syntax, and backward-compatible plain text.
2. Asset tests for SVG, JPEG, opaque PNG, indexed PNG with transparency, and
   truecolor PNG with alpha. Verify that alpha is preserved or rejected with a
   counted warning.
3. Resolution tests for traversal, absolute paths, accepted remote URLs,
   oversized files, invalid remote responses, and oversized decoded images.
4. Plan/recorder tests for containment, disjointness, coverage, caption pairing,
   column/page breaks, and no overlap with headers or footers.
5. Integration fixtures with zero, one, and many images; short and long
   captions; images at the end of a column; and images spanning multiple pages.
6. All four demo brands, including a brand with a raster header and a brand
   with different font metrics.
7. A small PDF/poppler and LibreOffice round-trip layer to verify that the
   recorder agrees with actual output. Keep the large matrix in the cheaper
   plan/recorder layers.
8. Once float exists, fixed left/right fixtures with frozen seeds or literal
   fixtures. Assert the text rectangles and the absence of collisions; do not
   use unseeded randomness.

## Acceptance criteria

- Markdown images render as planned block figures with safe, deterministic
  placement and optional captions.
- Existing structured reports without images remain unchanged.
- Alpha-capable assets do not become opaque white or black rectangles.
- Every image and caption is represented by the report plan and diagnostics.
- Invalid assets produce actionable counted warnings and never corrupt layout.
- Manual left/right float, if implemented, has deterministic rules and is
  covered by layout tests; it is not required for the first block-image
  release.
