# Repository instructions

- Keep layout, typography, spacing, geometry, thresholds, and other tunable numeric values in the relevant YAML render configuration (`server/templates/render-config.yml`), not hardcoded in TypeScript or JavaScript. Code must read those values through the existing configuration seam. This includes visual-QA bounds and thresholds.
- Do not duplicate a configuration value as a literal in a script or renderer. If a value is needed by a tool outside the bundled renderer, load the same YAML configuration rather than copying the number.
- For visual QA round-trips, use a system LibreOffice when available; otherwise support the repository's Docker or Flatpak LibreOffice fallback instead of treating the converter as unavailable.
