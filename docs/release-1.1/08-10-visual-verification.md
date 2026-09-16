# Release 1.1 — 08–10 visual verification record

Status: verified in part; not complete.

This record is deliberately separate from the executable contract tests. A
plan can be legal and still be visibly poor, so the final check includes a
human inspection of one representative rendered document.

## Scenario

- Source: the deterministic numbered editorial fixture used by
  `scripts/test-editorial-plan-contract.mjs`.
- Template: `editorial-inset-two-column` with one `fluid-y` quote capability,
  materialized as two bounded quote slots per page.
- Content: 1,242 main-flow words and four authored quote insertions.
- Planning result: six pages, no residual content, `accepted` evaluation.
- Automated entry point: `scripts/test-composition-quality-e2e.mjs`.
- Temporary visual artifact from the verification run:
  `/tmp/report-baby-composition-quality-e2e.pdf` (PNG pages were rendered with
  `pdftoppm` for inspection).

## What the plan-only checks prove

- The fluid capability is compiled and materialized into page-local
  `#1`/`#2` slots.
- All authored quote insertions are present in the renderer-neutral plan.
- The plan exposes page, slot, region and insertion-rhythm evidence.
- Slot occupied and empty areas partition the slot envelope.
- Quality score components and non-blocking suggestions are serialized with
  evidence, rationale and remedies.
- The result is legal and residual-free.

## What visual inspection found

- The first five pages are readable and the two-column flow is generally
  continuous.
- Quote insertions are visible and remain inside their declared materialized
  capabilities. Their glyphs render, but the vertical rhythm is not uniformly
  balanced. The inspection also exposed glyphs intruding into nearby text;
  this is now represented by the `glyph-overlap` quality component and the
  `GLYPH_TEXT_OVERLAP` remediation suggestion.
- The sixth page contains only a short tail of text and a large unused lower
  region. This is acceptable because it is the terminal main-flow page: the
  document has no residual content and no artificial blank page was created.
  Terminal-page underfill must therefore not be treated as the same defect as
  a premature break on an earlier page.
- The current fixture does not demonstrate that the evaluator can select a
  visibly better candidate after observing those penalties. It demonstrates
  measurement and reporting, not successful visual optimization.

## Conclusion

Items 08–10 provide the intended evaluator feedback slice, but the end-to-end
LLM/template-selection loop is not covered by this fixture. The implementation
correctly permits natural underfill on the terminal page and reports the
remaining spacing and glyph defects. The caller must use those findings to
reject this template choice or select a better template; the evaluator should
not silently invent one.

Before marking the integration work complete, add a visual acceptance case
with two explicit template choices and verify that the caller selects the
visibly preferable legal result after reading the evaluator feedback. Keep
this human inspection as a small representative gate; do not render every
synthetic test fixture.
