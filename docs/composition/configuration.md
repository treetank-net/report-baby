# Composition configuration contract

This document explains the configuration groups that are part of the
composition contract. The documentation-contract test checks every leaf field
in `quality`, `composition_score`, and `composition_search` against this
document and the other canonical documents in this directory. Adding a field
to one of those groups without documenting its meaning and interactions fails
the quality suite.

The values remain in
[`render-config.yml`](../../server/templates/render-config.yml). This file
explains what they mean; it is not a second source of numeric values.

## `quality`

These settings define artifact inspection and composition-quality measurement.
They do not turn a visual preference into a hard evaluator rejection.

### Direct fields

| Field | Meaning and interactions |
|---|---|
| `quality.pptx_text_region_max_changed_pixel_ratio` | Maximum changed-pixel ratio allowed when checking a PPTX text region. It interacts with the PPTX visual-QA renderer and is independent of PDF composition score. |
| `quality.composition_nonwhite_min_ratio` | Minimum non-white ink ratio required in a composition inspection region. It interacts with the selected region geometry and the PDF/raster inspection, not with candidate ranking. |

### `quality.layout_diff`

| Field | Meaning and interactions |
|---|---|
| `quality.layout_diff.movement_warn_mm` | Movement at or above this distance produces a warning in layout comparison. It is lower than the error threshold and does not reject a composition plan. |
| `quality.layout_diff.movement_error_mm` | Movement at or above this distance produces an error in layout comparison. It interacts with `movement_warn_mm` and the inspected anchor geometry. |
| `quality.layout_diff.lane_origin_tolerance_mm` | Allowed lane-origin movement before a comparison reports a lane change. It interacts with column/flow lane identification. |
| `quality.layout_diff.line_gap_warn_mm` | Gap between neighbouring inspected lines that produces a spacing warning. It interacts with `line_gap_severe_mm` and the maximum finding count. |
| `quality.layout_diff.line_gap_severe_mm` | Gap that escalates a spacing finding to severe. It must not be lower than `line_gap_warn_mm`. |
| `quality.layout_diff.page_edge_ratio` | Fraction of a page edge used to classify an edge-adjacent movement. It interacts with page dimensions and crop/edge inspection. |
| `quality.layout_diff.max_spacing_findings` | Maximum number of spacing findings retained in a report. It limits diagnostics, not the planner’s search space. |
| `quality.layout_diff.anchor_token_count` | Number of text tokens used to identify an anchor between compared artifacts. It interacts with text extraction quality and movement measurements. |
| `quality.layout_diff.column_count` | Expected number of columns for column-aware comparison. It interacts with lane origins, fill measurements, and column balance reporting. |
| `quality.layout_diff.column_span_exclusion_factor` | Factor used to exclude wide, spanning content from ordinary column-fill comparisons. It interacts with `column_count` and span geometry. |
| `quality.layout_diff.column_fill_warn_ratio` | Fill ratio below which a column comparison warns. It interacts with `column_count` and spanning-content exclusion. |
| `quality.layout_diff.column_ink_balance_warn_ratio` | Lowest acceptable relative ink balance between compared columns before warning. It interacts with `column_count` and the raster ink profile. |

### `quality.report_image_*`

| Field | Meaning and interactions |
|---|---|
| `quality.report_image_min_red_pixel_ratio` | Minimum red-channel dominance expected for the report image contract. It interacts with the red/green/blue channel bounds. |
| `quality.report_image_max_dark_pixel_ratio` | Maximum dark-pixel ratio allowed in the expected report-image region. It interacts with `report_image_dark_channel_max`. |
| `quality.report_image_red_channel_min` | Minimum normalized red-channel value for a qualifying pixel. It interacts with the green and blue upper bounds. |
| `quality.report_image_green_channel_max` | Maximum normalized green-channel value for a qualifying pixel. It interacts with `report_image_red_channel_min` and `report_image_blue_channel_max`. |
| `quality.report_image_blue_channel_max` | Maximum normalized blue-channel value for a qualifying pixel. It interacts with the other channel thresholds to distinguish the intended image treatment. |
| `quality.report_image_dark_channel_max` | Channel ceiling used to classify a pixel as dark for image inspection. It interacts with `report_image_max_dark_pixel_ratio`. |
| `quality.report_image_geometry_tolerance` | Geometry tolerance used when checking the expected report-image bounds. It is a comparison tolerance, not permission for composition geometry to leave its slot. |

### `quality.pdf_pixel_qa`

| Field | Meaning and interactions |
|---|---|
| `quality.pdf_pixel_qa.raster_dpi` | Rasterization resolution for PDF pixel inspection. It changes sampling density and therefore interacts with pixel-count thresholds. |
| `quality.pdf_pixel_qa.background_delta_min` | Minimum pixel-channel delta from the background for classifying ink. It interacts with raster DPI and `minimum_ink_pixels`. |
| `quality.pdf_pixel_qa.minimum_ink_pixels` | Minimum qualifying ink pixels required in an inspected region. It interacts with raster DPI, background delta, and the region size. |
| `quality.pdf_pixel_qa.rectangle_inset_px` | Inset used to keep debug/QA rectangle strokes away from the sampled boundary. It interacts with raster DPI and rectangle geometry. |
| `quality.pdf_pixel_qa.placement_tolerance_mm` | Visual-QA tolerance when comparing rendered placement with planned placement. It is not evaluator containment tolerance and does not make an illegal plan legal. |
| `quality.pdf_pixel_qa.caption_vertical_balance_tolerance_mm` | Allowed vertical imbalance in caption inspection. It interacts with caption geometry and is a visual-QA threshold, not a score component. |

## `composition_score`

These values rank plans that have already passed the hard legality gate. They
are deliberately heuristic and are not universal typography rules. The score
is additive, so changing a weight changes the relative influence of that
component while the evaluator still rejects any hard violation.

| Field | Meaning and interactions |
|---|---|
| `composition_score.base` | Starting score for every legal plan. It keeps ordinary scores readable and has no effect on ordering when unchanged for every candidate. |
| `composition_score.column_balance_weight` | Multiplier for the column-balance component. It interacts with `column_count` and the number of lines measured per column. |
| `composition_score.column_count` | Number of columns included in balance scoring. It interacts with the actual page slots and `column_balance_weight`. |
| `composition_score.heading_following_line_bonus` | Bonus for keeping usable text after a heading in the same placement. It interacts with heading detection and fragmentation, but cannot rescue an illegal placement. |
| `composition_score.paragraph_fragmentation_penalty` | Penalty per paragraph split across pages or slots. It interacts with the candidate’s reflow result and source block boundaries. |
| `composition_score.orphan_max_fragment_lines` | Largest fragment size considered an orphan by the soft-quality heuristic. It interacts with `orphan_min_gap_mm` and `orphan_penalty`; it is not a hard orphan rejection. |
| `composition_score.orphan_min_gap_mm` | Minimum obstacle-separated gap that makes a small fragment count as an orphan for scoring. It interacts with measured geometry and `orphan_max_fragment_lines`. |
| `composition_score.orphan_penalty` | Penalty for each scored orphan fragment. It interacts with the orphan thresholds and candidate reflow. |
| `composition_score.insertion_internal_spacing_penalty` | Weight for uneven spacing inside an insertion. It interacts with insertion content height and the two padding edges. |
| `composition_score.insertion_external_spacing_penalty` | Weight for the gap between an insertion and surrounding main-flow content. It interacts with preceding/following line geometry. |
| `composition_score.insertion_cross_stream_spacing_penalty` | Weight for unequal gaps between insertion streams or columns. It interacts with same-page stream geometry and the other insertion-spacing weights. |

## `composition_search`

These values control how many legal movable-insertion variants are explored.
They affect runtime and the set of alternatives presented to the evaluator;
they do not change the hard legality rules.

| Field | Meaning and interactions |
|---|---|
| `composition_search.movable_quote_window_ratio` | Relative vertical movement window around a quote’s preferred position. It interacts with page height and candidate count. |
| `composition_search.movable_quote_candidate_count` | Number of coarse positions sampled in the movement window. It interacts with the window ratio and evaluator score. |
| `composition_search.movable_quote_refinement_rounds` | Number of local refinement passes after coarse candidates are evaluated. It interacts with refinement candidate count and deterministic candidate ordering. |
| `composition_search.movable_quote_refinement_candidate_count` | Number of local positions sampled during each refinement pass. It interacts with refinement rounds and geometry tolerance used to compare positions. |

## PDF values that implement composition rules

The entire `pdf` group also contains renderer typography and template geometry,
so it is not treated as one evaluator group. These particular fields are
explicitly tied to the composition contract:

| Field | Meaning and interactions |
|---|---|
| `pdf.planner_max_iterations` | Upper bound for planner/reflow passes. It limits recovery work; it does not make an unresolved illegal plan legal. |
| `pdf.planner_minimum_fragment_lines` | Default minimum useful fragment size copied into the plan and used by underfilled-slot checks. It interacts with obstacle availability and planner decisions. |
| `pdf.composition_geometry_tolerance` | Planning/search tolerance for comparing candidate geometry. It is separate from the evaluator’s machine-precision containment guard and visual-QA tolerance. |
| `pdf.composition_max_pages` | Maximum number of composition pages accepted by the report renderer. It interacts with page-limit validation after composition. |
| `pdf.plan_coverage_max_gap` | Maximum allowed coverage gap in the report-plan contract. It interacts with dynamic-flow coverage checks before final PDF rendering. |

## Hard-rule source

Hard rules are not configuration fields. Their canonical list is the
`error('CODE', ...)` call sites in
[`composition/evaluator.ts`](../../server/src/composition/evaluator.ts) and
is documented in [evaluator.md](evaluator.md). The documentation-contract test
extracts those codes and fails if a newly added hard rule is not added to that
catalog. Numeric policy values that influence hard checks are listed above;
geometry containment still uses machine precision, while minimum-fragment and
page/coverage limits come from the `pdf` configuration seam.
