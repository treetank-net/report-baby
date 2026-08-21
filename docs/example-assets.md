# Neutral showcase assets

The committed `examples/brand-showcase` brands are synthetic renderer fixtures. They are not Trans.eu, Google, Amazon, Apple, or any other customer or public brand, and their logos/backgrounds were created for this repository.

The example font files are bundled so the standalone prototype is deterministic:

- Ubuntu Sans: Ubuntu Font Licence 1.0 — https://ubuntu.com/legal/font-licence
- Liberation Sans: SIL Open Font License 1.1 — https://openfontlicense.org
- DejaVu Serif and DejaVu Sans Mono: DejaVu Fonts License — https://dejavu-fonts.github.io/License.html

The showcase records the license and provenance of each font here; it does not copy system font packages or rely on a machine-local copyright file.

When replacing an example with a real brand, keep the source brand and its asset licences in the owning brand repository. Do not copy customer assets into `report-baby`; point `--brand-root` or `REPORT_BABY_BRAND_DIR` at that external directory.
