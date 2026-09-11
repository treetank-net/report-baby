# Release 1.1 — explicit PDF paint order

Status: implementation plan.

## Goal and boundary

Make the current jsPDF composition-placement order explicit, configurable and
deterministic without changing planner priority, geometry, legality, source
order or the default rendered result.

This item controls composition placements only. Page background, decorative
chrome rules and the optional debug overlay are emitted by
`report/renderer.ts`, outside `createJsPdfTextBackend()`. Their fixed order is:

```text
page background and chrome decoration
  -> composition placements in configured phases
  -> debug overlay only when requested
```

Item 03 first removes text, logo and page-number content invented by that outer
chrome pass. Moving the remaining page decoration into the composition backend
would require a separate contract and is not hidden inside this task.

## Fixed decisions

- `priority` continues to mean geometry reservation order. It does not affect
  painting.
- Paint phases are PDF-adapter configuration, not properties of flows, blocks,
  slots or the public composition plan.
- One renderable category maps to exactly one phase. Release 1.1 does not add
  per-placement phase overrides.
- Two placements in the same category preserve their plan-array order.
- `paint: false` graphics emit no command but retain obstacle geometry.
- Tables and structured blocks remain atomic; this task does not reorder their
  internal drawing operations.
- The default YAML order exactly reproduces the current backend loop.

## Current execution

`createJsPdfTextBackend().render()` in
`server/src/composition/adapters/pdf/backend.ts` currently creates pages and
then renders tables, graphics, blocks, ordinary lines, insertion lines and
glyphs in six separate loops. A nested `renderLine()` performs line painting.

The order is encoded by loop position. `CompositionPlan` has no paint metadata,
and `render-config.yml` has no phase list.

## Configuration contract

Add the ordered list:

```yaml
pdf:
  paint_order:
    - table
    - graphic
    - block
    - flow-text
    - insertion-text
    - glyph
```

Use this closed PDF-adapter union:

```ts
type PdfPaintPhase =
  | 'table'
  | 'graphic'
  | 'block'
  | 'flow-text'
  | 'insertion-text'
  | 'glyph';
```

Configuration loading rejects an unknown phase, duplicate phase, omitted
canonical phase or non-array value. There is no code fallback list: the
default comes from YAML and an incomplete list is a configuration error.

## Internal command contract

Create `server/src/composition/adapters/pdf/paint-order.ts`. Use data records,
not closures carrying hidden jsPDF state:

```ts
type PdfRenderCommand =
  | { phase: 'table'; page: number; placementIndex: number; placement: CompositionTablePlacement }
  | { phase: 'graphic'; page: number; placementIndex: number; placement: CompositionGraphicPlacement }
  | { phase: 'block'; page: number; placementIndex: number; placement: CompositionBlockPlacement }
  | { phase: 'flow-text'; page: number; placementIndex: number; line: CompositionLine }
  | { phase: 'insertion-text'; page: number; placementIndex: number; line: CompositionLine }
  | { phase: 'glyph'; page: number; placementIndex: number; placement: CompositionGlyphPlacement };
```

`placementIndex` is the position in the original plan collection. Export
procedural functions:

```ts
collectPdfRenderCommands(plan: CompositionPlan): PdfRenderCommand[]
sortPdfRenderCommands(commands: PdfRenderCommand[], phases: PdfPaintPhase[]): PdfRenderCommand[]
```

The sort key is page, configured phase index, placement index.
No map enumeration, identifier, flow name or creation timestamp participates.

## Backend execution

Extract the nested `renderLine()` into a module-level function in `backend.ts`.
Add one exhaustive command dispatcher. Each branch invokes the existing table,
graphic, block, line or glyph renderer.

Validate all capabilities before the first drawing command so a missing
renderer cannot leave a partially rendered artifact. Preflight verifies source
blocks, table/block renderers, graphic styles/assets, line styles and glyph
styles. Page creation and initial-size validation remain before command
execution.

## Interaction with legality

The evaluator remains unchanged. Forbidden overlap rejects a plan regardless
of phase, allowed overlap is resolved visually by phase order, and an invisible
graphic obstacle remains part of collision checks.

Release 1.1 does not provide configurable ordering between two graphics. They
share one phase and use stable placement order. Per-placement layering would
require a separate public/template contract.

## Implementation sequence

1. Complete item 03's removal of renderer-authored textual chrome.
2. Add and validate `pdf.paint_order` in YAML and `adapters/render-config.ts`.
3. Add `paint-order.ts` with pure collection and sorting tests.
4. Extract the nested line renderer without changing loop order.
5. Add backend capability preflight.
6. Replace the six loops with sorted command dispatch.
7. Remove obsolete loop-order comments and duplicate filtering.
8. Verify the default order against the representative PDF.

Every step must build. Step 6 changes the execution mechanism; with the default
configuration it must not change output.

## Test matrix

| Requirement | Proof | Test |
|---|---|---|
| YAML contains every phase exactly once | config parse, no PDF | render-config contract test |
| page/phase/index ordering | pure command records | new `test-pdf-paint-order.mjs` |
| graphics preserve plan order | drawing recorder | `test-js-pdf-adapter.mjs` |
| `paint: false` emits nothing but keeps geometry | plan plus drawing recorder | `test-js-pdf-adapter.mjs` |
| forbidden overlap ignores phase | plan-only legality | composition legality test |
| default phases preserve output | one PDF/text/drawing comparison | `test-report-composition-adapter.mjs` |

No test claims that two graphics occupy different phases because the release
does not define that capability.

## Completion criteria

- No composition category is rendered by a category-specific loop outside the
  command dispatcher.
- The phase list has one YAML source and is fully validated.
- Default geometry, legality, selectable text and drawing-record order are
  unchanged.
- Reordering configured categories changes recorded drawing order without
  changing the plan.
- `CompositionPlan` and template schemas gain no paint-phase field.
- The representative backend test creates at most one PDF.
