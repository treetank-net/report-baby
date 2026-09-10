# Release 1.1 — automatic brand lockup and removal of legacy chrome

Status: scope proposal; implementation has not started.

## Scope

Release 1.0 introduces an explicit `lockup` as an ordinary block in the
repeating header flow, but does not create it automatically from the brand
profile. It also keeps a renderer fallback for older fixed templates. Release
1.1 closes both gaps:

1. the brand-profile adapter materialises a lockup when the template requires it
   in its header;
2. after every supported template has migrated, the renderer's implicit
   logo/header fallback is removed.

## Lockup model

A lockup is an inline block inside the header, not the whole header. It can
appear next to the article title, issue number, or other chrome elements. It
contains the graphic brand mark and brand name in one placement, with the
relationship between them configured explicitly:

```text
header flow (repeat: each-page)
  -> lockup (mark + brand name + configured gap)
  -> article title
  -> optional page metadata
```

The brand description remains part of the lockup, like an image caption: it is
associated with the brand, but does not become a separate flow merely because
it contains its own text.

## Sources and responsibilities

```text
brand profile / ZIP
  -> normalized brand identity and assets
  -> template adapter creates a lockup block
  -> header flow measures the block with fit-content rules
  -> selected layout reserves the resulting height
  -> renderer paints the placement
```

- the brand profile is the source of the asset and name;
- the template decides whether a lockup is required and where it may appear;
- the planner determines geometric placement and checks collisions;
- the renderer executes the placement but does not invent one outside the plan;
- spacing, gap, and maximum height come from render configuration.

## Fallback migration

Fallback remains allowed only for explicitly classified templates that have not
yet migrated. Each such template must have a migration entry:

| Template state | Behaviour |
|---|---|
| explicit header with a lockup | lockup is planned as a header block |
| explicit header without a lockup | absence of a lockup is an intentional template decision |
| old template without a header flow | temporary fallback with a migration warning |
| template past its migration deadline | configuration error, not a silent fallback |

We do not remove the fallback through a one-off backend change. First prove
that MCP, CLI, `dry_run`, PDF, and brand tests all receive the same lockup
placement from the plan.

## Acceptance criteria

- a lockup from the brand profile has an unambiguous asset, name, and gap
  contract;
- a long description or name increases header height according to `fit_content`;
- the lockup repeats on pages according to the header-flow policy;
- absence of a lockup creates no empty space when the template does not require
  one;
- every supported template has an explicit decision: lockup, no lockup, or
  migration;
- removing the fallback does not change migrated-template geometry beyond the
  previously accepted dynamic-chrome difference;
- tests check the plan, PDF text, and one representative visual artifact.

## Out of scope

- changing paint order;
- creating a new `Header` entity;
- moving `main` content into insertion slots;
- automatic layout selection independent of the template schedule.
