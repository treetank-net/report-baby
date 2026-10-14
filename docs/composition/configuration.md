# Composition configuration contract

This document explains the configuration groups that are part of the
composition contract. The documentation-contract test checks every leaf field
in `quality`, `composition_score`, `composition_search`, and `contrast` against this
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

### `quality.test_feedback`

| Field | Meaning and interactions |
|---|---|
| `quality.test_feedback.smoke_budget_ms` | Maximum configured duration for the fast smoke gate, including its build and checks. The harness reports an over-budget result as a failed gate. |
| `quality.test_feedback.release_budget_ms` | Maximum configured duration for a multi-suite or full release gate. It is a feedback policy, not a planner or evaluator threshold. |
| `quality.test_feedback.check_warning_ms` | Duration after which one harness check is reported as slow. It does not fail the check by itself; it identifies candidates for fixture or bundle reuse. |

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
component while the evaluator still rejects genuine structural violations.

| Field | Meaning and interactions |
|---|---|
| `composition_score.base` | Starting score for every legal plan. It keeps ordinary scores readable and has no effect on ordering when unchanged for every candidate. |
| `composition_score.column_balance_weight` | Multiplier for the column-balance component. It interacts with `column_count` and measured line counts; the natural terminal page of a multipage flow is excluded. |
| `composition_score.column_count` | Number of columns included in balance scoring. It interacts with the actual page slots and `column_balance_weight`. |
| `composition_score.heading_following_line_bonus` | Bonus for keeping usable text after a heading in the same placement. It interacts with heading detection and fragmentation, but cannot rescue an illegal placement. |
| `composition_score.paragraph_fragmentation_penalty` | Penalty per paragraph split associated with a wrap obstacle intersecting its measured line envelope. Natural page/column continuations are reported separately without this cost; association does not prove that a split is avoidable. |
| `composition_score.list_item_fragmentation_penalty` | Penalty per list item split across pages or slots. It interacts with list-item source boundaries and the keep-together planner policy. |
| `composition_score.list_split_penalty` | Penalty for a list run that continues onto another page. It interacts with list continuity detection and is separate from per-item fragmentation. |
| `composition_score.list_column_split_penalty` | Penalty when one list run crosses columns on the same page. It interacts with column geometry and list continuity; it does not reject the plan. |
| `composition_score.table_split_penalty` | Penalty when one table is fragmented across pages or slots. It interacts with table row placement and table continuity detection. |
| `composition_score.table_column_split_penalty` | Penalty when a table crosses columns on one page. It interacts with table geometry and is distinct from a page split. |
| `composition_score.table_widow_min_rows` | Minimum number of rows expected in a table fragment. It interacts with `table_widow_penalty` and marks smaller terminal fragments as a soft quality issue. |
| `composition_score.table_widow_penalty` | Penalty for a table fragment below `table_widow_min_rows`. It changes ranking only; hard row/slot legality remains the planner’s responsibility. |
| `composition_score.tiny_fragment_max_lines` | Maximum line count for a text fragment considered tiny. It interacts with `tiny_fragment_penalty` and source-order fragment detection. |
| `composition_score.tiny_fragment_penalty` | Penalty for each tiny text fragment. It is a soft quality signal and cannot make an otherwise legal plan illegal. |
| `composition_score.orphan_max_fragment_lines` | Largest fragment size considered an orphan by the soft-quality heuristic. It interacts with `orphan_min_gap_mm` and `orphan_penalty`; it is not a hard orphan rejection. |
| `composition_score.orphan_min_gap_mm` | Minimum obstacle-separated gap that makes a small fragment count as an orphan for scoring. It interacts with measured geometry and `orphan_max_fragment_lines`. |
| `composition_score.orphan_penalty` | Penalty for each scored orphan fragment. It interacts with the orphan thresholds and candidate reflow. |
| `composition_score.insertion_internal_spacing_penalty` | Weight for uneven spacing inside an insertion. It interacts with insertion content height and the two padding edges. |
| `composition_score.insertion_external_spacing_penalty` | Weight for the gap between an insertion and surrounding main-flow content. It interacts with preceding/following line geometry. |
| `composition_score.insertion_cross_stream_spacing_penalty` | Weight for unequal gaps between insertion streams or columns. It interacts with same-page stream geometry and the other insertion-spacing weights. |
| `composition_score.insertion_text_continuity_min_mass_ratio` | Minimum normalized text mass on one side of a distributed insertion that counts as usable adjacency. It prevents a single residual line from being treated as a filled stream. The component is evaluated only for explicit `spread-through-content` or `spread-across-pages` policies. |
| `composition_score.insertion_text_continuity_coverage_penalty` | Penalty for a distributed insertion that leaves one or more overlapping text streams without usable text on both sides. It favors candidates that let every affected column continue above and below the insertion. |
| `composition_score.insertion_text_continuity_mass_penalty` | Penalty for unequal aggregate text mass above and below a distributed insertion. It keeps a visually heavy obstacle from creating a lopsided text envelope. |
| `composition_score.insertion_text_continuity_cross_stream_penalty` | Penalty for unequal total text mass between the columns crossed by one distributed insertion. It favors comparable text participation in each affected stream. |
| `composition_score.insertion_text_continuity_edge_gap_penalty` | Penalty for normalized missing breathing room when a distributed insertion has usable text immediately above and below it. A zero measured edge remains visible in the report and is scored here without duplicating the legacy positive-gap asymmetry penalty. |
| `composition_score.insertion_text_continuity_visual_load_weight` | Multiplier for the insertion's measured visual load when converting distributed-continuity deficits into points. Larger placements therefore need stronger continuity evidence. |
| `composition_score.insertion_text_continuity_reward` | Maximum averaged reward for distributed insertions with usable text on both sides, balanced measured mass and profile-compatible edge gaps. Measured zero text on an insertion-only page remains coverage-deficit evidence when the document contains main text; missing stream measurements are omitted. Fixed/free dedicated pages do not acquire this distribution rule. |
| `composition_score.insertion_text_continuity_balance_tolerance` | Positive normalized tolerance, at most one, for aggregate and cross-stream mass imbalance when calculating the continuity reward. Existing continuity penalties remain separately reported. |
| `composition_score.header_content_gap_min_mm` | Minimum preferred gap, in millimetres, between the measured bottom of repeated header content and the first ordinary content line. It produces a soft score deficit when a legal plan leaves less room. |
| `composition_score.header_content_gap_penalty` | Penalty multiplier applied to the header/content gap deficit. It changes candidate ranking only; slot containment and overlap remain hard planner checks. |
| `composition_score.empty_region_ratio_threshold` | Maximum unexplained empty-area ratio before a material region contributes a soft penalty. It interacts with `empty_region_height_threshold_mm` and `empty_region_penalty`. |
| `composition_score.empty_region_height_threshold_mm` | Minimum unexplained vertical gap considered material for empty-region scoring. It prevents tiny rounding gaps from affecting ranking. |
| `composition_score.empty_region_penalty` | Penalty multiplier for empty-region excess above the configured ratio threshold. |
| `composition_score.column_imbalance_threshold` | Maximum relative height difference between sibling main columns before a soft penalty is applied. |
| `composition_score.column_imbalance_penalty` | Penalty multiplier for sibling-column imbalance above its threshold. |
| `composition_score.insertion_symmetry_tolerance_mm` | Allowed absolute difference between insertion before/after text gaps before a soft asymmetry penalty. |
| `composition_score.insertion_symmetry_penalty` | Penalty multiplier for insertion text-gap asymmetry above tolerance. |
| `composition_score.insertion_symmetry_reward` | Maximum bounded reward for symmetric measured text gaps around insertions. It is averaged over available observations and does not replace the out-of-tolerance penalty. |
| `composition_score.insertion_distribution_tolerance_mm` | Allowed mean absolute dispersion among insertion outer and neighbour gaps. |
| `composition_score.insertion_distribution_penalty` | Penalty multiplier for insertion-group distribution dispersion above tolerance. |
| `composition_score.insertion_distribution_reward` | Maximum bounded reward for evenly distributed insertion gaps, averaged over measured page-region groups. |
| `composition_score.content_spread_tolerance` | Normalized tolerance for the difference between authored insertion order and measured main-flow progress. |
| `composition_score.content_spread_penalty` | Penalty multiplier for content-spread deviation above the configured tolerance. |
| `composition_score.content_spread_reward` | Maximum bounded reward for insertions that align with measured main-flow progress, including a single insertion. An omitted rhythm group defaults to the owning flow. Targets use measured relative visual load without flooring loads to one; unmeasured main progress earns no reward. The current 60-point cap preserves the reference distribution preference against local footer/continuity penalties; it requires broader visual calibration. |
| `composition_score.page_load_balance_tolerance` | Allowed normalized visual-load imbalance between eligible pages in a spread-across-pages group. |
| `composition_score.page_load_balance_penalty` | Penalty multiplier for page visual-load imbalance above tolerance. |
| `composition_score.page_load_balance_reward` | Maximum bounded reward for balanced visual load across eligible pages, averaged over measured groups. |
| `composition_score.main_page_occupancy_target` | Target occupied-height ratio for interior main-flow pages. This uses exact planned line envelopes as a renderer-neutral ink proxy. |
| `composition_score.main_page_occupancy_tolerance` | Absolute ratio deviation from `main_page_occupancy_target` that earns the full bounded reward. Beyond this interval the reward fades over one further tolerance span. |
| `composition_score.main_page_occupancy_reward` | Maximum reward for interior main-flow pages whose measured occupancy approaches the configured target. First and terminal pages are excluded from this reward because their natural content mass differs. |
| `composition_score.visual_load_area_weight` | Weight of insertion area share in the renderer-neutral visual-load estimate. |
| `composition_score.visual_load_vertical_weight` | Weight of insertion vertical-span share in the renderer-neutral visual-load estimate. |
| `composition_score.visual_load_text_weight` | Weight of the main-flow line share affected by an insertion in the visual-load estimate. |
| `composition_score.source_relation_preference_penalty` | Penalty for a soft `prefer-same-page` source relation when the source page is known and differs from the insertion page. |
| `composition_score.spacing_profile_compact_target_mm` | Reference gap used by the compact spacing profile, including as a soft clearance in the coarse rectangle projection. |
| `composition_score.spacing_profile_normal_target_mm` | Reference gap used by the normal spacing profile and the default when no profile is declared, including as a soft clearance in the coarse rectangle projection. |
| `composition_score.spacing_profile_open_target_mm` | Reference gap used by the open spacing profile, including as a soft clearance in the coarse rectangle projection. |
| `composition_score.spacing_profile_tolerance_mm` | Allowed deviation from a resolved spacing-profile target before a soft penalty. |
| `composition_score.spacing_profile_penalty` | Penalty multiplier for spacing-profile deviation above tolerance. |
| `composition_score.spacing_profile_reward` | Maximum bounded reward for measured text-to-insertion gaps that fit their resolved spacing-profile targets. It is averaged over available gaps and does not replace the out-of-tolerance penalty. |
| `composition_score.narrow_text_interval_min_mm` | Minimum usable text interval beside a wrapped insertion. It interacts with `narrow_text_interval_penalty`. |
| `composition_score.narrow_text_interval_penalty` | Penalty multiplier for each narrow interval deficit. |
| `composition_score.fit_content_unused_ratio_threshold` | Maximum unused fraction of a fit-content growth envelope before a soft penalty. |
| `composition_score.fit_content_unused_penalty` | Penalty multiplier for unused fit-content envelope excess. |
| `composition_score.footer_content_gap_min_mm` | Minimum preferred distance from ordinary content to the resolved footer boundary. |
| `composition_score.footer_content_gap_penalty` | Penalty multiplier for footer/content gap deficits. |
| `composition_score.element_proximity_move_budget_mm` | Maximum distance the planner may propose for a local movement repair around a proximity conflict. It bounds repair candidates; it does not mutate a fixed placement. |
| `composition_score.element_proximity_penalty` | Penalty multiplier for measured proximity deficits between material elements. It contributes to the total plan score together with the per-placement attribution. |
| `composition_score.element_proximity_reward` | Maximum averaged reward for measured adjacent box pairs whose signed gap fits the resolved profile target within `spacing_profile_tolerance_mm`. Evidence includes both subjects, boxes, gap, target, adjacency and movement capability. Nonadjacent pairs do not earn this local reward; below-minimum deficits still contribute penalties. |
| `composition_score.glyph_overlap_min_area_mm2` | Minimum intersecting glyph area that counts as a visible overlap. It filters numerical noise before applying `glyph_overlap_penalty`. |
| `composition_score.glyph_overlap_penalty` | Penalty multiplier for each measured glyph overlap above `glyph_overlap_min_area_mm2`; the evaluator also reports the affected glyph boxes and measured area. |
| `composition_score.contrast_penalty` | Maximum normalized penalty for measured text contrast across the complete corpus, including the supplied page background and variable graphic backgrounds. It interacts with normalized contrast quality and is part of the general plan score, not a separate legality gate. |
| `composition_score.contrast_mean_quality_weight` | Weight for diffuse contrast quality across sampled glyphs. It interacts with the worst-point and affected-glyph terms; the three weights should normally sum to 1. |
| `composition_score.contrast_worst_glyph_weight` | Weight that keeps one glyph with a severely affected sampled point visible in the score even when the document contains thousands of good glyphs. Despite the historical field name, it applies to the worst sampled point. It is continuous, not a rejection rule. |
| `composition_score.contrast_affected_glyph_weight` | Weight for the breadth of severe contrast damage. It interacts with `contrast_severe_ratio` and `contrast_affected_glyph_saturation`. |
| `composition_score.contrast_severe_ratio` | Raw contrast-ratio boundary below which a glyph's worst sampled point counts as severely affected. It is a scoring threshold, not a hard rule. |
| `composition_score.contrast_affected_glyph_saturation` | Number of severely affected glyphs used as the breadth curve's scale; at this count the curve's input is `1`, before applying `contrast_quality_response`. It makes one affected glyph visible while still distinguishing broader damage. |
| `composition_score.contrast_quality_response` | Positive response parameter for the asymptotic contrast-quality curve `x / (x + response)`. Lower values approach full quality faster; the curve never reaches 1 for finite contrast. It also controls the saturation curve for affected-glyph breadth. |

Geometric target-fit rewards earn full credit throughout their configured
tolerance interval. Outside it, credit fades over one further tolerance span;
existing excess penalties remain independently visible. Rewards are averaged
and capped per component, so the number of pages, pairs or insertions does not
multiply the reward. Missing evidence earns no credit. The rewarded distribution,
continuity, symmetry and spacing components can still contain a measured
deficit: normal suggestions retain that evidence and `passedMetrics` does not
classify them as fully passed.

These scores inspect exact geometry, not agreement with the coarse seed alone.
Heading keep rules and natural terminal-page whitespace remain governed by
their existing planner and evaluator policies. No universal page-count penalty
or exact-symmetry requirement is introduced.

## `contrast`

These values define the initial contrast-reading policy for the complete text
corpus. The asset adapter prepares each available raster once, and the
evaluator resolves the background at every Monte Carlo point from the page or
region color and any painted graphic under that point. They do not change line
breaking. Contrast is always a quality input, never a second pass/fail gate: a
weak measurement lowers the general score, while an unknown measurement is
retained as evidence and is neutral until a separate policy is calibrated.

The checked-in `body_minimum` default is `2.76`. This is an editorial,
brand-tolerant scoring target, not a claim that the rendered document conforms
to WCAG. A consumer that targets WCAG AA should configure the ordinary-text
target to `4.5` and use the large-text rule where applicable; a consumer that
targets the enhanced level should use the corresponding stricter values. The
contrast component remains continuous in every profile: changing the target
changes ranking pressure, while very low measured contrast still receives a
strong penalty through the worst-glyph and affected-glyph terms.

The raster here is an image-asset representation, not a rasterized copy of the
candidate PDF page. Page-space sample positions remain continuous. When a
sample falls on a graphic, the adapter maps that position to the corresponding
integer source-pixel index only to read the pixel color. The debug PDF is
rasterized later solely to produce a viewable PNG; those PNG pixels are not fed
back into the contrast evaluator.

| Field | Meaning and interactions |
|---|---|
| `contrast.body_minimum` | Reference ratio for ordinary text. The evaluator uses it as the upper anchor of the normalized contrast-quality curve; it does not independently reject a plan. |
| `contrast.large_minimum` | Minimum ratio for large text when a future text-size-aware contrast policy selects the large-text rule. It must remain distinct from `body_minimum`; the current first adapter slice uses the ordinary-text policy. |
| `contrast.large_text_px` | Text-size boundary used to classify large regular text. It interacts with `large_minimum` and the renderer's actual text-size units. |
| `contrast.large_bold_text_px` | Text-size boundary used to classify large bold text. It interacts with `large_minimum`, font weight, and the renderer's actual text-size units. |
| `contrast.sample_count` | Sampling budget for every non-whitespace glyph cell in the complete planned corpus. A cell is intentionally approximate: its width is the measured character advance and its height is the complete line height, not the painted ink outline. Coordinates are normalized around that cell's center, with `-1..1` on both axes, and remain continuous in page space. Each point resolves the background under the full cell: the explicitly supplied page background outside painted graphics and the mapped graphic pixel where a graphic is present. Mapping to a graphic pixel uses an integer raster index only for color lookup; it does not snap the page-space sample or the debug marker to a layout grid. The integer part is always sampled and the fractional part is a deterministic Bernoulli trial for one additional sample independently for each glyph, consuming one shared seeded random stream. The same corpus seed reproduces the same per-glyph sequence for every candidate, while neighbouring glyphs receive different offsets. When the renderer exposes a text color for a style, the cell uses that foreground rather than assuming one global body color; the provider option remains the fallback for renderer-neutral or legacy frames. Legacy line-box fallback uses the integer part as a grid size. It trades measurement cost against the chance of missing a small background patch; it is not a full-pixel verification. |

## `composition_search`

These values control how many legal movable-insertion variants are explored.
They affect runtime and the set of alternatives presented to the evaluator;
they do not change the hard legality rules.

The same policy shape can be supplied by a caller for authored graphics through
`movableGraphicBounds`. It is intentionally not a new YAML tuning group in
this slice: the planner receives the movement frame and candidate budget from
the composition request, while the render configuration continues to own only
global defaults. The graphic must expose a measured `size` when it is smaller
than its slot; otherwise there is no meaningful position to vary.

| Field | Meaning and interactions |
|---|---|
| `composition_search.coarse_geometry_first` | Enables the aggregate rectangle estimate and displacement projection for the production baseline. Set to `false` as a rollback to the bounded legacy candidate seed path while comparing or diagnosing a release. Exact legality and scoring remain authoritative in both modes. |
| `composition_search.coarse_page_prediction_error_tolerance_pages` | Maximum absolute whole-page difference accepted by the representative coarse-versus-exact terminal-page calibration fixture. The estimate and exact terminal page remain separately reported; this tolerance does not alter legality, page generation, or candidate selection. |
| `composition_search.coarse_assignment_beam_width` | Positive integer limiting retained partial insertion configurations across all flows before complete configurations enter projection comparison. The public coarse decision reports pruning; a bounded result is not a guarantee of global optimality. This search does not consume exact-plan evaluation budget. |
| `composition_search.coarse_assignment_progress_weight` | Nonnegative weight for deviation from the distribution policy's content/page targets; free and clustered policies retain route-order preference. Required coverage, total coverage and body-page preference take priority over this cost. |
| `composition_search.coarse_assignment_spacing_weight` | Nonnegative weight for normalized pairwise clearance deficits between horizontally overlapping insertions on the same page, including different flows. Targets come from the existing spacing profiles; exact legality remains authoritative. |
| `composition_search.coarse_assignment_page_load_weight` | Nonnegative weight for relative visual-load imbalance across eligible body pages in spread-across-pages groups. Estimated load uses body area and height; this seed cost is not added to the exact score. |
| `composition_search.coarse_projection_candidate_count` | Positive integer limiting complete configurations compared after independent cut/push projections. Every projection starts from the same unobstructed estimate; achieved progress and sensitive breaks rank the shortlist without another assignment loop. |
| `composition_search.coarse_exact_candidate_count` | Positive integer limiting projected macro seeds materialized for exact engine evaluation. Intersected with initial and full-plan budgets; the existing engine selects by exact total score. |
| `composition_search.coarse_assignment_break_penalty_weight` | Nonnegative seed-cost weight for newly introduced paragraph, edge and heading cuts predicted by projection. It uses existing score penalty magnitudes; seed cost is never added to exact score. |
| `composition_search.max_initial_candidates` | Maximum number of complete candidates produced by the initial bounded expansion. The seed remains first; the cap limits the combined insertion/graphic proposal product before evaluation. |
| `composition_search.max_refinement_rounds` | Maximum number of local refinement rounds after the initial candidates. It is intersected with per-placement refinement policy and cannot make an authored fixed placement movable. |
| `composition_search.max_candidates_per_refinement` | Maximum complete candidates retained from one refinement batch. It limits combined insertion/graphic alternatives while preserving deterministic generation order. |
| `composition_search.max_full_plan_recalculations` | Request-local budget for complete plan evaluations. Once exhausted, the engine stops with `calculation-budget` evidence and selects only candidates already planned and evaluated. |
| `composition_search.movable_window_ratio` | Relative vertical movement window around a quote’s preferred position. It interacts with page height and candidate count. |
| `composition_search.movable_candidate_count` | Number of coarse positions sampled in the movement window. It interacts with the window ratio and evaluator score. |
| `composition_search.movable_refinement_rounds` | Number of local refinement passes after coarse candidates are evaluated. It interacts with refinement candidate count and deterministic candidate ordering. |
| `composition_search.movable_refinement_candidate_count` | Number of local positions sampled during each refinement pass. It interacts with refinement rounds and geometry tolerance used to compare positions. |
| `composition_search.minimum_geometry_step_mm` | Smallest movement distance worth materializing as a refinement candidate. It prevents repeated sub-pixel reflows while allowing the evaluator to request bounded local repairs. |
| `composition_search.max_page_local_refinement_rounds` | Maximum page-scoped micro-optimization rounds for each page. Stage G applies these rounds in page order, but every candidate is still reflowed and evaluated as a complete document. A non-positive value disables page-local rounds explicitly; omitted caller policy defaults to one round. |
| `composition_search.gravity_iterations` | Iteration limit for the retained low-level gravity helper. The normal baseline path uses the coarse rectangle projection and does not run this helper. |
| `composition_search.gravity_damping` | Displacement fraction for the retained low-level gravity helper. The normal baseline path does not use it. |
| `composition_search.gravity_convergence_mm` | Convergence tolerance for the retained low-level gravity helper. The normal baseline path does not use it. |
| `composition_search.gravity_source_prefer_weight` | Source attraction weight for the retained low-level gravity helper. The normal baseline path does not use it. |
| `composition_search.gravity_source_require_weight` | Source attraction weight for the retained low-level gravity helper. Exact source-relation legality remains authoritative. |

## PDF values that implement composition rules

The entire `pdf` group also contains renderer typography and template geometry,
so it is not treated as one evaluator group. These particular fields are
explicitly tied to the composition contract:

| Field | Meaning and interactions |
|---|---|
| `pdf.planner_max_iterations` | Upper bound for planner/reflow passes. It limits recovery work; it does not make an unresolved illegal plan legal. |
| `pdf.heading_keep_with_next_lines` | Minimum following lines reserved with a heading by the planner. It interacts with heading detection, available slot height, and `minimumLinesAtStart`. |
| `pdf.widow_min_lines` | Minimum lines retained at the start of a continued text fragment. It interacts with slot capacity and `planner_minimum_fragment_lines`; it can cause a block to move or produce a hard planner diagnostic. |
| `pdf.orphan_min_lines` | Minimum lines retained at the end of a text fragment before continuing. It interacts with the next slot’s capacity and the planner’s fragment selection. It is distinct from `composition_score.orphan_max_fragment_lines`, which is a visual-quality heuristic. |
| `pdf.planner_minimum_fragment_lines` | Default minimum useful fragment size copied into the plan and used by underfilled-slot checks. It interacts with obstacle availability and planner decisions. |
| `pdf.composition_geometry_tolerance` | Planning/search tolerance for comparing candidate geometry. It is separate from the evaluator’s machine-precision containment guard and visual-QA tolerance. |
| `pdf.graphic_line_width` | Stroke width used by the jsPDF backend for authored geometry graphics. Fill and stroke colors come from the active theme; this value affects painting only, not planner geometry or score. |
| `pdf.list_item_keep_together` | Boolean-style switch controlling whether a list item is kept together when the first fragment would leave a hole. It interacts with `widow_min_lines` and local slot capacity. |
| `pdf.composition_max_pages` | Maximum number of composition pages accepted by the report renderer. It interacts with page-limit validation after composition. |
| `pdf.plan_coverage_max_gap` | Maximum allowed coverage gap in the report-plan contract. It interacts with dynamic-flow coverage checks before final PDF rendering. |

## Hard-rule source

Hard rules are not configuration fields. Their canonical list is the
`error('CODE', ...)` call sites in the evaluator and the
`diagnostic('error', 'CODE', ...)` call sites in the planner. Because the
evaluator carries planner diagnostics into the final evaluation, both sources
are part of the same hard gate. The documentation-contract test extracts both
sets of codes and fails if a newly added hard rule is not added to the catalog.
Numeric policy values that influence hard checks are listed above; geometry
containment still uses machine precision, while minimum-fragment and
page/coverage limits come from the `pdf` configuration seam.

## Responsibility boundaries

The configuration is intentionally consumed through different seams:

- `composition/evaluation/evaluator.ts` reads `composition_score` and evaluates the
  completed plan. Contrast measurements arrive through an injected provider;
  the evaluator does not decode image bytes. It does not read `quality`,
  `composition_search`, or PDF typography values directly.
- `composition/layout/text-planner.ts` does not read YAML. Its interface accepts a
  planner policy, which keeps the core planner independent of the renderer
  configuration and makes policy injection testable.
- `composition/adapters/text-engine.ts` is the adapter that translates `pdf`
  configuration into planner policy. The report entry point calls that adapter
  and forwards only explicit policy overrides; it does not maintain a second
  mapping of PDF fields. `composition/adapters/render-config.ts` translates
  renderer style configuration into text styles, measurements, and block
  capabilities. These are the intended seams for jsPDF and template-specific
  configuration.
- `quality` belongs to artifact inspection and visual QA. A quality threshold
  must not be used as evaluator permission to place an illegal plan.
- `contrast` belongs to the asset-adapter/evaluator seam. The adapter owns
  decoding and crop mapping; the evaluator owns diagnostics and score
  interpretation. The planner remains unaware of pixels.
- `pdf.composition_max_pages` and `pdf.plan_coverage_max_gap` are outer
  renderer/report-plan gates. They are not score terms and are not evaluated by
  `composition/evaluation/evaluator.ts`.
- `composition_search` supplies global candidate and refinement budgets through
  the render-config adapter. The planner still receives a typed policy and does
  not read YAML directly. Stage G's page-local scope is an engine/planner
  contract, while this group owns only its bounded round budget.

The architecture check protects import cycles and broad layer violations. This
documentation test protects the semantic side of the seam: when a policy
field or hard rule is added, its owner and interactions must be described here
or in the evaluator/planner documents.


## Article calibration workflow

`npm run score:corpus -- [OUTPUT_DIRECTORY] [CASE_ID]` generates source-shaped
synthetic article comparisons. The runner reads `composition_calibration` from
the same YAML as the renderer:

| Field | Meaning |
|---|---|
| `composition_calibration.insertion_start_page` | First page eligible for the corpus's repeating insertion capabilities. This is a template capability, not an authored block assignment. |
| `composition_calibration.max_full_plan_recalculations` | Exact complete-candidate budget for the coarse corpus mode. The legacy comparator deliberately evaluates its initial baseline only. |
| `composition_calibration.max_refinement_rounds` | Maximum exact correction/refinement rounds for the coarse corpus mode. |

A natural terminal main page remains measured but is exempt from density-only
occupancy penalties, column balancing, and empty-column penalties. Ordinary
paragraph continuations are exempt from fragmentation cost; obstacle-associated
splits retain that cost. Association does not establish avoidability.

Legal evaluations expose `scoreUpperBound` and `measuredRewardUpperBound`.
Component `rewardCeiling` is a configured cap; `rewardEvidence` distinguishes
measured, unmeasured and inapplicable rewards. Only measured components emit
`ceilingGap`. These are diagnostic algebraic bounds, not attainable optima or
quality percentages. The current loose bound is `260 + 4H` for `H` authored
heading IDs; template eligibility and conflicting geometric targets constrain
what can actually be achieved.


Proximity observations treat an atomic/table insertion and its enclosing
`insertion:<blockId>` graphic as one material subject. They must not produce a
self-pair or block a genuine neighboring pair. Ordinary structured blocks
without an insertion graphic remain measurable. This follows the existing
planned-insertion identity query used by flow collision handling.
