# Output parity baseline

Parity is the precondition for every goal, and a goal only in the sense that
reproducibility is one. It answers one question: *did this change alter what the
renderer emits?* It never answers whether the change was worth making.

## Equality, not similarity

The renderer is deterministic today — measured, not assumed. So the gate demands
equality. "99.999% the same" would be a weaker guarantee than the one available.

Any hash change is a finding: either a bug, or an intended change that needs an
enumerated list, a re-recorded baseline and a CHANGELOG entry. Never a shrug.

## Normalisation, per format

| Format | Hash over | Why |
| --- | --- | --- |
| PDF | SHA-256 after removing `/CreationDate`, `/ModDate`, `/ID` | the only nondeterministic bytes jsPDF writes |
| PNG | raw bytes | already deterministic |
| PPTX | entry-wise, timestamp-stripped (`pptxContentHash`) | **raw bytes are not stable** |

The PPTX line was paid for. Measuring raw `sha256` on four PPTX files reported all
four as nondeterministic; the cause was zip-header timestamps, not the renderer.
Recomputed with `pptxContentHash`: zero differences. A plain digest on a PPTX
reports a bug that does not exist.

## Corpora

| Tier | Scope | Where | Provenance |
| --- | --- | --- | --- |
| A | 4 showcase brands → 12 PDF, 4 PPTX, 21 PNG, ~25 s | committed, `examples/brand-showcase/` | reproducible by anyone |
| B | 5 editorial reports | `$REPORT_BABY_DATA/regression/`, never in git | machine-local |

**Tier B goldens must never be committed.** The fixture tree and the editorial
handoff notes are gitignored because they contain customer draft copy, and both
remotes are public. No customer brand name and no case name belongs in these
files either.

Tier B replay, reproducible bit-for-bit from `a987030`:

```bash
node scripts/render-example.js --kind report \
  --brand-root ~/.report-baby/brands --brand "brand://<external>/editorial" \
  --input fixtures/<...>/cases/<case>.json --out DIR --formats pdf
```

## What parity does not cover

Stated so a green run is never mistaken for full coverage.

| Not covered | Owned by |
| --- | --- |
| CLI argv, exit codes, stdout/stderr | Goal 2 gate |
| The brandbook tree `brand init` writes (26 write call sites) | Goal 2 work item |
| `manifest.json` shape — six consumers, two of which run no renderer | Goal 5 work item |
| Both MCP launchers, and installation generally | deferred; trigger in README |
| MCP tool schemas | Goal 2 work item |
| LibreOffice PPTX round-trip | never a parity gate — converter-version dependent by construction. Stays a property check in `visual-qa.mjs`. Note the PPTX *parity* hash involves no converter |
| Anything outside the corpus | corpus extension, deferred |

## Building the harness

The primitives already exist in `server/scripts/visual-qa.mjs` (77 KB, 13 gates,
no npm entry): `pdfContentHash`, `pptxContentHash`, `zipEntries`,
`stripTimestamps`, `decodePng`, `pixelDiff`, `rasterisePdf`, `findOfficeConverter`.
The work is extraction into a shared module, not authorship — which is also the
first payment on Goal 4.

Two commands, category **C**:

```bash
npm run baseline:record   # writes per-artifact hashes for a tier
npm run baseline:verify   # recomputes and diffs; exit 1 on any difference
```

Keep it to that. A parity harness that grows a configuration surface has become
the project instead of protecting it.

## When the baseline legitimately changes

Goals 1 and 2 both change output on purpose. The procedure, in order:

1. **Before writing code**, enumerate what will change and why: which cases,
   which artifacts, what the new behaviour is.
2. Make the change. Run `baseline:verify` and confirm the diff matches the
   enumeration exactly. **An unexpected extra difference stops the work** — it is
   not re-baselined, it is investigated.
3. Re-record, commit the new hashes with the enumeration in the message, add a
   CHANGELOG entry.
4. Add a decision-log entry in [WORK.md](WORK.md).

The rule that protects this: **a fixture is never edited to make a gate pass.**
Either the input was invalid and the renderer was tolerating it — a documented fix
— or the new rule is wrong. Adjusting inputs until they go green removes the only
protection the work has.
