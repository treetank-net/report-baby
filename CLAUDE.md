# report-baby

Claude Code plugin: MCP server do renderowania ładnych grafik i raportów — dane → PNG (wykresy, karty metryk) / PDF.
Członek rodziny pluginów `*-baby` (obok `google-ads-baby`, `meta-ads-baby`, `google-analytics-baby`).
Najprostszy, najczystszy członek rodziny: czysty compute renderujący, działa lokalnie, bez sieci.

## Architektura

Plugin = MCP server (stdio). **ZERO OAuth, zero safety/hooków, zero mutacji zewnętrznych, zero API kont, zero sieci w runtime.**
Bierze dane (label/value, KPI, wiersze tabeli) i zwraca ścieżkę do wyrenderowanego pliku.

### Silnik renderujący — w pełni bundlowalny, zero-deps
- **SVG → PNG: `@resvg/resvg-wasm`** — rasteryzator SVG w czystym WASM. Bez przeglądarki, bez binarki.
- **PDF: `jspdf` + `jspdf-autotable`** — dokument A4 budowany programowo (tekst, prostokąty, obrazy, tabele).
- **Font: DejaVu Sans (regular + bold) osadzony w bundlu** jako binarka. KONIECZNY — bez fontu resvg pomija
  CAŁY tekst w SVG, a jsPDF nie renderuje polskich znaków. `server/src/assets/font.ttf` + `font-bold.ttf`.
- Wykresy generujemy SAMI w `svg.ts` (bar / line / donut / metric cards) — to czyste SVG stringi z danych,
  bez HTML i bez zewnętrznej biblioteki wykresów.
- Most SVG↔PDF: wykres → SVG → PNG (resvg) → `doc.addImage()` w PDF. Raport osadza wykresy jako rastry.

### Kontrakt zwracania: ŚCIEŻKA do pliku, nie obraz do kontekstu
- Toole renderujące zapisują plik do `outputDir` i zwracają jego ścieżkę w treści tekstowej.
- Powód: deliverable jest dla CZŁOWIEKA (grafika do wklejenia, raport dla klienta). LLM dokładniej czyta surowe
  liczby ze źródła niż piksele wykresu, a wciąganie obrazu do kontekstu jest drogie.
- Flag `return_image: boolean` (domyślnie `false`) na toolach PNG — zwraca też MCP image content.
  Używaj TYLKO gdy LLM faktycznie ma ocenić layout/estetykę, nie do odczytu danych.

### Source layout (`server/src/`)
```
index.ts            — entrypoint: McpServer, instructions, rejestracja tooli (render + auth), stdio. W async main().
config.ts           — ReportConfig { outputDir }, configFromEnv(), getConfigDir() → .report-baby, getOutputDir() → <data>/out
constants.ts        — (brak; report-baby nie ma OAuth/kluczy)
errors.ts           — formatError()
assets.d.ts         — declare module '*.wasm' / '*.ttf' → Uint8Array (dla tsc; esbuild ładuje binarnie)
svg.ts              — silnik wykresów: barChart/lineChart/pieChart/metricCards/renderChart → SVG string. Paleta, typografia, FONT_FAMILY.
render.ts           — silnik niskopoziomowy: ensureWasm()+renderSvgToPng() (resvg), newPdf()+pdfFont() (jsPDF z osadzonym fontem). applyPlugin(jsPDF) dla autotable.
templates.ts        — listTemplates(), renderReportPdf(name, data) → Buffer (multi-page PDF z sekcji: header/KPI/charts/sections/table/highlights/footer)
assets/
  font.ttf          — DejaVu Sans regular (osadzany w bundlu)
  font-bold.ttf     — DejaVu Sans bold

tools/
  render.ts         — registerRenderTools(): render_chart, render_metric_cards, render_svg, render_report, list_templates
  auth.ts           — registerAuthTools(): update_plugin (self-update + changelog). BRAK setup_auth — nie ma OAuth.
```

### Toole
- `render_chart` { type: bar|line|pie, data: [{label,value,color?}], title?, subtitle?, prefix?, suffix?, width?, output_path?, return_image? } — wykres → PNG, zwraca ścieżkę. **Główny tool do grafik.**
- `render_metric_cards` { cards: [{label,value,delta?,trend?,note?}], title?, subtitle?, columns?, width?, output_path?, return_image? } — siatka kart KPI → PNG.
- `render_svg` { svg, width?, output_path?, return_image? } — dowolny SVG → PNG (escape hatch; tekst wymaga `font-family="DejaVu Sans"`).
- `render_report` { template?='default-report', data, output_path? } — OPINIONATED: szablon + dane → wielostronicowy PDF. To "ładne raporty na koniec".
- `list_templates` {} — lista szablonów (`default-report`, `campaign-summary`).
- `update_plugin` {} — sprawdź/zainstaluj aktualizacje pluginu.

### Kształt danych `render_report`
`{ brand?, title?, subtitle?, period?, intro?, kpis?: [{label,value,delta?,trend?,note?}], charts?: [{type,title?,subtitle?,prefix?,suffix?,data}], sections?: [{heading,body}], table?: {head,body,caption?}, highlights?: string[], footer? }`.
Wszystkie pola opcjonalne — renderują się tylko obecne bloki, w kolejności: header → intro → KPI → charts → sections → table → highlights → footer (stopka z numeracją stron na każdej stronie).

## Dystrybucja — TERAZ jak reszta rodziny (zero-deps bundle)

W v0.1 silnik był oparty o Playwright/Chromium i **NIE dało się go zbundlować** (Chromium to ~150MB binarka
poza JS) — crashował na świeżej maszynie bez `node_modules/playwright`. v0.2 porzuca przeglądarkę: resvg-wasm
i jsPDF bundlują się w całości esbuildem, font wchodzi binarnie do bundla. Efekt: **jeden `server/bundle.cjs`
(~6MB), zero zależności runtime, zero pobierania na pierwszym starcie** — dokładnie model `google-ads-baby`.

## Jak dodawać rzeczy

**Nowy typ wykresu / wariant:**
1. Funkcja buildera w `svg.ts` zwracająca SVG string (użyj helperów `open`, `text`, `header`, palety, `niceCeil`, `truncate`).
2. Podłącz w `renderChart()` (jeśli to nowy `type`) i w schemacie `type` w `tools/render.ts`.

**Nowy tool renderujący:**
1. Handler `server.tool('render_...')` → `tools/render.ts`.
2. Złóż SVG (z `svg.ts`) lub PDF (z `templates.ts`), zapisz przez `writePng()` / `writeFile`, zwróć ścieżkę.

**Nowy szablon raportu:**
1. Dodaj wpis do `TEMPLATES` i gałąź w `resolveTemplate()` w `templates.ts`.
2. Buduj na istniejących sekcjach (`renderHeader`/`renderKpis`/`renderCharts`/`renderSections`/`renderTable`/`renderHighlights`/`renderFooter`) operujących na kursorze `Cursor` (auto page-break).

**Konwencje:**
- Nie pisz komentarzy w kodzie — nazwy funkcji/zmiennych muszą być samodokumentujące.
- TODO/plany → `ROADMAP.md`, nie komentarze w kodzie.
- `index.ts` zawinięty w `async function main(){...}` + `main()` (CJS bundle nie znosi top-level await).
- Tekst w SVG ZAWSZE z `font-family="DejaVu Sans"` (= `FONT_FAMILY`), inaczej resvg go pominie.
- `npm run build` po każdej zmianie w `src/` — bundle.cjs musi być aktualny.

## Odrzucone opcje

- **Headless Chromium / Playwright (było w v0.1)** — pixel-perfect CSS, ale binarki nie da się zbundlować;
  crashował bez `node_modules`/Chromium na maszynie usera. Porzucone na rzecz zero-deps silnika.
- **wkhtmltopdf** — projekt zarchiwizowany, stary QtWebKit, łamie nowoczesny CSS.
- **Zewnętrzna biblioteka wykresów (Chart.js, QuickChart, AntV)** — Chart.js wymaga DOM/canvas (przeglądarka),
  QuickChart/AntV to sieć w runtime. My generujemy SVG sami — self-contained, deterministyczne, offline.
- **Artifact na claude.ai** — ładne HTML, ale tylko wewnątrz Claude. My chcemy cross-client render do pliku na dysku.

## Plugin Manifests
- Claude Code: `.claude-plugin/plugin.json` (BEZ `hooks` — nie ma safety) + `.claude-plugin/marketplace.json`.
- Codex: `.codex-plugin/plugin.json` + `.mcp.json`; marketplace `.agents/plugins/marketplace.json` → `./plugins/report-baby` (wrapper z osobnym `start-mcp.js` pobierającym bundle do `~/.report-baby`).

## Repo & CI
- GitLab: `treetank/report-baby` (origin, primary).
- GitHub: `treetank-net/report-baby` (mirror, remote `gh`, branch `main`).
- REPO_RAW (`start-mcp.js`, `update_plugin`): `https://raw.githubusercontent.com/treetank-net/report-baby/main`.

## Commands
- `cd server && npm install && npm run build` — zależności (dev) + typecheck + bundle.
- `cd server && npm run dev` — watch typecheck (`tsc --watch --noEmit`); bundle przebuduj ręcznie.
- `cd server && npm start` — uruchom MCP server z bundle.cjs.

## Build
1. `cd server && npm install` — zależności dev (resvg-wasm, jspdf, jspdf-autotable, esbuild, typescript).
2. `npm run build` — robi dwie rzeczy:
   - `tsc --noEmit` — typecheck (assety .wasm/.ttf rozpoznawane przez `assets.d.ts`),
   - `esbuild src/index.ts --bundle --platform=node --target=node18 --format=cjs --minify --loader:.wasm=binary --loader:.ttf=binary --outfile=bundle.cjs`
     — bundluje BEZPOŚREDNIO z `src/` (nie z `dist/`), bo assety osadzane są przez loadery binarne.

### Co jest w git, a co nie
- `server/src/` (w tym `assets/*.ttf`) — źródła ✓
- `server/bundle.cjs` — samowystarczalny runtime (~6MB: kod + wasm + fonty) ✓
- `server/dist/` — nie powstaje (tsc tylko `--noEmit`) ✗
- `server/node_modules/` — zależności dev ✗ (.gitignore) — NIE są potrzebne w runtime

## Config
Env vars:
- `REPORT_BABY_DATA` — katalog danych/konfiguracji (domyślnie `~/.report-baby`); output trafia do `<data>/out`.
