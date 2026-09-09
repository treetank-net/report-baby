# Plan 08 — candidate-search depth

Status: implemented for the composition-search scope. The renderer-neutral
contrast sampler, glyph-cell sampling, PNG asset-adapter integration,
deterministic candidate order, cost trace, and long-editorial calibration are
implemented. Trace records observed planning time as diagnostic data, not as a
deterministic metric. Additional image formats remain in Plan 09.

## Goal

Candidate search must find a sufficiently good legal layout rather than merely
the first plausible position. A bounded coarse search is followed by local
refinement around the best result. Every attempt is deterministic, bounded by
configuration, and visible in the trace; this is not permission to scan an
entire page without limits.

## Work sequence

1. Measure the cost of one movable element: candidate count, planning time,
   text recalculations, and rejected variants.
2. Compare coarse search, local refinement, and bounded additional rounds.
3. Check whether additional variants improve score, paragraph breaks, orphan
   count, and spacing uniformity.
4. Include a case where the best position lies between coarse coordinates.
5. Include a case where another round produces no improvement and stops early.
6. Only then choose limits and configuration values for real editorial.

## Recorded measures

For every round, record generated and unique candidates, full text recalculations,
candidate reflows, planning time, rejected plans, legal-plan scores and their
breakdowns, fragmentation/orphan/spacing changes, contrast results against the
candidate background, and the difference between the round winner and the best
known result. A higher score alone is not enough; the improvement must be
visible in the resulting PDF.

## Search variants

The first bounded experiment compares evenly distributed positions across the
allowed range, local positions around the best candidate, and a further round
only when the previous round improved the winner or the winner is on the range
boundary. Results are measured on long editorial with short paragraphs and on a
small fixture with easy-to-inspect fragments.

## Completion criteria

- A test proves that refinement can find a better position than coarse search.
- Rounds stop at their configured limit or after no improvement.
- Candidate and recalculation counts are configuration-bounded.
- Candidate order and winner selection are deterministic.
- PDF, debug output, and trace show the same winning position.
- Extra candidates improve a measurable property without violating hard rules
  or creating unacceptable cost.
- A score-only improvement remains a score-calibration question, not evidence
  that deeper search is required.

## Contrast as a candidate metric

Moving text or a graphic can change the background below glyphs. Contrast is
therefore sampled after candidate geometry is known but before evaluator
selection; it is not part of line wrapping. Decode an image once and sample a
small crop for each candidate. Do not rely on only a global average or blur:
bright and dark regions can hide a severe local contrast failure. Keep the worst
or lower-tail samples and expose their regions in the trace.

Perform detailed, bounded rendering only for the winner, near-ties, or a
calibration point. It validates screening order; it does not reject a plan.
`unknown` remains visible in the breakdown and is currently score-neutral.

WCAG 2.2 ratios 4.5:1 for normal text and 3:1 for large text are reference
points, not planner hard gates. Mean glyph contrast feeds distributed quality,
the worst glyph sample feeds a local visibility signal, and the share below
`contrast_severe_ratio` feeds a saturating breadth signal. Each signal uses
`x / (x + response)` normalization and `composition_score` weights. The
`contrast.body_minimum` value is a configurable scoring target, not automatic
rejection. Decorative glyphs and logos may receive separate quality weights.

The initial benchmark measures decode/sample time, cache hits, screening versus
detailed-result divergence, and a position where the same text changes contrast
over an image. Tune weights only after comparison with PDFs and human visual
review.

### First experiment

[`server/scripts/test-contrast-evaluation-prototype.mjs`](../../server/scripts/test-contrast-evaluation-prototype.mjs)
passes as part of the composition gate. On a controlled image with a dark band,
eight text positions were tested: one prepared image served seven cached
candidates; 6×6 screening used 288 samples versus 1,920 for a full scan; a
global average falsely reported 5.28:1 where a local region was 1:1; local
screening found both bad candidates; and a transparent PNG produced a result
only when its background was known, otherwise `unknown`.

The experiment supports cheap screening but does not prove every input format
or final PDF-raster parity. The fixture is synthetic and uses rectangular
regions rather than an exact glyph mask. A real asset must be checked with its
actual contain/crop geometry and a case where detailed measurement changes the
ranking.

The experiment also aligned the sRGB boundary in `brand-context.ts` and
`visual-qa.mjs` from 0.03928 to the current WCAG 0.04045 definition, with a
contract test so evaluator, visual QA, and screening agree.

## Implementation evidence

`trace.candidateSearch` records coarse and refinement rounds: generated,
unique, and evaluated plans; legal candidates; best score; reflows; whether a
round improved the winner; planning time; and full-plan recalculations.
Candidates are not removed before evaluation, preserving existing order and
tie-break behavior; uniqueness is reported separately. Limits are controlled
by `candidateCount`, `refinementRounds`, and `refinementCandidateCount`.

The engine contract includes a refinement-better-than-coarse case and an
explicit `no-improvement` stop. The movable-quote fixture checks positions,
score, and reflows; a current local tie is not treated as visual calibration
evidence.

`test-editorial-numbered-flow.mjs` covers a long editorial: five coarse
positions and local refinement are legal, ranking changes orphan count, the
winner matches trace, and the final PDF passes text, geometry, and raster
occupancy checks. This gate requires `pdftotext` and `pdftoppm`.

The renderer-neutral sampler in
[`server/src/composition/contrast.ts`](../../server/src/composition/contrast.ts)
accepts a prepared raster and region; it does not decode images or know about
PDFs. The asset adapter decodes PNG once, maps the real contain rectangle, and
the evaluator records status, worst sample, glyph cells, sample regions, and
warnings without adding contrast to line wrapping. JPEG and unknown rasters
return `unknown`; SVG is supported only when the resolver supplies a raster.
The planner remains pixel-decoder-free.

## Benchmark evidence

The one-time benchmark used a 1,620×1,080 RGB editorial PNG (1,200,915 bytes):

| Operation | Scope | Median |
| --- | ---: | ---: |
| full PNG decode | one image | 95.5 ms |
| thumbnail reduction to 320×213 | one image | 1.53 ms |
| thumbnail reduction per 20 candidates | 20 preparations | 25.1 ms |
| 6×6 screening on decoded image | 20 candidates | 0.92 ms |
| 6×6 screening on one cached thumbnail | 20 candidates | 0.91 ms |
| full-pixel scan | 20 regions | 2,079 ms |

Prepare an image once and sample locally for each candidate. If the full raster
is already needed for rendering, sampling it is cheaper and more accurate than
creating a blurred copy. Do not decode or create a thumbnail per candidate.
The benchmark did not measure JPEG, SVG, or partial PDF rendering; their
decoder and cache policy must be explicit before integration.

Contrast is mandatory to inspect over graphics, transparent images, overlays,
or custom palettes, but a known low ratio lowers score rather than automatically
rejecting. `unknown` remains visible and neutral pending calibration. A uniform
background can use direct color contrast without image decoding.

## Dependencies and follow-up

Plan 08 does not replace Plan 04: legal bounds, size policies, flow relations,
and text reflow must be defined first. Start with one movable element, then a
graphic and quote with different constraints, and only later multiple elements.

Remaining work is limited to benchmarking JPEG/SVG and partial-PDF decoding,
calibrating `unknown` and `composition_score.contrast_penalty`, and adding
WebP/AVIF adapters in Plan 09.
