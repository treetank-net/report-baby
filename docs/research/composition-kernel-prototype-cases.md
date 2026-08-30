# Composition-kernel prototype: test corpus and observations

Date: 2026-08-25

This document describes the disposable prototype in
`server/scripts/prototype-composition-kernel.mjs`. It is a planning experiment,
not a production renderer and does not load brand files, project fonts or
render configuration.

## Public seam under test

```text
compose(document, template, policy) -> CompositionOutcome
```

The prototype observes the seam through:

- final status;
- pages and fragmentainers;
- line placements and source word ranges;
- placeholder image placements;
- keep and flow decisions;
- evaluator violations;
- rejected cases and their diagnostic codes.

The PDF/PNG is a secondary check. A visually plausible page is not enough if
source text is duplicated, lost, placed in the wrong reading order or broken
against a required keep.

## What already exists in the production renderer

The prototype is not starting from zero. The repository already has several
pieces of the model:

- `templates/pages/editorial-two-column/template.yml` defines page geometry,
  two column widths, gutter, reserved header/footer bands, flow alignment and
  hyphenation;
- `src/page-geometry.ts` turns those columns and reserved bands into usable
  flow segments;
- `Cursor` in `src/report-renderer.ts` advances through segments and pages and
  has procedural `keepTogether` behaviour;
- `src/text-runs.ts` implements line breaking, Polish hyphenation,
  justification and flow-level quality limits;
- the renderer has widow/orphan thresholds and a descriptive
  `src/report-plan.ts` seam for page boxes and coverage validation.

What does not exist yet is the important part for editorial composition:
named independent streams such as article/sidebar, per-page template
variants, backtracking over alternative placements, or image exclusion
geometry. Production report images are currently rendered as block figures:
text is flushed, the image and caption are drawn, and later text continues
below; no text wraps beside an image or follows an ellipse/polygon boundary.

## Reference model for images

An inline image is treated as an atomic inline box: it participates in the
line box and cannot be split. This follows the CSS inline layout model, where
text and inline-level boxes are laid out into line boxes, and replaced inline
boxes cannot split across lines. See [CSS Inline Layout Level 3](https://www.w3.org/TR/css-inline-3/)
and [CSS Display Level 4](https://www.w3.org/TR/css-display-4/).

A floating editorial image is represented separately from its paint box. The
paint box has intrinsic width and height; the flow has a wrapping/exclusion
area. A rectangle, ellipse or polygon changes the available inline interval
only on lines intersecting that area. This follows the distinction between
exclusion areas and wrapping areas in [CSS Exclusions](https://www.w3.org/TR/css3-exclusions/)
and the `circle()`, `ellipse()` and `polygon()` model in [CSS Shapes](https://www.w3.org/TR/css-shapes/).

An overlay is paint-only and must not change the composition plan.

## Global invariants

Every accepted case must satisfy:

1. Every source word range appears exactly once.
2. Logical reading order is preserved.
3. Every line belongs to an existing fragmentainer.
4. No line exceeds its available inline interval.
5. No line intersects an active exclusion.
6. Required keeps are satisfied.
7. List markers never appear without the first line of their item.
8. No implicit shrink, omit, overflow or extra page occurs.
9. Every adaptation has a decision code.
10. The same input produces the same canonical plan.
11. The planner terminates within its page and revision limits.
12. `accepted` has no residual content.

Every rejected case must provide:

- a stable error code;
- source node and constraint identifiers;
- local versus global capacity classification;
- attempted revisions;
- residual content or an unsatisfied core;
- no partial artifact presented as a successful PDF.

## P0: minimum proof of the model

### Text and fragmentation

| ID | Fixture | Expected result |
|---|---|---|
| P0-T01 | Short paragraph, much less than one track | One page; no phantom continuation track/page |
| P0-T02 | Text exactly fills the wide track | No extra blank line or page |
| P0-T03 | T02 plus one line | One legal continuation to the next track |
| P0-T04 | Text exactly fills all tracks | Last source range ends at the last track |
| P0-T05 | T04 plus one line | One new page with the correct continuation |
| P0-T06 | Four to five pages of text | No duplicate or missing ranges at any boundary |
| P0-T07 | Empty body with only page chrome | No empty continuation pages |

### Keep semantics

| ID | Fixture | Expected result |
|---|---|---|
| P0-K01 | Heading plus three lines fit exactly | All remain in one fragmentainer |
| P0-K02 | Only heading plus two lines fit | Whole keep cluster moves and reflows |
| P0-K03 | Cluster does not fit in the short track but fits on next page | Heading does not remain orphaned |
| P0-K04 | List marker fits but first line does not | Marker and item start move together |
| P0-K05 | Marker plus first line fit exactly | No unnecessary push |
| P0-K06 | Intro plus first legal paragraph fragment fit | They remain together; later lines may continue |
| P0-K07 | Intro fits but required paragraph prefix does not | Intro and prefix move together |
| P0-K08 | Required group exceeds every fragmentainer | Deterministic `KEEP_REQUIRED_OVERSIZE` rejection |
| P0-K09 | Preferred group exceeds every fragmentainer | Only that preferred keep may relax; nested required keeps survive |

### Span and tracks

| ID | Fixture | Expected result |
|---|---|---|
| P0-S01 | Intro spans two article tracks | Body begins below a new track row, never beside intro |
| P0-S02 | Intro is near the page bottom | Span moves according to its keep policy |
| P0-C01 | Wide track followed by narrow track | Text is rewrapped for the narrow width |
| P0-C02 | Second track has a shorter block size | It ends at its own block-end |
| P0-C03 | Atomic block does not fit in short track | It moves to the next fragmentainer or rejects |
| P0-C04 | Very little text with sequential fill | Only required tracks are used |

### Images

| ID | Fixture | Expected result |
|---|---|---|
| P0-I01 | Inline placeholder in a sentence | Atomic inline box with baseline alignment |
| P0-I02 | Inline placeholder does not fit at line end | Image and following text move as an atomic unit |
| P0-F01 | Rectangular float before first paragraph | Intersecting lines use the reduced interval |
| P0-E01 | Rectangular exclusion in the middle of flow | Only intersecting lines change measure |
| P0-O01 | Background overlay | Flow plan is identical to the no-image plan |
| P0-O02 | Foreground overlay | Z-order changes, flow does not |

### No-space behaviour

| ID | Fixture | Expected result |
|---|---|---|
| P0-P01 | Float does not fit locally but fits next track | One `FLOAT_DEFERRED` decision and downstream reflow |
| P0-P02 | Atomic figure fits only on page two | Whole figure moves; no silent scaling |
| P0-N01 | Figure is larger than every fragmentainer | `ATOMIC_OVERSIZE` rejection |
| P0-N02 | Required keep is larger than every fragmentainer | `KEEP_GLOBAL_OVERSIZE` rejection |
| P0-N03 | Page count is fixed at one but content remains | `PAGE_LIMIT_EXCEEDED` rejection |
| P0-N04 | Exclusion removes every inline interval | `NO_INLINE_INTERVAL` rejection |
| P0-N05 | Header/footer minima leave no body | Compile/preflight `REGION_MINIMA_CONFLICT` |
| P0-D01 | Same accepted fixture repeated in fresh processes | Identical plan and decision trace |

## P1: editorial interactions

### Image position

- inline image before the first word;
- inline image after the last word;
- three inline images sharing a line;
- float before its anchored paragraph;
- float anchored in the middle of a paragraph;
- float anchored after a paragraph;
- overlay behind and in front of text;
- the same asset used once as inline, once as float and once as overlay.

Each case checks that the asset's role, not its file type, controls flow.

### Shapes

- rectangle with constant reduced width;
- ellipse with narrowing and widening intervals;
- diagonal polygon with monotonic interval change;
- two disjoint exclusions;
- overlapping exclusions without double subtraction;
- exclusion tangent to a line box;
- exclusion clipped by a track;
- one-line vertical displacement of the same exclusion.

### Tracks and pagination

- three tracks with `3fr/2fr/1fr` widths;
- different block sizes per track;
- physical track order different from flow order;
- sequential versus balanced fill;
- first-page master different from continuation master;
- growing running header on page two;
- span in the middle of a flow;
- span close to the page bottom;
- span larger than a page.

### Interacting constraints

- heading plus three lines colliding with a float;
- intro span plus heading keep;
- preferred group larger than a fragmentainer;
- required keep conflicting with fixed placement;
- list marker plus inline image in the first line;
- nested list near a track boundary;
- image and caption required to remain together;
- a short track containing only a heading candidate.

### Degradation policy

- float may defer twice, then must use the next policy;
- figure may shrink to 80%, with full recomposition;
- shrink below brand/template floor produces `needs-decision` or `rejected`;
- optional decoration can fail with a counted warning and no flow change;
- authored content image failure is actionable, not silently replaced;
- low text volume must not create artificial stretch outside policy;
- near-empty final page must be handled explicitly, not by global spacing mutation.

## P2: hardening

- sweep text length around every break threshold;
- sweep fragmentainer size around every keep threshold;
- generate acyclic networks of 1–8 fragmentainers;
- generate random text lengths and keep prefixes;
- generate convex and concave polygon exclusions;
- run 100-page continuous documents;
- run 100 floats with bounded deferrals;
- run deeply nested keep groups;
- test epsilon-sized geometry changes;
- test Latin, Arabic/Hebrew with numbers, CJK, combining marks and emoji;
- test missing, corrupt and zero-size image metadata;
- compare fresh-process canonical plans;
- compare PDF and PNG geometry;
- verify explicit downgrade when PPTX cannot reproduce the plan.

## Prototype fixtures currently implemented

`prototype-composition-kernel.mjs` currently renders these deterministic cases:

- `baseline` — asymmetric two-track editorial page with a floating ellipse;
- `short` — intentionally sparse content, no phantom page;
- `long` — multiple sections, three placeholder shapes and continuation pages;
- `floatBefore` — early rectangular placeholder;
- `floatMiddle` — ellipse anchored to a middle section and keep interaction;
- `floatLate` — diagonal placeholder near a later section;
- `crossColumnEllipse` — one ellipse crossing the gutter and overlapping both
  article tracks; the left track wraps away from its right edge while the
  second track shifts text to the right of its left edge;
- `crossColumnContinuation` — the same cross-column ellipse is explicitly
  page-only on page one; page two continues the text without repainting or
  reactivating the image;
- `largeBlockScaled` — a block image too tall for the current local capacity,
  moved and scaled to a fragmentainer, with text continuing on later pages;
- `largeFloatPromoted` — a float that leaves less than the required text
  measure, promoted to a block image instead of producing unreadably narrow
  lines;
- `largeImageRejected` — an unsplittable image larger than every allowed
  fragmentainer, rejected without a PDF artifact;
- `justifiedColumns` — two-page justified flow with column continuation and
  marker state preserved across the boundary;
- `keepPush` — longer flow with heading keep constraints;
- `markerPush` — list-marker invariant;
- `unsatisfiable` — required group larger than every fragmentainer;
- `longToken` — explicit overfull rejection for an unbreakable token.

The ellipse fixture also checks the geometric evaluator directly. The usable
inline interval is calculated from the ellipse equation at the line's vertical
position, rather than from a rectangular image width approximation. Accepted
plans are rejected if the rendered line interval intersects the ellipse, even
when the line still fits inside the parent column.

The cross-column fixture additionally keeps the exclusion active after the
anchored paragraph continues into another block and another track. The image
has one paint box and multiple affected track IDs; it is not duplicated or
silently clipped at the gutter.

The prototype uses the `lorem-ipsum` v3 library with a seeded PRNG, so the
fixtures now contain sentence-shaped placeholder text while remaining
deterministic. It still uses built-in Helvetica metrics and generated
placeholder rectangles/diagonal strokes. It does not claim support for real
font shaping, alpha-mask extraction, arbitrary polygons, vertical writing or
production-quality typography.

## Current acceptance result

The first run produced:

- accepted or accepted-with-decisions for all feasible fixtures;
- one-page output for sparse content;
- multi-page continuation for long content;
- deterministic handling of an image that is scaled, promoted from float to
  block, or rejected as unsplittable;
- justified lines that fill their available interval while the final line of a
  paragraph remains ragged;
- list markers emitted only once even when the list item continues in another
  track;
- no evaluator violations in accepted fixtures;
- explicit rejection for the required oversize group and an impossible image;
- explicit rejection for the unbreakable token;
- PDF and PNG artifacts for accepted fixtures; rejected fixtures emit only
  `plan.json` and `outcome.json`.

One deliberately useful finding is that a huge block image can still leave a
heading behind if the fixture does not declare a heading/image keep. That is
not something the image algorithm should guess: the next prototype must make
the relationship explicit and test `heading + image + first paragraph prefix`
as one keep cluster.

This is evidence that the planner/evaluator state model is workable. It is not
yet evidence that the model is ready for the real renderer. The next required
step is to promote the public seam and plan-level invariants into an isolated
test harness, then add exact line-unit fixtures and genuine polygon/alpha
exclusion geometry.
