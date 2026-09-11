# Release 1.1 — planned chrome content and automatic brand lockup

Status: implementation plan.

## Goal

Stop the report renderer from inventing visible header/footer content after the
composition plan has been accepted. Brand lockup, authored header text and page
number text must be ordinary planned blocks in template-defined repeating
flows. The renderer may still paint non-content page decoration such as the
page background and configured header/footer rules.

## Fixed domain boundary

- A lockup is the existing `kind: 'lockup'` structured block containing an
  optional mark asset and optional label.
- A header or footer is a template region/route, not a new entity or class.
- Repetition belongs to the route (`repeat: each-page`), not to the lockup.
- `{{page.number}}` and `{{page.count}}` remain variables inside one text block.
- Article title/period text comes from document input. The brand adapter does
  not infer an article title from a file name.
- Brand profile supplies the mark asset and default label. Template supplies
  slots and flow policy. Planner supplies geometry. Backend only paints.
- A brand description is not added to `CompositionLockup` in this release. If
  a template needs descriptive text, it is a separate text block in the same
  header flow.

## Current behavior

`composition/adapters/input.ts` can normalize an authored lockup block.
`composition/adapters/pdf/lockup.ts` measures and paints its mark and label.
`report/composition-runtime.ts` registers the capability only when such a block
already exists and resolves assets only from `CompositionDocument.assets`.

`report/renderer.ts::drawReportChrome()` still paints content outside the plan:

- fallback logo and brand label when no planned lockup exists;
- `{{page.number}} / {{page.count}}` directly in the footer;
- header/footer rules and background bands.

The first two are legacy content paths to remove. Rules and backgrounds remain
decoration and are retained.

## Target input preparation

Add procedural preparation in `server/src/report/chrome-input.ts`:

```ts
interface ReportChromeMaterializationInput {
  data: CompositionInput;
  layout: CompositionLayout;
  theme: RenderTheme;
}

function materializeReportChromeInput(
  input: ReportChromeMaterializationInput,
): CompositionInput;
```

The function returns a cloned/extended input and never mutates the caller's
object. It runs before `compositionDocumentFromInput()` and asset resolution.

### Lockup rules

1. Inspect only page templates selected by the normalized document layout.
2. A template requests automatic lockup through the template declaration below
   and must expose a compatible lockup slot in the named repeated flow.
3. If input already contains a lockup block routed to that flow, preserve it
   exactly and do not add another.
4. Otherwise prepend one deterministic `generated:brand-lockup` block to the
   declared flow, with a
   `generated:brand-mark` asset reference and the resolved brand display name.
5. Resolve the mark using the same precedence as the current `reportLogo()`:
   white mark/full logo for a white logo variant, otherwise regular mark/full
   logo. Append the matching asset only when that path exists and resolves
   inside the brand root. Its source is the existing `brand://` reference.
   The label is `theme.brandName` only when `showReportBrandName` is true. A
   label-only lockup is legal; a block with neither mark nor label is omitted.
6. If selected templates disagree — one repeating header requires a lockup and
   another cannot accept it — reject preparation with
   `INCONSISTENT_AUTOMATIC_LOCKUP_ROUTE`. Release 1.1 does not add per-template
   optionality to blocks inside one global repeated flow.
7. A document using only templates that intentionally omit lockup receives no
   generated lockup and no empty lockup slot.

The generated IDs are reserved adapter IDs. Authored input using either ID is
rejected so it cannot impersonate generated content.

When the declared flow does not exist in input, the materializer creates it
with `continuation: forbidden` and the generated block. When it exists, the
generated lockup is prepended so the existing authored title/metadata blocks
retain their order after it.

### Footer page-number rules

Every built-in report template that currently receives the hardcoded footer
number must declare a repeating footer text slot. If the corresponding footer
flow has no authored page-number block, materialization appends one block:

```jsonc
{
  "id": "generated:page-number",
  "type": "text",
  "role": "footer",
  "text": "{{page.number}} / {{page.count}}"
}
```

An authored footer block containing the page variables is the override. The
adapter detects it from normalized text and does not append a duplicate.
Templates without a generated page-number declaration receive none.
When the declared footer flow does not exist, the materializer creates it with
`continuation: forbidden` before appending the generated block.

### Header text

Existing authored header-flow blocks are preserved. No title is synthesized in
1.1 because `CompositionInput` already provides named flows and block
semantics. A title that must be bold is authored as `type: heading`; the chrome
adapter does not rewrite text blocks based on visual preference.

## Template declaration

Generated content is declared inside each page template so built-in and
brand-provided templates use the same contract:

```yaml
generated_content:
  brand_lockup:
    flow: header
  page_number:
    flow: footer
    text: "{{page.number}} / {{page.count}}"
```

Omitting one declaration means the template does not request that generated
content. It may still accept an explicitly authored compatible block. The
compiler validates that the named flow is `repeat: each-page`, that one of its
slots accepts the generated block kind/role and that page-number text contains
the supported placeholders. Selected templates that request the same generated
flow must use the same flow ID and page-number text.

There is no external migration registry, deadline or temporary
`legacy-fallback` state. Each template is self-describing. Before fallback
removal, every built-in PDF template must either contain an explicit
`generated_content` declaration or be covered by a test proving intentional
absence.

## Renderer changes

Split `drawReportChrome()` into module-level operations:

```ts
drawReportPageBackground(...)
drawReportChromeDecoration(...)
```

The decoration function paints configured bands and header/footer rules only.
Delete fallback logo/name painting, the `plannedLockup` branch, the
`continuation` choice of lockup geometry and hardcoded page-number text.

Remove the now-unused `CompositionPageChrome.pageNumber` geometry after plan
and debug consumers use the footer text placement. Keep rule/band boxes needed
by spacing reports and decoration.

`prepareReportComposition()` calls `materializeReportChromeInput()` before
normalization, then resolves the generated brand asset through the same path as
document images. Lockup capability registration continues to depend on the
resulting block kinds.

## Implementation sequence

1. Complete item 11 so selected template sources are authoritative.
2. Add and validate the per-template `generated_content` contract.
3. Add `materializeReportChromeInput()` with pure input/output tests.
4. Route materialized input through plan-only, dry-run and PDF entrypoints.
5. Migrate built-in templates to explicit repeating lockup/footer slots;
   preserve fixed-height headers where a test's contract requires it.
6. Prove planned lockup and page-number placements on every classification.
7. Split chrome decoration and remove renderer-authored content.
8. Delete obsolete geometry/config keys only after `rg` and contract tests show
   no remaining consumer.
9. Render one representative short and one multi-page report and inspect text
   layer plus placement boxes.

## Files changed

| Area | Change |
|---|---|
| `report/chrome-input.ts` | pure input materialization |
| `report/composition-runtime.ts` | prepare chrome input before document/assets |
| `report/renderer.ts` | decoration only; delete implicit content |
| `composition/contracts/engine-contracts.ts` | remove obsolete page-number chrome box after migration |
| `composition/adapters/pdf/lockup.ts` | retain mark+label measurement; no new model |
| page templates | explicit fit-content lockup/header and repeated footer slots |
| page-template contract | validate optional generated-content declarations |
| `render-config.yml` | retain tunable values; delete only unused legacy keys |

## Test matrix

| Requirement | Cheapest proof | Target test |
|---|---|---|
| authored lockup wins | normalized input/plan | `test-brand-contract.mjs` |
| automatic mark+label is deterministic | pure materializer | `test-brand-contract.mjs` |
| label-only lockup works | plan-only measured block | `test-report-chrome.mjs` |
| inconsistent templates fail clearly | adapter test | `test-page-template-adapter.mjs` |
| intentional absence leaves no space | plan slots/placements | `test-report-chrome.mjs` |
| page number is one repeated footer block | plan/text placeholders | `test-editorial-plan-contract.mjs` |
| long header changes occupied height | plan spacing | `test-report-chrome.mjs` |
| renderer invents no logo/page number | drawing recorder/text extraction | `test-report-composition-adapter.mjs` |
| public paths return the same placements | one plan-only MCP and CLI case | public contract tests |
| visual result remains acceptable | one multi-page PDF | editorial visual smoke test |

## Completion criteria

- Every visible lockup, header string and page-number string has a source block
  and placement in the selected plan.
- `drawReportChrome()` no longer mixes content and decoration.
- No `plannedLockup` or continuation-lockup branch remains.
- Every built-in PDF page template has an explicit generated-content decision
  in its source or an intentional-absence contract test.
- Generated IDs are stable and collision-protected.
- Empty, short and multi-line chrome report exact occupied boxes and gaps.
- Plan-only, dry-run and PDF paths consume the same materialized input.
- No header/footer class or parallel planner path is introduced.
