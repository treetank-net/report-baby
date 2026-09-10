# Release 1.1 — page-template schedule without `continuation_*`

Status: implemented and verified.

> Completion annotation (2026-09-10): the Release 1.1 migration described in
> this document is complete. The original plan is intentionally retained
> below as historical evidence; the summary records what was implemented and
> which cleanup questions remain.

## Implementation summary

- `continuation` is retained as the flow/template annotation that says
  whether an already-started flow may be split across a page boundary. It is
  not being removed.
- Only the special geometry mechanisms `continuation_slots` and
  `continuation_frame` were removed from the contract. Ordinary slots from the
  page template selected for each page are the continuation targets.
- `page_template_schedule` is normalized from explicit or derived
  `from`/`to`/`count` bounds, including finite `min..max` variants and an open
  final entry. Each variant is planned and evaluated independently, and only
  legal variants compete for selection.
- The planner searches for a first legal placement on later scheduled pages
  even when `continuation` is `forbidden`; that rule is enforced only after a
  flow has actually placed content.
- Dynamic insertion flows are request-owned overlays. Their geometry is
  checked against the selected page layout and they cannot be used to place
  `main` content. When no explicit route priority exists, planner ordering
  uses `composition_priority.default` from YAML (`100`); this is an implicit
  geometry priority, not paint order.
- The required verification is plan-level: schedule normalization, page
  template selection, first legal placement, continuation behavior, overlays,
  and legacy-field rejection are covered by composition tests. Separate
  MCP/CLI end-to-end coverage is not required for this contract.

### Remaining cleanup questions

1. `route.layouts` is a legacy low-level per-route layout sequence used by
   unscheduled composition fixtures and fallback paths. A page schedule takes
   precedence whenever it exists. Removing `route.layouts` requires migrating
   those low-level callers and tests; it is not part of the completed schedule
   migration.
2. Newly-created request routes currently receive the implicit default during
   planner ordering, but their route object may omit an explicit `priority`.
   If plan consumers must see the resolved `100`, normalize it into the route
   or slot projection in a follow-up without changing ordering.
3. The public request still exposes `continuation` for flow data and dynamic
   insertion flows. This is intentional in the current contract: it is the
   breakability annotation, not continuation geometry. Removing or relocating
   that annotation would be a separate contract decision.

The migration is complete: page schedules now select ordinary page templates,
legacy `continuation_slots`/`continuation_frame` fields are rejected, and the
planner, evaluator, dry-run plan, renderer, and spacing report use the same
per-page template reference. Verification includes the composition and quality
suites, the dynamic insertion and late-first-placement fixtures, and the brand
showcase render.

## Decision

Remove both `continuation_slots` and `continuation_frame` from the target
model. The next page is not a special case of the same slot. It has a template
selected by the page schedule, and slots in that template keep their ordinary,
named identifiers.

Example document schedule:

```text
page 1       -> template X
pages 2..5   -> template Y
pages 6..8   -> template Z
```

If flow `main` has a `content` slot in templates Y and Z, it can continue in
`content` on pages 2–8. There is no separate continuation slot or second frame
for that slot.

## Declaration in the input request

The current `CompositionInput` remains content-only. The schedule is a
`render_report` request declaration next to the existing `template`/
`template_ref`, not part of flow blocks. The proposed extension is:

```jsonc
{
  "template": "pages/editorial-body",
  "page_template_schedule": [ // entries are evaluated in this order
    { "pages": {"count": 1}, "template_ref": "pages/editorial-cover" }, // pages 1..1
    { "pages": {"from": 2, "to": 5}, "template_ref": "pages/editorial-body" }, // pages 2..5
    { "pages": {"count": 3, "from": 6, "to": 8}, "template_ref": "pages/editorial-sidebar" }, // pages 6..8
    { "pages": {"from": 9}, "template_ref": "pages/editorial-body" } // open tail from page 9
  ],
  "data": {
    "flows": {
      "intro": {
        "continuation": "forbidden",
        "blocks": [
          { "type": "text", "text": "Article introduction..." }
        ]
      },
      "main": {
        "continuation": "allowed",
        "blocks": [
          { "type": "heading", "text": "Main section" },
          { "type": "text", "text": "Long article text..." }
        ]
      }
    }
  }
}
```

Entries are supplied in generation order. `from`, `to`, and `count` may be
explicit or derived from previous entries: `count` follows from `from` and
`to`, `to` may follow from `from` and `count`, and an omitted `from` starts
after the previous range. The last entry may contain only `from`; it is then an
open schedule tail that applies until the document ends or the page limit is
reached. Supplied values must agree. Entries must not overlap or create
unintended gaps.

### `pages` and `count` semantics

`pages` describes one schedule entry, not a ready-made list of plan pages.
`from` and `to` are absolute, inclusive page numbers. `count` has two forms:

| Form | Meaning |
|---|---|
| `count: 3` | exactly three pages for this template |
| `count: { min: 2, max: 5 }` | length range; every variant is a separate candidate |

Until the contract is extended, allow these combinations:

| Input | Derivation |
|---|---|
| `{ from, to }` | `count = to - from + 1` |
| `{ from, count: N }` | `to = from + N - 1` |
| `{ count: N }` | `from` is the first page (1 for the first entry, otherwise previous `to + 1`), then derive `to` |
| `{ from }` | open final entry; `to` follows from document end or page limit |
| `{ from, count: { min, max } }` | fixed `from`; derive `to` separately for every length variant |

`to` without `from` or `count` is ambiguous and must be rejected. `count` must
be a positive integer; a range must satisfy `1 <= min <= max`. When all three
of `from`, `to`, and `count` are supplied, the normaliser checks consistency.

Example flexible entry:

```jsonc
{
  "pages": { "from": 2, "count": { "min": 2, "max": 5 } },
  "template_ref": "pages/editorial-body"
}
```

Its variants occupy pages 2–3, 2–4, 2–5, 2–6, or 2–7. If another entry
follows, its derived start depends on the selected variant, so validation and
planning run separately for every candidate.

### How the planner uses these values

The normalised schedule is not a flow placement. It describes available page
templates, and the planner uses it in this order:

1. The input produces one exact schedule or several candidate schedules. Each
   candidate has its own expansion of `from`, `to`, and `count`, plus a page
   limit derived from its entries.
2. For a candidate, the planner materialises pages only when a flow needs to
   search them. The schedule resolves the page number; it does not place a
   flow by itself.
3. Flows are considered in descending `priority` order. Each flow checks the
   candidate's pages and chooses the first legal slot matching its route, role,
   and block type.
4. `from` limits the earliest page of an entry, `to` the latest, and `count`
   the number of pages occupied by its template. These are not placement
   requests for a specific flow.
5. If a flow has no placement yet, a missing slot on the current page does not
   trigger `continuation: forbidden`; the planner keeps searching this
   candidate. `continuation` applies only after the first placement.
6. An explicit request-owned slot is available only on pages where the request
   declares it. It may be the first legal slot or a later continuation slot,
   but the planner does not create it.
7. After a pass, the evaluator first rejects illegal candidates (missing slot,
   range exceeded, forbidden continuation, collisions), then compares scores
   only among legal candidates.
8. The final plan records the selected schedule variant, the actual page of
   each placement, and the template/layout used on that page. It does not store
   an unresolved `min..max` range as the result.

An open final entry is a run-dependent upper bound: the planner may materialise
its template on subsequent pages while flows have content to place and the page
limit has not been reached. This does not create a new template or automatically
continue a flow with `continuation: forbidden`.

When `min..max` creates variants, every position-dependent value — including
the next entry's start, slot availability, and page-qualified IDs — is
recalculated for each variant. A candidate with more pages does not win by
default; it wins only when legal and better under the existing evaluator.

Entries are ordered and contiguous by default: the first starts at page 1, and
each next entry starts at the previous `to + 1`. An explicit `from` that creates
a gap or overlap is a schedule error. An open entry may occur only last because
the next entry could not otherwise have an unambiguous start.

An example such as `count: { "min": 2, "max": 5 }` does not describe one plan.
The planner may consider legal variants from two to five pages, and the
evaluator chooses the best accepted result. Without `page_template_schedule`,
the existing `template` field keeps its current meaning and applies to all
pages. When a schedule exists, `template` is only a default value or
first-variant identifier and cannot override ranged entries.

`pages/editorial-body` is deliberately the default here: a cover may not expose
the `main` flow and is therefore not a sensible template for ordinary
continuation. Template groups such as cover/body/final page remain outside this
task.

This is a new input contract; the current parser does not accept it yet. Do not
add coordinates, page numbers, or `continuation_*` names to `data.flows`.

## Three independent decisions

| Concept | Owner | Meaning |
|---|---|---|
| `continuation` | flow/template rules | whether a flow instance may cross a page boundary |
| template schedule | document declaration | which template applies to a page or page range |
| slot | selected template | whether a legal target exists on that page and its geometry |

Continuation is legal when flow rules do not forbid it and the selected page
template exposes the same named slot. A missing slot in the current template
does not end the search for a first placement. The planner may inspect later
schedule pages and their ordinary template slots or explicit request-owned
slots from `placement_requests`. It must not create a slot by falling back to
the previous page's geometry.

## Current code state

The current parser and adapter still support both historical fields:

- `continuation_slots` is stored in the route and used to build the slot list
  for continuation geometry;
- `continuation_frame` is stored on the slot and selected by the adapter via
  `slotFrame(source, true)`;
- `route.layouts` and `slotsByLayout` exist in parallel and partly describe a
  layout schedule.

These are three overlapping mechanisms describing one decision. During
migration they must not be treated as equal sources of truth. The target source
is the page-template schedule plus ordinary slots of the selected template.

## Target flow

```text
select the template for the page number
  -> materialise its ordinary slots and chrome
  -> measure fit-content header/footer
  -> update the capacity of that template's slots
  -> place insertion flows and other required flows
  -> place main in slots that exist on this page
  -> evaluate legality and reject the plan when necessary
```

Template Y may give `content` different geometry from template X, and template
Z may differ again. This difference belongs to each template's `content`
definition, not to a field called “continuation frame”. Dynamic chrome changes
the selected slot's actual capacity before placement, but not its identifier.

## First legal location versus `continuation: forbidden`

`continuation` describes whether a flow may move to the next page after it has
started. It must not block the search for the first legal slot.

The current code mixes these cases in `resolveUnavailableFlowSlot()`:

- when the current page has no matching slot and the route has
  `continuation: allowed`, it advances the page cursor and keeps searching;
- when the route has `continuation: forbidden`, it immediately records
  `FLOW_SLOT_NOT_FOUND`, a residual, and ends the flow;
- when a slot exists but has no capacity, other paths advance the cursor and
  `flowReachedTerminalPage()` rejects the next-page transition for
  `continuation: forbidden`.

As a result, current `continuation: forbidden` can reject a flow that has not
been placed anywhere yet. That is not the target semantics.

```text
flow has no placement yet
  -> inspect later pages and their legal slots
  -> the first matching slot determines the flow's start page

flow already has a placement
  -> moving to another slot on the same page is possible
  -> moving to the next page requires continuation: allowed
  -> with continuation: forbidden, record a residual and reject continuation
```

If the planner scans the entire available schedule without finding a legal slot
for the first placement, it ends the flow as unplaceable. It must not report an
error on the first page merely because that page lacks the required slot.

This requires detecting whether the flow already has an actual placement in the
plan. Page number and `lastLegalSlotId` alone are insufficient: the cursor may
change pages before the first placement, and `lastLegalSlotId` is currently set
on some paths without recording content.

Priority operates above this search. A `title` flow with `priority: 500` is
considered before lower-priority flows and searches for the first legal slot
from the beginning of the available schedule. Priority does not pin it to page
1; page 1 is the result only if its template exposes a legal slot and placement
succeeds.

## Slots supplied explicitly by the request

The current system can add a slot to one render even when the selected template
does not define it statically. `placement_requests` provides this capability:

- `insertions` adds space for one block on an explicitly selected page;
- `insertion_flows` adds one or more ordinary slots for an existing, non-main
  flow;
- `start_page` and `repeat: each-page` specify on which pages the overlay is
  materialised;
- the adapter derives the physical box from the frame and checks bounds,
  collisions, roles, block types, capacity, and `pushes` relations;
- the overlay is per-render and does not modify YAML or a shared template.

In a multi-template schedule, such a slot may legally appear on a later page,
but only when the user explicitly declared it in the request. The planner may
find it while searching for a first placement or continuation, but must not
create it to rescue an illegal plan.

```text
no slot in the current template
  -> check the explicit overlay for this page
  -> if the overlay exists and passes validation, it is an ordinary flow slot
  -> if no overlay exists, search the next schedule page
```

This is not a `continuation_slot` or `continuation_frame`. It is an ordinary
slot of an ordinary route, supplied temporarily by the request. `main` remains
excluded from this path; the current adapter rejects a request-owned insertion
flow with ID `main`.

With candidate schedules, overlays must be applied against the template chosen
for the specific page of each candidate. The current adapter computes geometry
against one `CompositionTemplate` and `maxPages`, so it does not yet support
multiple compiled-template variants in one pass.

The transition state has two important differences from the target contract:

- the request schema still has `insertion_flows[*].continuation`, and the
  adapter may currently override `route.continuation` with it; in the target,
  the template route rule is also the source of truth for a request-owned slot;
- the request does not carry its own `priority`. A dynamic flow therefore uses
  the existing route's priority, while a new route created by the adapter has
  no explicit priority today. The `priority: 200` in the example assumes an
  existing `sidebar` route; it is not a property of the frame itself.

## Example resulting plan

For the request above, the plan must preserve the geometry origin of every
page. The current `CompositionPagePlan` exposes `layoutId`; the target plan
must also show `templateRef` or an equivalent reference:

```jsonc
{
  "pages": [
    { "page": 1, "templateRef": "pages/editorial-cover", "layoutId": "pages/editorial-cover", "slots": ["header", "content"] },
    { "page": 2, "templateRef": "pages/editorial-body", "layoutId": "pages/editorial-body", "slots": ["header", "content"] },
    // pages 3–4 use the same body template
    { "page": 5, "templateRef": "pages/editorial-body", "layoutId": "pages/editorial-body", "slots": ["header", "content"] },
    { "page": 6, "templateRef": "pages/editorial-sidebar", "layoutId": "pages/editorial-sidebar", "slots": ["header", "content", "sidebar"] }
  ],
  "placements": [
    // remaining main placements
    { "flowId": "main", "page": 2, "slotId": "content" },
    // pages 3–5 use the same content slot
    { "flowId": "main", "page": 6, "slotId": "content" }
  ],
  "evaluation": { "status": "accepted" }
}
```

`slots` in this example are logical template names; the actual plan may still
use page-qualified placement IDs. The important point is that page 6 has no
`continuationSlotId` or `continuationFrame`: it has ordinary `content` from
template Z.

## Example: title on page 1, sidebar on page 6, and `main` on pages 2–8

This example separates three decisions that are easy to confuse:

1. the schedule selects the page template;
2. route rules and slot availability constrain a flow to legal pages;
3. `priority` determines geometry-reservation order, but does not select a page
   number and is not paint order.

Assume this schedule:

```text
page 1       -> pages/editorial-title
pages 2..5   -> pages/editorial-body
page 6       -> pages/editorial-sidebar
pages 7..8   -> pages/editorial-body
```

Templates declare ordinary slots and priorities for their flows. This shortened
YAML declaration omits slot geometry:

```yaml
# pages/editorial-title/template.yml
flows:
  title:
    slots: [title]
    start_page: 1
    continuation: forbidden
    priority: 500

# pages/editorial-body/template.yml
flows:
  main:
    slots: [content]
    start_page: 2
    continuation: allowed
    priority: 100

# pages/editorial-sidebar/template.yml
flows:
  sidebar:
    slots: [sidebar]
    start_page: 6
    continuation: forbidden
    priority: 200
  main:
    slots: [content]
    start_page: 2
    continuation: allowed
    priority: 100
```

`priority: 500/200/100` illustrates the relationship: reserve the title first,
then the sidebar, and finally `main`. When a template omits a route value, the
default comes from YAML (`composition_priority.default`, currently 100). A
higher number means earlier geometry resolution; it does not mean renderer
paint order.

The proposed request schedule (not yet part of the current `CompositionInput`)
may look like this:

```jsonc
{
  "template": "pages/editorial-title",
  "page_template_schedule": [ // mirrors the schedule above
    { "from_page": 1, "to_page": 1, "template_ref": "pages/editorial-title" },
    { "from_page": 2, "to_page": 5, "template_ref": "pages/editorial-body" },
    { "from_page": 6, "to_page": 6, "template_ref": "pages/editorial-sidebar" },
    { "from_page": 7, "to_page": 8, "template_ref": "pages/editorial-body" }
  ],
  "data": {
    "flows": {
      "title": {
        "blocks": [
          { "type": "heading", "text": "Quarterly report" }
        ]
      },
      "sidebar": {
        "blocks": [
          { "type": "text", "text": "Key facts and context for the reader." }
        ]
      },
      "main": {
        "blocks": [
          { "type": "heading", "text": "Main analysis" },
          { "type": "text", "text": "Long article text that may continue across pages 2–8." }
        ]
      }
    }
  }
}
```

There is no additional field that pins a flow to a page. `sidebar` has
`start_page: 6`, and the `sidebar` slot exists only in the template used on page
6. The planner can skip pages 1–5 while searching for a first placement and put
the sidebar on page 6. If blocks remain after that placement,
`continuation: forbidden` prohibits moving to page 7. If the sidebar cannot be
placed on page 6, the plan is rejected; it is not silently moved to page 7.

### Planning order

The planner performs these logical steps:

1. Validate schedule ranges, template presence, and that
   `pages/editorial-title` has a `title` slot, `pages/editorial-sidebar` has
   `sidebar` and `content`, and `pages/editorial-body` has no `sidebar` slot.
2. Materialise pages and slots on demand, selecting a template by page number
   from the schedule. Dynamic chrome on each page reduces its ordinary-slot
   geometry before flow placement.
3. Sort candidates by priority: `title` (500), `sidebar` (200), `main` (100).
   This ordering is for geometry reservation.
4. Consider `title` first and search for the first legal `title` slot from the
   beginning of the available schedule. If page 1 exposes it and placement
   succeeds, the title lands on page 1; the page number does not follow from
   priority alone.
5. Place `sidebar` in the ordinary `sidebar` slot on page 6 (its first legal
   slot). If its dynamic height shrinks or moves `content`, that change is
   known before planning `main` on page 6.
6. Place `main` sequentially in ordinary `content`, starting on page 2 and
   moving through pages 3–8. On page 6, `main` uses the remaining `content`; it
   never enters the `sidebar` slot.
7. The evaluator checks page ranges, non-overlap, and route/template rules
   together. Only this plan may receive `accepted` status.

Planning the sidebar before `main` does not mean the sidebar wins over the
title on page 1 or changes paint order. A flow is constrained to pages and
slots from the schedule and template declaration; priority only decides which
legal element reserves geometry first on the same page.

### Short resulting plan

The plan must preserve the template reference and evidence that page rules were
met:

```jsonc
{
  "pages": [
    { "page": 1, "templateRef": "pages/editorial-title", "slots": ["title"] },
    { "page": 2, "templateRef": "pages/editorial-body", "slots": ["content"] },
    // pages 3–4
    { "page": 5, "templateRef": "pages/editorial-body", "slots": ["content"] },
    { "page": 6, "templateRef": "pages/editorial-sidebar", "slots": ["sidebar", "content"] },
    // remaining main placements
    { "page": 8, "templateRef": "pages/editorial-body", "slots": ["content"] }
  ],
  "placements": [
    { "flowId": "title", "page": 1, "slotId": "title", "priority": 500 },
    { "flowId": "sidebar", "page": 6, "slotId": "sidebar", "priority": 200 },
    { "flowId": "main", "page": 2, "slotId": "content", "priority": 100 },
    // main placements on pages 3–5 and 7 are omitted
    { "flowId": "main", "page": 6, "slotId": "content", "priority": 100 },
    { "flowId": "main", "page": 8, "slotId": "content", "priority": 100 }
  ],
  "evaluation": {
    "status": "accepted"
  }
}
```

Not every flow needs a placement on every page. `main` may end earlier but
cannot leave range 2–8; the sidebar is placed on page 6 because the schedule
exposes its slot only there.

### When the plan is illegal

- No `title` slot in any template visited during the search rejects the plan;
  the title cannot fall back to `content`.
- No `sidebar` slot in the page-6 template rejects the plan; a similar slot from
  page 5 cannot be used and the sidebar cannot move to page 7.
- If dynamic chrome or the sidebar leaves too little space for legal `main`
  placement in range 2–8, reject the plan for violating the hard range rather
  than storing hidden continuation in another frame.
- If `main` has `continuation: forbidden`, it cannot move from page 2 to page 3
  after page 2 is complete, regardless of priority or available slots.

Thus “title on the title page”, “sidebar on page 6”, and “`main` on pages 2–8”
come from the page schedule, slot declarations, and flow rules rather than an
accidental call order. `priority` helps resolve geometry within those rules and
cannot weaken them.

If template Z does not contain `content`, the result must not use template Y's
geometry:

```json
{
  "evaluation": { "status": "rejected" },
  "diagnostics": [
    {
      "code": "PAGE_TEMPLATE_SLOT_NOT_FOUND",
      "flowId": "main",
      "page": 6,
      "slotId": "content",
      "templateRef": "pages/editorial-sidebar"
    }
  ]
}
```

## What we remove

1. `continuation_slots` from the public flow model and YAML.
2. `continuation_frame` from slot definitions and the compilation contract.
3. Logic that merges continuation slots with first-page slots.
4. The fallback that continues using the previous template's geometry when the
   current template lacks a slot.

Removal changes the template contract; it is not a mechanical alias. Before
migration, prove that every supported template has an explicit slot for every
flow that may appear on it.

## Where to manage the change

| Responsibility | Target location | Change from current code |
|---|---|---|
| page-range validation | `render_report` input contract / request adapter | add `page_template_schedule`; reject gaps, overlaps, and unknown templates |
| `from`/`to`/`count` normalisation | schedule adapter | derive missing bounds, check supplied values, and support an open final entry |
| page-count variants | candidate generator + evaluator | create legal `min..max` schedule variants and choose the best accepted plan |
| template resolution for a page number | schedule resolver during page materialisation | replace the assumption of one `CompiledTemplate` for the whole document |
| geometry compilation | template adapter | provide ordinary slots and layout for the selected template |
| page state | `page-state` / `ensurePage` | select a template by page number, not `route.layouts[page - 1]` |
| flow routing | route + ordinary slots of the selected template | remove `continuationSlots`, `continuationSourceIds`, and special continuation branches |
| first legal flow location | `flow-planner` | search subsequent pages for the first matching slot regardless of `continuation` |
| started-flow continuation control | `flow-planner` + plan artifacts | apply `continuation: forbidden` only after an actual placement |
| slot geometry | slot adapter | remove the `continuation` parameter and `slotFrame(source, true)` |
| request-owned slots | `request-insertion-slots` | apply explicit overlays to selected pages/candidates; do not create implicit fallback slots |
| insertion/graphic candidates | `insertion-planning`, `graphic-planning` | ask the scheduler for a page template; do not inherit prior-page slots |
| plan result | `CompositionPagePlan` and diagnostics | retain `templateRef`/layout for every page and the rejection reason |
| renderer | report renderer | draw plan-provided geometry without `layoutId.endsWith(':continuation')` |

The key `ensurePage` change is that there is no special “continuation page”.
There is only `ensurePage(6)`, which obtains template Z from the schedule and
creates its ordinary slots. The flow planner need not know whether page 6 was
created because the previous page was full.

## Target change locations and module contracts

The list below describes implementation scope. It is not a code change or a
list of individual edits; it identifies which module should own each
responsibility and what result it passes onward.

### 1. Schedule input and normalisation

Input files:

- `server/src/interfaces/mcp/render-tools.ts` — accept optional
  `page_template_schedule` next to `template`/`template_ref` and pass it to
  planning;
- `server/src/interfaces/cli/example.ts` — pass the same structure through the
  CLI without copying MCP logic;
- `server/src/contracts/input/schema.ts` — define the strict `pages` entry
  shape and types for explicit and derived bounds.

A new schedule adapter (under `server/src/composition/adapters/`) should:

1. iterate entries in the user-provided order;
2. fill missing `from`, `to`, or `count` from previous entries;
3. check consistency when more than one bound is supplied;
4. recognise the open final entry without inventing an end;
5. return normalised constraints rather than one fixed page list;
6. prepare candidate-generator variants for a `min..max` page range.

The adapter must not choose a flow or slot. Its result answers only which
template may apply to a page number and which schedule variants may be
considered.

### 2. Template resolution and page materialisation

The target owner of template selection by page number is
`server/src/composition/layout/page-state.ts` together with the schedule
adapter:

- `routeLayout()` must not use positional `route.layouts[page - 1]` as the
  source of truth;
- `ensurePage()` obtains the template/layout for a page number and only then
  creates `PageState`;
- `newPage()` materialises ordinary slots of the selected layout;
- `routeSlots()` returns only slots present in that page's effective layout;
- `pageSlotOverlays` are applied to the layout selected for that page number,
  not to one global layout.

`CompositionTemplate` may remain an internal container for one pass, but it must
resolve geometry per page. The planner must not create synthetic `:first` and
`:continuation` layouts.

### 3. Template adapter and removal of special continuation

In `server/src/composition/adapters/page-template.ts`:

- stop building separate `first`/`continuation` layouts;
- remove passing `continuationSlots`, `continuationSourceIds`, and alternate
  frames;
- map ordinary slots of each template to the common flow route;
- retain `continuation` as a route property, but not as an input to next-page
  geometry selection.

In `server/src/composition/adapters/page-template-slots.ts`, remove the
`continuation` parameter from `slotFrame()` and `slotGrowth()`. Slot size comes
from the layout selected for the page; dynamic chrome height is measured before
available capacity is calculated.

### 4. Document planning and priorities

`server/src/composition/layout/document-layout.ts` remains the coordinator,
but its responsibility should be limited to flow order and delegation:

- `planDocumentFlows()` sorts flows by descending `priority`;
- it does not assign a page number from priority alone;
- it passes the page schedule and current page state to `planFlow()`;
- `title: 500` is considered before `sidebar: 200` and `main: 100`, but the
  first legal placement may be on any later page;
- page-count ranges are handled by separate candidates, not extra logic in one
  flow.

`server/src/composition/layout/flow-planner.ts` finds a slot for the current flow
but does not select templates. `ensureCurrentFlowPage()` asks page state for
the next page, `resolveFlowTarget()` chooses an ordinary slot, and the
placement result records the page and slot reference.

### 5. First placement and `continuation: forbidden`

In `flow-planner.ts`, change primarily:

- `resolveUnavailableFlowSlot()` — a missing current-page slot continues the
  search when the flow has no actual placement;
- `flowReachedTerminalPage()` — `continuation: forbidden` applies to an
  attempted page transition after the flow has started;
- `planFlow()` — retain the loop that searches later schedule pages for the
  first legal slot;
- `FlowRuntime` or plan queries — detect whether the flow already has a stored
  placement. `cursor.page` and `lastLegalSlotId` are insufficient.

In `server/src/composition/layout/flow-text-decision.ts`, apply the same rule
in `advanceTextBlockWhenNoCapacity()` and other cursor-advancing functions.
Moving to another slot on the same page remains legal; moving to the next page
requires a started flow and `continuation: allowed`.

### 6. Explicit dynamic slots

`server/src/composition/adapters/request-insertion-slots.ts` remains the owner of
request-owned slots:

- `insertions` materialise one slot for one block and page;
- `insertion_flows` materialise slots for explicitly selected pages or a
  `repeat: each-page` pool;
- `physicalSlot()` calculates the box against the page's layout;
- `validateStaticOverlaps()` and frame validators remain mandatory;
- `main` still cannot receive a request-owned insertion slot.

With multiple templates, the adapter must run after the template is resolved
for a candidate and page. A dynamic slot may fill a missing static slot only
because the user explicitly supplied it in `placement_requests`. Do not create
it in `resolveFlowTarget()` or `ensurePage()` as a rescue fallback.

`addRouteSlots()` must not advertise a dynamic ID in every layout when an
overlay exists only on selected pages. Dynamic-slot availability must be
checked against the page's actual layout.

### 7. Candidate variants and evaluation

In `server/src/composition/layout/planner-candidates.ts` and `text-planner.ts`,
add the schedule to candidate-generation input:

1. the normaliser returns one variant for explicit ranges and several for
   `min..max`;
2. each variant receives its own `planDocumentOnce()` pass;
3. request-owned overlays are applied separately to each variant;
4. the evaluator rejects illegal plans and compares scores only among legal
   candidates;
5. existing refinements may improve insertion and graphic placement, but must
   not change the schedule unless the input explicitly permits the page range.

Do not build a global solver immediately. The first version may consider a finite
list of legal variants while preserving the existing deterministic tie-break.

### 8. Plan, evaluator, and renderer contracts

The planning result must retain the template/layout selected for every page:

- `server/src/composition/contracts/engine-contracts.ts` — extend
  `CompositionPagePlan` with `templateRef` or equivalent geometry provenance;
- `server/src/contracts/resolved-report-plan.ts` — expose that information in
  the public report plan;
- `server/src/composition/evaluation/legality.ts` — check slots against the
  page's layout and reject synthetic fallback;
- `server/src/report/renderer.ts` and `server/src/report/composition-runtime.ts`
  — use plan references instead of recognising
  `layoutId.endsWith(':continuation')`;
- `server/src/composition/report-composition-entrypoint.ts` — pass the schedule
  and template variant to the planner rather than assuming one `CompiledTemplate`
  for the entire document.

The renderer must not search for slots or move flows. It draws the geometry
accepted in the plan.

## Implementation order

1. Add the schedule contract and normalisation without changing the old path,
   with tests for explicit, derived, open, and `min..max` forms.
2. Add a per-page template resolver to page state and record the selected
   template in the page plan.
3. Apply request-owned overlays to the resolved page layout and add a test in
   which a dynamic slot exists only on page 6.
4. Change first-legal-slot search in the flow planner.
5. Enforce `continuation: forbidden` only after an actual placement.
6. Remove `continuation_slots`, `continuation_frame`, synthetic layouts, and
   fallback to previous-template geometry.
7. Integrate schedule variants into existing candidate generation and scoring.
8. Update the evaluator, `dry_run`, renderer, CLI/MCP, and public tests.
9. Finally remove transitional request fields that duplicate route rules and
   close the documentation and fixtures.

Every stage must preserve behaviour for requests without
`page_template_schedule` and `placement_requests`. The change should expand
the number of legal variants, not change the existing plan for old input.

## Tests required to close the change

Tests should remain plan-level and renderer-neutral wherever PDF appearance is
not under test:

- `server/scripts/test-page-template-adapter.mjs` — `from`/`to`/`count`
  normalisation, open final entry, `min..max` ranges, and template selection by
  page number;
- `server/scripts/test-text-composition-engine.mjs` — a flow with no slot on
  the first pages, the first later legal slot, and the difference between no
  first placement and forbidden continuation;
- `server/scripts/test-dynamic-insertion-slots.mjs` — a request-owned slot
  materialised only on a selected page, an `each-page` pool, rejection for
  `main`, and overlay validation;
- `server/scripts/test-editorial-plan-contract.mjs` and
  `server/scripts/test-composition-engine-contract.mjs` — `templateRef`,
  ordinary slots, and diagnostics for a missing legal target;
- `server/scripts/test-public-mcp-contract.mjs`, `test-cli.mjs`, and
  `test-mcp-schema-snapshot.mjs` — the new request on both public inputs;
- one renderer/chrome test — the renderer uses the template recorded in the
  plan without recognising a `:continuation` suffix.

The minimum regression set should include:

1. high-priority `title` has no slot on page 1, finds the first legal slot on
   page 3, and is not rejected before that search;
2. `sidebar` has a static slot only on page 6, is considered before `main`, and
   remaining sidebar content does not move to page 7 with
   `continuation: forbidden`;
3. `sidebar` has no static slot, but the user supplies an overlay on page 6 —
   the plan is legal and rejected without the overlay;
4. the same request with a 2–5 page range creates several candidates, while
   the evaluator rejects illegal ones and compares legal ones only;
5. a request without a schedule or overlay preserves the existing plan.

## Edge cases

- `main` ends on page 5 if template Z has no `content`, even when template Y
  had it;
- high-priority `title` may skip several pages without a `title` slot and be
  placed on the first later legal slot;
- no first legal slot is not yet a `continuation: forbidden` violation; the
  violation appears only after a placement and an attempted next-page move;
- a request-owned slot can expose space absent from YAML, but only on pages
  explicitly selected by the request;
- a flow with `continuation: forbidden` does not move further even when the next
  template has a matching slot;
- a template may change geometry while retaining the `content` name; continuation
  is legal and uses the new template geometry;
- two slots with similar geometry are not the same slot; name and contract
  compatibility must be explicit;
- if dynamic header/footer consumes all available space, the plan is illegal
  instead of creating a hidden continuation frame;
- when the final schedule entry has no end, the same template may be selected
  for later materialised pages only for flows with a legal slot there and
  permission to continue.

## Acceptance criteria

- the document schedule selects a template for one page or a range;
- `from`, `to`, and `count` may be explicit or derived, and an open final entry
  ends with the document or page limit;
- `to` without `from` or `count` is rejected as ambiguous, and simultaneous
  bounds must describe the same page count;
- a page-count range creates candidates and the evaluator chooses the best legal
  variant;
- pages in the same range use the same layout and slot names;
- the first legal flow location is searched across subsequent pages regardless
  of `continuation`;
- after it starts, a flow can continue only into a slot in the selected
  template or explicitly added by `placement_requests`;
- `continuation: forbidden` blocks only a started flow's move to the next page;
- different page geometry comes only from selected templates;
- dynamic chrome is included before slot capacity is calculated;
- no legal template/slot ends with a diagnostic rejection;
- the planner does not create an implicit fallback slot;
- the contract contains neither `continuation_slots` nor `continuation_frame`;
- the plan, evaluator, `dry_run`, and renderer point to the same template and
  slot.

## Out of scope

- switching templates using renderer heuristics;
- implicit slot creation by the planner or fallback when no legal target exists;
  explicit request-owned slots from `placement_requests` remain supported;
- changing `continuation` rules in content input;
- a global solver placing every document element;
- changing explicit paint order, described in
  [01-paint-order-contract.md](01-paint-order-contract.md).
