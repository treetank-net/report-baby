# Brand ZIP archive as a first-class source — plan

## Status

Target baseline: `0.9.5`. ZIP brand sources are not implemented by this plan.
The current remote source is Git through `--brand-url`, using a shallow sparse
clone and `prepareBrandDirectory` in `src/cli.ts`.

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
3. A ZIP allowlist makes the real asset contract executable instead of leaving
   designers to infer it from renderer behavior.
4. A published store release can include `_prepared/` derivatives and its
   manifest, preserving the performance win of prepared brand assets.

## Proposed source contract

Add a shared, validated source resolver rather than separate CLI and MCP logic.
The optional MCP field should be an object such as:

```json
{ "brand_source": { "zip_url": "https://example.test/brand.zip" } }
{ "brand_source": { "zip_path": "/tmp/brand.zip" } }
{ "brand_source": { "git_url": "https://example.test/brand.git",
                     "path": "brands", "ref": "v1.2" } }
```

The resolver should return a temporary or cached normalized brand directory,
diagnostics, and cleanup ownership. Existing `REPORT_BABY_BRAND_DIR` and
`REPORT_BABY_BRAND_STORE` behavior remains valid when no source object is
provided. The exact precedence between an explicit source and environment
configuration must be documented and tested.

## Delivery phases

### Phase 1 — archive detection and safe extraction

- Make `--brand-url` recognize ZIP responses by `.zip` suffix, response
  `Content-Type`, or ZIP magic bytes `PK\x03\x04`; do not trust the URL suffix
  alone.
- Add `--brand-zip /path/to/brand.zip` for local files.
- Reuse the already bundled `fflate`/`unzipSync` capability where its API is
  suitable; do not add another archive dependency without a measured reason.
- Enforce an allowlist:

  | Category | Extensions |
  | --- | --- |
  | Brand documents | `.yml`, `.yaml`, `.json` |
  | Fonts | `.ttf`, `.otf` |
  | Graphics | `.svg`, `.png`, `.jpg`, `.jpeg` |
  | Documentation | `.md`, `.txt` |

- Reject unsupported files with a counted warning naming the file and telling
  the user what to do. In particular, explain that `.woff` and `.woff2` are
  not usable by the PDF/PNG font path and require `.ttf` or `.otf`. Reject
  source formats such as `.pdf`, `.ai`, `.eps`, and `.psd` with the same kind
  of actionable message. Executable files such as `.exe`, `.sh`, and `.js`
  must never be extracted or executed.
- Defend extraction against ZIP slip: reject absolute paths, `..` components,
  and symlink entries; after normalization every output must remain under the
  destination directory.
- Defend against ZIP bombs with configurable limits for entry count, one-file
  size, total extracted size, compression ratio, and nested archives. Proposed
  safe defaults are 2,000 entries and 200 MB total, with the remaining limits
  chosen from measured brandbooks. Store all thresholds in the render YAML
  configuration, not in code literals.
- Do not extract an archive inside another archive.

### Phase 2 — root discovery and prepared releases

- Support archives packaged with a parent directory, with the brand directory
  directly at the root, or with the brand manifest directly at the root.
- Detect `_brand.yml`, `_brand.yaml`, `brand.yml`, `brand.yaml`, or
  `brand.json`, then normalize the extracted tree to the directory shape
  expected by the brand resolver. `--brand-path` remains an explicit override
  for ambiguous archives.
- Detect `_prepared/manifest.json`. Use prepared derivatives when their source
  metadata is valid; otherwise use the existing fallback asset path and emit a
  counted warning that the brand was not published/prepared and will render
  more slowly.
- Never mutate the original ZIP or the source brandbook. Extraction and any
  cache entries are disposable or owned by the immutable store.

### Phase 3 — content-addressed cache

- Cache extracted archives by SHA-256 of the archive bytes, not by URL. The
  same bytes from a local path and a URL should share an entry; replacing the
  bytes at the same URL must create a new entry.
- Define cache ownership, cleanup, maximum cache size, and concurrent access
  behavior before enabling it in MCP.
- Preserve the existing Git cache key semantics, including URL, ref, and
  subdirectory, unless the shared resolver can prove an equivalent immutable
  identity.

### Phase 4 — MCP and documentation

- Add `brand_source` to all rendering tools that accept a brand reference,
  using the repository's single schema source.
- Return source, validation, preparation, and fallback warnings through the
  existing diagnostics channels. Do not hide rejected archive entries.
- Document CLI and MCP examples, precedence, cleanup behavior, accepted files,
  size limits, and the distinction between a working brandbook and a published
  prepared release.
- Keep distribution compatible with restricted environments: Git bundle/update
  flows continue to use `raw.githubusercontent.com`; do not introduce
  dependencies on `api.github.com` or `codeload.github.com`.

## Security and compatibility requirements

- No file may be written outside the chosen extraction directory.
- Symlinks, absolute paths, traversal paths, nested archives, executable files,
  and over-limit archives fail safely before rendering.
- A rejected optional file should not make an otherwise valid brand unusable,
  unless the file is required by the brand manifest. The warning must name the
  file and distinguish “unsupported” from “required but missing”.
- Existing Git `--brand-url` behavior remains unchanged for repositories.
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
4. `.woff2`, source design formats, and executable files produce named counted
   warnings; `.ttf` and `.otf` remain accepted.
5. The same URL with changed archive bytes invalidates the cache. Identical
   bytes from different sources hit the same cache entry.
6. Three layouts work: a parent directory, the brand contents at the archive
   root, and the brand manifest at the root. Test `--brand-path` as an explicit
   override.
7. An archive with `_prepared/manifest.json` uses prepared assets without a
   fallback warning; one without it renders successfully but warns.
8. Entry count, per-file size, total size, compression-ratio, nested-archive,
   and malformed-archive limits are enforced from render configuration.
9. Existing Git source, `REPORT_BABY_BRAND_DIR`, `REPORT_BABY_BRAND_STORE`,
   CLI, MCP schema, asset, and baseline tests remain green.
10. Run PDF/PNG output checks and LibreOffice round-trips where applicable;
    archive validation itself should remain a fast unit-test layer.

## Acceptance criteria

- Local ZIP and ZIP URL render identically to the equivalent brand directory.
- MCP can select a ZIP source without environment-variable setup.
- Unsafe paths are rejected and cannot escape the extraction directory.
- Unsupported fonts and design formats produce actionable, counted warnings.
- Cache identity is content-based for ZIPs and invalidates when bytes change.
- All three archive root layouts work, with `--brand-path` available for
  explicit disambiguation.
- Prepared archives use their derivatives without a false slow-path warning;
  unprepared archives warn and still render through the cached fallback path.
- The accepted-file allowlist and safety limits are present in README and in a
  discoverable safety/setup response for agents.

## Non-goals

- Do not remove or weaken Git brand sources.
- Do not change the prepared-asset cache or derivative format as part of the
  source-ingestion work.
- Do not execute anything from an archive.
- Do not implement this plan merely by changing documentation; each security,
  cache, and source-resolution rule needs an executable test in the eventual
  implementation.

