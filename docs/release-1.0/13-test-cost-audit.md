# Plan 13 — test-cost audit before release 1.0

Status: the harness-level audit is complete, the first artifact reduction was
implemented and measured, and the release gate is green. Check count is not
test-case count: the full editorial matrix contains an additional 506
fixtures. Any remaining `split` entries are follow-up migrations, not release
1.0 blockers.

The follow-up was divided into three independent packages: composition-plan
contracts, the editorial matrix, and public/backend contracts. Each package
must merge fixtures and processes according to the decisions below, preserve
assertions, and measure only direct test scripts (not `test-harness`). After
merging, review the diff, run `node --check`, and remeasure the relevant
scripts. The full release gate is the final verification, not a substitute for
these focused measurements.

## Objective and boundaries

Not every test that uses the word “render” needs an artifact as evidence. This
audit classifies the design decision, not just the way a test currently runs:

- `not-generated` — the test creates no output artifact, or already checks the
  contract at plan/process level; nothing needs to be removed;
- `remove` — the entire current artifact is unnecessary for the assertion and
  can be replaced by a plan or process response;
- `retain` — the artifact is the appropriate evidence (for example PDF, raster,
  PPTX, glyphs, selectable text, or deterministic hash) and must remain;
- `split` — the file mixes assertions: some can move to plan/process level, but
  a smaller artifact test must remain.

CLI/MCP contract is an independent axis. It can be `not-generated` when only a
process response is checked, or `split` when the same check also proves PDF,
PNG, or PPTX output.

The inventory records 21 `not-generated`, 10 `retain`, 8 `split`, and 0
`remove` decisions. This does not mean there are no savings: the eight `split`
checks can lose most of their renders. It means we have not yet confirmed a
case where an entire existing artifact can be removed without leaving at least
one backend proof.

### Checks versus test cases

`check` means one script run by `test-harness`; it may contain many assertions
or cases. `fixture` means one concrete input scenario in a matrix. In
particular:

- `npm run test:timings -- --no-build` covers 39 unique harness checks;
- `npm run test:editorial-full` covers 506 fixtures: 480 matrix variants, 7
  reproducers, and 19 seeded fixtures. It is a separate gate and is reported
  separately from the harness checks;
- the fast `editorial flow` harness check runs only 26 of those 506 fixtures and
  is already included in the 39-check release gate.

The number 519 previously arose from mixing 506 editorial fixtures with 13
unique composition checks. These are two levels, not the canonical count of all
repository tests, and must not be added to the 39 harness checks without naming
the counted level.

### Current release evidence

The release gate `npm run test:release` passed **39/39 checks on 2026-09-09**.
The default `npm test` passed **23/23 checks in approximately 122 seconds**.
The separate `npm run test:editorial-full` gate passed **506/506 fixtures in
242.32 seconds on 2026-09-09**. The full gate exposed and then covered an
evaluator regression in which occupied table/block placements were counted as
free flow capacity.

## Full path: plan first, renderer last

The earlier `retain` classification said that an artifact was useful evidence
of some property. It did not answer whether the property belonged to the
planner or backend. For release 1.0 we use this split:

1. `P — plan-only`: the scenario ends at `planReportComposition` or
   `createTextCompositionEngine(...).plan`. Check `accepted`/`rejected`, hard
   diagnostics, pages, slots, lines, block placements, and box relations. This
   is the correct test for legality, order, overflow, continuation, dynamic
   height, and element position.
2. `T — transport/dry-run`: through public CLI or MCP, check that input reaches
   the same planner and the response has the correct contract. Do not pass
   `output_path`; the renderer is not invoked.
3. `B — backend smoke`: one minimal artifact for each distinct output contract
   (PDF, PNG, PPTX, or image in PDF). Check that the backend writes a valid
   format, preserves minimal text/image, and does not reject a legal plan. Do
   not repeat coordinate assertions here; those belong to `P`.
4. `V — visual/compatibility`: rasterization, ink occupancy, hashes, or oracle
   comparison. This is a slow regression test, not the primary proof that “X
   can be generated”; run it as a manual, nightly, or extended
   `test:release:visual` gate.

The plan is the source of truth for geometry. Assertions that do not require a
PDF include: every line stays in its slot, flow placement stays inside the
page, chrome displaces `main`, insertion belongs to the correct flow, a block
has a legal slot, every hard requirement has a placement or the plan is
rejected, and residual describes exactly the content that could not be placed.
The backend only proves that an accepted plan can be materialized.

### Target decision for current checks

| Group | Checks | Target method | Is the full path needed? |
|---|---|---|---|
| Pure plan | `composition engine contract`, `composition input adapter`, `template flow contract`, `report plan contract`, `text composition engine`, `generic soft insertions`, `dynamic insertion slots`, `page template adapter`, `contrast evaluation prototype`, `composition page limits`, `structure scoring` | Direct planner/evaluator, optionally an in-memory backend double | No. These checks legality and plan geometry. |
| Public boundary | `dynamic insertion public contract`, `input errors`, `MCP schema`, `architecture`, `script duplication`, `source context`, `source materialization`, `Markdown normalizer`, `composition documentation`, `brand release template` | Validate data, dry-run, file inspection, and responses | No. Rendering adds no evidence for these contracts. |
| Plan + small backend smoke | `jsPDF adapter`, `composition adapter`, `composition image`, `editorial plan contract`, `report chrome`, `public CLI behavior`, `public MCP contract`, `editorial flow`, `brand contract`, `manifest contract`, `manifest consumers`, `brand assets` | All relevant positions in the plan; one minimal render per backend/format | Not at the current scale. Yes, only as one backend representative. |
| Configuration | `configuration reach` | Compare normalized plans for geometry variants; one render proves configuration reaches backend, while score changes do not alter the artifact | No. Nine full renders are unnecessary. |
| Plan instead of PDF parity | `composition oracle` | Compare plans, tokens, pages, and placements; one adapter PDF smoke | Not as a full PDF oracle. |
| Slow regression gate | `editorial parity`, raster/ink parts of numbered editorial, any remaining raster image checks | Separate visual-QA test, explicit or nightly | Not in fast `test:release`; retain outside it if visual protection is wanted. |
| Independent formats | `slide artifacts` | One small deck checking PDF, PNG, PPTX, and editable text | Yes, but one shared fixture only. |
| Input decoder | `image resolver` | No PDF: real PNG/WebP/AVIF decoding, dimensions, and root confinement | No. This tests the resolver, not the renderer. |

`configuration reach` is a boundary case. Geometry-changing variants should
check the normalized-plan difference rather than create nine PDFs. Keep one
smoke proving that configuration reaches the backend; score variants remain
planner/evaluator tests.

`composition oracle` and `editorial parity` answer “is the result compatible
with the old renderer or reference image?”, not “can a legal document be
generated?”. Retain them as compatibility protection, but do not make every
planner path render fully.

### Cheaper execution techniques

- Run all position, overflow, priority, chrome, and insertion scenarios in one
  planner process with box-relation assertions. `newPdf()` may remain an
  in-memory object, but do not call `output()`, `pdftotext`, or `pdftoppm` unless
  the backend itself is the property under test.
- Use `dry_run` for every CLI/MCP variant, and send one legal path per public
  tool to the backend. Input errors and hard rejections must not create
  artifacts.
- Combine variants into one fixture when they prove the same backend: one PDF
  can contain text, table, chart, and image; one deck can contain title,
  metrics, table, and narrative.
- Do not invoke `pdftoppm`, ImageMagick, FFmpeg, or LibreOffice for assertions
  already decided by the plan. Keep them for format, decoding, or visual QA.
- Do not bundle or start a process for every variant. Planner matrices should
  share a bundle/fixture, and public tests may use one process in batch mode.
- Separate the fast release gate from full visual QA. Every retained artifact
  must have a named backend contract; historical full rendering alone is not a
  sufficient reason.

## Brand showcase as the visual smoke

`examples/brand-showcase` is a demonstration set and is sufficient as one
visual product smoke. Generate it once after renderer or template changes and
keep the result as a demonstration artifact. Do not compare every brand pixel
by pixel against a separate baseline in every `test:release` run.

Consequences:

- `brand contract` checks plan, manifest, and rejections rather than performing
  dozens of full mutation renders; one shared showcase proves PDF/PNG/PPTX
  materialization;
- `manifest consumers` consume the prepared showcase tree and audit/inspect it,
  without regenerating every brand;
- `editorial parity`, ink occupancy, and oracle comparisons are optional
  visual/compatibility gates, not part of the fast legal-plan proof;
- Poppler, ImageMagick, FFmpeg, and LibreOffice are unnecessary for position
  assertions. They may remain one-off visual-QA tools, but must not decide the
  planning release gate.

Generated `examples/*/generated/` is currently ignored by Git. If generated
PDF/PNG/PPTX should actually remain in the repository as a demo, remove that
ignore entry in a separate change, reduce the set to one showcase, and document
it as a demonstration artifact rather than a test baseline.

## Historical timing inventory and per-check decisions

The following timings are historical measurements from the full release run
before the final suite consolidation. They are retained for cost comparison and
must not be read as the current pass/fail evidence. `P` means plan, `T` transport
or `dry_run`, `B` one backend smoke, and `V` separate visual QA.

| Check | ~s | Target mode | What to shorten, merge, or remove |
|---|---:|---|---|
| composition engine contract | 1.4 | P | Retain; no renderer. |
| template flow contract | 0.4 | P | Retain; template compilation and geometry need no PDF. |
| structure scoring | 0.3 | P | Retain; pure scoring functions on a synthetic plan. |
| composition input adapter | 0.5 | P | Retain; normalization and schema. |
| report plan contract | 0.7 | P | Retain until the legacy seam is removed; then move assertions into the adapter and remove the separate bundle. |
| text composition engine | 21.9 | P | Retain planner cases; remove mandatory rasterization and share the bundle. |
| generic soft insertions | 0.8 | P | Retain; placement and legality from the plan. |
| dynamic insertion slots | 1.5 | P | Retain; `applyDynamicInsertionRequests` and slot legality are renderer-neutral. |
| page template adapter | 4.6 | P | Retain; do not bundle independently for every variant. |
| jsPDF adapter | 1.6 | B | One minimal PDF; do not repeat geometry assertions. |
| composition adapter | 4.1 | P+B | Keep all capabilities in the plan and one shared backend PDF. |
| composition oracle | 10.5 | P/V | Compare plans; move PDF oracle to visual/compatibility. |
| composition image | 4.5 | P+B | Check box and flow in plan; one minimal image-embedding test. |
| contrast evaluation prototype | 0.1 | P | Retain; synthetic raster is evaluator input, not a PDF. |
| editorial numbered flow | 27.6 | P+B | Keep order/barriers in plan; at most one text PDF, without Poppler/ink occupancy. |
| composition page limits | 13.9 | P | Retain rejection/residual without artifact. |
| public MCP contract | 26.8 | T+B | Batch/dry-run routes; one representative public render. |
| dynamic insertion public contract | 5.9 | T | Merge its assertions into the public MCP contract if the transport remains one process. |
| public CLI behavior | 7.4 | T+B | One PDF; parity, warning, and plan variants as dry-run. |
| report images | 30.9 | P+B | Codec and position in plan/resolver; one image PDF without ImageMagick/Poppler. |
| report chrome | 6.0 | P+B | Check dynamic height and position in plan; reuse one backend smoke. |
| editorial flow | 12.8 | P+B | All fixtures plan-only; one or two representative PDFs without raster. |
| editorial parity | 6.1 | V | Remove from fast release; replace with one-off showcase visual QA. |
| slide artifacts | 1.1 | B | Retain one deck: PDF + PNG + PPTX. |
| brand contract | 128.5 | P/T+B | Largest candidate: plan/dry-run mutations and errors, one showcase instead of dozens of renders. |
| composition documentation | 0.1 | P | Retain; static control. |
| manifest contract | 0.9 | T+B | Validate one prepared showcase manifest. |
| manifest consumers | 75.7 | T | Retain audit/inspection, remove repeated showcase rendering. |
| input errors | 5.2 | T | One process for all cases; never render invalid input. |
| MCP schema | 2.4 | T | Retain one `listTools`. |
| configuration reach | 51.3 | P+B | Compare geometry variants in plan; one render for the configuration seam. |
| architecture | 0.6 | P | Retain; static analysis. |
| script duplication | 0.0 | P | Retain; source analysis. |
| source context | 0.2 | P | Retain; path and root confinement. |
| source materialization | 0.1 | P | Retain; ZIP/cache/traversal. |
| Markdown normalizer | 0.1 | P | Retain; AST and diagnostics. |
| image resolver | 9.3 | P | Retain real PNG/WebP/AVIF decoding without PDF; share fixtures. |
| brand assets | 15.8 | P+B | Publish/derivative and one embed smoke; no full deck per case. |
| brand release template | 0.3 | P | Retain; template inspection. |

Most obvious removals or merges after adding missing assertions were:

1. the separate `dynamic insertion public contract`, if its assertions are
   owned by the public MCP transport contract;
2. repeated showcase generation in `manifest consumers`;
3. raster and coordinates from editorial numbered flow, report chrome, report
   images, and composition oracle where geometry is already in the plan;
4. `editorial parity` from the fast release (one manually generated showcase is
   enough for visual smoke);
5. `report plan contract` after the legacy seam closes and its assertions move
   to the existing adapter test.

Assertions are not removed. Only repeated materialization and tools that prove
no more than an accepted plan are removed.

## Baseline and current evidence

The original baseline came from `server/qa/test-timings.jsonl`, generated on
2026-09-09 by `npm run test:timings -- --no-build`: 39 unique checks completed
successfully in 503.6 seconds. It was measured before the brand suite was
separated; historical `brand contract` time was therefore assigned to the new
`brand` suite. The default `npm test` is a different, smaller gate and now
passes 23/23 checks in approximately 122 seconds.

The current release gate is authoritative for release status:

```text
npm run test:release  → 39/39 passed, 2026-09-09
npm test              → 23/23 passed, approximately 122 s
```

`npm run test:editorial-full` is intentionally separate and covers 506
fixtures. The latest run passed all fixtures; future snapshots must report its
result independently rather than inferring it from either command above.

## Suite decisions after consolidation

The target suite map is:

| Target suite | Current owners | Shared proof | Remains separate |
|---|---|---|---|
| `composition-plan-contract` | engine contract, input adapter, template flow, report plan, soft insertions, dynamic slots, page limits, structure scoring | input → normalization → legality → placements, slots, diagnostics, and scoring in memory | public transport and PDF backend |
| `editorial-plan-matrix` | plan parts of editorial flow and editorial numbered flow | one fixture matrix and shared assertions for columns, barriers, continuation, and insertions | representative render and visual QA |
| `public-transport-contract` | public MCP contract, dynamic insertion public, public CLI behavior | shared inputs, expected responses, errors, and dry-run; one process per transport batch | MCP and CLI remain separate adapters because protocols differ |
| `pdf-backend-smoke` | jsPDF adapter, composition adapter, composition image, report chrome | one minimal document with text, table, image, chrome, and insertion; format/write assertions | resolver-specific input tests and separate PNG/PPTX formats |
| `visual-showcase` | raster/PDF helpers, composition oracle, editorial parity | one demonstration materialization, ink/token/box parity, and oracle | not part of fast `npm test`; explicit/nightly |

The actual current owners include `test-public-mcp-contract.mjs`,
`test-editorial-plan-contract.mjs`, and `test-editorial-visual-gate.mjs`.
The former `test-public-behavior.mjs` and `test-report-images.mjs` monoliths are
not harness owners. Image input is covered by `test-image-resolver.mjs` and
composition image/backend checks; public MCP behavior is covered by the
128-line `test-public-mcp-contract.mjs`.

Merging does not mean putting every contract into one unreadable test. It means
sharing a fixture, process, and assertion layer where the evidence is the same.
For each row, move assertions to the shared plan first, then run one
representative smoke. Only afterwards may the old renderer invocations be
removed.

## Function-level audit

The audit covers all 24 scripts run by the default `npm test` at the time of
the function audit (the `composition` and `artifacts` suites), the harness, and
the shared test helpers imported from `server/scripts/lib/`. Every named local
function has a comment directly above its declaration with `@test-decision`
and `@test-action`. The comment records whether to:

- keep it as a plan assertion (`plan-only`, `plan-assertion`);
- merge fixtures or shared assertions (`plan-fixture-or-assertion`);
- merge transport and process execution (`merge-transport`,
  `merge-process-runner`);
- share bundling (`merge-shared-bundle`);
- keep one planning batch (`plan-batch`); or
- move expensive verification into one smoke/showcase gate (`visual-gate`).

An orphan helper may be removed only after confirming it has no callers
(`remove-candidate`).

Anonymous `map`/`filter` callbacks and domain functions imported from `src/`
are not annotated: they are not seams owned by this harness, and their
responsibility is documented with their module. The cost decision for an
imported function belongs at the test call site. Shared functions under
`scripts/lib/` are annotated because they are test code and own shared
processes, fixtures, and decoders. If a helper moves again, move its decision
comment with its declaration.

## Completion boundary

Release 1.0 is complete when the current release gate is green and every
retained artifact has a named backend reason. The 39/39 result on 2026-09-09
meets that release-gate condition; the 23/23 default `npm test` result is the
fast gate evidence; and the latest 506/506 `test:editorial-full` run is green.
Documentation and legacy audits remain separately tracked.

Optimization follow-ups may further merge fixtures, share bundles, or move
visual checks out of the fast path, but may not delete assertions or change the
document-flow contract. Release 1.1 deferrals such as automatic brand lockup
materialization, removal of the legacy renderer fallback, and explicit
`paintOrder` are outside this test-cost task and must not be smuggled into the
1.0 gate.
