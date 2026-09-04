# Composition module map

This is the canonical map for finding composition code. It records ownership,
interfaces, and the direction in which data moves. A refactor may move an
implementation, but it must preserve the interface and the ownership described
here.

## End-to-end path

```text
input adapter → document model → planner → plan → evaluator → backend adapter → artifact
```

The planner owns placement decisions. The evaluator observes a complete plan
and returns legality and quality. The renderer consumes the selected plan. No
downstream module may silently repair or reinterpret an earlier decision.

## Module ownership

| Module | Owns | Interface used by | Must not own |
|---|---|---|---|
| `composition/input.ts` | Conversion of accepted input into named flows, blocks, assets and graphics | report adapter, input tests | page coordinates, wrapping, PDF drawing |
| `composition/model.ts` | Renderer-neutral document and template types | all composition modules | planning decisions or mutable runtime state |
| `composition/page-template-adapter.ts` | Conversion of page-template geometry into composition layouts and routes | report adapter, template tests | text measurement, candidate ranking |
| `composition/text-planner.ts` | Text measurement, wrapping adapter, routing, block placement and obstacle decisions | `text-engine.ts`, planner tests | PDF primitives, pixel decoding, final artifact checks, trace projection |
| `composition/text-planner-candidates.ts` | Deterministic legal position variants for existing movable insertion and authored-graphic frames | `text-planner.ts` | document semantics, score, rendering, candidate evaluation |
| `composition/text-wrapping.ts` | Renderer-neutral word wrapping, available intervals, flow-barrier continuation and obstacle-gap inspection | `text-planner.ts` | page routing, insertion policy, score, PDF drawing |
| `composition/flow-barriers.ts` | Flow-placement projection and renderer-neutral splitting of text areas around wrapping graphics | `text-planner.ts`, trace/evaluator consumers through `CompositionPlan` | page orchestration, text measurement, candidate ranking, PDF drawing |
| `composition/glyph-objects.ts` | Resolution of authored and generated decorative glyphs against final text or graphic bounds | `text-planner.ts`, glyph/rendering tests through `CompositionPlan` | text flow, obstacle reservation, candidate ranking, PDF drawing |
| `composition/glyph-sampling.ts` | Renderer-neutral character-cell geometry and foreground metadata for contrast sampling | `text-planner.ts`, contrast tests through `CompositionLine` | raster decoding, contrast scoring, placement decisions, PDF drawing |
| `composition/route-slots.ts` | Pure compatibility checks and first-compatible-slot selection for a block in a route | `text-planner.ts` | page mutation, occupied-space checks, insertion placement, scoring |
| `composition/insertion-order.ts` | Deterministic source-order lookup and vertical boundary for the next planned insertion | `text-planner.ts` | placing insertion content, text wrapping, scoring, page mutation |
| `composition/line-capacity.ts` | Renderer-neutral conversion of a vertical interval into complete line capacity with the planner's geometry tolerance | `text-planner.ts`, `planning-trace.ts` | layout policy, text measurement, page mutation |
| `composition/planning-trace.ts` | Read-only projection of a completed plan into block/slot fragments, decisions and planning phases | `text-planner.ts`, trace consumers through `CompositionPlan` | placement decisions, reflow, scoring, PDF drawing |
| `composition/structured-block-placement.ts` | Measurement, fit checks and placement of tables and atomic blocks, including wrapped-image boundary reservations | `text-planner.ts`, table/image/KPI tests through `CompositionPlan` | ordinary text wrapping, route selection, candidate ranking, PDF drawing |
| `composition/engine.ts` | Candidate/evaluator orchestration, legal-plan selection, refinement rounds and trace assembly | text engine, composition tests | wrapping, geometry invention, PDF drawing |
| `composition/evaluator.ts` | Hard-rule checks and quality score for a complete plan | text engine, evaluator tests | mutating plans, text reflow, raster PDF decoding |
| `composition/contrast.ts` | Renderer-neutral contrast measurements over supplied page/asset rasters | evaluator, contrast tests | decoding assets, choosing layout, binary plan rejection |
| `composition/js-pdf-adapter.ts` | jsPDF measurements and rendering capabilities | report adapter, PDF tests | flow routing, candidate selection, score policy |
| `composition/text-engine.ts` | Composition-specific wiring of planner, evaluator and the `pdf`-to-planner policy adapter | report renderer | layout rules, drawing, duplicated thresholds |
| `composition/report-composition-entrypoint.ts` | Report-specific entry point that prepares composition input and jsPDF metrics, then forwards explicit policy overrides | report renderer and composition test harnesses | a second planner, a second renderer, independent layout rules, policy-default translation |
| `report-composition-runtime.ts` | Report-specific resource preparation: fonts, assets, contrast provider, block capabilities, composition styles and the backend closure | `report-renderer.ts` | page chrome, final artifact orchestration, a second planner or renderer |
| `composition/render-config-styles.ts` | Translates render-config values and theme colors into jsPDF composition styles and backend options | report renderer and composition entry point | layout decisions, document input, planner state |
| `report-renderer.ts` | Report-level orchestration, chrome, theme/config loading for chrome and artifact output | MCP/CLI entrypoints | deciding text breaks, ranking candidates or preparing composition capabilities |

Small geometry helpers such as `graphic-geometry.ts` and `image-geometry.ts`
own only their pure geometry calculations. They do not read configuration or
make composition decisions.

## Interfaces and dependency direction

`text-planner.ts` exposes `CompositionPlanner` through
`createTextCompositionPlanner`. Its implementation may use private modules for
wrapping, route-slot compatibility, flow-barrier geometry or candidate geometry, but callers should not
need to know those modules separately. `text-wrapping.ts` has a private
implementation seam used by the planner's `wrapBlock` adapter; it is not a
second planner interface. `flow-barriers.ts` similarly projects already
planned slots and splits them around already placed wrapping graphics; it does
not choose placements. `engine.ts` consumes the planner and an
`CompositionEvaluator`; this is the main renderer-neutral seam for candidate
selection. `structured-block-placement.ts` owns only the structured-block
branch of the flow loop. It receives the planner's mutable cursor and typed
callbacks for existing slot rules, so it cannot become a second flow router.

The jsPDF adapter satisfies `CompositionTextMetrics` and
`CompositionBackend`. The planner receives capabilities such as text width and
line height; it does not import jsPDF. The evaluator receives an optional
contrast provider; it does not decode images itself.

Configuration ownership is similarly directional:

- `pdf` values control planner geometry and fragment policy;
- `composition_search` is converted into planner policy by its adapter and is
  not read directly by the planner;
- `composition_score` belongs to the evaluator;
- `contrast` supplies contrast reference and sampling values;
- `quality` belongs to artifact and visual-QA checks.

The `text-engine.ts` adapter is the single implementation of the PDF policy
mapping. Its direct engine interface retains a smaller historical fallback
subset for renderer-neutral callers; the report entry point requests the full
policy through that same adapter and adds only explicit caller overrides. If a
value is needed in another module, pass it through the existing typed interface
rather than importing the other module's configuration group.

The report runtime is an integration module, not a new composition engine. It
resolves report resources and composes the existing entrypoint, while the
renderer remains responsible for page chrome and the final PDF buffer.

## Refactoring rule

Extract a module only when it removes a responsibility from a caller while
keeping a smaller interface. The safe seams currently are deterministic
movable-placement candidate generation, renderer-neutral wrapping,
flow-barrier projection, glyph-object resolution and completed-plan tracing.
The latter transforms
existing text or graphic geometry into painted decoration placements; it does
not reserve space or decide where the target should go. Glyph sampling is a
separate geometry seam: it describes a full line-height cell per visible
character, while the contrast provider owns sampling and scoring. Tests
continue to call the public planner and engine interfaces. Route-slot selection
is likewise a pure compatibility decision; the planner remains responsible for
advancing its cursor, checking occupied geometry and recording the resulting
decision. Tests do not import extracted implementations merely to increase
coverage.
