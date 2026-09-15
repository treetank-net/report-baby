# Release 1.1 — one document layout and explicit page templates

Status: implementation plan.

## Goal

Expose one public `layout` declaration describing which reusable page template
is used for each page span. Remove `page_template_schedule` and the competing
route-level `layouts` selection path while preserving the candidate and
continuation behavior completed in item 02.

## Canonical vocabulary

- **template** — one reusable page-composition contract and its page geometry;
- **layout** — one document-level ordered declaration assigning templates to
  page spans;
- **page span** — exactly one absolute inclusive range, relative page count or
  remaining open tail;
- **layout entry** — plain page-span + template data, not a domain entity;
- **route** — ordered compatible slots and flow policies; it never selects a
  template;
- **continuation** — whether an already-started flow may cross a page boundary;
  it does not select page geometry.

There is no public or domain concept named `pageLayout`. Internal compiled page
geometry is called a page template.

## Fixed decisions

- A request supplies either top-level `template` or `layout`, never both.
- With `template`, that template is used for every materialized page.
- With `layout`, entries are authoritative and must cover pages contiguously
  from page 1. The last entry may be open.
- Public layout entries use `template`, not `template_ref`.
- `pages` is a closed union: an exact inclusive `{ from, to }` range, a
  relative `{ count }`, or the literal `"remaining"`. These forms cannot be
  mixed.
- Exact and ranged page-count candidate behavior from completed item 02 is
  retained, but its ambiguous optional-field syntax is not part of the new
  public contract.
- No backward-compatible public alias remains. `page_template_schedule` is
  rejected with a migration message.
- A selected page template is resolved before route slots are queried.
- A compiled route contains the stable union of its named slots across selected
  templates. Availability on one page is derived by intersecting that union
  with the already-selected page template; no per-template route map remains.
- Dynamic request insertion slots remain explicit per-page overlays and cannot
  accept `main`.
- `continuation` behavior does not change.

## Public request contract

```jsonc
{
  "layout": [
    { "pages": { "count": 1 }, "template": "pages/editorial-cover" },
    { "pages": { "from": 2, "to": 5 }, "template": "pages/editorial-body" },
    { "pages": "remaining", "template": "pages/editorial-sidebar" }
  ],
  "data": { "flows": { /* ... */ } }
}
```

The alternative single-template form is:

```jsonc
{
  "template": "pages/editorial-body",
  "data": { "flows": { /* ... */ } }
}
```

A layout with candidate lengths is explicit about the relative form:

```jsonc
{
  "layout": [
    { "pages": { "count": 1 }, "template": "pages/editorial-cover" },
    { "pages": { "count": { "min": 2, "max": 5 } }, "template": "pages/editorial-body" },
    { "pages": "remaining", "template": "pages/editorial-sidebar" }
  ],
  "data": { "flows": { /* ... */ } }
}
```

Add the complete structural schemas/types in `contracts/input/schema.ts`:

```ts
const positivePageIntegerSchema = z.number().int().positive();

const layoutPageCountSchema = z.union([
  positivePageIntegerSchema,
  z.object({
    min: positivePageIntegerSchema,
    max: positivePageIntegerSchema,
  }).strict().refine(({ min, max }) => min <= max, {
    message: 'layout.pages.count.min must not exceed max.',
  }),
]);

const layoutPagesSchema = z.union([
  z.object({
    from: positivePageIntegerSchema,
    to: positivePageIntegerSchema,
  }).strict().refine(({ from, to }) => from <= to, {
    message: 'layout.pages.from must not exceed to.',
  }),
  z.object({
    count: layoutPageCountSchema,
  }).strict(),
  z.literal('remaining'),
]);

export const layoutEntrySchema = z.object({
  pages: layoutPagesSchema,
  template: z.string().min(1),
}).strict();

export const documentLayoutSchema = z.array(layoutEntrySchema).min(1);
export type DocumentLayoutInput = z.infer<typeof documentLayoutSchema>;
```

The three union members have non-overlapping meanings:

| `pages` shape | Meaning before positional validation |
|---|---|
| `{ from, to }` | exact inclusive range |
| `{ count: n }` | exact `n` pages beginning after the preceding entry, or at page 1 |
| `{ count: { min, max } }` | finite candidate lengths beginning after the preceding entry, or at page 1 |
| `"remaining"` | open range beginning after the preceding entry, or at page 1; legal only as the final entry |

`from` and `to` are both required in the absolute form and `to` is inclusive.
`count` is relative to the preceding normalized entry. The contract does not
accept `{}`, `{ from }`, `{ to }`, `{ from, count }`, `{ from, to, count }` or
any other redundant mixture.

The entry schema validates the union shape, positivity, strict object keys,
`from <= to` and `min <= max`. It intentionally does not pretend that one
entry can validate its position in the array. `normalizeDocumentLayout()`:

- expects the first assignment to begin at page 1;
- derives the start and end of a `{ count }` entry from each preceding
  candidate branch;
- requires an exact `{ from, to }` entry to begin immediately after the
  preceding branch;
- expands finite `{ count: { min, max } }` alternatives in ascending order;
- discards candidate branches that cannot join a following exact range;
- rejects the layout only when no contiguous candidate remains;
- permits `"remaining"` only as the final entry; and
- emits normalized, contiguous assignments without gaps or overlaps.

The parent request schema uses an exclusive union/refinement for `template`
versus `layout`. The old snake-case field is not accepted.

## Internal naming and target types

The current names conflate compiled page geometry with document layout. Apply
this complete rename:

| Current | Target | Meaning |
|---|---|---|
| `CompositionLayoutTemplate` | `CompositionPageTemplate` | compiled geometry/slots of one reusable page template |
| `CompositionTemplate` | `CompositionLayout` | compiled planning input for one document-layout candidate |
| `CompositionTemplate.layouts` | `CompositionLayout.pageTemplates` | referenced compiled page templates |
| `CompositionPageTemplateRange` | `CompositionPageTemplateAssignment` | normalized inclusive range selecting a page template |
| `pageTemplateSchedule` | `pageTemplateAssignments` | internal normalized assignments |
| `layoutId` on page/spacing data | `pageTemplateId` | technical compiled template ID |
| `templateRef` | retain | stable source/catalogue template reference |
| `route.layouts` | remove | obsolete competing template selection |
| `slotsByLayout` | remove | redundant slot eligibility already derivable from the selected template |

When templates expose different slots for the same flow, compilation builds
`route.slots` as their stable first-appearance union. The selected page
template's actual slot collection is the only availability filter.

Target internal records:

```ts
interface CompositionPageTemplateAssignment {
  from: number;
  to?: number;
  templateRef: string;
  pageTemplateId: string;
}

interface CompositionLayout {
  pageTemplates: CompositionPageTemplate[];
  pageTemplateAssignments?: CompositionPageTemplateAssignment[];
  routes: Record<string, CompositionFlowRoute>;
  maxPages: number;
  pageSlotOverlays?: Record<number, CompositionSlotTemplate[]>;
  headingKeepWithNextLines?: number;
}

interface CompositionFlowRoute {
  slots: string[];
  insertionSlots?: string[];
  continuation: 'allowed' | 'forbidden';
  priority?: number;
  repeat?: 'each-page';
  startPage?: number;
}
```

These rename existing procedural data. They do not add another planning layer.

## Normalization process

Rename `adapters/page-template-schedule.ts` to
`adapters/document-layout.ts`. Its public functions become:

```ts
normalizeDocumentLayout(input: DocumentLayoutInput): DocumentLayoutVariant[]
pageTemplateAssignmentForPage(
  assignments: CompositionPageTemplateAssignment[],
  page: number,
): CompositionPageTemplateAssignment
```

Normalization preserves the completed item-02 behavior behind the new,
unambiguous input union:

1. accept exactly one page-span form per entry;
2. require an exact first range to begin at page 1, or derive page 1 for an
   initial count/remaining entry;
3. derive relative count assignments separately for every candidate branch;
4. expand finite `count: { min, max }` alternatives in ascending order;
5. join a following exact range only to candidate branches that end immediately
   before its `from` page;
6. reject the layout when every branch has a gap or overlap;
7. retain `remaining` only as the final open assignment.

Every normalized variant begins at page 1. A page without an assignment before
the open tail/materialized limit is a layout error, not a top-level-template
fallback.

## Page creation and bounds

A page span selects the template for a page if that page is materialized. It
does not create empty pages by itself. Pages are still materialized lazily when
a flow or an explicit page-owned insertion needs them. Consequently:

- a finite final assignment sets that candidate's maximum page to its inclusive
  `to`;
- `remaining` extends only to the existing configured composition page limit;
- a finite assignment beyond that configured limit is an illegal candidate and
  is never silently truncated;
- count-range branches beyond the configured limit are discarded, while legal
  shorter branches remain candidates;
- the request fails when no branch remains within the configured limit; and
- a requirement that content appear on a later page must still be expressed by
  a flow/slot requirement; an unused assignment does not manufacture that page.

The configured composition page limit remains owned by
`server/templates/render-config.yml`. The public layout contract does not copy
or override that numeric limit.

## Validation failures

Schema and normalization failures use the normal CLI/MCP error path, but their
messages must be actionable without an ad-hoc debug script. Each failure names
the layout entry, includes the received and expected page information and says
which input field can fix it.

| Failure | Required evidence and remediation |
|---|---|
| invalid union member | entry index, received keys/value, and the three accepted `pages` forms |
| invalid absolute range | `from`, `to`, inclusive semantics, and the required ordering |
| gap or overlap | entry index, expected next page, actual `from`, and whether to change the range or preceding count |
| non-final `remaining` | entry index and instruction to move it to the final entry or replace it with a finite span |
| no count variant joins an exact range | tested count interval, resulting end-page interval, next `from`, and the compatible count/range change |
| configured page limit exceeded | candidate end page, configured limit, and instruction to shorten the span or change the owning YAML configuration |
| no legal variant | rejected branch summary rather than only a generic `no plan` message |
| removed `page_template_schedule` | replacement field `layout`, `template` entry key, and accepted `pages` forms |

When some count branches are discarded but another remains legal, detailed
plan/search output records the rejected branch reason and the surviving
normalized assignments through the existing diagnostics/search output. Do not
introduce a second layout-debug report.

## Planning process

```text
request template/layout
  -> normalize one or more document-layout variants
  -> resolve and compile every referenced page template
  -> build one CompositionLayout per variant
  -> create page 1 from its assignment
  -> when a flow searches/continues, ensure the next page from assignments
  -> materialize selected page template slots and request overlays
  -> intersect route slots with the selected page template's slots
  -> apply first-placement and continuation policy
  -> finish/evaluate the complete candidate
```

`page-state.ts::layoutForPage` (renamed `pageTemplateForPage`) receives the
`CompositionLayout` and page number. It performs only assignment lookup and
compiled-template lookup. Delete this fallback:

```text
route.layouts[page - 1] -> first compiled layout
```

For the single top-level-template form, compilation creates one
`CompositionPageTemplate` and omits assignments; `pageTemplateForPage` returns
that sole template for every page. More than one compiled page template without
assignments is an internal error.

After selection, `routeSlots()` filters the route's stable `slots` against the
selected page template's materialized slots. It never influences template
selection.

## Dynamic insertion overlays

`adapters/request-insertion-slots.ts` currently copies `route.layouts` and
builds layout-keyed slot maps. Change it to:

1. validate each request slot against the page template assigned to its page;
2. append it to `pageSlotOverlays[page]` without mutating compiled templates;
3. add its name to the owning non-main flow route;
4. add the slot to the route's stable union; availability still follows from
   the page overlay on that selected page;
5. reject `main` ownership and collision with static/reserved slots;
6. never add a page-template assignment or fallback.

## Public and report plumbing

Migrate the same field through:

- `interfaces/mcp/render-tools.ts` request schema and description;
- `interfaces/cli/example.ts` request parsing/data-field exclusion;
- `report/renderer.ts` plan-only, detailed and PDF functions;
- `report/composition-runtime.ts` options;
- `composition/report-composition-entrypoint.ts` candidate creation;
- dry-run/full response descriptions and examples.

Do not keep two optional parameters. Each function receives
`layout?: DocumentLayoutInput`; top-level `template` remains its existing
separate template argument at the outer interface boundary.

Plans expose `pages[].templateRef` and technical `pageTemplateId`. They do not
echo the original unnormalized request.

## Implementation sequence

1. Add target types and pure normalization names alongside old internal names;
   keep behavior tests green.
2. Add public `layout` and reject requests containing both `template` and
   `layout` or the old `page_template_schedule` field.
3. Migrate MCP, CLI, renderer/runtime and entrypoint parameters.
4. Rename compiled geometry/container/range fields throughout composition.
5. Build stable route-slot unions, simplify `routeSlots()` to an intersection
   and remove `slotsByLayout`.
6. Remove `CompositionFlowRoute.layouts` and all copying/fallback code.
7. Migrate request insertion overlays.
8. Migrate fixtures from low-level `layouts` construction to
   `CompositionLayout.pageTemplates` and assignments.
9. Remove old schemas, adapter file, types, parameters, diagnostics and docs.
10. Run `rg` for every old identifier and allow occurrences only in explicit
    rejection tests and the unchanged historical item-02 document.

Steps 1–3 may temporarily contain internal aliases but the final 1.1 state has
one name/path only. No public request accepts both contracts.

## File map

| Area | Required result |
|---|---|
| `contracts/input/schema.ts` | `DocumentLayoutInput`; old field rejected |
| `contracts/model.ts` | target type/field names; no `route.layouts` |
| `adapters/document-layout.ts` | normalization and assignment lookup |
| `adapters/page-template.ts` | compile `CompositionLayout` and page templates |
| `layout/page-state.ts` | select only from assignments or sole template |
| `layout/page-state.ts::routeSlots` | intersect route slots with selected page-template slots |
| `adapters/request-insertion-slots.ts` | overlays without template selection |
| entrypoint/runtime/renderer | one `layout` parameter path |
| MCP/CLI | one public request name and migration error |

## Test matrix

| Requirement | Proof | Target test |
|---|---|---|
| exact range, relative count, count variants and remaining tail | pure normalization | union member and mixed-shape rejection cases |
| finite and remaining bounds obey configured maximum | pure normalization/compilation | below-limit, filtered-branch and no-legal-branch cases |
| gap/overlap/both-input rejection | schema/adapter | `test-input-errors.mjs` |
| failures explain evidence and remediation | returned CLI/MCP error payload | table-driven error assertions without PDF rendering |
| selected template is explicit per page | plan-only pages/slots | `test-page-template-adapter.mjs` |
| route cannot select a template | low-level negative fixture | `test-text-composition-engine.mjs` |
| template-specific slot eligibility remains | plan-only late-sidebar fixture | `test-text-composition-engine.mjs` |
| forbidden continuation still allows late first placement | plan-only fixture | existing late-first-placement test |
| dynamic insertion uses assigned template only | plan-only overlay fixture | `test-dynamic-insertion-slots.mjs` |
| MCP/CLI accept `layout`, reject old field | transport schema only, no PDF | public contract tests |
| PDF uses selected plan unchanged | one mixed-template PDF | `test-editorial-parity.mjs` |

## Completion criteria

- `rg` finds no executable-code occurrence of `page_template_schedule`,
  `PageTemplateSchedule`, `pageTemplateSchedule`, `route.layouts`,
  `CompositionLayoutTemplate`, `CompositionTemplate.layouts`, `layoutId` or
  `slotsByLayout` outside explicit rejection/migration fixtures.
- A request has exactly one authoritative template-selection path.
- Every materialized page identifies its selected `templateRef`.
- Finite layouts are not silently truncated and `remaining` cannot exceed the
  configured composition page limit.
- Every invalid layout response identifies the failing entry, relevant values
  and a concrete remediation.
- Route lookup cannot change the selected template.
- Item-02 range and continuation behavior remains green without modifying its
  historical plan document.
- Dynamic insertion overlays remain explicit and cannot host `main`.
- Plan-only, dry-run and PDF paths use the same normalized layout variant.
