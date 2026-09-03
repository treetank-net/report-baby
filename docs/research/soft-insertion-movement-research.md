# Soft insertion movement and resizing research

## Scope

This report investigates which editorial elements should be movable, resizable,
or fixed when Report Baby moves from template-owned hard insertions toward
soft insertions. It combines:

- the current Report Baby composition model;
- semantic and accessibility constraints from primary web standards;
- practical constraints for paginated, multi-column editorial layouts; and
- implementation consequences for the planner/evaluator loop.

The report does not change the composition code. It is a research input for
the next implementation phase.

The central conclusion is that movement and resizing must be independent
permissions. An element may be allowed to move but not resize, or resize in
one dimension while remaining fixed in another. The permitted operation must
also preserve the element's semantic attachment and the document's reading
order.

## Vocabulary used in this report

These are descriptions of behavior, not proposed new domain objects.

- **Move**: change an element's position while keeping its content and
  rendering dimensions unchanged.
- **Resize**: change the element's occupied width or height and measure its
  content again.
- **Compress**: use less space without losing content, usually by reducing
  empty padding or changing a flexible dimension. Compressing is not the same
  as non-uniformly distorting an image or shrinking text below its readability
  limit.
- **Fixed**: the planner may not change the relevant property, except for
  ordinary derived geometry such as a caption becoming two lines after a
  permitted width change.
- **Attachment**: the semantic relationship that must remain true when an
  element moves, such as a caption belonging to an image or a quotation
  belonging to the paragraph/section from which it was extracted.
- **Occupied box**: the rectangle reserved for collision and text-flow
  purposes.
- **Painted box**: the actual visible content inside the occupied box. A
  glyph, transparent image margin, or border can make these different.

## Verified facts from the current repository

### The model already distinguishes content, flow, collision, and decoration

`CompositionBlock` currently supports headings, paragraphs, list items,
images, tables, charts, and metrics. Blocks also carry a `role`, optional
atomicity, and optional content-specific data. This gives the planner enough
information to make different decisions for a heading, a table, a quote, or a
metric instead of treating every insertion as a generic rectangle.

Source: [`server/src/composition/model.ts`](../../server/src/composition/model.ts)

`CompositionImage` already records `width`, `fit`, optional wrapping,
caption, and `keepWithCaption`. `CompositionAsset` separately records the
asset source, alternative text, caption, width, fit, and whether the caption
must stay with the image. These fields are evidence that image movement and
image sizing are already separate concerns in the input model, even though
the general movement policy is not yet expressed there.

Source: [`server/src/composition/model.ts`](../../server/src/composition/model.ts)

`CompositionGraphic` represents a page graphic used as a flow obstacle. It
has a shape, optional polygon points, a page, a slot, and a wrapping mode. The
planner turns it into a `CompositionGraphicPlacement` with a concrete box.
The shape is used for text-flow collision; the asset itself remains a
rectangle. This distinction matters: a transparent image can look smaller
than the rectangle that text must avoid.

Source: [`server/src/composition/model.ts`](../../server/src/composition/model.ts),
[`server/src/composition/graphic-geometry.ts`](../../server/src/composition/graphic-geometry.ts)

`CompositionGlyphDefinition` targets a block or graphic and can anchor to the
target box, text start, or text end. It can use first-line, last-line, or box
geometry and has offsets, clamping, and opacity. Glyphs should therefore stay
non-colliding decorations unless a particular definition explicitly says that
they contribute to the occupied obstacle.

Source: [`server/src/composition/model.ts`](../../server/src/composition/model.ts)

### The current movement policy is intentionally narrow

`MovableInsertionBounds` currently provides:

- a rectangular movement area;
- one movement axis (`x` or `y`);
- an optional preferred coordinate;
- a finite coarse candidate count; and
- optional local refinement rounds and refinement candidate count.

The current policy does not permit changing width, height, aspect ratio,
padding, text size, or caption attachment. The planner keeps the measured
insertion width and height and generates positions inside the frame. The
frame describes where the existing rectangle may move; it does not describe
how that rectangle may resize.

Sources: [`server/src/composition/text-planner.ts`](../../server/src/composition/text-planner.ts),
[`docs/release-1.0/08-candidate-search-depth.md`](../release-1.0/08-candidate-search-depth.md)

### The planner measures some content before it reserves collision space

Insertion proposals are seeded before ordinary flow text is laid out. A
content-fitting insertion can be measured from its text metrics and its
padding. Atomic blocks use renderer-neutral `measureBlock` support. The
resulting insertion or graphic geometry is reserved before ordinary flow
placement, so text can wrap around the chosen obstacle.

The existing model already supports the important dependency:

```text
element size -> occupied obstacle -> available text area -> line breaks
```

If width or height becomes movable, the planner must repeat this chain for
each candidate. Reusing the old line layout after changing a box would be
incorrect.

Sources: [`server/src/composition/text-planner.ts`](../../server/src/composition/text-planner.ts),
[`server/src/composition/engine.ts`](../../server/src/composition/engine.ts)

### Text continuity and legal placement are already hard constraints

The evaluator rejects missing, duplicated, overlapping, out-of-slot, or
out-of-order content. It also rejects residual content and invalid flow
barrier candidates. A high quality score cannot rescue such a plan.

The evaluator treats column balance, paragraph fragmentation, orphan lines,
heading-following, and insertion spacing as quality preferences rather than
hard legality rules. This is the right distinction for movement: a candidate
may be legal but visually worse, while no candidate may be allowed to lose
content or change the authored reading order.

Source: [`docs/composition/evaluator.md`](../composition/evaluator.md),
[`server/src/composition/evaluator.ts`](../../server/src/composition/evaluator.ts)

### Tables already have row-level continuity information

`CompositionTablePlacement` records `startRow`, `endRow`, and whether the
header repeats. The evaluator checks row-range validity, continuous coverage,
and full placement. This means a table can be moved as a whole and can be
fragmented only at meaningful row boundaries; it must not be treated like a
paragraph that can break at an arbitrary word.

Source: [`server/src/composition/engine.ts`](../../server/src/composition/engine.ts)

## Verified facts from primary standards

### Reading order is a semantic constraint

WCAG 2.2 Success Criterion 1.3.2 requires that when presentation order affects
meaning, the correct reading sequence can be programmatically determined. A
layout engine may therefore move an element visually only if its resulting
reading relationship remains recoverable and correct.

Source: [WCAG 2.2, 1.3.2 Meaningful Sequence](https://www.w3.org/TR/WCAG22/#meaningful-sequence)

This does not require every visual position to match source order on a page.
It does require that moving a quote, image, chart, or KPI must not silently
make it appear to belong to a different section or make the intended reading
sequence ambiguous.

### Headings organize sections and should not be separated casually

WCAG identifies section headings as an organizational mechanism. The HTML
standard also models headings as section structure rather than decoration.
The Report Baby equivalent is that a heading should remain attached to the
content it introduces, subject to the existing keep-with-next policy.

Sources: [WCAG 2.2, 2.4.10 Section Headings](https://www.w3.org/TR/WCAG22/#section-headings),
[HTML Standard, headings and sections](https://html.spec.whatwg.org/multipage/sections.html#headings-and-sections)

### A block quotation is source content, not merely a colored paragraph

The HTML Standard defines `blockquote` as a section quoted from another
source. It also states that attribution belongs outside the quotation itself,
and demonstrates grouping a quotation and its attribution in a `figure`.

For Report Baby, this implies:

- the quotation text must remain intact and attributable;
- its visual position may change within a permitted range;
- the attribution must remain attached to the quote, if present; and
- the quote must not move across a semantic section boundary merely because a
  nearby position scores better.

Source: [HTML Standard, `blockquote`](https://html.spec.whatwg.org/multipage/grouping-content.html#the-blockquote-element)

### Images have semantic differences that affect movement rules

The HTML Standard says that an image with non-empty alternative text is a key
part of the content and that the alternative text is its textual equivalent.
An image with an empty alternative text is decorative or redundant. W3C WAI
guidance similarly says that decorative images should use an empty alternative
text and should not add information for assistive technologies.

Therefore the planner must not infer “safe to crop” or “safe to move anywhere”
from the fact that an image is visually decorative. Decorative status changes
its semantic risk, not its collision or brand-layout requirements.

Sources: [HTML Standard, `img` and `alt`](https://html.spec.whatwg.org/multipage/embedded-content.html#the-img-element),
[W3C WAI, Decorative Images](https://www.w3.org/WAI/tutorials/images/decorative/),
[WCAG 2.2, 1.1.1 Non-text Content](https://www.w3.org/TR/WCAG22/#non-text-content)

### Intrinsic size, minimum size, and maximum size are different concepts

CSS Sizing Level 3 distinguishes intrinsic sizes derived from content or a
replaced element's natural dimensions from sizes imposed by the surrounding
layout. It defines minimum and maximum size constraints independently from a
preferred size.

The relevant lesson for Report Baby is not to copy CSS literally, but to keep
these questions separate:

1. What size does the content naturally need?
2. What is the smallest legal size?
3. What is the preferred size for this editorial design?
4. What is the largest size the surrounding page permits?

Source: [CSS Box Sizing Module Level 3](https://www.w3.org/TR/css-sizing-3/)

### Preserving an image's aspect ratio is different from filling or cropping

CSS Images Level 3 defines `object-fit: contain` as fitting replaced content
inside a box while maintaining its natural aspect ratio. `cover` fills the
box while potentially clipping content, and `fill` can distort the natural
ratio.

For editorial photos and informative images, non-uniform stretching should
not be an implicit optimization. Cropping may be a valid authored choice, but
it must be explicit because it can remove the visual evidence the image is
meant to convey. The current Report Baby image contract uses `fit: contain`,
which is consistent with the conservative rule.

Source: [CSS Images Module Level 3, `object-fit`](https://www.w3.org/TR/css-images-3/#the-object-fit-property)

### Fragmentation has both hard and soft controls

CSS Fragmentation Level 3 defines `break-inside: avoid` as an instruction to
avoid breaking within a box. It defines `orphans` as the minimum number of
line boxes left before a break and `widows` as the minimum number left after a
break. It also describes breaks as allowed, forced, or discouraged depending
on these constraints.

This supports the current Report Baby separation:

- losing content, breaking a required atomic object, or violating an explicit
  keep relationship is hard-invalid;
- a legal but unattractive one-line fragment or large gap is unfavorable and
  should lower the score.

Source: [CSS Fragmentation Module Level 3](https://www.w3.org/TR/css-break-3/)

### Line breaking depends on language and available width

CSS Text Level 3 defines line breaks as either forced breaks or soft-wrap
breaks. Soft-wrap opportunities depend on language, writing system, word
boundaries, punctuation, hyphenation, and available measure. It also permits
special overflow behavior for otherwise unbreakable strings only when the
corresponding policy allows it.

Consequences for resizing:

- changing a text box width is not a cosmetic change; it changes line breaks;
- the longest unbreakable word or token is a real lower bound unless an
  explicit overflow policy allows breaking it;
- a candidate must be remeasured and reflowed after width changes;
- shrinking text to make a box fit should be a separate typography policy,
  not a hidden side effect of insertion movement.

Source: [CSS Text Module Level 3, line breaking and overflow wrapping](https://www.w3.org/TR/css-text-3/#line-breaking)

### Column balancing is subordinate to content constraints

CSS Multi-column Layout Level 1 describes balancing as minimizing variation in
column height while honoring forced breaks, widows, orphans, and other
properties affecting column heights. It also distinguishes sequential filling
from balanced filling.

This supports using column balance as a quality preference after legality and
fragmentation constraints, rather than allowing balance to override a heading
keep, a table row boundary, or a required insertion attachment.

Source: [CSS Multi-column Layout Level 1, column balancing](https://www.w3.org/TR/css-multicol-1/#filling-columns)

## Conclusions: what should move, resize, or remain fixed

The table below is the recommended default for editorial composition. “Move”
means movement is allowed only within an explicit frame and attachment. “Size”
means the planner may generate size candidates only if it can measure the
result and rerun text flow.

| Element | Position | Width/height | Default reason |
|---|---|---|---|
| Ordinary paragraph/body flow | Do not move independently | Do not resize independently | It is the material being flowed. The planner should move the surrounding boundary or choose a different break, not detach arbitrary paragraphs from their sequence. |
| Heading | Move with its section/keep cluster | Keep typography fixed; height follows wrapping | A heading can move to the next legal location, but must not be detached from its required following lines. |
| List item | Move as a list item | Usually fixed typography; height follows wrapping | The current model already protects list-item grouping. Breaking inside an item should require an explicit policy. |
| Quote text block | Move locally within its legal frame | Height fits measured text; width fixed initially | Its wording and attribution are semantic content. Local movement can improve spacing and paragraph breaks, but changing width changes the quote's line shape and obstacle size. |
| Quote padding and gap | Adjust only within configured limits | Small bounded range | Padding is aesthetic and can be optimized, but it must not collapse the visual identity of the quote or make glyphs collide with text. |
| Quote glyphs | Move with the quote/text anchor | Fixed glyph design and measured painted bounds | Glyphs are decoration attached to a target. Their position may use text-start/text-end or box anchors; they should not silently become flow obstacles. |
| Informative photograph/image | Move within an authored frame | Preserve aspect ratio; bounded scale range | The image can be positioned flexibly, but arbitrary cropping or distortion can remove or change information. Caption remains attached. |
| Decorative image | Move within a frame | May have more resizing freedom, but preserve template/brand constraints | Semantic risk is lower, but the visual system can still require a minimum size, alignment, or aspect ratio. |
| Image caption | Move only with its image | Width may follow image; height reflows | A caption explains or identifies the image. It is not an independent insertion. |
| Chart | Move within a frame | Resize proportionally within legibility limits | Position is often flexible; distortion, cropping, or excessive shrinking can change the visual meaning of axes, labels, and values. |
| KPI/metric card | Move within a frame or grid | Container may resize within grid limits; internal typography should not be squashed | The card is a compact information unit. Its label, value, delta, and note must remain legible and associated. |
| Table | Move as a whole or as row-aligned fragments | Width may adapt through column measurement; rows are not squashed | Tables can fragment at rows and repeat headers, but cells and row relationships must remain understandable. |
| Table caption | Move with table | Height reflows; width follows table | It names or describes the table and should not be separated from it. |
| Header/footer/page number | Fixed by page template | Fixed except derived page-number text width | These are page chrome, not editorial candidates. Their geometry defines the usable page. |
| Decorative rule/background/glyph | Move with its attachment or template region | Usually fixed | It has no independent reading position. Movement without an attachment creates unexplained geometry. |

### The most important practical rule

Do not expose one boolean called `resizable`. The useful permissions are at
least:

- can move horizontally;
- can move vertically;
- can change width;
- can change height;
- must preserve aspect ratio;
- can crop;
- can reduce padding;
- can change text measure;
- can change typography scale; and
- can cross a semantic attachment boundary.

The last permission should be false by default and probably unavailable for
ordinary editorial content. A layout author should be able to loosen visual
constraints deliberately, but the planner must never infer that permission
from available empty space.

## Recommended rules by content family

### Text-bearing insertions: quote, KPI, chart labels, table captions

Text-bearing insertions should be measured before they become obstacles. The
minimum legal width is determined by the content and the line-breaking policy,
not only by the template slot. A useful lower-bound sequence is:

```text
minimum outer width
  >= left padding + minimum content measure + right padding
minimum content measure
  >= longest unbreakable token width
  + any required inline decoration reserve
```

For a quote, the first implementation should allow:

- vertical movement within the flow barrier candidate range;
- horizontal movement only when the template explicitly permits it;
- height to grow or shrink to measured text plus configured padding;
- a small bounded adjustment of top/bottom padding if the style allows it;
- no non-uniform text compression;
- no movement across the quote's preceding/following source boundary; and
- no independent movement of attribution or quotation glyphs.

For a KPI or chart block, use the same candidate mechanism but keep the block
atomic by default. A smaller candidate box should be rejected if the block
measurement cannot fit, rather than allowing the renderer to clip it. A
future explicit `fit` policy may permit proportional scaling, but that should
return the scale and resulting measured box as part of the candidate.

For a table, width changes require a new table measurement. Height changes
must happen through row-aware fragmentation, not by squeezing row height.

### Images and graphics

Images have two different geometries:

1. the visual image rectangle, possibly containing transparent pixels; and
2. the flow obstacle, which determines where text may be placed.

The default should keep these geometries aligned conservatively. If an image
is resized, the planner must update both its painted placement and its
collision intervals. If the image has a caption, the caption must be measured
again and the complete image-plus-caption unit must be considered for
placement.

Recommended defaults:

- photo: move in a bounded frame, proportional resize only, no implicit crop;
- decorative background: move more freely, but remain inside template bounds;
- chart image: proportional resize only, no crop, minimum label size;
- generated chart with vector or structured measurement: allow size candidates
  only when the chart renderer can measure labels and plot area at every size;
- image with `wrap: left` or `wrap: right`: update line intervals after every
  size or position candidate;
- image with `wrap: none`: movement can affect neighboring block spacing but
  does not create a side text interval.

The current `fit: contain` contract should remain the default for informative
assets. Cropping should be a content-level author choice, not an evaluator
optimization.

### Headings and ordinary flow

Headings should not be treated as freely movable boxes. Their legal movement
is a consequence of moving the section's next start through the flow. The
existing heading keep and minimum-fragment rules are the correct foundation:

- keep the heading with its required following lines;
- permit the complete cluster to move to the next slot/page when it cannot fit;
- do not add a hidden top margin when the heading is the first content in a
  resumed or barrier-created segment;
- do not shrink heading typography merely to keep it in the current slot
  unless an explicit fit policy requests that behavior; and
- score the resulting blank space separately from legality.

Paragraphs should remain in source order and should not be individually
dragged to repair a local gap. If an insertion moves, the body flow is
recomputed around its new obstacle. That is the source of the useful “butterfly
effect” the candidate/evaluator loop is meant to observe.

## Proposed constraint shape for the existing policy seam

This is a design recommendation, not an implementation request in this
research file. It describes the information the existing
`MovableInsertionBounds` policy will eventually need without introducing a
second layout system.

Each movable insertion should be able to state, independently:

```text
position:
  preferred page / preferred x / preferred y
  allowed page range or required page relation
  allowed x movement
  allowed y movement
  attachment to flow, block, section, or template region

size:
  preferred width / preferred height
  minimum width / minimum height
  maximum width / maximum height
  width mode: fixed | fit-content | bounded
  height mode: fixed | fit-content | bounded
  preserve aspect ratio: yes/no
  crop: forbidden unless explicitly enabled

content:
  padding minimum / preferred / maximum
  typography change: forbidden unless explicitly enabled
  minimum readable size
  minimum content measure
  keep-with-caption / keep-with-attribution / keep-rows

collision:
  contributes an obstacle: yes/no
  collision shape
  minimum separation from flow text
  minimum separation from other attached decorations
```

The important implementation point is that position, size, and content rules
must be evaluated together. A width candidate is not valid just because its
rectangle fits the frame; it is valid only if:

1. the block can be measured at that width;
2. its content fits without forbidden clipping or overflow;
3. its attached caption/glyphs fit their own rules;
4. the resulting obstacle is inside the permitted frame;
5. ordinary text can be replanned around it; and
6. the complete plan passes hard evaluator rules.

## How the planner should generate candidates

The current evenly spaced five-position search is a reasonable first coarse
search. It is not sufficient as a general policy for resizable elements.

For a single movable element, the recommended sequence is:

1. Measure the preferred size and preferred position.
2. Generate a small coarse set across the permitted position range.
3. Recompute the complete text plan for every coarse candidate.
4. Reject candidates that fail hard rules or leave residual content.
5. Rank the remaining candidates using score and deterministic tie-breaking.
6. Search locally around the best candidate with smaller position steps.
7. If size is permitted, search size and position in a bounded order rather
   than multiplying every possible dimension immediately.
8. Stop when the local improvement is below the configured threshold, the
   search budget is exhausted, or the neighborhood is fully checked.

The candidate record should expose at least:

- position and occupied size;
- preferred-distance cost;
- hard-violation count;
- residual-content count;
- complete score breakdown;
- number of text reflows;
- measurement failures or clipping reasons; and
- the relation/attachment that was preserved.

The evaluator should not reward a smaller box merely because it creates more
empty page area. A size candidate is useful only when the visual and semantic
result remains acceptable. In particular, a candidate that gains column
balance by making a chart illegible or by turning a table into unreadable
rows must be rejected or heavily penalized by an explicit rule.

## What should be hard-invalid versus merely unfavorable

### Hard-invalid

- content is lost, duplicated, or left residual;
- a block, caption, attribution, or table row crosses a forbidden attachment
  boundary;
- text enters an obstacle or a candidate leaves its legal frame;
- an image, chart, or table is clipped without an explicit crop policy;
- an informative image is non-uniformly distorted;
- a chart's data geometry is distorted or labels fall below the declared
  readable minimum;
- a table row is split in a way the table policy forbids;
- a heading is separated from a required keep cluster;
- a candidate exceeds the page/slot/route contract; or
- a size change is used without remeasuring the resulting content and
  collision geometry.

### Unfavorable but legal

- the quote is farther from the preceding text than preferred;
- the gap after a quote is larger than the gap before it;
- columns have different ink heights;
- a paragraph is split across a legal boundary;
- a one-line paragraph fragment is created without violating a hard minimum;
- a candidate moves farther from its preferred position;
- a legal image is smaller than preferred but still readable;
- a legal caption wraps to an additional line; or
- extra padding remains because reducing it would not improve the complete
  plan.

The evaluator should record why a gap exists, including whether an immovable
object caused it, but should not automatically waive an aesthetic penalty.
That matches the current decision that legal does not mean beautiful.

## Recommended defaults for the first implementation

To keep the next phase maintainable, implement the smallest useful set first:

1. Keep the existing movement model for one insertion and make it available
   through the normal renderer.
2. Add a permitted vertical range for quotes and graphics; keep width and
   height fixed at first.
3. Allow `fit-content` height for text-bearing quotes, with configured minimum
   top/bottom padding.
4. Permit proportional size candidates for images only after image measurement
   and obstacle intervals are part of the candidate result.
5. Keep charts, metrics, and tables atomic unless their renderer explicitly
   supplies a measurement and fragmentation contract.
6. Keep captions and attributions attached to their parent.
7. Keep glyphs decorative and non-colliding by default.
8. Do not permit arbitrary text-scale changes in the same search as position
   changes.
9. Add a legal-candidate test and a visual test for every newly permitted
   degree of freedom.

This sequence yields value without prematurely solving the full combinatorial
problem of moving and resizing every element at once.

## Test implications

The test suite should prove behavior, not only the existence of policy fields.
For each element family, tests should cover:

### Candidate generation

- the configured number of coarse candidates is generated;
- candidates stay inside the requested movement frame;
- preferred position is represented or deterministically used as the tie-break;
- local refinement produces smaller steps around the selected candidate;
- duplicate candidates are removed;
- candidate count and reflow count are reported; and
- multi-element candidate growth is bounded and measurable.

### Measurement and resizing

- changing width changes measured height when wrapping changes;
- the new obstacle geometry is used by the ordinary flow;
- a too-narrow text box is rejected at the longest unbreakable token;
- an image keeps its aspect ratio unless explicit crop/distortion policy exists;
- a caption remains attached and is included in the measured occupied unit;
- a chart remains readable at its minimum size; and
- a table changes only through valid row and repeated-header measurements.

### Semantics and hard rules

- moving a quote within its frame preserves source and visual order;
- moving an image does not detach its caption or alter its flow relation;
- a heading candidate preserves its keep cluster;
- glyphs follow the final target geometry and do not create an accidental
  obstacle;
- illegal candidates receive `-Infinity`/rejection and cannot win through
  quality points; and
- every selected candidate is the same candidate shown by PDF, debug, and
  dry-run output.

### Quality and visual evaluation

For a real editorial fixture, compare each candidate using:

- paragraph fragmentation;
- heading-following lines;
- orphan line fragments as defined by the document policy;
- gap before and after the insertion;
- gap consistency across columns/streams;
- column ink balance; and
- human inspection of the rendered PDF.

The score must not be treated as validated merely because it selects a
different candidate. A useful test should isolate the changed property and
show that the score component responsible for the change is the intended one.

## Conclusions versus hypotheses

### Conclusions supported by the repository and standards

- Position and size must be separate permissions.
- A complete candidate must include a fresh measurement and fresh text-flow
  result whenever its size or obstacle geometry changes.
- Semantic attachments and reading order are hard constraints.
- Informative images should preserve aspect ratio by default; cropping should
  be explicit.
- Headings, captions, attributions, table rows, and KPI internals should not be
  independently dragged.
- Legal but unattractive spacing belongs in scoring, not automatic rejection.
- The current five-position search is a sensible coarse starting point, not a
  final guarantee of an optimum.

### Hypotheses that require Report Baby experiments

- A quote's best height will usually be content height plus stable padding,
  rather than a fixed template height.
- Local refinement of a few millimeters will often improve spacing more than
  adding many uniformly distributed candidates.
- Image position is likely to produce more value before image resizing because
  resizing changes collision intervals and caption height simultaneously.
- KPI cards may benefit from grid-aware width changes, while charts will need
  stricter minimum-size checks.
- A two-stage search (position first, then bounded size) will be cheaper and
  easier to diagnose than a full Cartesian search.
- Human reviewers will prefer a slightly lower raw score when the score's
  improvement comes from a visibly compressed or undersized element; this
  would indicate a missing readability penalty or hard minimum.

## Open questions

1. Which elements in the actual editorial corpus are authored as movable
   insertions, and which are only template slots today?
2. Should a quote be allowed to move across a section boundary if its source
   paragraph remains in the same semantic section, or should the boundary be
   absolute?
3. What is the product-level minimum readable size for body text, chart labels,
   KPI values, and captions in the supported PDF formats?
4. Should a photo ever support an explicit crop mode, and if so, where is the
   crop focal point authored?
5. How should a chart express that its axes, legend, and labels have a minimum
   usable size?
6. Should a metric card be allowed to change its number of columns, or is the
   grid shape part of the template contract?
7. Can an insertion move between pages, or is page affinity always expressed as
   a hard relation to a flow/block?
8. Which spacing preferences should be normalized by line height, and which
   should remain absolute millimeter values?
9. What search budget is acceptable for a four-page editorial with several
   movable items?
10. Should the score include a general readability penalty, or should each
    element family provide its own minimum-size hard rule?

## Suggested next work

The next implementation should not begin with arbitrary resizing. It should
first make the existing single-element movement path a normal production
capability and test it end to end:

1. connect the movement policy to the normal renderer through the existing
   configuration seam;
2. render every complete candidate, including updated flow barriers;
3. expose candidate positions, sizes, score breakdown, and reflow count in
   debug/trace output;
4. verify that PDF, debug, and dry-run use the selected candidate identically;
5. add bounded quote height fitting; and
6. only then add proportional image-size candidates.

After those tests pass, run the search-depth experiment from
[`docs/release-1.0/08-candidate-search-depth.md`](../release-1.0/08-candidate-search-depth.md)
on the long editorial and small-paragraph fixtures. That experiment should
decide whether a few millimeters of local refinement materially improve the
rendered article before more element types are added.

## Primary sources

- [W3C CSS Fragmentation Module Level 3](https://www.w3.org/TR/css-break-3/)
- [W3C CSS Box Sizing Module Level 3](https://www.w3.org/TR/css-sizing-3/)
- [W3C CSS Images Module Level 3](https://www.w3.org/TR/css-images-3/)
- [W3C CSS Text Module Level 3](https://www.w3.org/TR/css-text-3/)
- [W3C CSS Multi-column Layout Module Level 1](https://www.w3.org/TR/css-multicol-1/)
- [W3C Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)
- [W3C WAI, Decorative Images](https://www.w3.org/WAI/tutorials/images/decorative/)
- [WHATWG HTML Standard, `blockquote`](https://html.spec.whatwg.org/multipage/grouping-content.html#the-blockquote-element)
- [WHATWG HTML Standard, `figure` and `figcaption`](https://html.spec.whatwg.org/multipage/grouping-content.html#the-figure-element)
- [WHATWG HTML Standard, `img`](https://html.spec.whatwg.org/multipage/embedded-content.html#the-img-element)
- [WHATWG HTML Standard, headings and sections](https://html.spec.whatwg.org/multipage/sections.html#headings-and-sections)
