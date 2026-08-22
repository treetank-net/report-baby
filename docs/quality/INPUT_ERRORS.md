# Input error contract

This is the G2.3 flip inventory. The new contract rejects these shapes before
rendering and reports the offending path. The previous behavior is recorded so
the stricter boundary is an intentional release change, not an accidental
renderer change.

| Case | Input shape | Previous behavior | New behavior |
| --- | --- | --- | --- |
| `deck-missing-slides` | deck without `slides` | rejected by a generic deck check | reject at `slides`, expected array |
| `deck-slides-object` | `slides` object | rejected by a generic deck check | reject at `slides`, expected array |
| `deck-invalid-discriminator` | slide `type: "titel"` | rejected as unsupported slide type | reject at `slides.0.type`, expected supported discriminator |
| `deck-title-wrong-type` | title slide with numeric `title` | rejected as missing a string title | reject at `slides.0.title`, expected string |
| `deck-metrics-empty` | metrics slide with no cards | rejected by a handwritten card-count check | reject at `slides.0.metrics`, expected 1–6 cards |
| `deck-columns-three` | columns slide with three columns | rejected by a handwritten two-column check | reject at `slides.0.columns`, expected exactly two |
| `deck-metrics-value-object` | metric value is an object | rejected as an invalid card | reject at `slides.0.metrics.0.value`, expected string or number |
| `report-kpis-object` | `kpis` object instead of array | renderer could fail while iterating the value | reject at `kpis`, expected array |
| `report-chart-data-empty` | chart with empty `data` | renderer accepted an empty chart and produced an uninformative graphic | reject at `charts.0.data`, expected at least one datum |
| `report-chart-type-typo` | chart type `column` | renderer fell back to the bar chart branch | reject at `charts.0.type`, expected `bar`, `line`, or `pie` |
| `report-table-head-missing` | table without `head` | renderer failed later while constructing the table | reject at `table.head`, expected string array |
| `report-section-level-invalid` | section level `3` | renderer treated it as a level-one section | reject at `sections.0.level`, expected `1` or `2` |

The corpus and executable gate live in
[`input-error-corpus.json`](./input-error-corpus.json) and
[`server/scripts/test-input-errors.mjs`](../../server/scripts/test-input-errors.mjs).
