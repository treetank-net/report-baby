# Diagnostics and remediation guidance

Status: deferred Release 1.1 contract; implementation has not started.

## Problem

The current planner and evaluator can report that a plan is illegal, but a
machine-readable error is not yet a complete explanation for an operator. A
useful failure must identify the violated rule, the affected page/flow/block/
slot, the measured values that caused the violation, and the smallest actions
that can make another candidate legal.

This applies to composition diagnostics, CLI/MCP responses, and the repository
skills that instruct an agent how to interpret a failed render. It does not
mean weakening legality checks or silently changing the requested document.

## Required diagnostic shape

Every planning or evaluation error should expose, where known:

1. `code`: stable machine-readable error code;
2. `message`: one concise human-readable statement of the violated rule;
3. `why`: the concrete comparison or missing prerequisite that caused it;
4. `scope`: flow, block, page, slot, route, and template identifiers;
5. `evidence`: measured geometry, capacity, content range, or candidate data;
6. `remedies`: ordered, actionable options (for example move an insertion,
   choose a template that has the slot, allow continuation, or provide more
   pages); and
7. `retryable`: whether changing input/template policy can produce another
   legal candidate.

Unknown values must be omitted rather than fabricated. The existing stable
`code` and severity remain compatible fields; this task adds explanation, not
a second legality model.

## Message examples

```text
FLOW_SLOT_NOT_FOUND
Flow `sidebar` has content on page 6, but template
`pages/editorial-two-column` exposes no compatible slot there.
Why: eligible slots = []; the flow is not allowed to use `main`.
Remedies: select a scheduled template with a `sidebar` slot on page 6,
declare a request-owned insertion slot, or move the flow to a legal page.
```

```text
LINE_OUTSIDE_SLOT
Paragraph `network-fragmentation-economics` on page 3 extends 4.8 mm beyond
slot `content:segment-1`.
Why: the line box right edge is 113.4 mm while the slot right edge is 108.6 mm.
Remedies: reduce the competing insertion width, move it away from this
column, or let the planner use another page/template candidate.
```

```text
INSERTION_OVERFLOW
Image `photo-cipiur` cannot fit in `photos/photo-slot` on page 4.
Why: measured content height is greater than the slot's configured maximum.
Remedies: lower the requested image width, increase the fit-content maximum,
choose a larger slot, or place the image on a later page.
```

## Skill and interface work

The Release 1.1 implementation must update the repository's relevant skills
and agent-facing instructions so that a failed render is reported with the
fields above. The CLI and MCP responses must carry the same structured
diagnostic data; prose wrappers may summarize it but must not discard `why`,
`evidence`, or `remedies`.

The update must include:

- a catalogue of stable diagnostic codes and their remediation templates;
- guidance to distinguish an illegal input from an exhausted search space;
- instructions to show the affected artifact and the next safe action;
- tests for representative planner, evaluator, CLI, and MCP failures; and
- a rule that an agent must not claim success when the only output is a PDF
  accompanied by an unresolved legality error.

## Acceptance criteria

- The same failed plan has equivalent structured diagnostics through the
  composition API, CLI, and MCP tool.
- At least one failure from each major family (missing slot, overflow,
  out-of-bounds geometry, forbidden continuation, and unmet hard requirement)
  includes a concrete cause and at least one actionable remedy.
- Existing error codes remain stable unless a separately approved contract
  explicitly changes them.
- Skill guidance and tests are updated in the same change as the diagnostic
  contract.

## Implementation map

### What exists today

- `CompositionDiagnostic` in
  `server/src/composition/contracts/engine-contracts.ts` has stable `code`,
  `severity`, `message`, optional IDs, and an untyped `details` record; it has
  no first-class `why`, `evidence`, `remedies`, or `retryable` fields.
- Planner failures are assembled across `composition/layout/*.ts` and
  `layout/document-layout.ts`; legality checks are centralised in
  `composition/evaluation/legality.ts` and content checks in
  `evaluation/content.ts`.
- `evaluation/evaluator.ts` already creates a partial `CompositionSuggestion`
  from negative score components, while `evaluation/scoring.ts` supplies the
  component details. This is the seed for the full contract, not a complete
  diagnostic catalogue.
- `server/src/interfaces/mcp/responses.ts`,
  `interfaces/mcp/render-tools.ts`, and `interfaces/cli/*.ts` format the same
  plan/evaluation through different wrappers; errors currently risk losing
  nested evidence. Skills under `skills/` explain operation but do not yet
  require a remediation payload.

### Changes required

1. Add typed optional fields to `CompositionDiagnostic` and
   `CompositionSuggestion` (`why`, `scope`, `evidence`, `remedies`,
   `retryable`) while preserving every existing error code and severity.
2. Create one remediation catalogue (for example
   `server/src/composition/evaluation/diagnostic-catalogue.ts`) keyed by stable
   codes. It should receive measured values and return a concise explanation,
   ordered remedies, and retryability; planner modules should report facts, not
   duplicate prose.
3. Update legality/content/planner call sites to pass structured evidence:
   selected template and slot, capacity comparison, page/range, residual
   content, candidate/budget state, and the relevant geometry boxes. Omit
   unknown values instead of emitting fake zeroes.
4. Make `evaluation/evaluator.ts` merge hard diagnostics and soft aesthetic
   suggestions through the same catalogue. Keep legality fail-closed and keep
   score-based suggestions separate from hard violations.
5. Preserve the payload through MCP and CLI compact/full serializers in
   `server/src/interfaces/mcp/responses.ts` and the CLI response path. Compact
   output may summarise, but `diagnostics: full` must expose the complete
   evidence and candidate trace.
6. Update the relevant skills and `AGENTS.md` guidance with the failure
   interpretation rule and the requirement to show the next safe action. Add
   plan-only tests for missing slot, overflow, bounds, forbidden continuation,
   unmet hard requirement, and one negative aesthetic suggestion; add one MCP
   and one CLI equivalence assertion in
   `test-public-mcp-contract.mjs`, `test-cli.mjs`,
   `test-input-errors.mjs`, and `test-editorial-plan-contract.mjs`.

### Resulting ownership and dependencies

Planner/layout modules own factual context, the diagnostic catalogue owns
wording/remedies, evaluator owns hard-versus-soft classification, and interface
adapters own serialisation. Items 09–10 consume this contract; item 04 may
consume its candidate evidence but must not invent a second error format.
