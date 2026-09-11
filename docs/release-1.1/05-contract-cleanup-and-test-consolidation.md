# Release 1.1 — contract cleanup and test cost

Status: scope proposal; call sites must be audited before breaking changes.

## Public contract

Release 1.0 preserves public exports, input aliases, and MCP/CLI behaviour. In
1.1, confirmed legacy remnants may be removed, but only after:

1. collecting every MCP, CLI, `dry_run`, and adapter call site;
2. assigning every export to a domain owner;
3. preparing a migration message or an explicit breaking-change version;
4. adding a test that proves there is no hidden path.

Do not remove a symbol merely because it looks old. First establish that it is
not part of the user contract or the bundle.

## Tests

Further reductions must reduce cost, not coverage. For each assertion, choose
the cheapest sufficient proof:

| Property | Preferred proof |
|---|---|
| page, flow, slot, order, legality, residual | plan/evaluation without PDF |
| selectable text or stream correctness | one small PDF |
| backend image geometry or contrast | one representative artifact |
| PDF/PNG/PPTX parity | a separate artifact test, only when it is the contract |
| the same repeated property | one shared fixture instead of many renders |

Mixed tests should be split into a planning part and a minimal backend proof.
Merging several tests is appropriate when they check the same contract and can
keep separate, readable assertions. Removal is appropriate only when
duplication has been demonstrated.

## Acceptance criteria

- every check is labelled `not-generated`, `retain`, `split`, or `remove`;
- a retained artifact has a named backend reason;
- a plan-only check does not start the renderer or rasterisation;
- shared fixtures do not hide different contracts;
- timing JSONL shows cost before and after migration;
- MCP, CLI, brand, and release gates remain fail-closed;
- the public export and alias audit has a result for every symbol.

## Out of scope

- changing flow or legality semantics only to make a test faster;
- removing an assertion without an equivalent proof;
- removing a complete backend visual test when its property has no cheaper
  equivalent.

## Implementation map

### What exists today

- Public MCP tools live in `server/src/interfaces/mcp/*.ts`; CLI entry points
  live in `server/src/interfaces/cli/*.ts`. Both forward composition requests
  into the report adapters, but their aliases and descriptions are maintained
  separately.
- The renderer-neutral public types are exported from
  `server/src/composition/index.ts` and the contract files below it. Legacy
  report paths remain in `server/src/report/legacy-plan.ts` and
  `legacy-plan-assertions.ts`.
- `server/scripts/test-harness.mjs` is the test registry and already records
  an `artifactDecisions` classification; `test-timings.mjs` and the harness
  timing output are the cost evidence.
- Several scripts in `server/scripts/` combine planning, PDF creation,
  rasterisation, and assertions for the same property. The release gate still
  starts all registered child-process tests.

### Changes required

1. Generate an export/alias inventory from `server/src/composition/index.ts`,
   MCP tool schemas, CLI parsing, `dry_run`, and the report entry points. Mark
   each symbol as public, internal, compatibility-only, or removable and add
   the result to the contract test.
2. For every compatibility-only field or alias, add one explicit migration
   diagnostic and a removal version. Remove code only after the inventory test
   proves no MCP, CLI, bundle, or fixture path consumes it.
3. Refactor the test registry so a shared fixture can expose a plan-only
   assertion and an optional backend proof without starting a renderer for the
   former. Keep the `not-generated`, `retain`, `split`, and `remove` decision in
   the registry next to the test name.
4. Merge tests only when they assert the same contract: e.g. combine repeated
   plan legality cases behind one fixture, but retain separate assertions for
   MCP schema, CLI formatting, and PDF text. Delete a render or raster step
   only when the plan/evaluation assertion is equivalent.
5. Make `test-timings.mjs` write per-suite and per-script JSONL before and after
   the change, and make the release gate fail if a required check is silently
   omitted. Use the YAML `quality.test_feedback` budgets rather than literals.
6. Re-run focused plan-only tests first, then one representative backend test,
   then the normal build and release gates in an environment that permits
   child processes. Do not use a timing improvement as evidence that coverage
   is preserved; compare the assertion inventory instead.

### Resulting ownership and dependencies

Interface adapters own public names and response shape; composition contracts
own domain types; the harness owns test classification and timing; individual
tests own assertions. This workstream follows the layout/chrome and 08–10
changes so their new fields are audited once, not copied into ad-hoc fixtures.
