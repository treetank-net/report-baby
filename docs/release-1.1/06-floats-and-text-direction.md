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
