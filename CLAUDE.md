# report-baby

Claude Code plugin: MCP server do renderowania ładnych raportów — HTML/dane → PDF/PNG przez headless Chromium.
Członek rodziny pluginów `*-baby` (obok `google-ads-baby`, `meta-ads-baby`, planowanego `google-analytics-baby`).
Najprostszy, najczystszy członek rodziny: czysty compute renderujący, działa lokalnie.

## Architektura

Plugin = MCP server (stdio). **ZERO OAuth, zero safety/hooków, zero mutacji zewnętrznych, zero API kont reklamowych.**
Renderuje lokalnie HTML do pliku i zwraca ścieżkę.

### Silnik renderujący
- **Headless Chromium przez Playwright** (`playwright`).
- Flow: `chromium.launch()` → `page.setContent(html)` / `page.goto(url)` → `page.pdf()` / `page.screenshot()`.
- Nowoczesny CSS (flex, grid, web fonts, `@media print`) działa, bo to prawdziwy aktualny Chromium.

### Kontrakt zwracania: ŚCIEŻKA do pliku, nie obraz do kontekstu
- Toole renderujące domyślnie zapisują plik i zwracają jego ścieżkę w treści tekstowej.
- Powód: deliverable jest dla CZŁOWIEKA na koniec (np. raport dla klienta). LLM dokładniej czyta surowe
  liczby ze źródła niż piksele wykresu, a wciąganie obrazu do kontekstu jest drogie.
- Opcjonalny flag `return_image: boolean` (domyślnie `false`) na toolach obrazkowych — dla obrazów zwraca
  też MCP image content. Używaj TYLKO gdy LLM faktycznie ma ocenić layout/estetykę, nie do odczytu danych.

### Wykresy — poza zakresem
- **NIE reimplementujemy silnika wykresów.** HTML przekazany do renderu MOŻE zawierać inline Chart.js /
  pre-renderowane SVG (np. wstrzyknięte przez generator HTML albo osobny chart-MCP typu QuickChart /
  AntV `mcp-server-chart`). report-baby tylko rasteryzuje/paginuje gotowy HTML.

### Source layout (`server/src/`)
```
index.ts            — entrypoint: tworzy McpServer, rejestruje toole (render + auth), startuje stdio. W async main().
config.ts           — ReportConfig { outputDir, chromiumChannel? }, configFromEnv(), getConfigDir() → .report-baby
errors.ts           — formatError()
render.ts           — silnik: launchBrowser(), renderHtmlToPdf/Image(), renderUrlToPdf/Image() (na razie stuby)
templates.ts        — listTemplates(), renderTemplate(name, data) → HTML string; wbudowany 'default-report'

tools/
  render.ts         — registerRenderTools(): render_html_to_pdf/image, render_url_to_pdf/image, render_report, list_templates
  auth.ts           — registerAuthTools(): check_update (self-update). BRAK setup_auth — nie ma OAuth.
```

### Toole
- `render_html_to_pdf` { html? | html_path?, output_path?, options? } — HTML → PDF, zwraca ścieżkę.
- `render_html_to_image` { html? | html_path?, output_path?, options?, return_image? } — HTML → PNG/JPEG.
- `render_url_to_pdf` { url, output_path?, options? } — URL → PDF.
- `render_url_to_image` { url, output_path?, options?, return_image? } — URL → PNG/JPEG.
- `render_report` { template?='default-report', data, output_path?, format?='pdf'|'png' } — OPINIONATED:
  wbudowany ostylowany szablon + dane → plik. To "ładne raporciki na koniec".
- `list_templates` {} — lista dostępnych szablonów.
- `check_update` {} — sprawdź/zainstaluj aktualizacje pluginu.

Walidacja: tam gdzie dotyczy, podaj `html` XOR `html_path` (dokładnie jedno).

## Dystrybucja — dlaczego inaczej niż reszta rodziny

`google-ads-baby` dystrybuuje pojedynczy `bundle.cjs` z zero-deps runtime, bo `google-ads-api` da się
w całości zbundlować esbuildem. **Tutaj się NIE da** — Chromium to ~150MB binarka pobierana osobno przez
Playwright, nie kod JS do zbundlowania. Konsekwencje (bądźmy szczerzy, nie obiecujemy zero-deps):

1. **esbuild bundluje TYLKO kod aplikacji** z `--external:playwright`. Runtime WYMAGA obecnego
   `node_modules/playwright` + pobranego Chromium. To NIE jest samowystarczalny plik jak w google-ads-baby.
2. **`start-mcp.js` przy pierwszym uruchomieniu wykrywa brak Chromium** i próbuje go dostarczyć.
   Dwa podejścia (wybór dopinamy w osobnym wątku):
   - **(a) `npx playwright install chromium`** — pobiera ~150MB do cache Playwrighta
     (`~/.cache/ms-playwright`). Niezawodne, ale ciężki pierwszy start.
   - **(b) systemowy Chrome przez `channel: 'chrome'`** — `REPORT_BABY_CHROMIUM_CHANNEL=chrome` używa
     zainstalowanego Google Chrome, zero pobierania. Szybciej, ale wymaga Chrome'a na maszynie usera.
   Obecnie `start-mcp.js` robi best-effort `npx playwright install chromium` (try/catch), a jeśli
   ustawiono `REPORT_BABY_CHROMIUM_CHANNEL` — pomija pobieranie i ufa systemowemu kanałowi.
   W razie niepowodzenia wypisuje na stderr komendę do ręcznego uruchomienia.

## Odrzucone opcje

- **wkhtmltopdf** — projekt zarchiwizowany, oparty o stary QtWebKit. Łamie nowoczesny CSS
  (flexbox/grid, współczesne web fonty, część `@media print`). Render wyglądałby inaczej niż w przeglądarce.
  Headless Chromium daje pixel-perfect zgodność z tym, co widać w nowoczesnym Chrome.
- **Artifact na claude.ai** — renderuje ładne HTML, ale działa TYLKO wewnątrz Claude. My chcemy narzędzie
  cross-client (Claude Code, Codex, dowolny klient MCP) renderujące lokalnie do pliku na dysku usera.
- **Zero-deps `bundle.cjs` jak w google-ads-baby** — niemożliwe, Chromium to binarka poza JS (patrz wyżej).

## Jak dodawać rzeczy

**Nowy render tool:**
1. Handler `server.tool('render_...')` → `tools/render.ts`.
2. Jeśli potrzeba nowej funkcji silnika → `render.ts` (sygnatura `(cfg, ..., outputPath, options) => Promise<string>`).
3. Toole zwracają ścieżkę do pliku w treści tekstowej; obraz tylko gdy `return_image: true`.

**Nowy szablon:**
1. Dodaj wpis do `TEMPLATES` i funkcję renderującą w `templates.ts`.
2. Podłącz nazwę w `renderTemplate()`.
3. Szablon to czysty HTML string (inline CSS) — bez zależności runtime, żeby render był self-contained.

**Konwencje:**
- Nie pisz komentarzy w kodzie — nazwy funkcji/zmiennych muszą być samodokumentujące.
- TODO/plany → `ROADMAP.md` i ta sekcja Roadmapa, nie komentarze w kodzie.
- `index.ts` zawinięty w `async function main(){...}` + `main()` (CJS bundle nie znosi top-level await).
- `npm run build` po każdej zmianie w `src/` — bundle.cjs musi być aktualny.

## Plugin Manifests
- Claude Code: `.claude-plugin/plugin.json` (BEZ `hooks` — nie ma safety).
- Marketplace: `.claude-plugin/marketplace.json`.

## Repo & CI
- GitLab: `treetank/report-baby` (origin, primary).
- GitHub: `treetank-net/report-baby` (mirror).
- `.gitlab-ci.yml`: mirror job pushuje `master` + tagi do GitHuba (runner tag `vps`, wymaga `GITHUB_TREETANK_TOKEN`).
- REPO_RAW: `https://raw.githubusercontent.com/treetank-net/report-baby/master`.

## Commands
- `cd server && npm install && npm run build` — zainstaluj zależności, skompiluj TS i zbuduj bundle.
- `cd server && npx playwright install chromium` — pobierz Chromium dla Playwrighta (lub użyj systemowego Chrome).
- `cd server && npm run dev` — watch mode (rebuild TS, bundle ręcznie).
- `cd server && npm start` — uruchom MCP server z bundle.cjs.

## Build
1. `cd server && npm install` — zależności (dev + playwright).
2. `npx tsc` — kompilacja TS → `server/dist/`.
3. `npx esbuild dist/index.js --bundle --platform=node --target=node18 --format=cjs --minify --external:playwright --outfile=bundle.cjs`
   — bundle → `server/bundle.cjs` (Playwright pozostaje external, ładowany z node_modules w runtime).
4. Albo: `npm run build` — robi krok 2 i 3 razem.

### Co jest w git, a co nie
- `server/src/` — źródła TypeScript ✓
- `server/bundle.cjs` — zbundlowany kod aplikacji (BEZ Playwrighta/Chromium) ✓
- `server/dist/` — intermediate z tsc ✗ (.gitignore)
- `server/node_modules/` — zależności runtime (w tym Playwright) ✗ (.gitignore) — WYMAGANE w runtime
- Chromium — pobierany osobno do cache Playwrighta, nigdy w git ✗

## Config
Env vars (set in plugin.json, sourced from user's environment):
- `REPORT_BABY_DATA` — katalog danych/konfiguracji (domyślnie `~/.report-baby`); output trafia do `<data>/out`.
- `REPORT_BABY_CHROMIUM_CHANNEL` — opcjonalnie `chrome` itp., by użyć systemowego Chrome zamiast pobierać Chromium.

## Roadmapa
Szczegóły w `ROADMAP.md`. Fazy:
1. `render_html_to_pdf` / `render_html_to_image` działające e2e + rozwiązanie dystrybucji Chromium.
2. `render_report` z realnym szablonem + branding.
3. Więcej szablonów + `return_image` ścieżka.
4. Integracja z chart-MCP / inline Chart.js w szablonach.
