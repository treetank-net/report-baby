# Brand ZIP archive as a first-class source — plan

## Status

Target baseline: `0.9.5`. ZIP brand sources are not implemented by this plan.
The current remote source is Git through `--brand-url`, using a shallow sparse
clone and `prepareBrandDirectory` in `src/cli.ts`.

## Decisions agreed jointly

The following product and domain decisions were made jointly during planning:

- A brand is the directory containing `_brand.yml`. “Brandbook” and brand are
  the same domain object for v1; there is no separate `book` namespace.
- A source is materialized as a complete source root. `brand_path` selects the
  brand directory within that root. It is required when the manifest is not at
  the source root; there is no recursive auto-discovery.
- The same source and path semantics apply to local directories, local ZIPs,
  remote ZIPs, and Git repositories. V1 has one active brand at a time; a
  multi-brand context is a future extension.
- `brand://` resolves relative to the selected brand root and `source://`
  resolves relative to the complete source root. `..` may leave the brand root
  but may not leave the source root. A future multi-brand context can add an
  explicit brand qualifier without changing the v1 model.
- A profile is a partial YAML/JSON overlay under the selected brand. It may
  extend another profile; the effective result is `_brand.yml`, then parent
  profiles, then the selected profile, merged deeply with cycle detection.
  Profiles may override brand values and surface/layout preferences, but do not
  define another brand root, templates, or document geometry.
- ZIP ingestion has no extension allowlist. Regular files are retained as
  inert source material and are validated when the brand resolver or renderer
  uses them. Archive structure, traversal, symlink, size, and decompression
  limits remain mandatory, and nothing from a source is executed.
- Source selection is explicit in CLI, MCP, and tests. A process-level default
  may be supplied by environment configuration, while a request-level source
  overrides it without mutating process-wide state.
- ZIP extraction and Git materialization use a persistent content-addressed
  cache under the configured report-baby data directory. Local directories may
  be used in place. Cache identity and cleanup are implementation details, but
  the cache must be safe for concurrent readers.

## Goal

Allow a published or working brandbook to arrive as a local ZIP file, a ZIP URL,
or an existing Git repository. The same resolver should be available to the CLI
and to MCP render tools. A published ZIP must be able to carry prepared asset
derivatives so a consumer does not pay the slow fallback render cost.

Git remains supported. ZIP is an additional transport, not a replacement.

## Why this belongs in the product

1. MCP render tools currently accept `brand_ref`, but no source parameter. An
   agent must already know the correct environment variables.
2. Clients commonly deliver brandbooks as email attachments, not repositories.
3. A validated source-root and asset contract makes the real input contract
   executable instead of leaving designers to infer it from renderer behavior.
4. A published release can include `_prepared/` derivatives and its
   manifest, preserving the performance win of prepared brand assets.

## Proposed source contract

Add a shared, validated source resolver rather than separate CLI and MCP logic.
The following is an illustrative proposed request shape, not the current API:

```json
{ "brand_source": { "zip_url": "https://example.test/brand.zip",
                     "brand_path": "brands/flux" } }
{ "brand_source": { "zip_path": "/tmp/brand.zip",
                     "brand_path": "brands/flux" } }
{ "brand_source": { "git_url": "https://example.test/brand.git",
                     "brand_path": "brands/flux", "ref": "v1.2" } }
```

The resolver should return the materialized source root, selected brand root,
diagnostics, and cleanup ownership. The exact public field names can follow the
existing CLI/MCP schema, but the source override must be available in every
surface and in tests. Precedence between a request-level source and the
process-level default must be documented and tested.

## Delivery phases

### Phase 1 — source detection and safe extraction

- Treat a remote URL ending in `.git` as a Git repository. Other remote source
  candidates are ZIPs; validate the response and ZIP magic bytes rather than
  trusting a suffix alone.
- Add `--brand-zip /path/to/brand.zip` for local files.
- Materialize the complete source root for every transport. Do not use a
  sparse checkout or extraction that omits files outside `brand_path`, because
  valid `source://` references may need them.
- Reuse the already bundled `fflate`/`unzipSync` capability where its API is
  suitable; do not add another archive dependency without a measured reason.
- Preserve regular files without interpreting or executing them. Unsupported
  formats should fail with an actionable diagnostic only when referenced by a
  manifest or renderer path that cannot consume them.
- Defend extraction against ZIP slip: reject absolute paths, `..` components,
  and symlink entries; after normalization every output must remain under the
  destination directory.
- Defend against ZIP bombs with configurable limits for entry count, one-file
  size, total extracted size, compression ratio, and nested archives. The
  initial configured defaults are 2,000 entries, 50 MiB per file, 200 MiB
  total, 100:1 compression ratio, and zero nested archive extraction. Store
  all thresholds in the render YAML configuration, not in code literals.
- Do not extract an archive inside another archive.

### Phase 2 — explicit brand path and prepared releases

- After materialization, resolve `brand_path` against the source root. If it is
  omitted, the source root itself must contain `_brand.yml`; do not search
  descendants and guess which brand was intended.
- Archives with a parent directory are supported by passing that directory as
  `--brand-path` or its MCP/fixture equivalent. The selected directory must
  contain `_brand.yml`.
- Resolve profile paths relative to the selected brand root and apply the
  agreed profile overlay semantics before rendering.
- Detect `_prepared/manifest.json`. Use prepared derivatives when their source
  metadata is valid; otherwise use the existing fallback asset path and emit a
  counted warning that the brand was not published/prepared and will render
  more slowly.
- Never mutate the original ZIP or the source brandbook. Extraction and cache
  entries are owned by the configured cache and can be cleaned up by policy.

### Phase 3 — content-addressed cache

- Cache extracted archives by SHA-256 of the archive bytes, not by URL. The
  same bytes from a local path and a URL should share an entry; replacing the
  bytes at the same URL must create a new entry.
- Cache complete Git materializations by their immutable source identity (URL,
  resolved ref/commit, and any required fetch options). `brand_path` selects a
  view inside the source and must not cause duplicate source caches.
- Define cache ownership, cleanup, maximum cache size, and concurrent access
  behavior before enabling it in MCP.

### Phase 4 — MCP and documentation

- Add `brand_source` to all rendering tools that accept a brand reference,
  using the repository's single schema source.
- Return source, path, validation, preparation, and fallback diagnostics through
  the existing diagnostics channels.
- Document CLI and MCP examples, precedence, cleanup behavior, accepted files,
  size limits, and the distinction between a working brandbook and a published
  prepared release.
- Keep distribution compatible with restricted environments: Git bundle/update
  flows continue to use `raw.githubusercontent.com`; do not introduce
  dependencies on `api.github.com` or `codeload.github.com`.

## Security and compatibility requirements

- No file may be written outside the chosen extraction directory.
- Symlinks, absolute paths, traversal paths, nested archives, and over-limit
  archives fail safely before rendering. Source files are never executed.
- An unsupported referenced file must produce a named, actionable diagnostic;
  an unrelated regular file in the source must not be rejected merely because
  of its extension.
- Existing Git source support remains available through the shared resolver.
- Prepared derivatives and the existing render-time asset cache remain intact.
- Do not make network access implicit for an ordinary `brand_ref`; only an
  explicit source object or CLI flag may fetch/extract a brand.

## Test plan

Add tests before implementation and retain them as the source contract:

1. `--brand-zip` and a ZIP `--brand-url` produce the same normalized render as
   the equivalent directory; compare normalized PDF content hashes.
2. MCP `brand_source.zip_path`, `brand_source.zip_url`, and the existing Git
   form work without setting brand directory environment variables.
3. ZIP slip fixtures containing `../../etc/passwd`, absolute paths, and symlink
   entries are rejected, and a test proves nothing is written outside the
   extraction root.
4. Unsupported referenced formats produce named actionable diagnostics, while
   unrelated files are preserved and no archive content is executed.
5. The same URL with changed archive bytes invalidates the cache. Identical
   bytes from different sources hit the same cache entry.
6. `_brand.yml` at the source root works without `brand_path`; a parent
   directory or nested brand works when `brand_path` is explicit, and descendant
   auto-discovery is not performed.
7. An archive with `_prepared/manifest.json` uses prepared assets without a
   fallback warning; one without it renders successfully but warns.
8. Entry count, per-file size, total size, compression-ratio, nested-archive,
   and malformed-archive limits are enforced from render configuration.
9. Existing Git source, current CLI/MCP contracts during migration, asset, and
   baseline tests remain green.
10. Run PDF/PNG output checks and LibreOffice round-trips where applicable;
    archive validation itself should remain a fast unit-test layer.

## Acceptance criteria

- Local ZIP and ZIP URL render identically to the equivalent brand directory.
- MCP can select a ZIP source without environment-variable setup.
- Unsafe paths are rejected and cannot escape the extraction directory.
- Unsupported referenced formats produce actionable diagnostics without an
  extension allowlist for unrelated source files.
- Cache identity is content-based for ZIPs and invalidates when bytes change.
- A source-root `_brand.yml` works without a path, while nested brand layouts
  work with an explicit `brand_path`; the resolver never guesses recursively.
- Prepared archives use their derivatives without a false slow-path warning;
  unprepared archives warn and still render through the cached fallback path.
- The source-resolution contract and safety limits are present in README and in
  a discoverable setup response for agents.

## Non-goals

- Do not remove or weaken Git brand sources.
- Do not change the prepared-asset cache or derivative format as part of the
  source-ingestion work.
- Do not execute anything from an archive.
- Do not implement this plan merely by changing documentation; each security,
  cache, and source-resolution rule needs an executable test in the eventual
  implementation.
