# Release 1.0 — plany wykonawcze

Status: punkty 01–05 są w większości wykonane w ograniczonym zakresie, punkt 06
jest w większości wykonany, punkty 07–08 są wykonane dla zakresu release’u, a punkt 09 nie
został rozpoczęty. Organizacja modułów 10–11 została wykonana jako praca
utrzymaniowa bez zmiany kontraktu MCP/CLI. Punkt 12 jest zaplanowany i nie został
jeszcze rozpoczęty.

Ten katalog rozbija [główny plan release 1.0](../release-1.0-flow-composition-plan.md)
na osobne dokumenty wykonawcze. Dokumenty opisują istniejące pojęcia: input,
flow, block, template, geometry, placement, obstacle, planner, evaluator,
renderer, debug i trace. Nie wprowadzają nowego modelu domenowego.

Aktualny kontrakt systemu i uzasadnienia decyzji są utrzymywane w osobnym,
kanonicznym katalogu [Composition](../composition/README.md). Ten katalog
opisuje kolejność prac i kryteria ich ukończenia; nie zastępuje dokumentacji
aktualnego zachowania.

## Cel release’u

```text
CompositionInput → flows → planner → placements → evaluator → renderer
```

Chcemy mieć jeden deterministyczny przebieg, w którym:

- planner wylicza placements przed rysowaniem;
- evaluator rozdziela legalność od jakości układu;
- planner może przygotować ograniczone alternatywy i wykorzystać feedback;
- renderer, zwykły PDF, debug i `dry_run` opisują ten sam plan;
- dodanie obsługi kolejnego istniejącego block kind nie wymaga poznawania
  starego modelu `ReportData` ani `Cursor`.

## Kolejność i zależności

```text
01 pipeline i kontrakt
        ↓
02 geometria i wspólne ramy
        ↓
03 evaluator i score
        ↓
04 pętla planner–evaluator
        ↓
05 render, dry_run i debug
        ↓
06 utrzymywalność planera
        ↓
07 kolejne block kinds i miękkie insertiony
        ↓
08 głębokość wyszukiwania kandydatów
        ↓
09 ciągłość struktur, formaty obrazów i czas feedbacku testów
        ↓
10 kategorie i migracja modułów composition
        ↓
11 domenowe uporządkowanie całego server/src
        ↓
12 dynamiczny page chrome i powtarzalne flow
```

Kroki 01–03 są fundamentem. Krok 04 daje pierwszą faktyczną optymalizację.
Krok 06 nie powinien rozpoczynać się od mechanicznego dzielenia `planFlow`:
najpierw muszą istnieć testy i działający seam dla pętli.

## Stan wykonania — 2026-09-09

| Punkt | Stan implementacji | Co pozostaje |
|---|---|---|
| 01 | w większości wykonany | audyt eksportów, aliasów i pozostałych legacy ścieżek |
| 02 | wykonany | wspólna geometria ramek, placementów, obstacles i chrome |
| 03 | wykonany funkcjonalnie | kalibracja wag i przypadki graniczne evaluatora |
| 04 | wykonany w ograniczonym zakresie | tylko jawne, deterministyczne ruchy; bez globalnego solvera |
| 05 | w większości wykonany | inline runs, gap-tightening; pełna własność chrome jest w punkcie 12 |
| 06 | w większości wykonany | utrzymanie publicznego gate’u; znany, wcześniejszy `EMPTY_FLOW_SLOT`; dalsze seam’y tylko z konkretnym kontraktem |
| 07 | wykonany dla obecnych block kinds | nowe rodzaje bloków wymagają osobnego capability seam’u |
| 08 | wykonany dla wyszukiwania composition | formaty JPEG/SVG/WebP/AVIF pozostają w zakresie punktu 09 |
| 09 | nierozpoczęty | ciągłość list/tabel, WebP/AVIF i budżet czasu feedbacku |

Ta tabela jest nadrzędnym skrótem statusu. Szczegółowe dokumenty zachowują
historię decyzji i kryteria.

## Dokumenty

1. [Pipeline i kontrakt](01-pipeline-and-contract.md) — jeden wynik planowania,
   jeden przebieg i naprawa contract harnessu.
2. [Geometria i wspólne ramy](02-geometry-and-frames.md) — gdzie powstają
   sloty, segmenty, obstacles, flow barriers i boxy kandydatów.
3. [Evaluator i score](03-evaluator-and-scoring.md) — hard violations,
   jakość legalnego układu, konfiguracja i czystość ewaluacji.
4. [Pętla planner–evaluator](04-planner-evaluator-loop.md) — ograniczone
   kandydaty, feedback, wybór najlepszego legalnego planu i koszt.
5. [Render, dry_run i debug](05-render-dry-run-debug-parity.md) — zgodność
   planu z PDF-em, debugiem i odpowiedzią narzędzia.
6. [Utrzymywalność planera](06-planner-maintainability.md) — bezpieczne
   wydzielanie odpowiedzialności z obecnego monolitu.
7. [Block kinds i miękkie insertiony](07-block-kinds-and-soft-insertions.md) —
   dalsze rozszerzenie na KPI, wykresy, grafiki i cytaty.
8. [Głębokość wyszukiwania kandydatów](08-candidate-search-depth.md) —
   sprawdzenie, czy zgrubne pozycje i lokalne doprecyzowanie szukają dostatecznie
   dokładnie bez niekontrolowanego wzrostu kosztu.
9. [Ciągłość struktur i formaty obrazów](09-structure-penalties-and-image-formats.md) —
   kary za dzielenie list i tabel, WebP/AVIF oraz końcowa optymalizacja czasu
   feedbacku testów.
10. [Kategorie i migracja modułów composition](10-composition-module-migration.md) —
    docelowa mapa katalogów, właściciele odpowiedzialności i kolejność
    przenoszenia plików bez katalogu `runtime/`.
11. [Domenowe uporządkowanie całego `server/src`](11-src-domain-organization.md) —
    mapa poza `composition/`, MCP-first, opcjonalne CLI, artefakty release i
    bezpieczna migracja szablonów.
12. [Dynamiczny page chrome i powtarzalne flow](12-dynamic-page-chrome.md) —
    content-driven header/footer, istniejące placeholdery numeracji stron,
    kolejność względem insertionów i `main`, oraz pełna projekcja chrome z planu.

## Granica wykonalności

Research wykazał, że ograniczona pętla jest realna bez wymiany backendu PDF.
Nie obejmuje to na tym etapie globalnego solvera całego dokumentu, arbitralnych
constraintów, pełnych floatów ani RTL/CJK. Szczegóły i źródła są w
[raporcie wykonalności](../research/release-1.0-feasibility-research.md).

Jeżeli któryś dokument oznacza punkt jako „wymaga uzupełnienia po X”, nie jest
to ukryta decyzja implementacyjna. Oznacza to, że obecny kod nie daje jeszcze
podstaw do bezpiecznego opisania szczegółu i należy go doprecyzować po
wykonaniu wskazanego punktu.
