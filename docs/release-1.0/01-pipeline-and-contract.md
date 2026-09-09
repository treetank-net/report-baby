# Plan 01 — pipeline and contract

Status: largely complete; the remaining work is an audit of the public
contract and legacy paths.

## Running the tests

The repository has one canonical test runner:
`server/scripts/test-harness.mjs`. Individual `test-*.mjs` files are its
internal cases, not separate product commands or runtime bundle components.

From `server/`:

- `npm test` rebuilds the current bundles and runs the default release gate for
  composition and final artifacts;
- `npm test -- --suite composition` runs planner contracts;
- `npm test -- --suite artifacts` runs PDF/PNG/PPTX, chrome, editorial, and
  other artifact contracts;
- `npm run test:release` runs the complete 39-check release gate;
- `npm run test:brand` runs the separate, expensive contract for brand
  profiles, templates, and brand mutations;
- `npm test -- --suite quality --no-build` runs extended maintenance checks
  outside the basic release gate;
- `npm run test:editorial-full` runs the full 506-fixture editorial-flow
  matrix; the regular release gate uses a fast representative set;
- `npm run baseline:verify` remains a separate corpus check because it compares
  stored artifacts and may require a deliberate baseline update;
- `npm test -- --suite visual` runs opt-in PDF/raster visual gates, including
  the editorial visual gate, rather than placing them in the default fast gate.

The current release evidence is:

| Check | Result | Evidence |
|---|---|---|
| `npm run test:release` | PASS | 39/39 checks completed on 2026-09-09 |
| `npm test` | PASS | 23/23 checks completed in approximately 122 seconds |
| public MCP contract | PASS | public MCP contract is green |

The runner builds the bundles before the default test so that tests cannot
accidentally use an old `cli-bundle.cjs` or `bundle.cjs`. `--no-build` is only
for quickly repeating an already-built run.

## Suite timing

The message printed to stdout is not a sufficient measurement: it disappears
when the process ends and does not show which check delayed the complete run.
Use this command for a complete timing report:

```sh
npm run test:timings -- --no-build
```

The command runs `test-harness.mjs --suite all` and writes a JSONL report to
`server/qa/test-timings.jsonl`. The file is a QA artifact ignored by Git. Each
record is appended immediately after the event, so an interrupted run still
retains the timings of completed checks:

- `run-start` contains the suites, the number of unique checks, and whether a
  build was performed;
- `check-start` and `check-complete` contain the name, script, suite, artifact
  decision (`not-generated`, `remove`, `retain`, or `split`), and `elapsedMs`;
  the final record also contains `passed`/`failed` status;
- `run-complete` contains total time, `suiteTotals`, and
  `checkCount`/`plannedCheckCount`; when the run builds bundles, the build is
  reported as a separate pseudo-suite named `build`.

The report can be written outside the repository, for example:

```sh
TEST_TIMINGS_PATH=/tmp/report-baby-timings.jsonl npm run test:timings -- --no-build
```

A check shared by multiple suites is executed only once;
`suiteTotals.<name>.skippedDuplicateChecks` records the skipped copies so that
suite totals do not pretend those checks ran again.

Earlier, timing was measured only ad hoc through harness messages. The latest
recorded runs gave approximately: smoke ~2.5 s, fast editorial ~26.5 s, page
limits ~23.4 s, and quality ~188.4 s. These are measurements from a particular
environment, not a performance contract; the canonical source of current data
is the JSONL report from `test:timings`.

The following is the historical full-`all` snapshot from 2026-09-09 before the
latest test-cost reductions. It is retained as a baseline, not as the current
release result:

| Suite | Sum of check times | Checks | Notes |
|---|---:|---:|---|
| smoke | 2.1 s | 3 | fast planner contract |
| composition | 92.9 s | 13 | 3 checks shared with smoke |
| artifacts | 116.7 s | 8 | repeated CLI/PDF/PNG/PPTX rendering |
| brand | 128.9 s | 1 | separate, expensive brand profile and mutation contract |
| quality | 162.9 s | 14 | maintenance and input contracts |
| total | 503.6 s | 39 | approximately 8 min 24 s, without build |

The largest individual costs in that run were: `brand contract` 128.9 s,
`manifest consumers` 76.0 s, `configuration reach` 51.7 s, `report images`
43.4 s, and `public MCP behavior` 28.4 s. These were the first candidates for
removing or limiting artifacts; the check name alone does not determine which
assertions can be detached from rendering. The artifact decision is recorded
separately because it describes whether rendering can be removed, not how the
test is currently executed.

## Completed in the first pass

- removed the second evaluation from `planReportComposition()`;
- the wrapper now returns `result.evaluation` from the engine;
- the composition test confirms one `evaluation` phase in the result;
- the contract test confirms one evaluator call for one plan;
- composition test bundling uses CommonJS, allowing tests to reach assertions
  instead of ending at `Dynamic require of "process"`;
- the input adapter has an assertion for the complete mapping of current block
  kinds;
- the editorial integration has a plan-only contract for cross-flow placement;
  PDF token and raster occupancy checks are kept in an opt-in visual gate.

## Public-path audit result

- No internal imports from `composition/index.ts` were found; the module is
  used as a public seam bundled by tests and potential callers. Therefore,
  exports are not narrowed automatically — that requires a separate
  breaking-change decision based on public usage.
- The aliases `main`, `header`, `footer`, `title`, `headerContent`, and their
  variants are supported by `compositionInputSchema`, but no use was found in
  the internal renderer beyond the parser itself. They are not removed
  blindly: we must confirm whether they are supported external input or merely
  migration leftovers.
- Test fixtures in the old shape are rewritten by a test helper into canonical
  `flows`; this does not prove that production still needs the old `ReportData`.

## Goal

Make one composition pass reliable and observable:

```text
CompositionInput
  → CompositionDocument
  → template / PageGeometry / CompositionTemplate
  → planner
  → evaluator
  → CompositionPlanResult
  → renderer
```

The planning result must be the only result used to decide whether rendering
may proceed.

## Current state

- `createCompositionEngine()` calls the planner and then the evaluator once:
  [`composition-engine.ts`](../../server/src/composition/composition-engine.ts).
- `planReportComposition()` returns the selected `result.evaluation` from the
  engine and does not evaluate again:
  [`report-composition-entrypoint.ts`](../../server/src/composition/report-composition-entrypoint.ts#L57-L93).
- `dry_run` and regular rendering use shared composition preparation;
  `resolveReportPlanOnly()` remains only as a legacy response path.
- The tool registry is located at
  [`interfaces/mcp/render-tools.ts`](../../server/src/interfaces/mcp/render-tools.ts).
- `report-composition-entrypoint.ts` is not a second renderer: it is the
  production entry point that assembles input, jsPDF metrics, planner policy,
  and renderer capabilities.
- The contract test reaches its assertions and confirms a single plan
  evaluation; test bundling uses CommonJS.
- The public MCP contract is green in the current release evidence.

## Steps

1. In `planReportComposition()`, return `result.evaluation` instead of calling
   the evaluator again.
2. Remove the unnecessary direct evaluator import from this wrapper.
3. Add an evaluator-call counter to the contract test and assert that one
   concrete plan is evaluated once.
4. Fix how the contract test's temporary bundle is built. Do not change
   assertions merely to bypass a runtime error. **Completed:** the contract
   and adapter tests use CommonJS and reach their assertions.
5. Document which data is public `CompositionInput` and which data is an
   internal composition-preparation stage.
6. Check the complete mapping of current block kinds from schema to renderer.
   **Partially completed:** the input adapter tests all current kinds; the
   shared path all the way to the renderer still needs confirmation.
7. Decide from usage which exports from `composition/index.ts` are a public
   seam and which should be internal.
8. Map all call sites of `report-composition-entrypoint.ts` and confirm that no
   parallel renderer implementation exists. **Completed:** the historical
   name `shadow` was removed from the API, file, and test.
9. Preserve configuration ownership: the evaluator may read only
   `composition_score`, the planner does not read YAML, and the adapter passes
   planner policy through the correct `pdf` seam. `quality` and visual QA must
   not become permission to accept an illegal plan.

## Tests and completion criteria

- the contract test reaches its assertions;
- the counter confirms one evaluator call for one result;
- regular rendering does not change the behavior of the existing corpus;
- `CompositionPlanResult` is passed to the renderer without resolving legality
  again;
- the composition entry point does not hide a second rendering path;
- configuration is not read by a module from the wrong group or by the planner
  core directly from YAML;
- there is no production translator for the old `ReportData` or `Cursor`;
- an unknown block kind ends with a clear error;
- `npm run test:release` passes 39/39 and `npm test` passes 23/23 in the current
  release evidence.

## Remaining scope after the first pass

- audit usage of exports from `composition/index.ts`;
- decide which input aliases are still needed and prepare their removal as a
  deliberate breaking change if no call sites remain;
- connect `dry_run` to the same planning result — this depends on plan 05 but
  is a recorded gap in that stage;
- confirm the shared block-kind path from schema to backend, not only
  normalization to `CompositionDocument`;
- confirm in the next audit that the canonical entry point remains the only
  public entry point for report planning;
- decide whether `composition_search` is runtime planner configuration or only
  test and experiment configuration;
- add regression cases from visual QA to the contract tests as described
  `CompositionInput`, rather than only as PDF snapshots. In particular,
  preserve checks for complete mapping of text, tables, lists, and glyphs.

## Requires completion after point X

- The final list of public exports requires completion after point 7, when
  actual call sites and integration tests are known.
- The exact `dry_run` contract requires completion after plan 05, because only
  then will it be clear which plan fields must be exposed.

## Out of scope

We do not restore the old input as a second format and do not create a new data
layer merely to wrap the current `CompositionPlan`.
