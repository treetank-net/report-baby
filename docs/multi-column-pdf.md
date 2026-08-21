# Editorial multi-column A4 PDF

Status: research complete; the production A4 renderer is unchanged.

## Prototype result

`server/scripts/prototype-multicolumn.mjs` was run against the embedded DejaVu
font and rasterised with `pdftoppm`. All three variants produced valid PDFs and
reported no geometry problems:

| Variant | Pages | Lines | Hyphenated | Space stretch p95 | Forced lines |
| --- | ---: | ---: | ---: | ---: | ---: |
| Justified + Polish hyphenation | 2 | 179 | 35 (19.6%) | 1.617× | 0 |
| Justified, no hyphenation | 3 | 273 | 0 | 1.603× | 0 |
| Ragged right | 2 | 133 | 3 (2.3%) | n/a | 0 |

The justified variants still have occasional wide spaces: 17 lines in the
hyphenated run exceed 1.5× the natural space width. The hyphenated run reaches
four consecutive hyphenated lines. The prototype's shrink guard prevents a
line from exceeding its column measure; no forced overfull lines were emitted.

## Proposed production contract

- Introduce a separate page template family with `kind: page`; do not add
  editorial columns to `default-report` implicitly.
- Keep page geometry in the template: margins, column count, gutter, reserved
  bands, and block frames. The renderer should reject frames outside the page.
- Use the prototype's dynamic line breaking and re-break a paragraph when it
  crosses into a segment with a different measure.
- Keep `justify` and `ragged-right` explicit. Polish hyphenation is opt-in per
  template or block, because it changes line count and the visual rhythm.
- Keep widow/orphan and keep-with-next rules as renderer constraints, with a
  diagnostic when a block is pushed to the next segment.
- Preserve whole charts and tables as atomic blocks; move them to the next
  segment/page when their reserved height does not fit.
- Add visual QA gates for column containment, gutter clearance, line overflow,
  extreme space stretch, consecutive hyphenation, and deterministic output.

## Recommendation

Proceed with a dedicated `kind: page` template only after agreeing on editorial
typography and acceptable stretch/hyphenation thresholds. The prototype is a
usable algorithmic seam, but its measured space-stretch tail and four-line
hyphenation run should be treated as design decisions, not hidden defaults.
