# Release 1.0 — plany wykonawcze

Status: plan do implementacji

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
```

Kroki 01–03 są fundamentem. Krok 04 daje pierwszą faktyczną optymalizację.
Krok 06 nie powinien rozpoczynać się od mechanicznego dzielenia `planFlow`:
najpierw muszą istnieć testy i działający seam dla pętli.

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

## Granica wykonalności

Research wykazał, że ograniczona pętla jest realna bez wymiany backendu PDF.
Nie obejmuje to na tym etapie globalnego solvera całego dokumentu, arbitralnych
constraintów, pełnych floatów ani RTL/CJK. Szczegóły i źródła są w
[raporcie wykonalności](../research/release-1.0-feasibility-research.md).

Jeżeli któryś dokument oznacza punkt jako „wymaga uzupełnienia po X”, nie jest
to ukryta decyzja implementacyjna. Oznacza to, że obecny kod nie daje jeszcze
podstaw do bezpiecznego opisania szczegółu i należy go doprecyzować po
wykonaniu wskazanego punktu.
