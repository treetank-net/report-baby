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

## Ponowna analiza flow-plannera — 2026-09-07

Po ponownym przejściu przez [flow-planner.ts](/home/jm/projects/personal/report-baby/server/src/composition/flow-planner.ts) widać, że nie mamy jednego algorytmu, tylko kilka różnych odpowiedzialności sklejonych w jednym pliku.

Obecnie plik ma 1443 linie, ale logicznie można go opisać tak:

```text
planFlow
 ├─ utworzenie kontekstu i kursora
 ├─ kontrola limitów stron
 ├─ zapewnienie bieżącej strony
 ├─ wybór legalnego slotu
 ├─ ścieżka strukturalna:
 │    ├─ image
 │    ├─ table
 │    └─ block/metric/chart
 └─ ścieżka tekstowa:
      ├─ obliczenie zajętości
      ├─ wrapping
      ├─ keep-with-next/list/heading
      ├─ wybór linii
      ├─ placement
      └─ przesunięcie kursora
```

## Rzeczy rzeczywiście wspólne

| Obszar | Obecne funkcje | Wspólny właściciel |
|---|---|---|
| Zgodność bloku ze slotem | `slotFor`, `hasRoleEligibleSlot` | `route-slots.ts` |
| Geometria | `rectBottom`, `rectsOverlap`, `horizontalOverlap` | `page-management` lub mały moduł geometrii |
| Zajętość slotów | `flowingTextBottom`, `occupiedBottomInOverlappingSlots`, funkcje kolizji | `flow-occupancy.ts` |
| Rozrost slotu | `growSlot` (łącznie z obliczeniem delta, resize i przesunięciem zależnych slotów) | `slot-growth.ts` |
| Przesuwanie flow | `advanceCursor` | `flow-cursor.ts` |
| Pomiar tekstu | `lineHeight`, `wrapBlock`, `wordsForBlock` | `text-measurement.ts` |
| Kładzenie linii | `placeLines` | `text-placement.ts` |
| Diagnostyka i decyzje | `diagnostic`, `recordFlowDecision`, residuale | `planning-records.ts` |
| Kładzenie grafik | `placeGraphicsForPage` | `graphic-planning.ts` |

### 1. Wybór slotu

W `route-slots.ts` mamy faktyczne powtórzenie warunków:

- zgodność `flowId`,
- `allowedRoles`,
- `allowedBlockIds`,
- `allowedBlockKinds`,
- zgodność rodzaju slotu z rodzajem bloku,
- wykluczenie zużytego slotu quote.

Te warunki są powielone w `slotFor` i `hasRoleEligibleSlot`.

Najlepsza ekstrakcja to jedna czysta funkcja:

```ts
isSlotCompatible(layoutSlot, flowId, block, slots)
```

Następnie:

- `slotFor` wyszukuje pierwszy zgodny slot od `routeIndex`,
- `hasRoleEligibleSlot` tylko sprawdza, czy taki slot istnieje.

To jest realna duplikacja semantyczna, a nie tylko podobny kod.

Dodatkowo `selectFlowSlot` w `flow-planner.ts` jest wyłącznie wrapperem na `slotFor`. Po ustabilizowaniu call site’u można go usunąć.

### 2. Zajętość i kolizje

Te funkcje należą do jednej dziedziny:

- `flowLineCollidesWithSlot`,
- `blockPlacementCollidesWithSlot`,
- `tablePlacementCollidesWithSlot`,
- `reservedSlotCollidesWithSlot`,
- `slotCollidesWithPlacedBlock`,
- `flowingTextBottom`,
- `occupiedBottomInOverlappingSlots`,
- `previousBlockInSlot`.

Ich wspólny temat to pytanie:

> „Co na tej stronie i w tych slotach już zajmuje przestrzeń?”

Nie należy jednak robić jednej funkcji typu `isAnythingColliding`, która ukryje różnice pomiędzy:

- liniami tekstu,
- blokami atomowymi,
- tabelami,
- slotami zarezerwowanymi.

Wspólny może być sposób iterowania po stanie planu, ale warunki semantyczne powinny pozostać nazwane osobno.

Najbardziej naturalnym właścicielem jest `flow-occupancy.ts`.

Warto też zauważyć, że `previousBlockInSlot` za każdym wywołaniem buduje od nowa mapę wszystkich bloków dokumentu:

```ts
new Map(Object.values(document.flows).flatMap(...))
```

To nie jest problem podziału modułów, ale zbędna kalkulacja. Mapę bloków można zbudować raz w `FlowPlanningContext` jako zwykły indeks danych, bez tworzenia nowej encji.

### 3. Geometria

`rectBottom` występuje w:

- `flow-planner.ts`,
- `text-planner.ts`,
- `structured-block-placement.ts`,
- `flow-barriers.ts`.

`rectsOverlap` i `horizontalOverlap` również są lokalnie powielone.

To są funkcje czysto matematyczne. Nie powinny należeć do planera tekstu. Najbezpieczniej będzie wybrać jednego właściciela i importować je z niego. Nie tworzyłbym jednak rozbudowanego „geometry service”; wystarczy mały, stabilny seam z kilkoma funkcjami.

### 4. Rozrost slotu

Te funkcje tworzą jedną operację domenową:

```text
wylicz przyrost
 → zwiększ slot
 → przesuń zależne sloty
 → zapisz decyzję
```

Dotyczy to:

- tekstu,
- bloków atomowych,
- potencjalnie innych placmentów korzystających z rosnących slotów.

`growSlot` może pozostać funkcją orkiestrującą, ale jej właścicielem powinien być `page-management.ts`, a nie `flow-planner.ts`.

Nie warto łączyć rozrostu z ogólną funkcją „fit elementu”. Tekst mierzy dostępne linie, tabela mierzy wiersze, a obraz wysokość w jednostkach geometrycznych.

### 5. Pomiar i wrapping

Flow planner i insertion planner korzystają z tych samych operacji:

- `lineHeight`,
- `wrapBlock`,
- `wordsForBlock`,
- `textPadding`,
- `availableLineCount`.

To jest prawdziwy wspólny dół zależności i powinien być niezależny od `flow-planner.ts` oraz `text-planner.ts`.

Docelowo:

```text
flow-planner
text-planner
insertion-planning
        ↓
text-measurement
text-wrapping
line-capacity
```

Obecnie `flow-planner.ts` importuje te funkcje z `text-planner.ts`, a `text-planner.ts` importuje z kolei `planFlow`. To tworzy rzeczywisty cykl modułów.

### 6. Kładzenie linii

`placeLines` jest już wspólnym mechanizmem dla:

- zwykłego flow,
- insertion flow.

Ma parametr `layer`, więc nie należy tworzyć osobnych:

```text
placeFlowLines
placeInsertionLines
```

Jedna funkcja w `text-placement.ts` jest właściwym rozwiązaniem.

### 7. Kursor

`advanceCursor` jest używany przez:

- tekst,
- tabele,
- bloki atomowe,
- kolizje,
- brak legalnego slotu,
- przejście na następną stronę.

To jest wspólna, centralna mutacja stanu flow. Powinna pozostać pojedynczą funkcją. Nie przenosiłbym jej do `page-management`, bo nie zarządza stroną — zarządza pozycją flow w route.

### 8. Decyzje, diagnostyka i residuale

`recordFlowDecision` jest właściwym wspólnym seamem dla flow plannerów.

Natomiast pozostała niespójność znajduje się w:

- `structured-block-placement.ts`,
- insertion path w `text-planner.ts`.

Tam nadal są bezpośrednie:

```ts
plan.decisions.push({...})
```

To oznacza, że decyzje strukturalne i insertionowe nie korzystają jeszcze z tego samego mechanizmu.

Dodatkowo `diagnostic` jest obecnie zduplikowane w `text-planner.ts` i `structured-block-placement.ts`.

Przed końcowym przenoszeniem modułów trzeba rozstrzygnąć, czy:

- `recordFlowDecision` otrzyma opcjonalne dane zdarzenia,
- czy powstanie węższa funkcja dla decyzji strukturalnych.

Nie powinno się jednak wracać do konstruowania pełnych obiektów decyzji w każdym call site.

## Rzeczy podobne, których nie należy łączyć

Nie łączyłbym w jedną abstrakcję:

1. `pushHeadingWhenWholeHeadingDoesNotFit`,
2. `pushListItemWhenMinimumFragmentWouldBeBroken`,
3. `pushKeepClusterWhenItCannotFit`,
4. `pushNonTextBlockForCollision`.

Wszystkie mają schemat:

```text
sprawdź warunek
 → zapisz decyzję
 → advanceCursor
```

Ale każdy przypadek ma inną regułę legalności, event i znaczenie biznesowe. Wspólna funkcja typu `pushToNextSlotIf(...)` byłaby krótka, ale ukrywałaby najważniejszą informację.

Podobnie nie łączyłbym:

- pomiaru tabeli i pomiaru tekstu,
- fitowania obrazu i fitowania fragmentu tekstu,
- `contentStartBottom` i `textPlacementStartLineOffset`,
- ścieżki tabeli i ścieżki bloku atomowego.

Mogą korzystać z tych samych prymitywów geometrycznych, ale nie mają tej samej semantyki.

## Funkcje, które nadal mieszają kilka czynności

Nie każda z nich wymaga dalszego rozcinania, bo część jest świadomą orkiestracją.

### `resolveFlowTarget`

Obecnie robi trzy rzeczy:

1. przygotowuje grafiki dla strony,
2. pobiera route slots,
3. wybiera legalny slot.

Pierwsza czynność jest dokumentowo-graficzna i nie powinna być wykonywana przy każdym bloku. `placeGraphicsForPage` jest obecnie wołane wewnątrz pętli flow. To jest kandydat do przeniesienia na etap przygotowania strony, ale wymaga testu kolejności i idempotencji.

### `resolveUnavailableFlowSlot`

Łączy:

- sprawdzenie, czy istnieje legalny slot,
- decyzję o kontynuowaniu,
- przesunięcie kursora,
- diagnostykę,
- residual.

To nadal może być jedna funkcja orkiestrująca błąd routingu, ale jej funkcje pomocnicze powinny mieć wyraźne nazwy.

### `commitSelectedTextLines`

Łączy:

- materializację placementu,
- aktualizację kursora,
- zapis decyzji.

To jest rozsądne, bo opisuje jeden krok: zatwierdzenie segmentu tekstu.

### `growSlot`

Łączy:

- wyliczenie wzrostu,
- mutację slotu,
- przesunięcie zależnych slotów,
- decyzję.

To również jest jeden krok domenowy: legalny rozrost slotu.

## Małe, konkretne redukcje bez tworzenia nowych modułów

Te rzeczy można później usunąć lub uprościć:

- nieużywany import `textPadding` w `flow-planner.ts`,
- alias `growthBottom` → `textBottom`,
- dwukrotne wywołanie `wordsForBlock(block).length` w jednej iteracji,
- powtórzone rozpoznanie headingu,
- powtórzone wyliczenie `keepWithNextLines`,
- powtórzony alias `definition` oraz `selectedSlot.definition` w `FlowTarget`,
- wrapper `selectFlowSlot`.

Warto wprowadzić czyste funkcje:

```ts
isHeadingBlock(block)
requiredKeepWithNextLines(block, policy)
```

To są małe funkcje obliczeniowe, które rzeczywiście poprawiają spójność, bo obecnie ta sama reguła jest zapisana kilkukrotnie.

## Docelowy podział

Najbardziej spójny model wygląda teraz tak:

```text
document-layout
 ├─ przygotowanie planu
 ├─ strony
 ├─ insertiony
 ├─ grafiki
 ├─ kolejność flow
 └─ finalizacja

flow-planner
 ├─ kontekst flow
 ├─ cursor
 ├─ route progression
 ├─ wybór celu
 └─ orkiestracja tekstu/struktur

flow-occupancy
 ├─ kolizje
 ├─ bottomy
 ├─ poprzednie placementy
 └─ zajętość slotów

flow-text-decision
 ├─ przygotowanie tekstu
 ├─ capacity
 ├─ heading/list keeps
 ├─ obstacle handling
 └─ wybór fragmentu do placementu

page-management
 ├─ layoutForPage
 ├─ ensurePage
 ├─ routeLayout
 ├─ geometria stron
 └─ growth slotów

text-measurement
 ├─ wordsForBlock
 ├─ lineHeight
 ├─ textPadding
 └─ wrapBlock

text-placement
 └─ placeLines

structured-block-placement
 ├─ tabele
 └─ bloki atomowe

planning-records
 ├─ decisions
 ├─ diagnostics
 └─ residuale
```

Według obecnego inventory logiczne funkcje przypisane do tych modułów mają około:

- `flow-planner`: 313 linii funkcji,
- `flow-occupancy`: 138,
- `flow-text-decision`: 425,
- `page-management`: 147.

To pokazuje, że obecne 1443 linie `flow-planner.ts` wynikają głównie z fizycznego sklejania kilku dziedzin, a nie z konieczności posiadania jednego ogromnego algorytmu.

Nie wprowadzałbym przy tym `TextFragment` jako nowej encji. Fragment tekstu jest obecnie wartością tymczasową:

```text
wrapBlock(...) → WrappedLine[]
                 ↓
         wybrany segment linii
                 ↓
       placeLines + cursor.startWord
```

`WrappedLine[]` i `FlowCursor.startWord/startRow` wystarczają do zachowania stanu. Nie ma potrzeby tworzyć obiektu z własnym cyklem życia.

Najbezpieczniejsza kolejność dalszej pracy:

1. usunąć cienkie wrappery i zbędne kalkulacje;
2. ujednolicić predykat zgodności slotu;
3. przenieść geometryczne i pomiarowe funkcje poza `text-planner`;
4. wydzielić occupancy i growth jako całe, istniejące odpowiedzialności;
5. przenieść decyzje tekstowe;
6. dopiero potem ujednolicić decyzje strukturalne i insertionowe.

W tej analizie nie zmieniałem plików; worktree pozostaje czysty.

## Checkpoint implementacyjny i estymacje — 2026-09-07

Po zapisaniu analizy wykonano pierwszy etap redukcji, bez zmiany kontraktu
planowania:

- ponownie sprawdzono tagi `@planner-target` w `flow-planner.ts`; funkcje
  obliczeniowe są oznaczone jako `flow-occupancy`, `flow-text-decision` albo
  `page-management`, a orkiestracja pozostaje w `flow-planner`;
- usunięto cienki wrapper `selectFlowSlot` i wywołanie `slotFor` odbywa się
  bezpośrednio w `selectFlowTarget`;
- usunięto nieużywany import `textPadding`;
- usunięto alias `growthBottom` → `textBottom`;
- wynik `completed` z `commitSelectedTextLines` jest przekazywany dalej, więc
  `advanceFlowAfterTextPlacement` nie oblicza ponownie długości tekstu;
- warunki zgodności slotu zostały ujednolicone w `route-slots.ts` przez
  `slotMatchesBlock`, używane przez `slotFor` i `hasRoleEligibleSlot`.

Po tej zmianie inventory obejmuje 160 funkcji. Funkcyjna dolna granica dla
docelowych modułów wynosi obecnie:

| Moduł | Funkcje | Funkcyjna dolna granica |
|---|---:|---:|
| `flow-planner.ts` | 19 | 304 LOC |
| `flow-occupancy.ts` | 16 | 138 LOC |
| `flow-text-decision.ts` | 26 | 424 LOC |
| `page-management.ts` | 18 | 147 LOC |

Szacowany fizyczny rozmiar po przeniesieniu implementacji, wraz z importami,
typami, komentarzami i lokalnymi seamami, wygląda następująco:

| Plik | Estymacja |
|---|---:|
| `flow-planner.ts` | 450–550 LOC |
| `flow-occupancy.ts` | 190–250 LOC |
| `flow-text-decision.ts` | 520–650 LOC |
| `page-management.ts` | 220–300 LOC |
| `text-measurement.ts` | 100–150 LOC |
| `text-placement.ts` | 160–220 LOC |
| `structured-block-placement.ts` | 300–360 LOC |
| `graphic-planning.ts` | 190–250 LOC |
| `insertion-planning.ts` | 380–480 LOC |
| `document-layout.ts` | 400–520 LOC |
| `planning-records.ts` | 120–180 LOC |
| `text-planner.ts` | 300–450 LOC |

Są to zakresy dla końcowych plików, a nie proste sumy LOC funkcji. Największy
plik logiczny będzie prawdopodobnie `flow-text-decision.ts`, ponieważ zawiera
kilka niezależnych reguł keep/capacity, ale nadal pozostaje jedną dziedziną:
decyzją, ile tekstu może legalnie wejść do bieżącego slotu.

Aktualne rozmiary są nadal przejściowe. Przed dalszym przenoszeniem należy
utrzymać zasadę: najpierw tag, potem przeniesienie całej istniejącej
odpowiedzialności, następnie inventory i testy zachowania. Nie dzielimy
`flow-text-decision.ts` tylko dlatego, że jego szacunek przekracza 500 linii.

## Postęp po wydzieleniu seamów flow-plannera — 2026-09-07

Wykonano kolejny etap zgodnie z powyższą kolejnością. Kod został przeniesiony
mechanicznie, bez zmiany kontraktu planowania:

- `flow-occupancy.ts` przejął kolizje, pomiar zajętości, wyszukiwanie
  poprzedniego bloku i `contentStartBottom`;
- `flow-text-decision.ts` przejął przygotowanie wrappingu, reguły keep,
  wykrywanie przeszkód, wybór linii i reakcje na brak pojemności;
- `flow-cursor.ts` przejął jedyną operację przejścia kursora;
- `flow-planning-types.ts` przechowuje wspólne typy kontekstu, runtime'u i
  celu; nie jest nową encją domenową;
- `planner-policy.ts` przechowuje wspólny typ polityki, aby moduł decyzji
  tekstowych nie importował runtime'owo agregatora `text-planner`.

Najważniejszy efekt fizyczny:

| Plik | Przed etapem | Po etapie |
|---|---:|---:|
| `flow-planner.ts` | 1416 LOC | 558 LOC |
| `flow-occupancy.ts` | nie istniał | 260 LOC |
| `flow-text-decision.ts` | nie istniał | 591 LOC |

Obecny rozmiar `flow-planner.ts` obejmuje już głównie orkiestrację: kontekst,
wybór celu, wzrost slotu, placement bloków strukturalnych, materializację
linii i pętlę `planFlow`. Pozostałe redukcje powinny dotyczyć przede wszystkim
`text-planner.ts` oraz ujednolicenia decyzji strukturalnych/insertionowych, a
nie dalszego sztucznego cięcia `flow-planner.ts`.

Inventory po tym etapie obejmuje 164 funkcje. Weryfikacja zakończyła się
powodzeniem: `npm run build`, `npm run planner:inventory`, kontrola architektury,
test dokumentacji kompozycji oraz `npm run test:composition` (13/13).

## Korekta seamu wzrostu slotu — 2026-09-07

`growSlot` nie był sensownie podzielony na niezależne odpowiedzialności.
`growthDelta`, `resizeGrownSlot`, `resizePushedTextSlot`, `movePushedSlots`
i `recordSlotGrowth` były tylko krokami jednej operacji: zastosowania legalnego
wzrostu bieżącego slotu, przesunięcia zależnych slotów i zapisania decyzji.

Zostały scalone do jednej funkcji `growSlot` w `slot-growth.ts`. Funkcja nadal
wykonuje te same kroki i w tej samej kolejności, ale nie udaje pięciu osobnych
seamów. Jej docelowa odpowiedzialność jest jawnie oznaczona jako
`composition/slot-growth.ts`.

Po samym scaleniu (przed wydzieleniem `slot-growth.ts`):

- `flow-planner.ts` ma obecnie 484 LOC;
- inventory obejmuje 157 funkcji;
- całkowity przepływ wzrostu slotu jest czytelny w jednym miejscu;
- build pozostaje poprawny.

## Ujednolicenie wejścia structured placement — 2026-09-07

`placeStructuredBlock` nie przyjmuje już `StructuredBlockPlacementContext`.
Jego sygnatura to:

```ts
placeStructuredBlock(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): boolean
```

Dispatcher korzysta z tych samych obiektów, które są tworzone i przekazywane
przez `flow-planner`. `PageState`, blok, definicja slotu, indeks trasy,
metryki, plan i kursor nie są już kopiowane do osobnego DTO. Wspólne operacje
(`previousBlockInSlot`, `contentStartBottom`, `advanceCursor`, `growSlot`)
pochodzą z neutralnych modułów i działają na tych samych obiektach.

Po tym kroku bieżący stan to 410 LOC w `flow-planner.ts`, 270 LOC w
`structured-block-placement.ts`, 43 LOC w `slot-growth.ts` oraz 156 funkcji w
inventory.

## Dekompozycja `text-planner.ts` — 2026-09-07

Drugi etap wykonano tą samą metodą mechaniczną: najpierw zachowano istniejące
ciała funkcji, potem przeniesiono je do modułów odpowiadających ich domenie.
Nie zmieniono kolejności planowania, diagnostyk ani kontraktu
`CompositionPlanner`.

### Docelowy podział odpowiedzialności

| Moduł | Funkcje i odpowiedzialność |
|---|---|
| `text-planner.ts` | Publiczny konstruktor planera oraz orkiestracja zbioru kandydatów: `planCandidates`, `planRefinedCandidates`, `createTextCompositionPlanner`. Nie tworzy stron, nie mierzy tekstu i nie materializuje grafik. |
| `document-layout.ts` | Cykl życia jednego planu: `createPlan`, preflight, walidacja kontraktów quote, tworzenie stron, rezerwacja przeszkód, kolejność zwykłych/powtarzalnych flow, finalizacja projekcji planu i `planDocumentOnce`. |
| `insertion-planning.ts` | Kandydaci wstawek, wspólny kalkulator `measureInsertionText`, dopasowanie fit-content, rezerwacja przeszkód, zwijanie pustych slotów oraz materializacja tekstu wstawek. |
| `graphic-planning.ts` | Geometria i walidacja grafik, kandydaci pozycji, materializacja placementów oraz stron zawierających grafiki. |
| `flow-planner.ts` | Przejście kursora po blokach głównego flow, wybór legalnego celu i delegowanie placementu; nie importuje już implementacji z agregatora `text-planner.ts`. |
| `text-measurement.ts`, `line-capacity.ts` | Wspólne obliczenia pomiarowe i pojemnościowe. Moduły planowania wywołują te kalkulatory zamiast powielać algorytm pomiaru linii. |

### Zależności między seamami

```text
text-planner
  -> document-layout -> flow-planner -> flow-text-decision
  -> insertion-planning -> text-measurement / text-placement / page-management
  -> graphic-planning -> page-management / graphic-geometry

flow-planner -> graphic-planning (tylko materializacja grafik na stronie)
```

`document-layout` jest granicą jednego przebiegu. Przyjmuje już przygotowane
mapy propozycji, tworzy `CompositionPlan`, przygotowuje strony i uruchamia
flowy. Dzięki temu `text-planner` nie zna szczegółów `PageState`, kursora ani
slotów. `insertion-planning` i `graphic-planning` nie są nowymi encjami
domenowymi; są modułami usługowymi operującymi na istniejących typach
`CompositionDocument`, `CompositionPlan`, `PageState` i propozycjach.

### Funkcje zagnieżdżone i kalkulacje

Z `createTextCompositionPlanner` usunięto lokalne deklaracje
`planCandidates` i `planRefinedCandidates`. Są funkcjami modułowymi, a metody
obiektu publicznego tylko przekazują do nich `template` i `policy`. Pozostałe
funkcje wyższego rzędu (`map`, `filter`, `flatMap`, predykaty sortowania) są
krótkimi callbackami kolekcji, a nie ukrytymi etapami planowania.

Ręczne obliczenia zostały pozostawione wyłącznie przy odpowiedzialności, która
ich potrzebuje, i są delegowane do istniejących kalkulatorów: wysokość linii i
wrapping do `text-measurement`, liczba dostępnych linii do `line-capacity`,
geometria stron do `page-management`, geometria grafik do
`graphic-planning`. Nie utworzono ogólnej klasy `TextFragment` ani nowego
obiektu stanu tylko po to, aby przenieść kilka pól.

### Rozmiar po przeniesieniu

| Plik | LOC |
|---|---:|
| `text-planner.ts` | 152 |
| `document-layout.ts` | 419 |
| `insertion-planning.ts` | 405 |
| `graphic-planning.ts` | 217 |
| `flow-planner.ts` | 408 |

Dłuższe moduły zawierają pełne, istniejące operacje domenowe i komentarze
seamów; nie są to już funkcje 600-liniowe. Następny etap może badać duplikaty
wewnątrz `insertion-planning` i `document-layout`, ale dopiero po porównaniu
ich obliczeń z kalkulatorami i po utrwaleniu testów zachowania.

### Weryfikacja

- `npm run build` — zaliczone;
- `node scripts/architecture-check.mjs` — zaliczone, 82 moduły bez cykli i
  naruszeń warstw;
- `npm run planner:inventory` — 159 funkcji;
- `npm run test:composition` poza sandboxem — zaliczone, 13/13 kontroli.

Uruchomienie suite w sandboxie zatrzymało się wcześniej na `spawnSync
pdftotext EPERM`; nie był to błąd kodu i został zweryfikowany ponownym
przebiegiem z uprawnieniem do child processes.

Pełny `npm test` doszedł do suite `editorial flow`, ale ten suite odrzucił
reproduktory `reproducer-B-four-sections`, `seed-10203040-orbit-intro-3` i
`seed-9abcdef0-orbit-intro-3` z `FLOW_SLOT_UNDERFILLED`. Ten sam reproduktor
uruchomiony na czystym `HEAD` (`13f5d28`, przed bieżącą ekstrakcją
`text-planner`) kończy się identycznie, więc nie przypisuję tego wyniku tej
zmianie. Jest to osobny problem zachowania editorial-flow do dalszej
diagnozy.
