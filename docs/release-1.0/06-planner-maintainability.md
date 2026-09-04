# Plan 06 — utrzymywalność planera

Status: mapa modułów i trzy bezpieczne seamy wydzielone; dalsze wydzielanie
wymaga testów zachowania po każdym kroku

## Wykonane w pierwszym kroku

- mapa odpowiedzialności znajduje się w
  [`docs/composition/modules.md`](../composition/modules.md) i jest częścią
  kanonicznej dokumentacji composition;
- generowanie pozycji coarse/refinement dla ruchomego insertionu zostało
  wydzielone do `composition/text-planner-candidates.ts`;
- wrapping słów, dostępne przedziały i kontynuacja przez flow barriers zostały
  wydzielone do `composition/text-wrapping.ts`;
- projekcja `flowPlacements` i dzielenie obszarów tekstu przez grafiki
  opływane zostały wydzielone do `composition/flow-barriers.ts`;
- `createTextCompositionPlanner` zachował ten sam interfejs, a testy nadal
  obserwują zachowanie przez publiczny planner i engine;
- composition gate potwierdza niezmienione planowanie, scoring, rendering,
  debug oraz realny editorial.

To wydzielenie jest techniczne, nie domenowe: nie powstał nowy rodzaj contentu
ani nowa encja. Moduł kandydatów przyjmuje istniejące propozycje i politykę
ruchu, a zwraca ograniczony, deterministyczny zbiór wariantów. Nie zna flow,
wrappingu, evaluatora ani renderera.

## Cel

Kod ma być możliwy do zrozumienia i rozszerzania bez ryzyka, że zmiana
wrappingu zmieni routing grafiki albo ochronę nagłówka.

## Stan obecny

`server/src/composition/text-planner.ts` ma około 2240 linii. `planFlow` ma
około 666 linii i łączy m.in. cursor po stronie i route, insertiony, kolizje,
grafiki, tabele, growth, wrapping, heading keeps, fragment limits, placements,
reflow i diagnostykę.

To nie oznacza, że każdą funkcję trzeba skrócić. Problemem jest skupienie wielu
odpowiedzialności i stanu mutable w jednym przebiegu.

`server/src/composition/report-shadow.ts` ma inną klasę problemu: nie jest
drugim plannerem ani rendererem, tylko adapterem produkcyjnej ścieżki, który
łączy przygotowanie danych, konfigurację PDF, metryki jsPDF, capability
renderera i wywołanie composition engine. Historyczna nazwa utrudnia
znalezienie właściciela, ale mechaniczne dzielenie pliku przed mapą call
site’ów mogłoby tylko rozproszyć seam.

## Kroki

1. Zabezpieczyć obecne zachowanie testami przez istniejące publiczne seamy.
2. Opisać wejścia i wyjścia `planFlow`, `planDocumentOnce`, wrappingu,
   placementów, obstacles, blocks i trace.
3. Wskazać fragmenty, które są czystymi obliczeniami i mogą zostać wydzielone
   bez zmiany kontraktu. Pierwszy wybrany seam to generowanie wariantów
   ruchomego insertionu, opisane w `docs/composition/modules.md`.
4. Wydzielać tylko istniejące odpowiedzialności:
   - routing;
   - wrapping i breakpointy;
   - obstacles i flow barriers;
   - blocks;
   - insertiony;
   - trace.
5. Po każdym wydzieleniu uruchamiać composition gate i test realnego
   editorialu.
6. Nie przenosić decyzji do rendererów i nie rozdzielać kodu według samych
   rozmiarów funkcji.
7. Dodać krótką mapę modułów do dokumentacji normatywnej, wskazującą właściciela
   każdej reguły.
8. Zabezpieczyć osobny, mały seam pomiaru artefaktu: parser PDF i gate nie
   powinny być splecione z regułami planera. Test błędnego dekodowania ma
   jednoznacznie odróżniać „brak treści w dokumencie” od „nie umiem odczytać
   treści z PDF-a”.
9. Po audycie call site’ów nazwać `report-shadow.ts` zgodnie z jego rolą
   adaptera albo zachować nazwę tylko jako świadomie tymczasowy alias. Usunąć
   `renderReportCompositionShadowPdf`, gdy nie będzie już publicznym call
   site’em; nie utrzymywać dwóch nazw dla dwóch rzekomo różnych rendererów.
10. Dodać mapę własności konfiguracji do dokumentacji modułów: evaluator,
    planner policy adapter, jsPDF capability adapter i visual-QA muszą mieć
    osobne źródła ustawień oraz test przeciwko przypadkowemu odczytowi z
    niewłaściwej grupy.

## Kryteria ukończenia

- maintainer może znaleźć planner, evaluator i renderer z jednego dokumentu;
- nowe zachowanie ma test na właściwym seamie;
- `planFlow` nie jest miejscem, w którym trzeba zmieniać każdą niezależną
  regułę jednocześnie;
- planowanie pozostaje niezależne od jsPDF poza capability seamem;
- composition gate i realny editorial są zielone po refaktoryzacji.
- `report-shadow` ma jedną udokumentowaną rolę i nie tworzy równoległej
  ścieżki planowania/renderowania;
- każdy konfigurowalny próg ma jednego właściciela i nie jest kopiowany do
  innego modułu jako literal.

## Wymaga uzupełnienia po wykonaniu punktu X

- Docelowy podział plików wymaga uzupełnienia po punktach 2 i 3, bo dopiero
  analiza przepływu stanu pokaże bezpieczne granice.
- Zakres refaktoryzacji `planFlow` wymaga uzupełnienia po planie 04. Pętla może
  ujawnić, że pierwszym seamem powinno być generowanie wariantów, a nie routing.
- Kryteria wydajności wymagają uzupełnienia po benchmarku z planu 04.
- Docelowa nazwa i podział `report-shadow` wymagają uzupełnienia po audycie
  publicznych eksportów i call site’ów z planu 01.

## Poza zakresem

Nie wprowadzamy nowych encji domenowych i nie dzielimy pliku wyłącznie po to,
aby każda funkcja miała mniej niż 100 linii.
