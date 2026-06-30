# report-baby

MCP server do renderowania ładnych raportów: **HTML/dane → PDF/PNG** przez headless Chromium (Playwright).
Członek rodziny pluginów `*-baby` (obok `google-ads-baby`, `meta-ads-baby`).

Najprostszy, najczystszy członek rodziny — czysty render lokalny: **zero OAuth, zero safety/hooków,
zero API kont reklamowych.** Generujesz HTML, dostajesz ścieżkę do gotowego pliku PDF/PNG.

## Czym jest

- Render HTML stringa lub pliku HTML do PDF/PNG.
- Render URL-a do PDF/PNG.
- Opinionated `render_report` — wbudowany ostylowany szablon + Twoje dane → ładny raport dla klienta.
- Zwraca **ścieżkę do pliku**, nie obraz do kontekstu (deliverable dla człowieka). Opcjonalny
  `return_image` tylko gdy LLM ma ocenić layout.

## Toole

| Tool | Opis |
| --- | --- |
| `render_html_to_pdf` | HTML (string lub plik) → PDF, zwraca ścieżkę |
| `render_html_to_image` | HTML → PNG/JPEG (`return_image` opcjonalnie) |
| `render_url_to_pdf` | URL → PDF |
| `render_url_to_image` | URL → PNG/JPEG (`return_image` opcjonalnie) |
| `render_report` | szablon + dane → ładny raport (PDF/PNG) |
| `list_templates` | lista wbudowanych szablonów |
| `check_update` | aktualizacja pluginu |

## Wykresy

report-baby nie ma silnika wykresów. Przekaż HTML z inline Chart.js / SVG (np. z chart-MCP) — my go wyrenderujemy.

## Build

```sh
cd server
npm install
npx playwright install chromium   # albo użyj systemowego Chrome: REPORT_BABY_CHROMIUM_CHANNEL=chrome
npm run build
```

## Install In Claude Code

This repository can be installed as a Claude Code plugin through its marketplace manifest:

```text
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
```

Add the GitLab repository as a Claude Code plugin marketplace, then install the plugin:

```bash
/plugin marketplace add https://gitlab.com/treetank/report-baby.git
/plugin install report-baby@report-baby-marketplace
```

After installation, reload or restart Claude Code. The plugin registers:

- MCP server: `report`

## Install In Codex

This repository contains Codex plugin metadata:

```text
.codex-plugin/plugin.json
.mcp.json
.agents/plugins/marketplace.json
```

The marketplace entry points to `./plugins/report-baby`. That directory is a small Codex wrapper; it downloads the latest built bundle from the GitHub mirror, installs runtime dependencies, ensures Playwright Chromium is available, and starts the MCP server.

Add this repository as a local Codex plugin/marketplace source, then enable `report-baby`. No OAuth or mutation-safety hooks are required.

Szczegóły architektury i trade-offów: `CLAUDE.md`. Plany: `ROADMAP.md`.

## Config

- `REPORT_BABY_DATA` — katalog danych (domyślnie `~/.report-baby`); output w `<data>/out`.
- `REPORT_BABY_CHROMIUM_CHANNEL` — np. `chrome`, by użyć systemowego Chrome zamiast pobierać Chromium.

## Licencja

MIT — Jacek Mariański / Treetank.
