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

1. Add region and obstacle spacing types to `engine-contracts.ts`.
2. Extract shared rectangle clipping, union-area and interval calculations into
   the existing composition geometry directory.
3. Extend `attachPlanSpacingReport()` to create region/obstacle records from
   already-materialized placements.
4. Add plan-only fixtures proving deduplication, clipping, reserved bands,
   fit-content shrinkage and final-content gaps.

No scoring or candidate selection changes in this stage.

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

1. Add and validate YAML thresholds.
2. Add score components using the shared evidence.
3. Map negative components to suggestions.
4. Prove that scores change while plan geometry and hard legality remain
   unchanged for a fixed candidate.

### Stage E — select among existing candidates

1. Use existing movable insertion/graphic fixtures to produce at least two
   complete legal candidates with different quality scores.
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
| `layout/planner-candidates.ts` | generate declared movable-placement proposals |
| MCP/CLI adapters | preserve and format the same result |

## Test matrix

| Requirement | Cheapest sufficient proof | Target test |
|---|---|---|
| region union area does not double-count overlap | plan-only synthetic geometry | `test-structure-scoring.mjs` |
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
