# Release 1.1 — coarse geometry-first planning

Status: highest-priority composition follow-up after the placement-policy
contract. This item adds a cheap, rectangle-based composition estimate before
exact line layout. It replaces authored-position and equal-gap heuristics as
the primary aesthetic seed for movable insertions. It does not replace hard
legality, exact `CompositionPlan` materialization, evaluator scoring, or
rendered-artifact verification.

## Goal

Choose an aesthetically plausible global arrangement before spending work on
exact text line placement. Estimate the main-flow body as coarse content mass
inside resolved page regions, place movable insertions against that estimate,
and project the resulting text displacement with a deliberately simple
rectangle operation: subtract occupied spans from available text regions and
push affected text mass forward in reading order.

The estimate must account for the fact that insertions consume room. Its first
view of `main` is unobstructed by movable insertions; after insertion rectangles
are assigned, the estimator recalculates the body envelope with those
obstacles. Text may then occupy more pages than in the unobstructed estimate.
The exact planner subsequently wraps text, materializes every line and placement,
checks hard constraints, and evaluates the complete candidate.

## Priority and relationship to existing items

This is the first planning priority after the placement-policy contract (13),
because a good global seed improves the exact plans that later stages compare.
It precedes broad page-by-page micro-optimization (12) and rendered page-map
calibration (14).

- **Item 13 remains the policy and scoring contract.** Keep resolved
  distribution intent, rhythm groups, hard source relations, candidate
  eligibility, visual-load facts and evaluator components. Replace its
  pre-measurement authored-progress rank plus independent equal-gap gravity as
  the primary seed mechanism once this estimator is accepted. Exact candidate
  scoring and full-plan comparison remain authoritative.
- **Item 12 remains the exact-plan refinement stage.** Run its page-scoped
  proposals after the estimator has supplied the initial global arrangement
  and the exact planner has materialized a legal baseline.
- **Item 14 remains useful but downstream.** Its page map measures planned
  lines and rendered PDF output. It can compare the coarse estimate with exact
  geometry and calibrate prediction error; it cannot replace this pre-layout
  planning stage. Any item 14 work that only tries to derive the initial
  aesthetic placement from a final page map is superseded by this item.

This sequencing avoids making a post-layout observation responsible for an
upstream placement decision while preserving its independent role in checking
whether the chosen layout actually rendered as planned.

## Simplification of the current planning procedure

The estimator is a replacement for the current collection of initial
placement heuristics. It must not become another optimization loop in front of
them. Preserve one search/evaluation owner and give it a bounded shortlist of better complete seeds.

| Current procedure | Target after this item | Keep or remove |
|---|---|---|
| `orderedCandidateIndexes()` ranks an insertion by its authored ordinal over the count of all route candidates | assign the group against predicted `main` progress and relative visual load | Remove this rank from the production seed path after parity; retain legality and authored-order filtering |
| `seedInsertionProposals()` chooses an early compatible seed | the coarse assignment creates the initial legal insertion proposal set | Replace as the normal seed implementation; preserve narrow legality/capability helpers it calls |
| `relaxInsertionPlacementGravity()` independently attracts boxes to region gaps and repels them from fixed anchors | one obstacle-aware geometry projection uses the same fixed rectangles, clearances, insertion weights and predicted body progress | Absorb its required behavior into the coarse pass; remove the duplicate runtime gravity pass after fixtures prove parity |
| `assignInsertionGroupsFromPlan()` reassigns groups after a complete provisional plan | make the normal global assignment before exact line planning | Remove the unconditional pre-baseline assignment/replan; retain a narrowly triggered exact-plan correction only when exact evidence identifies a material prediction error and a legal action |
| `seedInsertionProposalCandidates()` and insertion/graphic candidate combinations eagerly create multiple exact candidates | project a bounded set of complete configurations, materialize a small shortlist, then request alternatives from hard diagnostics or evaluator repairs | Remove broad initial cross-products from the production path; preserve the eager oracle for compatibility and ranking tests as required by item 12 |
| repeated global insertion reconstruction through `insertionProposalsFromPlan()` | keep exact stabilization only for changes required by measured fit, geometry, or legality | Do not use small estimated progress changes to restart global distribution; delete a stabilization branch only after its exact invariant has a replacement assertion |
| `planLegalityCorrectionRecords()` and `planRefinedCandidateRecords()` rebuild from `seedInsertionProposals()` | generate legal corrections and local moves from the selected coarse-seeded incumbent | Do not let a correction or quality repair silently reset placements to the legacy seed |
| evaluator insertion distribution, page-load, spacing and text-continuity components | score the complete exact plan and validate the estimator's result | Keep exact components; do not count the estimator's seed cost as score or add a second copy of the same penalty |
| item 14 page map | compare coarse estimate with exact plan and rendered output | Keep it downstream, focused on prediction error and rendered geometry rather than initial placement |

The common path is one unobstructed estimate, bounded independent obstacle-push
projections, and a small exact shortlist per permitted page-template variant.
The existing `composition-engine.ts` evaluates and selects every complete seed
within its calculation budget. Subsequent alternatives remain diagnostic- or
evaluator-directed. Each projection starts from the same unobstructed estimate;
its resulting pages never become input to a repeated assignment loop.

### Minimal heuristic for the first production version

Keep the first version to four deterministic operations:

1. **Filter first.** Build the candidate set from existing route, slot,
   capacity, continuation, source-order and hard source-relation rules. A
   candidate that fails one of these rules never enters aesthetic ranking.
2. **Measure one main-progress axis.** Estimate the unobstructed main flow as
   aggregate block mass over the resolved usable regions. Use configured font,
   width, line-height and block spacing measurements where available; mark
   atomic or renderer-dependent sizes as missing when they cannot be measured.
   Estimate text height by greedily packing measured words to count lines, but
   emit no line positions or line boxes and do not model line-level obstacles.
   This is a block-height measurement, not an exact line-layout pass.
3. **Choose one target per insertion.** For `spread-across-pages`, use evenly
   spaced page targets. For `spread-through-content`, use cumulative insertion
   visual load to space target points along the main-progress axis. Measure
   candidate progress inside each page rather than assigning every slot its
   page's center. Gather candidates across all flows, retain bounded alternative
   assignments, and choose a complete configuration while preserving authored
   order and each block's flow constraints. A flow-level no-continuation rule must
   not pin separate insertion blocks to one page. Break ties by page and then
   the existing route order. Prefer pages carrying estimated main-flow mass;
   use a later insertion-only page only after compatible body-page capacity is
   exhausted.
4. **Project each shortlisted configuration once.** Cut hard insertion and fixed-obstacle spans from available
   text regions, then move aggregate main mass forward in reading order. Keep
   soft clearance halos as spacing evidence for exact evaluation; only remove
   them from capacity when a resolved template rule makes that clearance hard.
   Re-measure achieved progress and sensitive cuts for comparison, retaining
   the original weighted targets. Do not generate new insertion choices from
   the pages created by that push.

The original v1 used nearest-slot greedy assignment. The whole-document
selection amendment replaces it because an early flexible item could consume
the only slot available to a later required item. The frozen regression must
place both, including when they belong to different flows. Additional fixtures
require a centered slot to beat an earlier slot on the same page and require
pairwise clearance to distinguish complete configurations.

The bounded beam ranks configurations by required coverage, total coverage,
avoidance of insertion-only pages, then a configured cost of target-progress
deviation, pairwise spacing deficits and page-load imbalance. Visual load is
measured relative to the body regions, not relative to each item's own frame.
The trace reports the beam width, expanded and pruned states, complete layouts
compared and selected cost components. Pruning means the result is approximate;
it is not a guarantee of the globally optimal assignment. This cost is seed
evidence, not additional exact score. Symmetry and final pagination quality
remain exact evaluator concerns. No gradient descent, randomization, learned
weights or assignment/displacement feedback loop is introduced.

If no legal slot remains, retain the assigned legal prefix and
report the unsatisfied items with their candidate count and constraint reason.
Treat that as a capacity or policy finding for exact planning, not as a reason
to invent a new aesthetic fallback. Add a further heuristic only when a frozen
fixture demonstrates a concrete failure of these four operations and names an
observable acceptance criterion.

The production baseline, legality-correction path and quality-refinement path
must all start from the selected coarse-seeded incumbent.
`seedInsertionProposals()` must not survive as a hidden fallback that reappears
when a repair round starts. Keep the eager `planCandidatesWithSignatures()`
path only for compatibility/oracle use documented by item 12; the normal engine
uses the existing incremental baseline and repair interfaces.

### Exact geometry rewards and detachment checks

The selected coarse configuration expresses an initial intention; the exact
evaluator measures its achieved geometry rather than awarding points merely
for following the seed. Gravity includes a single insertion and retains
relative visual loads below one. An omitted rhythm group uses the owning flow.
Missing main progress does not become a fabricated zero measurement.

Local rewards cover measured neighboring box gaps at their resolved spacing
profile, plus usable text participation and mass balance around distributed
insertions. Box-pair evidence carries both identities, boxes, signed gap,
profile target, adjacency and movement capability. Intervening subjects prevent
the pair from earning a local adjacency reward. Rewards are averaged and capped;
adding equally good pages or elements cannot multiply their points. Acceptable
intervals earn full credit, with smooth reward falloff outside tolerance.

Measured zero text on a distributed insertion's page is detachment evidence
when main text exists elsewhere. It must not escape continuity evaluation.
Missing stream measurements stay absent, and fixed/free dedicated pages remain
outside that distribution rule. Existing penalties, heading keep rules and
terminal-page whitespace exemptions remain independent. A positive net
component retains measured deficit suggestions and is not marked fully passed.

Acceptance evidence includes the complete legal body-associated versus
insertion-only comparison, unequal-size gravity targets, a singleton target,
good versus deficient local gaps, missing versus measured-zero text, bounded
rewards across repeated observations, and preserved heading/column transitions.

### Exact-plan correction boundary

The coarse assignment is frozen while its rectangles push aggregate main-flow
mass. This avoids a feedback cycle in which insertion-created pages attract
more insertions and then push still more text forward. The exact baseline may
still require internal materialization to settle measured fit-content boxes or
renderer-neutral flow geometry. Keep that exact stabilization bounded and
separate from aesthetic reassignment. Stabilization may accept updated
measured box geometry only when the exact proposal retains the coarse
assignment's page and slot. If reconstruction proposes a different page/slot
or loses an assignment, preserve the coarse page/slot, record the exact
assignment mismatch, and let the complete-plan evaluator and the correction
boundary below decide whether an explicit legal repair is warranted.

After exact materialization, allow a new insertion assignment only when at
least one of these conditions holds:

- a hard diagnostic identifies the affected insertion and a compatible legal
  correction exists;
- a measured evaluator component produces a reachable relocation/movement
  proposal with a complete-plan score reason; or
- the exact-versus-estimated difference crosses a configured tolerance and
  maps to an existing legal repair action.

In every case, materialize and evaluate the correction as a complete exact
plan. If no supported action exists, retain the exact diagnostic and report the
prediction error; do not launch an unbounded estimator/reflow loop. The
candidate-search trace must distinguish initial macro seeds from exact corrections
and quality repairs.

## Governing decisions

1. **Rectangles first, lines later.** The estimate contains page, region,
   content-mass, insertion, fixed-element and exclusion rectangles. It does not
   create per-line placements, glyph boxes, or renderer commands.
2. **Use real dimensions and approximate text mass.** Read resolved slot widths,
   page geometry, configured font metrics, line-height estimates, block styles,
   margins and padding through existing seams. Aggregate the result into
   coarse block or flow rectangles. Do not position each estimated line.
3. **Keep hard feasibility separate from aesthetic preference.** Candidate
   insertion rectangles must already satisfy route, slot, role, capacity,
   continuation, source-order and hard source-relation rules. The estimate
   ranks legal choices; it cannot legalize a forbidden rectangle.
4. **Include fixed geometry before distributing movable content.** Margins,
   reserved bands, headers, footers, fixed frames and other immovable elements
   are part of the usable-region calculation and obstacle set.
5. **Project displacement before exact layout.** Once insertions are placed,
   subtract their occupied spans from text regions and move affected text mass
   forward. Recompute page occupancy and spillover before exact materialization.
6. **Never accept the estimate as the final plan.** Exact wrapping, legality,
   quality scoring, candidate selection and PDF rendering retain their existing
   owners.
7. **Record uncertainty as uncertainty.** If text metrics or template geometry
   cannot support an estimate, report the missing fact or a named estimate
   range. Do not substitute zero dimensions or fabricated precision.

## Estimated geometry

The estimator consumes the selected page templates and normalized content that
the exact planner already receives. Geometry uses the same physical coordinate
system and resolved dimensions as the exact composition path.

### Page and region rectangles

For every projected page, derive:

- the page canvas;
- the hard usable content regions after page margins and reserved bands;
- text slots and their widths, heights and reading order;
- permanent rectangles for measured or configured header, footer, intro and
  other fixed content;
- insertion-capability rectangles and their allowed movement bounds; and
- clearance or exclusion regions around page edges and fixed geometry.

Hard exclusion rectangles represent genuinely unavailable space, such as
outside-canvas area, margins, reserved footer/header bands, or a fixed frame
that cannot be overlapped. Configured spacing halos represent desired breathing
room and remain soft unless the existing template constraint makes them hard.
Do not silently convert every aesthetic gap into a legality rule or count the
same margin twice.

All dimensions, margins, padding, spacing targets, text metrics, coefficients,
error tolerances and iteration limits come from existing template geometry,
`CompositionTextMetrics`, or `server/templates/render-config.yml`. New tunable
numbers must be added to that YAML file and documented in
`docs/composition/configuration.md`.

### Main-flow content mass

Estimate each main-flow block's occupied height in the resolved text region
using the available font/style measurement, line-height, paragraph spacing,
heading rules and block padding. The estimator may approximate a line count or
block height, but stores an aggregate rectangle or ordered mass interval rather
than materializing line boxes. Preserve authored reading order and the selected
template's columns and page sequence.

The initial unobstructed projection excludes movable insertion obstacles. It
still includes margins, reserved bands, fixed chrome, dynamic intro geometry
that is already measurable, and any other fixed geometry that consumes main
capacity. Its output describes expected main progress and residual text mass at
each eligible page/region, including the likely terminal page.

Do not assume every eligible page carries equal body mass. A short intro page
may carry little `main`; a sparse terminal page may carry only a fragment. These
facts affect the target distribution of insertions.

### Insertion rectangles and visual load

Estimate intrinsic insertion size before assignment using existing insertion
measurement and configured fit/grow behavior. For each legal candidate, retain
its page, slot, rectangle, movement policy, source relation, rhythm group,
estimated visual load and the main-progress interval it would interrupt.

Use measured area and vertical span, plus existing content-progress and source
relation costs, to distribute mixed insertion kinds. A large image should
reserve more visual and text-flow territory than a short quote. Do not replace
separate area, height, text-mass and categorical policy facts with one opaque
weight.

## Planning algorithm

The estimator is a cheap deterministic projection within the existing
composition lifecycle. It does not create another candidate selector.

```text
resolve page templates, routes and hard capabilities
  -> build page, content, fixed-element and forbidden rectangles
  -> estimate unobstructed main-flow mass and progress
  -> measure insertion rectangles and enumerate legal candidates
  -> assign movable insertions against estimated content progress and load
  -> cut hard insertion spans from affected text regions and retain soft clearance halos as evaluator evidence
  -> push remaining main-flow mass forward in reading order
  -> update estimated page occupancy and terminal-page spillover
  -> materialize exact line layout for the selected seed
  -> evaluate legality and quality on the complete exact plan
  -> request only diagnostic-directed corrections and evaluator-backed repairs
  -> run bounded page-local micro-optimization after a legal exact baseline
```

### 1. Build usable regions and fixed obstacles

Resolve each page's actual template before estimation. Subtract hard page
margins, reserved bands and fixed rectangles from the usable content regions.
Include header/footer and dynamic intro geometry where it is known before the
exact body pass. Represent unknown dynamic geometry explicitly and use the
existing exact-plan lifecycle to resolve it; do not invent a zero-height
measurement.

Keep regions distinct where text cannot flow between them, such as columns,
sidebars, or separate text lanes. Follow the configured reading direction and
template reading order when ordering regions.

### 2. Estimate unobstructed main flow

Pack aggregate main-flow mass through the available regions in reading order,
using each region's actual width and available height. Estimate block heights
from text metrics and vertical spacing, without creating individual line
placements. Record, per page and region, the estimated main-flow start/end
progress, occupied height, remaining capacity and uncertainty.

This is a baseline prediction, not a promise that exact line breaking will end
on the same page. It gives the insertion distributor a stable content axis that
movable obstacles cannot inflate before the first assignment.

### 3. Assign insertions globally against predicted content

Filter each block's choices through hard capability and relation checks. Gather
all insertion flows before choosing slots, then retain bounded alternative
monotonic assignments across the document. Rank complete retained configurations
using coverage and body-page preference before the weighted cost of target
main-content progress, estimated visual-load balance and pairwise clearance.
Interpolate progress through estimated mass rectangles, so different vertical
positions on one page have different content targets. The configured beam
limit bounds intermediate alternatives; expose pruning rather than implying
exhaustive search. Apply `require-same-page` filtering to clustered,
free and spread policies alike. When no candidate page contains the estimated
source block, keep the insertion explicitly unassigned and attach the rejected
candidate pages plus estimated source pages to the coarse decision. Exact
evaluation may then confirm the conflict with measured source-page geometry.

Only pages with legal insertion capacity are candidates. Do not create an
insertion destination merely because an insertion would push text onto a new
page. Leave a legal capability unused when it would cause a harmful cluster or
an unnecessary page. If hard capacity cannot place required content under the
route's continuation policy, surface that condition for exact legality handling
instead of disguising it as a successful estimate; the coarse trace identifies
whether continuation policy, source relation, or general slot capacity/order
caused the shortfall. An ordinary route with
`continuation: forbidden` may use multiple insertion slots on its initial page
but must not place later authored blocks on another page. An explicit
`repeat: each-page` route is the exception: its slots are page-local instances,
so its authored insertion blocks may be distributed across those instances.

For example, when unobstructed `main` occupies two pages and five quotes are
available, distribute the five quotes over legal capacity on those two pages
according to their content progress and relative visual load. Do not place one
quote on each of five otherwise empty candidate pages and thereby manufacture
five pages. If those two pages do not expose enough legal capacity, the estimate
must report the shortfall; it must not override template policy.

Conversely, two quotes over five main-flow pages should follow the document's
estimated content intervals. They should not be packed together on page one
just because that is the first available capability.

### 4. Apply the naive obstacle and push projection

After insertion rectangles are assigned, project how they consume text space.
For each affected text region:

1. Intersect the physical rectangle with the text region. Expand it only when
   a resolved template constraint explicitly makes its clearance hard.
2. Subtract the resulting hard span from available text area; preserve soft
   clearance halos for spacing evaluation instead of treating them as capacity
   loss.
3. Keep any remaining side regions as coarse rectangles only when the template
   and flow policy permit text beside the obstacle; otherwise treat the
   obstacle as consuming the full affected text width.
4. Pack displaced main-flow mass into the next available vertical intervals in
   configured reading order, shifting downstream mass down and then spilling it
   into later regions/pages when capacity runs out.
5. Recalculate each page's estimated main-flow progress, load and terminal
   spillover from the displaced rectangles.

This is intentionally a rectangle-level estimate. It does not decide exact
word breaks, line wrapping around an obstacle, widows/orphans, or glyph
positions. Its purpose is to represent the first-order effect the user
described: an insertion cuts usable rectangles and moves subsequent text mass
down.

### 5. Freeze the coarse assignment and hand off

Retain the best bounded complete configurations from assignment search and run
one forward rectangle projection for each: subtract occupied spans, push
main-flow mass, and recalculate estimated occupancy and spillover. Compare
coverage first, then insertion collisions, unplaced mass, body-page preference,
and the configured cost of achieved progress, spacing, load and sensitive cuts.
Keep the original unobstructed winner among the exact alternatives so an
approximate break prediction cannot silently discard it.

No projection feeds its insertion-created pages back into candidate generation.
The public coarse decision records intrinsic measurements, sensitive regions,
all projected alternatives and their selected flag. A frozen approximation is
seed evidence; only exact evaluation establishes legality and final score.

### 6. Materialize and evaluate exact candidates

`planBaselineCandidatesWithSignatures()` materializes at most
`composition_search.coarse_exact_candidate_count` complete seeds, further
limited by the engine's initial-candidate and full-plan budgets. The production
default is three exact seeds from eight projected configurations. A budget of
one still materializes one seed. Existing bounded fit-content stabilization
runs independently for each seed and is accounted for separately from exact
candidate evaluations.

The existing composition engine compares total exact score, selects the legal
incumbent, and then runs its supported legality corrections and quality repairs.
Continuation from a previously materialized baseline disables both initial
seed hooks; it cannot recreate the shortlist. The coarse cost is never added
to the exact score.

The estimator must expose which facts were estimated and their provenance so
the exact plan and later page-map work can report prediction error. Do not add
the same aesthetic penalty once in the estimator and again in the evaluator:
the coarse assignment selects a seed; exact score selects the accepted plan.

## Ownership and boundaries

| Concern | Owner |
|---|---|
| template geometry, legal insertion candidates and resolved movement policy | existing template adapters and placement-policy resolver |
| aggregate text-height and intrinsic insertion estimates | existing text and insertion measurement seams |
| usable-rectangle construction and obstacle subtraction/push projection | a focused operation in `server/src/composition/layout/`, coordinated by the existing text-planning entry point |
| bounded complete configuration selection and projection comparison | `planCoarseInsertionAssignments()` in `coarse-geometry-planning.ts`, invoked once per initial batch by `text-planner.ts`; returns projected proposal maps and assignment evidence |
| proposal budgets and complete-candidate selection | existing `composition-engine.ts` |
| hard legality and exact score | existing composition evaluator |
| page-by-page exact repair after a legal baseline | item 12 and the existing refinement path |
| planned-versus-rendered measurement and calibration | item 14 and existing PDF QA tools |

### Runtime call sequence

For each permitted document-layout variant, `createTextCompositionPlanner()`
exposes `planBaselineCandidatesWithSignatures()` to the existing composition
engine. The call sequence is:

1. The engine supplies the maximum initial exact-candidate count allowed by its
   budgets. The planner obtains one unobstructed estimate for the batch.
2. `estimateCoarseMainGeometry()` reads resolved main slots and renderer metrics.
   It records unbroken block height by width, aggregate word ranges, fixed
   exclusions, and break-sensitive regions; it emits no exact line boxes.
3. `planCoarseInsertionAssignments()` enumerates legal choices across all flows,
   retains bounded complete configurations, and calls
   `projectCoarseInsertionDisplacement()` once for each retained projection.
   `assessCoarseProjection()` compares new cuts against the unobstructed baseline.
4. The planner materializes the configured small shortlist with
   `planBaselineCandidate()` / `planDocumentOnce()`. Each seed has its own
   projection and `COARSE_GEOMETRY_CANDIDATE_MATERIALIZED` rank decision.
5. The engine evaluates every complete seed and selects by exact legality and
   total score. It owns calculation accounting, subsequent corrections, and
   refinement. The trace identifies initial candidates separately from repairs.
6. Repair generation starts from the selected exact placements. Reusing an
   existing baseline through `continueFromBaseline()` does not regenerate or
   reevaluate initial seeds.

The coarse result is ephemeral and owned by the layout-planning call. It does
not mutate shared template state or persist across requests.

If implementation needs an intermediate typed result, keep it an ephemeral
coarse geometry estimate with separate named collections for page regions,
content mass, insertion rectangles, fixed obstacles, clearances and uncertainty
facts. It is not a second public `CompositionPlan`, cannot establish legality,
and must not contain exact line placements. Do not introduce a generic bag of
untyped geometry facts.

## Benefits to measure

- Five insertions no longer turn a two-page body into five pages merely because
  the seed selected one later slot per insertion.
- A short intro page and a sparse terminal page receive insertion load in
  proportion to their estimated main-flow content.
- Large and small insertions influence distribution according to measured
  geometry rather than raw element counts.
- Text displacement caused by insertions is represented before exact wrapping,
  producing a more plausible global seed for the expensive planner.
- Exact planning can focus on correcting prediction error and local details
  rather than discovering the document-wide distribution from a poor seed.
- Later page-map analysis can quantify where rectangle estimates diverge from
  exact boxes and rendered output, creating evidence for improving the
  estimator.

Track at least: estimated versus exact page count; insertion-to-main-progress
error; per-page estimated versus exact text mass; number of exact full-plan
recalculations; legality failures caused by the coarse seed; and selected-plan
quality against the current baseline on the same fixtures. Report ranges and
missing facts rather than implying precision the coarse model does not have.

### Score calibration for successful layouts

The exact evaluator should communicate both defects and achieved quality.
Currently several useful exact measurements (insertion progress, page-load
balance, and spacing against the selected profile) contribute penalties only
when they miss their tolerance. A candidate that hits every target therefore
earns no points for those successes. Add bounded, configured rewards for
measured alignment with these existing targets, and for consistent main-flow
occupancy across interior pages. The occupancy measure is a renderer-neutral
proxy derived from exact planned line envelopes; item 14 raster checks remain
the evidence for actual rendered ink. Measure terminal occupancy without a
density penalty: a short final fragment and whitespace caused by legal heading
keeps are accepted. Score detached distributed insertions through their own
continuity and gravity evidence rather than treating a natural tail as a defect.

Keep each reward attached to its existing exact measurement:
`content-spread` represents gravity against main-flow progress,
`page-load-balance` represents insertion visual load across eligible pages,
`insertion-distribution` represents gaps between insertion elements,
`insertion-symmetry` represents the text gaps on either side of an insertion,
and `spacing-rhythm` represents text-to-insertion gaps against the selected
profile. The main-flow occupancy reward compares occupied height in resolved
main regions across interior pages. Gravity progress uses document-global word
ranges so block-local word indices cannot reset the measured progress. Give
each reward a configured maximum, normalize its evidence within the document,
and retain existing out-of-tolerance penalties. Do not reward unavailable
evidence or count one geometric deviation in multiple new components. Hard
legality remains a separate gate; no reward can make an illegal plan
acceptable.

Do not raise the global score base merely to make scores look positive. Freeze
paired layouts and assert that exact target hits earn bounded positive points,
deliberate deviations reduce those points and retain their penalties, missing
measurements earn zero, and hard violations remain rejected. Compare component
breakdowns and winner ordering across both representative editorial templates
and the ranking corpus before setting reward weights.

## Failure modes and safeguards

- **False precision from average text height:** preserve estimator uncertainty;
  exact line layout remains authoritative.
- **Obstacle causes unexpected wrapping:** let exact reflow report and repair
  the difference; do not repeatedly re-run the coarse estimator for every line.
- **Insertion-created pages feed back into insertion targets:** base the first
  assignment on unobstructed content progress, freeze it during the push
  projection, and route later changes through exact-plan repair.
- **Margins or spacing counted twice:** distinguish hard no-go regions from
  soft clearance halos and document their geometry provenance.
- **Fixed chrome displaced as if it were body text:** mark fixed rectangles as
  immovable anchors; only eligible flowing content may be pushed.
- **Text pushed into an illegal region:** clip the coarse projection to
  resolved usable rectangles, then require exact legality checks.
- **Insufficient insertion capacity:** report the unsatisfied required content
  and applicable route constraints; never omit authored content to improve
  balance.
- **Approximate distribution conflicts with source order:** keep candidate
  assignment monotonic per flow and enforce hard source relations before
  aesthetic ranking.
- **Coarse score silently replaces evaluator score:** use coarse cost only to
  seed and bound work; select accepted plans by exact evaluator results.

## Exact implementation sequence

### Stage 1 — freeze behavior and fixtures

Capture the current selected plans, page counts, insertion assignments, exact
scores and full-plan calculation counts for a small deterministic corpus. Add
plan-only fixtures for:

- five quotes over an unobstructed two-page `main` flow;
- two quotes over a five-page `main` flow;
- a dynamic intro page, full body pages and a sparse terminal page;
- a large image mixed with short quotes in one rhythm group;
- margins and reserved header/footer bands;
- fixed obstacles with spacing clearances;
- multiple columns and an obstacle that consumes only part of a text region;
- a template whose two body pages do not have capacity for every required
  insertion; and
- a case where exact reflow changes the predicted terminal page.

Freeze content, fonts, template routes and configuration for before/after
comparisons.

**Gate:** each fixture states its legal candidate set, expected coarse page
membership, expected displacement direction and exact-plan acceptance condition.

### Stage 2 — implement coarse measurement and rectangles

Reuse existing resolved template geometry, text metrics and insertion
measurements. Add the ephemeral coarse estimate at the existing planning seam.
Represent text as aggregate flow/block rectangles and mass facts. Implement
hard exclusions, fixed rectangles and spacing clearances using configured
geometry.

**Gate:** plan-only assertions verify page regions, estimates, clearances and
obstacle intersections; no per-line geometry is emitted by the coarse pass.

### Stage 3 — distribute legal insertion candidates

Use the unobstructed progress estimate, insertion visual load and policy facts
to produce a bounded monotonic assignment across compatible page/slot
candidates. Keep template capacity as an upper bound. Record unused capacity,
candidate rejection reasons and assignment costs.

**Gate:** the five-over-two-page and two-over-five-page cases pass without
violating source order, creating unnecessary pages, or leaving required content
unaccounted for. A greedy-dead-end fixture preserves a later required item's
only slot; the equivalent cross-flow fixture proves shared capacity is selected
jointly. Same-page center selection and cross-flow pairwise clearance are
checked. The trace reports deterministic complete-configuration comparison and
whether the configured beam pruned alternatives.

### Stage 4 — project cuts, pushes and spillover once

Subtract hard insertion occupancy rectangles from affected text regions and
push aggregate text mass down/forward in one deterministic pass. Keep soft
spacing halos as aesthetic evidence; do not remove their area from hard flow
capacity. Recompute predicted page loads and terminal spillover. Keep fixed
header/footer/chrome in place; do not rerun insertion assignment from
insertion-created pages.

**Gate:** a moved insertion causes the expected coarse displacement; a fixed
obstacle does not move; exhausted regions spill forward; repeating the same
input yields the same projection without an iterative assignment loop.

### Stage 5 — replace duplicate seeds and integrate exact baseline-first planning

Route the projected shortlist into `planBaselineCandidatesWithSignatures()`
exposed by `createTextCompositionPlanner()`; preserve the singular hook for
budget-one and compatibility callers. In `planBaselineCandidate()`,
run the coarse estimate before the first `planDocumentOnce()` call. Remove the
production call chain that separately generates an ordinal seed, relaxes it by
equal-gap gravity, materializes a provisional plan, and unconditionally
reassigns the group before the baseline. Keep hard candidate checks and exact
fit/content measurements. Keep `composition-engine.ts` as the only owner of
baseline evaluation, legality recovery, quality refinement and candidate
selection. The old `planCandidateRecords()` cross-product remains an oracle
path only and is never selected by normal production search. Record predicted
versus exact membership, exact assignment mismatches retained by bounded
stabilization, internal baseline materialization counts, the reason an exact
correction was requested, and evaluated full-plan calculation counts
separately.

**Gate:** exact planning catches a deliberately induced widow/orphan, overflow,
source-relation violation and margin collision even when the coarse estimate
looks acceptable. The coarse estimate cannot mark the candidate legal. The
ordinary path evaluates at most the configured initial macro shortlist per
permitted variant; subsequent candidates have a recorded legality or evaluator
action as their cause. Count any bounded internal materialization used to settle
that baseline separately from evaluated candidates.

### Stage 6 — integrate exact corrections, micro-optimization and page-map calibration

Run supported item 12 legality recovery and bounded page-local refinement only
after evaluating the exact baseline. Update
`planLegalityCorrectionRecords()` and `planRefinedCandidateRecords()` to start
from the selected coarse-seeded incumbent; ensure repair generation cannot
reseed from the old ordinal path. Keep `insertionProposalsFromPlan()` for
measured exact stabilization where needed; gate aesthetic reassignment on the
correction boundary above. Extend item 14's selected-plan projection to compare
coarse estimate, exact planned boxes, PDF text bounds and raster evidence while
preserving measurement provenance.

**Gate:** page-local improvements are still evaluated as complete exact plans;
the page map identifies estimate error without feeding post-render facts back
into candidate legality.

### Stage 7 — compare and promote

Run the same fixtures and a representative editorial PDF through current and
coarse-seeded paths. Compare page count, insertion distribution, exact score,
required-content coverage, orphan/fragment findings, full-plan calculation
count, prediction error and rendered visual quality.

**Gate:** promote the coarse seed as default only if it improves the agreed
multi-page distribution cases, stays legal after exact reflow, does not regress
representative rendered output, and has acceptable bounded-search cost. Keep a
configuration-controlled rollback path until the representative PDF review is
complete.

## Verification matrix

| Requirement | Cheapest evidence |
|---|---|
| Five quotes follow a two-page unobstructed body | plan-only coarse and exact page assignments, plus no insertion-created pages without body/capacity reason |
| Two quotes distribute over five body pages | plan-only target/actual content progress rather than first-page clustering |
| Insertion displacement expands main-flow occupancy | coarse rectangle trace showing cut, push and spillover, compared with exact reflow |
| Margins and reserved bands are unavailable | boundary fixture and hard-constraint result |
| Header/footer remain fixed | coarse and exact geometry assertions |
| Fixed and movable elements obey distinct mobility | movement-policy and proposal assertions |
| Clearance uses configured spacing without double-counting margins | rectangle provenance plus spacing fixture |
| Mixed image/quote load affects global distribution | one group assignment and visual-load assertion |
| Source order and same-page requirements remain hard | candidate-filter and exact legality fixtures |
| Hard source relations apply under every distribution mode | coarse assignment remains unassigned across spread/clustered modes; exact evaluation reports measured source and eligible candidate pages |
| Forbidden continuation does not spill to later pages | coarse assignment keeps the legal initial-page prefix, records its anchor/candidate pages, and exact evaluation rejects the unassigned required suffix |
| Estimate cannot hide exact line-flow defects | exact-plan widow/orphan/overflow regression |
| Estimate stays single-pass and deterministic | repeated plan-only projection produces the same assignment and push result |
| Full-plan work is reduced | internal materialization and evaluated-candidate counts compared separately against the frozen current path |
| Repairs preserve the selected seed | legality and quality corrections start from the coarse-seeded incumbent, not an ordinal reseed |
| A good measured geometry earns visible score credit | bounded target-hit fixtures award positive gravity, insertion-gap, spacing-profile, and interior-page occupancy points; deliberate deviations reduce reward and keep penalties |
| Item 14 can compare predicted, planned and rendered geometry | one representative PDF with measurement provenance at all stages |

## Completion criteria

This item is complete only when:

- the coarse projection uses resolved physical rectangles, hard exclusions,
  fixed geometry and configured clearances;
- unobstructed main-flow mass is estimated before movable insertions influence
  the predicted page count;
- insertion assignments use predicted content progress and measured relative
  visual load while respecting legal capacity and order;
- the production baseline no longer runs ordinal ranking, independent gravity
  relaxation and unconditional post-materialization group assignment as
  separate seed stages;
- legality corrections and quality refinements preserve the selected
  coarse-seeded incumbent instead of rebuilding the old seed;
- the eager candidate oracle remains test-only and is not deleted as a side
  effect of the production-path migration;
- placed insertion rectangles cut available text regions and push aggregate
  main-flow mass forward before exact planning;
- the projection recomputes page occupancy and spillover in one deterministic
  forward pass, without a coarse assignment/reflow loop;
- the normal path compares a configured bounded exact macro shortlist before
  requesting corrections, while separately accounting for exact internal
  stabilization materializations;
- the exact planner and evaluator remain authoritative for lines, legality,
  score and candidate acceptance;
- exact target alignment and measured interior-page occupancy earn bounded
  configured rewards, while out-of-tolerance deviations retain their penalties
  and missing evidence earns no reward;
- item 12 consumes the exact legal baseline seeded by this phase;
- item 14 remains downstream verification/calibration and does not duplicate
  the coarse planner; and
- the representative PDF demonstrates better distribution without
  regressions in legality, required content, flow quality or rendered
  appearance.


## Break awareness and calibration amendment

The coarse estimate records each block's unbroken height at its actual container
width. Atomic measurements use the renderer metric and the resolved region
height constraint; they do not claim an unlimited native image height. Sensitive rectangles cover atomic blocks, headings with their required
following lines, and paragraph edge bands. Projections retain these intrinsic
measurements and report new cuts, affected block identities, word offsets,
boxes, estimated penalties and unplaced mass. These are estimates; exact widow,
heading and obstacle rules remain authoritative.

A natural final main page is exempt from density-only occupancy, column balance,
and empty-column penalties. Ordinary paragraph continuations across columns or
pages are reported without the fragmentation penalty. A split associated with
an overlapping wrap obstacle remains observable and penalized; association does
not prove the split is avoidable. Existing orphan, tiny-fragment, footer and
insertion detachment evidence remains independent.

`scoreUpperBound` is the configured algebraic reward ceiling.
`measuredRewardUpperBound` includes only reward components with measurements in
this plan. Components expose `rewardCeiling`, `rewardEvidence` and, when
measured, `ceilingGap`. Neither bound is a feasible maximum, quality percentage,
or promise that its gap can be recovered. Under the current defaults the loose
ceiling is `260 + 4H`, where `H` is the number of authored heading IDs. Competing
geometry targets and template capabilities can make much of it unattainable.

The representative distribution pair exposed a ranking inversion: the 20-point
gravity reward allowed a two-page quote cluster to beat the intended three-page
distribution because of footer and continuity penalties. The configured reward
is now 60 points. This is a calibration decision anchored in that pair, not
proof of a universal weight or optimal document layout.

The offline [article calibration corpus](../../../examples/composition-calibration/README.md)
contains six cases shaped from four public trans.info articles, with varied
lengths, quote densities, original graphics and two showcase brands/fonts.
Deterministic synthetic prose replaces source copy. Each run emits complete
geometry, exact score components, legal PDFs, rendered line-ink checks and
caption baseline checks against the planned caption frames.
New cases remain `pending-review`; numeric improvement alone cannot label a
candidate aesthetically preferred. The mixed-image corpus exposed a false
proximity pair between an atomic insertion and its own enclosing graphic.
Treat them as one material subject, retaining genuine neighbor pairs. This
removes self-collision costs without relaxing actual overlap legality. Keep the user's accepted fifth-page tail as
a separate reference, and collect reviewed preference pairs before further
weight calibration.

Height-constrained images retain a caption frame at the requested image width,
even when contain scaling narrows the painted image. Measurement and rendering
use the same caption font, size and frame width. Wrapped image boundaries cover
both the painted image and caption frame. This keeps caption reflow from
silently invalidating the otherwise legal planned geometry.
