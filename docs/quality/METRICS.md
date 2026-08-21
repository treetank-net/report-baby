# Measured numbers and the tools that reproduce them

Everything here was measured at commit `a987030` (2026-08-21) with the command
shown. Numbers only — the reasoning lives in [README.md](README.md).

Provenance: **A** reproducible from a clean checkout; **B** machine-local, needs
the gitignored fixture tree; **C** planned, does not exist yet.

## Gates

The complete list. Each answers with an exit code; none requires a judgement.

| Gate | Command | Level | Required |
| --- | --- | --- | --- |
| Rendered-artifact parity | `npm run baseline:verify` | 1 | zero differences |
| Declared geometry fields reach the output | `npm run goals -- --check` | 1 | every declared field mutates the output; zero dead fields |
| Bad input names its field, both paths | `npm run goals -- --check` | 1 | 100% name the field; zero crash-shaped messages; exit ≠ 0 always |
| Scripts share code, per mechanism | `npm run goals -- --check` | 2 | `findOfficeConverter` 1 · fixture builders 1 · showcase iterations 1 · process runners 1 · identical normalised bodies 0. Shared-module count is a supporting number, **not** the gate |
| No runtime import cycle | `npm run arch:check` | 2 | 0 — always |
| No TypeScript import cycle | `npm run arch:check` | 2 | 0, from G6.1 |
| No forbidden import, no `process.env` in core | `npm run arch:check` | 2 | 0, from G6.1 and G6.2 respectively |

All of these are category **C**. The numbers below are what they must reproduce.

### Tool contract

```bash
npm run goals              # table: metric | baseline | measured | delta | gate
npm run goals -- --check   # exit 1 if any gate regressed
npm run goals -- --json    # one JSON file, sorted keys, no timestamps, no absolute paths
```

Three properties make this usable by an agent without supervision: the baseline
lives in the repository and is version-controlled; the only verdict is the exit
code; and no metric is evaluated by a model. Same tree in, same bytes out.

## Goal 1 — page layout is configuration, not code

### The blocking code, exactly

| Fact | Location |
| --- | --- |
| Single-column constant | `server/src/templates.ts:81` — `const CONTENT_W = PAGE_W - MARGIN * 2` |
| Call sites passing it to the wrap engine | `templates.ts:364, 463, 467` (plus `615` with `bulletWidth`) |
| Functions carrying a sequential cursor | 10, signature `(doc, cur \| y)` |
| A4 renderer's use of the template language | **none** — `templates.ts` does not import `template-source.ts` |

### What already exists and is not wired up

| Asset | State |
| --- | --- |
| `wrapStyledRuns(doc, runs, width, ctx)` | `text-runs.ts:229` — width is already a parameter. **No change needed** |
| `kind: 'page'` | `template-source.ts:114` — accepted by the compiler. **Nothing renders it** |
| `archetype: 'columns'` | `template-source.ts:147` — accepted |
| Column algorithm | `server/scripts/prototype-multicolumn.mjs`, 783 lines: `breakParagraph(tokens, start, measure)`, `columnBoxes(spec)` with gutter, "page grid minus reserved bands → ordered segments" |
| Research and recommended contract | `docs/multi-column-pdf.md` — complete, with measured stretch and hyphenation tails |
| Consumers of `CompiledTemplate` | `brand.ts`, `slide-context.ts`, `slide-plan.ts`, `slides.ts` — **slides only** |

The asymmetry in one line: **slides keep layout in configuration, A4 reports keep
layout in code.** `columns_*` keys do exist in `render-config.yml`, but they are
slide geometry.

### The config-reach measurement, demonstrated

```bash
cp -r server/templates /tmp/t && sed -i 's/^\(\s*\)margin: .*/\1margin: 96/' /tmp/t/render-config.yml
REPORT_BABY_TEMPLATE_DIR=/tmp/t node scripts/render-example.js --kind report \
  --brand-root examples/brand-showcase/brands --brand brand://orbit/primary \
  --input CASE.json --out /tmp/out --formats pdf
```

| Mutation | Normalised PDF hash | Reading |
| --- | --- | --- |
| none (baseline) | `1f76c8c8e44ba245` | — |
| `margin: 96` | `b7ab31155e46f3ff` | reaches the output |
| `columns_fallback_x_gap: 200` | `1f76c8c8e44ba245` | does **not** reach the report — slide-only field |

Provenance A. This is the pattern for the whole gate: a declared field that does
not move the output is either dead or not wired, and both are failures.

### Brand-side knobs, for scale

| Metric | Value |
| --- | --- |
| Files in one brand profile directory | 10 |
| Distinct keys across profile YAML | 60 |
| Files to touch to change an accent colour | **1** (`profiles/primary.yml`) — already good |
| A "show me what this change does" affordance in `brand-tool` | none |

## Goal 2 — bad input says what to fix

Same input to both paths: `kpis` as an object instead of an array, and `name`
instead of `label` in chart data.

**MCP** — exemplary:

```
path: ["data","kpis"]                        Expected array, received object
path: ["data","charts",0,"data",0,"label"]    Required
```

Both errors at once, each with a field path.

**CLI** — same input:

```
j.forEach is not a function
```

Exit 1, zero artifacts written, one error, no field, no path — `j` is a minified
identifier.

**For contrast, a mistyped brand ref** — also the CLI:

```
Brand document not found. Tried:
  …/brands/orbit/profiles/typo.yaml
  …/brands/orbit/profiles/typo.json
```

| Metric | Value |
| --- | --- |
| Validators for the deck model | 2 (zod in `tools/render.ts`; hand-written via `slide-context.ts:108`) |
| Validators for the report model | 1, bypassed by `example.ts` → `renderReportPdf` |
| zod declarations in the report schema | 110 |

Provenance A for all of the above.

## Goal 3 — adding a thing costs fewer files (reported, not gated)

| Change | Files mentioning it |
| --- | --- |
| One report field (`highlights`) | **9** — `tools/render.ts`, `templates.ts`, `slides.ts`, `slide-context.ts`, `brand-tool.ts`, `render-config.yml`, `generated/builtin-templates.ts`, SKILL, `CLAUDE.md` |
| One chart type (`pie`) | 4 — `svg.ts`, `tools/render.ts`, `slide-context.ts`, SKILL |

```bash
grep -rln "highlights" server/src/ server/templates/ skills/ CLAUDE.md
```

Level 3. Reported every run, never a gate.

## Goal 4 — standalone scripts share code

| Metric | Value |
| --- | --- |
| Tracked standalone scripts | 14 |
| Total lines | 3 729 |
| Modules imported by two or more scripts | **0** |
| `lib/` directory | does not exist |
| Scripts with their own `spawn` | 9 |
| Scripts with their own showcase iteration | 7 |
| Copies of `findOfficeConverter` | 2 — `inspect-brand-showcase.js` (16 lines), `visual-qa.mjs` (21 lines): **already diverged** |
| Duplicated function names | 6 — `run` ×4, `walk`, `outputPath`, `main`, `fail`, `findOfficeConverter` ×2 |
| Independent fixture builders | 3 |

```bash
grep -hoP "from '\.\K[^']+" scripts/*.js server/scripts/*.mjs | sort | uniq -c
grep -ohP "^(async )?function \K\w+" scripts/*.js server/scripts/*.mjs | sort | uniq -c | awk '$1>1'
```

The gate uses normalised-function-body hashing, not name matching, so renaming a
copy does not satisfy it.

## Goal 5 — the result is reproducible

| Corpus | Scope | Result | Provenance |
| --- | --- | --- | --- |
| In-repo brand showcase | 4 brands, 12 PDF, 4 PPTX, 21 PNG, ~25 s | PDF hashes identical, PNG byte-identical, PPTX content hashes identical across two runs | A |
| External editorial corpus | 5 reports | normalised PDF hashes identical to references rendered days earlier | B |

Normalisation is per format and not optional — see [BASELINE.md](BASELINE.md).

### The undeclared contract

`manifest.json` has **six** consumers and no schema, no version field, no test:

| Consumer | Role |
| --- | --- |
| `server/src/example.ts` | writes it |
| `server/src/brand-tool.ts` | reads it back after `preview` |
| `server/scripts/visual-qa.mjs` | reads `slidePlans`, `slotBoxes`, `slideThemes` for 13 gates |
| `scripts/audit-brand-showcase.js` | **runs no bundle** — the manifest is the product |
| `scripts/inspect-brand-showcase.js` | **runs no bundle** |
| `scripts/test-brand-contract.js` | brand contract assertions |

Two consumers execute no renderer, so a change can be byte-perfect on every PDF
and still break them.

### Entry points, for the same reason

Three application entry points over one module graph, not two:

| Entry point | Source | Bundle | Write call sites |
| --- | --- | --- | --- |
| MCP server | `index.ts` | `bundle.cjs` | **0** |
| Render CLI | `example.ts` | `example-bundle.cjs` | 11 |
| Brand CLI | `brand-tool.ts` | `brand-tool-bundle.cjs` | **26** |

| Metric | Value |
| --- | --- |
| Modules shared by all three | **13 of 19** |
| Modules reachable only from the Render CLI | **0** |
| Containment | `Render CLI ⊂ Brand CLI`, `Render CLI ⊂ MCP` |
| Tracked MCP launchers | 2, **not copies** — 50 lines (checkout-relative) and 68 lines (`$REPORT_BABY_DATA` install) |

Consequence for Goal 1: every module move touches all three fronts at once.
`--kind deck` is a supported Render CLI surface that **no tracked script
invokes** — the most likely thing to break silently.

## Goal 6 — a module can be lifted out

### Graph definition, stated before the numbers

| Question | Answer |
| --- | --- |
| Files | `server/src/**/*.ts`, excluding `*.d.ts` |
| Generated modules | included |
| Tests and dev scripts | excluded — they import bundles, not sources, so there is no edge to draw |
| `import type` edges | counted, and reported separately |
| External packages | excluded |

### Measured

| Metric | TypeScript graph | Runtime graph |
| --- | --- | --- |
| Components with more than one module | **1** | **0** |
| Modules in it | 6 of 23 | — |
| Direct two-module cycles | 1 (`slide-plan.ts ↔ slides.ts`) | 0 |

The component: `brand.ts`, `render.ts`, `slide-plan.ts`, `slide-templates.ts`,
`slides.ts`, `svg.ts`.

**The cycle is entirely type-only.** Five `import type` edges carry it, and they
carry exactly three declarations:

| Edge | Imports |
| --- | --- |
| `slide-plan.ts → brand.ts` | `RenderTheme` |
| `slide-plan.ts → slides.ts` | `Slide` |
| `slide-templates.ts → slides.ts` | `Slide` |
| `slides.ts → slide-plan.ts` | `ResolvedSlidePlan` |
| `svg.ts → brand.ts` | `RenderTheme` |

Moving `RenderTheme`, `Slide` and `ResolvedSlidePlan` into a contract module takes
the TypeScript graph to zero components. That is a declaration move, not a
dependency inversion.

### Environment access

| Metric | Value |
| --- | --- |
| Direct `process.env` reads outside `config.ts` | 3 — `tools/auth.ts` (`CLAUDE_PLUGIN_ROOT`), `builtin-template-loader.ts` ×2 |
| Core modules reaching config through a global | 1 — `brand.ts:289` → `getBrandSourceRoots()` |

The indirect one matters most: the asset allow-list is a security boundary, and
reading it from ambient state is why `test-brand-contract.js` must spawn a process
with a modified environment to test it.

### Duplicated mechanisms

Reported as two numbers, because collapsing a family and deleting one are
different achievements.

- **families: 5** · **instances: 12**

| Family | Instances |
| --- | --- |
| Deck-model validation | 2 |
| Diagnostics serialisation | 2 |
| argv parsing | 2 |
| Fixture construction | 3 |
| Build artifacts from one source tree | 3 |

Report-model validation is **not** in this table: it has one validator that one
caller bypasses, which is a coverage gap (Goal 2), not duplication.

## Non-gating structural indicators

Reported every run, gate nothing, carry no target. They exist for one failure mode
the six goals cannot see: **passing G4 and G6 by moving the problem rather than
solving it** — collapsing script duplication while the largest module grows, or
adding a directory layer and a longer function on the way to zero import cycles.

Rules, and they are the whole point of keeping this short list:

- No target value. A number moving the wrong way is not a failure.
- An unfavourable delta requires an entry in the decision log with the reason.
- None of them may be cited as evidence a goal was met.

| Indicator | `a987030` |
| --- | --- |
| Largest module | `slides.ts` 91.5 KB |
| Modules > 25 KB · > 50 KB | 3 · 1 |
| Longest function | `renderSlidesPptx` 202 lines |
| Tree depth p95 / max | 3 / 3 |
| Name collisions — duplicate basenames · modules named "template" | 2 · 5 |
| Fan-in / fan-out hotspots | `brand.ts` 11 in · `tools/render.ts` 9 out |
| Numeric literals outside YAML, by category | see below |

```bash
find server/src -name "*.ts" -printf "%s %p\n" | sort -rn | head -5
find server/src -name "*.ts" -printf "%f\n" | sort | uniq -d
```

**Magic constants must be categorised before they are tracked.** The crude total
is 182, and it is unusable: 67 of those sit in `brand-tool.ts` and are mostly SVG
path coordinates in the starter logo — content, not configuration. Moving that
content into files would drop the total by a third for reasons unrelated to code
quality. Track only *geometry*, *threshold*, *timeout* and *limit*; ignore
*content coordinate* and *unrelated*. Until the split exists, the number is not
reported at all.

Two indicators were considered and left out. **Generic module names** would be a
flat zero — there is exactly one (`index.ts`), and no `utils.ts`, `helpers.ts` or
`manager.ts` anywhere. **Max brace nesting** (8, in `slides.ts`) duplicates what
longest-function already says about the same file.

## Excluded metrics

Not indicators, not gates — measured once and dropped, recorded so nobody re-adds
them as an improvement.

| Metric | Value at `a987030` | Why excluded |
| --- | --- | --- |
| Generic module names | 1 (`index.ts`) | Would be a flat zero. No `utils.ts`, `helpers.ts`, `manager.ts` anywhere |
| Max brace nesting | 8 (`slides.ts`) | Says the same thing as longest-function about the same module |
| Numeric literal total, uncategorised | 182 | Dominated by 67 SVG path coordinates in starter content. Only the categorised version is reportable |
| Findability interview | not run | Level 4 — measured by human judgement, so unusable by an agent doing the work |
