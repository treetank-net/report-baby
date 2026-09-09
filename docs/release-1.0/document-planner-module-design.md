# Proposal for document-planning decomposition

Date: 2026-09-07. Status: proposal for review; it does not describe an
implemented architecture.

This document expands the [Astra review](astra-text-planner-review-live.md)
and the analysis of current, including uncommitted, planner versions. It does
not replace the adopted 1.0 plan or the canonical
[module map](../composition/modules.md). The new file, function, and type
names below are working names. Changing this documentation does not implement
the refactor.

## 1. Key clarification: what is a `text-fragment`?

The previous name mixed two things: a calculation and its result. I propose
the module `text-fragment-planning.ts` and the function
`planTextFragment(request, metrics)`. `TextFragment` means only the immutable
calculation result: selected lines, word range, and their geometry.

No separate active object is created for every fragment. There is no
constructor, process, background task, registry, own identifier, or method
such as `fragment.run()` or `fragment.save()`. The flow planner makes an
ordinary synchronous function call for a concrete text-placement attempt.

In project terminology:

| Element | Kind | Why |
|---|---|---|
| `text-fragment-planning.ts` | Calculation module with a small interface | Hides the cooperating text-wrapping rules |
| `planTextFragment` | Stateless domain function; in DDD, a domain-service operation | The calculation depends on the block, place, measurements, and policy, not on one entity |
| `TextFragment` | Result value, close to a value object | Content matters, not identity or lifecycle |
| `FragmentOutcome` | Sum of disjoint result types | Distinguishes placement, advance, resume, and error |
| `LayoutState` | Private state object for one run | Has mutable pages and placements, but is not a durable business entity |
| `FlowCursor` | Local algorithm state | Remembers the progress of one flow |

The implementation can be functional. It does not require a DI container, a
class hierarchy, or separate processes for modules. `metrics` is a passed
dependency. Deterministic calculation assumes stable `metrics` responses; the
measurement adapter may use a cache or jsPDF internally.

## 2. Existing state and purpose of the change

Confirmed in the current code:

- `text-planner.ts` has 962 lines and `flow-planner.ts` has 874;
  `planFlow` covers lines 316–874, or 559 lines including its declaration and
  comments.
- `text-planner` calls `planFlow`, and `flow-planner` imports execution
  functions from `text-planner`. There is an import cycle.
- `planDocumentOnce` prepares the plan, graphics, insertions, ordinary and
  repeated flows, and finalizes the result.
- `planFlow` selects a slot, measures text, applies typography rules, changes
  the cursor and geometry, places the result, and appends diagnostics.
- `placeStructuredBlock` also changes the cursor; its `boolean` does not
  distinguish placement from advancing or handling an error.
- `engine.ts` already performs evaluation, candidate selection, and refinement
  rounds.

The purpose is to assign every decision and every mutation to one owner.
Shorter functions are a consequence of this separation. We do not assume that
moving code alone will reduce the total line count.

## 3. Flow from input to document

The following diagram shows the target call flow. Input adapters, metrics,
engine, evaluator, and backend already exist. The planner internals are the
proposed decomposition.

```text
report data + compiled template + assets/fonts + configuration
  |
  v
report runtime / planReportComposition
  |-- input adapter ------------> CompositionDocument: flows and blocks
  |-- page-template adapter ----> CompositionTemplate: layouts and routes
  |-- jsPDF metrics adapter ----> measurements for text, tables, and blocks
  `-- text-engine --------------> planner policy from configuration
  |
  v
CompositionEngine.plan(document, metrics)
  |
  |--> planner.planCandidates(...)
  |      |-- prepare insertion and graphic position proposals
  |      `-- for each proposal set: layoutDocument(...)
  |             |-- new LayoutState
  |             |-- prepare pages, graphics, and insertion layer
  |             |-- planFlow for ordinary flows
  |             |     `-- repeatedly: select place -> calculate -> commit
  |             |-- planFlow for repeated flows on designated pages
  |             `-- finalize -> CompositionPlan
  |      `-- if reflow is needed: new full run with new proposals
  |
  |--> evaluator.evaluate(document, every plan)
  |--> select a legal plan by score, preserve order on a tie
  |--> planner.planRefinedCandidates(selected, round)
  |      `-- new full runs -> evaluation -> update selection
  `--> CompositionPlanResult { plan, evaluation }
  |
  v
render admission check -> backend -> PDF artifact
```

Here, “text analysis” includes block structure, word ranges, font
measurements, wrapping, and layout rules. This proposal does not add semantic
analysis through an LLM. The input adapter already supplies the block kind or
role, such as heading or quote.

The backend uses the selected plan. It does not make the paragraph-splitting
or heading-continuation decision again.

## 4. Lifetime and mutation ownership

| Data | Created | Read by | Mutation owner / end of life |
|---|---|---|---|
| Document, template | At composition entry | Planner and evaluator; document also by backend | Treated as read-only input during planning |
| Metrics and policy | While assembling runtime | Planner calculations | Policy is stable; adapter owns metrics |
| Proposal set | Candidate or next reflow generation | One layout run | New set for the next attempt; selected candidate is not mutated |
| `LayoutState` | At the start of every `layoutDocument` | Navigator and placement operations through the interface | Only the state module changes pages, slots, and result collections |
| `FlowCursor` | At the start of one `planFlow` call | Flow planner; calculations receive selected values | Flow planner only; disappears when the flow ends |
| `FragmentRequest` | After selecting the current place | `planTextFragment` | Snapshot; stale after geometry or occupancy changes |
| `FragmentOutcome` | Returned by the calculation | Flow planner and materialization | Consumed in the same iteration; a retry creates a new result |
| `CompositionPlan` | At run finalization | Evaluator, engine, backend | Geometry is complete; engine currently appends the evaluation trace |
| `CompositionEvaluation` | After the full plan is evaluated | Engine and render admission check | Separate evaluation result |

One document can cause many runs and many `planTextFragment` calls. The same
block can be measured again in another slot, after an obstacle changes, in the
next candidate, or during reflow.

Mutable `LayoutState` is not shared between candidates. Planning is initially
sequential; this proposal does not introduce concurrency.

## 5. Module and function map

The following functions describe target responsibilities, not a finished set
of exports. Helper functions remain private when they have no real consumers.

### `text-planner.ts`: candidate generation

- Keep `createTextCompositionPlanner` and the existing `CompositionPlanner`.
- `planCandidates`: prepare proposal sets and full plans.
- `planRefinedCandidates`: prepare proposals around the selected plan.
- Use the existing `text-planner-candidates.ts` for variant geometry.

It does not calculate scores. During migration, preserve the existing
`planDocumentOnce` calls and the current proposal flow. Do not introduce a
separate “stabilization” entity or module; local variables and signatures used
today by the planner remain private implementation details to move without
changing behavior. Running additional generations for distant candidates is
outside the current scope.

### `document-layout.ts`: phases of one run

- `layoutDocument`: counterpart of the current `planDocumentOnce`.
- Private `prepareLayers`, `planOrdinaryFlows`, `planRepeatedFlows`, and
  `finalizeLayout` separate the phases of the existing run.
- Creates `LayoutState`, invokes flow planners, and delegates final
  projections.
- Finalization preserves this order: collect pages/slots, normalize order,
  project flows and barriers, place glyphs, and record phase and trace.

Orchestration does not leak into the state module: `LayoutState` does not call
`planFlow` or start another candidate itself.

### `layout-state.ts`: mutation ownership

Working operational interface:

- `ensurePage(request)`: create or read a page according to the established
  policy;
- `inspectPlacementArea(request)`: snapshot the current slot, occupancy,
  obstacles, and growth capability; it does not select the next slot;
- `applySlotGrowth(request)`: grow a slot and move dependent slots;
- `reserveObstacle(request)`, `collapseInsertionSlot(request)`: concrete
  changes to the obstacle layer and slot state;
- `commitPlacement(result)`: consistently record placements, lines, and
  occupancy;
- `recordEvents(events)`, `recordResidual(result)`: preserve decision
  evidence;
- `snapshot()`: provide data for finalization after placement ends.

The state does not expose writable `pages`, `plan`, or the slot map. Merely
wrapping current arrays in `context` does not satisfy this requirement. A
snapshot must not expose mutable references to its internals; shallow
TypeScript `Readonly` alone does not guarantee this for nested objects.

The state module may have private helper functions for pages and recording. Do
not move keep-with-next, list rules, or candidate selection into it.

### `flow-planner.ts`: navigation and progress

- `planFlow`: the main loop;
- `selectFlowTarget`: route/slot selection and no-space handling;
- `prepareTextAttempt`: assemble the data for one attempt from the cursor,
  area snapshot, neighboring blocks, and insertion order;
- `applyOutcome`: record the result and update the cursor unambiguously;
- private operations `advanceCursor`, `resumeBelowObstacle`, `completeBlock`,
  and `continueBlock`.

Every iteration must consume content, change to a legal place/resume position,
or finish the flow with diagnostics. Repeating an identical state without
progress is an algorithm error. Do not add an arbitrary hard-coded limit.

### `text-fragment-planning.ts`: local decision

- Public inside the planner: `planTextFragment(request, metrics)`;
- private `measureTextAttempt`: constrained and full wrapping;
- `resolveBlockSpacing`: spacing rules, including existing heading compression;
- `checkHeadingCluster`: heading, lead, and obstacles;
- `selectLegalLineRange`: minimum start/end, list, and legal split.

The order of these rules is part of the behavior. Do not replace them in this
step with a universal plugin/policy system. The function also returns ordered
events needed by diagnostics and the evaluator.

### `text-placement.ts`: materialize selected text

- `materializeText`: transform lines into data corresponding to today's
  `placeLines`, without directly mutating `PageState` or plan arrays;
- calculate alignment, placement frame, lines, and glyph-sampling boxes;
- return data to `commitPlacement`; the plan owner assigns order-dependent
  identifiers while preserving the current format;
- use the existing `glyph-sampling.ts`.

Shared measurement of text, padding, and line height should be available below
text planning and insertion planning, for example in `text-measurement.ts`.
This is the home for current `wrapBlock`, `lineHeight`, `textPadding`, and
tokenization, without importing the parent planner.

### Insertions, graphics, and structured blocks

- `insertion-planning.ts`: `enumerateInsertionSlots`, `measureInsertion`,
  `seedInsertionProposals`, `deriveInsertionProposals`. Fit-content
  measurement is shared by seeding and the actual insertion layer.
- Preparing the insertion layer remains a separate run operation:
  reservation -> measurement -> materialization -> recording through
  `LayoutState`.
- Graphic preparation keeps current seeding, page materialization, and
  geometry. It may be a private `graphic-planning.ts` module if extraction
  genuinely reduces the load of `document-layout`.
- `structured-block-placement.ts` should eventually return explicit results
  for tables and atomic blocks instead of changing the cursor and returning a
  `boolean`. A table row range remains a different kind of progress from a
  word range.

## 6. Exact input to fragment calculation

No single text measurement is sufficient. The working `FragmentRequest`
contains the following groups, as selected read-only values:

| Group | Data | Source |
|---|---|---|
| Content | Current block, text, kind/role, remaining-word range | Document + cursor |
| Neighborhood | Previous block relevant to spacing and next block for keep-with-next | Flow planner and recorded occupancy |
| Place | Current slot frame, available-band start, physical bottom, allowed bottom after growth | `LayoutState` snapshot |
| Insertions | Constraint before the next insertion and required start after the previous one | `insertion-order` + proposals + authored order |
| Obstacles | Wrapped graphics and flow barriers affecting the place | Plan snapshot |
| Rules | Fragment minimum, widow/orphan, list, heading keep, wrapping width, tolerance | Passed policy |
| Attempt context | Block start/continuation, resume below an obstacle, diagnostic identifiers | Flow planner |

Separately passed `metrics` provides text width, line height, padding, and
blockGap, among other values. Do not inject the complete engine, evaluator,
backend, mutable plan, or `ensurePage` into the function.

Do not flatten geometry prematurely to one `availableLines` number: obstacles
can create different widths at successive heights, the next block can have a
different line height, and a slot can grow. The function must be able to
reconstruct actual bands and measure a heading cluster.

Working result contract:

```ts
// Design sketch, not a declaration currently present in the repository.
type FragmentOutcome =
  | { kind: 'place'; fragment: TextFragment; requiredBottom: number;
      events: PlanningEvent[] }
  | { kind: 'advance'; events: PlanningEvent[] }
  | { kind: 'resume-below'; y: number; events: PlanningEvent[] }
  | { kind: 'skip-empty'; events: PlanningEvent[] }
  | { kind: 'reject'; residual: TextResidual; events: PlanningEvent[] };

// TextFragment: selected WrappedLine[], startWord/endWord, leading,
// data needed for materialization; no own lifecycle and no plan mutation.
// PlanningEvent: typed event preserving the current codes/details.
```

`advance` means that another place is needed. Only the flow planner decides
whether there is another slot, whether the page must advance, and whether the
route permits it. The local calculation does not declare the document
globally impossible based only on one failed attempt.

## 7. One iteration and the moment state is touched

```text
1. flow planner reads the cursor and current block
2. selects a slot; LayoutState ensures the page
3. obtains a fresh area snapshot and assembles the request
4. planTextFragment reads request and metrics -> result without plan mutation
5. flow planner interprets the result:
   advance      -> record events, advance cursor, return to 1
   resume-below -> record events, change resumeY, return to 1
   skip-empty   -> next block, return to 1
   reject       -> record residual/diagnostics, finish
   place        -> if needed, apply slot growth
                -> if growth changed conditions, fresh attempt from 3
                -> materializeText, commitPlacement, record events
                -> cursor.startWord = fragment.endWord or next block
```

Growth can move other slots and their obstacles. Do not commit a result
calculated against stale geometry. The first implementation does not need
snapshot versioning: code runs sequentially, and the mutation owner explicitly
states whether a change invalidates the current measurement. The exact order
of growth and events requires an equivalence test against the current
`growSlot`; it is not considered settled here.

Illustrative example, with numbers used only for explanation: a heading needs
two lines, and policy requires two lines of the next paragraph. They do not fit
together below an obstacle. `planTextFragment` returns `advance` with the
heading-cluster reason. The flow planner selects the next slot and calls again
for the same heading from its first word. When the result is `place`,
materialization creates the heading lines; the paragraph is placed in the next
iteration. Measuring the lead checks feasibility; it does not record the lead
in advance.

## 8. Dependency direction and reuse scope

```text
engine -> CompositionPlanner / CompositionEvaluator
text-planner -> document-layout + insertion-planning + candidates
document-layout -> flow-planner + layout-state + layer preparation
flow-planner -> text-fragment-planning + structured-block-placement
flow-planner -> layout-state interface + route-slots + insertion-order
text-fragment-planning -> text-measurement -> text-wrapping
insertion-planning -> text-measurement
text-placement -> glyph-sampling
document-layout -> final flow-barriers / glyph-objects / planning-trace
```

Types shared by these modules can live in internal `planning-types.ts`,
without execution imports. Existing document, template, and plan models remain
the foundation. Do not create competing copies.

Share real calculations: fit-content measurement, insertion-place enumeration,
and common-bounds validation. Different occupancy queries retain their meaning:
the bottom of text in a slot, occupancy of overlapping slots, and obstacle
presence are not automatically one `occupiedBottom` operation.

## 9. Unresolved contracts and migration protection

The following concerns cannot be hidden behind a new module name:

1. Page-plan enforcement. A layout should not be selected by the first flow to
   call `ensurePage`; it should come from the top-down page plan. Details of
   the next-page request and behavior around a reserved page require the
   contract in section 13.
2. Quote path. The preplanned insertion layer uses a separate, named flow
   (for example `quotes`) declaring `insertionSlots`. `main` is reserved for
   the main text: it cannot contain `role: quote` or `insertionSlots`. The
   historical inline quote path was removed together with defer/continuous
   handling.
3. Scope of expected header/footer repetition. Evaluator expectations must be
   derivable independently of where the planner placed the text.
4. Stabilization, single candidate, and inactive-element behavior during
   refinement. The Astra report identifies these problems; this document does
   not promise to fix them or reconfirm them with tests.
5. Events are part of the contract: the evaluator reads, among other things,
   `FLOW_SEGMENT_ADVANCED`. Preserve fields, reasons, and order.

Work order: behavior tests -> measurement/materialization and state ownership
-> remove the cycle -> local text calculation -> one cursor owner -> remove
duplication. Behavior corrections require separate changes and tests.

Public planner/engine tests remain the verification foundation. Tests of local
calculation are useful for rule combinations that are difficult to isolate in
the complete document, after consciously adopting this internal interface. Do
not create a test for every private function or a replacement for all state.

Check placements, content, residuals, events, selected candidate, and absence
of real-PDF regressions. After implementation: TypeScript, composition gate,
documentation test, and a manual editorial check. New tunable values go into
the existing YAML configuration and are passed through policy.

Stop extraction when a module needs the complete mutable plan, a dozen parent
callbacks, or an import of the parent planner. That means the responsibility
split must be corrected before moving more code.

## 10. Analysis basis and verification limits

Sources: `server/src/composition/{text-planner,flow-planner,engine,
structured-block-placement,text-engine,report-composition-entrypoint}.ts`,
selected `evaluator.ts` rules, the module map, and the Astra review. In
particular: current `planDocumentOnce`, `planFlow`, `placeLines`,
`placeInsertionLayer`, `fitInsertionProposal`, and `createCompositionEngine`.

This is a responsibility and flow design. The type sketches have not been
implemented or compiler-verified. The documentation test can check the
existing documentation contract, but it does not confirm the proposed
algorithm. Function lengths after refactoring and line savings require
measurement on the actual diff.

## 11. Function catalog and invocation moments

This expands the proposed architecture from section 5. Names marked
“existing” come from current code; the rest are designed functions or methods.
An existing name does not mean that its current internals remain unchanged.
Helpers remain private. The catalog describes logical operations; it does not
require exporting each operation or creating a class for each one.

Time units used below:

- **Request**: creation of one report, from input to artifact.
- **Run**: one complete `layoutDocument` for one proposal set. Reflow and
  refinement can cause additional runs for the same document.
- **Flow**: one `planFlow` call; a repeated header/footer gets a separate call
  for each page covered by the repetition.
- **Attempt**: considering a concrete block or its remainder in a concrete
  place. A failed attempt can finish without recording even one line.

### 11.1. Input and dependency assembly — existing modules

| Module / function | Who and when calls it | What it does / passes on |
|---|---|---|
| `report-composition-runtime.prepareReportComposition` — existing | Report orchestration, before planning | Prepares fonts, assets, styles, block capabilities, contrast provider, and backend |
| `report-composition-entrypoint.planReportComposition` — existing | Report path, at planning entry | Assembles document, template, metrics, and policy; starts the engine |
| `input.compositionDocumentFromInput` — existing | Entrypoint, before the first candidate | Converts input to flows and blocks; does not determine final coordinates |
| `page-template-adapter.compositionTemplateFromPageGeometry` — existing | Entrypoint, before the first candidate | Prepares layouts, slots, and routes |
| `js-pdf-adapter.createJsPdfTextMetrics` — existing | Entrypoint, before the first candidate | Returns the measurement dependency shared by request calculations |
| `text-engine.plannerPolicyFromRenderConfig` — existing | During policy assembly | Reads configuration through the existing adapter and returns planner values |
| `text-engine.createTextCompositionEngine` — existing | Entrypoint, after input preparation | Connects planner and evaluator; does not lay out blocks |

The exact number of configuration reads is a detail of current adapter
assembly. The design does not require reading YAML again for every text
attempt.

### 11.2. `engine.ts` — existing evaluation owner

| Function / operation | Moment and frequency | Effect |
|---|---|---|
| `createCompositionEngine` — existing | During engine assembly | Keeps planner and evaluator in a closure |
| Returned `plan` — existing | Once per request-planning call | Gets candidates, evaluates them, selects, and runs refinement |
| `planner.planCandidates` — existing | At the start of `engine.plan` | Returns initial full plans |
| `evaluator.evaluate` — existing | For every returned plan | Returns legality, diagnostics, and score |
| `compareCompositionEvaluations` — existing | During selection and after new candidates arrive | Compares legality and score; a tie preserves the earlier choice |
| `planner.planRefinedCandidates` — existing | In each allowed follow-up round | Receives the currently selected plan and returns new full plans |
| Evaluation-trace append — existing | After the last round | Completes the selected plan's trace with results and selection |
| `renderComposition` — existing | Later, when this interface renders | Checks rejection and invokes the backend |

`renderComposition` is not part of the candidate loop. Metrics may use jsPDF
earlier, but that does not mean every candidate is rendered to the final PDF.

### 11.3. `text-planner.ts` and `text-planner-candidates.ts`

| Function | Who / when | Read and result |
|---|---|---|
| `createTextCompositionPlanner` — existing | `text-engine`, during assembly | Keeps template and policy; does not create page state |
| `planCandidates` — existing | Engine, initial generation | Validates run limit; prepares seeds and variants; delegates full layouts |
| `plan` — existing | Direct planner consumer when it does not use engine candidates | Preserves the current contract of returning the last plan from `planCandidates` |
| `planRefinedCandidates` — existing | Engine, every active round | Creates a neighborhood around the selected plan and runs `layoutDocument` for proposal sets |
| `movableInsertionProposalCandidates`, `movableGraphicProposalCandidates` — existing | During initial variant creation | Calculate positions; do not measure content or create pages |
| `movableInsertionProposalRefinements`, `movableGraphicProposalRefinements` — existing | While creating the selected candidate's neighborhood | Return position-proposal sets for the round |
| `movableInsertionProposalSignature` — existing | Private detail of the current run, if that path is active | Returns the signature used by current code; not part of the target domain interface |

No new generation cycle is designed here. The first extraction preserves the
existing split and call order; simplifying or extending search is a separate
contract change.

### 11.4. `document-layout.ts`

| Function | Moment / caller | What it starts and changes |
|---|---|---|
| `layoutDocument` | Planner, once per full run | Creates a new `LayoutState`; leads the phases below |
| `validateLayoutInputs` — private | Start of run | Existing bounds and growth validation; records preflight diagnostics |
| `prepareLayers` — private | Before ordinary flows | Prepares graphics, first page, reservations, and insertion content |
| `planOrdinaryFlows` — private | After layer preparation | Validates route/startPage; calls `planFlow` for ordinary flows in the preserved order |
| `planRepeatedFlows` — private | After ordinary flows | Determines repetition pages and calls `planFlow` with continuation forbidden |
| `finalizeLayout` — private | After all flows | Takes a snapshot, runs final projections, and returns `CompositionPlan` |

`prepareLayers` preserves the important order of the current run:
materialize graphic pages -> ensure the first page -> reserve insertion
obstacles -> place insertion content. Changing this order can change the
layout selected when the first page is created.

`finalizeLayout` runs the equivalents of `flattenPages`,
`normalizePlanReadingOrder`, `registerFlowPlacements`,
`registerFlowBarrierBoxCandidates`, `placeGlyphObjects`, flow-placement phase
recording, and `tracePlan`, in that order. The projections exist; they are not
redesigned here.

### 11.5. `layout-state.ts`

| Method / function | Who / when | Mutation |
|---|---|---|
| `createLayoutState` | `layoutDocument`, start of every run | Creates empty plan and page collections |
| `ensurePage` | Layer preparation or target selection by flow | Creates a missing page and its slots; does not recreate an existing page |
| `inspectPlacementArea` | Flow planner, before an attempt | No mutation; reads current geometry, occupancy, and obstacles |
| `applySlotGrowth` | After required height is calculated, before commit | Changes height and dependent geometry; reports measurement invalidation |
| `reserveObstacle` | Layer preparation; also placement of a wrapped block | Records an obstacle visible to later attempts |
| `collapseInsertionSlot` | Preparation or moving a flow past an unused insertion | Updates slot and related geometry according to the existing rule |
| `commitPlacement` | Only after an accepted local attempt | Appends placement/lines or table fragment and updates occupancy |
| `recordEvents` | After an operation is resolved | Appends decisions/diagnostics in preserved order |
| `recordResidual` | When remaining content cannot be handled | Records the range of unplaced words/rows |
| `snapshot` | Run finalization | Exposes the complete result to final projections |

Page and geometry helpers are private. Calculations do not record events on
their own: they return events to the state owner. During migration, assign
each existing event to one operation so it is not recorded twice.

### 11.6. `flow-planner.ts`

| Function | Moment | Calls / effect |
|---|---|---|
| `planFlow` | Once per ordinary flow or one repetition | Creates the cursor and leads the attempt loop |
| `selectFlowTarget` — private | Start of attempt | Checks limits, route, and slot compatibility; uses `ensurePage`, `routeSlots`, `slotFor` |
| `prepareTextAttempt` — private | After selecting a legal text target | Takes a snapshot; determines previous/next block and flow constraints |
| `planTextFragment` — imported | When the current block is text | Returns a local decision without changing the cursor |
| `planStructuredBlock` — designed interface for the existing module | When the block is a table or atomic | Returns measurement and placement result, row progress, or block completion |
| `applyOutcome` — private | After an attempt is resolved | Delegates materialization/recording, records events, and changes the cursor |
| `advanceCursor` — existing operation | Result requiring another place | Next slot or page according to the route |
| `resumeBelowObstacle` — private | `resume-below` result | Sets resumeY and slot identifier; retries the current block |
| `completeBlock` — private | Entire block recorded or block is empty | Increments blockIndex and resets content offsets |
| `continueBlock` — private | Only part was recorded | Keeps blockIndex and sets startWord or startRow |

Insertions are no longer handled as authored blocks in `main`. The insertion
layer receives blocks from a named non-`main` flow, reserves their geometry,
and materializes them before ordinary flow. `planFlow` does not keep quote
defer or resume state.

### 11.7. `text-fragment-planning.ts` and `text-measurement.ts`

| Function | Moment inside attempt | Data / result |
|---|---|---|
| `planTextFragment` | Once per text attempt; again after a place change | Coordinates the calculations below and returns one `FragmentOutcome` |
| `resolveBlockSpacing` — private | Before first wrapping | Calculates spacing from the predecessor and accounts for resume below an obstacle |
| `measureTextAttempt` — private | After band and spacing are known | Calls constrained and full wrapping needed to check the split |
| `tryCompressHeadingGap` — private | Only when spacing prevents the full heading from fitting | Repeats measurement without spacing and accepts it only under the current rule |
| `checkHeadingCluster` — private | For a heading requiring following lines | Measures the lead and checks obstacles; may return resume or advance |
| `selectLegalLineRange` — private | When the attempt did not finish earlier | Applies list, keep, minimum-line, and full-heading rules; selects the range |
| `wordsForBlock` — existing calculation to move | During text-attempt preparation | Determines words; result is reused for this attempt |
| `lineHeight`, `textPadding` — existing calculations to move | When a style measurement is needed | Read metrics and validate the result |
| `wrapBlock` — existing calculation to move | Every measurement variant | Delegates to existing `wrapText`; returns `WrappedLine[]` |

This is a responsibility split, not permission to reorder rules.
`checkHeadingCluster` and `selectLegalLineRange` must preserve current
condition precedence. For example, list measurement may reject an attempt
before keep-cluster checking. Implementation must reproduce the order from the
current function and protect it with tests; the table does not require every
helper to run universally.

One `planTextFragment` call may perform several wrappings. It does not thereby
create several placements. Only its final `place` result authorizes the caller
to materialize one selected fragment.

### 11.8. `text-placement.ts`

| Function | Moment | Effect |
|---|---|---|
| `materializeText` | `place` result, after current geometry is established | Coordinates conversion of selected lines into plan data |
| `resolveTextAlignment` — private | Start of materialization | Calculates vertical alignment and text position for each line |
| `buildTextPlacement` — private | After alignment is established | Builds the complete fragment frame and word range |
| `buildCompositionLines` — private | For selected `WrappedLine` values | Creates lines and coordinates and calls existing `glyphSamplingBoxes` |

`materializeText` does not run wrapping again. It receives selected lines and
alignment data. It returns data to `LayoutState.commitPlacement`; it does not
change cursor position. Both ordinary flow and insertion layer use it.

### 11.9. `insertion-planning.ts` and layer preparation

| Function | Who / when | Effect |
|---|---|---|
| `enumerateInsertionSlots` | Seeding or deriving following proposals | Ordered list of available places from template/route |
| `measureInsertion` | Seeding and layer-placement attempt | Shared padding, line, and fit-content measurement; also reports overflow |
| `seedInsertionProposals` — existing, to move | Planner before initial variants | First set of proposed places and sizes |
| `deriveInsertionProposals` — counterpart of `insertionProposalsFromPlan` | Stabilization after a run | New set based on the actual position of preceding content |
| `reserveInsertionLayer` — counterpart of `reserveInsertionObstacles` | `prepareLayers`, before flow text | Uses LayoutState to reserve obstacles and close unassigned slots |
| `placeInsertionLayer` — existing, dependencies changed | After reservation, before ordinary flows | Measures each insertion, materializes text, records the result, and reconciles the obstacle frame |

Layer operations may be private in `insertion-layer.ts`, owned by
`document-layout`. They do not belong to proposal calculation because they
mutate run state. Both places share `measureInsertion`, giving fit-content one
implementation.

### 11.10. Graphics and structured blocks

| Module / function | Who / when | Effect |
|---|---|---|
| `graphic-planning.seedGraphicProposals` — existing operation to move | Planner before variants | Initial positions of authored graphics |
| `graphic-planning.materializeGraphicPages` — existing operation to move | `prepareLayers`, at run start | Ensures pages required by graphic proposals |
| `graphic-planning.placeGraphicsForPage` — existing operation to move | During graphic preparation and when a new page is available | Calculates page placements; recording must prevent duplicate reservation of one graphic |
| `structured-block-placement.planStructuredBlock` — designed | Flow planner, table or atomic attempt | Selects the appropriate branch and returns an explicit result |
| `planTableFragment` — designed private function | Table | Uses `metrics.measureTable`, startRow, and header-repeat rule; returns fragment and endRow |
| `planAtomicBlock` — designed private function | Image, KPI, or another supported atomic block | Uses measurement capability; returns the whole block or need for another place |

Ensuring graphics for a new page should have one invocation point in
orchestration. `LayoutState.ensurePage` may return a `created` flag to which
the caller responds. The state module does not import the parent graphics
planner. Moving code must preserve proposal selection and event order, even
when the page is created only by ordinary flow.

### 11.11. Evaluator and final projections

Existing `evaluateCompositionPlan` checks the complete plan, including
`checkEmptyFlowPlacements`, `checkFlowBarrierBoxCandidates`,
`checkEmptyAndUnderfilledSlots`, `checkEarlyRouteTransitions`, and
`checkInsertionSourceOrder`, as well as line, range, and placement checks.
Scoring remains in `scoreLegalPlan` and its component calculations. An
optional contrast provider analyzes the plan during evaluation.

These functions do not run for every fragment attempt. They do not call
`planFlow` or modify geometry to repair a planner result. This document does
not propose a new internal evaluator split.

`registerFlowPlacements`, `registerFlowBarrierBoxCandidates`,
`placeGlyphObjects`, and `tracePlan` work during run finalization. Distinguish
the final barrier projection from local
`flowBarrierBoxCandidatesForSlot`, which is used during text attempts to read
current obstacles.

## 12. Concrete call sequences

### 12.1. A paragraph partially fits in the first slot

```text
planFlow
  selectFlowTarget -> ensurePage
  prepareTextAttempt -> inspectPlacementArea
  planTextFragment
    resolveBlockSpacing
    measureTextAttempt -> wrapBlock -> wrapText
    selectLegalLineRange
    return place(fragment: words [startWord, endWord))
  applyOutcome
    [if needed: applySlotGrowth and retry after conditions change]
    materializeText -> buildCompositionLines -> glyphSamplingBoxes
    commitPlacement
    recordEvents
    continueBlock(endWord)
    advanceCursor, if remaining text requires the next segment
  next iteration for the remainder of the same paragraph
```

`endWord` is the exclusive end position, not a word count to add to the
cursor again. After the complete paragraph, call `completeBlock`. The next
block may use remaining space in the same slot.

### 12.2. A heading requires resuming below an obstacle

```text
planFlow -> prepareTextAttempt -> planTextFragment
  measureTextAttempt
  checkHeadingCluster -> measure heading and beginning of next block
  return resume-below(y)
applyOutcome -> recordEvents -> resumeBelowObstacle(y)
planFlow: new attempt for the same heading
  fresh request including resumeY
  planTextFragment -> place or advance
```

The first attempt performs no materialization or line recording. If there is
still no room after resuming, the flow planner moves to the next legal slot.
The local function does not create a page.

### 12.3. An insertion causes another full run

```text
planner.planCandidates
  seedInsertionProposals -> enumerateInsertionSlots + measureInsertion
  layoutDocument(proposals A)
    new LayoutState A
    prepareLayers -> reserveInsertionLayer -> placeInsertionLayer
    planOrdinaryFlows -> planFlow ...
    planRepeatedFlows -> planFlow ...
    finalizeLayout -> plan A
  return candidate set according to the existing planner contract
engine -> one evaluation phase over returned candidates -> legal-plan selection
```

The target is one generation phase followed by evaluation. If current code
runs an additional full pass because of policy, that is a detail to preserve
during mechanical movement, not a new entity or separate responsibility. Every
additional full run must still create independent state and must not move only
one already-recorded quote.

### 12.4. The engine refines the selected plan

```text
engine: selected plan A
  planner.planRefinedCandidates(document, metrics, A, round)
    movableInsertionProposalRefinements / movableGraphicProposalRefinements
    for proposal sets: layoutDocument -> new full plans
  evaluate new plans
  compareCompositionEvaluations -> keep or change selected plan
  next round or final result
```

Target-contract goal: inactive elements in a round retain the selected plan's
positions. The current reset-to-seeds problem requires a separate fix and
test; extracting functions does not fix it.

### 12.5. Completion and rendering

After selection, the engine returns the plan and evaluation. Report
orchestration admits rendering, passes the result to the backend, and writes
the artifact. Fragment calculations are complete. The rendering layer reads
coordinates and ranges from the plan; it does not call `planTextFragment`
again.

## 13. Clarification: top-down page plan and next-page request

The adopted assumption is that the template defines page requirements before
content planning starts. The normal path is page one in an opening/first
layout, followed by continuation layouts. Exceptions such as page five with
an advertisement or a title page belong to the same plan. They are not the
result of whichever flow first touched an empty `pages` array.

The page plan may be a concrete list or a rule expanded for a page number, but
it must be established independently of flow execution order. Example:

```text
page 1 -> title
page 2 -> first
page 3 -> continuation
page 4 -> continuation
page 5 -> continuation + required-ad-slot
page 6+ -> continuation
```

`CompositionTemplate` is currently the nearest carrier of this contract: it
stores layouts, slots, `startPage`, `slotsByLayout`, and routes. The page
adapter builds it from the template and geometry. The page-management module
should expose `layoutForPage(page)` based on this data and any page exceptions.
Do not introduce a new entity or a separate object with its own lifecycle.

A flow does not say “create any page”. It reports a need, for example:

- continuation of text because words remain;
- placement of an image in an allowed position relative to a named heading;
- placement of an advertisement or insertion in a required slot;
- repetition of the header or footer on an already-planned page.

The advertisement-page assumption requires distinguishing two operations:

```text
ensurePlannedPage(page, reason)
  -> checks whether page number and required layout/slot match the page plan
  -> creates the page according to the schedule or returns an error

findNextLegalPage(startPage, requirement)
  -> searches for the next page allowed for this need
  -> may return page 6 if page 5 is reserved and the flow cannot use it
```

The first operation is strict: if a caller requires a specific page 5, the
need must not be silently moved to page 6. The second may skip page 5 only if
the flow contract permits continuation and the page plan provides a legal page
6. In both cases, the reason for the need should be recorded in plan decisions.

The target `ensurePage` is therefore an enforcement operation, not the source
of requirements. It should receive a page number or allowed-page range, the
required layout, an optional slot/role, and `strict` or `search-next` mode. It
should:

1. read the immutable page-plan rule through `layoutForPage(page)`;
2. check the page limit and required layout;
3. check required slots and reservations;
4. create missing pages only according to the schedule;
5. return the page, a legal next place, or a typed error.

It must not choose a layout through `routeLayout` accidentally supplied by the
first flow. The route still determines slot order and flow permissions, while
`layoutForPage(page)` determines which physical layout the page has.

If template requirements contradict one another, preflight should detect the
error before candidate generation. If the template is valid but no content can
be placed within it, the engine should return `unsatisfiable`/no feasible plan.
It must not select a rejected plan merely because it was the first candidate.

Ownership is therefore separated:

```text
template / layoutForPage  -> page requirements
flow planner             -> need derived from content progress
page scheduler/ensurePage -> check whether the need is legal
planner                  -> placement candidate within the requirements
evaluator                -> final verification of the complete plan
engine                   -> select a legal plan or report no feasible plan
```

This contract should be tested before extracting `LayoutState`: title page,
ordinary continuation, skipping a reserved page, a strict-page request, and
exceeding `maxPages`.
