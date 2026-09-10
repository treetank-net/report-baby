# Release 1.1 — document `layout` and template selection

Status: proposal; implementation has not started.

## Motivation

The current request field `page_template_schedule` expresses one document
layout: it says which reusable page templates are used for which page ranges.
The older `route.layouts` path expresses a similar decision at the wrong
level, inside one flow route. That creates two competing sources of truth and
allows a flow to carry a positional page-layout fallback that the document
itself should own.

The domain language should therefore have one singular `layout` for one
document. A template remains the reusable page-composition contract. We do
not need a new domain entity for every range entry, and we do not need the
ambiguous term `pageLayout`.

This change is motivated by four constraints:

- one document must have one authoritative page-template arrangement;
- a flow route must describe slots, priority, repetition and continuation,
  not select page templates by page index;
- a later page must be selected from the document layout before the planner
  checks whether the selected template exposes a legal slot;
- the public contract should describe the same concept that the planner and
  dry-run plan already use, without preserving an obsolete parallel path.

## Canonical vocabulary

| Term | Meaning |
|---|---|
| `template` | One reusable page-composition contract: page geometry, chrome, regions, slots, flow routes and template-owned policies. |
| `layout` | One document's declaration of how its pages are assembled from templates. |
| `layout` entry | A plain data item containing a page range and the selected template. It is not a separate domain entity. |
| `route` | The slots and flow rules through which one named flow is planned. It does not contain a page-template sequence. |
| `continuation` | The existing breakability policy for an already-started flow. It is unrelated to template selection geometry. |

`pageLayout` is not a domain term. A concrete geometry record created while a
template is compiled may have a technical implementation name, but it must
not become a second public concept.

## Proposed request shape

The simple form is an array because the current contract only needs ordered
template assignments:

```jsonc
{
  "template": "editorial-body",
  "layout": [
    {
      "pages": { "count": 1 },
      "template": "editorial-cover"
    },
    {
      "pages": { "from": 2, "to": 5 },
      "template": "editorial-body"
    },
    {
      "pages": { "from": 6, "to": 8 },
      "template": "editorial-feature"
    }
  ],
  "data": {
    "flows": {
      "main": {
        "continuation": "allowed",
        "blocks": [{ "type": "text", "text": "Long article text..." }]
      }
    }
  }
}
```

The top-level `template` remains the fallback when no `layout` is supplied.
When `layout` is present, its entries are authoritative for page-template
selection. The public entry property should be `template`; the adapter may
normalize it to the internal identifier `templateRef` where that is useful.

If future rules need more than ranges, the same domain concept may become an
object containing the template-entry array and additional rules. That is a
future contract change, not a reason to introduce `layouts` or
`pageLayout` today.

## Current implementation inventory

The current implementation already contains the correct document-level
behavior under the older name. The migration is a vocabulary and ownership
change, not a new planning algorithm.

| Current location | Current responsibility | Required change |
|---|---|---|
| `server/src/contracts/input/schema.ts` | Defines `pageTemplateScheduleEntrySchema`, `pageTemplateScheduleSchema` and `PageTemplateScheduleInput`. | Rename the public schema and type to the `layout` contract. Keep the existing inclusive `from`/`to`/`count` validation and min/max candidate semantics. |
| `server/src/composition/adapters/page-template-schedule.ts` | Normalizes ranges, derives omitted bounds and expands range candidates. | Rename the adapter vocabulary to document-layout normalization. Preserve validation, candidate expansion and open-tail behavior exactly. |
| `server/src/composition/report-composition-entrypoint.ts` | Builds one composition candidate per normalized schedule variant and evaluates candidates. | Read the normalized `layout` declaration. Do not change candidate ownership or legality rules. |
| `server/src/report/renderer.ts` | Passes the schedule through render, dry-run and plan-only entry points. | Replace schedule parameters with the document layout declaration and keep the plan/render geometry path identical. |
| `server/src/report/composition-runtime.ts` | Carries the schedule through composition options. | Rename the option and retain one shared source of page-template selection. |
| `server/src/interfaces/mcp/render-tools.ts` | Exposes `page_template_schedule` to `render_report`. | Expose `layout` with entries containing `pages` and `template`; update the description and structured request plumbing. Do not keep a second public alias unless a separate compatibility decision is made. |
| `server/src/interfaces/cli/example.ts` | Parses the CLI request and forwards the schedule. | Parse `layout` with the same schema as MCP and remove the old request path. |
| `server/src/composition/contracts/model.ts` | Defines compiled templates, routes and the transitional `CompositionFlowRoute.layouts`. | Remove `CompositionFlowRoute.layouts`. Keep `continuation`, `priority`, `repeat`, `startPage`, slots and insertion slots. Treat the compiled geometry collection as an implementation projection, not as a public `pageLayout` concept. |
| `server/src/composition/layout/page-state.ts` | Selects the page layout from `pageTemplateSchedule`, then falls back to `route.layouts` or the first compiled layout. | Select the template from the normalized document `layout`; delete the positional `route.layouts` fallback. A request without `layout` may continue to use the single top-level `template` default. |
| `server/src/composition/adapters/request-insertion-slots.ts` | Copies route layout metadata while adding request-owned insertion slots. | Stop copying `route.layouts`. Resolve insertion geometry against the selected document template and keep insertion flows as request-owned overlays. |
| `server/src/composition/adapters/page-template.ts` | Compiles one or more source templates and currently returns `pageTemplateSchedule` plus route layout maps. | Return the normalized document template selection under the new internal name and remove route-level page selection. Revisit `slotsByLayout` only after confirming whether its keys are compiled geometry IDs or source template IDs; rename it only if it is actually template selection metadata. |
| `server/scripts/test-*.mjs` | Many low-level fixtures construct `CompositionTemplate.layouts` and `route.layouts` directly. | Migrate single-template fixtures to the top-level template default. Migrate multi-template fixtures to a document `layout` declaration. Add assertions that route metadata cannot select a page template. |
| `docs/`, examples and tool descriptions | Explain the old schedule name and route fallback. | Use `layout` for the document declaration, `template` for one reusable page template, and document the intentional removal of the old path. |

## Resulting flow

```text
request.layout
  → normalize page ranges and candidate lengths
  → select one template for each materialised page
  → materialise that template's ordinary slots and chrome
  → order flows by their resolved geometry priority
  → check continuation against the next selected template and its named slots
  → produce the plan and evaluate legality/aesthetics
```

`route.layouts` must not participate in this flow. In particular, a missing
sidebar slot on the current page is not a reason to throw merely because the
route has no positional fallback. The planner searches the document layout
for a legal page/template destination according to the existing flow rules.

## Migration order

1. Add the new `layout` schema and adapter names while keeping behavior covered
   by the current schedule tests.
2. Migrate MCP and CLI request plumbing and all composition options to the new
   name.
3. Remove `CompositionFlowRoute.layouts` and the fallback in `routeLayout()`.
4. Migrate dynamic insertion adapters and low-level fixtures to document-level
   template selection.
5. Rename or remove only those `slotsByLayout` references whose keys are proven
   to represent the old route-level selection; do not change slot eligibility
   semantics as part of this task.
6. Update plan, dry-run and renderer artifacts so they expose the selected
   template for each page and no route-owned layout sequence.
7. Run the schedule normalization, late-first-placement, continuation,
   dynamic-insertion and legacy-field rejection tests, then run the normal
   build and release checks.

## Acceptance criteria

- One request has one document `layout` declaration or one fallback template;
  there is no route-level page-template sequence.
- `layout` entries select reusable `template` names for inclusive page ranges.
- Existing range variants, open tails, first legal placement and continuation
  behavior are unchanged.
- A route cannot make an otherwise unavailable template appear by supplying a
  positional `layouts` array.
- Dynamic insertion flows still use ordinary slots from the selected template,
  remain overlays, and cannot place `main` content into insertion slots.
- Plans and dry-run diagnostics identify the selected template by page without
  exposing `pageLayout` as a public concept.
- `continuation` and the YAML default geometry priority (`100`) remain
  unchanged; explicit paint order is outside this task.

## Out of scope

- redefining `continuation`;
- restoring `continuation_slots` or `continuation_frame`;
- changing geometry priority or introducing explicit paint order;
- adding a global solver or new implicit insertion slots;
- changing the semantics of ordinary slot eligibility.
