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
- [ ] Więcej fontów do wyboru, docelowo pod życzenia klientów. Dwa różne koszty: w PPTX font jest tylko NAZWĄ (`fontFace`), więc `font_face` jako parametr `render_slides_pptx` to kilka linii i zero wagi bundla — dziś twardo `Aptos` / `Aptos Display`, co Canva podstawia zamiennikiem i rozjeżdża layout. Dla PNG/PDF font musi być OSADZONY (resvg `fontBuffers` + VFS jsPDF), czyli każda rodzina to ~+700 KB bundla — stąd paleta 2–3 rodzin (patrz subset Inter/Roboto w Fazie 3) plus opcja wskazania własnego `.ttf` ścieżką z dysku, żeby Brand Kit klienta nie obciążał bundla.
- [ ] Deck-as-JSON jako źródło prawdy: model slajdów leży w pliku JSON, „dodaj slajd" = dopisanie wpisu i przerenderowanie całości. Zostajemy bezstanowi i deterministyczni, iterowanie na jednym decku bez ryzyka korupcji cudzego pliku. To fundament pod dwa punkty poniżej.
- [ ] Merge do NOWEGO pliku: czytamy `source.pptx`, emitujemy `output.pptx` = obce slajdy + nasze, nigdy nie nadpisując wejścia. Nasze slajdy przyjdą z własnym layoutem i nie odziedziczą mastera klienta — fonty i kolory trzeba będzie mapować świadomie.
- [ ] Edycja istniejącego pliku przez `pptx-automizer` (npm, MIT, 0.9.0), NIE przez ręczną chirurgię na XML. Biblioteka jest zbudowana pod ten scenariusz: czyta istniejące pptx jako szablony, wstawia wybrane slajdy i pojedyncze elementy do innej prezentacji, modyfikuje treść callbackami na xmldom i owija pptxgenjs dla nowych elementów. Ręczne dłubanie w `presentation.xml` / `[Content_Types].xml` / relacjach jest teoretycznie „bezpieczne", ale kompatybilność z PowerPointem, Keynote, Google Slides i Canvą to pole minowe, którego nie chcemy utrzymywać sami. Zastrzeżenia do sprawdzenia przed wdrożeniem: `engines: node >=20` podnosi nam próg z node18; zależy od `pptxgenjs@^3.12.0`, a my jesteśmy na 4.0.1 (dwie kopie w bundlu albo downgrade); `extract-zip` pracuje na katalogu tymczasowym, więc silnik przestaje być czysto in-memory; API jest przed 1.0.
