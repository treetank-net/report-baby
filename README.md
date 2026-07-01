# report-baby

MCP server do renderowania ładnych raportów: **dane → PNG wykresy/karty metryk oraz PDF raporty**.
Członek rodziny pluginów `*-baby` (obok `google-ads-baby`, `meta-ads-baby`).

Najprostszy, najczystszy członek rodziny — czysty render lokalny: **zero OAuth, zero safety/hooków,
zero API kont reklamowych, zero przeglądarki w runtime.** Podajesz dane, dostajesz ścieżkę do gotowego pliku PDF/PNG.

## Czym jest

- Render wykresów i kart metryk do PNG bez zewnętrznych usług.
- Rasteryzacja własnego SVG do PNG.
- Opinionated `render_report` — wbudowany ostylowany szablon + Twoje dane → wielostronicowy raport PDF dla klienta.
- Zwraca **ścieżkę do pliku**, nie obraz do kontekstu (deliverable dla człowieka). Opcjonalny
  `return_image` w toolach PNG tylko gdy LLM ma ocenić layout.

## Toole

| Tool | Opis |
| --- | --- |
| `render_chart` | dane → wykres bar/line/pie PNG |
| `render_metric_cards` | KPI → siatka kart PNG |
| `render_svg` | dowolny SVG → PNG (`return_image` opcjonalnie) |
| `render_report` | szablon + dane → wielostronicowy raport PDF |
| `list_templates` | lista wbudowanych szablonów |
| `update_plugin` | aktualizacja pluginu |

## Wykresy

report-baby ma wbudowany silnik SVG dla wykresów bar/line/pie i kart KPI. Dla niestandardowej grafiki użyj `render_svg`.

## Build

```sh
cd server
npm install
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

The marketplace entry points to `./plugins/report-baby`. That directory is a small Codex wrapper; it downloads the latest built bundle from the GitHub mirror and starts the MCP server.

Add this repository as a local Codex plugin/marketplace source, then enable `report-baby`. No OAuth or mutation-safety hooks are required.

Szczegóły architektury i trade-offów: `CLAUDE.md`. Plany: `ROADMAP.md`.

## Config

- `REPORT_BABY_DATA` — katalog danych (domyślnie `~/.report-baby`); output w `<data>/out`.

## Licencja

MIT — Jacek Mariański / Treetank.
