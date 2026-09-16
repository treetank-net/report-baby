# Release 1.1 — composition quality, diagnostics and placement optimization

Status: the quality-reporting, scoring and existing-candidate comparison slice
is implemented in the 1.0.2 composition checkpoint. This document replaces the
former items 08, 09 and 10. They are one process, not three independently
implemented features. Stage F is being completed in the current worktree; the
remaining work extends the procedural engine rather than adding a second search
system. Do not treat this status as a release-completion claim until its test
matrix and public interface checks pass.

The separate [visual verification record](08-10-visual-verification.md) is
part of this status: it confirms that the current slice measures and reports
quality, but does not yet guarantee a visually preferred selected candidate.

## Goal

For every complete composition candidate, Report Baby must answer:

1. is the plan legal and is all required content accounted for;
2. which measurable geometric facts describe its composition quality;
3. which facts reduce its score and why;
4. which element, input constraint, template capability or movement policy
   caused the quality loss and what bounded repair could be tried; and
5. whether a legal candidate already generated or found by further refinement
   improves the total score.

The answer must be present in `CompositionPlan` and `CompositionEvaluation` and
must survive CLI/MCP serialization. Rendering or an ad-hoc debugging script is
not required.

The evaluator is a feedback boundary, not an autonomous template author. It
scores the supplied template and candidate placements and may describe
bounded, evidence-based repairs for the existing planner to try. The caller
(normally the LLM-facing orchestration layer) may still respond to quality
suggestions by choosing another template, changing the input or requesting
another planning run. A plan that is legal but aesthetically weak must remain
explainable so that either local refinement or this upstream decision can be
made explicitly.

This task does not create a second evaluator, planner, quality service or
search loop. It extends the existing functions and data structures.

## Fixed decisions

- Hard legality remains fail-closed and is evaluated before quality scoring.
- `composition-engine.ts` remains the only owner of candidate evaluation and
  selection.
- The evaluator scores only complete plans. It never moves a placement.
- `planner-candidates.ts` and the existing text-planner refinement seam remain
  the only generators of placement proposals. The evaluator may return
  evidence-based repair proposals, but it does not mutate a plan or generate a
  replacement plan itself.
- A candidate repair is always re-planned and re-evaluated as a complete plan;
  local estimated gains never substitute for the final whole-plan score.
- The global plan score remains the selection value. Its element-attributed
  contributions must add up to the same total without counting a pairwise or
  region-level penalty more than once.
- Authored placement coordinates remain fixed when no movement bounds were
  supplied.
- Geometry is measured from the plan. Raster pixels are not an input to these
  rules.
- Natural underfill on the terminal main-flow page is allowed; empty space on
  an earlier page remains a quality signal because it may indicate a premature
  page break.
- Existing diagnostic codes and fields remain valid. Unknown evidence is
  omitted, never filled with zero or synthetic identifiers.
- Numeric thresholds and penalties are loaded from
  `server/templates/render-config.yml` through the existing typed adapter.
- `diagnostics` contain hard failures and planner warnings. `suggestions`
  contain non-blocking quality findings. Candidate comparison facts remain in
  `trace.candidateSearch`; they are not emitted as fake page diagnostics.

## Current implementation

### Plan and evaluation data

- `contracts/engine-contracts.ts` already defines `CompositionPlan`,
  `CompositionEvaluation`, `CompositionDiagnostic`, `CompositionSuggestion`,
  score components, page/slot/text spacing reports and candidate-search trace.
- Diagnostics already carry stable code, severity, message and optional
  flow/block/page/slot identifiers, but their `details` are untyped and they
  have no `why`, `remedies` or `retryable` fields.
- Suggestions already carry message, evidence and string remedies. Actionable
  score codes, including `element-proximity`, are translated into suggestions
  in `evaluator.ts`.

### Geometry and scoring

- `observability/spacing-report.ts` attaches static page geometry, slot
  occupancy, text placement spacing and resolved chrome gaps.
- `evaluation/plan-queries.ts` and `legality-geometry.ts` query placement and
  collision boxes.
- `evaluation/scoring.ts` already scores column balance, heading continuity,
  paragraph/list/table fragmentation, orphan fragments, insertion spacing,
  header spacing, glyph/text overlap and contrast.
- Fit-content blocks are measured during placement and spacing reports now
  expose occupied/empty area derived from rectangle unions. The evaluator uses
  those facts when available and retains the height-ratio fallback for legacy
  synthetic plans.

### Attribute whitespace to its owner

An empty area or an asymmetric gap is not actionable unless the report says
which decision created it. The evaluator must therefore match each measured
spacing fact to the responsible contract layer:

| Evidence | Required attribution | Typical remediation |
|---|---|---|
| content ends inside a fixed-height intro/header slot | template fixed frame or fixed-capacity policy | enable `fit_content`/`height: auto`, or deliberately keep the fixed slot |
| content ends inside a fit-content growth envelope | template growth ceiling | lower the envelope or let the next flow use the released space |
| a gap follows a reserved header/footer band | template chrome geometry | keep it when intentional; otherwise adjust the band or content anchor |
| an insertion has uneven before/after or peer gaps | insertion capability plus planner-selected position | evaluate another legal position or change the capability rhythm |
| a requested location prevents a better position | input hard constraint (`page`, `slot_id`, or explicit frame) | relax the hard constraint or provide another legal capability |
| no legal position exists in any compatible capability | template capability coverage | add/choose a compatible template capability; do not invent a fallback slot |

The current plan can often make this match indirectly through `pageTemplateId`,
`templateRef`, `slotId`, `flowId`, `fitContent`, `growthMaxHeight`, measured
boxes and insertion profiles. The public quality record must make the cause
explicit rather than forcing the caller to reconstruct it. In particular, a
large unused intro area must be reported as a consequence of a static intro
frame when that is what the template declared, not as an unexplained generic
empty region. Intentional terminal-page breathing room remains exempt from
the empty-region penalty.

This attribution also separates a weak template from a restrictive input. A
template can offer a dynamic intro and movable insertion capability; the input
can still make a position hard by supplying `page`, `slot_id` or an explicit
frame. The evaluator should report both facts when they coexist, so an
upstream caller can decide whether to change the template, the input, or the
candidate search policy.

### Candidate selection

- `layout/planner-candidates.ts` generates cross-products and local refinements
  for declared movable insertion/graphic bounds.
- `composition-engine.ts` evaluates candidates, rejects illegal candidates
  before score comparison and applies stable input order to ties.
- The engine deduplicates proposal records by signature, skips already
  evaluated refinement signatures, enforces configured round/recalculation
  budgets and stops a refinement round when it finds no improvement.
- Refinement candidates are currently generated from declared movement
  policies, not from typed evaluator repair proposals; the planner receives
  the selected plan but has no explicit selected-evaluation input or
  minimum-step schedule. Item 04 supplies bounded-search safety. This task
  adds score-directed candidate refinement on top of those limits.

### Element-to-element spacing and optional insertion pressure

Whitespace quality is not only a property of one slot. A dynamic `intro`
block, quote, image or other insertion can be individually legal while still
being too close to another material element. The spacing report now emits an
`element-proximity` observation for a relevant pair on the same page when their
horizontal ranges meet and their signed vertical gap is below
the pair's spacing-profile target from `composition_score` (normal is the
fallback when neither slot names a profile). The observation contains:

- typed `from` and `to` references (block or insertion graphic, including flow,
  block and slot identifiers when known);
- `fromBox` and `toBox` renderer-neutral geometry for direct inspection;
- `gap`, `minimumGap`, `deficit`, `movementNeeded` and `movementBudget` metrics;
- whether the insertion has a declared legal movement capability.

`fluid-y` currently materializes bounded page-local instances by dividing the
capability frame; it does not make each instance freely movable. The report
marks movement available only when the plan contains a matching
`movableInsertionFrame` from an explicit movement policy. Candidate expansion
must respect that distinction and any hard page/slot request.

The observation does not decide whether to move or defer. `ELEMENTS_TOO_CLOSE`
is a soft suggestion and exposes the evidence needed to compare both options.
Deferring an insertion to another legal slot preserves it. Omission is a
separate candidate and is forbidden by default: only a non-main insertion
block with input `allow_omission: true` may be omitted, and the plan records
that decision and marks the block trace as `omitted`. Main-flow content cannot
opt into omission. Around-wrapping insertion graphics are not compared with
ordinary main-flow line envelopes because their vertical overlap is
intentional; they are compared with the opening flow and with other insertions
where proximity is meaningful.

`scoreElementProximity` turns the summed deficit into a soft score component,
and the evaluator publishes `ELEMENTS_TOO_CLOSE` with the exact pair evidence
and remedies. The scalar plan score remains authoritative, while its component
points are deterministically shared among affected placements and conserved
exactly. The evaluator emits typed movement or optional-omission proposals;
movement proposals carry their declared legal frame, while omission proposals
carry the input opt-in. The existing engine evaluates each proposal by
generating and rescoring a complete plan. An estimated local improvement is
reported as an estimate, never as the measured score delta.

The current proximity measurement has a directional blind spot:
`elementProximityReports()` measures vertical separation only when the pair's
horizontal ranges overlap. It does not report side-by-side boxes whose
vertical ranges overlap but whose horizontal gap is too small. Stage F must
extend the pair observation to identify the measured axis (and both axis gaps
where needed), so the evaluator can distinguish “move up/down” from “move
left/right”. It must not classify intentional around-text wrapping as a
generic collision; the current exemption for ordinary main-flow line envelopes
remains, while intro-to-insertion, insertion-to-insertion and other material
pair relations are measured when their geometry makes a gap meaningful.

### Per-placement score attribution and evaluator-guided refinement

The plan score remains one scalar used by `compareCompositionEvaluations()`.
In addition, every scored placement must expose its positive and negative
point contributions and their reasons. The plan total is decomposable as the
configured base plus the sum of placement-attributed contributions. Pairwise
and region-wide rules still have one canonical penalty; when it is attributed
to multiple placements, the allocated shares must sum to that penalty rather
than duplicate it. Stable attribution uses the placed instance (page and
slot-qualified placement identity), not only a source block ID that may be
split across pages or slots.

For each negative placement contribution, the evaluator may return bounded,
machine-readable repair proposals using the existing evaluation and candidate
boundaries. A proposal identifies the affected placement, action, legal axis
or target when known, suggested displacement or destination when measurable,
the evidence that prompted it, and whether it is only an estimate. Supported
actions include moving within an already-declared legal bound, trying another
compatible page/capability, and leaving an insertion unused only when the
input semantics permit omission. Required authored content is otherwise
reassigned, never dropped. These are candidate-generation instructions, not
diagnostics phrased as commands and not edits to the selected plan.

The existing engine/refinement loop is extended procedurally:

```text
generate and evaluate bounded seed candidates
  -> select the best complete legal plan
  -> inspect its per-placement contributions and repair proposals
  -> generate a bounded neighborhood of complete alternative plans
  -> reflow affected text and all dependent placements
  -> run legality, coverage and all quality scoring again
  -> keep the best legal plan seen so far
  -> continue from that best plan while a better unexplored neighbor exists
  -> stop only at a local stop condition or the configured search budget
```

An improvement does not end refinement. If a small upward movement improves
the total score, the improved candidate becomes the next refinement center;
the planner may then test a smaller displacement, down to the configured
minimum geometry step. Search must be finite and deterministic: use the
existing round and complete-plan recalculation budgets, proposal signatures,
and visited-candidate deduplication. Stop when the bounded neighborhood has no
strictly better legal candidate, no new candidate can be generated, or the
round/calculation budget is exhausted. Preserve the best evaluated plan, not
the last attempted one. Ties retain the existing stable candidate order. Do not
add a minimum-score-improvement cutoff that discards small real gains; bound
fine search through geometry step size and existing candidate/recalculation
budgets instead.

Candidate generation considers the affected element together with nearby
elements and text boundaries. For a proximity pair it can propose moving
either eligible endpoint, or test omission/reassignment when allowed; it must
not optimize one pair in isolation if the move worsens another neighbor. For
text-box spacing it considers both the gap above and below the box. Horizontal
movement is considered only where the template exposes legal horizontal
movement or another compatible width/column capability. Every alternative is
re-laid out before its final score is compared, since text wrapping, orphan
fragments, column balance and downstream flow can change together.

#### What the current measurements can predict

The evaluator can analytically estimate a local score delta only for a
piecewise-linear geometry rule while the affected relations remain unchanged:

- `element-proximity` is a linear gap-deficit penalty inside its active range.
  If a placement moves away from a measured neighbor, the evaluator can
  calculate the pair's estimated gain as
  `min(gap increase, current deficit) * configured penalty`. The gain must
  account for every neighbor affected by that move, including any newly
  created proximity pair. With the current `element_proximity_penalty: 1`, an
  isolated one-millimetre reduction in active deficit estimates one point;
  another unit such as a rendered pixel must first be converted to the plan's
  geometry scale.
- insertion before/after text gaps, header/footer gap deficits, and glyph
  overlap area can also yield local directional estimates from their measured
  boxes while the same text lines and intersecting relations remain in place.
- A report such as “try this placement higher by Δ” is supportable as a local
  estimate when legal movement bounds and the relevant neighbor boxes are
  known. It is not a guarantee that the whole plan gains those points.

Orphan and fragmentation outcomes are discontinuous, not unknowable. The plan
already exposes line boxes, fragment membership, the gap between fragments,
and (for insertion-wrap orphans) the blocking graphic. The evaluator can use
the adjacent measured line height to propose likely recovery moves at
`±1`, `±2`, and further whole-line increments, stopping at the legal movement
bound or candidate budget. It should prefer directions that plausibly let the
isolated fragment rejoin the remaining lines of its source paragraph, while
testing the other legal direction when the surrounding geometry does not make
that choice obvious. It must not merge separate authored paragraphs to hide a
fragmentation penalty.

The current orphan rule assigns a known fixed penalty per detected orphan, so
the evaluator can estimate the score recovery if a specific orphan disappears
(currently `orphan_penalty` is 4 points per orphan). That is a predicted
component delta, not a promise: moving an image or insertion can change the
line breaks, create another orphan, affect paragraph fragmentation or move
downstream content. Each line-height probe must therefore cause a complete
re-plan and evaluation; only that result establishes the actual total-score
change. The public report distinguishes the estimated orphan recovery from
the measured candidate delta.

Scoring geometry and configured spacing targets are expressed in millimetres;
line-height probes use the measured line box height in those same plan units.
“One pixel” has no renderer-neutral meaning until a pixel scale/DPI is chosen;
the fine-search step must therefore be configured in planner geometry units,
not hard-coded as a PDF raster pixel. The implementation should test whether a
small legal step yields an actual increase in total score, but it must not
promise a fixed point gain per pixel. With the current proximity weight of one
point per millimetre of deficit, for example, an isolated one-millimetre
improvement yields one point only while that pair remains within its active
penalty range; the final candidate delta can differ when other elements or
text flow are affected.

The planner receives repair proposals through an explicit refinement input,
not by parsing human-readable suggestion messages. Extend the current
`planRefinedCandidates*` seam to receive the selected evaluation (or its
machine-readable proposals) alongside the selected plan. Keep public
`CompositionSuggestion` wording separate from internal candidate instructions,
but expose the evidence and resulting candidate comparisons through the
existing evaluation/trace output so CLI and MCP users can understand why a
move was tried and whether it improved the plan.

The implementation uses the existing spacing-report pipeline and YAML
configuration; no second planner or evaluator is introduced. The threshold
and movement budget are calibration parameters, not legality rules, and should
be validated against representative intro-plus-multiple-insertion fixtures.

## Template contract: capacity, not content dimensions

The template is the source of structural intent. It must not guess the final
height of a paragraph, title, quote, image caption, lockup or insertion before
the content has been measured.

Keep these responsibilities separate:

| Concern | Owner | What it may contain |
|---|---|---|
| page structure | page template | page size, margins, column tracks, gutter, reserved decoration and safe areas |
| slot capacity | page template | an anchor/envelope, accepted kinds/roles, min/max capacity, fit-content or growth policy and named relations |
| content geometry | planner and renderer-neutral metrics | measured line count, intrinsic block height, caption height, image ratio and resulting occupied box |
| aesthetic objective | evaluator and render configuration | gap thresholds, balance tolerances, fragmentation penalties, empty-region penalties and weights |

`frame` on a content slot is an initial anchor or legal envelope. It is not
automatically the occupied content box. A dynamic template slot uses the
existing `fit_content: true` convention; the current template parser permits
its frame height to be `0` as an empty baseline. A request-owned overlay may
also use `height: auto`. In both forms, the measured content determines the
occupied height. A slot may declare a `grow` ceiling; the ceiling is a bound,
never a default height. `grow.pushes` names affected slots or segments. It must
not be replaced with a second hard-coded `y` value for every possible text
length.

Fixed dimensions remain valid where they express real structure: page size,
outer margins, column width/gutter, a fixed ad or logo frame, or a deliberate
maximum capacity. A text slot's fixed height is valid only when the template
explicitly wants a fixed-capacity region and its overflow policy says what
happens next. Ordinary editorial text, intro lead, quote, caption, lockup and
insertion slots default to measured height.

Widths follow the same distinction. Column tracks and gutters are structural
and may be fixed. A content block uses the width of its selected slot or named
column relation; the planner must not invent per-content widths merely to make
one candidate fit. An insertion may vary within a legal movement window, but
its width changes only when the template or request explicitly exposes a legal
size range.

### Insertions have a simple authoring contract

An insertion is content first, geometry second. The public request keeps the
existing `placement_requests` boundary, but the ordinary form contains only
the flow and block. The block's semantic kind is derived from `data.flows`; an
optional `kind` hint may narrow capability matching but must agree with that
block. A slot, page, region, frame or sizing override is optional. The author
does not repeat the template's dimensions, padding, max height, push graph or
collision rules.

Insertion content remains required unless its source block explicitly sets
`allow_omission: true`. This is permission for candidate search to compare a
complete plan with that insertion omitted; it is not a planner instruction to
drop the block. Main-flow blocks cannot opt in. Omission is recorded as a plan
decision and as `status: omitted` in the block trace, and coverage accepts only
that explicit recorded case.

```yaml
placement_requests:
  insertions:
    - flow_id: quote
      block_id: quote-07
      preferred_region: body
    - flow_id: article-media
      block_id: image-03
      preferred_region: body
```

The target request shape uses the following precedence:

| Request fields | Meaning | Required geometry supplied by |
|---|---|---|
| `flow_id`, `block_id` and optional `kind` hint | enumerate legal compatible insertion capabilities across the selected page-template assignments | the selected template and measured content |
| the above plus `preferred_slot` or `preferred_region` | consider compatible capacity in the named place first, then other legal capabilities | the selected template and measured content |
| the above plus `slot_id` | require that named capability; fail with evidence when it cannot host the block | the selected template and measured content |
| the above plus `page` | constrain the insertion to that materialized page; this is a deliberate hard location | the selected template and measured content |
| the above plus `frame` | create a request-owned overlay when no persistent slot is suitable | the request supplies the anchor; the planner supplies measured height and template defaults |

`slot_id` and `page` are hard constraints. `preferred_slot` and
`preferred_region` are soft preferences: candidate generation considers the
preferred capability first, but may use another compatible capability when
that produces a better legal plan. The contract does not overload one field
with both meanings. A future hard region constraint, if required, receives a
separate name.

`sizing` is an optional escape hatch for a deliberate fixed-capacity or
explicitly bounded overlay. When it is absent, the adapter inherits
`fit_content`, growth ceiling, overflow and named push relations from the
compatible template capability. `frame` is therefore not required for a
normal quote, image, table or chart insertion; it is required only when the
request intentionally creates a new per-run slot. A request-owned frame still
does not require a hand-written `max_height`, `pushes` list or movement window.

The migration makes `page`, `frame` and `sizing` optional in the simple
`insertions` form while preserving the explicit overlay form for existing
special compositions. A request must not mix a partial frame with a template
slot preference in a way that leaves the anchor ambiguous; preflight returns a
diagnostic naming the missing or conflicting field.

This is a contract change in the input adapter, not a new insertion entity.
`contracts/input/schema.ts` accepts the content-first form, while
`adapters/request-insertion-slots.ts` resolves a compatible static capability
before it considers a request-owned overlay. The adapter copies the selected
template's sizing defaults into the in-memory slot; it does not copy those
defaults into the request or into a second configuration file. The plan then
records both the source (`template` or `request-overlay`) and the resolved
occupied box so diagnostics can explain the result.

The planner resolves this request in order:

1. enumerate compatible insertion-slot capabilities declared by every
   selected page template that the request is allowed to use;
2. measure the block, including caption and intrinsic aspect ratio;
3. materialize a bounded set of page-local slot instances from each compatible
   capability;
4. derive the occupied height and use one of the discrete widths or column
   spans exposed by the template;
5. apply the slot's fit-content and overflow policy;
6. build complete plans for the resulting candidate positions;
7. reflow or push lower-priority content using named template relations; and
8. report the measured box, gaps and any quality penalty so the existing
   engine can select the best complete legal candidate.

Explicit coordinates and fixed dimensions remain available for a deliberate
special composition, but they are the exception. A normal quote or image must
be usable without a hand-written `frame`, `max_height`, `pushes` list and
movement window. If no compatible template slot exists, the planner returns a
diagnostic with the missing capability and remediation. It silently invents
neither a slot nor a geometry fallback. A request-owned overlay is created only
when the author provided its explicit `frame`; the normal content-first form
never invents an undeclared capability as a rescue path. Materializing one or
more page-local instances from a declared reusable capability is normal
planning, not implicit fallback slot creation.

### Templates predefine insertion placement capabilities

An insertion slot in a page template is not necessarily one permanently
occupied rectangle. It may be a reusable capability describing how compatible
content can be placed in a region. One capability can materialize several
page-local slot instances up to a declared per-page capacity. This avoids
requiring one authored slot for every quote in a long article while keeping
the legal geometry under template control.

Keep three concepts distinct:

| Concept | Meaning |
|---|---|
| block kind or role | semantic content such as quote, image, table or intro |
| slot placement policy | template-owned rule describing fixed, fit-content or movable geometry |
| materialized slot | one page-local candidate or accepted instance with a concrete box |

Release 1.1 extends the existing slot declaration rather than adding an
insertion class or a parallel slot hierarchy. The target placement policy is a
closed union:

```ts
type TemplateSlotPlacement =
  | { mode: 'fixed' }
  | { mode: 'anchored-fit-content' }
  | {
      mode: 'fluid-y';
      region: string;
      maxInstancesPerPage: number;
      distribution?: 'free' | 'balanced';
    };
```

- `fixed` requires a complete `x`, `y`, `width` and `height` frame.
- `anchored-fit-content` requires `x`, `y` and `width`; measured content
  supplies height up to the declared capacity.
- `fluid-y` requires a horizontal frame (`x` and `width`) and a bounded region;
  the usable vertical interval is derived from that region after chrome and
  reserved slots are known. It does not accept an authored `y`.
- A template offers alternative widths or column positions as separate named
  capabilities. Release 1.1 does not search an arbitrary continuous width
  range. Choosing between `image-wide`, `image-half` and `image-column` is a
  bounded capability choice.
- `maxInstancesPerPage` limits runtime materialization. It is not the number of
  static slot records that must be written into the template.

Example template declaration:

```yaml
slots:
  quote-wide:
    type: text
    role: quote
    frame: { x: 0.081, width: 0.838 }
    fit_content: true
    placement:
      mode: fluid-y
      region: body
      max_instances_per_page: 2
      distribution: balanced
    spacing_profile: normal

  quote-column:
    type: text
    role: quote
    frame: { x: 0.081, width: 0.404 }
    fit_content: true
    placement:
      mode: fluid-y
      region: body
      max_instances_per_page: 4
      distribution: balanced
    spacing_profile: compact

  image-wide:
    type: image
    frame: { x: 0.25, width: 0.50 }
    fit_content: true
    placement:
      mode: fluid-y
      region: body
      max_instances_per_page: 1
      distribution: free
    spacing_profile: normal

  fixed-advertisement:
    type: image
    frame: { x: 0.70, y: 0.55, width: 0.22, height: 0.30 }
    placement: { mode: fixed }
```

The exact identifiers are template vocabulary. A quote remains quote content
when placed in `quote-column`; the planner must not silently turn it into an
ordinary paragraph. `intro` remains its own required flow, but its image and
lead reuse the same measurement, fit-content and relation mechanics as other
non-main placements.

For every block, the resolver returns all capabilities compatible with its
flow, kind, role and explicit request constraints. `planner-candidates.ts`
then materializes deterministic instances. Instance IDs are derived from the
capability, page and ordinal, for example `quote-wide@page-4#2`; they are plan
records, not persisted template or domain entities.

The movement interval comes from the selected template region. Candidate
density, refinement counts and global search budgets come from
`server/templates/render-config.yml`; neither the content author nor every
template repeats them. Static slots continue to work unchanged.

If requested insertions exceed all compatible capacity, planning fails with
the requested count, achievable count, considered templates/pages and
unplaced block IDs. Remedies may recommend adding a template span, enabling a
denser compatible capability such as `quote-column`, or reducing optional
content. The planner never enables a capability that the selected templates or
request did not allow.

The template expresses relationships, not a pixel choreography:

```yaml
slots:
  header-lockup:
    frame: { x: 0.08, y: 0.02, width: 0.34, height: 0 }
    fit_content: true
    grow: { axis: y, max_height: 0.16, pushes: [header-title, main] }
  header-title:
    frame: { x: 0.08, y: 0.06, width: 0.84, height: 0 }
    fit_content: true
    grow: { axis: y, max_height: 0.16, pushes: [main] }
  main:
    frame: { x: 0.08, y: 0.18, width: 0.84, height: 0 }
    fit_content: true

relations:
  - { from: header-lockup, to: header-title, relation: after, gap: header-content }
  - { from: header-title, to: main, relation: after, gap: header-content }
```

The numeric frames establish initial envelopes and safe maxima; they do not
prescribe final header height. The planner measures the lockup/title, resolves
the relations, pushes `main`, and reports the actual gaps.

### Template-to-quality lifecycle

Every candidate follows the same sequence:

```text
template structure and slot envelopes
  -> materialize selected page slots and insertion capabilities
  -> measure each block with renderer-neutral metrics
  -> resolve fit-content growth and named push relations
  -> place/reflow content while checking hard constraints
  -> attach occupied boxes, gaps and obstacle evidence to the plan
  -> score soft composition quality from those measured facts
  -> compare only complete legal candidates
```

The evaluator does not ask the template for a preferred final height and the
template does not receive a score to mutate itself. A template declares
capacity and relationships; the evaluator judges the resulting composition.

### Numeric ownership

- Template YAML owns intentional structural geometry and named relation tokens.
- `server/templates/render-config.yml` owns renderer-wide thresholds, penalties,
  tolerances and tunable defaults.
- Planner code owns no visual constants or fallback dimensions.
- The plan records resolved values, so diagnostics can explain which measured
  gap or occupied box caused a score change.
- A threshold is not duplicated in a template, TypeScript constant and test.
  Tests load the same configuration seam as production.

The objective is not to fill every square millimetre. Unexplained empty space,
unbalanced columns and accidental gaps are penalized; whitespace explained by
the template's relation, reserved decoration, safe area or end-of-content is
neutral. This prevents the optimizer from producing a denser but less readable
document.

## Target diagnostic contract

Do not add a generic `Finding` hierarchy. Extend the two existing public
records directly:

```ts
interface CompositionDiagnostic {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  why?: string;
  flowId?: string;
  blockId?: string;
  page?: number;
  slotId?: string;
  details?: Record<string, unknown>;
  remedies?: string[];
  retryable?: boolean;
}

interface CompositionSuggestion {
  code: string;
  message: string;
  why?: string;
  page?: number;
  flowId?: string;
  blockId?: string;
  evidence?: Record<string, unknown>;
  remedies?: string[];
  retryable?: boolean;
}
```

Existing scope fields remain top-level. Do not add a second nested `scope`
object containing the same identifiers.

Add `evaluation/diagnostic-catalogue.ts` as a table of message builders keyed
by stable codes. It receives already-measured facts and supplies `message`,
`why`, `remedies` and `retryable`. It does not perform geometry calculations.

Call sites remain responsible for factual identifiers and measurements:

```text
planner/layout failure
  -> diagnostic(code, factual context)
  -> catalogue decorates the diagnostic

legal plan
  -> spacing report
  -> scoring functions create score components
  -> negative score components become suggestions through the catalogue
```

Hard and soft results remain separate. A negative score cannot reject a legal
plan unless a separate hard constraint already exists.

The first migrated hard families require these factual payloads:

| Family | Required facts when known |
|---|---|
| missing slot | flow/block, searched page range, selected template per page, compatible slot IDs |
| insertion capacity exceeded | requested block IDs/count, compatible capabilities, per-page capacities, achievable count and unplaced block IDs |
| overflow | required and available height/lines/rows, slot box, remaining content range |
| bounds/collision | both boxes, tolerance, page and owning placements |
| forbidden continuation | first placed page/slot, attempted next page/template, route policy |
| unmet hard requirement | requirement code, expected value/location and observed value/location |
| search exhaustion | configured limits, generated/planned/legal counts and stop reason |

The catalogue is not allowed to emit a remedy requiring a capability absent
from those facts. For example, “move insertion” is offered only when a movement
window exists in candidate evidence.

## Target spacing contract

### Data-shape policy

Not every value emitted by a planner is a new domain contract. The following
boundary keeps the data model small:

- document input, template geometry, slot compatibility, hard diagnostics and
  candidate identity remain typed because they control legality or selection;
- score components keep their stable `code`, `value` and `points`, while their
  rule-specific measurements remain in the existing `details` map;
- spacing, region and obstacle measurements use one small identity envelope
  (`kind`, page and optional placement identifiers) plus dedicated numeric,
  categorical and geometric channels;
- a producer emits only facts it can establish. It does not fill unavailable
  values with zero or create an interface containing every possible future
  metric;
- tests are the contract for rule-specific facts: each scoring case asserts
  the keys it needs, and missing facts make that rule not measurable rather
  than silently producing a penalty;
- decisions and phase trace entries already use key/value details and do not
  need another wrapper.

This is deliberately a hybrid model. It avoids a hierarchy of one-off report
interfaces without turning legality, candidate ordering or renderer geometry
into unvalidated dictionaries.

Extend `CompositionPlanSpacingReport` with one extensible observation stream
for facts that are derived from the current plan. Do not create a separate
interface for every scoring rule or insertion variant:

```ts
interface CompositionSpacingObservation {
  kind: 'region' | 'obstacle' | 'insertion-rhythm';
  page: number;
  regionId?: string;
  slotId?: string;
  blockId?: string;
  graphicId?: string;
  box?: CompositionBox;
  metrics: Record<string, number>;
  profile?: 'compact' | 'normal' | 'open';
  reasons?: string[];
  intervals?: Array<{ x: number; width: number }>;
}
```

Metrics are numeric by construction. Labels/reasons and geometric intervals
have separate fields, so one key cannot change between a number and an object
depending on the producer.

The identity envelope is deliberately small. A producer emits only the facts
that it can establish for that observation; a missing fact is not silently
replaced with zero. Tests define the required keys for each scoring case, and
the evaluator treats an absent key as “not measurable” rather than inventing a
penalty. Score details and suggestions reference these records instead of
recalculating boxes.

## Measurement rules

### Occupied boxes

`spacing-report.ts` gathers physical occupancy once:

- ordinary and insertion text use line boxes;
- tables use table-placement boxes, not their internal cell boxes;
- images, charts, metrics and lockups use block-placement boxes;
- free graphics use graphic-placement boxes even when `paint: false`, because
  an invisible obstacle still reserves geometry;
- glyph placements do not add independent occupied area because they decorate
  an existing block or graphic;
- duplicate representations of the same atomic content are counted once.

Every box is clipped to the union of the measured region's slot boxes before
calculating area. A region may contain disjoint boxes, so it is not collapsed
to one bounding rectangle. `occupiedArea` is the geometric union of occupied rectangles, not the area of
their overall bounding box and not the raw sum of overlapping rectangles.

### Usable and intentionally reserved area

For one region:

```text
usable area = union of region usable boxes
              minus intersecting chrome bands
              minus template slots marked reserved

empty area = usable area minus union of occupied boxes
```

An unconsumed fit-content maximum is not a reservation after measurement. Its
unused part is reported as `UNUSED_FIT_CONTENT_ENVELOPE` when it still pushes
or blocks another slot.

Whitespace is explained only when the plan identifies its source as chrome,
a reserved slot, an obstacle, or the end of available content. Merely finding
an empty rectangle does not make it intentional.

### Vertical gaps and columns

For each materialized text slot, order occupied intervals by `y`. Measure:

- slot top to first content;
- the end of one interval to the start of the next;
- last content to slot bottom.

Gaps intersecting a declared obstacle are recorded against that obstacle.
The final bottom gap is not penalized when the relevant flow has no remaining
content. Column fill compares sibling text slots in the same region and page;
it never compares a sidebar with `main` or a footer with a body column.

### Insertion rhythm, symmetry and spacing profiles

Insertion quality is evaluated against the usable region selected by the
template, not blindly against the physical paper edge. The usable region
already accounts for page margins, dynamic chrome and reserved bands. The
spacing report still records physical edge distances for explanation, but
quality comparisons use the intended region unless the template explicitly
anchors a capability to the page.

For every insertion instance, record:

- the nearest main-text gap before and after its occupied box;
- its distances from the start and end edges of the usable region;
- gaps to the preceding and following insertion in the same region;
- the resolved spacing profile and numeric target used for comparison;
- whether a gap is constrained by chrome, a reserved slot, an obstacle or the
  beginning/end of available content; and
- the width of every remaining text interval beside the insertion.

The template selects a semantic `spacing_profile` such as `compact`, `normal`
or `open`. The brand may select the default profile, but it does not supply
independent numeric geometry. The profile and named relation resolve through
`server/templates/render-config.yml`, so header, rule, body and insertion gaps
can share one spacing rhythm without copying a number into several templates.
For example, a normal header-to-rule separation and a normal insertion-to-text
separation should resolve to the same or explicitly related target rather than
unrelated literals.

The evaluator applies these rules:

1. The before/after text gaps of an insertion should be approximately
   symmetric unless one side is explained by a boundary or another obstacle.
2. A `balanced` fluid capability should minimize dispersion between the usable
   region's outer gaps and the gaps between multiple insertion instances.
3. Adjacent insertion gaps should follow the selected spacing profile. A
   compact page rhythm favours compact gaps; an open rhythm favours wider
   gaps. Density alone is not rewarded.
4. A candidate is penalized when an insertion leaves a text interval narrower
   than the configured usable-line threshold, even if the rectangles do not
   collide.
5. Symmetry is a soft quality signal. It cannot override hard bounds, content
   coverage, keep rules, or an explicitly authored fixed placement.
6. An exact geometric tie is unnecessary. Tolerances and penalties come from
   render configuration and the plan reports the measured delta.

#### Beauty rules for multiple insertions

When a page contains two or more insertions, visual quality is a relationship
between the whole group and its surrounding page—not a collection of
independent slot checks. The planner/evaluator therefore also applies these
rules:

1. The insertion group should be balanced against both usable-region edges.
   The top/bottom (or left/right for a horizontal group) outer gaps should be
   approximately symmetric after excluding documented chrome, reserved bands
   and content boundaries.
2. Gaps between neighbouring insertions should use the same spacing scale as
   the gaps from the group to the surrounding text. A narrow rhythm favours
   narrow outer and inner gaps; a wide rhythm favours wide outer and inner
   gaps. Mixing a narrow insertion gap with a wide page margin is penalized
   unless a hard boundary explains it.
3. The reference gap is the template/brand spacing token resolved for the
   selected profile (for example, the header-to-rule distance). Text-to-
   insertion, insertion-to-insertion and insertion-to-region-edge gaps should
   be close to that reference within the configured tolerance. The evaluator
   reports the reference token and each measured delta; it does not infer a
   new numeric constant from one candidate.
4. Symmetry is measured in the same coordinate system as the usable region,
   not from the paper edge. A page with a dynamic header or footer is not
   penalized merely because its physical edge distance differs from another
   page; it is penalized when the unexplained usable-region gaps are uneven.
5. If several legal candidates satisfy content coverage, prefer the candidate
   with lower group asymmetry, lower spacing-profile deviation and fewer
   narrow text intervals. These are soft ranking signals and never override a
   hard placement, keep, continuation or page-capacity rule.

For an insertion group, the plan must expose the measured outer gaps, every
neighbour gap, the resolved reference token/profile, and the reason for any
intentional asymmetry. This makes a dense page explainable without requiring a
rendered-PDF inspection script.

Insertion-rhythm evidence uses the same observation shape:

```ts
{
  kind: 'insertion-rhythm',
  page: 2,
  slotId: 'quote-auto-1',
  regionId: 'main',
  metrics: {
    beforeTextGap: 4.2,
    afterTextGap: 5.1,
    textGapAsymmetry: 0.9,
    regionStartGap: 18,
    regionEndGap: 22,
    previousInsertionGap: 6
  },
  profile: 'normal',
  intervals: [{ x: 18, width: 32 }],
  reasons: ['content-boundary']
}
```

One spacing fact is calculated once in `spacing-report.ts`. Scoring and
diagnostics reference the observation and its named facts rather than
reconstructing neighbour boxes. New rules may add facts without expanding the
central contract; their tests must document the keys they require.
Candidate comparison may favour a more symmetric arrangement only after both
candidates are complete and legal.

### Dynamic intro and chrome

- Intro remains its own flow. A fit-content cover and lead consume their
  measured block heights in the intro slots declared by the selected template.
- `main` uses the content slot after higher-priority fit-content slots have
  pushed or resized it. No adapter joins `intro` to `main` and no
  `main.startPage` workaround is introduced.
- Header extent is the union of planned header-flow line and block placements,
  including lockup. The gap to body content is measured from that extent or
  from the configured header rule when the rule is lower.
- Footer gap is measured analogously against the footer flow/rule.
- Image captions belong to the image occupied box. Quote glyphs decorate the
  quote and do not enlarge the obstacle unless their configured offsets extend
  beyond its measured box.

## Quality codes and scoring

Required non-blocking suggestion codes are:

- `EXCESSIVE_EMPTY_REGION`;
- `UNBALANCED_COLUMN_FILL`;
- `UNBALANCED_INSERTION_GAP`;
- `ASYMMETRIC_INSERTION_TEXT_GAPS`;
- `UNBALANCED_INSERTION_DISTRIBUTION`;
- `INCONSISTENT_SPACING_RHYTHM`;
- `NARROW_TEXT_INTERVAL_AROUND_INSERTION`;
- `UNUSED_FIT_CONTENT_ENVELOPE`;
- `HEADER_GAP_TOO_SMALL`;
- `FOOTER_GAP_TOO_SMALL`;
- `ORPHAN_FRAGMENT`.

`PLACEMENT_CANDIDATE_IMPROVEMENT` is not a diagnostic code. Candidate scores
and the reason the winner was selected belong in `trace.candidateSearch`.

Remedies must respect ownership. A forbidden-continuation failure may
recommend selecting or editing a template whose flow policy allows
continuation; it must not imply that document content can override a
template-owned rule.

Add one scoring function per measurable responsibility in
`evaluation/scoring.ts`. Helper calculations live in `plan-queries.ts` or
`spacing-report.ts` when reused. Do not create a second scorer module that
repeats current components.

New configuration keys under `composition_score` cover:

- minimum material empty-region area/height and its penalty;
- maximum sibling-column fill difference and its penalty;
- maximum insertion before/after-gap imbalance and its penalty;
- insertion distribution dispersion and its penalty;
- compact, normal and open spacing targets and deviation penalties;
- minimum usable text interval beside an insertion and its penalty;
- maximum retained fit-content envelope ratio and its penalty;
- minimum footer/content gap and its penalty.

Each component returns the measured value, points and exact evidence records.
Configuration validation rejects missing, negative or non-finite thresholds.
Tests read expected thresholds from the YAML adapter rather than copying
numeric literals.

The new score formulas are fixed before calibration:

```text
empty-region ratio = emptyArea / usableArea
empty-region excess = max(0, ratio - configured ratio threshold)
empty-region points = -excess * configured penalty
  (only when the largest unexplained vertical gap also exceeds its height threshold)

column imbalance = 1 - min(occupiedHeight) / max(occupiedHeight)
column points = -max(0, imbalance - configured threshold) * configured penalty

fit-content unused ratio = (envelopeHeight - occupiedHeight) / envelopeHeight
fit-content points = -max(0, ratio - configured threshold) * configured penalty

footer deficit = max(0, configured minimum gap - measured gap)
footer points = -deficit * configured penalty

insertion text-gap asymmetry = abs(beforeTextGap - afterTextGap)
insertion symmetry points =
  -max(0, asymmetry - configured tolerance) * configured penalty

balanced distribution dispersion =
  mean(abs(each unexplained outer/inter-insertion gap - mean gap))
distribution points =
  -max(0, dispersion - configured tolerance) * configured penalty

spacing rhythm deviation = abs(measured gap - resolved profile target)
spacing rhythm points =
  -max(0, deviation - configured tolerance) * configured penalty
```

The existing insertion-spacing formula (internal imbalance, external
imbalance and cross-stream spread) and existing orphan penalty are preserved;
they read the shared evidence instead of recomputing it. Separate configured
warning thresholds decide whether their negative points also create a
user-facing suggestion.

## CLI and MCP behavior

The existing `diagnostics` request mode remains the control surface:

- compact/default output returns codes, concise messages, affected page/block
  identifiers, the highest-impact remedies and a compact `compositionQuality`
  object containing `status`, `score` and `passedMetrics`;
- full output additionally returns `why`, complete evidence, score breakdown,
  spacing records and candidate trace;
- neither mode requires a generated PDF;
- truncation limits, if needed, are YAML configuration and report how many
  findings were omitted.

`interfaces/mcp/responses.ts`, `interfaces/mcp/render-tools.ts` and the CLI
response path serialize the same evaluation. They may format it differently
but may not drop hard violations or change codes.

## Implementation status (1.0.2)

Stages A-D are wired through the existing planner/evaluator seam. The plan
exposes region, obstacle and insertion-rhythm observations; scoring reads
those observations for empty regions, sibling-column imbalance, insertion
symmetry/distribution, spacing rhythm, narrow intervals, fit-content envelopes
and footer gaps. Thresholds and penalties are loaded from
`server/templates/render-config.yml`. Slot-declared `spacing_profile` values
resolve to the shared compact/normal/open targets; an absent profile uses the
normal target. The closed `fixed`, `anchored-fit-content` and `fluid-y` slot
placement union is validated and fluid capabilities are materialized into
bounded deterministic page-local instances. Negative quality components
produce actionable suggestions without changing hard legality. The score is
currently plan-wide; element-pair evidence is not yet a conserved
per-placement score ledger, and suggestions do not yet drive another bounded
round of placement generation. Ranking calibration and deterministic search
budgets are maintained by item 04.

## Implementation sequence

### Stage A — freeze plan facts

1. Inventory every built-in page template's structural envelope, fit-content
   flag, growth ceiling, push relation and overflow policy. Mark content-
   dependent dimensions that are currently hard-coded.
2. Extend the existing slot schema with the closed placement-policy union.
   Convert repeated fixed quote positions into reusable capabilities only where
   the template intends planner-controlled placement; retain deliberately
   fixed advertisements and other authored boxes.
3. Define `compact`, `normal` and `open` as categorical template/brand choices
   and map them to one typed spacing scale in `render-config.yml`. Resolve
   template override, then brand default, then the configured system default.
4. Define the content-first insertion input and migration rules above, then
   add schema/adapter fixtures for static-capability, reusable-capability and
   explicit-overlay requests.
5. Materialize deterministic page-local slot instances from reusable
   capabilities, with stable capability/page/ordinal IDs and per-page capacity
   enforcement.
6. Add region, obstacle and insertion-rhythm spacing types to
   `engine-contracts.ts`.
7. Extract shared rectangle clipping, union-area and interval calculations into
   the existing composition geometry directory.
8. Extend `attachPlanSpacingReport()` to create region, obstacle and insertion-
   rhythm records from already-materialized placements.
9. Add plan-only fixtures proving deduplication, clipping, reserved bands,
   fit-content shrinkage, final-content gaps and multiple instances of one slot
   capability.

The inventory and fixtures must distinguish a structural frame from measured
occupied content. No scoring or candidate selection changes in this stage.

### Stage B — actionable hard diagnostics

1. Extend the existing diagnostic and suggestion fields.
2. Add the catalogue and migrate one family at a time: missing slot, overflow,
   bounds/collision, forbidden continuation, unmet hard requirement and search
   exhaustion.
3. Preserve codes and severity; compare old and new hard-violation sets.
4. Preserve the enriched payload through CLI and MCP.

### Stage C — dynamic intro, chrome and obstacle evidence

1. Make intro, header, footer and insertion occupied boxes complete in the
   spacing projection.
2. Remove score-side geometry reconstruction where the same fact now exists
   in the report.
3. Add first-page and continued-page assertions for exact reported gaps.

This stage changes observability only. Geometry bugs found here are fixed in
their existing placement function and covered separately; the report must not
silently compensate for a bad plan.

### Stage D — quality scoring and suggestions

1. Add and validate YAML spacing profiles, symmetry tolerances, narrow-text
   limits and penalties.
2. Add score components using the shared evidence, including insertion-to-text
   symmetry, multi-insertion distribution and spacing-rhythm consistency.
3. Map negative components to suggestions.
4. Prove that scores change while plan geometry and hard legality remain
   unchanged for a fixed candidate.

### Stage E — select among existing candidates

1. Use existing movable insertion/graphic fixtures and one reusable fluid-slot
   fixture to produce at least two complete legal candidates with different
   quality scores.
2. Confirm `compareCompositionEvaluations()` selects the higher score and
   preserves stable order for an exact tie.
3. Confirm an aesthetically better illegal candidate cannot win.
4. Keep this baseline separate from evaluator-guided search: prove the scorer
   and selector agree before adding repair proposals.

### Stage F — attribute quality and iteratively refine the best plan

1. Extend the existing evaluation result with per-placement positive and
   negative point contributions. Preserve the existing scalar `score` and
   `scoreBreakdown`; assert that the configured base plus all attributed
   contributions equals the scalar total. Attribute pairwise and region-wide
   penalties once across their affected placements, with no duplicated points.
   Keep penalty magnitudes tunable in `render-config.yml`; validate configured
   penalty weights as finite and non-negative so a negative `orphan_penalty`
   cannot turn an orphan into a score bonus. The orphan penalty remains a
   flat per-orphan weight unless later calibration justifies severity scaling.
2. Migrate score components one by one. Use existing plan/spacing references
   and measurements to identify affected placements. Where a metric has only a
   page/region scope, attribute its total to the participating placements by a
   documented deterministic rule rather than inventing a culprit. Extend
   proximity evidence beyond today's vertical-gap-only, horizontally
   overlapping pair case to also measure relevant side-by-side horizontal
   gaps and provide the axis/direction needed by repair proposals.
3. Add machine-readable repair proposals to the existing evaluator/planner
   refinement boundary. Do not infer actions by parsing `message`, `remedies`
   or other user-facing prose. Each proposal carries the affected placement,
   action, direction/target or destination when measurable, legal capability
   evidence, and estimated-versus-measured status.
4. Pass the selected plan's evaluation/proposals to
   `planRefinedCandidates*()`. Keep `composition-engine.ts` as the one loop
   owner and `planner-candidates.ts` / `text-planner.ts` as the proposal and
   complete-plan generators.
5. Generate bounded neighbors around implicated placements: vertical and
   horizontal movement only inside declared bounds; compatible page/slot or
   width alternatives only when selected templates permit them; omission only
   when the input explicitly allows that content to be omitted. Test both
   endpoints of a proximity pair and include all nearby text/element
   relationships in the candidate's complete reflow.
6. For continuous local gap rules, use measured neighboring boxes to estimate
   useful direction and distance to a target gap. For orphan/fragmentation or
   text-wrap metrics, use the affected line boxes and blocking placement to
   generate bounded probes in increments of one measured line height in each
   plausible legal vertical direction (`±1` line, `±2` lines, and so on).
   Estimate a recoverable orphan's known component penalty, but label it as an
   approximation. Every proposal is still fully replanned, legality-checked,
   coverage-checked and rescored before its actual score delta is reported.
7. Continue from the best plan seen after an improvement, including small
   improvements. Use a coarse-to-fine step schedule toward a configured minimum
   geometry step; add and validate that setting under the existing
   `composition_search` YAML configuration in `render-config.yml` and its typed
   adapter. Calibrate the step and existing round/recalculation budgets against
   plan-only fixtures. Stop only when no strictly better legal neighbor is
   found, no new proposal exists, or a configured budget is exhausted.
   Deduplicate by proposal signature, prevent cycles, retain the best plan
   rather than the last attempted one, and preserve deterministic tie order.
8. Extend candidate trace and public CLI/MCP quality output with placement
   contributions, repair proposals tried, complete-candidate score deltas and
   the reason refinement stopped. Estimated local deltas must never be
   presented as measured candidate outcomes.
9. Add plan-only tests for score conservation, movement direction, interactions
   with neighboring elements, wrap/orphan changes after reflow, optional
   omission, multi-round incremental improvement, ties, cycle prevention and
   every stop condition. Keep one rendered artifact check for whether the
   selected plan is painted as reported.

The public candidate trace separates estimates from outcomes: a repair
proposal's `estimatedPoints` is advisory; `repairAttempts` reports whether it
was materialized, deduplicated, skipped by budget or evaluated, and the actual
geometry displacement tested for each move; only an evaluated complete-plan
candidate receives an actual `scoreDelta`. Candidate results link back through
`repairProposalIds`, while the engine retains the best legal plan and
deterministic candidate order.

### Stage G — remove duplicated calculations

After all callers consume shared spacing evidence, delete superseded
header/insertion/orphan box calculations. Every deletion names its replacement
query and retains the old behavior assertion.

## File ownership

| File/module | Responsibility after the change |
|---|---|
| `contracts/engine-contracts.ts` | public plan/evaluation evidence shapes |
| `geometry/*` | rectangle clipping, union and interval calculations only |
| `observability/spacing-report.ts` | derive reusable measured facts once per plan |
| `evaluation/plan-queries.ts` | read and group plan/spacing facts |
| `evaluation/legality*.ts`, `content.ts` | hard violations only |
| `evaluation/diagnostic-catalogue.ts` | wording, remedies and retryability from supplied facts |
| `evaluation/scoring.ts` | numeric quality components and conserved point attribution for legal plans |
| `evaluation/evaluator.ts` | assemble legality, score attribution, public suggestions and machine-readable repair proposals |
| `composition-engine.ts` | own iterative legal-first evaluation/refinement, total-score selection and candidate trace |
| `layout/text-planner.ts`, `layout/planner-candidates.ts` | consume repair proposals and generate bounded complete-plan alternatives |
| `template/contracts.ts` | validate fixed, anchored-fit-content and reusable fluid-y slot policies |
| `layout/page-state.ts` | materialize page-local instances and enforce per-page slot capacity |
| `layout/planner-candidates.ts` | generate bounded proposals from template capabilities and declared movable placements |
| `contracts/input/schema.ts` | validate the simple insertion form and explicit-overlay escape hatch |
| `adapters/request-insertion-slots.ts` | resolve template capability, inherit defaults and materialize per-run overlays |
| brand contracts/theme adapter | select an optional categorical spacing-profile default; never introduce independent numeric gaps |
| `adapters/render-config.ts` | resolve spacing profiles, score penalties, local geometry step and search budgets from the shared YAML configuration |
| MCP/CLI adapters | preserve and format the same result |

## Test matrix

| Requirement | Cheapest sufficient proof | Target test |
|---|---|---|
| region union area does not double-count overlap | plan-only synthetic geometry | `test-structure-scoring.mjs` |
| dynamic template height follows measured content | plan-only template/slot fixture | `test-editorial-plan-contract.mjs` |
| fixed structural dimensions remain stable while content dimensions grow | plan-only two-content-length fixture | `test-report-chrome.mjs` |
| one fluid capability places seven quotes across five pages without seven authored slots | plan-only reusable-capability fixture | `test-dynamic-insertion-slots.mjs` |
| template alternatives allow wide and column quote geometry without changing quote semantics | plan-only capability-selection fixture | `test-dynamic-insertion-slots.mjs` |
| insertion capacity exhaustion reports requested, achievable and remaining blocks | plan-only illegal fixture | `test-dynamic-insertion-slots.mjs` |
| symmetric insertion spacing outranks an otherwise equivalent asymmetric candidate | two plan-only candidates | `test-structure-scoring.mjs` |
| compact and open spacing profiles favour their corresponding gap scale | plan-only profile pairs | `test-structure-scoring.mjs` |
| multi-insertion outer/inner gaps stay symmetric and follow the same reference rhythm | two- and three-insertion plan-only candidates | `test-structure-scoring.mjs` |
| intentional asymmetry is explained by chrome or a reserved boundary | plan-only boundary fixture | `test-structure-scoring.mjs` |
| chrome/reserved area is intentional | plan-only template fixture | planning section of `test-report-chrome.mjs` |
| unused fit-content envelope is visible | plan-only measured block fixture | `test-editorial-plan-contract.mjs` |
| caption is included in an insertion obstacle | plan-only placement boxes | `test-dynamic-insertion-slots.mjs` |
| intro pushes main without changing flow identity | plan-only first-page fixture | `test-editorial-plan-contract.mjs` |
| hard diagnostic gains why/remedy without changing code | plan-only failure fixtures | `test-text-composition-engine.mjs` |
| compact/full interfaces preserve diagnostics | one request per interface, no PDF | `test-public-mcp-contract.mjs`, `test-cli.mjs` |
| legal higher-quality candidate wins | plan-only candidate fixture | `test-structure-scoring.mjs` |
| element contributions sum to the existing whole-plan score without pairwise double-counting | plan-only scored pair and multi-neighbor fixtures | `test-structure-scoring.mjs` |
| proximity evidence identifies vertical and horizontal gap direction | plan-only adjacent-box and stacked-box fixtures | `test-structure-scoring.mjs` |
| a small legal move can improve a local continuous metric but final selection uses complete-plan score | two or more complete plan candidates | `test-text-composition-engine.mjs` |
| multiple incremental improvements continue refinement until local stop or configured budget | deterministic synthetic planner/evaluator, no PDF | `test-text-composition-engine.mjs` |
| wrap/orphan changes are measured after replanning rather than predicted as a local derivative | candidate pair with changed line boxes | `test-structure-scoring.mjs` |
| orphan repair proposals probe legal positions in measured one-line increments and label recovered orphan points as estimates | line-box plus blocking-image fixture and complete replanned candidates | `test-text-composition-engine.mjs`, `test-structure-scoring.mjs` |
| required content is never omitted; optional omission is proposed only when allowed | coverage and optional-insertion plan fixtures | `test-text-composition-engine.mjs`, `test-dynamic-insertion-slots.mjs` |
| estimated local delta is distinct from measured candidate delta in public output | one CLI/MCP report fixture | `test-public-mcp-contract.mjs`, `test-cli.mjs` |
| selected plan paints as reported | one PDF, no raster requirement | `test-editorial-parity.mjs` |

## Completion criteria

- All listed facts are available from plan-only output.
- Template frames are reported as envelopes/anchors, while occupied content
  boxes reflect measured content rather than copied fixed heights.
- Ordinary insertions work from content plus a compatible template capability;
  authors are not required to repeat template dimensions, push relations or
  movement rules for every quote/image.
- One reusable slot capability can materialize several deterministic page-local
  instances without creating persistent template records.
- Template-declared wide, half-width and column alternatives remain discrete
  legal choices; the planner does not invent an undeclared visual form.
- Multiple insertions expose the relevant before/after, neighbour and
  usable-region edge facts through spacing observations, and the evaluator can
  explain spacing-profile and symmetry penalties without requiring every
  observation to contain every possible field.
- No content-dependent width or height is introduced as a renderer constant or
  duplicated between template, code and test configuration.
- Hard-violation code, severity and ordering remain unchanged for existing
  fixtures.
- Every negative quality component points to measured evidence and an
  actionable remedy.
- Fixed authored placements remain fixed without movement bounds.
- The existing engine selects the higher-scoring legal candidate and never
  selects an illegal one.
- The plan-wide score remains the candidate-selection value and exactly equals
  its configured base plus all per-placement point contributions.
- Every local quality loss can be traced to its affected placement(s) and
  reason; a pairwise or region-level penalty is never counted twice.
- Evaluator repair proposals are machine-readable, use only legal existing
  capabilities/constraints, and cause the planner to generate complete
  alternatives rather than mutate the selected plan.
- Search continues after a small improvement, re-centres on the best plan and
  tests finer legal movement until no better bounded neighbor remains or the
  configured budget is reached.
- Predicted local score deltas are explicitly estimates; only a fully
  replanned and re-evaluated candidate reports an actual score change.
- Refinement is deterministic, cycle-free, and returns the best evaluated
  legal plan even when the search budget ends during a later iteration.
- CLI and MCP expose equivalent codes and evidence.
- No routine quality test rasterizes a PDF; one representative PDF remains.
- All thresholds and penalties are sourced from render configuration.
