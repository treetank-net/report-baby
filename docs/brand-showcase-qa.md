# Brand showcase QA

A showcase is a visual contract test. It is not accepted merely because YAML
parses, a PDF has a `%PDF` header, or a PPTX is a valid ZIP archive.

## Acceptance criteria

Every showcase passes five gates:

1. **Data contract** — the number of examples comes from `showcase.yml`. A
   basic brand may have one surface type, a segmented brand several, and a rich
   brand many. The generator does not invent variants that the brand did not
   declare.
2. **Native rendering** — PDF, PNG, and PPTX are produced with the same brand,
   fonts, lockup, footer, margins, and content.
3. **Round-trip** — PPTX is converted to PDF and then PNG. We compare that
   image with the direct PDF/PNG output, not only with the source file.
4. **Automatic measurements** — we check contrast roles, fonts, dimensions,
   missing files, profile count, overflow, and repeatability. Manifest color
   measurements are warnings; the final pixels take precedence.
5. **Critical inspection** — for each type, we inspect a contact sheet with the
   direct PNG, PDF→PNG, PPTX→PDF→PNG, and a difference image. We ask whether
   the lockup is one composition, whether empty space is intentional, whether
   contrast works on real pixels, and whether the result looks like company
   material.

There is no averaging. One low-contrast case, clipping issue, broken lockup,
or unexpected font replacement blocks acceptance.

## Running the checks

```bash
node scripts/render-brand-showcase.js \
  --out examples/brand-showcase/generated \
  --formats pdf,png,pptx

node scripts/audit-brand-showcase.js examples/brand-showcase/generated
node scripts/inspect-brand-showcase.js \
  --root examples/brand-showcase/generated \
  --qa-root /tmp/report-baby-brand-showcase-qa/output \
  --require-pptx-render
```

### Reproducible runner with LibreOffice

For comparable results across computers, use `docker/brand-qa.Dockerfile`. It
contains Node, LibreOffice Impress, Poppler, ImageMagick, fonts, and `unzip`;
the host does not need npm or LibreOffice. The image writes the showcase to the
mounted repository, while reports and QA images remain in a separate temporary
directory.

```bash
docker build -f docker/brand-qa.Dockerfile -t report-baby-brand-qa .
mkdir -p /tmp/report-baby-brand-showcase-qa
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$PWD,dst=/workspace" \
  --mount "type=bind,src=/tmp/report-baby-brand-showcase-qa,dst=/tmp/report-baby-brand-showcase-qa" \
  report-baby-brand-qa \
  --out /workspace/examples/brand-showcase/generated \
  --qa-root /tmp/report-baby-brand-showcase-qa/output
```

The mounted directory is the parent of `--qa-root`, not `--qa-root` itself.
The inspector replaces its target atomically after staging, so the target must
remain a writable path inside the mounted parent.

The runner always requires the PPTX → PDF → PNG round-trip. Without Docker,
the same three scripts can be run locally; `inspect-brand-showcase.js` detects
`soffice`, `libreoffice`, or the Flatpak app
`org.libreoffice.LibreOffice`. `INCOMPLETE` means that no converter is
available, while a conversion error is a QA failure, not an automatic success.

Inspection writes measurements outside the examples directory, by default
under `/tmp/report-baby-brand-showcase-qa/<brand>/`, using staging and an
atomic replacement at the end. A Flatpak access error for `/tmp` is a QA
failure, not a passing result.

## Visual criteria

- logo and name form one lockup; renderer position may differ by at most 6 px
  at 1600×900;
- logo–name spacing and baseline are shared by PDF/PNG/PPTX;
- normal text has at least 4.5:1 contrast, and large text at least 3:1;
- accent and status text has at least 3:1 contrast against both the page
  background and card surfaces;
- no clipping, text overlap, duplicated brand names, or unintended font
  fallback;
- empty space is justified by hierarchy, not by an unused layout;
- differences between brands come from the brandbook: typography, colors,
  graphics, lockup, density, and layout—not only the name/logo;
- every graphic declares a safe area/scrim and does not enter protected text
  space.

## Pagination cases

The PDF behavior test includes both a long paragraph and a table that crosses
the page boundary. Paragraphs break at line boundaries; a section keeps its
heading with an initial body lead where possible. Tables repeat their column
header and the compact report header on continuation pages. KPI cards and
charts remain whole and move to the next page when they do not fit. The footer
is added after the final page count is known, so every page receives both the
document footer and its final `n / total` counter.

## Mutation test

The procedure is credible only if it catches intentional regressions. The
contract test currently runs mutations for a title without a fit strategy, a
table above its limit, and a zero-sized safe area. The round-trip manually
checks title wrapping, lockup, contrast, fonts, and images overlapping text.
Moving the brand name in PPTX, lowering contrast, or removing a font should
become additional QA fixtures; they are not currently pretended to be
automated.

## Self-critique round

After changes, the agent performs an independent review based on manifests,
round-trips, measurements, and images—not on its own success description. If
it cannot inspect the converted PPTX or explain empty space, it returns to the
prototype.

The MCP/CLI contract and overflow behavior can be checked without LibreOffice:

```bash
npm run build --prefix server
npm run test:brand --prefix server
```
