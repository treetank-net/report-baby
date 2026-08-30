# Star occlusion and wide-page prototype corpus

Date: 2026-08-26

Run the 20-case corpus with:

```text
npm run test:prototype-star-occlusion -- \
  --out /tmp/report-baby-star-occlusion-corpus-v11
```

Result:

```text
status: passed
cases: 20
accepted: 20
knownFailures: none
```

`star-spanning-columns` is now accepted. A spanning image owns both article
tracks as one exclusion object. In the first track text stays on the left; in
the second track the planner uses the available space to the right of the
image instead of producing an overfull line or silently entering the shape.

## Cases and expected behavior

| Case | Arrangement | Expected result |
| --- | --- | --- |
| 01 | star behind ellipse | ellipse hides star center; text avoids union |
| 02 | star above ellipse | star remains the visible top layer |
| 03 | star behind triangle | triangle covers shared region |
| 04 | triangle behind star | star remains visible |
| 05 | nested large/small stars | inner star occludes only the center |
| 06 | star under rectangle | opaque rectangle covers star |
| 07 | partial star/ellipse overlap | star tips remain visible |
| 08 | touching star and ellipse | only the configured minimal wrap gap is retained |
| 09 | star at left article edge | no geometry leaks outside track |
| 10 | star at right article edge | text wraps on the left |
| 11 | top-apex triangle with star | heading stays outside barrier |
| 12 | bottom-apex triangle with star | barrier expands only where shape exists |
| 13 | star over large ellipse | star is visible over ellipse |
| 14 | three z-order layers | one union barrier, correct visible mask |
| 15 | star spanning columns | one exclusion object across both columns; safe continuation |
| 16 | star plus ellipse with long text | image stays on page one; text continues |
| 17 | star under section heading | heading and lead remain a keep cluster |
| 18 | star with long sidebar | article barrier does not affect sidebar |
| 19 | ellipse, star, triangle layers | later layers preserve valid visible mask |
| 20 | compact star collage | no overflow or text/shape intersection |

The independent manifest in `server/templates/composition-qa-manifest.yml`
owns the 20 expected fixture names and currently expects no rejection. Signed
pixel-QA treats later images as occluders when measuring the visible mask of an
earlier image, and checks both color coverage inside the shape and color
leakage outside it. This is necessary for case 01: the star is intentionally
mostly hidden, so low raw visible coverage must not be reported as a missing
image.
The same pass checks declared adjacent z-order pairs and has a mutation gate
for every overlapping pair in the corpus, including small raster overlaps.
Pairs with zero raster intersection are reported explicitly as
`no-raster-overlap`; they are not counted as evidence of paint order. This
catches an output that has the right boxes but the wrong paint order.

## Wide-page smoke corpus

The `landscape-1600x900` preset uses three article columns and a sidebar. It
also includes a 3-page text fixture, many short heading/paragraph sections,
and a title followed by several compact paragraphs:

```text
npm run test:prototype-landscape -- \
  --out /tmp/report-baby-landscape-1600x900-v8
```

Result: 6 cases, exact 1600×900 PNG dimensions, 3-page continuation fixture,
automatic no-stranded-heading checks, and pixel-QA pass. The short-section
fixture records explicit `KEEP_CLUSTER_PUSHED` decisions when a heading plus
its lead cannot fit at the bottom of a column.
