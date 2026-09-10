# Report Baby domain glossary

This glossary describes the document-composition domain without prescribing a
renderer or file format.

## Document

A document is the complete authored publication: metadata, named content
flows, semantic assets and author preferences.

## Flow

A flow is an ordered stream of content that may continue through compatible
regions on subsequent page layouts. Typical flows are `main`, `intro`,
`sidebar`, and `quote`, but names are defined by the template contract. When a
template declares an `intro` flow, introductory content belongs to that flow;
it is not a leading block of `main`.

## Continuation policy (template-owned)

A continuation policy describes whether one instance of a flow may cross from
its current page arrangement to a later page. `forbidden` ends that instance
when its current page route is exhausted; it does not forbid moving between
slots on that same page, creating another page for a different flow, or
creating a repeated instance of the same flow. The physical destination for a
continuation is selected by the document's page-template schedule. The policy
is declared by the template because the same named flow can be page-local in
one template and multi-page in another. The schedule and a compatible slot
must still provide the destination; the policy alone never creates one.

## Generated page metadata

Generated page metadata are values supplied by the composition plan for the
current page, such as its number and the final number of accepted pages. They
are variables inside a text block, not separate content blocks or placements.
A footer such as “2 / 5” is therefore one text block whose template text uses
two generated values.

## Content block

A content block is one semantic unit in a flow. A block may be ordinary text,
an image, or structured content such as metrics, a chart or a table. The block
kind describes the meaning and data of the content; it does not prescribe the
visual shape used by a template.

## Structured block

A structured block contains an internal collection or data model but remains
one unit in the containing flow. A metrics block contains metric items, a
table contains columns and rows, and a chart contains its series or data
points. The template decides whether that unit is shown as cards, a grid, a
list, a table or another visual composition. A structured block may be
fragmentable when its semantics allow it, such as a table continuing at a row
boundary.

## Metrics block

A metrics block is an ordered collection of metric items. Its default visual
representation may be a grid of metric cards, but cards are a rendering of
the collection rather than separate flow blocks. A single metric can be
represented as a one-item metrics block when needed.

## Template

A template is a reusable page-composition contract. It defines page layouts,
named regions, accepted flows, continuation routes, defaults and overflow
policies. A template decides where content may go; authored content does not
normally contain coordinates.

## Layout

A layout is one concrete page arrangement supplied by the template selected for
one page. Different pages of the same document may use different templates and
therefore different layouts.

Pages in the same scheduled range reuse the same layout and slot names. A
change of page template is a page-schedule decision, not a continuation-specific
slot or frame.

## Page-template schedule

The page-template schedule maps page numbers or page ranges to template
identifiers. For example, page 1 may use template X, pages 2–5 template Y,
and pages 6–8 template Z. The selected template supplies the layout, chrome,
regions and slot geometry for that page.

A flow continues into a later page when its continuation policy permits the
move and the selected template exposes the same named destination slot. There
is no separate continuation slot or alternate continuation frame. If a named
slot is absent from the selected template, that page is not a legal destination
for that flow.

## Frame

A frame is the capacity of a slot in the layout selected for a page. The same
slot name may have different geometry in different templates, but geometry is
owned by the selected template rather than by a continuation-specific override.

## Region

A region is a named area definition in a layout. It can describe a column, a
sidebar area, a full-width band, an image area or another bounded area. It
defines geometry and behavior, but does not refer to one particular page.

## Slot

A slot is a named place made available by a template within a region. It may
be empty or accept one or more pieces of content. A planned slot references a
region and adds the page, selected flow or content, and the behavior needed by
the planner. For example: `page: 2`, `region: main-column-1`, `flow: main`.

A slot is a valid target only while its capacity and constraints allow another
placement. A placement consumes space; the slot can remain open, become
partially available, or become exhausted. Exhausted slots are not considered
for the next placement.

`header`, `footer`, `sidebar` and `intro` are ordinary region names, not
privileged engine concepts.

## Route

A route is the ordered sequence of regions through which one flow may
continue. The planner materializes that route as slots on concrete pages. A
route may change with the selected layout on a later page.
The template may declare `repeat: each-page` for a short flow such as a footer;
then the same authored flow is planned independently in each materialized
page slot and is not treated as accidental duplicate content.

## Placement

A placement is the planner's concrete assignment of content or a content
fragment to a slot. It records what was put into which slot and with what
resolved geometry. One slot may have multiple placements, for example when a
flow contributes several blocks or when a block is split across pages.

The public model does not need a separate `box` or `region instance` concept.
The backend may call the geometry of a slot or placement a box, but that is an
implementation detail.

## Spacing report

A spacing report explains a plan's geometry without inspecting rendered pixels.
It distinguishes the template's static page boundaries from the resolved
chrome boundary and from the content that actually occupies a slot.

- A **slot box** is the capacity declared or materialized by the layout.
- An **occupied box** is the extent consumed by the placed content.
- **Padding** is internal space between a content box and its text or child
  content.
- A **margin** is style-level space between adjacent blocks.
- A **boundary gap** is the distance from a slot or occupied box to a page
  boundary or reserved band.
- Boundary gaps are signed: positive means separation, zero means touching,
  and negative means that the slot crosses the named band boundary.
- **Line height** and **baseline offset** explain the relationship between a
  text line box and the visible glyphs inside it.

These are measured facts projected by the plan. They do not become new
placement rules and they must not be reconstructed from a PDF raster.

## Anchor

An anchor is a semantic placement relationship between objects or fragments,
such as requiring a quote or image to share a page with the first fragment of
an article. It is not a coordinate.

## Exclusion

An exclusion is an area temporarily unavailable to text flow, for example the
shape of a floating image or quote region. The planner subtracts it from the
available line measure instead of allowing text to collide with it.

## Constraint

A constraint is a rule that a plan must satisfy or may prefer, such as keep,
minimum size, same-page placement or overflow policy. Required constraints can
reject a plan; preferred constraints may produce a warning or an alternative.

## Plan

A plan is the deterministic proposed composition: selected layouts, slots,
placements, line positions, flow continuations and decisions. It
is an intermediate result, not a PDF.

## Evaluator

An evaluator checks a plan or rendered artifact against its constraints and
coverage rules. It can accept, warn or reject; a generated file alone is not
proof that the composition succeeded.

## Brand

A brand is a reusable visual vocabulary: typography, colors, assets and
graphic components. A brand may provide default region content and reusable
compositions such as a logo paired with a text label.

## Graphic component

A graphic component is a brand-defined composition of assets, shapes and
optional variable text. Content references the component semantically; it does
not manually construct its nested geometry.

## Lockup

A lockup is a measured structured block that groups an optional brand mark
asset with an optional brand label. The label belongs to the same composition
as the mark, analogous to an image caption belonging to its image, but it is
laid out beside the mark rather than being a separate flow block. A lockup may
be placed in any slot whose template contract allows that block kind; a
repeating header is a flow policy, not a different lockup identity.

In page chrome, “inline lockup” means that the lockup coexists with other
header or footer blocks such as an article title, publication period or page
number. It does not mean a text inline run. Each block keeps its own measured
box and the layout composes those boxes in order.

## Renderer

The renderer is the backend adapter that turns an accepted composition plan
into a concrete artifact. It must not decide document semantics or silently
discard unsatisfied content.
