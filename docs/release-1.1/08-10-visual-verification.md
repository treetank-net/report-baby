# Release 1.1 — 08–10 visual verification record

Status: complete for the 1.0.2 implementation checkpoint.

This record is separate from executable contract tests. A legal plan can still
look poor, so completion includes inspecting one representative rendered
document and preserving its measured quality findings. The selected plan is
not required to have zero soft penalties; those penalties must be visible,
attributed and actionable.

## Current verification scenario

- Source: the deterministic editorial fixture shared by the editorial plan
  contract and composition-quality tests. Test copy is natural Lorem Ipsum;
  source coverage and order are checked from authored block IDs, planned word
  ranges and the actual words on the planned lines, not synthetic numeric
  suffixes.
- Template: `editorial-inset-two-column` with one `fluid-y` quote capability,
  materialized as two bounded quote slots per page.
- Content: 2,084 main-flow words and four authored quote insertions.
- Planning result: five pages, no residual content, `accepted` evaluation.
- Movement search: 5% of page height, five coarse candidates, and the configured
  refinement step/budget.
- End-to-end entry point: `scripts/test-composition-quality-e2e.mjs`.
- Rendered artifact inspected: `/tmp/report-baby-composition-quality-e2e.pdf`.
- The page-count difference from the earlier six-page/1,242-word fixture is
  intentional: the fixture now contains more natural prose rather than
  synthetic numbered tokens.

## What the plan-only and end-to-end checks prove

- The fluid capability is compiled and materialized into page-local `#1`/`#2`
  slots; all authored quote insertions are present in the plan.
- The plan exposes page, slot, region and insertion-rhythm evidence, and slot
  occupied and empty areas partition the slot envelope.
- Quality components, per-placement score contributions, repair proposals and
  candidate-search trace are carried through the public quality summary.
- TTF PDF metrics use the actual `glyf` outline bounds for each decorative
  character, rather than applying the font-wide ascender/descender envelope to
  every quote mark. The adapter test checks that the per-character box is
  substantially tighter; fonts without those TTF tables retain the existing
  conservative fallback.
- Planner capacity decisions use template-local slot ids plus a page number,
  while materialized plan slots use page-qualified ids. Underfilled-flow
  legality now correlates these forms, so an intentional heading keep-cluster
  push is not mistaken for unused capacity that the planner could have filled.
- Base score plus placement contributions conserves the selected plan score.
- The engine compares complete legal candidates and retains the best total
  score rather than committing to a locally suggested move.
- A regression test now verifies that changing insertion attribution from
  template-owned to planner-selected does not change distribution scoring for
  identical geometry. Fluid-vs-fixed distribution semantics are derived from
  the actual slot placement mode, not the placement's diagnostic `cause`.

## Current visual and scoring findings

- All five pages render and the two-column text is readable. The last page has
  a short text tail and substantial unused area; this is acceptable as terminal
  page underfill and must not be scored like a premature break.
- The selected plan scores about `92.26`; `glyph-overlap` is `0`, while
  `empty-regions` remains `-7.8`. No public glyph-collision suggestion is
  emitted for this fixture.
- The previous font-wide quote-mark box had reported intersections with
  main-flow character cells despite no obvious visible ink collision. With
  per-character TTF outline bounds, the fixture has no reported glyph/text
  intersection. A separate synthetic score fixture still verifies that a
  genuinely intersecting glyph is penalized and receives measured evidence
  and a movement proposal.
- A refinement candidate had been falsely rejected: `KEEP_CLUSTER_PUSHED`
  recorded a template-local slot id plus page, while the legality query looked
  only for the page-qualified slot id. Matching the decision against both
  representations prevents an intentional heading keep-cluster push from
  being treated as illegal leftover capacity. The end-to-end scenario verifies
  bounded candidates are evaluated; the engine-contract test verifies multiple
  successive positive improvements are followed from the best plan.
- Underfilled-flow diagnostics now name the next authored block and expose the
  measured usable lines and the threshold applied. If another candidate is
  rejected for this reason, the report distinguishes actual unused capacity
  from a heading keep-cluster push instead of suggesting a continuation-policy
  change.
- I inspected all five pages at overview scale and page 2 at 1,000 pixels. The
  quote marks appear visually separated from text. The last page remains
  intentionally sparse as a terminal-page tail.
- The corrected template does not report the earlier excessive
  chrome-to-content gap in this scenario. A separate deliberately excessive
  header-gap fixture still verifies that the public report names the template
  and both measured boxes when that violation is present.
- Hard diagnostic codes emitted by the evaluator are now all covered by the
  catalogue. Bounds and collision diagnostics retain the factual box,
  interval and tolerance evidence needed by the public report; missing target,
  measurement, content-order and policy failures receive explicit reasons and
  remedies without changing their existing code or severity.
- The comparison template is legal but scores substantially worse. This
  verifies candidate comparison, not that the selected result is aesthetically
  acceptable.

## Latest executable verification

After replacing synthetic numbered tokens with natural deterministic Lorem
Ipsum, the fixture generator now gives paragraph and quote blocks explicit
sentence boundaries while preserving their exact word counts. The
renderer-neutral engine test passes in about 41 seconds with
`REPORT_BABY_FULL_PIXEL_QA` unset. Its movement, insertion, obstacle and
continuation fixtures now assert authored-word preservation and semantic
geometry rather than depending on token suffixes. The optional raster and
selectable-text branch remains available with
`REPORT_BABY_FULL_PIXEL_QA=1`; it is intentionally excluded from the routine
composition gate. The rebuilt MCP and CLI bundles were checked by the public
MCP, CLI, chrome, dynamic-insertion and editorial-parity contracts.
The elevated `npm run test:quality` harness also passed all 15 checks (the
suite took about 213 seconds, mostly in brand-showcase and image validation).

## Conclusion

The current slice measures and exposes useful quality evidence, the
distribution scorer treats identical geometry consistently regardless of who
selected the placement, and the TTF quote marks no longer receive a false
glyph-overlap penalty. The complete composition matrix passed 19 checks in
about 236 seconds, the quality harness passed 15 checks in about 213 seconds,
and the enriched diagnostics, score attribution, repair proposals and trace
survived the public CLI/MCP contracts. One representative PDF was inspected;
routine quality checks do not rasterize every synthetic fixture. Items 08–10
are therefore complete for this implementation checkpoint.
