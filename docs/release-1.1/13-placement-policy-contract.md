# Release 1.1 — placement policy contract

Status: implemented and verified: policy contract, precedence resolution,
policy evidence, measured content-spread/page-load scoring, per-column
insertion text-continuity scoring, source-relation legality diagnostics,
bounded monotonic group assignment and page-local gravity are implemented. The
existing baseline reflow remains authoritative; gravity is a cheap geometry
seed and measured distribution is also retained as an evaluator objective and
bounded relocation source. The representative editorial artifact is visually
accepted. Further mixed-flow calibration is a follow-up tuning task, not a
missing implementation path for this contract.

The higher-priority follow-up in
[`15-coarse-geometry-first-planning.md`](15-coarse-geometry-first-planning.md)
replaces the current heuristic seed and independent geometry-only gravity as
the primary initial-distribution mechanism. This contract remains the owner of
placement intent, legal candidate filtering, source relations, rhythm groups
and exact evaluator scoring.

## Outcome

Ordinary editorial input must not assign every quote, image, chart or table to
a page coordinate. The caller supplies content. The selected page templates
supply legal placement capabilities. The planner distributes movable material
through the article and selects the highest-scoring complete legal plan.

The common case requires no placement policy in the request. A template may
provide a soft default, and a caller may override that soft intent for a flow
or one block. Neither a default nor an override may invent capacity, violate
source order, bypass continuation, or turn an illegal box into a legal one.

The principal editorial default is **spread through content**, not “put the
same number of insertions on every page”. Quotes and images should be spread
over measured `main`-flow progress. A page containing little main text after a
large intro should normally receive less insertion load than a full body page.
A short terminal page may remain sparse.

## Current implementation checkpoint

The first implementation slice deliberately keeps the existing procedural
planner/evaluator boundary. It now provides:

- a typed `distribution` vocabulary replacing ambiguous `balanced`;
- template defaults and optional flow/block request overrides;
- automatic ordered seed selection across eligible candidate pages for
  `spread-through-content` and `spread-across-pages` (using authored insertion
  progress as the bounded pre-measurement proxy);
- one-shot bounded monotonic assignment of a shared group across eligible
  pages, using the first materialized main-flow progress and preserving each
  flow's candidate order;
- one shared rhythm group for mixed fluid insertion kinds;
- fixed insertion and graphic slots exposed as immovable gravity anchors;
- bounded geometry-only attraction/repulsion relaxation before complete plan
  materialization; and
- policy evidence in insertion decisions and normal composition summaries.

The evaluator calculates measured main-flow progress, weighted visual-load
evidence and group-level `content-spread`, `page-load-balance` and
`source-relation` components. Each insertion also records the normalized text
mass and usable line coverage above and below every affected main-flow column;
`insertion-text-continuity` applies to explicit `spread-through-content` and
`spread-across-pages` policies. It penalizes a candidate that crosses an empty
or one-sided column, or that leaves materially unbalanced text mass. A hard
`require-same-page` relation is checked after materialization and reports the
source pages and a remediation. The planner now performs one bounded
monotonic group assignment from the first materialized plan, then freezes that
discrete assignment while the ordinary reflow loop stabilizes. This avoids the
earlier page-4/page-5 oscillation; subsequent changes still require a complete
candidate evaluation.

## Why the current behavior is insufficient

The current implementation already supports:

- fixed, anchored fit-content and `fluid-y` slot capabilities;
- a per-page capacity upper bound;
- intrinsic insertion measurement;
- bounded movement and relocation candidates;
- per-placement score attribution and evaluator repair proposals; and
- complete-plan legality and quality comparison.

The former implementation had no complete distribution model:

- `distribution: balanced` does not say whether it balances coordinates,
  counts, occupied area, pages or progress through the article;
- `scoreInsertionDistribution()` currently groups insertion observations by
  page and region, so it cannot see an eligible empty page between two
  occupied pages;
- the seed planner primarily walks legal slot candidates in order and exposes
  only a few local alternatives;
- different flows are not automatically treated as one editorial rhythm;
- a large image and a short quote count as two placements even though their
  visual and text-displacement costs differ substantially; and
- the six policy families in the earlier draft describe internal concerns but
  would make an unnecessarily large public authoring contract.

The target contract must therefore distinguish capability, intent and measured
quality instead of asking a caller to configure every internal planner concern.

## Ownership model

| Layer | Owner | Responsibility |
|---|---|---|
| placement capability | page template or explicit request overlay | legal region, accepted content, size alternatives, fit behavior, movement axes and maximum instances per page |
| default placement intent | page template, with a semantic fallback for an unannotated movable main-flow obstacle | preferred distribution and rhythm group |
| request override | caller | replace a soft distribution preference for one flow or block, or provide a deliberate hard page/slot/frame constraint |
| resolved placement policy | planner | combine the above sources, record precedence and produce deterministic candidate objectives |
| measured quality | evaluator | score the complete geometry, attribute penalties to placements and propose bounded legal changes |

Continuation, source order, containment, overlap rules and explicit
`page`/`slot_id`/`frame` constraints remain hard legality. Distribution and
rhythm are soft objectives. Capacity is a hard upper bound, never a target
occupancy.

## Public vocabulary

The public soft vocabulary should stay small. It needs one distribution field
and one optional group name. It does not expose separate anchor, relation,
flow-interaction, sizing and lifecycle objects for ordinary use.

### Distribution values

| Value | Meaning | Typical use |
|---|---|---|
| `spread-through-content` | spread visual insertion load over measured progress of the affected text flow | default editorial quotes, unbound article images, charts and callouts |
| `spread-across-pages` | prefer comparable visual insertion load on eligible non-terminal pages, regardless of unequal text volume | page-led brochures or deliberately page-rhythmic reports |
| `clustered` | prefer consecutive compatible placements while preserving authored order | a related metric set, gallery, paired chart and explanation |
| `free` | do not add a distribution objective; retain generic spacing, collision, orphan and fill scoring | unusual layouts whose other relations determine position |

`balanced` is too ambiguous for the target contract. Existing templates using
it migrate to `spread-through-content` when their insertions interrupt `main`,
or to `spread-across-pages` only when equal page rhythm is the actual design
intent.

### Rhythm groups

`rhythm_group` identifies material that should be evaluated together. A group
may contain placements from different flows and of different kinds. For
example, `editorial-material` may contain quotes, images and charts. The group
does not merge their content or source order; it only defines a common visual
distribution objective.

When no group is declared, a movable capability that excludes space from the
same text region joins the region's implicit group. In a two-column editorial
body, quote and image obstacles affecting `main` therefore cooperate by
default. A sidebar in a separate lane and repeated chrome do not join that
group automatically.

Group names are template/request vocabulary. They are not new flow IDs and do
not create placements.

### Template default

```yaml
slots:
  quote-pool:
    type: text
    role: quote
    frame: { x: 0.081, width: 0.838 }
    fit_content: true
    spacing_profile: normal
    placement:
      mode: fluid-y
      region: body
      max_instances_per_page: 3
      distribution: spread-through-content
      rhythm_group: editorial-material
```

This declaration offers reusable capacity. It does not author three quote
slots and does not require all three instances to be used.

### Optional request override

Soft overrides belong beside placement requests and are keyed by existing flow
or block identity. A record avoids repeating `flow_id` in a list and allows the
caller to state only the values being changed.

```yaml
placement_requests:
  policies:
    flows:
      quotes:
        distribution: spread-through-content
        rhythm_group: editorial-material
      article-media:
        distribution: spread-through-content
        rhythm_group: editorial-material
    blocks:
      article-media:
        sponsor-card:
          distribution: free
        terminal-photo:
          source:
            flow_id: main
            block_id: customs-section
            strength: prefer-same-page
```

This is a soft override. Existing explicit `insertions` with `page`, `slot_id`
or `frame` remain the hard-placement escape hatch. A policy override changes
candidate ordering and scoring but must not add a slot or exceed template
capacity.

The target schema uses narrow string domains:

```ts
type PlacementDistribution =
  | 'spread-through-content'
  | 'spread-across-pages'
  | 'clustered'
  | 'free';

interface PlacementSourceRelation {
  flow_id: string;
  block_id: string;
  strength: 'prefer-same-page' | 'require-same-page';
}

interface PlacementPolicyPreference {
  distribution?: PlacementDistribution;
  rhythm_group?: string;
  source?: PlacementSourceRelation;
}

interface PlacementPolicyOverrides {
  flows?: Record<string, PlacementPolicyPreference>;
  blocks?: Record<string, Record<string, PlacementPolicyPreference>>;
}
```

Do not add a generic `options: Record<string, unknown>`. Input legality and
candidate selection need a strongly typed contract. Extensible numeric facts
belong in observations and score details, not in placement input.

## Resolution and precedence

The planner resolves one policy per materialized insertion in this order:

1. Hard explicit block placement (`page`, `slot_id` or request-owned `frame`)
   constrains legal candidates. It does not disable generic quality scoring.
2. A block policy override supplies the soft distribution/group preference.
3. A flow policy override supplies missing soft values.
4. The selected template capability supplies missing soft values.
5. A `fluid-y` capability that creates an exclusion obstacle in an ordinary
   text region defaults to `spread-through-content` and the implicit region
   rhythm group.
6. Other capabilities default to `free` and no cross-flow group.

Every selected plan reports the resolved values and their source as
`input-block`, `input-flow`, `template` or `planner-default`. Missing values are
omitted; the report does not fabricate sentinel values.

The semantic fallback is deliberately based on behavior, not a hard-coded list
of roles. A custom callout that wraps `main` receives the same sensible default
as a quote. A quote in a separate fixed lane does not receive main-text spread
merely because its role is `quote`.

| Capability situation | Default distribution | Rhythm participation |
|---|---|---|
| movable obstacle excluding space from an ordinary text region | `spread-through-content` | implicit group for the affected flow and region |
| movable placement in a separate lane | `free` | none unless declared |
| anchored fit-content placement | `free` | measured as fixed load for any declared/implicit surrounding group |
| fixed or request-framed placement | `free` | measured as fixed load, never offered as a move candidate |
| explicit template or request preference | declared value | declared group wins |

## Two independent optimization scales

### 1. Distribution through the document

Document distribution chooses pages and page-local candidate regions. For
`spread-through-content`, the coordinate is progress through the affected text
flow, not the physical page number.

After a provisional hard layout, every legal insertion candidate receives:

- an eligible page and capability;
- the amount of affected text before and after it;
- normalized content progress in the affected flow;
- the usable region and current chrome/intro reservations;
- estimated intrinsic occupied geometry; and
- an estimated visual load.

For ordered insertions, target progress positions are weighted quantiles over
the usable content trajectory. If the measured/estimated visual loads are
`w1..wn`, the target for an item is the midpoint of its cumulative share of
`sum(w)`. Equal-sized quotes therefore receive evenly spaced targets, while a
large image reserves a proportionally larger part of the trajectory. The
planner chooses an order-preserving assignment of blocks to legal candidates
that minimizes target-distance and quality cost. It must not build the
unrestricted Cartesian product of blocks and candidates.

For `spread-through-content`, desirable page load is proportional to the
measured main-content trajectory available on each eligible page. For
`spread-across-pages`, desirable page load is equal across eligible
non-terminal pages. These are distinct objectives; one must not silently fall
back to the other.

`spread-across-pages` uses eligible page progress instead. Empty interior
eligible pages are visible to its objective. The terminal-page exception
applies only when that page contains the end of required content; it must not
excuse an empty or overloaded interior page.

### 2. Rhythm within a page

After page assignment, page-local rhythm chooses geometry within legal movement
bounds. It evaluates:

- gap from the usable region start to the first material element;
- gaps between neighboring material elements, including different flows;
- gap from the last material element to the usable region end;
- gaps from insertion boxes to text immediately before and after them;
- narrow text intervals, orphans, fragmentation and column imbalance; and
- dynamic intro, header, footer and caption boundaries.

“Equal gaps” is therefore a page-local score objective, not another public
distribution mode. Exact equality is not mandatory: preserving readable text,
source relations and orphan-free flow can score better than a mathematically
equal but awkward arrangement.

## Visual load instead of raw insertion counts

Balancing counts alone produces poor results. One large full-width image can
consume more page rhythm and displace more text than two short quotes. The
evaluator should measure visual load from facts already available in the plan:

- occupied area relative to the usable page region;
- vertical span across the affected text lanes;
- amount of main-flow capacity excluded or displaced;
- caption or fit-content growth; and
- whether the obstacle spans one column, several columns or the full region.

The first implementation may use a documented weighted record of these
normalized facts. All weights and tolerances live in
`server/templates/render-config.yml`. The report exposes the facts and final
contribution separately so score calibration does not require reverse
engineering one opaque number.

Visual load is used for distribution. Pairwise gaps remain physical geometry;
a large image does not change the requested normal breathing-room token merely
because it has greater area.

## Relations and special cases

Most relations should be inferred from existing structure or supplied only
when the content genuinely has a reference. They are not required for every
insertion policy.

### Source-linked material

An image, table, chart or quote explicitly associated with a source block may
prefer or require the same page. This exceptional relation uses one narrow
block-policy field rather than a general relation language:

`prefer-same-page` adds candidate cost but may yield to a better complete legal
plan. `require-same-page` filters candidate eligibility before distribution and
produces an explicit failure when no compatible capacity exists. Distribution
then chooses the best position among the remaining legal candidates. A hard
source relation is never weakened to make the group more even. The reference
uses the existing flow/block identity; it does not introduce a parallel
content tree or assume that caller-provided block IDs are globally unique.

### Intro and cover pages

Intro, cover and dynamic chrome reserve their measured geometry before
ordinary insertion distribution. A first page with little or no `main` progress
normally receives no `spread-through-content` insertion. Using a first-page
insertion is still legal when enough main content remains and the complete plan
scores better.

The current special `skip-first` candidate becomes unnecessary once the
general group assignment can leave any legal capability unused. It should be
removed after equivalent reachability is proven.

### Fixed and authored placements

A fixed advertisement, explicitly framed image or other pinned item remains in
place. It still contributes visual load and page rhythm, so movable quotes and
images distribute around it. The evaluator must not propose moving a fixed
item.

### Sidebars and separate lanes

A sidebar that does not exclude space from `main` is not automatically part of
the main editorial rhythm. It receives `free` distribution unless the template
or request deliberately assigns it to a group. Its template continuation rule
still decides whether the sidebar may split between pages.

### Optional material

Omission is not a distribution policy. It is a legal candidate action only for
a source block with `allow_omission: true`. The evaluator may compare omission
after relocation/movement when retaining the element produces a lower complete
plan score. Required content is never dropped to improve rhythm.

### Multiple groups

One placement may be observed by a source relation and by one distribution
group. It should normally contribute to only one score-producing rhythm group.
Additional groups may be diagnostic-only. The same pairwise spacing deficit
must not be charged twice.

## Candidate construction

The existing `composition-engine.ts` remains the only search and selection
loop. Placement policies change seed quality and repair reachability; they do
not create a second planner.

The common path is:

```text
resolve page templates and hard capabilities
  -> reserve repeated chrome, intro and other higher-priority geometry
  -> measure insertion content and provisional main-flow capacity
  -> build legal candidates with content-progress and visual-load facts
  -> assign each distribution group with an ordered bounded optimizer
  -> place page-local members at high-quality rhythm seeds
  -> materialize and evaluate a complete legal document
  -> generate evaluator-directed movement, reassignment or permitted omission
  -> reflow and compare complete plans until the bounded stop condition
```

### Bounded group assignment

For a group with `n` ordered blocks and `m` legal candidates, use a monotonic
dynamic program or equivalent bounded ordered assignment. Its seed cost may
include:

- distance from target content/page progress;
- projected page visual-load imbalance;
- declared source-relation cost;
- use of an already crowded page;
- an eligible empty interior interval; and
- a cheap risk estimate for narrow text or fragmentation.

The current bounded implementation retains the best single assignment for the
seed and leaves the complete candidate budget to the existing engine. A later
calibration can retain several distinct assignments when their cheap costs are
close; that extension must still fully materialize and evaluate each retained
candidate. The cheap cost orders work; it does not establish legality or
replace the evaluator score.

This makes skipping any harmful capability a normal assignment result. It
avoids separate `skip-first`, `skip-second` and per-page permutation features.

### Page-local seed positions

For `k` movable boxes assigned to one page, seed them from the remaining usable
interval after fixed boxes are known. Use measured box heights and spacing
profiles to derive evenly distributed candidate centers. Add bounded
line-height and configured geometry-step alternatives where text-flow evidence
predicts orphan or proximity improvement.

When a page contains mixed image and quote boxes, calculate seeds for their
union in visual reading order. Do not independently center each flow and allow
the two sequences to collide.

### Cheap gravity relaxation before complete evaluation

Equal spacing and ordinary proximity correction do not require a complete
planner/evaluator round for every small movement. Once intrinsic box sizes,
legal movement bounds, fixed obstacles and page assignments are known, the
planner may run a bounded deterministic gravity-relaxation pass over geometry
alone.

The gravity model uses the already resolved policy facts:

- a movable element is attracted towards its target content/page progress;
- source-linked material is attracted towards the referenced block;
- neighboring material elements repel one another until their spacing-profile
  gap is satisfied;
- usable-region edges participate as boundary anchors for equal outer gaps;
- fixed placements, chrome and authored frames contribute load and repulsion
  but have no movable degree of freedom; and
- visual load controls how much narrative territory an element reserves, not
  a mechanically enlarged pairwise margin.

The first implementation represents visual load with a normalized weight from
the proposal rectangle's area and vertical span inside its usable region. The
weight reuses the configured `visual_load_area_weight` and
`visual_load_vertical_weight` coefficients used by evaluator scoring. The
pre-reflow gravity pass cannot know the final displaced text share, so it uses
only the geometry facts available at this stage and keeps a neutral mobility
baseline. The resulting weight changes only the attraction step: a large image
behaves as a heavier anchor, while a small quote can move farther toward the
shared rhythm target.
This is deliberately cheaper than recalculating line wrapping or a score
component. Pairwise repulsion still uses the configured spacing profile, so
load does not silently turn a readable gap into a giant margin.

This cost boundary is intentional: a gravity iteration answers only which
nearby geometry is a better seed. It does not remeasure text, rebuild
obstacles or add score points. The expensive planner/evaluator pass is paid
once for the stable seed (and only again when a discrete page, slot, width,
source relation or wrapping boundary changes). Equal-gap movement can
therefore run for several cheap iterations without multiplying full
composition evaluations.

When two movable elements still compete for the same interval, the collision
correction is split by inverse weight. The heavier element moves less and the
lighter element yields more. This keeps a large image visually stable without
requiring a second score calculation for every small quote displacement.

One cheap iteration calculates candidate displacement from current boxes,
clamps the displacement to declared movement axes and legal bounds, preserves
reading/source order, and applies a configured damped step. It does not rewrap
text, remeasure content or recalculate the complete composition score. Iteration
stops when all remaining displacement is below the configured geometry step,
the gravity objective no longer improves, or the configured relaxation budget
is exhausted.

```text
measured boxes + legal bounds + resolved policy
  -> calculate attraction, repulsion and boundary deficits
  -> apply one bounded deterministic displacement step
  -> repeat cheap geometry-only relaxation to a stable seed
  -> materialize text around the stable boxes
  -> run complete legality and quality evaluation
```

The relaxation objective is only a seed heuristic. The current implementation
returns one deterministic stable seed; it does not expose intermediate
iterations as plans. A future multi-minimum extension may retain a small
configured number of stable states, but none can declare legality or replace
the complete evaluator. A stable equal-gap arrangement can still cause
an orphan, fragment a paragraph or overload a later page after reflow.

A complete replan is required when relaxation crosses a discrete boundary:

- an element changes page, slot, width capability or wrapping lane;
- content-dependent size changes;
- a source/continuation/capacity relation changes;
- the affected text must be rewrapped to verify readability; or
- the stable state is being considered as a selectable plan.

This separates cheap continuous improvement from expensive discrete search.
Page assignment and capability choice remain bounded planner decisions;
gravity relaxation cheaply improves coordinates inside one such decision. The
engine should normally evaluate the stable result and, when useful, a small
number of distinct local minima rather than every intermediate one-millimetre
or line-step state.

All force weights, damping, convergence tolerance, retained-state count and
iteration budget belong in `server/templates/render-config.yml`. Product
diagnostics should summarize the resolved anchors, dominant unresolved force
or spacing deficit, iteration count and whether the resulting stable seed
improved after full evaluation. Intermediate iteration logs remain internal.

## Cross-flow interaction rules

The following rules cover the scenarios that motivated the policy:

1. An image and quote in the same region share page-load and rhythm evaluation
   when they resolve to the same group.
2. A large image can cause a quote to move to another eligible page even when
   the per-page quote capacity is not exhausted.
3. A source-linked image may remain on a crowded page while a movable quote is
   relocated; the hard/strong relation wins over even distribution.
4. A fixed image contributes load but receives no movement proposal.
5. Multiple insertion obstacles are combined before main text is laid out, so
   the text reacts to their union rather than to one flow at a time.
6. Dynamic caption growth updates image load, neighboring gaps and dependent
   text flow before scoring.
7. A candidate creating a narrow text strip, orphan or fragmented paragraph
   can lose to a less even geometric arrangement.
8. An empty interior eligible page is penalized when later insertions occupy
   the same trajectory, but an empty page with no compatible capability or no
   meaningful text progress is not.
9. A sparse terminal page is allowed; concentrating material on the preceding
   page is not automatically rewarded if it damages text flow.
10. Capacity exhaustion reports requested, legally placeable and unplaced
    counts with the pages/capabilities considered.

## Scoring and attribution

The total plan score remains authoritative. Distribution adds score components
that are also attributed to involved placements:

- `content-spread`: deviation between target and actual content progress;
- `page-load-balance`: dispersion of normalized visual load across eligible
  non-terminal page intervals;
- page-local rhythm through the existing `insertion-distribution`,
  `insertion-symmetry` and `spacing-rhythm` components;
- `insertion-text-continuity`: for explicit spread policies, per-placement
  coverage and normalized text-mass balance for every main-flow column crossed
  by an insertion, including a normalized deficit when usable text is present
  on both sides but either measured edge gap is zero or below the normal
  breathing-room target; fixed/free insertions retain their existing local
  spacing semantics;
- existing text/insertion spacing, proximity, orphan, fragmentation, empty
  region, column balance and fit-content components.

Pairwise penalties are conserved. If one quote/image gap contributes `-4`, the
total plan receives `-4`; attribution may divide that contribution between the
two placements, but it must not add `-4` to each and accidentally produce
`-8`.

Positive rewards should be used sparingly. A well-distributed page normally
avoids penalties rather than accumulating an unbounded bonus for every correct
gap. The configured base score and existing positive structural components
remain readable, while poor distribution subtracts a calibrated amount.

## Public evidence

Normal plan, CLI and MCP output must expose enough information for a caller to
act without a debug script. For each distribution group report:

- resolved distribution, rhythm group and source of each value;
- affected text flow/region;
- eligible pages and candidate capacity;
- main-content progress available on each page;
- selected items, occupied boxes and normalized visual load;
- target and actual content/page progress;
- page-local outer and inter-element gaps;
- pages excluded by hard relations and the reason;
- the highest-impact distribution finding; and
- concrete legal alternatives tried or suggested, with measured score deltas
  when evaluated.

Observational metrics remain a fluid `Record<string, number>` with consumer-
specific required keys. Identity, geometry, policy values, ownership and
candidate actions stay strongly typed.

## Implementation map

### Contract and adapters

- `server/src/template/contracts.ts`: replace ambiguous `balanced` with the
  target distribution domain and parse optional `rhythm_group`.
- `server/src/composition/contracts/model.ts`: carry the normalized capability
  policy without changing slot identity or flow continuation.
- `server/src/contracts/input/schema.ts`: add optional
  `placement_requests.policies.flows` and `.blocks` records.
- `server/src/composition/adapters/request-insertion-slots.ts` and the report
  entrypoint: resolve request overrides without manufacturing slot overlays.
- built-in templates and generated built-in files: migrate each existing
  `balanced` capability according to its actual behavior.

### Planning

- `server/src/composition/layout/insertion-planning.ts`: replace earliest-slot
  plus special `skip-first` seeding with resolved groups, measured candidate
  progress facts, a bounded monotonic ordered assignment across mixed flows,
  and page-local gravity relaxation. The assignment runs once from the first
  materialized plan and remains frozen during ordinary stabilization.
- existing insertion measurement: expose intrinsic occupied geometry before
  group assignment; do not duplicate measurement formulas.
- existing obstacle/layout path: materialize the selected mixed-flow obstacle
  union before final main-flow reflow.
- `server/src/composition/layout/placement-gravity.ts`: treat fixed insertion
  and graphic slots as immovable anchors during the cheap relaxation pass.
- `composition-engine.ts`: retain complete-plan selection and the configured
  candidate/recalculation budgets; receive stable relaxed seeds instead of
  evaluating every intermediate geometry step.

### Observation and evaluation

- `server/src/composition/observability/spacing-report.ts`: emit group,
  eligibility, progress, visual-load, per-column text mass and cross-flow
  neighbor facts.
- `server/src/composition/evaluation/scoring.ts`: split the current ambiguous
  insertion distribution score into content/page distribution and page-local
  rhythm components; score insertion text continuity from measured column
  coverage and placement mass.
- `server/src/composition/evaluation/repair-proposals.ts`: propose moving either
  eligible neighbor, reassigning a block to another compatible candidate, or
  permitted omission; sort by estimated recoverable placement contribution.
- CLI/MCP response adapters: expose resolved policy, evidence, alternatives and
  candidate outcome through normal product diagnostics, including full score
  component details rather than only the aggregate penalty.

### Configuration

Add all weights, tolerances, candidate limits and visual-load coefficients to
`server/templates/render-config.yml` and document every leaf in
`docs/composition/configuration.md`. TypeScript must not contain fallback
numbers for these values.

## Migration and deletion

1. Replace the old `balanced` value and migrate built-in templates and
   fixtures in the same change. Do not retain two runtime policy paths.
2. Prove content-progress distribution and cross-flow rhythm with plan-only
   fixtures, including the bounded monotonic group assignment and its stable
   reflow boundary.
3. Remove `flowsWithOptionalFirstInsertion()`,
   `skipFirstCandidateFlows` and the special skip-first candidate path.
4. Replace page-local-only distribution details and diagnostics with group-
   aware evidence.

## Verification matrix

| Requirement | Cheapest evidence |
|---|---|
| seven quotes are spread over five text-bearing pages | plan-only assertion over target/actual content progress and page assignments |
| a short intro page receives less load than full body pages | plan-only comparison of page text progress and normalized load |
| page 4 is not skipped between occupied eligible pages 3 and 5 without a better reason | group observation plus score/selected-candidate assertion |
| a large image reduces the desirable quote load on its page | cross-flow visual-load and selected-page assertion |
| image and quote gaps are evaluated together | one mixed-group page-rhythm observation and conserved score assertion |
| equal-gap improvement does not require a full replan for every small step | relaxation trace with several geometry iterations and one final complete evaluation |
| relaxation cannot hide text-flow damage | stable seed followed by complete reflow that reports or repairs an induced orphan |
| source-linked image stays with its paragraph | legality/candidate-eligibility assertion |
| fixed image is observed but never moved | repair-proposal assertion |
| sparse final page is not treated as an interior distribution defect | score assertion with terminal-page evidence |
| ordinary input needs no policy object | public contract fixture using template/default resolution |
| flow and block overrides follow precedence | adapter/resolved-policy trace assertion |
| hard page/frame cannot be overridden by distribution | legality and selected-candidate assertion |
| no score contribution is double-counted | total component versus placement-attribution conservation assertion |
| diagnostics are useful without internal scripts | public CLI/MCP result assertion |
| the policy improves a real document | one representative multi-page editorial PDF inspected visually after all plan checks pass |

The visual fixture must contain at least two insertion kinds, a dynamic intro,
multiple body pages and a sparse terminal page. It is an acceptance artifact,
not the primary regression suite.

## Completion criteria

This item is complete only when:

- ordinary editorial input obtains a documented automatic distribution policy;
- quotes and other main-flow obstacles are distributed by content progress,
  not merely by earliest legal slot or page count;
- mixed insertion kinds can share one evaluated rhythm group;
- visual load accounts for geometry and displaced text instead of raw counts;
- page-local equal-spacing uses bounded geometry-only relaxation before the
  expensive complete-plan evaluation;
- request overrides are optional, narrow and cannot expand legality;
- seed planning can leave any harmful capability unused without a special-case
  skip function;
- the evaluator attributes distribution penalties and proposes reachable legal
  alternatives;
- normal product output explains the selected distribution and rejected
  alternatives; and
- the representative PDF is visibly better than the current uneven-quote
  oracle without regressing legality, source order or required content.

## Implementation evidence

The current implementation is covered by the following checks:

- `node scripts/test-template-flow-contract.mjs` verifies fluid capability
  materialisation, equal-gap gravity, fixed anchors, weighted mixed-flow group
  assignment, hard source-page relocation and the ability to leave the first
  eligible page unused.
- `node scripts/test-dynamic-insertion-slots.mjs` also verifies the negative
  hard-relation case: when an insertion is pinned to a page that cannot contain
  its source block, the plan is rejected with `INSERTION_SOURCE_RELATION_VIOLATION`
  and reports the known source pages plus a concrete relocation/relaxation
  remedy.
- `REPORT_BABY_TEST_TIMING=1 node scripts/test-composition-quality-e2e.mjs`
  verifies a complete legal five-page editorial plan, measured score
  components, public quality evidence and a representative PDF. The fixture
  now asserts that the fourth quote is selected on page 4, where both main
  columns have usable text above and below it, and that this candidate outranks
  the page-5 alternative by the continuity/mass criteria. The latest run
  completed in approximately 30 seconds, with the selected PDF render taking
  under 100 ms; the expensive work remains bounded planning and evaluation
  rather than rendering.
- With `COMPOSITION_QUALITY_ORACLE=1`, the bounded policy path selects the
  accepted page-4-continuity candidate after the complete candidate comparison.
  The exact score is a calibration signal, not a permanent golden score: the
  artifact and component evidence remain authoritative.
- `npm run build` verifies the TypeScript contracts and all shipped bundles.

The selected five-page artifact was inspected as rasterized page 1 and page 2:
the dynamic intro/header boundary, two-column text, quote obstacles and
footer remain separated without visible glyph/box collisions. The full
release gate remains the authoritative regression check; a passing
plan/evaluator run alone does not prove typography or aesthetics. The existing
editorial-parity fixture also renders the mixed intro-illustration plus quote
case, but its historical PDF hash/line-count baseline currently reports a
calibration mismatch and was intentionally not rewritten as part of this
policy change.
