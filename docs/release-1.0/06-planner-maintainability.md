# Plan 06 — utrzymywalność planera

Status: mapa modułów, integracja runtime oraz wydzielone odpowiedzialności;
`planFlow` ma własny moduł, a dalsze wydzielanie wymaga testów zachowania po
każdym kroku

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
- rozwiązywanie authored/generated glyphów względem końcowych ramek tekstu lub
  grafiki zostało wydzielone do `composition/glyph-objects.ts`;
- budowanie pełnych komórek próbkowania kontrastu dla widocznych znaków zostało
  wydzielone do `composition/glyph-sampling.ts`;
- sprawdzanie zgodności bloku ze slotem i wybór pierwszego zgodnego miejsca w
  route zostały wydzielone do `composition/route-slots.ts`;
- wyszukiwanie następnego insertionu i wyznaczanie jego granicy względem tekstu
  zostały wydzielone do `composition/insertion-order.ts`;
- publiczny test `test-text-composition-engine.mjs` ma jawny kontrakt pętli:
  stabilny plan, plan wymagający ponownego pełnego planowania, grafikę z
  wykluczeniem, tabelę/KPI oraz skończone końcowe bounds wszystkich placementów;
- kontrakt rozróżnia jednorazową kontrolę stabilności od dodatkowego pełnego
  planowania: pierwszy przypadek ma jednego kandydata, a przypadek przesuniętego
  insertionu ma dwa kandydaty;
- `createTextCompositionPlanner` zachował ten sam interfejs, a testy nadal
  obserwują zachowanie przez publiczny planner i engine;
- composition gate potwierdza niezmienione planowanie, scoring, rendering,
  debug oraz realny editorial.
- własność konfiguracji jest sprawdzana przez test dokumentacji: rdzeń planera
  nie czyta YAML, evaluator nie czyta `quality` ani `composition_search`, a
  pomiar kontrastu nie ładuje konfiguracji samodzielnie; `pdf` jest mapowane do
  polityki planera w jednym resolverze adaptera `text-engine.ts`.
- przygotowanie runtime raportu zostało wydzielone do
  `report-composition-runtime.ts`; zasoby, capability i backend są składane
  tam, a `report-renderer.ts` zachowuje chrome, debug overlay i zapis artefaktu.
- projekcja śladu gotowego planu została wydzielona do
  `composition/planning-trace.ts`, a wspólne liczenie pełnych linii do
  `composition/line-capacity.ts`; planner nadal wywołuje te funkcje dopiero po
  zakończeniu placementu i normalizacji kolejności.
- obsługa tabel i bloków atomowych została wydzielona do
  `composition/structured-block-placement.ts`; moduł zachowuje istniejący
  cursor i zapisuje te same placementy, decyzje oraz diagnostykę. Grafika
  opływana nadal tworzy w tym samym miejscu flow barrier.
- `planFlow` oraz jego flow-specific state i operacje zostały wydzielone do
  `composition/flow-planner.ts`; `planDocumentOnce` importuje `planFlow` z tego
  modułu. Wydzielenie zachowuje istniejący kontrakt, kolejność bloków, decyzje,
  diagnostykę i zachowanie stron.
- odczyt selectable text i word bounds został wydzielony z oracle do
  `scripts/lib/pdf-text.mjs`; pusty tekst poprawnego PDF-a jest wynikiem
  pomiaru, a niedostępny lub uszkodzony dekoder ma osobny kod błędu. Oracle
  nadal decyduje dopiero później, czy brak oczekiwanych tokenów oznacza fail.

W tym punkcie planu zakończono także opisane wcześniej seam-y integracji,
candidate generation, wrappingu, flow barriers, glyphów, próbkowania,
slotów, insertion order, trace, bloków strukturalnych, PDF extraction oraz
pierwszą granicę `flow-planner.ts`. Nie rozbijamy teraz `planFlow` mechanicznie
na kolejne pliki: najpierw obserwujemy tę granicę w testach, a dopiero potem
decydujemy, czy kolejny seam powinien dotyczyć dokumentu, stron, czy konkretnej
reguły flow.

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

`server/src/composition/report-composition-entrypoint.ts` ma inną klasę problemu: nie jest
drugim plannerem ani rendererem, tylko adapterem produkcyjnej ścieżki, który
łączy przygotowanie danych, metryki jsPDF, capability renderera i wywołanie
composition engine. Domyślna polityka PDF jest mapowana wyłącznie w
`text-engine.ts`; entrypoint przekazuje ją przez ten seam i nie utrzymuje
drugiej mapy pól. Historyczna nazwa utrudniała znalezienie właściciela, ale
mechaniczne dzielenie pliku przed mapą call site’ów mogłoby tylko rozproszyć
seam.

Przygotowanie zasobów i capability zostało wydzielone z `report-renderer.ts` do
`report-composition-runtime.ts`. Ten moduł nie podejmuje decyzji layoutowych:
składa istniejące dane, fonty, assety, kontrast, capability i backend wokół
`report-composition-entrypoint.ts`. Chrome i zapis finalnego artefaktu pozostają
w `report-renderer.ts`.

## Ustalenie dla następnej fazy redukcji kodu (2026-09-07)

Nie rozcinamy funkcji ani plików tylko dlatego, że mają dużo linii. Najpierw
przenosimy całe istniejące funkcje do właściciela odpowiedzialności, a dopiero
potem sprawdzamy, czy w module zostały powtórzenia lub ręczne obliczenia,
które powinny stać się małymi, nazwanymi funkcjami obliczeniowymi. Długi plik
jest dopuszczalny, jeśli opisuje jedną spójną dziedzinę; długość jest sygnałem
do przeglądu, nie kryterium podziału.

Zapisy decyzji mają być jednym seamem. `recordFlowDecision` przyjmuje istniejący
`FlowPlanningContext`, nazwę zdarzenia oraz opcjonalne obiekty `FlowRuntime` i
`FlowTarget` (tylko te, które dana funkcja już posiada), a z nich sam buduje
opcjonalne pola `flowId`, `blockId`, `page`, `slotId` i `routeIndex`. Wywołujący
nie konstruuje obiektu decyzji ani nie przekazuje ponownie identyfikatorów;
może dodać jedynie `reason`. Brakującego obiektu lub pola nie zastępujemy
syntetyczną wartością — pole pomijamy. Szczegóły specyficzne dla zdarzenia
muszą pozostać w stanie próby albo zostać później przypisane do właściwej
funkcji obliczeniowej, a nie wracać jako literal przy wywołaniu recordera.

Po każdym takim kroku ponownie generujemy inventory zależności i sprawdzamy,
czy evaluator nie opiera się na polu, które zostało usunięte z artefaktu
decyzji. Najpierw wykrywamy dokładne i semantyczne duplikaty, wybieramy jednego
właściciela i dopiero wtedy usuwamy kopie. Rozdzielenie funkcji jest skutkiem
przekroczenia granicy odpowiedzialności, nigdy celem samym w sobie.

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
9. Po audycie call site’ów utrzymać `report-composition-entrypoint.ts` jako
   pojedynczy punkt wejścia do planowania raportu. Nie utrzymywać drugiej nazwy
   ani aliasu sugerującego równoległy renderer.
10. Dodać mapę własności konfiguracji do dokumentacji modułów: evaluator,
    planner policy adapter, jsPDF capability adapter i visual-QA muszą mieć
    osobne źródła ustawień oraz test przeciwko przypadkowemu odczytowi z
    niewłaściwej grupy.
11. Kontynuować wydzielanie z `planFlow` tylko przez istniejące, testowalne
    odpowiedzialności. Pierwsza granica `flow-planner.ts` jest już wykonana;
    kolejne rozbicie wymaga osobnego testu zachowania i nie może wprowadzać
    wrappera na wrapperze ani przenosić operacji dokumentowych do kursora.

## Kryteria ukończenia

- maintainer może znaleźć planner, evaluator i renderer z jednego dokumentu;
- nowe zachowanie ma test na właściwym seamie;
- `planFlow` nie jest miejscem, w którym trzeba zmieniać każdą niezależną
  regułę jednocześnie;
- trace planu i obliczanie capacity nie są implementowane jako prywatne kopie w
  `text-planner.ts`;
- planowanie pozostaje niezależne od jsPDF poza capability seamem;
- odczyt PDF-a nie jest spleciony z regułami planera ani scoringiem;
- composition gate i realny editorial są zielone po refaktoryzacji.
- punkt wejścia composition ma jedną udokumentowaną rolę i nie tworzy równoległej
  ścieżki planowania/renderowania;
- każdy konfigurowalny próg ma jednego właściciela i nie jest kopiowany do
  innego modułu jako literal.

## Wymaga uzupełnienia po wykonaniu punktu X

- Docelowy podział plików po pierwszym `flow-planner.ts` wymaga uzupełnienia po
  kolejnych testach stanu `planFlow`; obecna mapa nie zakłada, że cały planner
  trzeba rozbić na mniejsze funkcje.
- Zakres dalszej refaktoryzacji `planFlow` wymaga uzupełnienia po obserwacji
  nowej granicy i testach odpowiedzialności dokumentu oraz stron. Nie wolno
  wyprowadzać tej decyzji z samej długości funkcji.
- Kryteria wydajności wymagają uzupełnienia po benchmarku z planu 04.
- Docelowy podział konfiguracji stylów wymaga uzupełnienia po kolejnych
  testach capability adapterów; obecnie `render-config-styles.ts` jest osobnym
  modułem bez reguł planowania.

## Poza zakresem

Nie wprowadzamy nowych encji domenowych i nie dzielimy pliku wyłącznie po to,
aby każda funkcja miała mniej niż 100 linii.
