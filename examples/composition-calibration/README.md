# Article composition calibration corpus

Six offline cases reproduce approximate paragraph and heading lengths observed
in four public trans.info articles. Source prose and photographs are not copied:
body text is deterministic Lorem Ipsum and the three SVG diagrams are original
synthetic assets. This exercises geometry and typography; it does not reproduce
language-specific word widths, hyphenation, source semantics, or factual charts.

## Run and inspect

From `server/`:

```sh
npm run score:corpus
npm run score:corpus -- /tmp/report-baby-article-calibration truck-long-sparse
```

The default output is `server/qa/composition-calibration/` (ignored by Git).
Open `index.html` for PDF and complete geometry/scoring links.
`calibration-report.json` reports legality, page count, exact score components,
reward ceilings, search cost, rendered line-ink checks and caption baseline
checks against the planned caption rectangles. Both fonts and
palettes are loaded from the existing Parcelia and Flux showcase brands.

The production mode uses the coarse estimator, projected macro shortlist and
bounded exact refinement. The `legacy` mode is a **baseline-only comparator**:
one exact candidate and no refinement. It demonstrates initial seed behavior;
it does not establish superiority over an exhaustive legacy search or measure
like-for-like runtime. Every production case must have a complete legal plan.
Rejected legacy candidates are reported and have no rendered PDF.

| Case | Main words | Brand / font | Quotes | Original graphics |
|---|---:|---|---:|---|
| fleet-short-text | 212 | Parcelia / Liberation Sans | 0 | none |
| warehouse-short-dense | 358 | Parcelia / Liberation Sans | 5 | none |
| shipping-medium-wide | 833 | Parcelia / Liberation Sans | 2 | route comparison in main flow |
| truck-long-sparse | 1650 | Parcelia / Liberation Sans | 2 | wide truck illustration as insertion |
| truck-long-mixed | 1650 | Flux / DejaVu Sans Mono | 3 | wide route and narrow warehouse insertions |
| shipping-medium-mixed | 1245 | Flux / DejaVu Sans Mono | 2 | narrow warehouse diagram in main flow |

Widths are relative to the owning slot. A full-width main-flow image occupies
its column; a full-width insertion occupies the declared reusable pool frame.
The reusable pools inherit template capacity and policy, with no authored
block-to-page coordinates. Layout budgets and QA thresholds come from
`server/templates/render-config.yml`.

## Source provenance

The manifest records approximate visible block word counts and scenario scaling.
These articles supply structural variety:

- [Electric truck exhibition review](https://trans.info/pl/walka-gigantow-o-przyszlosc-transportu-ciezkiego-503190).
- [Warehouse opening](https://trans.info/en/maersk-german-logistics-hub-505609).
- [Fleet procurement](https://trans.info/en/fedex-uk-truck-order-505972).
- [Shipping route analysis](https://trans.info/en/arctic-shipping-not-cheap-505386).

The route diagram has no geographic data; the warehouse diagram depicts an
illustrative receive/store/dispatch sequence. They are calibration artwork.

## Preference calibration

The user's accepted fifth-page tail remains a separate reference in
`test-composition-quality-e2e.mjs`. Natural final fragments must not receive a
density-only penalty. New corpus cases retain `visualPreference: pending-review`.
A higher score or a successful ink check does not establish aesthetic quality.

Initial visual inspection finds that the warehouse case carries two quotes on
a second page without main text. Five quotes exceed the inherited three-instance
capacity on one page; this is an observable capability/continuity conflict,
not evidence that an empty main page should always be penalized. The mixed Flux
case exposes caption spacing and a natural short final paragraph. Caption
measurement and drawing now share the configured font, size and requested
image width. A height-constrained contain image can be narrower than its
caption frame; wrapping reserves their combined horizontal extent. It also
revealed a duplicate proximity subject: an atomic insertion was compared with
its own enclosing graphic. That self-pair has been removed while preserving
genuine neighbor comparisons. Keep
those observations separate when collecting preferences.

For each reviewed pair, record the preferred PDF, the geometry being judged,
acceptable exceptions, and the score component that should explain the choice.
Keep body coverage and legality fixed while testing one deviation: clustered
insertions, uneven visual mass, deficient local gaps, or a break through a
protected heading/paragraph region. Calibrate on reviewed pairs, then check
held-out lengths, assets and fonts before increasing the corpus's accepted
reference set. Do not label preferences from the score being calibrated.
