# Release 1.1 — public-contract cleanup and test consolidation

Status: implementation plan.

## Goal

Remove confirmed compatibility paths and make the release gate cheaper without
losing a distinct behavior assertion. This work is evidence-driven: no symbol,
alias, render or test is removed because its name merely looks old.

## Fixed decisions

- The unit of public-contract inventory is one externally accepted field,
  exported symbol, MCP property/tool or CLI option.
- The unit of test classification is one assertion group: assertions sharing
  one fixture setup and proving one behavior. A script may contain several
  groups with different decisions.
- A PDF is retained only when the asserted behavior depends on PDF serialization,
  text layer, drawing order, embedded assets or backend-specific geometry.
- Page, slot, flow, placement, coverage, legality, score and diagnostics use a
  plan-only proof.
- One representative artifact may prove several backend properties when its
  assertions remain separately named.
- Tests are merged only when they use the same fixture and lifecycle boundary.
- MCP and CLI transport schemas remain separate assertions even when they share
  a domain fixture.
- Timing is evidence, not permission to remove coverage.

## Current implementation

`server/scripts/test-harness.mjs` currently contains:

- suite membership in `suites`;
- a script-level `artifactDecisions` map;
- child-process execution and JSONL timing;
- duplicate-script suppression across selected suites.

The script-level decision is too coarse for mixed files such as
`test-report-composition-adapter.mjs`, `test-cli.mjs` and
`test-report-chrome.mjs`. Current tests also contain decision comments, but
there is no checked inventory connecting each assertion group to its cheaper
or retained proof.

Public contract surfaces currently include input Zod schemas,
`composition/index.ts` exports, MCP render schemas/responses, CLI request
parsing, `dry_run`, report entrypoints and legacy report-plan projection.

## Required inventory artifact

Create and maintain
`docs/release-1.1/contract-and-test-inventory.md`. It has two generated tables
plus manually reviewed decisions.

Public-contract rows:

```text
surface | name | declaration | consumers | classification |
replacement | removal release | protecting test
```

Allowed classifications:

- `public-retain`;
- `public-rename`;
- `compatibility-remove`;
- `internal`.

Test assertion-group rows:

```text
script | group | behavior | current lifecycle | current artifacts |
decision | replacement/merged target | backend reason | measured milliseconds
```

Allowed decisions:

- `plan-only` — replace artifact work with plan/evaluation assertions;
- `backend-retain` — retain the smallest backend operation named in reason;
- `merge` — move the assertion group to the named shared fixture/script;
- `remove-duplicate` — only after the replacement group is identified;
- `transport-retain` — retain one MCP/CLI process proof;
- `non-generated` — already uses the cheapest lifecycle.

No row may say merely `retain`, `split` or `remove` without naming the behavior
and replacement/backend reason.

## Inventory collection

Add `server/scripts/audit-release-contracts.mjs`. It is read-only and writes its
report only when an explicit output path is supplied. It collects:

1. exports from `src/composition/index.ts` and contract re-export files;
2. top-level input fields and compatibility aliases from Zod schemas;
3. MCP tool names/request properties;
4. CLI accepted request properties/options;
5. test scripts registered by the harness;
6. assertion-group annotations described below;
7. latest JSONL timings when supplied.

The script does not decide removals. It fails when a discovered public symbol
or registered test group is missing from the reviewed inventory.

Annotate one group at its setup function or first assertion:

```js
/**
 * @test-contract composition.plan.slot-routing
 * @test-proof plan-only
 */
```

For a backend group, use `@test-proof pdf-text`, `pdf-drawing`, `pdf-asset`,
`mcp-transport` or `cli-transport`. These comments identify behavior ownership;
they do not create runtime decorators or a test framework.

## Public-contract migration process

For every `public-rename` or `compatibility-remove` row:

1. identify all source, bundled, fixture and documentation consumers;
2. add the replacement contract and rejection/migration message;
3. migrate internal callers and examples;
4. make the contract test prove the old and new behavior expected for this
   release;
5. remove the compatibility path at its stated stage;
6. rerun the audit and require zero unclassified consumers.

Release 1.1 does not keep silent aliases. If backward compatibility is not an
approved requirement, the old property is rejected with a specific message
instead of normalized through a second hidden path.

The concrete initial cleanup rows come from active plans:

- `page_template_schedule` → `layout` (item 11);
- `CompositionFlowRoute.layouts` → remove (item 11);
- route-owned template fallback → remove (item 11);
- renderer-authored lockup/page number and related parameters → remove (item
  03);
- obsolete quote-specific search configuration → general keys (item 04);
- obsolete chrome/page-number geometry fields → remove after item 03.

`legacy-plan.ts` and `legacy-plan-assertions.ts` are not pre-approved for
deletion. Their rows must identify whether MCP/CLI still expose the projection.

## Test reduction process

For each assertion group, follow this order:

1. State the behavior without mentioning its current artifact.
2. Identify the earliest lifecycle result containing sufficient evidence.
3. Move assertions to that lifecycle while keeping the original fixture data.
4. If backend evidence remains necessary, produce one artifact after all
   plan-only assertions have passed.
5. Merge setup only when another group uses identical normalized input,
   template and expected lifecycle.
6. Delete old setup/render code only after the replacement group passes.

Examples:

- “quote is on page 3 and does not overlap main” uses `CompositionPlan` and
  legality; it does not render/rasterize.
- “page-number placeholder becomes selectable `3 / 6`” needs one PDF text
  extraction but not PNG conversion.
- “graphic command is after table command” uses the drawing recorder, not
  raster pixels.
- “brand showcase looks acceptable” remains one manual visual artifact, not
  one PDF per brand.

## Harness changes

Replace separate `suites` and `artifactDecisions` lookup with one list of
records inside `test-harness.mjs`:

```ts
{
  id,
  label,
  script,
  suites,
  proof,
}
```

This is a data consolidation, not a new harness abstraction. The harness
validates unique IDs, existing scripts, known proof values and at least one
suite. Duplicate scripts execute once per invocation while suite totals retain
ownership information.

JSONL timing keeps `run-start`, `check-start`, `check-complete` and run summary.
Every event includes check ID and proof. Budgets continue to come from
`quality.test_feedback` in `render-config.yml`.

## Implementation sequence

1. Add group annotations to registered tests without changing execution.
2. Add the audit script and commit the complete initial inventory.
3. Fail documentation/quality checks on unclassified public surfaces or test
   groups.
4. Consolidate harness metadata without changing selected scripts.
5. Apply public removals from items 11, 03 and 04 one row at a time.
6. Convert artifact groups to plan-only proofs one group at a time.
7. Merge identical fixture setup and delete proven duplicates.
8. Capture before/after timings on a cooled/normal host using the same suite
   command and revision build state.
9. Run focused tests, build, normal `npm test`, then `test:release` only at the
   release gate or when a changed backend/transport contract requires it.

## Test matrix for this task

| Requirement | Proof |
|---|---|
| every registered script has classified groups | audit script fixture |
| unknown group/proof fails | audit negative fixture |
| every public surface has a reviewed row | contract inventory test |
| duplicate suite membership executes once | harness self-test |
| omitted required check fails closed | harness self-test |
| JSONL contains IDs/proofs/totals | timing parser test |
| migrated aliases produce intended error | relevant MCP/CLI/schema tests |
| release suite coverage is unchanged | before/after group-ID set comparison |

## Completion criteria

- The audit reports zero unclassified public surfaces and assertion groups.
- Every removed alias names its replacement or explicit rejection behavior.
- Every removed artifact operation has an equivalent named proof.
- No plan-only group starts jsPDF, LibreOffice, Chrome, Poppler or ImageMagick.
- Representative backend proofs are counted and justified in the inventory.
- Before/after timing compares the same contract-group ID set.
- MCP, CLI, brand and release gates remain fail-closed.
