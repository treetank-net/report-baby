# Roadmap — report-baby

## Faza 1 — silnik renderujący (DONE, v0.2.0)
- [x] Porzucić Playwright/Chromium — nie bundluje się, crashował na świeżej maszynie bez Chromium.
- [x] Silnik SVG → PNG przez `resvg-wasm` (czyste WASM, zero binarki przeglądarki).
- [x] Silnik PDF przez `jsPDF` + `jspdf-autotable`, font DejaVu Sans osadzony (pełne diakrytyki).
- [x] Bundle zero-deps: `--loader:.wasm=binary --loader:.ttf=binary`, esbuild z `src/`.
- [x] `svg.ts`: bar / line / donut charts + metric cards z surowych danych.
- [x] Toole: `render_chart`, `render_metric_cards`, `render_svg`, `render_report`, `list_templates`.

## Faza 2 — bogatsze wykresy i szablony
- [ ] Wykres słupkowy grupowany / skumulowany (wiele serii).
- [ ] Wykres liniowy z wieloma seriami + legendą.
- [ ] Wykres poziomy (horizontal bar) dla długich etykiet kategorii.
- [ ] Kolejne szablony raportów (one-pager, comparison, dashboard-grid).
- [x] Walidacja danych szablonu/wykresu (zod) zamiast luźnego `record` (v0.3.1).

## Faza 3 — branding i layout
- [ ] Logo klienta (PNG/SVG data URI) w nagłówku raportu.
- [ ] Konfigurowalna paleta akcentu / motyw per klient.
- [ ] Lżejszy font (subset Roboto/Inter) zamiast pełnego DejaVu — mniejszy bundle.
- [ ] Orientacja landscape dla raportów szerokich (dużo kolumn w tabeli).

## Faza 4 — integracje
- [ ] Wejście danych wprost z `google-ads-baby` / `google-analytics-baby` (closed-loop raport).
- [ ] Eksport pojedynczego wykresu również do SVG (wektor do dalszej edycji), nie tylko PNG.

## Faza 5 — prezentacje
- [x] Wspólny ograniczony model slajdów + `render_slides_pdf` / `render_slides_png` / `render_slides_pptx` (v0.4.0).
- [ ] Wektorowy `render_slides_pdf`. Dziś każdy slajd trafia do PDF jako jeden pełnostronicowy raster 1600×900, czyli ~102 DPI na stronie 400×225 mm: tekst nie jest zaznaczalny ani wyszukiwalny, a przy zoomie i w druku mięknie. Rysować tekst, kształty, KPI i tabele wprost przez jsPDF (tak jak `templates.ts` robi to dla A4), a rastrować wyłącznie same wykresy. PNG i PPTX zostają bez zmian.
