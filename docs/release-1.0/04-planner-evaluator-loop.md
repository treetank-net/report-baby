# Plan 04 — pętla planner–evaluator

Status: ograniczona pętla selekcji kandydatów jest zaimplementowana i
zweryfikowana dla ruchomego cytatu; globalne feedback-driven rewrites pozostają
poza zakresem eksperymentu 1

## Cel

Planner i evaluator mają współpracować przy wyborze układu:

```text
planner przygotowuje wariant
  → plan jednego przebiegu
  → evaluator ocenia go raz
  → feedback wskazuje legalność i jakość
  → planner przygotowuje ograniczoną zmianę
  → wybór najlepszego legalnego planu
```

To nie wymaga rozmowy z LLM-em. „Rozmowa” oznacza deterministyczne przekazanie
wyniku ewaluacji do kolejnego kroku planera.

## Stan obecny

`createTextCompositionPlanner` udostępnia deterministyczne kandydaty dla
istniejącej propozycji insertionu. Engine ewaluje każdy kandydat raz, odrzuca
nielegalne warianty, wybiera legalny plan z najwyższym score, a przy remisie
zachowuje wcześniejszy wariant. Po wyborze planner może wykonać ograniczoną
lokalną rundę refinementu wokół najlepszego kandydata i engine ponownie ocenia
tylko tę skończoną listę. Jednoplanowa ścieżka pozostaje kompatybilna dla
innych plannerów.

To jest feedback evaluatora w kontrolowanej postaci: evaluator zwraca
legalność, score i breakdown, a planner używa wybranego placementu jako środka
lokalnego zakresu. Nie jest to jeszcze globalny rewrite wszystkich decyzji
layoutowych. Reflow pozostaje osobnym kosztem przygotowania pojedynczego
kandydata i jest raportowany oddzielnie w `reflowPasses`.

## Wnioski z analizy obecnego mechanizmu

- Stałe sloty `A/B/C` nie tworzą jeszcze sensownej przestrzeni optymalizacji.
  Przy zachowanej kolejności cytatów wybór jest w praktyce zachłanny i
  deterministyczny.
- Kandydaty dla ruchomego insertionu są niezależnymi alternatywami jego pozycji
  w jawnych bounds. Nie są już tylko przebiegami stabilizacyjnymi. Dla
  przypadków bez `movableInsertionBounds` nadal pozostaje ścieżka jednego planu
  albo stabilizacyjnych reflow.
- Reflow jest potrzebny tylko wtedy, gdy pozycja insertionu zależy od
  położenia wcześniejszej treści albo innej przeszkody. Jeżeli box ma już
  ustaloną, legalną pozycję, wystarczy jedno pełne planowanie i ewaluacja.
- Rzeczywisty eksperyment optymalizacyjny powinien opisywać w istniejącej
  propozycji placementu: pozycję preferowaną, dozwolone bounds, zmierzony
  rozmiar i sposób wyrównania. Planner może wtedy wygenerować skończony zbiór
  pozycji w bounds, najlepiej wyrównanych do siatki linii, usunąć duplikaty i
  ocenić każdy kompletny plan.
- Reflow pozostaje wewnętrznym etapem przygotowania pojedynczego kandydata,
  jeśli kandydat ma anchor zależny od tekstu. Nie powinien być sam w sobie
  traktowany jako alternatywa jakościowa.
- Pierwszy eksperyment ograniczamy do jednego ruchomego cytatu oraz fixture’u
  z wieloma małymi akapitami. Mierzymy liczbę unikalnych kandydatów, legalność,
  liczbę przebiegów reflow, score i miarę łamania tekstu. Dopiero po tym można
  rozważać wiele jednocześnie ruchomych insertionów.

Eksperymentalny seam w plannerze to `movableInsertionBounds`, kluczowany tym
samym `flow:block`, który już identyfikuje insertion. Każda definicja zawiera
`bounds`, opcjonalną preferowaną pozycję, oś (`x` lub `y`) i `candidateCount`.
Rama jest obszarem legalnym, a nie rozmiarem cytatu: planner zachowuje zmierzony
rozmiar cytatu i przesuwa jego prostokąt tak, aby w całości mieścił się w ramie.
Każdy wygenerowany prostokąt dostaje osobny pełny plan. Wybrany plan zachowuje
ramę w `movableInsertionFrames`, dzięki czemu zwykły composition debug może
wyrysować ją na czerwono. W pierwszym eksperymencie wszystkie sześć pozycji
było legalnych, pozycje `y` wyniosły `25, 37, 49, 61, 73, 85`, a przebieg reflow
wyniósł `0` dla każdego kandydata, ponieważ rama nie była zależna od tekstu.
W kontrolowanym fixture ruchomego insertionu silnik wygenerował pięć
kandydatów coarse oraz trzy kandydatury refinementu. Wszystkie były legalne,
a ich score różnił się przez balans, spacing i fragmentację tekstu. W realnym
editorialu zmiana pozycji cytatu usuwała wykryte orphan lines i poprawiała
wynik względem stałej pozycji; szczegóły są w trace oraz w teście
`test-editorial-numbered-flow.mjs`.

Istniejące dane, które mogą być pierwszym neighborhood kandydatów:

- insertion proposals;
- route i sloty;
- flow barriers i `flowBarrierBoxCandidates`;
- istniejące breakpoints tekstu;
- growth/defer dla elementów, które już mają takie reguły.

## Minimalny wariant implementacji

1. Pozostawić `planDocumentOnce()` jako wykonanie jednego wariantu.
2. Utrzymywać ograniczony feedback: wybrany kandydat i numer rundy są jedyną
   informacją zwrotną do lokalnego refinementu. Nie przekazywać evaluatorowi
   odpowiedzialności za mutowanie planu.
3. Generować tylko deterministyczne warianty istniejących decyzji. Na pierwszy
   eksperyment wybrać jeden przypadek, rekomendacyjnie:
   - przesunięcie grafiki/cytatu względem istniejących flow barriers; albo
   - wybór breakpointu, gdy kolejna linia trafia w obstacle.
4. Ograniczyć liczbę wariantów i iteracji wartościami z YAML.
5. Deduplikować warianty po istniejącej sygnaturze placementów/proposals.
6. Oceniać każdy wariant dokładnie raz.
7. Odrzucać hard violations przed porównaniem score.
8. Zachować najlepszy legalny plan, a nie ostatni plan.
9. Jeżeli nie ma legalnego planu, zwrócić `rejected` z agregatem diagnostyki.
10. W trace zapisać kolejność prób, wynik, score i powód kolejnej zmiany.
11. Utrzymać `page-fill-table` jako przyszły kontrolowany przypadek dla innych
    insertionów. Nie optymalizować jednocześnie tabeli, cytatów i wszystkich
    flow.

## Pseudoprzebieg

```text
wariant początkowy
  → planDocumentOnce
  → evaluate
  → zapisz wynik
  → wygeneruj następną dozwoloną zmianę
  → powtarzaj do braku zmiany, stabilizacji albo limitu
  → zwróć najlepszy legalny plan
```

Nie należy na początku zmieniać jednocześnie pozycji grafik, cytatów,
breakpointów, growth i routingu na całym dokumencie. Wtedy nie będzie wiadomo,
która decyzja poprawiła lub zepsuła układ.

## Testy i kryteria ukończenia

- dwa legalne warianty wybierają wariant z wyższym score;
- wariant nielegalny nie wygrywa przez wysoki score;
- realne przebiegi insertion reflow i ruchome pozycje są obserwowalne osobno;
- trace raportuje koszt `reflowPasses` osobno dla każdego kandydata, aby można
  było mierzyć koszt selekcji przed optymalizacją;
- test graniczny rozróżnia pierwszy odrzucony plan source-order i drugi plan
  zaakceptowany po przeniesieniu insertionu;
- limit iteracji jest respektowany;
- kolejność wariantów jest deterministyczna;
- jeden wariant ma dokładnie jedną ewaluację;
- trace pokazuje wszystkie próby;
- realny editorial pokazuje widoczną, uzasadnioną zmianę układu;
- koszt pełnego planowania jest mierzony i ma konfigurowalny limit.
- test pokazuje, że różnica pomiędzy dwoma legalnymi wariantami wynika z
  jawnego feedbacku evaluatora, a nie z przypadkowej kolejności rysowania.

## Wymaga uzupełnienia po wykonaniu punktu X

- Globalny zakres feedbacku wymaga uzupełnienia po benchmarku wielu
  jednocześnie ruchomych insertionów. Eksperyment 1 świadomie ogranicza się do
  jednego cytatu.
- Dokładne mapowanie składników score na decyzje planera wymaga dalszych testów;
  obecnie wystarczają score breakdown, placementy i trace.
- Limit kosztu wymaga uzupełnienia po benchmarku realnego editorialu, nie na
  podstawie samego limitu `planner_max_iterations`.

## Poza zakresem

Nie budujemy globalnego solvera, losowego searchu ani nie pozwalamy, aby
nielegalny plan był fallbackiem „najmniej złym”.
