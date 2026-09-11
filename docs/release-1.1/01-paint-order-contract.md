# Release 1.1 — explicit paint order

Status: target-contract proposal; not an implementation yet.

## Boundary with Release 1.0

Release 1.0 has two established facts:

1. `priority` is used only for earlier reservation and geometry calculation for
   placements;
2. the backend preserves the existing command order as the migration baseline.

We do not derive drawing order from `priority`, and we do not change the backend
for that reason as part of item 12. This document describes a separate Release
1.1 contract.

## Why an explicit contract is needed

The current backend has no paint-order field or policy. The order follows from
`render()` iterating through separate plan arrays in sequence:

```text
tablePlacements
→ graphicPlacements
→ blockPlacements
→ ordinary text lines
→ insertion lines
→ glyphPlacements
```

This works because the planner and evaluator generally forbid collisions. It is
not explicit enough for:

- controlled overlap of decorations and graphics;
- multiple backends rendering the same plan;
- predictable visibility of glyphs, backgrounds, and insertions;
- tests that distinguish a correct box from a correct visual result;
- deliberate preservation of PDF content-stream order.

The loop order is therefore currently an implementation fact, not a domain
contract. Release 1.1 gives it a name, an owner, and a testable rule.

## Definitions

### `priority`

`priority` is planner metadata. A higher number means a stronger claim to have
geometry resolved earlier. The planner may sort placements in descending order
to reserve their space first. During migration, an omitted value explicitly
means `composition_priority.default` from YAML (currently `100`) — the lowest
claim level — and not `0`.

`priority` does not answer which element should be visually above another. In
Release 1.0 it is not the source of paint order.

### Paint order

Paint order is the order in which the backend adapter emits physical drawing
commands to PDF/PNG/SVG. It is renderer execution order, not:

- flow and slot order;
- authored-block order;
- continuation order across pages;
- geometry-reservation order;
- an automatic `z-index`.

### `paint phase`

In Release 1.1, paint order is represented by named phases. A phase is a stable
backend key, not a new block type or public content entity.

## Adopted Release 1.1 model

### One explicit backend phase list

The source of order is renderer configuration, not accidental plan-array order:

```yaml
pdf:
  paint_order:
    - page-background
    - table
    - graphic
    - block
    - flow-text
    - insertion-text
    - glyph
    - debug
```

The list is ordered from earliest to latest painting. A later-phase element may
visually cover an earlier-phase element when the legality contract permits the
overlap. Position in the list is the only relevant relation; do not introduce
separate, scattered numbers in code.

The default list reproduces the current backend order for phases that already
exist. `page-background` and `debug` are names for future/outer operations and
must not be faked by ordinary placements.

### Mapping placements to phases

The backend or its adapter normalises every renderable plan result to a phase:

| Plan result | Default phase | Notes |
|---|---|---|
| `tablePlacements` | `table` | the table renderer remains atomic inside its placement |
| `graphicPlacements` with `paint !== false` | `graphic` | `paint: false` emits no command, but geometry may still be an obstacle |
| `blockPlacements` | `block` | includes image, metric, chart, and the future lockup |
| `CompositionLine` with `layer !== 'insertion'` | `flow-text` | preserves ordinary flow text |
| `CompositionLine` with `layer === 'insertion'` | `insertion-text` | preserves insertion-text separation |
| `glyphPlacements` | `glyph` | remains above content by default when boxes may overlap |
| debug overlay | `debug` | observation; does not change the plan or geometry |

Mapping does not change the block type, flow, or route. It is a renderer-adapter
decision, because the adapter knows the capabilities of its backend.

### Tie-breaker

Two placements in the same phase are rendered deterministically by:

1. page number;
2. stable placement order recorded in the plan;
3. a technical identifier only as the final tie-break.

Do not sort by object-creation time, map-key order, or flow name. A paint-order
change must be visible in configuration or in an explicit change to the plan's
stable order.

## Relationship with `priority`

In the basic Release 1.1 contract, `priority` and paint phase are separate:

```text
priority ↓  → earlier geometry reservation
paint phase ↑ → later command execution and potential covering
```

This does not prevent them from having a shared source. An adapter may eventually
derive both values from one semantic policy, but the mapping must be explicit
and testable. Do not make paint order depend on planning order merely because
both processes use the word “priority”.

For example, a footer may have a high `priority` so that its dynamic geometry
is resolved before `main`, while its paint phase may be late or early depending
on the visual decision. With non-overlapping boxes this does not change legality.

If the product chooses one shared number in the future, it must adopt an
explicit mapping, for example higher `priority` means later paint and a higher
layer. That is not a 1.0 contract or a requirement of this document.

## Owners

```text
render-config.yml
  → renderer configuration adapter
  → placement-to-paint-phase mapping
  → backend creates commands and sorts them by phase + tie-breaker
  → evaluator checks overlap legality independently of command order
```

- `render-config.yml` owns the default phase list and its order;
- the adapter may reject an unknown phase or use an explicit fallback;
- the planner does not import configuration or the PDF API;
- the evaluator does not legalise a collision merely because an element paints
  later;
- the backend executes commands and owns PDF graphic state;
- the template defines slots, geometry, and allowed content types, but need not
  know technical jsPDF commands.

If different backends require different phases, each adapter may have its own
execution map while preserving the same semantic categories. Do not create a
public `paintOrder` string field on every block.

## Required technical change

The current separate plan arrays are insufficient for arbitrary explicit
sorting. The backend needs an internal renderer-command list, for example:

```text
RenderCommand {
  page,
  phase,
  stableIndex,
  render(): void
}
```

This is an adapter type, not a new domain entity. A command keeps a reference to
an existing placement and invokes its capability. Measurement, routing, and
legality do not move into the backend.

Atomic renderers such as a table or metric card retain their own internal draw
order. Paint phase controls placement order, not individual table cells or
glyph fragments. Interleaving commands inside one block, if ever needed, is a
separate capability contract.

## Legality and overlap

Paint order does not replace the evaluator. Every pair of elements is in one of
three situations:

1. boxes do not overlap — paint order is visually irrelevant;
2. overlap is explicitly allowed — phase decides which element is visible on
   top;
3. overlap is forbidden — the plan is rejected regardless of which element
   would be drawn later.

`paint: false` means no physical command, not permission for a collision. The
obstacle remains part of plan geometry and may constrain text.

## Tests required before rollout

### Configuration contract

- a missing phase or duplicate name produces a clear configuration error;
- every renderable category maps to exactly one phase;
- the default list gives the current result for non-overlapping placements;
- order is stable across runs and backends.

### Overlap

- a background graphic and text above it;
- two graphics with different phases;
- an insertion and ordinary text in a legal overlap case;
- a glyph above or below text depending on phase;
- `paint: false` with obstacle geometry preserved;
- a forbidden collision rejected independently of paint order.

### Artifacts

- PDF, PNG/debug, and `dry_run` identify the same placements;
- selectable text keeps a separate semantic source order;
- changing a phase changes only the verified visual layer, not routing or
  content coverage;
- the current corpus does not change without an explicit configuration change.

## Implementation order

1. Inventory every command in the current backend and identify which commands
   are placement-level and which are internal to a capability.
2. Add validation of `pdf.paint_order` in the adapter configuration seam.
3. Introduce an internal `RenderCommand` without changing public
   `CompositionPlan`.
4. Keep the current order as the default fallback and compare PDF/text/bbox/
   raster output with the baseline.
5. Add controlled overlap cases and evaluator tests.
6. Only then consider mapping selected placements to a custom phase or linking
   policy to `priority`.

## Implementation map

### What exists today

- `CompositionPlan` in `server/src/composition/contracts/engine-contracts.ts`
  stores separate placement arrays and has no paint-phase field.
- `createJsPdfTextBackend().render()` in
  `server/src/composition/adapters/pdf/backend.ts` emits those arrays in a
  fixed loop: tables, graphics, blocks, ordinary lines, insertion lines, then
  glyphs.
- `server/src/composition/adapters/render-config.ts` reads typed PDF options,
  but `server/templates/render-config.yml` has no `pdf.paint_order` list.
- `server/src/composition/evaluation/legality.ts` and
  `evaluation/legality-geometry.ts` decide collisions from boxes, not from
  draw order. This separation is the behaviour to preserve.

### Changes required

1. Add `pdf.paint_order` to `server/templates/render-config.yml` and expose a
   validated `PaintPhase[]` from `adapters/render-config.ts`. Reject duplicates
   and unmapped render categories at configuration load time.
2. Add a renderer-private module (for example
   `server/src/composition/adapters/pdf/paint-order.ts`) that converts the
   existing plan arrays into `{ page, phase, stableIndex, render }` commands.
   Use array insertion order as the stable index and never use map/object order.
3. Refactor only the PDF adapter loop to sort commands by page, configured
   phase index, and stable index. Keep capability-internal drawing (table rows,
   chart labels, glyph runs) inside its existing renderer.
4. Leave `CompositionPlan`, planner priority, and legality contracts unchanged;
   expose phase/order only through backend diagnostics when requested.
5. Add plan-only overlap assertions and one small PDF assertion in
   `server/scripts/test-js-pdf-adapter.mjs`,
   `server/scripts/test-report-composition-adapter.mjs`, and the relevant
   composition contract test. Extend documentation validation with the YAML
   phase catalogue.

### Resulting ownership and verification

Configuration owns the phase list, the PDF adapter owns command normalisation
and execution, the planner owns geometry, and the evaluator owns legality. A
phase change must therefore be observable in a backend test while leaving plan
boxes, content coverage, and legality identical.

## Out of scope

- an automatic global geometry solver;
- changing `continuation` policy;
- changing route/slot order or source/reading order;
- moving `main` content into insertions;
- arbitrary CSS `z-index` for every block;
- public `readingOrder` and `selectionGroup` fields.
