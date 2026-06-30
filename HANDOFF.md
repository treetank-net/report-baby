# Handoff — dokończenie `report-baby`

MCP server renderujący ładne raporty: HTML/dane → PDF/PNG przez headless Chromium (Playwright).
Cross-client, zero OAuth/safety. Członek rodziny `*-baby`. Szkielet gotowy — zaimplementuj stuby.

## Stan na teraz (gotowe)
- Pełna struktura (manifesty, scripts, server/src) — patrz `CLAUDE.md`.
- `check_update` zaimplementowany. Toole w `server/src/tools/render.ts` to STUBY (`not implemented yet`).
- `server/src/render.ts` — stuby silnika. `server/src/templates.ts` — realny szablon `default-report` + stuby.
- `start-mcp.js` ma best-effort detekcję chromium per-OS + `npx playwright install chromium` przy braku.

## Kontrakt projektu (NIE łam)
- **Toole zwracają ŚCIEŻKĘ do pliku**, nie obraz do kontekstu LLM. Powód: deliverable dla człowieka,
  a wciąganie obrazu jest drogie i mniej dokładne niż surowe dane. Wyjątek: flag `return_image`
  (domyślnie false) na toolach obrazkowych — wtedy zwróć też MCP image content.
- Silnik: **Playwright headless Chromium**. NIE wkhtmltopdf (zarchiwizowany, łamie nowoczesny CSS).
- Wykresów NIE reimplementujemy — HTML wejściowy może mieć inline Chart.js / wykresy z osobnego chart-MCP.
- Bez komentarzy w kodzie. `npm run build` po każdej zmianie. `index.ts` w `async main()`.

## Trade-off dystrybucji (do ROZWIĄZANIA — pkt 1)
W przeciwieństwie do reszty rodziny tu NIE ma zero-deps single-bundle: Chromium to ~150MB binarka.
Build używa `--external:playwright`, więc runtime WYMAGA `node_modules/playwright` + chromium.
Decyzja do podjęcia: (a) `npx playwright install chromium` przy starcie, czy
(b) preferować systemowy Chrome przez `channel: 'chrome'` (`REPORT_BABY_CHROMIUM_CHANNEL`) bez pobierania.
Patrz sekcja „Dystrybucja" w `CLAUDE.md`.

## Kroki

### 0. Build bazowy
```
cd server && npm install && npx playwright install chromium && npm run build
```

### 1. Silnik (`render.ts`)
Zaimplementuj na Playwright:
- `launchBrowser(cfg)` → `chromium.launch({ channel: cfg.chromiumChannel || undefined })`.
- `renderHtmlToPdf(cfg, html, outputPath, options)` → `page.setContent(html, {waitUntil:'networkidle'})`,
  `page.pdf({ path: outputPath, format, landscape, margin, printBackground })`. Zwróć `outputPath`.
- `renderHtmlToImage(cfg, html, outputPath, options)` → `page.screenshot({ path, fullPage, type })`,
  uwzględnij `width/height` (`page.setViewportSize`) i `device_scale_factor`.
- `renderUrlToPdf/Image` → jak wyżej, ale `page.goto(url, {waitUntil:'networkidle'})`.
- Domyślny katalog wyjścia z `config.ts` (`getConfigDir()/out`), twórz go jeśli brak; generuj nazwę pliku
  gdy `output_path` nie podano.

### 2. Toole (`tools/render.ts`)
Zamień stuby na realne wywołania `render.ts`. Walidacja html XOR html_path jest już (`requireHtmlXor`).
**Napraw rozbieżność**: `render_report.margin` w schemacie zod jest stringiem, a `PdfOptions.margin`
w silniku to obiekt — dodaj mapowanie (np. `"20px"` → `{top:'20px',right:'20px',bottom:'20px',left:'20px'}`).

### 3. Szablon raportu (`templates.ts`)
Dopracuj `default-report` do realnego deliverable: nagłówek z miejscem na branding, sekcje, tabela metryk,
miejsce na wykresy (inline `<canvas>` + Chart.js z CDN lub data-URI). `render_report` = `renderTemplate(name,data)`
→ `renderHtmlToPdf/Image`. Dodaj 1-2 kolejne szablony jeśli sensowne (`list_templates`).

### 4. Test e2e
Wyrenderuj przykładowy raport do PDF i PNG, sprawdź że plik powstaje i ścieżka wraca w odpowiedzi.
Sprawdź `return_image: true` na obrazku.

### 5. Release (gdy działa)
Bump wersji w root `package.json` + `server/package.json` + oba manifesty. Wpis w `CHANGELOG.md`.
Załóż repo GitLab `treetank/report-baby` + GitHub mirror `treetank-net/report-baby`.

Architektura, odrzucone opcje (wkhtmltopdf, Artifact-only) i decyzje: `CLAUDE.md`. Plan: `ROADMAP.md`.
