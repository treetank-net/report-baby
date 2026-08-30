# Composition-kernel automated contract tests

Date: 2026-08-26

## Uruchomienie

```text
npm run test:prototype-composition -- --out /tmp/report-baby-composition-contract-test-v23
```

Harness: `server/scripts/test-prototype-composition.mjs`.

The test launches the disposable planner twice, reads the persisted
`plan.json` artifacts, and evaluates the plans independently from the
renderer-owned `plan.evaluation` field.

## Baseline result before the Report Baby adapter/font pass

```text
status: passed (historical baseline)
fixtures: 187
mutationGate: passed
```

Report: `/tmp/report-baby-composition-contract-test-v23/contract-report.json`.

## Szybki harness planera

`npm run test:text-composition-engine` uruchamia kontrakty planowania na
syntetycznych metrykach i lorem ipsum z biblioteki `lorem-ipsum`. Ten test nie
tworzy PNG ani nie rysuje grafik: obrazy są sprawdzane jako atomowe bloki,
które muszą dostać placement, mogą zostać przepchnięte na layout kontynuacji i
nie mogą zostawić reszty tekstu. Dzięki temu szybka regresja nie płaci kosztu
rasteryzacji. Testy `test:js-pdf-adapter` i `test:report-composition-oracle`
pozostają osobnymi, wolniejszymi bramkami artefaktowymi dla rzeczywistego PDF,
osadzenia obrazu i warstwy tekstowej.

All currently implemented fixtures have zero contract errors:

- accepted: baseline, short, long, float-before, float-middle, float-late;
- accepted with decisions: cross-column-ellipse, cross-column-continuation,
  large-block-explicit-slot, large-float-promoted, stair-step-wrap,
  stair-step-corrected, triangle-wrap, multi-shape-collage, justified-columns;
- rejected with an explicit core: large-image-rejected, unsatisfiable, and the
  unsupported-writing-system cases;
- accepted keep/list cases: keep-push, marker-push.

## What the harness checks

### Source coverage

- every accepted source block is represented;
- line ranges start at word `0`;
- consecutive ranges have no gaps or overlaps;
- the final range ends at the declared source word count;
- list markers occur only on the first line of their item.

### Reading order and geometry

- article and sidebar streams preserve source order independently;
- every line references an existing page/track/sidebar region;
- no line exceeds its region or block-end;
- no accepted line is overfull;
- no accepted line intersects an image exclusion.

### Images and pagination

- accepted source images are placed exactly once;
- no undeclared image appears;
- page-only images remain on their required page;
- long and justified flows create continuation pages;
- short content does not create a phantom page;
- required decisions exist for scale, reserved-slot and float-promotion fixtures;
- required keep clusters are checked independently: the subject and its required
  companion lines must share one page and fragmentainer;
- line boxes are finite, positive, monotonic and non-overlapping within each
  page/region/track fragmentainer;
- page indexes form a contiguous sequence starting at zero.

### Rejection contract

- expected rejected fixtures are rejected;
- rejected outcomes contain an unsatisfied core;
- rejected outcomes do not advertise an artifact;
- unexpected accepted/rejected status fails the test.

### Determinism and mutation gate

- the same fixture corpus is planned twice in fresh child processes;
- canonical `plan.json` output must be byte-equivalent;
- a mutated line position must produce `LINE_OUTSIDE_REGION`;
- a mutated source range must produce `SOURCE_RANGE_OVERLAP`;
- a mutated required keep must produce `REQUIRED_KEEP_SPLIT`.

The breaking-policy and star-occlusion harnesses additionally consume the
independent `server/templates/composition-qa-manifest.yml`. The manifest owns
the expected corpus cardinality, fixture naming contract and explicit rejected
cases; the generator cannot silently shrink or redefine the corpus and still
pass its own test.

The current `--no-render` rerun is recorded separately: the 199-fixture
contract harness passes with all mutation gates, and the 124-case
breaking-policy harness passes
with 124 PNGs and two explicit warning outcomes. The current reports are
`/tmp/report-baby-composition-contract-test-v26/contract-report.json` and
`/tmp/report-baby-breaking-policy-corpus-v5/breaking-report.json`.

## Coverage gaps against the larger corpus

The full corpus in `composition-kernel-prototype-cases.md` is broader than the
199 deterministic plan fixtures currently implemented. These are not yet separate
automated fixtures:

- `column-span`/spanner cases;
- multiple simultaneous exclusions and overlapping exclusions;
- diagonal polygon, concave polygon and tangent-line geometry;
- fixed one-page limit and no-body-region preflight;
- generated 100-page/100-float stress cases;
- accepted Arabic/Hebrew, CJK, combining marks, emoji and vertical writing
  shaping (the prototype now has a separate fail-closed unsupported-writing gate);
- glyph-level PDF/PNG geometry parity with the plan.

These should be added as parameterized fixtures rather than hand-written visual
cases. The contract harness is ready for them because it consumes plan-level
source ranges, frame geometry, decisions and diagnostics.

## Important limitation

The current harness proves the planner's internal contract and the PDF gate
proves page size, page count and selectable source-token coverage. It does not
yet prove glyph-level PDF positions against every individual line box.

## PNG pixel gate

The disposable PNG gate is separate from the plan harness:

```text
npm run test:prototype-pixel-qa -- \
  --root /tmp/report-baby-composition-visual-qa-v1 \
  --out /tmp/report-baby-composition-pixel-qa-v2
```

Harness: `server/scripts/test-prototype-pixel-qa.mjs`. It reads the expected
image box and color from `plan.json`, decodes each PNG, samples the declared
shape mask on both sides, and counts dark ink pixels inside the visible shape.
It also checks page count and rejects PNG artifacts for rejected plans.
Thresholds are in
`server/templates/composition-pixel-qa-prototype.yml`.

The signed-mask regression pass exposes and fixes real defects:

```text
status: passed
fixtures: 124
accepted: 123
rejected: breaking-strict-protected-image
mutationGate: passed
```

The first signed-mask run showed that ellipse rendering painted a rectangular
fill and only drew an oval outline. The outside-shape ratio caught the leak;
the renderer was then changed to fill the actual ellipse. A second regression
also found a small real star/text contact, which was resolved with the
configurable 0.5 mm wrap gap. The pixel gate now checks both interior coverage
and exterior leakage, rather than trusting only the declared bounding box.

The corpus now also contains the isolated `stair-step-wrap` and
`stair-step-corrected` fixtures. Their plans record three contiguous ranges
around the image: 5 lines at the first available width, 7 at the second, and
11 after the image. The A/B render proves the distinction: the first paints a
full rectangle and fails pixel-QA; the second paints the matching stepped
shape and passes with zero detected dark pixels inside the shape. This makes
the discrete nature of the wrap decision inspectable instead of leaving it
only in the final PNG.

The intended semantic fixture is now `triangle-wrap`: the image is rendered as
a real triangle, while the line planner samples that triangle at each line's
vertical interval. The changing text indentation is therefore a consequence
of discrete line boxes, not a claim that the image itself is staircase-shaped.
`stair-step-corrected` remains useful as an implementation diagnostic for a
renderer that chooses explicitly stepped artwork; it is not the target model
for triangular artwork.

The prototype wrap configuration sets the declared `gap_mm: 0.5` and a
separate `raster_safety_gap_px: 6`. The former is layout policy; the latter is
the calibrated rasterization guard. If an overfull word would still cross the
shape at that boundary, the planner pushes the line below the image instead of
silently drawing over it. The PNG detector ignores only the configured
one-pixel raster edge tolerance and still fails when dark ink occupies the
interior of the shape.
`multi-shape-collage` places a triangle, star and ellipse at the same vertical
origin. Their exclusion intervals are unioned, and pixel-QA accounts for
z-order when deciding how much of an earlier shape should remain visible.
The z-order probe also samples declared adjacent layer pairs and verifies that
the upper layer's color is visible across their raster intersection. Its own
mutation gate replaces the upper layer with the lower layer and requires a
`Z_ORDER_TOP_COLOR_MISMATCH` finding.

The renderer now paints ellipses as actual filled ellipses rather than a filled
rectangle plus an oval outline. The signed mask therefore detects the former
  bug as outside-shape leakage, while the corrected renderer passes it. The
  image mutation gate injects a dark patch into a known image and proves that
  the detector reaches the fail score. The z-order mutation gate independently
  inverts an overlapping layer pair and proves that the paint-order finding is
  emitted.

`riskScore` is deliberately named a score, not a probability. It is mapped
from a clean-render floor to a fail ratio. A pixel intersection after a
calibrated shape mask is a deterministic finding; a statistical probability
requires a corpus of known-good and deliberately broken renders.

## Writing-system fail-closed gate

The prototype does not silently render unsupported scripts with Latin metrics.
`test:prototype-writing-systems` covers RTL Arabic, Japanese `vertical-rl` and
Latin `vertical-lr`; each returns `UNSUPPORTED_WRITING_SYSTEM`, preserves the
requested direction/mode/script in the unsatisfied core and produces no PDF or
PNG. This is a safety contract, not evidence that those writing systems are
implemented. Accepted shaping still requires a real text shaper, grapheme and
cluster mapping, font fallback and writing-mode-aware glyph geometry.

```text
npm run test:prototype-writing-systems -- \
  --out /tmp/report-baby-writing-systems-v3

status: passed
cases: 3
```

## PDF artifact gate

The PDF pass is intentionally separate from both the planner and PNG gate:

```text
npm run test:prototype-pdf-parity -- \
  --root /tmp/report-baby-breaking-policy-corpus-v15/rendered \
  --out /tmp/report-baby-pdf-parity-v6

status: passed
fixtures: 124
errors: 0
```

`server/scripts/test-prototype-pdf-parity.mjs` uses `pdfinfo` and
`pdftotext` (including `-bbox-layout`). It verifies that accepted plans have a
PDF, rejected plans do not, PDF page count and MediaBox match the plan, the
selectable text layer contains the complete source token multiset, and every
recognized authored word can be matched to its planned page/line box. Expected
text comes from the fixture-owned `source.json`, not from `plan.json`; the
source snapshot must be present, match the fixture ID and contain non-empty
authored text. This is not yet a glyph-position oracle: it checks word boxes,
not individual glyph clusters, shaping, ligatures or bidi visual order.
