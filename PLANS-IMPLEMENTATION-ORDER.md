# ZIP sources and report images — implementation order

## Purpose

This document joins the two detailed plans into one delivery order:

- [BRAND-ZIP-SOURCE-PLAN.md](BRAND-ZIP-SOURCE-PLAN.md)
- [REPORT-CONTENT-IMAGES-PLAN.md](REPORT-CONTENT-IMAGES-PLAN.md)

It records decisions already made, the dependency between the plans, and the
remaining implementation uncertainties. It is a coordination document, not a
replacement for either detailed plan.

## Implementation status — 2026-08-24

M0–M4 and the core M5 report path are implemented and covered by the source,
CommonMark, ZIP, image, CLI, MCP-schema, plan, and public-behavior gates. The
breaking `brand://` contract now treats the first component as a directory and
the remaining component as a path to a YAML/JSON profile (for example,
`brand://flux/primary` resolves `flux/primary.yml`); the former implicit
`profiles/` lookup is gone. Fixtures, starter generation, and authoring docs
were migrated accordingly.

The remaining M5 adapter item is explicit: normalized images currently render
through the report PDF entry point, while no report-specific PNG/PPTX adapter
exists in this repository. Slide output continues to use its existing image
slots (charts/backgrounds), not arbitrary report content nodes. M6 is complete
for the source/image contract and future seams; release metadata remains on
the pre-release line until the missing report adapters are either added or
explicitly removed from the release scope.

An independent read-only review by Sol was used to challenge the order and
risks. Its recommendations are integrated below where they do not conflict
with the decisions already accepted in this thread.

## Executive decision

Implement ZIP source resolution before report content images.

Images depend on the source-root contract: `root://`, `brand://`, and
`source://` cannot be implemented reliably until source materialization,
`brand_path`, traversal protection, and source ownership are settled. A small
shared contract seam should be built first, but the transport and extraction
work remains the first substantive feature.

## Decisions already made

### Release and compatibility

- The new path-based source semantics are a breaking contract.
- There is no compatibility mode for the old `brand_ref` interpretation.
- The release line should move from `0.9.5` to `1.0.0` when this contract ships.
- Existing tests and fixtures must be migrated to the new contract rather than
  preserved through silent reinterpretation.

### Source and path model

- A source is materialized completely; `brand_path` selects the relevant
  brandbook path without recursive guessing.
- `brand://`, `source://`, and `root://` are domain-specific path namespaces,
  not generic URL authorities.
- `root://assets/map.png` resolves under the explicit request `content_root`.
- `brand://assets/map.png` resolves under the selected brand root.
- `source://shared/chart.png` resolves under the complete materialized source.
- Bare relative content paths may be accepted as input convenience, but are
  normalized against the explicit `content_root`; cwd and arbitrary absolute
  filesystem paths are not implicit roots.

### Network, cache, and retry

- Explicit HTTP(S) fetches are allowed by default, including localhost and
  private addresses. The default is intended for trusted/local deployments;
  deployment isolation supplies the network trust boundary.
- Fetches still have resource limits and must not receive ambient credentials.
- ZIP/Git/image fetching should converge on one cache policy with
  source-specific invalidation. A time-based cache is preferred over a
  run-only cache, but shared TTL/cleanup work is not required for this wave
  unless needed by ZIP materialization.
- A future retry tool may reuse successful cached assets and accept replacements
  only for failed image aliases. It reruns layout and returns a normal artifact;
  it is not part of the first implementation wave.

### Content and images

- All textual fields use the same Markdown parsing path: report bodies,
  structured content text, headings, captions, and titles.
- The current limited parser is the first implementation input to a
  parser-independent normalized content model. A later CommonMark parser can
  replace it without changing the renderer contract.
- CommonMark migration is a planned seam, not a reason to expand unrelated
  Markdown features during the image delivery.
- Markdown images default to full width in normal flow.
- Structured content may insert an image node with an explicit percentage
  width; height follows the intrinsic aspect ratio in v1.
- `contain` is the v1 fit mode. Float, `x/y` placement, `cover`, focal points,
  opacity, and CSS-like wrapping are later capabilities.
- `alt` is optional metadata. It is preserved but is not a v1 accessibility
  guarantee because tagged PDF/output semantics are not implemented yet.
- Markdown image `title` is retained and becomes the visible caption when no
  explicit caption is provided; an explicit caption wins.
- A missing or unusable authored image fails the render with an actionable
  diagnostic. An explicitly decorative image may be skipped with a counted
  warning. No silent placeholder is drawn.
- The normalized image model is shared by PDF, PNG, and PPTX-capable output
  adapters; the current absence of a report PNG/PPTX entry point is an adapter
  delivery detail, not a reason to split the content contract.

The review suggested narrowing v1 to the current report PDF entry point. That
recommendation is not adopted: the content contract remains shared across
output surfaces, while each adapter's availability and native-versus-raster
embedding are implementation gates.

## Contract decisions to lock before coding

These are not questions for the implementation to invent. They belong in the
schemas, YAML configuration, and acceptance tests before M1 begins.

### Public fields

Use these names consistently across CLI, MCP, fixtures, and documentation:

- `brand_source` — explicit source descriptor;
- `brand_path` — path selected within that source;
- `brand_ref` — the new path-based brand/profile reference; the old
  brand-id/profile interpretation is removed;
- `content_root` — explicit root for local report content;
- image `src`, `alt`, `title`, `caption`, `width`, and `fit`;
- `sections[].content` — structured content alternative to `body`, with the
  same Markdown parsing path for text values;
- CLI `--content-root`, `--brand-path`, and the explicit source flags that map
  to `brand_source`.

The exact `brand_source` object is a discriminated union, not a bag of
mutually ambiguous URL fields: its discriminator selects directory, ZIP, or
Git transport, and only the fields valid for that transport are accepted.

### Initial safety and resource limits

All values live in `server/templates/render-config.yml` and are tested from
configuration rather than duplicated in code:

- ZIP: 2,000 entries maximum;
- ZIP: 50 MiB maximum per extracted file;
- ZIP: 200 MiB maximum total extracted size;
- ZIP: 100:1 maximum compression ratio;
- ZIP: nested archive extraction disabled (`0`);
- images: 20 MiB maximum fetched/decoded asset size;
- images: 40 megapixels maximum decoded area;
- images: 10,000 pixels maximum width or height;
- images: 32 images maximum per document;
- remote fetch: 15-second timeout and at most 3 redirects.

These are initial product safety defaults, not values to be invented during
implementation. A measured fixture may motivate a later plan change.

### Output surface matrix

The normalized image contract is shared. PDF, PNG, and PPTX-capable output
surfaces are target surfaces for the image feature. If a report-specific
entry point is missing for one of them, adding that adapter is implementation
scope; it is not an unresolved product question. Each adapter must document
whether it embeds a native image or a rasterized equivalent.

## Recommended delivery order

### M0 — Freeze the cross-plan contract

Write and test the shared seams before implementing either feature:

- source descriptor and materialized-root result;
- path namespace resolver for `root://`, `brand://`, and `source://`;
- request-level `content_root` in CLI and MCP schemas;
- normalized report content AST and image node shape;
- breaking `1.0.0` contract and migrated examples.

Exit criterion: schemas and representative fixtures state exactly which root
each reference uses, with no dependency on the current legacy interpretation.

### M1 — Build the domain source resolver

Implement the shared `SourceContext`/path seam first, without committing to a
transport-specific implementation:

- source descriptor and materialized-root result;
- `root://`, `brand://`, and `source://` resolution;
- explicit `content_root` handling;
- traversal, absolute-path, and root-escape tests.

Exit criterion: every namespace has one root and there is no fallback search
across namespaces.

### M2 — Materialize and validate ZIP sources

Implement the ZIP plan's first two phases:

- local ZIP and ZIP URL detection/validation;
- existing Git source through the shared resolver;
- complete source-root materialization;
- safe extraction, symlink/traversal/nested-archive rejection, and limits from
  render configuration;
- explicit `brand_path` resolution and profile loading;
- prepared-asset manifest detection and fallback diagnostics.

Exit criterion: equivalent directory, ZIP, ZIP URL, and Git fixtures resolve to
the same selected brand root and render the existing report/deck contracts.

### M3 — Add the minimum source cache needed by ZIP

Implement content-addressed ZIP/Git materialization and concurrent-reader
safety as required by the ZIP plan. Reuse existing asset/font cache behavior;
do not redesign all asset TTL and cleanup policy here.

Exit criterion: identical ZIP bytes share a source entry, changed bytes do not,
and cleanup cannot remove an entry still used by an active reader.

### M4 — Introduce the content parser/normalization seam

Before drawing images, route existing text through a normalized content model
using the current supported Markdown behavior. Add parser tests for all text
fields and ensure reports without images retain their current output baseline.

Selected implementation: `remark-parse`/mdast through `unified`, with a small
adapter into the renderer-owned model. The adapter is parser-independent at
the renderer seam, and its CommonMark mapping/diagnostics are covered by the
normalizer fixture. The research record is
[docs/research/commonmark-engine.md](docs/research/commonmark-engine.md).

Exit criterion: the renderer consumes normalized nodes rather than deciding
Markdown semantics and layout at the same time.

### M5 — Add image resolution and block/flow layout

Implement image nodes against the completed source resolver:

- `root://`, `brand://`, `source://`, and HTTP(S) resolution;
- bounded fetch/decode/format validation;
- Markdown image nodes with full-width flow defaults;
- structured percentage sizing with intrinsic aspect ratio;
- captions, title fallback, and keep-with-caption behavior;
- shared report plan geometry, containment, disjointness, and flow assertions;
- PDF/PNG/PPTX-capable adapters and full diagnostics.

Exit criterion: directory, ZIP, brand, source, root, and remote image fixtures
produce deterministic, non-overlapping output or the specified actionable
failure.

### M6 — Documentation, skill, and release gates

Update README, the authoring/web skill, setup responses, schema snapshots, and
examples with the final source and image contract. Record the future seams for:

- CommonMark parser replacement;
- shared TTL/cleanup policy for remote assets;
- image retry by failed alias and `run_id`;
- constrained float/anchored placement;
- tagged accessibility-aware output.

## Resolved parser choice

The CommonMark spike selected `remark-parse`/mdast through `unified`. It passed
the repository's Node 18/esbuild build, the normalized Markdown fixture, and
the public model remains parser-independent. `commonmark.js` stays a possible
future fallback only if dependency policy changes; it is no longer an open
implementation decision for this wave.

## Technical risks to prove, not decisions to defer

- The current report plan describes broad page frames rather than every final
  content box. Image work must add a real measure/layout stage before calling
  `addImage`; adding a drawing call alone is insufficient.
- ZIP extraction must prove that configured limits and symlink metadata can be
  checked safely with the bundled archive implementation before accepting large
  or hostile archives.
- Shared cache TTL/cleanup and retained retry runs remain later work, but the
  source cache needed for ZIP must still have atomic publish and concurrent
  reader safety.
- Tagged PDF/PPTX accessibility is not promised merely because `alt` is kept
  in the normalized model.
- Version metadata must be updated atomically: package, runtime, lockfile,
  manifests, bundles, and fixtures must agree on `1.0.0`.

## Explicit non-goals for the first wave

- No float or arbitrary anchored image placement.
- No browser/CSS/HTML layout engine.
- No silent placeholder for a required image.
- No separate ad hoc Markdown parser for images.
- No indefinite remote URL cache or retry tool implementation unless it is
  explicitly pulled into scope.
