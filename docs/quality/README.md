# Refactoring goals

Six goals, each with a number that says whether it was reached and a command that
measures it. Nothing here is organised by technique — no "housekeeping phase", no
"contract phase". The work is named after the effect it produces.

Four files, and that is the whole plan:

| File | Holds |
| --- | --- |
| `README.md` | the six goals, the gates, what was cut and why |
| [METRICS.md](METRICS.md) | every measured number, and the tool that reproduces it |
| [BASELINE.md](BASELINE.md) | output parity: corpora, per-format normalisation, change procedure |
| [WORK.md](WORK.md) | the work items, each attached to a goal, plus the decision log |

## Why this replaced a seven-phase plan

The earlier version had seven sequential phases and about 35 metrics. Four rounds
of review, and one question, dismantled it: *does this measure whether the code
got easier to change, or only whether it stayed safe?* It measured safety. Of the
35 metrics, roughly a third had an identifiable person who would feel them; the
rest were proxies for proxies.

Worse, the concrete thing this repository needs — a configurable multi-column A4
layout — had no phase at all. It could not: every refactor phase was bound by
byte-identical output, and adding a layout family changes output by definition.
The plan had a slot for "split `templates.ts`" whose default answer was *no*,
citing multi-column work as the only thing that would justify it.

So the phases are gone. What survives is parity — as a gate, not as the point.

## Two kinds of goal, reported separately

Five of the six goals improve the code. One adds a feature. Keeping them in one
work programme is fine — they share the same parity gate and the same measured
baseline — but **the outcome must be reported in two columns, never one**:

| Quality outcome | Product outcome |
| --- | --- |
| fewer duplicated mechanisms | multi-column A4 layout (`kind: page`) |
| one shared script layer | |
| no forbidden dependencies | |
| a configuration seam that actually reaches the output | |
| rejections that name the offending field | |

Without that split, finishing Goal 1 lets someone say "the quality programme met
its goal" when the main effect was a new feature. Goal 1 is labelled **product
feature** below and is excluded from any claim about code quality — it is the
*beneficiary* of the seam that Goal 6 and the configuration work create, and the
proof that the seam is real, but it is not itself evidence that the code got
better.

## The six goals

Each goal states the felt effect first, then the number.

### Goal 1 — page layout is configuration, not code · **product feature**

A two-column A4 layout, with column widths I choose, should be a file I edit —
not a change inside the render engine.

| Metric | Today | Target |
| --- | --- | --- |
| TypeScript files to touch to change page geometry — slide | 0 | 0 |
| TypeScript files to touch to change page geometry — A4 report | 1–3 | **0** |
| `kind: page` templates that render | 1 built-in family | all declared |
| Column count / gutter / measure reachable from a template file | yes | yes |

Measured by `goals:config-reach`, which mutates a value in a copy of
`templates/`, renders the corpus and compares hashes. The gate currently checks
eight page-geometry mutations, while the page-layout visual QA gate checks column
containment and line quality. See [METRICS.md](METRICS.md#goal-1).

### Goal 2 — bad input says what to fix

The same mistake should produce the same actionable message whether it arrives
over MCP or the CLI.

| Metric | Today | Target |
| --- | --- | --- |
| Rejection names the offending field — MCP | yes | yes |
| Rejection names the offending field — CLI | **no** | yes |
| Messages matching `is not a function` / `Cannot read propert` | ≥1 | **0** |
| Input paths that validate the report model | 1 of 2 | 2 of 2 |

Today, the same bad JSON gives MCP users `path: ["data","charts",0,"data",0,"label"] Required`
and CLI users `j.forEach is not a function`. The repository already knows how to
write a good message — a mistyped brand ref prints both paths it tried. It just
does not do it on the data path.

### Goal 3 — adding a thing costs fewer files

| Metric | Today | Target |
| --- | --- | --- |
| Files mentioning one report field (`highlights`) | **9** | ≤4 |
| Files mentioning one chart type (`pie`) | 4 | ≤2 |

**No gate on this goal.** It is measured by grep, and grep can be satisfied by
moving mentions around rather than by reducing coupling. It is a reported number,
never a pass criterion. If it needs to gate, it has to become behavioural — at
which point it is Goal 1.

### Goal 4 — standalone scripts share code

The gate is **per mechanism**, not "a shared module exists". A single trivial
`shared.ts` imported twice would satisfy a count and change nothing, so the count
is a supporting number only.

| Mechanism | Today | Target | Gate? |
| --- | --- | --- | --- |
| `findOfficeConverter` implementations | 2, **already diverged** (16 and 21 lines) | 1 | **yes** |
| Fixture builders | 3 | 1 | **yes** |
| Showcase iterations | 7 | 1 | **yes** |
| Process runners (`spawn` wrappers) | 9 | 1 shared primitive | **yes** |
| Identical normalised function bodies across files | >0 | 0 | **yes** |
| Modules imported by two or more scripts | 0 | ≥1 | supporting number |

14 scripts, 3 729 lines, no `lib/` directory, nothing shared.

### Goal 5 — the result is reproducible

| Metric | Today | Target |
| --- | --- | --- |
| Rendered-artifact parity across a rebuild | equal, measured | **gate: equal** |
| `manifest.json` validated against a schema at test time | no | **yes — an executable schema, not a document** |
| Consumers exercised against a recorded manifest tree | 0 of 6 | 6 of 6 |

"Declared shape" must mean a zod schema and a test that fails when the manifest
drifts. A prose description of the fields would let this goal be closed by
writing documentation, which protects nothing.

Parity is the precondition for every other goal, not a goal in its own right:
without it, "the new `kind: page` family works" cannot be distinguished from
"I broke `default-report`". Details in [BASELINE.md](BASELINE.md).

### Goal 6 — a module can be lifted out

| Metric | Today | Target |
| --- | --- | --- |
| Import cycles, runtime graph | 0 | **gate: 0** |
| Import cycles, TypeScript graph | 1 component, 6 modules | 0 |
| Forbidden imports — `contract/` importing a local module, `core/model/` importing an adapter | n/a — those directories do not exist yet | **gate: 0 from G6.1** |
| `process.env` reads outside the config seam | 3 direct + 1 indirect | 0 in core |

**This goal is explicitly a means, not an end.** It exists because Goals 1 and 3
are blocked without it, and it is written down so nobody chases `SCC = 0` as an
achievement. If it stops serving Goals 1 and 3, it stops.

## Gates

A gate is a metric an agent cannot satisfy without actually reaching the goal.
Only two kinds qualify:

| Level | Kind | Gameable? | Role |
| --- | --- | --- | --- |
| 1 | behavioural — mutate the input, compare the output | no | gate |
| 2 | structural, executable — import graph, AST | hard | gate |
| 3 | textual — grep, file counts | yes | report only |
| 4 | human judgement | n/a | **excluded** |

Level 3 splits in two. Some level-3 numbers are *reported per goal* (Goal 3's file
counts); others are *non-gating structural indicators* that belong to no goal and
exist only to catch a problem being relocated rather than fixed. Neither can close
a goal. See [METRICS.md](METRICS.md#non-gating-structural-indicators).

Level 4 is excluded from the tool set entirely. A metric measured by asking a
model is not a metric; an agent that asks whether it is "going in the right
direction" is taking instructions from its own output.

The full gate list, with the command for each, is in
[METRICS.md](METRICS.md#gates). Every one of them answers with an exit code.

## What was cut

Removed, because nothing in the six goals needs it:

| Cut | Was | Why it went |
| --- | --- | --- |
| Bundle merge into one entrypoint | Phase 3b | Goal 4 solves the same duplication more cheaply. Three artifacts from one source tree is an ordinary shape |
| Repository-wide formatter and lint | Phase 6 | Serves no goal. Long lines get broken in files that are being edited anyway |
| Findability interview | a metric in the old plan | Level 4. Not measurable by the agent doing the work |
| ~20 structural metrics as goals or targets | module sizes, fan-in/fan-out, tree depth, function lengths, nesting, generic names, magic-literal totals | Proxies with no identifiable person who feels them. **Six of them came back as non-gating indicators** — no target, no gate, but an unfavourable move needs a logged reason. They catch the one thing the goals cannot see: moving a problem instead of solving it |
| Test-architecture programme | Phase 4 | Tests get written where a gate needs one. `node:test` adoption is not a goal |

Deferred — plausible, currently unnecessary, revisit only on a stated trigger:

| Deferred | Trigger to revive |
| --- | --- |
| Untracking the two dev bundles, CI verify stage, single-sourced version | A clone or CI run becomes painful enough to name. `.git` is 124 MB; that is a cost, not a blocker |
| Structural PDF diff, raster comparison tier | The first parity failure whose cause a hash cannot explain |
| Corpus extension beyond today's cases | A goal's gate needs a case the corpus lacks |
| Launcher install-path checks | Goal 1 or 5 work touches how a bundle is located. When it happens: **do not merge the two launchers.** They implement different installation contracts — one resolves against the checkout, one against `$REPORT_BABY_DATA` for a plugin install. Only a low-level primitive is shareable, such as an atomic download; the bootstraps stay separate |
| Splitting `templates.ts` by section | Only if Goal 1 turns out to need it. Goal 1 needs the *geometry* separated from the *flow*, which is not the same as one module per section |

Anything on those lists that gets revived goes into [WORK.md](WORK.md) first, with
the trigger that fired.

## Working rules

1. **Every work item names its goal.** An item that serves no goal does not get
   done; it goes on the deferred list with a trigger.
2. **Gates run per commit, not per milestone.** `npm run goals -- --check` and
   `npm run baseline:verify`.
3. **A fixture is never edited to make a gate pass.** Either the input was
   invalid and the renderer was tolerating it — a documented fix — or the new
   rule is wrong.
4. **Output changes are declared before they happen.** Goal 1 and Goal 2 both
   change behaviour. Each needs an enumerated list of what changes and a release
   note. Silent output change is the one unrecoverable failure here.
5. **When the plan and reality disagree, the plan is wrong.** Fix it in the same
   commit, and add a decision-log entry in [WORK.md](WORK.md).
