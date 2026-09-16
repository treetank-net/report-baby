# Composition score calibration

`server/scripts/calibrate-composition-score.mjs` is a read-only calibration
tool. It consumes a full public `render_report` JSON response (one produced
with `diagnostics: "full"`) and explains how the evaluator arrived at its
score.

```sh
node scripts/calibrate-composition-score.mjs /tmp/report.json
node scripts/calibrate-composition-score.mjs /tmp/improved.json /tmp/baseline.json
# equivalent from server/
npm run score:calibrate -- /tmp/report.json
```

The output reports the configured base, observed positive points, observed
penalties, reconstructed score, each component's value and points, and the
largest penalties. With a second response it also reports the score delta.
This makes a template or input change measurable without rendering another
debug overlay.

## Current scoring policy

The current score is:

```text
100 + positive components - additive quality penalties
```

Only two components currently add positive points:

- `column-balance`: up to `composition_score.column_balance_weight` when
  sibling columns are equally filled;
- `heading-following-line`: a fixed bonus per heading with a following line.

Correctly using space does not currently earn a positive bonus. A clean
`empty-regions`, insertion-spacing, header-spacing or footer-gap measurement is
neutral (`0` points), while a violation subtracts points. Penalties are not
expressed as a percentage of a corresponding positive bonus and are not capped
as a group. Repeated observations can therefore dominate the total score.

This is an accounting description, not a claim that the weights are visually
calibrated. A score is useful for comparing candidates only after the report is
read with its component evidence and the rendered artifact is checked.

The calibration tool intentionally does not change weights. Weight changes
belong in `server/templates/render-config.yml` and should be justified by a
paired before/after artifact review.

The current scorer now treats a full-width insertion at a text boundary as a
boundary condition rather than ordinary two-sided spacing: symmetry and rhythm
are evaluated only when measurable text exists with positive breathing room on
both sides. For a `template-fluid-insertion-capability`, distribution uses the
gaps between active instances and does not compare them with the entire page's
content envelope. The raw spacing report still retains the boundary evidence,
so a later candidate policy can decide whether to add breathing room.

The report also exposes `element-proximity` for relevant pairs such as an
intro block and a quote insertion. It names both subjects and records the
signed gap, movement deficit, movement budget and whether legal movement is
declared. This remains a soft ranking signal, not an action choice; the planner
must supply alternatives and the engine compares complete legal plans while
preserving authored-content coverage.

Request-owned one-off insertions may share one flow while targeting different
pages. The planner groups those requests, keeps each slot on its requested
page, and continues the flow only across the pages that actually contain a
requested slot; it does not create empty repeated insertion pages.

## Calibration hypothesis: optional insertion capacity

An insertion capability's `max_instances_per_page` is a capacity, not a
requirement to occupy every materialized instance. The current seed planner
selects the earliest compatible slot for each insertion block, so a first-page
quote may be placed before the first natural body paragraph even when an intro
and its heading make that composition visibly worse. The evaluator sees the
resulting fragmentation and gap pattern, but it cannot compare it with a
candidate that intentionally leaves the first capacity unused.

For pages with a dynamic intro, calibration should consider an activation mask
for a reusable pool. A three-instance quote pool may use only its second and
third instances on page 1, while all three remain available on later pages.
Their vertical positions should be derived from the usable body region after
the intro and chrome are resolved (for example, roughly 2/4 and 3/4 of that
region), not from fixed page fractions.

This is a candidate-generation question, not a new legality rule. The planner
now emits the authored earliest-slot seed and a bounded `skip-first` seed for
eligible fluid insertion flows when a dynamic intro is present. The engine
evaluates both; it does not move the template capability to manufacture the
desired result. The score also reports `main-start-delay` when an insertion
actually blocks the first available main-flow placement.

- legality still requires every placed quote to use a compatible declared
  capability and still fails when authored content cannot be placed;
- candidate generation may enumerate bounded activation patterns, including a
  deliberately unused first instance, when the route permits optional capacity;
- scoring should penalize an actually harmful empty region, not merely the fact
  that a legal capacity slot was left unused;
- the selected plan and public quality report should expose activated and
  intentionally skipped instances, plus the measured body interval used to
  derive their positions.

The calibration fixture compares the current earliest-slot plan with a page-1
`skip-first` candidate. The `main_start_delay_penalty` remains configuration-
driven; any future weight change must be justified by the public report and a
visual review of both candidates.

Observed on the long editorial fixture (7 quotes, short intro): the
earliest-slot candidate scored `17.46` after a `29.48 mm` main-column delay,
while the planner-selected `skip-first` candidate scored `51.31`. The selected
plan uses two quote instances on page 1, three on page 2, and two on page 3;
the template capability itself remains unchanged.

## Candidate-search boundary

`skip-first` is not a preference or a legality shortcut. It is one candidate
activation mask. The evaluator must be the only component that decides whether
that mask wins. Candidate generation may reject only impossible arrangements
(incompatible slot, overlap, source-order break, or residual content); it must
not select a mask because it is expected to look better.

The general case is a bounded search over insertion assignments:

- keep authored block order and place every block exactly once; skipping a
  materialized slot is legal, skipping authored content is not;
- generate a small neighbourhood of activation masks (for example, no skip,
  one skipped instance at each legal position, and a few page-local masks);
- generate fluid `y` positions inside the capability envelope, respecting
  measured content height, non-overlap, body bounds, and configured search
  budgets;
- deduplicate proposal signatures and let the composition engine evaluate the
  resulting full plans.

Enumerating every subset or continuous position is not a practical contract:
it grows exponentially or produces an unbounded search. The search budget
therefore bounds candidates, while the score remains the sole selector. The
plan trace must state which activation mask and fluid positions were evaluated
and which one won, so a `skip-first` result is explainable rather than inferred
from template geometry.
