# Work items

Every item names its goal. An item that serves no goal is not here — it is on the
deferred list in [README.md](README.md) with a trigger.

Markers, kept exact because they are grepped: `[ ]` not started · `[>]` in
progress · `[x]` done, append `— <short sha>` · `[!]` blocked, say by what ·
`[~]` dropped, say why. Never delete an item.

## Order

There are two different graphs here, and conflating them is how a recommendation
turns into a false blocker:

| Graph | What it says | Binding? |
| --- | --- | --- |
| **Dependency** | a group cannot *complete* before another | yes — it is a correctness condition |
| **Edit order** | a group is easier to *do* after another, because they touch the same files | no — a recommendation only |

Only one dependency constraint is real: **P0 before anything that changes
output.** Without it, "the new layout family works" cannot be distinguished from
"I broke `default-report`". By dependency alone, G2 and G4 could start today, in
either order.

| Group | Serves | Depends on |
| --- | --- | --- |
| P0 parity harness | Goal 5 | — |
| G4 script sharing | Goal 4 | **P0.1 only** — see below |
| G2 input errors | Goal 2 | P0 (it changes rejection behaviour) |
| G6 liftability | Goal 6 → 1, 3 | P0 |
| G1 configurable layout | Goal 1 (product) | P0, G6 |
| G5 manifest contract | Goal 5 | — |

**P0.1 owns the shared module; G4 extends it.** An earlier revision had P0.1
extracting the hash primitives into a shared module *and* G4.1 creating that
module for the same primitives — two items for one piece of work, with a
dependency graph that contradicted the tasks. Resolved in one direction: P0.1
creates it, because P0 runs first and is timeboxed, and G4.1 is now about moving
the *other* mechanisms in. So G4 depends on P0.1, not on all of P0.

G1 is last because it is the only item that needs the others; it is also the
reason the rest exist. Note it is a **product feature**, not a quality outcome —
see [README.md](README.md#two-kinds-of-goal-reported-separately).

### Recommended edit order — not a dependency

`P0 → G4 → G5 → G2 → G6 → G1`

This is the **edit-order** graph, and its only justification is file conflicts:
P0, G4 and G5 all edit `server/scripts/visual-qa.mjs` (1 529 lines), so doing them
concurrently means fighting over one file. Only G2 and G6 have genuinely disjoint
file sets, and both wait on P0 for the dependency reason above.

Nothing here blocks completion. Finishing G5 before G4 is not a plan violation —
it is a different sequencing choice with more merge work. The only real blocker
in this document is P0.

## P0 — parity harness (Goal 5)

Timeboxed to one working day. If it runs long, cut scope: Tier A only, hashes
only, one command. A harness that becomes a project has replaced the work it was
meant to protect.

- [x] **P0.0 Record the present state — `eb373d5`.** Build, standalone TypeScript,
  public MCP behavior, brand contract and full visual QA were run before the
  harness was extended. Results and the two existing red commands are recorded
  in [BASELINE.md](BASELINE.md#p00-present-state-before-the-harness).

- [x] **P0.1 Create the shared script module, starting with the hash primitives — `eb373d5`.**
  `pdfContentHash`, `pptxContentHash`, `zipEntries`, `stripTimestamps` out of
  `visual-qa.mjs`, and point `visual-qa.mjs` at them. **This item owns the
  directory** — G4 moves the remaining mechanisms into it and does not create it
  again.
- [x] **P0.2 Declare the corpus — `c861003`.** A tracked file listing Tier A cases. Tier B
  lives in `$REPORT_BABY_DATA/regression/` and is named, never committed.
- [x] **P0.3 `baseline:record` and `baseline:verify` — `c861003`.** Per-artifact hashes, one
  JSON, sorted, no timestamps. `verify` exits 1 on any difference and prints which
  artifact and which format.
- [x] **P0.4 Reproduce the recorded numbers through the harness — `c861003`.** The
  committed harness reproduces 40 Tier A hashes (8 PDF, 4 PPTX and 28 PNG).
- [x] **P0.5 Prove the gate detects a real change — `c861003`.** Introduce a one-millimetre
  geometry change, confirm `verify` fails and names the artifact, revert. A gate
  never exercised against a real difference is decoration.

## G2 — bad input says what to fix (Goal 2)

Changes behaviour on purpose: inputs that render today will be rejected. Follow
the baseline-change procedure in [BASELINE.md](BASELINE.md).

- [ ] **G2.1 Build the bad-input corpus.** Generate mutations from the zod schema:
  drop a required field, wrong type, enum typo, wrong nesting depth, array where
  an object is expected. Committed as files, reviewed like code — a gate over an
  empty list is green and meaningless, so the corpus needs its own minimum-size
  check.
- [ ] **G2.2 One validator per model, and the schema owns itself.** The deck model
  has two validators that already drifted once (`ROADMAP.md:105`). Keep the zod
  contract, delete the hand-written checks in `slide-context.ts`, and make the CLI
  use the same contract instead of passing parsed JSON to `renderReportPdf`.

  **Extract the schemas to `contract/` first.** All eight of them — 110 zod
  declarations — currently live in `tools/render.ts`, which is the MCP adapter.
  MCP and the CLI both import from `contract/`, never from each other:

  ```
  contract/schema.ts
  ├── tools/render.ts    (MCP)
  └── example.ts         (CLI)
  ```

  Without this step the obvious implementation is `example.ts → tools/render.ts`,
  which makes the CLI depend on MCP registration. That edge **does not exist
  today** — verified — and this task must not create it.
- [ ] **G2.3 Enumerate the flips before writing them.** Every input shape that
  renders today and will be rejected after G2.2, with what it renders now. This is
  the release note. Silent tightening is the failure mode.
- [ ] **G2.4 Message quality as a gate, not a side effect.** Every rejection, on
  every path, names the offending field and the expected type. MCP already does
  this — copy the shape. Zero messages matching
  `is not a function|Cannot read propert|undefined is not`.
- [ ] **G2.5 Wire the gate.** `goals:input-errors` runs the corpus through both
  fronts and asserts exit code, field name presence and absence of crash shapes.
- [ ] **G2.6 A schema snapshot.** MCP tool schemas are a public contract parity
  cannot see; a snapshot test catches accidental changes.

## G4 — standalone scripts share code (Goal 4)

Independent of everything. Cheapest visible win in the set.

- [x] **G4.1 Inventory the mechanisms to collapse — `0215cc2`.** Against the module P0.1
  already created. Five of them, each with a count that has to reach 1:
  `findOfficeConverter` (2, diverged), fixture builders (3), showcase iterations
  (7), process runners (9), and identical normalised function bodies (>0 → 0).
- [x] **G4.2 Collapse the diverged copies — `2d63edf`.** `findOfficeConverter` exists in two
  versions (16 and 21 lines) that no longer agree. One implementation, with the
  Flatpak and Docker fallbacks `AGENTS.md` requires.
- [x] **G4.3 One spawn wrapper, one showcase iteration — `0215cc2`.** Nine scripts have their
  own `spawn`; seven iterate the showcase their own way.
- [x] **G4.4 One fixture builder — `3d8d874`.** Three exist: `visual-qa.mjs`,
  `test-public-behavior.mjs`, `test-brand-contract.js`.
- [x] **G4.5 Wire the gate, per mechanism — `0215cc2`.** `goals:script-dup` asserts each count
  from G4.1 individually: `findOfficeConverter` 1, fixture builders 1, showcase
  iterations 1, process runners 1, identical normalised bodies 0. Body hashing, not
  name matching, so renaming a copy does not pass.

  **"At least one shared module exists" is not the gate** — a trivial `shared.ts`
  imported twice would satisfy it while changing nothing. It stays a supporting
  number in the report.

## G6 — a module can be lifted out (Goal 6, serving 1 and 3)

Do only what Goals 1 and 3 need. If an item here stops serving them, drop it and
say so.

- [ ] **G6.1 Move the three cycle-carrying declarations — to two different
  owners.** Breaking the cycle needs all three out of their implementation
  modules, but they are not the same kind of thing, and putting all three in
  `contract/` would turn it into a bag for every shared type. Measured ownership:

  | Declaration | Owner | Evidence |
  | --- | --- | --- |
  | `Slide` | `contract/` | it *is* an input contract — `z.discriminatedUnion` in `tools/render.ts:96`, reached by `slides: z.array(slideSchema)` |
  | `RenderTheme` | `core/model/` | product of brand resolution, not an input. Its only mentions in the adapter are an import and a helper parameter type |
  | `ResolvedSlidePlan` | `core/model/` | internal renderer model — **zero** occurrences in `tools/render.ts` |

  Type-only moves; the TypeScript graph goes to zero components. Verify parity
  anyway. The distinction matters beyond tidiness: the G6.4 checker enforces
  whatever layering it is given, so a wrong home here becomes a rule that
  *requires* the wrong structure.
- [ ] **G6.2 Inject the asset allow-list.** `brand.ts:289` reads
  `getBrandSourceRoots()` from ambient state. It is a security boundary, and
  reading it globally is why testing it needs a subprocess with a modified
  environment.
- [ ] **G6.3 Separate page geometry from text flow in `templates.ts`.** This is
  the item Goal 1 depends on. **Not** one module per section — the split that
  matters is geometry (where boxes are) from flow (how text fills them). The 10
  cursor-carrying functions need to accept a segment instead of a `y`.
- [ ] **G6.4 The architecture check — only rules this plan can support.**
  `arch:check` fails the build on:

  | Rule | From when |
  | --- | --- |
  | any runtime import cycle | immediately |
  | any TypeScript import cycle | after G6.1 |
  | `process.env` outside the config seam, under `core/` | after G6.2 |
  | `contract/` importing any local module | after G6.1 — a contract that depends on an implementation is not a contract |
  | `core/model/` importing an adapter (`tools/*`, `example.ts`, `brand-tool.ts`) | after G6.1 |

  **The rule "a module assigned to no layer" is deliberately absent.** It needs a
  complete module-to-layer map, and this plan does not build one: the full
  `contract / core / usecases / adapters / authoring` pyramid was cut with the old
  Phase 3a, and only `contract/` and `core/model/` survive. A checker demanding a
  layer for `brand.ts`, `templates.ts`, `svg.ts` and `tools/*` would be enforcing
  a structure nothing in this document creates — and, worse, would force those
  assignments to be invented to make a build pass. If layers are ever introduced
  for their own reasons, the rule comes back with them.

  Shares graph construction with `goals` — two checkers disagreeing about what an
  edge is would be worse than having neither.
- [ ] **G6.5 Opportunistic renames.** `brand.ts` and `render.ts` exist twice;
  five modules have "template" in the name without distinguishing which owns the
  brand template language, which owns built-in A4 reports, and which is generated.
  Free while files are moving, expensive later. Not a gate.

## G1 — page layout is configuration (Goal 1)

The reason the rest of this document exists. Changes output on purpose: a new
template family. `default-report` must stay byte-identical throughout — that is
what P0 is for.

- [ ] **G1.1 Extend the template schema with page geometry.** Margins, column
  count, gutter, reserved bands, block frames. `kind: 'page'` already compiles
  (`template-source.ts:114`); it needs fields and a renderer. Reject frames
  outside the page, as `docs/multi-column-pdf.md` recommends.
- [ ] **G1.2 Move the prototype algorithm into the engine.**
  `prototype-multicolumn.mjs` has `breakParagraph(tokens, start, measure)` and
  `columnBoxes(spec)` in 783 working lines. `wrapStyledRuns` already takes a width,
  so the wrap engine needs no change.
- [ ] **G1.3 Let the A4 renderer read templates.** `templates.ts` does not import
  `template-source.ts` at all. This is the wiring that makes geometry
  configuration rather than code, and it depends on G6.3.
- [ ] **G1.4 Keep the typographic decisions explicit.** `justify` versus
  `ragged-right` named, Polish hyphenation opt-in per template or block. The
  research measured a 1.617× space-stretch p95 and a four-line hyphenation run:
  design decisions, not hidden defaults.
- [ ] **G1.5 Do not touch `default-report`.** A new family, per the recommendation
  in `docs/multi-column-pdf.md`: *"do not add editorial columns to
  `default-report` implicitly."* Parity proves this.
- [ ] **G1.6 Wire the gate.** `goals:config-reach` — every declared geometry field
  mutates the output when mutated; zero dead fields. Column containment, gutter
  clearance, line overflow and extreme stretch belong in `visual-qa.mjs` as
  property checks, not in the parity hash.

## G5 — declare the manifest contract (Goal 5)

- [x] **G5.1 Give `manifest.json` an executable schema.** A zod schema plus a test
  that validates a rendered manifest against it and fails on drift — not a prose
  description of the fields. Six consumers today, no schema, no version field, no
  test; two of them run no renderer at all. **A documentation-only version of this
  item does not close it**, because it would protect nothing. Implemented in
  `server/src/manifest.ts` and `server/scripts/test-manifest-contract.mjs` —
  `d734435`.
- [x] **G5.2 Record which fields `visual-qa.mjs` depends on.** Today
  `slidePlans`, `slotBoxes`, `slideThemes`. `CLAUDE.md` says the manifest "must
  stay verbose" without saying which parts, which makes it impossible to change
  safely. The dependency inventory is recorded below — `d734435`.
- [x] **G5.3 Put the two manifest-only consumers in the test matrix.**
  `audit-brand-showcase.js` and `inspect-brand-showcase.js` run against a recorded
  manifest tree. `npm run test:manifest-consumers` records a showcase tree, then
  runs both consumers as separate gates against it — `d734435`.

### G5 manifest fields used by visual QA

`server/scripts/visual-qa.mjs` treats these manifest fields as its public input:

| Field | Use in the QA gates |
| --- | --- |
| `theme` | Fallback theme and report-level typography, color, image and header decisions |
| `slideThemes[]` | Per-slide color, typography and full-bleed image decisions |
| `slidePlans[].slotBoxes` | Canvas containment, region overlap, slot clearance and lockup geometry |
| `slidePlans[].titleConstraints` / `subtitleConstraints` | Declared line limits for title overflow checks |
| `slideLayout[]` | Number of rendered title and subtitle lines |
| `diagnostics.warnings` | Resolver warnings reported by the artifact gate |

## Decision log

Kept because it is the most useful part of this document: every entry is a claim
that turned out wrong, and the record stops it being re-derived later.

| Date | What changed | Why |
| --- | --- | --- |
| 2026-08-21 | Seven sequential phases replaced by six goals | The plan measured safety, not ease of change. A third of its 35 metrics had an identifiable person who felt them; the rest were proxies |
| 2026-08-21 | Multi-column layout became a first-class goal (G1) | It had no phase at all, and could not have one: every refactor phase was bound by byte-identical output. The old task 5.5 named it as the only justification for splitting `templates.ts`, then defaulted to *no* |
| 2026-08-21 | Findability interview dropped | Level 4 — measured by human judgement, therefore not usable by an agent doing the work |
| 2026-08-21 | ~20 structural metrics dropped, recorded in METRICS.md | Proxies with no identifiable person who feels them. Kept only where a gate needs them |
| 2026-08-21 | Bundle merge dropped; lint and test-architecture programmes dropped; housekeeping deferred | None served a goal. Goal 4 solves the same duplication as the bundle merge, more cheaply |
| 2026-08-21 | Gate levels introduced; grep-based metrics demoted to reports | A gate an agent can satisfy without reaching the goal is worse than no gate. Goal 3 has no gate for exactly this reason |
| 2026-08-21 | Config-reach chosen as the Goal 1 gate | Demonstrated: mutating `margin` moved the PDF hash, mutating a slide-only field did not. Behavioural, deterministic, not gameable |
| 2026-08-21 | Corrected: the six-module import cycle is type-only | Separating the type and runtime graphs showed the runtime graph is acyclic and five `import type` edges carry three declarations. The earlier claim that an extracted module "cannot compile alone" was withdrawn; the fix is a declaration move, not dependency inversion |
| 2026-08-21 | Corrected: three entry points, not two | The brand CLI imports `runExampleCli` and has its own mutation contract with 26 write call sites. 13 of 19 modules are shared by all three fronts; the Render CLI has none of its own |
| 2026-08-21 | Corrected: duplication is 5 families / 12 instances, not "6 duplicates" | A single figure made the delta unreadable. Report-model validation removed from the table — it is a coverage gap, not duplication |
| 2026-08-21 | Corrected: raw PPTX bytes are not a parity invariant | Measuring raw `sha256` reported all four PPTX files as nondeterministic; the cause was zip-header timestamps. `pptxContentHash` shows zero differences |
| 2026-08-21 | Corrected: "the CLI does not validate at all" was too broad | `renderDeckData` → `resolveSlideDeck` → `validateSlideDeck` does validate decks. `renderReportData` validates nothing. The gap is per-path |
| 2026-08-21 | Corrected: the dev bundles do have consumers | Three local scripts run them. The accurate claim is that nothing *downloads* them |
| 2026-08-21 | Goal 1 relabelled a **product feature**, and outcomes split into quality and product columns | Fifth review round: multi-column A4 is a functional change. Without the split, finishing G1 lets someone claim the quality programme succeeded when the main effect was a new feature |
| 2026-08-21 | G6.1 split across two owners: `Slide` → `contract/`, `RenderTheme` and `ResolvedSlidePlan` → `core/model/` | Fifth review round: putting all three in `contract/` mixes an input contract with internal renderer models and makes `contract/` a bag for shared types. Verified: `Slide` is in a zod `discriminatedUnion`; `ResolvedSlidePlan` has zero occurrences in the adapter; `RenderTheme` appears only as an import and a helper parameter type |
| 2026-08-21 | P0.1 given sole ownership of the shared script module; G4 depends on P0.1, not all of P0 | Fifth review round found a contradiction I had noticed but not fixed: P0.1 and G4.1 described the same extraction, while the dependency table called G4 independent |
| 2026-08-21 | G4 gate rewritten per mechanism | Fifth review round: "≥1 shared module" is satisfiable with a trivial `shared.ts`. The gate now asserts `findOfficeConverter` 1, fixture builders 1, showcase iterations 1, process runners 1, identical bodies 0 |
| 2026-08-21 | G5 requires an executable schema, not a declared shape | Fifth review round: "6 of 6 consumers have a declared shape" could be closed by writing documentation, protecting nothing |
| 2026-08-21 | Six structural indicators restored as non-gating, with no targets | Fifth review round: G4 and G6 can both pass while the largest module grows and a directory layer is added — the goals cannot see a problem being relocated. Deliberately narrower than the metrics dropped earlier: no targets, no gates, unfavourable delta requires a logged reason |
| 2026-08-21 | G2.2 gained explicit schema ownership: schemas move to `contract/`, MCP and CLI both import from there | Sixth review round: the task said "make the CLI use the same contract" without saying where it lives, and the obvious implementation would be `example.ts → tools/render.ts` — the CLI depending on MCP registration. Verified that edge does not exist today |
| 2026-08-21 | Dependency graph and edit order named as two separate things | Sixth review round: the document claimed independence in one place and a single track in another. The first is a correctness condition, the second a file-conflict recommendation that blocks nothing |
| 2026-08-21 | Removed "a module assigned to no layer" from the G6.4 checker; added two directional rules that stand on their own | Sixth review round: the rule needs a full module-to-layer map, and the layer pyramid was cut with old Phase 3a. Only `contract/` and `core/model/` exist here. A checker demanding layers would force assignments to be invented to make a build pass |
| 2026-08-21 | Deferred launcher work carries an explicit "do not merge" note | Fifth review round: the two launchers implement different installation contracts. Only a low-level primitive is shareable |
| 2026-08-21 | Removed the word "oracle" throughout | Not a term used in any programming methodology. Replaced with "parity check" and "baseline". Missed `ROADMAP.md` on the first pass — two occurrences, since fixed |
