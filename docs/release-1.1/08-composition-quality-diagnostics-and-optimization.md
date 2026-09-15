# Release 1.1 — composition quality, diagnostics and placement optimization

Status: implementation plan. This document replaces the former items 08, 09
and 10. They are one process, not three independently implemented features.

## Goal

For every complete composition candidate, Report Baby must answer:

1. is the plan legal and is all required content accounted for;
2. which measurable geometric facts describe its composition quality;
3. which facts reduce its score and why;
4. what input, template or declared movement policy could improve it; and
5. whether another already-generated legal candidate is better.

The answer must be present in `CompositionPlan` and `CompositionEvaluation` and
must survive CLI/MCP serialization. Rendering or an ad-hoc debugging script is
not required.

This task does not create a second evaluator, planner, quality service or
search loop. It extends the existing functions and data structures.

## Fixed decisions

- Hard legality remains fail-closed and is evaluated before quality scoring.
- `composition-engine.ts` remains the only owner of candidate evaluation and
  selection.
- The evaluator scores only complete plans. It never moves a placement.
- `planner-candidates.ts` remains the only generator of movable insertion and
  graphic proposals. This task consumes its existing candidates; item 04 may
  later expand their dimensions and budgets.
- Authored placement coordinates remain fixed when no movement bounds were
  supplied.
- Geometry is measured from the plan. Raster pixels are not an input to these
  rules.
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
- Suggestions already carry message, evidence and string remedies. Only three
  score codes are currently translated into suggestions in `evaluator.ts`.

### Geometry and scoring

- `observability/spacing-report.ts` attaches static page geometry, slot
  occupancy, text placement spacing and resolved chrome gaps.
- `evaluation/plan-queries.ts` and `legality-geometry.ts` query placement and
  collision boxes.
- `evaluation/scoring.ts` already scores column balance, heading continuity,
  paragraph/list/table fragmentation, orphan fragments, insertion spacing,
  header spacing and contrast.
- Fit-content blocks are measured during placement, but the plan does not yet
  explain unused envelopes or aggregate occupied/empty regions consistently.

### Candidate selection

- `layout/planner-candidates.ts` generates cross-products and local refinements
  for declared movable insertion/graphic bounds.
- `composition-engine.ts` evaluates candidates, rejects illegal candidates
  before score comparison and applies stable input order to ties.
- The engine currently serializes complete plans to deduplicate them and can
  re-evaluate equivalent refinements. Item 04 owns improving that search
  mechanism; this task only supplies stable quality components.

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

Extend `CompositionPlanSpacingReport` with region and obstacle facts:

```ts
interface CompositionRegionSpacingReport {
  page: number;
  regionId: string;
  usableBoxes: CompositionBox[];
  occupiedBoxes: CompositionBox[];
  reservedBoxes: CompositionBox[];
  occupiedArea: number;
  usableArea: number;
  emptyArea: number;
  emptyAreaRatio: number;
  verticalGaps: Array<{
    from: number;
    to: number;
    size: number;
    explainedBy?: 'chrome' | 'reserved-slot' | 'obstacle' | 'end-of-content';
  }>;
}

interface CompositionObstacleSpacingReport {
  page: number;
  blockId?: string;
  graphicId?: string;
  slotId: string;
  box: CompositionBox;
  intersectingSlotIds: string[];
  gapsBySlot: Array<{ slotId: string; before?: number; after?: number }>;
}
```

The exact property names may follow existing naming conventions while editing
`engine-contracts.ts`, but one fact must have one representation. Score details
and suggestions reference these records instead of recalculating boxes.

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

Required score evidence includes:

```ts
interface CompositionInsertionRhythmReport {
  page: number;
  slotId: string;
  regionId: string;
  beforeTextGap?: number;
  afterTextGap?: number;
  textGapAsymmetry?: number;
  regionStartGap: number;
  regionEndGap: number;
  previousInsertionGap?: number;
  nextInsertionGap?: number;
  spacingProfile: 'compact' | 'normal' | 'open';
  targetGap: number;
  narrowTextIntervals: Array<{ x: number; width: number }>;
  explainedBy?: Array<'chrome' | 'reserved-slot' | 'obstacle' | 'content-boundary'>;
}
```

One spacing fact is calculated once in `spacing-report.ts`. Scoring and
diagnostics reference that record rather than reconstructing neighbour boxes.
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
  identifiers and the highest-impact remedies;
- full output additionally returns `why`, complete evidence, score breakdown,
  spacing records and candidate trace;
- neither mode requires a generated PDF;
- truncation limits, if needed, are YAML configuration and report how many
  findings were omitted.

`interfaces/mcp/responses.ts`, `interfaces/mcp/render-tools.ts` and the CLI
response path serialize the same evaluation. They may format it differently
but may not drop hard violations or change codes.

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
4. Do not expand candidate dimensions here; that belongs to item 04.

### Stage F — remove duplicated calculations

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
| `evaluation/scoring.ts` | numeric quality components for legal plans |
| `evaluation/evaluator.ts` | assemble legality, score and suggestions once |
| `composition-engine.ts` | compare candidates and record selection trace |
| `template/contracts.ts` | validate fixed, anchored-fit-content and reusable fluid-y slot policies |
| `layout/page-state.ts` | materialize page-local instances and enforce per-page slot capacity |
| `layout/planner-candidates.ts` | generate bounded proposals from template capabilities and declared movable placements |
| `contracts/input/schema.ts` | validate the simple insertion form and explicit-overlay escape hatch |
| `adapters/request-insertion-slots.ts` | resolve template capability, inherit defaults and materialize per-run overlays |
| brand contracts/theme adapter | select an optional categorical spacing-profile default; never introduce independent numeric gaps |
| `adapters/render-config.ts` | resolve spacing profiles, symmetry tolerances and penalties from the shared YAML configuration |
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
| chrome/reserved area is intentional | plan-only template fixture | planning section of `test-report-chrome.mjs` |
| unused fit-content envelope is visible | plan-only measured block fixture | `test-editorial-plan-contract.mjs` |
| caption is included in an insertion obstacle | plan-only placement boxes | `test-dynamic-insertion-slots.mjs` |
| intro pushes main without changing flow identity | plan-only first-page fixture | `test-editorial-plan-contract.mjs` |
| hard diagnostic gains why/remedy without changing code | plan-only failure fixtures | `test-text-composition-engine.mjs` |
| compact/full interfaces preserve diagnostics | one request per interface, no PDF | `test-public-mcp-contract.mjs`, `test-cli.mjs` |
| legal higher-quality candidate wins | plan-only candidate fixture | `test-structure-scoring.mjs` |
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
- Multiple insertions expose before/after, neighbour and usable-region edge
  gaps, and the evaluator can explain spacing-profile and symmetry penalties.
- No content-dependent width or height is introduced as a renderer constant or
  duplicated between template, code and test configuration.
- Hard-violation code, severity and ordering remain unchanged for existing
  fixtures.
- Every negative quality component points to measured evidence and an
  actionable remedy.
- Fixed authored placements remain fixed without movement bounds.
- The existing engine selects the higher-scoring legal candidate and never
  selects an illegal one.
- CLI and MCP expose equivalent codes and evidence.
- No routine quality test rasterizes a PDF; one representative PDF remains.
- All thresholds and penalties are sourced from render configuration.
