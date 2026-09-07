# Propozycja podziału planowania dokumentu

Data: 2026-09-07. Status: propozycja do oceny, nie opis wdrożonej architektury.

Dokument rozwija [przegląd Astry](astra-text-planner-review-live.md)
i analizę bieżących, także niezacommitowanych wersji plannerów.
Nie zastępuje przyjętego planu 1.0 ani kanonicznej
[mapy modułów](../composition/modules.md). Nazwy nowych plików, funkcji
i typów poniżej są robocze. Zmiana tej dokumentacji nie wdraża refaktoru.

## 1. Najważniejsze doprecyzowanie: czym jest „text-fragment”

Poprzednia nazwa mieszała dwie rzeczy: obliczenie oraz jego wynik.
Proponuję nazwę modułu `text-fragment-planning.ts` i funkcję
`planTextFragment(request, metrics)`. `TextFragment` oznacza wyłącznie
niemutowalny wynik obliczenia: wybrane linie, zakres słów i ich geometrię.

Nie powstaje osobny aktywny obiekt na każdy fragment. Nie ma konstruktora,
procesu, zadania w tle, rejestru, własnego identyfikatora ani metod typu
`fragment.run()` lub `fragment.save()`. Flow planner wykonuje zwykłe,
synchroniczne wywołanie funkcji dla konkretnej próby umieszczenia tekstu.

W terminologii projektowej:

| Element | Rodzaj | Dlaczego |
|---|---|---|
| `text-fragment-planning.ts` | Moduł obliczeniowy z małym interfejsem | Ukrywa współpracujące reguły łamania tekstu |
| `planTextFragment` | Bezstanowa funkcja domenowa; w DDD odpowiada operacji domain service | Obliczenie zależy od bloku, miejsca, pomiarów i polityki, nie od jednej encji |
| `TextFragment` | Wartość wyniku, zbliżona do value object | Liczy się zawartość, nie tożsamość ani cykl życia |
| `FragmentOutcome` | Suma rozłącznych typów wyników | Rozróżnia umieszczenie, przejście, wznowienie i błąd |
| `LayoutState` | Prywatny obiekt stanu jednego przebiegu | Ma mutowalne strony i placementy, ale nie jest trwałą encją biznesową |
| `FlowCursor` | Lokalny stan algorytmu | Pamięta postęp jednego flow |

Implementacja może być funkcyjna. Nie wymaga kontenera DI, hierarchii klas
ani wdrażania modułów jako osobnych procesów. Metrics jest przekazaną
zależnością. Determinizm obliczenia zakłada stabilne odpowiedzi metrics;
adapter pomiarowy może wewnętrznie korzystać z cache lub jsPDF.

## 2. Stan istniejący i cel zmiany

Potwierdzone w aktualnym kodzie:

- `text-planner.ts` ma 962 linie, `flow-planner.ts` 874; `planFlow`
  obejmuje linie 316–874, czyli 559 linii wraz z deklaracją i komentarzami.
- `text-planner` wywołuje `planFlow`, a `flow-planner` importuje wykonawcze
  funkcje z `text-planner`. Istnieje cykl importów.
- `planDocumentOnce` przygotowuje plan, grafiki, wstawki, zwykłe i powtarzane
  flow oraz finalizuje wynik.
- `planFlow` wybiera slot, mierzy tekst, stosuje reguły typografii, zmienia
  cursor i geometrię, umieszcza wynik oraz dopisuje diagnostykę.
- `placeStructuredBlock` również zmienia cursor; jego `boolean` nie odróżnia
  umieszczenia od przesunięcia lub obsłużenia błędu.
- `engine.ts` już prowadzi ocenę, wybór kandydatów i rundy refinementu.

Celem jest przypisanie każdej decyzji i każdej mutacji do jednego właściciela.
Skrócenie funkcji jest skutkiem tego podziału. Nie zakładamy, że samo
przeniesienie kodu zmniejszy łączną liczbę linii.

## 3. Przepływ od wejścia do dokumentu

Poniższy schemat pokazuje docelowy przebieg wywołań. Adaptery wejścia,
metrics, engine, evaluator i backend już istnieją. Wnętrze planera jest
proponowanym podziałem.

```text
dane raportu + skompilowany template + zasoby/fonty + konfiguracja
  |
  v
report runtime / planReportComposition
  |-- input adapter ------------> CompositionDocument: flow i bloki
  |-- page-template adapter ----> CompositionTemplate: layouty i routes
  |-- jsPDF metrics adapter ----> pomiary tekstu, tabel i bloków
  `-- text-engine --------------> polityka planera z konfiguracji
  |
  v
CompositionEngine.plan(document, metrics)
  |
  |--> planner.planCandidates(...)
  |      |-- przygotuj propozycje pozycji wstawek i grafik
  |      `-- dla zestawu propozycji: layoutDocument(...)
  |             |-- nowy LayoutState
  |             |-- przygotuj strony, grafiki i warstwę wstawek
  |             |-- planFlow dla zwykłych flow
  |             |     `-- wielokrotnie: wybierz miejsce -> oblicz -> zatwierdź
  |             |-- planFlow dla powtarzanych flow na ustalonych stronach
  |             `-- finalizacja -> CompositionPlan
  |      `-- jeśli potrzebny reflow: nowy pełny przebieg z nowymi propozycjami
  |
  |--> evaluator.evaluate(document, każdy plan)
  |--> wybierz legalny plan według score, zachowaj kolejność przy remisie
  |--> planner.planRefinedCandidates(selected, round)
  |      `-- nowe pełne przebiegi -> ocena -> aktualizacja wyboru
  `--> CompositionPlanResult { plan, evaluation }
  |
  v
kontrola dopuszczenia renderowania -> backend -> artefakt PDF
```

„Analiza tekstu” obejmuje tu strukturę bloków, zakresy słów, pomiary fontu,
wrapping i reguły układu. Ta propozycja nie dodaje analizy semantycznej przez
LLM. Adapter wejścia dostarcza już rodzaj/rolę bloku, np. heading lub quote.

Backend korzysta z wybranego planu. Nie podejmuje ponownie decyzji o podziale
akapitu ani o przeniesieniu nagłówka na kolejną stronę.

## 4. Co żyje jak długo i kto może to zmieniać

| Dane | Powstają | Odczyt | Właściciel zmian / koniec życia |
|---|---|---|---|
| Document, template | Przy wejściu do composition | Planner, evaluator; document także backend | Traktowane jako wejście tylko do odczytu podczas planowania |
| Metrics i policy | Przy składaniu runtime | Obliczenia planera | Policy stała; metrics obsługuje adapter |
| Zestaw propozycji | Generowanie kandydata lub kolejnego reflow | Jeden przebieg layoutu | Nowy zestaw dla kolejnej próby; bez mutowania wybranego kandydata |
| `LayoutState` | Początek każdego `layoutDocument` | Nawigator i operacje placementu przez interfejs | Tylko moduł stanu zmienia strony, sloty i kolekcje wyniku |
| `FlowCursor` | Początek jednego wywołania `planFlow` | Flow planner; do obliczeń trafiają wybrane wartości | Tylko flow planner; znika po zakończeniu flow |
| `FragmentRequest` | Po wybraniu aktualnego miejsca | `planTextFragment` | Snapshot; traci aktualność po zmianie geometrii lub zajętości |
| `FragmentOutcome` | Powrót z obliczenia | Flow planner, materializacja | Zużywany w tej samej iteracji; ponawiana próba tworzy nowy wynik |
| `CompositionPlan` | Finalizacja przebiegu | Evaluator, engine, backend | Geometria zakończona; engine obecnie dopisuje ślad oceny |
| `CompositionEvaluation` | Ocena pełnego planu | Engine i kontrola renderowania | Osobny wynik oceny |

Jeden dokument może spowodować wiele przebiegów i wiele wywołań
`planTextFragment`. Ten sam blok może być mierzony ponownie w innym slocie,
po zmianie przeszkody, w kolejnym kandydacie albo w reflow.

Nie współdzielimy mutowalnego `LayoutState` między kandydatami. Planowanie
jest początkowo sekwencyjne; ta propozycja nie wprowadza współbieżności.

## 5. Mapa modułów i funkcji

Poniższe funkcje opisują docelowe obowiązki, nie gotowy zestaw eksportów.
Pomocnicze funkcje pozostają prywatne, jeśli nie mają rzeczywistych odbiorców.

### `text-planner.ts`: generowanie kandydatów

- Zachowuje `createTextCompositionPlanner` i istniejący `CompositionPlanner`.
- `planCandidates`: przygotowanie zestawów propozycji i pełnych planów.
- `planRefinedCandidates`: propozycje wokół wybranego planu.
- Korzysta z istniejącego `text-planner-candidates.ts` do geometrii wariantów.

Nie ocenia score. W ramach migracji zachowujemy istniejące wywołania
`planDocumentOnce` i obecny przepływ propozycji. Nie wprowadzamy osobnej
encji ani modułu „stabilizacji”; lokalne zmienne i sygnatury używane dziś
przez planner pozostają prywatnymi szczegółami implementacji do przeniesienia
bez zmiany zachowania. Ewentualne uruchamianie dodatkowych generowań dla
odległych kandydatów jest poza bieżącym zakresem.

### `document-layout.ts`: kolejność faz pojedynczego przebiegu

- `layoutDocument`: odpowiednik obecnego `planDocumentOnce`.
- Prywatne `prepareLayers`, `planOrdinaryFlows`, `planRepeatedFlows`,
  `finalizeLayout` rozdzielają fazy istniejącego przebiegu.
- Tworzy `LayoutState`, wywołuje planery flow, zleca końcowe projekcje.
- Finalizacja zachowuje kolejność: zebranie stron/slotów, normalizacja
  kolejności, projekcje flow i barriers, glyphy, faza i trace.

Orkiestracja nie przenika do modułu stanu: `LayoutState` nie wywołuje
`planFlow` ani nie uruchamia samodzielnie kolejnego kandydata.

### `layout-state.ts`: własność mutacji

Roboczy interfejs operacyjny:

- `ensurePage(request)`: utworzenie/odczyt strony według ustalonej polityki.
- `inspectPlacementArea(request)`: snapshot aktualnego slotu, zajętości,
  przeszkód i możliwości wzrostu. Nie wybiera następnego slotu.
- `applySlotGrowth(request)`: wzrost slotu i przesunięcia zależnych slotów.
- `reserveObstacle(request)`, `collapseInsertionSlot(request)`:
  konkretne zmiany warstwy przeszkód i stanu slotu.
- `commitPlacement(result)`: spójny zapis placementów, linii i zajętości.
- `recordEvents(events)`, `recordResidual(result)`: zachowanie dowodów decyzji.
- `snapshot()`: dane do finalizacji po zakończeniu placementu.

Stan nie udostępnia zapisywalnych `pages`, `plan` ani mapy slotów.
Samo opakowanie obecnych tablic w `context` nie spełnia tego założenia.
Snapshot musi nie ujawniać mutowalnych referencji do wnętrza; sam płytki
TypeScript `Readonly` nie gwarantuje tego dla zagnieżdżonych obiektów.

Moduł stanu może mieć prywatne funkcje pomocnicze dotyczące stron i zapisu.
Nie przenosimy do niego reguł keep-with-next, list ani wyboru kandydata.

### `flow-planner.ts`: nawigacja i postęp

- `planFlow`: główna pętla.
- `selectFlowTarget`: wybór route/slotu oraz obsługa braku miejsca.
- `prepareTextAttempt`: złożenie danych konkretnej próby z cursora,
  snapshotu miejsca, sąsiednich bloków i kolejności wstawek.
- `applyOutcome`: zapis wyniku i jednoznaczna aktualizacja cursora.
- Prywatne operacje `advanceCursor`, `resumeBelowObstacle`,
  `completeBlock`, `continueBlock`.

Każda iteracja musi zużyć treść, zmienić legalne miejsce/wznowienie albo
zakończyć flow z diagnostyką. Ponowienie identycznego stanu bez postępu
oznacza błąd algorytmu. Nie dokładamy arbitralnego limitu zaszytego w kodzie.

### `text-fragment-planning.ts`: decyzja lokalna

- Publiczne wewnątrz planera `planTextFragment(request, metrics)`.
- Prywatne `measureTextAttempt`: wrapping ograniczony i pełny.
- `resolveBlockSpacing`: reguły odstępu, w tym istniejąca kompresja nagłówka.
- `checkHeadingCluster`: nagłówek, lead i przeszkody.
- `selectLegalLineRange`: minimum początku/końca, lista, legalny podział.

Kolejność tych reguł jest częścią zachowania. Nie zastępujemy ich przy okazji
uniwersalnym systemem pluginów/polityk. Funkcja zwraca też uporządkowane
zdarzenia potrzebne diagnostyce i evaluatorowi.

### `text-placement.ts`: materializacja wybranego tekstu

- `materializeText`: przekształcenie linii w dane odpowiadające dzisiejszemu
  `placeLines`, bez bezpośredniej mutacji `PageState` i tablic planu.
- Wylicza wyrównanie, ramkę placementu, linie oraz glyph sampling boxes.
- Zwraca dane do `commitPlacement`; identyfikatory zależne od kolejności
  zapisu nadaje właściciel planu, zachowując obecny format.
- Korzysta z istniejącego `glyph-sampling.ts`.

Wspólny pomiar tekstu, paddingu i wysokości linii powinien być dostępny
poniżej planowania tekstu oraz wstawek, np. w `text-measurement.ts`.
To miejsce dla obecnych `wrapBlock`, `lineHeight`, `textPadding`
i tokenizacji, bez importu do nadrzędnego planera.

### Wstawki, grafiki i bloki strukturalne

- `insertion-planning.ts`: `enumerateInsertionSlots`, `measureInsertion`,
  `seedInsertionProposals`, `deriveInsertionProposals`. Wspólny pomiar
  fit-content dla seedowania i rzeczywistej warstwy wstawek.
- Przygotowanie warstwy wstawek pozostaje osobną operacją przebiegu:
  rezerwacja -> pomiar -> materializacja -> zapis przez `LayoutState`.
- Przygotowanie grafik zachowuje obecne seedowanie, materializację stron
  i geometrię. Może być prywatnym modułem `graphic-planning.ts`, jeśli
  ekstrakcja rzeczywiście odciąży `document-layout`.
- `structured-block-placement.ts` docelowo zwraca jawne wyniki dla tabel
  i bloków atomowych zamiast zmieniać cursor i zwracać `boolean`.
  Zakres wierszy tabeli pozostaje innym rodzajem postępu niż zakres słów.

## 6. Dokładne wejście do obliczenia fragmentu

Żaden pojedynczy pomiar tekstu nie wystarczy. Roboczy `FragmentRequest`
zawiera poniższe grupy danych, jako wybrane wartości tylko do odczytu:

| Grupa | Dane | Źródło |
|---|---|---|
| Treść | Bieżący blok, tekst, rodzaj/rola, zakres pozostałych słów | Document + cursor |
| Sąsiedztwo | Poprzedni blok istotny dla odstępu i następny dla keep-with-next | Flow planner i zapisana zajętość |
| Miejsce | Bieżąca ramka slotu, początek dostępnego pasma, fizyczny dół, dopuszczalny dół po wzroście | Snapshot `LayoutState` |
| Wstawki | Ograniczenie przed następną wstawką i wymagany początek po poprzedniej | `insertion-order` + propozycje + authored order |
| Przeszkody | Grafiki opływane i flow barriers dotyczące miejsca | Snapshot planu |
| Reguły | Minimum fragmentu, widow/orphan, lista, heading keep, szerokość wrappingu, tolerancja | Przekazana policy |
| Kontekst próby | Początek/kontynuacja bloku, wznowienie pod przeszkodą, identyfikatory do diagnostyki | Flow planner |

Osobno przekazywane `metrics` udostępnia m.in. szerokość tekstu, wysokość
linii, padding i blockGap. Nie wstrzykujemy do funkcji pełnego engine,
evaluatora, backendu, całego mutowalnego planu ani funkcji `ensurePage`.

Nie należy nadmiernie spłaszczać geometrii do jednej liczby `availableLines`:
przeszkody mogą tworzyć różne szerokości na kolejnych wysokościach, następny
blok może mieć inną wysokość linii, a slot może rosnąć. Funkcja musi móc
odtworzyć rzeczywiste pasma i pomiar klastra nagłówka.

Roboczy kontrakt wyniku:

```ts
// Szkic projektu, a nie deklaracje istniejące w repozytorium.
type FragmentOutcome =
  | { kind: 'place'; fragment: TextFragment; requiredBottom: number;
      events: PlanningEvent[] }
  | { kind: 'advance'; events: PlanningEvent[] }
  | { kind: 'resume-below'; y: number; events: PlanningEvent[] }
  | { kind: 'skip-empty'; events: PlanningEvent[] }
  | { kind: 'reject'; residual: TextResidual; events: PlanningEvent[] };

// TextFragment: wybrane WrappedLine[], startWord/endWord, leading,
// dane potrzebne do materializacji; bez własnego życia i mutowania planu.
// PlanningEvent: typowane zdarzenie z zachowaniem obecnych codes/details.
```

`advance` oznacza potrzebę kolejnego miejsca. Dopiero flow planner rozstrzyga,
czy jest kolejny slot, czy trzeba przejść na stronę i czy route na to pozwala.
Lokalne obliczenie nie stwierdza globalnej niemożliwości dokumentu wyłącznie
na podstawie jednej nieudanej próby.

## 7. Jedna iteracja i moment dotykania stanu

```text
1. flow planner odczytuje cursor i bieżący blok
2. wybiera slot; LayoutState zapewnia stronę
3. pobiera świeży snapshot miejsca i składa request
4. planTextFragment odczytuje request i metrics -> wynik bez mutacji planu
5. flow planner interpretuje wynik:
   advance      -> zapis zdarzeń, przesunięcie cursora, powrót do 1
   resume-below -> zapis zdarzeń, zmiana resumeY, powrót do 1
   skip-empty   -> następny blok, powrót do 1
   reject       -> zapis residual/diagnostyki, zakończenie
   place        -> jeśli potrzeba, zastosowanie wzrostu slotu
                -> jeśli wzrost zmienił warunki pomiaru, świeża próba od 3
                -> materializeText, commitPlacement, zapis zdarzeń
                -> cursor.startWord = fragment.endWord lub następny blok
```

Wzrost może przesuwać inne sloty i ich przeszkody. Nie wolno zatwierdzić
wyniku policzonego na nieaktualnej geometrii. W pierwszej implementacji
nie potrzeba wersjonowania snapshotów: kod działa sekwencyjnie, a właściciel
mutacji jawnie określa, czy zmiana unieważnia bieżący pomiar.
Szczegółowa kolejność wzrostu i zdarzeń wymaga testu równoważności z obecnym
`growSlot`; nie jest tu uznana za już rozstrzygniętą.

Przykład, z liczbami wyłącznie ilustracyjnymi: nagłówek wymaga dwóch linii,
polityka wymaga dwóch linii kolejnego akapitu. Pod przeszkodą nie mieszczą
się razem. `planTextFragment` zwraca `advance` z powodem klastra nagłówka.
Flow planner wybiera kolejny slot i wykonuje nowe wywołanie dla tego samego
nagłówka od pierwszego słowa. Gdy wynik to `place`, materializacja tworzy
linie nagłówka; tekst akapitu zostanie umieszczony w następnej iteracji.
Pomiar leadu jest sprawdzeniem możliwości, nie wcześniejszym zapisaniem go.

## 8. Kierunek zależności i zakres reużycia

```text
engine -> CompositionPlanner / CompositionEvaluator
text-planner -> document-layout + insertion-planning + kandydaci
document-layout -> flow-planner + layout-state + przygotowanie warstw
flow-planner -> text-fragment-planning + structured-block-placement
flow-planner -> interfejs layout-state + route-slots + insertion-order
text-fragment-planning -> text-measurement -> text-wrapping
insertion-planning -> text-measurement
text-placement -> glyph-sampling
document-layout -> końcowe flow-barriers / glyph-objects / planning-trace
```

Typy współdzielone między tymi modułami mogą być w wewnętrznym
`planning-types.ts`, bez importów wykonawczych. Istniejące modele document,
template i plan pozostają podstawą. Nie tworzymy ich konkurencyjnych kopii.

Współdzielimy rzeczywiste obliczenia: pomiar fit-content, enumerację miejsc
wstawek, walidację wspólnych bounds. Różne zapytania o zajętość zachowują
znaczenie: dół tekstu w slocie, zajętość nachodzących slotów i obecność
przeszkody nie są automatycznie jedną operacją `occupiedBottom`.

## 9. Nierozstrzygnięte kontrakty i ochrona migracji

Poniższe kwestie nie mogą zostać ukryte w nowej nazwie modułu:

1. Egzekwowanie planu stron. Layout nie powinien być wybierany przez pierwszy
   flow, który wywoła `ensurePage`; powinien wynikać z odgórnego planu stron.
   Szczegóły żądania następnej strony i zachowanie przy stronie z rezerwacją
   wymagają kontraktu opisanego w sekcji 13.
2. Ścieżka cytatów. Obowiązuje preplanowana warstwa wstawek z osobnego,
   nazwanego flow (np. `quotes`) deklarującego `insertionSlots`. `main` jest
   zarezerwowany dla głównego tekstu: nie może zawierać `role: quote` ani
   `insertionSlots`. Historyczna ścieżka cytatu inline została usunięta wraz
   z obsługą defer/continuous.
3. Zakres oczekiwanych powtórzeń header/footer. Oczekiwania evaluatora
   muszą dać się wyprowadzić niezależnie od tego, gdzie planner umieścił tekst.
4. Stabilizacja, pojedynczy kandydat i zachowanie nieaktywnych elementów
   podczas refinementu. Raport Astry wskazuje problemy; ten dokument
   nie deklaruje ich naprawy ani ponownego potwierdzenia testami.
5. Zdarzenia są częścią kontraktu: evaluator czyta m.in.
   `FLOW_SEGMENT_ADVANCED`. Zachowujemy pola, przyczyny i kolejność.

Kolejność prac: testy zachowania -> pomiar/materializacja i własność stanu
-> usunięcie cyklu -> lokalne obliczenie tekstu -> jeden właściciel cursora
-> usunięcie duplikacji. Korekty zachowania mają osobne zmiany i testy.

Testy publicznego planera/engine pozostają podstawą weryfikacji. Testy
lokalnego obliczenia mają sens dla kombinacji reguł trudnych do odizolowania
w całym dokumencie, po świadomym przyjęciu tego wewnętrznego interfejsu.
Nie tworzymy testu każdej prywatnej funkcji ani zamienników całego stanu.

Sprawdzamy placementy, treść, residuals, zdarzenia, wybranego kandydata
i brak regresji realnego PDF. Po wdrożeniu: TypeScript, gate composition,
test dokumentacji i ręczna kontrola editorial. Nowe tunable wartości trafiają
do istniejącej konfiguracji YAML i są przekazywane przez policy.

Warunek zatrzymania ekstrakcji: moduł potrzebuje całego mutowalnego planu,
kilkunastu callbacków do rodzica albo importuje nadrzędny planner. To oznacza,
że podział odpowiedzialności wymaga korekty przed dalszym przenoszeniem kodu.

## 10. Podstawa analizy i ograniczenie weryfikacji

Źródła: `server/src/composition/{text-planner,flow-planner,engine,
structured-block-placement,text-engine,report-composition-entrypoint}.ts`,
wybrane reguły `evaluator.ts`, mapa modułów oraz przegląd Astry.
W szczególności: obecne `planDocumentOnce`, `planFlow`, `placeLines`,
`placeInsertionLayer`, `fitInsertionProposal` i `createCompositionEngine`.

To projekt odpowiedzialności i przepływu. Szkice typów nie zostały
zaimplementowane ani zweryfikowane kompilatorem. Test dokumentacji może
sprawdzić istniejący kontrakt dokumentacji, ale nie potwierdza poprawności
proponowanego algorytmu. Długości funkcji po refaktorze i oszczędność linii
wymagają pomiaru na rzeczywistym diffie.

## 11. Katalog funkcji i momentów uruchomienia

To rozwinięcie proponowanej architektury z sekcji 5. Nazwy oznaczone
„istnieje” pochodzą z obecnego kodu; pozostałe są projektowanymi funkcjami
lub metodami. Istniejąca nazwa nie oznacza zachowania obecnego wnętrza.
Funkcje pomocnicze pozostają prywatne. Katalog opisuje logiczne operacje;
nie wymaga eksportowania każdej z nich ani tworzenia dla każdej klasy.

Jednostki czasu używane poniżej:

- **Żądanie**: utworzenie jednego raportu, od wejścia do artefaktu.
- **Przebieg**: jedno pełne `layoutDocument` dla jednego zestawu propozycji.
  Reflow i refinement mogą powodować kolejne przebiegi tego samego dokumentu.
- **Flow**: jedno wywołanie `planFlow`; powtarzany header/footer dostaje
  osobne wywołanie na każdą stronę objętą powtórzeniem.
- **Próba**: rozpatrzenie konkretnego bloku lub jego reszty w konkretnym
  miejscu. Nieudana próba może zakończyć się bez zapisania choćby jednej linii.

### 11.1. Wejście i składanie zależności — istniejące moduły

| Moduł / funkcja | Kto i kiedy wywołuje | Co wykonuje / przekazuje dalej |
|---|---|---|
| `report-composition-runtime.prepareReportComposition` — istnieje | Orkiestracja raportu, przed planowaniem | Przygotowuje fonty, zasoby, style, capability bloków, contrast provider i backend |
| `report-composition-entrypoint.planReportComposition` — istnieje | Ścieżka raportu, przy wejściu do planowania | Składa document, template, metrics i policy; uruchamia engine |
| `input.compositionDocumentFromInput` — istnieje | Entrypoint, przed pierwszym kandydatem | Zamienia wejście na flow i bloki; nie wyznacza końcowych współrzędnych |
| `page-template-adapter.compositionTemplateFromPageGeometry` — istnieje | Entrypoint, przed pierwszym kandydatem | Przygotowuje layouty, sloty i routes |
| `js-pdf-adapter.createJsPdfTextMetrics` — istnieje | Entrypoint, przed pierwszym kandydatem | Zwraca zależność pomiarową współdzieloną przez obliczenia żądania |
| `text-engine.plannerPolicyFromRenderConfig` — istnieje | Podczas składania policy | Odczytuje konfigurację przez istniejący adapter i zwraca wartości dla planera |
| `text-engine.createTextCompositionEngine` — istnieje | Entrypoint, po przygotowaniu wejścia | Łączy planner i evaluator; nie układa bloków |

Dokładna liczba odczytów konfiguracji jest szczegółem obecnego składania
adapterów. Projekt nie wymaga ponownego odczytu YAML w każdej próbie tekstu.

### 11.2. `engine.ts` — pętla oceny, istniejący właściciel

| Funkcja / operacja | Moment i częstotliwość | Efekt |
|---|---|---|
| `createCompositionEngine` — istnieje | Przy składaniu engine | Zapamiętuje planner i evaluator w domknięciu |
| Zwracane `plan` — istnieje | Raz na wywołanie planowania żądania | Pobiera kandydatów, ocenia, wybiera i prowadzi refinement |
| `planner.planCandidates` — istnieje | Na początku `engine.plan` | Zwraca początkowe pełne plany |
| `evaluator.evaluate` — istnieje | Dla każdego otrzymanego planu | Zwraca legalność, diagnostykę i score |
| `compareCompositionEvaluations` — istnieje | Podczas wyboru i po dostarczeniu nowych kandydatów | Porównuje legalność i score; remis zachowuje wcześniejszy wybór |
| `planner.planRefinedCandidates` — istnieje | W kolejnych dozwolonych rundach | Dostaje aktualnie wybrany plan; zwraca nowe pełne plany |
| Dopisanie śladu oceny — istnieje | Po ostatniej rundzie | Uzupełnia trace wybranego planu o wyniki i wybór |
| `renderComposition` — istnieje | Później, przy renderowaniu przez ten interfejs | Sprawdza odrzucenie wyniku i wywołuje backend |

`renderComposition` nie jest częścią pętli kandydatów. Pomiar metrics może
korzystać z jsPDF wcześniej, ale nie oznacza to renderowania każdego
kandydata do końcowego pliku PDF.

### 11.3. `text-planner.ts` i `text-planner-candidates.ts`

| Funkcja | Kto / kiedy | Odczyt i wynik |
|---|---|---|
| `createTextCompositionPlanner` — istnieje | `text-engine`, przy składaniu | Zachowuje template i policy; nie tworzy stanu stron |
| `planCandidates` — istnieje | Engine, początkowa generacja | Waliduje limit przebiegów; przygotowuje seedy i warianty; zleca pełne layouty |
| `plan` — istnieje | Bezpośredni konsument planera, gdy nie korzysta z engine candidates | Zachowuje obecny kontrakt zwracania ostatniego planu z `planCandidates` |
| `planRefinedCandidates` — istnieje | Engine, każda aktywna runda | Tworzy sąsiedztwo wybranego planu i dla zestawów propozycji uruchamia `layoutDocument` |
| `movableInsertionProposalCandidates`, `movableGraphicProposalCandidates` — istnieją | Przy tworzeniu początkowych wariantów | Wyliczają pozycje; nie mierzą treści i nie tworzą stron |
| `movableInsertionProposalRefinements`, `movableGraphicProposalRefinements` — istnieją | Przy tworzeniu sąsiedztwa wybranego kandydata | Zwracają zestawy propozycji pozycji dla rundy |
| `movableInsertionProposalSignature` — istnieje | Prywatny szczegół obecnego przebiegu, jeśli dana ścieżka jest uruchomiona | Zwraca sygnaturę używaną przez aktualny kod; nie jest częścią docelowego interfejsu domenowego |

Nie projektujemy tutaj nowego cyklu generowania. Pierwsza ekstrakcja ma
zachować istniejący podział i kolejność wywołań; upraszczanie lub rozszerzanie
wyszukiwania będzie osobną zmianą kontraktu.

### 11.4. `document-layout.ts`

| Funkcja | Moment / wywołujący | Co uruchamia i zmienia |
|---|---|---|
| `layoutDocument` | Planner, raz na pełny przebieg | Tworzy nowy `LayoutState`; prowadzi poniższe fazy |
| `validateLayoutInputs` — prywatna | Początek przebiegu | Obecne walidacje bounds i growth; zapisuje diagnostykę preflight |
| `prepareLayers` — prywatna | Przed zwykłymi flow | Przygotowanie grafik, pierwszej strony, rezerwacji i treści wstawek |
| `planOrdinaryFlows` — prywatna | Po przygotowaniu warstw | Waliduje route/startPage; wywołuje `planFlow` dla zwykłych flow w zachowanej kolejności |
| `planRepeatedFlows` — prywatna | Po zwykłych flow | Ustala strony powtórzeń i wywołuje `planFlow` z zabronioną kontynuacją |
| `finalizeLayout` — prywatna | Po wszystkich flow | Pobiera snapshot i uruchamia końcowe projekcje; zwraca `CompositionPlan` |

`prepareLayers` zachowuje istotną kolejność obecnego przebiegu:
materializacja stron grafik -> zapewnienie pierwszej strony -> rezerwacja
przeszkód wstawek -> placement treści wstawek. Zmiana tej kolejności może
zmienić layout wybrany przez pierwsze utworzenie strony.

`finalizeLayout` wykonuje kolejno odpowiedniki `flattenPages`,
`normalizePlanReadingOrder`, `registerFlowPlacements`,
`registerFlowBarrierBoxCandidates`, `placeGlyphObjects`, zapis fazy
flow-placement i `tracePlan`. Projekcje istnieją; nie projektujemy ich na nowo.

### 11.5. `layout-state.ts`

| Metoda / funkcja | Kto / kiedy | Mutacja |
|---|---|---|
| `createLayoutState` | `layoutDocument`, początek każdego przebiegu | Tworzy puste kolekcje planu i stron |
| `ensurePage` | Przygotowanie warstw lub wybór celu przez flow | Tworzy brakującą stronę i jej sloty; istniejącej strony nie tworzy ponownie |
| `inspectPlacementArea` | Flow planner, przed próbą | Brak mutacji; odczytuje aktualną geometrię, zajętość i przeszkody |
| `applySlotGrowth` | Po wyliczeniu wymaganej wysokości, przed zatwierdzeniem | Zmienia wysokość i zależną geometrię; raportuje unieważnienie pomiaru |
| `reserveObstacle` | Przygotowanie warstw; także placement opływanego bloku | Zapisuje przeszkodę widoczną dla późniejszych prób |
| `collapseInsertionSlot` | Przygotowanie lub przejście flow obok nieużytej wstawki | Aktualizuje slot i powiązaną geometrię według dotychczasowej reguły |
| `commitPlacement` | Wyłącznie po zaakceptowanej lokalnej próbie | Dopisuje placement/linie lub fragment tabeli i aktualizuje zajętość |
| `recordEvents` | Po rozstrzygnięciu operacji | Dopisuje decyzje/diagnostykę w zachowanej kolejności |
| `recordResidual` | Gdy pozostała treść nie może być obsłużona | Zapisuje zakres nieumieszczonych słów/wierszy |
| `snapshot` | Finalizacja przebiegu | Udostępnia kompletny wynik do końcowych projekcji |

Pomocnicze operacje stron i geometrii są prywatne. Obliczenia nie zapisują
zdarzeń samodzielnie: zwracają je do właściciela stanu. Przy migracji trzeba
przypisać każdy istniejący event do jednej operacji, aby nie zapisywać go dwa razy.

### 11.6. `flow-planner.ts`

| Funkcja | Moment | Wywołania / efekt |
|---|---|---|
| `planFlow` | Raz na zwykły flow lub jedno jego powtórzenie | Tworzy cursor i prowadzi pętlę prób |
| `selectFlowTarget` — prywatna | Początek próby | Sprawdza limity, route i zgodność slotu; używa `ensurePage`, `routeSlots`, `slotFor` |
| `prepareTextAttempt` — prywatna | Po wyborze legalnego celu tekstu | Pobiera snapshot; ustala poprzedni/następny blok i ograniczenia przepływu |
| `planTextFragment` — importowana | Gdy bieżący blok jest tekstowy | Zwraca lokalne rozstrzygnięcie bez zmiany cursora |
| `planStructuredBlock` — projektowany interfejs istniejącego modułu | Gdy blok jest tabelą lub atomowy | Zwraca wynik pomiaru i placementu, postęp wierszy lub zakończenie bloku |
| `applyOutcome` — prywatna | Po rozstrzygnięciu próby | Zleca materializację/zapis, zapisuje events i zmienia cursor |
| `advanceCursor` — obecna operacja | Wynik wymagający następnego miejsca | Następny slot lub strona zgodnie z route |
| `resumeBelowObstacle` — prywatna | Wynik `resume-below` | Ustawia resumeY i identyfikator slotu; ponawia bieżący blok |
| `completeBlock` — prywatna | Cała treść bloku została zapisana lub blok pusty | Zwiększa blockIndex, zeruje offsety treści |
| `continueBlock` — prywatna | Zapisano tylko część | Zachowuje blockIndex i ustawia startWord albo startRow |

Wstawki nie są już obsługiwane jako authored blocks w `main`. Warstwa wstawek
otrzymuje bloki z nazwanego, nie-`main` flow, rezerwuje ich geometrie i
materializuje je przed zwykłym przepływem. `planFlow` nie utrzymuje stanu
odroczenia ani wznowienia cytatu.

### 11.7. `text-fragment-planning.ts` i `text-measurement.ts`

| Funkcja | Moment wewnątrz próby | Dane / rezultat |
|---|---|---|
| `planTextFragment` | Raz na próbę tekstową; ponownie po zmianie miejsca | Koordynuje poniższe obliczenia i zwraca jeden `FragmentOutcome` |
| `resolveBlockSpacing` — prywatna | Przed pierwszym wrappingiem | Wylicza odstęp od poprzednika i uwzględnia wznowienie za przeszkodą |
| `measureTextAttempt` — prywatna | Po ustaleniu pasma i odstępu | Wywołuje wrapping ograniczony miejscem i pełny potrzebny do sprawdzenia podziału |
| `tryCompressHeadingGap` — prywatna | Tylko gdy odstęp uniemożliwia zmieszczenie całego nagłówka | Ponawia pomiar bez odstępu i przyjmuje go tylko zgodnie z obecną regułą |
| `checkHeadingCluster` — prywatna | Dla nagłówka wymagającego następujących linii | Mierzy lead oraz bada przeszkody; może zwrócić wznowienie lub przejście |
| `selectLegalLineRange` — prywatna | Gdy próba nie została wcześniej zakończona | Stosuje zasady list, keep, minimum linii i całości nagłówka; wybiera zakres |
| `wordsForBlock` — istniejące obliczenie do przeniesienia | Przy przygotowaniu tekstu próby | Wyznacza słowa; wynik reużywany w tej próbie |
| `lineHeight`, `textPadding` — istniejące obliczenia do przeniesienia | Gdy potrzebny pomiar danego stylu | Odczytują metrics i walidują wynik |
| `wrapBlock` — istniejące obliczenie do przeniesienia | Każdy wariant pomiaru | Deleguje do istniejącego `wrapText`; zwraca `WrappedLine[]` |

To podział obowiązków, nie zgoda na przestawienie reguł. `checkHeadingCluster`
i `selectLegalLineRange` muszą zachować obecne pierwszeństwo warunków.
Na przykład pomiar listy może odrzucić próbę przed badaniem keep klastra.
W implementacji kolejność trzeba odwzorować z aktualnej funkcji i zabezpieczyć
testami; tabela nie narzuca uniwersalnego wykonania wszystkich helperów.

Jedno wywołanie `planTextFragment` może wykonać kilka wrappingów. Nie tworzy
przez to kilku placementów. Dopiero jego końcowy wynik `place` upoważnia
wywołującego do materializacji jednego wybranego fragmentu.

### 11.8. `text-placement.ts`

| Funkcja | Moment | Efekt |
|---|---|---|
| `materializeText` | Wynik `place`, po ustaleniu aktualnej geometrii | Koordynuje przekształcenie wybranych linii w dane planu |
| `resolveTextAlignment` — prywatna | Początek materializacji | Wylicza pionowe wyrównanie i pozycję tekstu w każdej linii |
| `buildTextPlacement` — prywatna | Po ustaleniu wyrównania | Buduje ramkę całego fragmentu i zakres słów |
| `buildCompositionLines` — prywatna | Dla wybranych WrappedLine | Tworzy linie, współrzędne i wywołuje istniejące `glyphSamplingBoxes` |

`materializeText` nie uruchamia kolejnego wrappingu. Dostaje wybrane linie
i dane wyrównania. Zwraca dane do `LayoutState.commitPlacement`; nie zmienia
pozycji cursora. Korzystają z niego zarówno zwykły flow, jak i warstwa wstawek.

### 11.9. `insertion-planning.ts` i przygotowanie warstwy

| Funkcja | Kto / kiedy | Efekt |
|---|---|---|
| `enumerateInsertionSlots` | Seedowanie lub wyprowadzanie kolejnych propozycji | Uporządkowana lista dostępnych miejsc według template/route |
| `measureInsertion` | Seedowanie oraz próba umieszczenia warstwy | Wspólny pomiar paddingu, linii i fit-content; zwraca też informację o overflow |
| `seedInsertionProposals` — istnieje, do przeniesienia | Planner przed początkowymi wariantami | Pierwszy zestaw proponowanych miejsc i rozmiarów |
| `deriveInsertionProposals` — odpowiednik `insertionProposalsFromPlan` | Stabilizacja po zakończonym przebiegu | Nowy zestaw uwzględniający faktyczne położenie poprzedzającej treści |
| `reserveInsertionLayer` — odpowiednik `reserveInsertionObstacles` | `prepareLayers`, przed tekstem flow | Przez LayoutState rezerwuje przeszkody i zamyka nieprzypisane sloty |
| `placeInsertionLayer` — istnieje, zmienione zależności | Po rezerwacji, przed zwykłymi flow | Mierzy każdą wstawkę, materializuje tekst, zapisuje wynik i uzgadnia ramkę przeszkody |

Operacje warstwy mogą być prywatnym plikiem `insertion-layer.ts` należącym
do implementacji `document-layout`. Nie należą do funkcji wyliczającej
propozycje, bo wykonują mutacje stanu przebiegu. Oba miejsca współdzielą
`measureInsertion`, dzięki czemu fit-content ma jedną implementację.

### 11.10. Grafiki i bloki strukturalne

| Moduł / funkcja | Kto / kiedy | Efekt |
|---|---|---|
| `graphic-planning.seedGraphicProposals` — istniejąca operacja do przeniesienia | Planner przed wariantami | Początkowe pozycje authored graphics |
| `graphic-planning.materializeGraphicPages` — istniejąca operacja do przeniesienia | `prepareLayers` na początku przebiegu | Zapewnia strony wymagane przez propozycje grafik |
| `graphic-planning.placeGraphicsForPage` — istniejąca operacja do przeniesienia | Przy przygotowaniu grafik i udostępnieniu nowej strony | Wylicza placementy dla strony; zapis ma zapobiegać powtórnej rezerwacji tej samej grafiki |
| `structured-block-placement.planStructuredBlock` — projektowana | Flow planner, próba tabeli lub bloku atomowego | Wybiera odpowiednią gałąź, zwraca jawny wynik |
| `planTableFragment` — projektowana prywatna | Tabela | Używa `metrics.measureTable`, startRow i reguły powtórzenia nagłówka; zwraca fragment oraz endRow |
| `planAtomicBlock` — projektowana prywatna | Obraz, KPI lub inny obsługiwany blok atomowy | Używa capability pomiarowej; zwraca cały blok albo potrzebę kolejnego miejsca |

Zapewnienie grafik dla nowej strony powinno mieć jedno miejsce uruchomienia
w orkiestracji. `LayoutState.ensurePage` może zwracać informację `created`,
na którą reaguje wywołujący. Sam moduł stanu nie importuje nadrzędnego
planera grafik. Przy przenoszeniu należy zachować wybór propozycji i obecną
kolejność zdarzeń, także gdy strona powstaje dopiero w zwykłym flow.

### 11.11. Evaluator i końcowe projekcje

Istniejące `evaluateCompositionPlan` uruchamia kontrole kompletnego planu:
m.in. `checkEmptyFlowPlacements`, `checkFlowBarrierBoxCandidates`,
`checkEmptyAndUnderfilledSlots`, `checkEarlyRouteTransitions` i
`checkInsertionSourceOrder`, a także kontrole linii, zakresów i placementów.
Scoring pozostaje przy `scoreLegalPlan` i jego obliczeniach składowych.
Opcjonalny contrast provider analizuje plan na etapie oceny.

Te funkcje nie są uruchamiane dla każdej próby fragmentu. Nie wywołują
`planFlow` ani nie modyfikują geometrii, aby naprawić wynik planera.
Dokument nie proponuje nowego podziału wnętrza evaluatora.

`registerFlowPlacements`, `registerFlowBarrierBoxCandidates`,
`placeGlyphObjects` i `tracePlan` pracują przy finalizacji przebiegu.
Trzeba odróżnić końcową projekcję barriers od lokalnego
`flowBarrierBoxCandidatesForSlot`, używanego podczas prób tekstu do
odczytu aktualnych przeszkód.

## 12. Konkretne sekwencje wywołań

### 12.1. Akapit mieści się częściowo w pierwszym slocie

```text
planFlow
  selectFlowTarget -> ensurePage
  prepareTextAttempt -> inspectPlacementArea
  planTextFragment
    resolveBlockSpacing
    measureTextAttempt -> wrapBlock -> wrapText
    selectLegalLineRange
    return place(fragment: słowa [startWord, endWord))
  applyOutcome
    [jeśli potrzeba: applySlotGrowth i ponowna próba po zmianie warunków]
    materializeText -> buildCompositionLines -> glyphSamplingBoxes
    commitPlacement
    recordEvents
    continueBlock(endWord)
    advanceCursor, jeśli dalszy tekst wymaga kolejnego segmentu
  kolejna iteracja dla reszty tego samego akapitu
```

`endWord` jest pozycją końca wyłącznego zakresu, nie liczbą słów do
ponownego dodania do cursora. Po pełnym akapicie następuje `completeBlock`.
Następny blok może wykorzystać pozostałe miejsce w tym samym slocie.

### 12.2. Nagłówek wymaga wznowienia pod przeszkodą

```text
planFlow -> prepareTextAttempt -> planTextFragment
  measureTextAttempt
  checkHeadingCluster -> pomiar nagłówka i początku następnego bloku
  return resume-below(y)
applyOutcome -> recordEvents -> resumeBelowObstacle(y)
planFlow: nowa próba tego samego nagłówka
  świeży request uwzględniający resumeY
  planTextFragment -> place albo advance
```

W pierwszej próbie nie ma materializacji ani zapisu linii. Jeżeli po
wznowieniu dalej nie ma miejsca, flow planner przechodzi do kolejnego
legalnego slotu. Lokalna funkcja nie tworzy strony.

### 12.3. Wstawka powoduje kolejny pełny przebieg

```text
planner.planCandidates
  seedInsertionProposals -> enumerateInsertionSlots + measureInsertion
  layoutDocument(proposals A)
    nowy LayoutState A
    prepareLayers -> reserveInsertionLayer -> placeInsertionLayer
    planOrdinaryFlows -> planFlow ...
    planRepeatedFlows -> planFlow ...
    finalizeLayout -> plan A
  return candidate set according to the existing planner contract
engine -> one evaluation phase over returned candidates -> legal-plan selection
```

Docelowo generowanie jest jedną fazą, a ocena następuje po jej zakończeniu.
Jeżeli obecny kod uruchamia dodatkowy pełny przebieg z powodu policy, jest to
szczegół do zachowania podczas mechanicznego przenoszenia, a nie nowa encja
ani osobna odpowiedzialność. Każdy dodatkowy pełny przebieg musi nadal tworzyć
niezależny stan i nie może przesuwać tylko jednego już zapisanego cytatu.

### 12.4. Engine uruchamia refinement wybranego planu

```text
engine: wybrany plan A
  planner.planRefinedCandidates(document, metrics, A, round)
    movableInsertionProposalRefinements / movableGraphicProposalRefinements
    dla zestawów propozycji: layoutDocument -> nowe pełne plany
  evaluate nowe plany
  compareCompositionEvaluations -> zachowaj lub zmień wybrany plan
  następna runda albo wynik końcowy
```

Cel docelowego kontraktu: elementy nieaktywne w danej rundzie zachowują
pozycje wybranego planu. Obecny problem resetowania do seedów wymaga
osobnej poprawki i testu; samo wydzielenie funkcji go nie naprawia.

### 12.5. Zakończenie i renderowanie

Po wyborze engine zwraca plan i ocenę. Orkiestracja raportu dopuszcza
renderowanie, przekazuje wynik do backendu i zapisuje artefakt. Obliczenia
fragmentów są już zakończone. Warstwa renderowania odczytuje współrzędne
i zakresy z planu; nie uruchamia `planTextFragment` ponownie.

## 13. Doprecyzowanie: odgórny plan stron i żądanie kolejnej strony

Przyjęte założenie jest następujące: template określa wymagania stron przed
rozpoczęciem planowania treści. Zwykła ścieżka to strona pierwsza w układzie
opening/first, a następne strony w układzie continuation. Wyjątki, takie jak
strona 5 z reklamą albo strona tytułowa, są częścią tego samego planu. Nie są
wynikiem tego, który flow jako pierwszy dotknął pustej tablicy `pages`.

Plan stron może być konkretną listą albo regułą rozwijaną dla numeru strony,
ale musi być ustalony niezależnie od kolejności wykonania flow. Przykład:

```text
page 1 -> title
page 2 -> first
page 3 -> continuation
page 4 -> continuation
page 5 -> continuation + required-ad-slot
page 6+ -> continuation
```

`CompositionTemplate` jest obecnie najbliższym nośnikiem tego kontraktu:
przechowuje layouty, sloty, `startPage`, `slotsByLayout` i routes. Adapter
stron buduje go z template’u i geometrii. Moduł zarządzający stronami powinien
udostępnić `layoutForPage(page)` oparty na tych danych i ewentualnych
wyjątkach stronowych. Nie wprowadzamy nowej encji ani osobnego obiektu z
własnym cyklem życia.

Flow nie mówi „utwórz dowolną stronę”. Zgłasza potrzebę, na przykład:

- kontynuacja tekstu, bo pozostały słowa;
- umieszczenie obrazu w dozwolonym miejscu względem określonego nagłówka;
- umieszczenie reklamy lub wstawki w wymaganym slocie;
- powtórzenie headera lub footera na już zaplanowanej stronie.

Założenie o stronie z reklamą wymaga rozróżnienia dwóch operacji:

```text
ensurePlannedPage(page, reason)
  -> sprawdza, czy numer strony i wymagany layout/slot są zgodne z planem stron
  -> tworzy stronę zgodnie z harmonogramem albo zwraca błąd

findNextLegalPage(startPage, requirement)
  -> szuka następnej strony dozwolonej dla tej potrzeby
  -> może zwrócić page 6, jeśli page 5 jest zarezerwowana i flow nie może jej użyć
```

Pierwsza operacja jest ścisła: jeżeli ktoś wymaga konkretnej strony 5,
nie wolno po cichu przenieść tej potrzeby na stronę 6. Druga może ominąć
stronę 5 tylko wtedy, gdy kontrakt flow pozwala na dalszą kontynuację i plan
stron przewiduje legalną stronę 6. W obu przypadkach powód potrzeby powinien
zostać zapisany w decyzjach planu.

Docelowy `ensurePage` jest więc operacją egzekwującą, a nie źródłem wymagań.
Powinien otrzymać numer lub zakres dozwolonych stron, wymagany layout,
opcjonalny slot/rolę oraz tryb `strict` albo `search-next`. Powinien:

1. odczytać niemutowalną regułę planu stron przez `layoutForPage(page)`;
2. sprawdzić limit stron i wymagany layout;
3. sprawdzić wymagane sloty oraz rezerwacje;
4. utworzyć brakujące strony wyłącznie według harmonogramu;
5. zwrócić stronę, legalne następne miejsce albo typed error.

Nie powinien wybierać layoutu przez `routeLayout` przekazanego przypadkowo
przez pierwszy flow. Route nadal określa kolejność slotów i uprawnienia flow,
lecz reguła `layoutForPage(page)` określa, jaki layout fizycznie ma dana
strona.

Jeżeli wymaganie template’u jest sprzeczne samo ze sobą, błąd powinien zostać
wykryty w preflight przed generowaniem kandydatów. Jeżeli template jest
poprawny, ale żadna treść nie daje się w nim umieścić, engine powinien zwrócić
`unsatisfiable`/brak wykonalnego planu. Nie powinien wybierać odrzuconego
planu tylko dlatego, że był pierwszym kandydatem.

Zatem właściciele są rozdzieleni:

```text
template / layoutForPage  -> wymagania stron
flow planner             -> potrzeba wynikająca z postępu treści
page scheduler/ensurePage -> kontrola, czy potrzeba jest legalna
planner                  -> kandydat placementu w ramach wymagań
evaluator                -> końcowa weryfikacja kompletnego planu
engine                   -> wybór legalnego planu albo brak wykonalnego planu
```

Ten kontrakt powinien zostać przetestowany przed ekstrakcją `LayoutState`:
strona tytułowa, zwykła kontynuacja, pominięcie zarezerwowanej strony,
żądanie ścisłej strony oraz przekroczenie `maxPages`.
