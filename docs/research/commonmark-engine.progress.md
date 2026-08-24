# CommonMark engine research — progress

This is a live checkpoint for the delegated research task. The final findings
belong in `commonmark-engine.md`; this file records progress and blockers so a
long-running agent remains observable.

- status: completed
- last_update: 2026-08-24T12:25:17+02:00
- plan: inspect the current parser and bundling constraints; collect primary-source evidence for each candidate; compare against the required capabilities; write and verify the final report.
- next_step: none; final report saved at `docs/research/commonmark-engine.md`
- blockers: none recorded

- 2026-08-24T12:24:05+02:00 — source: local `server/src/text-runs.ts` and `server/package.json`; established: the current regex handles only limited bold/italic inline forms, while the target is Node >=18 TypeScript and minified CJS bundles via esbuild; next: collect CommonMark reference/spec evidence.
- 2026-08-24T12:23:45+02:00 — source: CommonMark Spec 0.31.2 and `commonmark/commonmark-spec`; established: CommonMark has >500 embedded conformance cases, and its grammar separates block parsing from inline parsing; next: assess the C reference implementation.
- 2026-08-24T12:23:45+02:00 — source: `commonmark/cmark`; established: C99, no external dependencies, all CommonMark conformance tests, mutable AST and multiple renderers; next: determine fit and integration cost for the Node bundle.
- 2026-08-24T12:23:45+02:00 — source: `commonmark/commonmark.js`; established: JavaScript reference implementation exposes mutable AST nodes, image `destination`/`title`, block source positions, and an opt-in safe HTML renderer; next: assess package and TypeScript/bundle trade-offs.
- 2026-08-24T12:23:45+02:00 — source: `markdown-it` official docs and package manifest; established: CommonMark preset, token stream, rule/plugin hooks, HTML disabled by default outside that preset, and six production dependencies; next: evaluate token-to-model mapping.
- 2026-08-24T12:23:45+02:00 — source: `remark-parse`, `unified`, and `mdast` official repositories; established: CommonMark parser produces typed mdast, exposes image url/title/alt and raw HTML nodes, supports plugin pipelines and VFile messages; next: assess ESM/esbuild integration.
- 2026-08-24T12:23:45+02:00 — source: `micromark` official repository; established: 100% CommonMark claim, extensions, safe-by-default HTML/protocol behavior, about 14 kB core, ESM-only Node 16+ package; next: distinguish renderer-only use from AST pipeline use.
