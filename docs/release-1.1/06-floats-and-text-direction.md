# Release 1.1 — floats and text direction

Status: deferred functional scope; detailed contract to be written.

## Scope

Release 1.0 intentionally does not include full float semantics or RTL/CJK
support. Release 1.1 may investigate:

- elements wrapped by text with an explicit obstacle region and a rule for
  returning to full width;
- writing direction and column order for RTL;
- wrapping and measuring CJK glyphs without assumptions about spaces between
  words;
- plan, evaluator, debug, and backend consistency for these directions.

## Entry condition

First describe the geometry and source-order contract. Do not treat the current
`no_overlap` or drawing order as a substitute for floats or RTL. Every new case
must have a plan-only proof and a minimal backend artifact.

## Acceptance criteria

- text does not pass through an obstacle and resumes a legal flow after it;
- the evaluator distinguishes legal wrapping from collision;
- RTL/CJK direction is present in the plan, debug output, and artifact;
- tests do not rely exclusively on raster output;
- existing LTR paths remain unchanged.

## Implementation map

### What exists today

- Direction is declared at template level in `server/src/template/direction.ts`
  and projected into composition templates; the current text pipeline assumes
  LTR word order and space-delimited words for most flow decisions.
- Wrapping and line measurement are split between
  `server/src/composition/text/{tokenization,text-layout,text-placement}.ts`
  and `server/src/composition/layout/{text-planner,flow-text-decision,flow-space}.ts`.
- Obstacle geometry and collision legality already use
  `server/src/composition/geometry/{rectangles,visual-geometry}.ts` plus
  `evaluation/{legality,legality-geometry}.ts`, but they model a wrapped image
  more strongly than a general float/return rule.
- The PDF adapter (`composition/adapters/pdf/text.ts` and
  `adapters/pdf/backend.ts`) paints the planned coordinates; it must not infer
  direction or wrap around an obstacle independently.

### Changes required

1. Write the renderer-neutral contract first: direction (`ltr`/`rtl`), column
   progression, text alignment, script segmentation, and a float obstacle's
   active interval plus return-to-full-width rule. Add these fields to the
   composition model/template adapter only after deciding their defaults.
2. Replace space-only assumptions in `text/tokenization.ts` and
   `text/text-layout.ts` with a measured run/cluster abstraction that can wrap
   CJK text and preserve RTL logical order while producing physical boxes.
3. Move float interval calculations into a geometry helper used by
   `layout/flow-space.ts` and `flow-text-decision.ts`. The planner should emit
   the same obstacle/return evidence that the evaluator and debug overlay use.
4. Extend `evaluation/legality-geometry.ts` and `evaluation/legality.ts` to
   distinguish a legal float detour from a collision; add direction-aware
   visual-order checks without changing existing LTR semantics.
5. Keep PDF/SVG/PPTX adapters renderer-neutral: consume the planned line boxes
   and direction metadata, and do not duplicate line breaking in
   `adapters/pdf/text.ts`.
6. Add plan-only fixtures for one float crossing two columns, RTL two-column
   order, Arabic joining, and CJK with no spaces. Add one minimal PDF/text-layer
   proof per family in `test-text-composition-engine.mjs`,
   `test-report-composition-adapter.mjs`, and the writing-system prototype
   tests. Preserve a single existing LTR baseline.

### Resulting ownership and dependencies

Template contracts own declared direction and float policy; text modules own
token/run measurement; geometry owns physical intervals; the planner owns
placement; evaluator owns legality; backends only paint. Implement after the
08–10 evidence contract so obstacle gaps and column balance are reported in the
same units, and before promoting visual calibration (07).
