# Handoff: stop A4 reports from ending on a near-empty page

Status at hand-off: **0.8.2 is released and pushed.** Widow and orphan control
landed for body copy and for the highlights list. Two blocks still produce a
page that carries almost nothing, and there is no gate that fails when one
appears. That is the work described here.

Work in this order. Steps 1 and 2 are independent; step 3 depends on both.

## What is already done (do not redo it)

`server/src/templates.ts`:

- `splitWithoutWidows(lines, available)` picks where a paragraph breaks. It
  refuses a break that would leave fewer than `pdf.orphan_min_lines` inked lines
  behind, carry fewer than `pdf.widow_min_lines` inked lines forward, or open a
  page on a blank separator line. Returning `0` means "move the whole remainder".
- `renderHighlights` lays out every bullet first, then paginates the list as a
  block: `bulletsLeftBehind()` counts what would be stranded, and a bullet is
  pushed to the next page when fewer than `pdf.widow_min_bullets` would follow
  it there. `pageIsFresh` guards against looping on a list too long for one page.
- Config keys live in `server/templates/render-config.yml` under `pdf:`
  (`widow_min_lines: 2`, `orphan_min_lines: 2`, `widow_min_bullets: 2`). New keys
  under `pdf:` map to camelCase automatically — `builtin-template-loader.ts` uses
  `pdf: camelDictionary('pdf')`, so you only add the YAML key and read
  `PDF_CONFIG.yourNewKey`.

## Step 1 — table rows get no widow control

**The defect.** `renderTable` hands the whole table to `jspdf-autotable`, which
splits rows wherever the page ends. In one real report the last page holds a
repeated header plus two body rows and nothing else.

**Reproduce it** (paths are examples; use any input with a long table):

```bash
cd server && npm run build:example
node scripts/render-example.js --kind report \
  --brand-root ~/.report-baby/brands \
  --brand "brand://<brand>/<profile>" \
  --input <input>.json --out /tmp/fit --formats pdf
```

Then count what each page carries. A throwaway script that decompresses the
content streams and counts text baselines per page is enough; the QA harness
already has `pdfContentStreams()` in `server/scripts/visual-qa.mjs` that you can
copy.

**What to build.** Decide *before* drawing whether the table should start on the
current page. `jspdf-autotable` will not tell you its row heights up front, so
measure first:

1. Build the same `tableOptions` you already build.
2. Run the table once against a throwaway `newPdf(...)` instance at the same
   `startY`, collecting per-page row counts from the `didParseCell` /
   `didDrawPage` hooks (`data.pageNumber`, `data.row.index`).
3. If the measurement says the last table page would carry fewer than
   `pdf.table_widow_min_rows` body rows, call `cur.breakPage()` before the real
   `autoTable` call so the whole table starts on a fresh page — but only when the
   table fits on one page at all. A table longer than a page must still split;
   in that case shift the break earlier instead, so the tail page keeps at least
   the minimum.
4. Add `table_widow_min_rows: 3` to `render-config.yml`.

Keep `willDrawPage` as it is — it repaints the page background and the repeated
header chrome, and the measuring pass must not touch the real document.

Do not try to fix this from inside `willDrawCell`: by the time that hook runs the
page has already started, and there is nothing left to move.

## Step 2 — the last page can still be almost empty

**The defect.** Even with correct widow control, a report can end with two lines
or two bullets on a page of their own. That is legal typography and still looks
broken: the previous page has 40 mm of unused space that would have taken them.

**What to build — a second pass that tightens the gaps.** In
`renderReportPdf`:

1. Render as today. Measure the fill of the final page: the lowest drawn
   baseline against the content area. Reuse whatever you write for step 1's
   measurement instead of adding a second mechanism.
2. If the last page is filled below `pdf.min_last_page_fill` (add it as `0.2`),
   render the whole report again with every inter-block gap multiplied by a
   factor — `sectionBottomGap`, `sectionChapterTopGap`, `introBottomGap`,
   `highlightLineGap`, `highlightsBottomGap`, `kpiBottomGap`. Try `0.85`, then
   `0.7`. Never scale `bodyLineHeight`, `bodySize`, or any heading size: leading
   and type size are brand decisions, whitespace between blocks is not.
3. Accept the first attempt whose page count drops. If none does, return the
   original — a tightened report that is still the same length is a pure loss.
4. Report what happened: push a warning through the existing `warnings: string[]`
   parameter of `renderReportPdf` (`renderWarnings` in `tools/render.ts` and
   `example.ts` already carry it into the response and the manifest). Say which
   factor was applied. Silent layout changes are worse than the gap they fix.

The cleanest way to make the gaps scalable is a resolved-config object built once
per render (`const gaps = tightened(PDF_CONFIG, factor)`) that the render
functions read instead of reaching into `PDF_CONFIG` for those specific keys.
Do not mutate `PDF_CONFIG`: it is module-level and shared across renders in the
same process.

## Step 3 — a gate that fails when a near-empty page appears

`server/scripts/visual-qa.mjs`. Nothing currently notices any of this, which is
why it shipped.

Add `gatePageFill(item, rendered, checks)` for `kind === 'report'`:

- Decompress the content streams (`pdfContentStreams`) and, per page, collect
  text baselines and image placements. `pdfTextOnFill()` already parses `cm`
  matrices and `Do` operators — read it before writing your own.
- Skip page 1 when the input has a `title_page` (a cover is meant to be sparse).
- Fail a page whose drawn content — text baselines plus image area — covers less
  than the case's `minPageFill` (default it to a low value such as 0.15 of the
  content area, so it only catches the pathological case).
- A page holding only a chart image is legitimate: count the image area, do not
  require text.

Then add three cases that each force one variant, so the gate has something to
prove: a section whose body ends one line past a page boundary, a highlights
list whose last bullet lands just past it, and a table whose last two rows do.
Build them from `longWords()` like the existing `multipageReport()` fixture, and
assert the expected page count as well as the fill.

**Prove the gate fails before you claim it works.** Comment out
`splitWithoutWidows`'s widow branch, rebuild, run
`node server/scripts/visual-qa.mjs --only <case-id>`, and confirm a FAIL. Then
restore it. A gate that has never gone red is not a gate. Beware:
`npm run build && npm run build:example` stops at the first failure, so a
`tsc` error leaves you measuring a stale bundle — run the two separately and
read their output.

## How to test

**CLI (use this while iterating).** `node scripts/render-example.js` runs
`server/example-bundle.cjs`, built from the same modules as the MCP server, and
needs no restart:

```bash
cd server && npm run build && npm run build:example
```

`npm run build` type-checks and rebuilds `server/bundle.cjs` (the MCP server);
`npm run build:example` rebuilds the CLI bundle. Both must be current before you
report a result.

**MCP.** `.mcp.json` in this repo starts `scripts/start-mcp.js`, which runs
`server/bundle.cjs` from the checkout, with `CLAUDE_PLUGIN_ROOT` pointed at
`~/.report-baby/dev-plugin-root` so nothing downloads into the working tree. The
process loads the bundle once at startup, so **a rebuilt bundle is not picked up
until the MCP server restarts.** For a code change, verify through the CLI; use
`render_report` over MCP only to confirm the tool contract — the response should
carry your new warning in `structuredContent.warnings`.

**Full gate run before you commit.** `node server/scripts/visual-qa.mjs`.
Baseline at hand-off: **33 cases, 2024 checks, 0 failed.** Your new cases add to
that; no existing check may go red.

## Release

Patch release unless you add a field to the `render_report` data shape (a config
key is not a field). Bump the version in `package.json`,
`server/package.json`, `server/src/version.ts`,
`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
`.codex-plugin/plugin.json`, `plugins/report-baby/.codex-plugin/plugin.json`,
rebuild both bundles so the compiled version matches, write the CHANGELOG entry,
strike the fixed items from `ROADMAP.md`, and push to `origin` and `gh`.
