# Composition engine migration status

Status as of 2026-08-28: the composition planner is the production route for
reports and slides. `report-renderer.ts` and `slides.ts` still own the public
format-specific APIs, while the jsPDF adapters execute accepted planner
placements. Charts are prepared as PNG assets before planning, and the same
slide plan is used for PDF, PNG and editable PPTX output.

| Report Baby input | Modelled | Planned | Rendered by shadow | Ready for swap |
| --- | --- | --- | --- | --- |
| intro and section text | yes | yes | yes, public editorial route | typography/parity corpus pending |
| headings and block order | yes | yes | yes, public editorial route | spacing/keep parity pending |
| multi-page continuation | yes | yes | yes, public editorial route with opening/continuation geometry | page-flow parity pending |
| growing ordinary box and pushed columns | yes | yes | yes in prototype seam | no: arbitrary dependency solver pending |
| footer flow | yes, if template declares it | yes | yes as a repeated flow; line and page number remain transitional chrome | no: full header/footer parity pending |
| title/subtitle/period/brand chrome | named flows; template `lockup` slots reserve the brand box | yes, where the template declares routes | public planner route; lockup geometry is reserved by the plan, while the rule and page label remain renderer chrome | repeated chrome parity still pending |
| title page | `title` flow plus title-page slots | yes | public planner route with forbidden continuation | broader title-page parity corpus pending |
| KPI, chart, table | semantic blocks | KPI/chart/table in declared block slots | public planner route with PDF/PNG/PPTX or PDF artifact gates | broader brand parity pending |
| authored images and captions | normalized asset records yes | atomic image block in ordinary flow slots | public planner route with boundary/wrap and PNG checks | broader multi-image/brand parity pending |
| declared shape graphics | yes | yes | vector shapes plus rectangular asset graphics; asset shape is a text-flow boundary and does not clip the rectangular asset | no: broad asset/shape visual parity pending |
| brand font metrics | injected DejaVu test path | yes | text widths via jsPDF | no: brand-font corpus pending |
| RTL/CJK/vertical writing | prototype coverage only | no | no | no: shaping/direction contract pending |

## Acceptance rules

- `accepted` means every non-empty planned block covers its source word range
  continuously from zero to the end, every line is inside its slot, and there
  are no error diagnostics.
- `accepted-with-warnings` means the same structural conditions hold, but input
  normalization or another non-fatal condition produced warnings.
- `rejected` means residual content, incomplete coverage, unsupported input,
  missing assets/routes, or invalid geometry. A rejected plan must not reach a
  backend.

## Current gates

- `npm run build`
- `npm test` (public behavior plus shadow/oracle/jsPDF composition gate)
- `npm run test:composition-data-adapter`
- `npm run test:text-composition-engine`
- `npm run test:report-composition-image`
- `npm run test:page-template-adapter`
- `npm run test:js-pdf-adapter`
- `npm run arch:check`
- legacy prototype adapter/corpus and flow-box regression suites

The oracle gate uses short unique sentinel words for source-completeness
comparison. This avoids mistaking legal hyphenation and repeated report chrome
for lost content. Every public planner line is also checked against its
declared page and rectangle through `pdftotext -bbox`; the result exposes both
the compatibility `reportPlan` and the concrete `compositionPlan`.

The composition gate deliberately does not claim full PDF/PNG parity. It has
an oracle comparison, selectable-text and bbox checks, and a public-route
assertion. Before removing the remaining fallback, repeat this comparison
across real brand fonts and PNG fixtures, cover repeated header/footer/page
number semantics, and add the real-asset boundary backend.

## Text composition policy

Visual quality is part of the layout contract, not a post-render cosmetic pass:

- Ordinary text preserves source order. A heading is indivisible and is kept
  with the configured minimum fragment of its following content; if that
  cluster does not fit, the whole heading moves to the next legal slot.
- Paragraphs, headings, list items, quotes and captions use configured block
  gaps. A template may override those values for a deliberate composition,
  but the renderer must not invent a local offset for an individual block.
- A full-width intro, figure or quote is a measured insertion. It occupies a
  declared span slot and its height is known before the remaining flow is
  placed. If a quote's insertion slot exists only on a continuation layout,
  the planner records `INSERTION_DEFERRED`, fills the current page with
  ordinary article flow, and places the quote at the next legal insertion point.
- Insertion gaps are part of measurement. Image captions are centered within
  the image width and use the configured image-caption gap; quote marks, text
  indent and quote margins belong to brand/template configuration, not to the
  article payload.
- A page should use available material before opening a new page. The quality
  inspector flags an under-filled non-final page when at least two columns are
  actually used, and flags large inter-line gaps in the same text lane. A
  full-width span or deliberately single-column opening page is not treated as
  a two-column failure. Sparse trailing space on the final page is legal;
  unexplained space before the first body content is not.
- Charts, metrics and authored images are sized through their measurement
  capability and receiving slot. They do not receive a hard-coded
  article-specific rectangle, so the same content can move between opening,
  continuation and insertion layouts without changing the flow algorithm.

These rules deliberately distinguish a better composition from accidental
legacy parity. If a template intentionally overrides a default, the override
belongs in that template and is a documented composition choice.

Slide text slots may declare `vertical_align: top|middle|bottom`. The planner
keeps this as a slot rule and the format renderers measure the fitted line
count before choosing the text baseline. An omitted value preserves the
existing top-oriented behavior, so an existing brand does not change merely
because the engine gained the capability. This is useful for the large,
PowerPoint-like cards in the showcase brands, where a short paragraph should
sit in the middle of its declared box rather than at its first-line baseline.

The Flux title template deliberately declares its image slot as the full
canvas and sets `no_overlap: false`. This is not an accidental collision: the
image is a surface background and the hero text is a safe-area overlay. The
Parcelia title surface uses the same model with a brand-declared semitransparent
scrim. A right-hand image frame would be a different editorial composition and
must be declared explicitly by a different template.

`renderReportCompositionPdf` is the production integration seam for reports;
`renderReportCompositionShadowPdf` remains its compatibility name for the
prototype harness. A `render_report` call plans and evaluates named flows,
including title, header and footer flows, before the jsPDF adapter draws them.
The remaining renderer-owned chrome is deliberately limited to the rule and
page label. There is no production report-data translator or legacy fallback
in the MCP/CLI path; old stories are retained only in test-only corpora until
their fixture inputs are rewritten.

For a page flow, `slots` describes the opening layout and optional
`continuation_slots` describes the layout used after that flow crosses a page
boundary. If `continuation_slots` is omitted, the opening slots are reused for
continuation for backwards-compatible template behavior. This distinction is
important for editorial pages: a first page may contain intro, metrics and a
chart, while later pages expose one or more dedicated content slots. A flow is
never allowed to fall into an unrelated slot merely because that slot happens
to have free space.

## Editorial flow QA rules

These are executable layout rules, not visual preferences:

- Source blocks in one flow must appear in source order. The plan records each
  placement's route position so the evaluator can reject a later block that is
  visually before its predecessor with `CONTENT_ORDER_VIOLATION`.
- A multi-column route is column-major: content in a later column cannot start
  before the preceding column segment has been consumed. In the continuous
  insertion mode, full-width quotes are not route positions at all: they are
  fixed obstacles over the existing column geometry, and the same text stream
  resumes below the obstacle in the current column.
- Quotes retain their ordinal order. An unused quote slot is marked exhausted
  and its reserved height is removed before following content is measured.
- An empty non-final insertion or content segment is a planner defect when
  material that follows could legally occupy it. Only the final natural tail is
  allowed to remain blank.
- A heading stays with its configured following lines and is never split across
  columns. The same keep rule applies after a full-width insertion.
- A quote must have comparable configured spacing above and below. Caption and
  quote spacing are measured values, not backend-specific offsets.
- Test fixtures use the repository's `lorem-ipsum` generator with uniquely
  named block IDs. Its deterministic output receives a monotonic ordinal on
  every word, so different word lengths exercise real line wrapping. Tests assert
  both complete source coverage and the visual route sequence, so a fixture
  cannot pass merely because all words are present somewhere in the PDF.
- The numbered-word oracle appends a monotonic ordinal to every generated
  token, including heading text (for example `lorem0001 ipsum0002
  dolor0003`). It requires every ordinal in the final PDF, checks
  that the first column contains the complete stream before the second starts,
  and rejects any right-column ordinal that is smaller than a left-column
  ordinal on the same or a higher visual line. It also fills the available
  discrete lines before permitting a column transition; only the final natural
  tail may remain empty.

### Plan observability

The executable plan remains a flat structure because renderers consume flat
placements, but it must expose a grouped explanation beside that structure:

- `plan.trace.phases` records preflight, obstacle reservation, insertion
  placement, ordinary flow placement, each reflow pass and final evaluation.
- `plan.trace.blocks` groups every source block into its fragments, source word
  count, final status and the decisions that affected it, including page,
  slot, route position and reason details.
- `plan.trace.slots` reports each page slot's geometry, state, line count,
  occupied height and remaining line capacity. This makes an empty or
  under-filled non-final slot visible without reconstructing it from line
  records.
- The numbered editorial harness writes `plan.json`, `plan-trace.json`,
  per-page JSON/SVG debug boards and ink-occupancy data when
  `REPORT_BABY_ARTIFACT_DIR` is set. A rejected plan is therefore inspectable
  at the phase, block and slot level before a backend can render it.

The page-template flow contract now supports `repeat: each-page`. The built-in
editorial footer uses that route, so footer content is planned and rendered as
an ordinary flow on every materialized page. The legacy footer pass still owns
the rule and page label during the shadow transition; moving those into the
plan is part of the remaining chrome-parity work. Repeated-flow overflow is
fail-closed: an oversized footer produces residual content and rejects the
plan rather than leaking into `main` or being silently truncated.

## Atomic block seam (first vertical slice)

The composition plan now distinguishes text placements from
`blockPlacements`. An atomic KPI/chart occupies one declared `kind: block` slot
and is never silently converted into text or split. An authored image may also
occupy a text slot as an atomic normal-flow block: its measured rectangle
reserves only its own height, so following text can use the remaining space in
that same slot; if it does not fit, it follows the normal route to another
slot/page. The planner receives an optional renderer-neutral
`measureBlock(block, box)` capability and records the measured height. If no
measurement exists, the plan is rejected. The evaluator checks source
identity, kind, slot containment, duplicate placements and overlap with planned
text.

The jsPDF adapter only executes this decision through an explicit
`blockRenderers` capability. It does not invent card or chart placement;
absence of a renderer fails at execution. KPI, chart and authored-image inputs
are marked atomic by the ReportData adapter; the KPI card, vector chart and
image capabilities have measured placement plus selectable-text or embedded
asset artifact checks in the shadow path. Tables use separate row-fragment
placements, repeat their header once when a continuation first enters a page,
and report row-level coverage; fragments that remain on the same page do not
repeat the header. A table-wide `atomic: true` flag would incorrectly prevent
that row-level continuation.
Independent atomic capabilities are combined through a kind-dispatching seam,
so registering image support cannot replace the measurement or renderer for a
metric or chart in a mixed document.

An authored asset is always rendered as a rectangular image. A graphic's
`shape` is only the boundary used by the planner to reserve space and wrap
text; it is not an instruction to clip or deform the asset. This intentionally
supports transparent PNGs: the visible silhouette can be non-rectangular while
the renderer keeps the image operation simple and predictable.
The public composition renderer supports the same conservative idea for
structured content: `wrap: left/right` adds a planner-only rectangular image
boundary while the paragraph is measured one line at a time. If no configured
minimum text interval remains, the image behaves as a normal block and the
following text starts below it. Markdown remains block-level by default.

Brand chrome follows the same geometry rule. A template may declare a
`type: lockup` slot in its header flow; the page-template adapter turns it into
a reserved composition box, excludes it from the header content route, and the
report renderer paints the brand mark and name inside that box. Header text is
therefore planned against the lockup instead of relying on an implicit
renderer coordinate. This keeps automatic brand content simple for callers
while making its occupied area visible to collision checks.
If a future product requirement needs a clipped or transformed asset, that is
an asset-preparation concern before planning, where a dedicated raster/vector
library can produce the final PNG; it is not a jsPDF-kernel capability.

Sol's review reinforced this boundary: KPI/chart/table need semantic coverage
in addition to word coverage, and raster preparation for charts must happen
before planning. The KPI slice now has a production template, public routing,
trend-aware colors, note rendering, selectable-text assertions and a PNG
round-trip. The chart slice now has a dedicated public template and a two-page
semantic gate: two charts are placed as atomic blocks on successive pages and
their titles and data labels remain selectable. The table slice still has
measured placements and artifact checks, but needs the same public semantic
gate before legacy replacement.

## HTML reference for editorial quotes

The source Trans.INFO article uses four semantic `blockquote` elements in the
article body, each containing one paragraph. The rendering contract should
retain that order and treat each quote as one full-width insertion between
ordinary paragraphs; it must not become a third narrative column. The source
page also puts the article title in the article header, before the body rule
and content. See the [source article](https://trans.info/pl/ladunkow-nie-przybywa-a-wolnych-ciezarowek-brakuje-rynek-transportowy-znow-sie-zaciska-499096).

The live stylesheet uses generous vertical margins around a quote, horizontal
padding inside the article column, italic blue text, and opening/closing quote
marks attached to the same quote box. The PDF implementation therefore:

- reserves trailing width for the closing mark during wrapping;
- draws the opening mark from the quote text indent, never outside the slot;
- clamps the closing mark to the slot's right edge;
- requires both marks in the backend round-trip test;
- allows the ordinary flow to cross an insertion only after the preceding
  route segment is exhausted, allowing less than one residual line-height from
  the discrete line grid.

The source article also uses a full-width responsive hero image followed by a
small caption. That remains the reference for the intro insertion, while the
source article itself does not place an image inside the body flow.

## Fixed insertion-obstacle contract

An inline editorial insertion is a fixed obstacle, not a geometry mutation.
The route contains one text segment per column; quote slots are declared as
`insertionSlots`, painted in their fixed box, and also materialized as
planner-only rectangular `wrap: around` graphics. Placing a quote must not
change the `y` position or height of either column and must never advance the
ordinary stream sideways. If the current flow position cannot legally reach an
insertion box without colliding with earlier content, the insertion moves to
the next legal page; it is not painted over that content. A successful
placement records `FLOW_INSERTION_OBSTACLE_PLACED` and the following text is
wrapped around the same obstacle until it ends.

The large numbered-flow fixture in
`server/scripts/lib/editorial-numbered-fixture.mjs` mirrors the source
article's block sequence and word-count profile without storing article copy
or brand assets in the repository. `npm run test:editorial-numbered-flow`
requires 1000+ numbered main-flow words, four quote insertions, zero residual
content, exact planner/PDF token coverage, monotonically increasing reading
order, and no unexplained route gaps. Set
`REPORT_BABY_ARTIFACT_DIR=/tmp/report-baby-editorial-debug` to retain the
PDF, plan JSON, fixture summary, and per-page continuous-flow debug boards.
