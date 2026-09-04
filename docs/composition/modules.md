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
| `composition/text-planner.ts` | Text measurement, wrapping adapter, routing, block placement, obstacle decisions and trace materialization | `text-engine.ts`, planner tests | PDF primitives, pixel decoding, final artifact checks |
| `composition/text-planner-candidates.ts` | Deterministic legal position variants for an existing movable insertion frame | `text-planner.ts` | document semantics, score, rendering, candidate evaluation |
| `composition/text-wrapping.ts` | Renderer-neutral word wrapping, available intervals, flow-barrier continuation and obstacle-gap inspection | `text-planner.ts` | page routing, insertion policy, score, PDF drawing |
| `composition/flow-barriers.ts` | Flow-placement projection and renderer-neutral splitting of text areas around wrapping graphics | `text-planner.ts`, trace/evaluator consumers through `CompositionPlan` | page orchestration, text measurement, candidate ranking, PDF drawing |
| `composition/glyph-objects.ts` | Resolution of authored and generated decorative glyphs against final text or graphic bounds | `text-planner.ts`, glyph/rendering tests through `CompositionPlan` | text flow, obstacle reservation, candidate ranking, PDF drawing |
| `composition/glyph-sampling.ts` | Renderer-neutral character-cell geometry and foreground metadata for contrast sampling | `text-planner.ts`, contrast tests through `CompositionLine` | raster decoding, contrast scoring, placement decisions, PDF drawing |
| `composition/route-slots.ts` | Pure compatibility checks and first-compatible-slot selection for a block in a route | `text-planner.ts` | page mutation, occupied-space checks, insertion placement, scoring |
| `composition/insertion-order.ts` | Deterministic source-order lookup and vertical boundary for the next planned insertion | `text-planner.ts` | placing insertion content, text wrapping, scoring, page mutation |
| `composition/engine.ts` | Candidate/evaluator orchestration, legal-plan selection, refinement rounds and trace assembly | text engine, composition tests | wrapping, geometry invention, PDF drawing |
| `composition/evaluator.ts` | Hard-rule checks and quality score for a complete plan | text engine, evaluator tests | mutating plans, text reflow, raster PDF decoding |
| `composition/contrast.ts` | Renderer-neutral contrast measurements over supplied page/asset rasters | evaluator, contrast tests | decoding assets, choosing layout, binary plan rejection |
| `composition/js-pdf-adapter.ts` | jsPDF measurements and rendering capabilities | report adapter, PDF tests | flow routing, candidate selection, score policy |
| `composition/text-engine.ts` | Composition-specific wiring of planner, evaluator and render configuration | report renderer | layout rules, drawing, duplicated thresholds |
| `composition/report-composition-entrypoint.ts` | Report-specific entry point that prepares composition input, jsPDF metrics and planner policy | report renderer and composition test harnesses | a second planner, a second renderer, independent layout rules |
| `composition/render-config-styles.ts` | Translates render-config values and theme colors into jsPDF composition styles and backend options | report renderer and composition entry point | layout decisions, document input, planner state |
| `report-renderer.ts` | Report-level orchestration, asset preparation, theme/config loading and artifact output | MCP/CLI entrypoints | deciding text breaks or ranking candidates |

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
selection.

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

If a value is needed in another module, pass it through the existing typed
interface rather than importing the other module's configuration group.

## Refactoring rule

Extract a module only when it removes a responsibility from a caller while
keeping a smaller interface. The safe seams currently are deterministic
movable-insertion candidate generation, renderer-neutral wrapping, and
flow-barrier projection, and glyph-object resolution. The latter transforms
existing text or graphic geometry into painted decoration placements; it does
not reserve space or decide where the target should go. Glyph sampling is a
separate geometry seam: it describes a full line-height cell per visible
character, while the contrast provider owns sampling and scoring. Tests
continue to call the public planner and engine interfaces. Route-slot selection
is likewise a pure compatibility decision; the planner remains responsible for
advancing its cursor, checking occupied geometry and recording the resulting
decision. Tests do not import extracted implementations merely to increase
coverage.
