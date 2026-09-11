# Release 1.2 candidate — full chrome visual calibration

Status: Release 1.2 candidate; not yet an approved implementation task.

## Rationale

Release 1.0 provides dynamic-chrome mechanics, and Release 1.1 completes the
automatic lockup and fallback-removal contract. Only then can appearance be
calibrated across the full set of brands and templates without mixing mechanism
changes with visual assessment.

## Potential scope

- calibrating padding, gaps, and fit-content heights for header, lockup, and
  footer;
- comparing several title lengths, brand names, and lockup descriptions;
- evaluating empty, single-line, and multi-line chrome;
- stable acceptance thresholds for the plan, PDF, and representative raster;
- updating baselines only after manual acceptance of changes.

## Entry conditions

- the template schedule and ordinary slots have replaced `continuation_*`;
- the lockup is materialised from the brand profile;
- the legacy renderer fallback has a per-template decision or has been removed;
- paint-order and test-cost changes are not introduced into the same baseline at
  the same time.

## Out of scope for this candidate

- changing flow routing;
- a global geometry solver;
- redefining `continuation`;
- adding new content types.

## Implementation sketch if promoted

### What exists today

- Dynamic chrome is exercised by `server/scripts/test-report-chrome.mjs`,
  `test-editorial-parity.mjs`, and `test-editorial-visual-gate.mjs`; the
  accepted editorial baseline is recorded in
  `docs/quality/editorial-baseline.json`.
- Template geometry and fit-content rules are YAML-backed in
  `server/templates/pages/editorial-*/template.yml` and
  `server/templates/render-config.yml`; the adapter projects them into
  `CompositionPageChrome`, spacing reports, and plan slots.
- The current visual checks use representative PDF/PNG evidence. They are not
  a pixel baseline for every brand, and this task must not create one.

### Changes required

1. Freeze the dynamic-chrome and lockup mechanisms from items 03 and 08–10;
   otherwise a visual change cannot be attributed to calibration.
2. Build a small matrix from the existing editorial templates: no title,
   one-line title, multi-line title, short/long brand name, optional lockup
   description, empty/single/multi-line footer, and first/repeated page.
3. Record measured header/content/footer boxes and gaps from the plan before
   rendering. Keep all padding, gap, minimum-height, and threshold values in
   `server/templates/render-config.yml` and consume them through
   `adapters/render-config.ts`.
4. Add one human-reviewed brand showcase artifact and update
   `editorial-baseline.json` only after plan assertions and visual acceptance
   agree. Do not rasterise every matrix case in the release gate.
5. Add regression assertions for the selected geometry and a compact visual
   smoke test. Keep the candidate separate from 1.1 until a product decision
   promotes it.

### Resulting ownership

Templates and YAML own tunable values; composition observability owns measured
boxes; evaluator owns threshold findings; the visual gate owns the single
representative artifact. No new chrome entity or alternate flow is introduced.
