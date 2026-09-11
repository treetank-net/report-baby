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

## Implementation map

### What exists today

- Brand identity and asset discovery are normalised in
  `server/src/brand/{context,contracts,assets,theme}.ts`.
- A jsPDF lockup capability already measures and paints a `lockup` block in
  `server/src/composition/adapters/pdf/lockup.ts`; the runtime registers it in
  `server/src/report/composition-runtime.ts` only when input already contains
  such a block.
- `server/templates/pages/editorial-dynamic-chrome/template.yml` declares
  fit-content `header-lockup` and `header` slots, so the geometry seam exists.
- `server/src/report/renderer.ts` still draws a logo/name fallback when a plan
  has no lockup placement. This is the legacy path to remove, not a second
  source of planned geometry.
- Lockup dimensions, logo gaps, and header heights are already YAML-backed in
  `server/templates/render-config.yml` under `chrome.lockup`, `pdf.header_*`,
  and the dynamic header settings.

### Changes required

1. Define the brand-to-lockup projection at the adapter boundary: extend the
   brand context contract with the resolved mark, display name, optional
   description, and asset reference; do not make the planner read ZIP files.
2. In `server/src/composition/adapters/input.ts` or a dedicated brand
   composition adapter, materialise one lockup block only when the selected
   template's repeating header declares a compatible lockup slot. Preserve an
   authored lockup as an explicit override and never create one for templates
   that intentionally omit it.
3. Pass the materialised block through
   `report-composition-entrypoint.ts` and `composition-runtime.ts` so the
   existing lockup capability measures its fit-content height and the ordinary
   header flow reserves the resulting geometry.
4. Add a per-template migration registry in the template catalogue. The
   registry must classify `explicit-lockup`, `intentional-no-lockup`, or
   `legacy-fallback` and emit a warning for the last category.
5. After all supported templates have an explicit decision, delete the
   fallback branch in `drawReportChrome()` and make missing planned chrome a
   clear diagnostic/error. Do not change page geometry as part of fallback
   removal.
6. Update `server/scripts/test-report-chrome.mjs`,
   `test-brand-contract.mjs`, `test-public-mcp-contract.mjs`, and the plan
   contract tests. Prove empty, short, and long brand names/descriptions,
   repeated pages, an intentional no-lockup template, and the final fallback
   removal with one representative PDF.

### Resulting files and dependencies

The new responsibility belongs to a brand/composition adapter, not a new
`Header` entity. It depends on the document `layout` selection (item 11),
fit-content spacing/evidence (items 08–10), and the existing YAML configuration.
Paint order (item 01) remains independent. The acceptance gate is one identical
lockup placement in plan-only, CLI/MCP, and PDF paths.
