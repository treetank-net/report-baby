# Plan: miękkie insertions dla cytatów, grafik i nazwanych flow

Status: plan po commicie `4bc5de4` (`feat: add configurable quote glyph rendering`).
Historyczna notatka: przykłady, w których insertion wskazuje
`source: { flow: main, ... }`, są superseded. Obowiązujący kontrakt wymaga,
aby quote należał do osobnego, nazwanego flow (np. `quotes`) deklarującego
`insertionSlots`; `main` nie może mieć `insertionSlots` ani inline quote.
Aktualny kontrakt opisują dokumenty w
`docs/composition/`.

Data: 2026-09-01

## Cel

Obecny renderer potrafi już narysować cytat poza zwykłym flow tekstu, zarezerwować
na niego przeszkodę i sprawić, że główny tekst ją omija. To jest dobry fundament,
ale w obecnym modelu cytat jest nadal elementem twardo wpisanym w szablon:

- route `quotes` ma listę slotów `quote-a`, `quote-b`, `quote-c`,
- sloty są ustawione w z góry ustalonych miejscach strony,
- route ma `start_page: 2`,
- kolejność slotów jest jednocześnie kolejnością cytatów,
- `fit_content` zmienia wysokość boxa, ale nie daje cytatowi ogólnej możliwości
  znalezienia lepszego miejsca,
- mechanizm wyboru jest częściowo specjalizowany dla roli `quote`.

Docelowo cytat powinien być miękkim wtrąceniem: użytkownik deklaruje jego
preferencje, a planer generuje możliwe miejsca, mierzy zawartość, tymczasowo
rezerwuje wybrane miejsce jako twardą przeszkodę i wybiera najlepszy układ.
Po wyborze przeszkoda staje się twarda dla pozostałych flow, ale sama definicja
cytatu nie narzuca już konkretnego slotu ani konkretnej strony.

Ten sam kontrakt powinien obsługiwać grafikę, tabelę, callout lub dowolny inny
named flow. Różnicą ma być sposób pomiaru i renderowania zawartości, a nie
mechanizm pozycjonowania.

## Co robi obecny kod

### Model strony i flow

`server/src/composition/model.ts` opisuje dokument jako wiele named flows.
`CompositionFlowRoute` posiada między innymi `startPage`, `continuation` oraz
`insertionSlots`. `CompositionSlot` jest prostokątem, do którego można wybrać
blok, a `CompositionPlan` przechowuje między innymi:

- zwykłe `placements` i `lines`,
- `graphicPlacements`, które służą także jako planner-only obstacles,
- `insertionLines` dla zawartości narysowanej poza zwykłym main flow,
- `flowPlacements`, czyli faktyczne fragmenty dostępnego nurtu,
- `flowBarrierBoxCandidates`, czyli segmenty nurtu rozcięte przez kolizje,
- decyzje, diagnostykę i residual content.

To ważne rozróżnienie należy zachować: `flowPlacement` opisuje miejsce, w którym
może położyć się zwykły tekst; `flowBarrierBoxCandidate` opisuje możliwy użyteczny
fragment po uwzględnieniu przeszkody. Żaden z nich nie powinien być mylony z
preferencją położenia wtrącenia.

### Kolejność obecnego planowania

W `server/src/composition/text-planner.ts` przebieg jest obecnie następujący:

1. `seedInsertionProposals()` bierze deklaracje z route i tworzy wstępne
   propozycje dla cytatów.
2. `reserveInsertionObstacles()` rejestruje wybrane miejsca cytatów jako
   `graphicPlacements` z `wrap: 'around'` i `paint: false`. Są to przeszkody
   dla planowania, a nie drugi rysunek cytatu.
3. `placeInsertionLayer()` układa tekst cytatów do `insertionLines`.
4. Zwykłe flow, w szczególności `main`, jest układane z uwzględnieniem tych
   przeszkód.
5. `flowBarrierBoxCandidatesForSlot()` oraz `wrapBlock()` dzielą dostępny
   nurt na fragmenty nad, obok i pod przeszkodą.
6. `placeGlyphObjects()` umieszcza dekoracyjne glify względem już znanych
   linii i boxów.

W aktualnym kodzie znajduje się również stabilizacja: po pierwszym przejściu
`insertionProposalsFromPlan()` tworzy sygnaturę położeń i planer może wykonać
kolejne przejście. To jest zalążek rozwiązania iteracyjnego, ale dziś propozycje
pochodzą nadal z ograniczonego, slotowego modelu.

### Obecny szablon editorialu

W `server/templates/render-config.yml` route cytatów jest zdefiniowany osobno,
ma trzy insertion slots i zaczyna się na stronie 2. Sloty odpowiadają mniej
więcej pozycjom 1/4, 2/4 i 3/4 wysokości strony. Jest to wygodne jako demonstracja
oraz kompatybilność wsteczna, ale nie jako docelowy kontrakt redakcyjny.

`fit_content` i wzrost boxa rozwiązują tylko wymiar pionowy. Nie opisują:

- dozwolonych stron,
- preferowanego miejsca względem treści,
- kosztu odsunięcia od preferencji,
- kosztu pozostawienia zbyt dużej pustej przestrzeni,
- tego, czy wtrącenie powinno przeciąć obie kolumny,
- relacji „na tej samej stronie co blok X”,
- kolejności kilku konkurujących wtrąceń.

### Grafiki

`CompositionGraphic` oraz `CompositionGraphicPlacement` mają obecnie asset,
slot, stronę, kształt i `wrap`. Grafika jest traktowana jako geometryczny
obiekt, a jej box/caption są wynikiem wybranego slotu. Ten mechanizm jest
bliski potrzebnemu rozwiązaniu, ale nie ma wspólnego kontraktu preferencji z
cytatami. Nie należy kopiować logiki cytatów do grafik. Należy wydzielić wspólny
planer położeń i pozostawić osobne adaptery pomiaru/renderingu.

## Docelowy model pojęciowy

Należy rozdzielić cztery rzeczy, które dziś są częściowo reprezentowane tymi
samymi strukturami:

1. **Insertion definition** — deklaracja użytkownika/LLM: co ma być wtrącone,
   z czego powstaje i jakie ma preferencje.
2. **Insertion candidate** — możliwe miejsce wygenerowane przez planer.
3. **Planned insertion** — wybrany kandydat wraz z pomiarem, score i wyjaśnieniem.
4. **Flow obstacle** — geometryczna, już obowiązująca przeszkoda przekazywana
   do planowania zwykłego tekstu.

Proponowany kontrakt, nazwany roboczo `CompositionInsertionDefinition`:

```ts
interface CompositionInsertionDefinition {
  id: string;
  kind: 'text' | 'quote' | 'image' | 'table' | 'flow';
  source: { flowId?: string; blockId?: string; graphicId?: string };
  content: InsertionContentDefinition;
  box: {
    width: SizeConstraint;
    height: SizeConstraint;
    minHeight?: number;
    maxHeight?: number;
  };
  alignment?: 'left' | 'center' | 'right' | 'full';
  placement: {
    page: PageConstraint;
    y: VerticalPlacementPreference;
    order?: number;
    anchor?: AnchorConstraint;
  };
  collision: { wrap: 'none' | 'around'; inset?: number };
  scoring?: InsertionScoringPolicy;
}
```

Nazwy i dokładne typy mogą zostać dopasowane do istniejącego modelu, ale
istotne jest, aby `source`, zawartość, geometria, ograniczenia i preferencje
były osobnymi polami. `quote` powinien być odmianą `text` z adapterem cytatu,
a nie osobną ścieżką wyboru slotu.

### Ograniczenia twarde i miękkie

Strona powinna obsługiwać jawne warianty:

- `exact: 2` — błąd, jeśli nie da się użyć strony 2,
- `same_as: block-id` — domyślnie preferencja; opcjonalnie `hard: true`,
- `range: { min: 2, max: 3 }`,
- `any` — dowolna strona w zakresie dokumentu.

Analogicznie pozycja pionowa powinna rozróżniać:

- preferowaną wartość absolutną,
- preferowany ułamek obszaru flow,
- tolerancję bez kary,
- sposób snapowania: `line-boundary`, `flow-boundary` albo `none`.

„Miękkie” nie oznacza ignorowania boxa. Oznacza, że preferowana pozycja jest
jednym z kandydatów i może zostać zmieniona, jeśli inny kandydat ma lepszy
wynik albo pierwszy powoduje twardą kolizję.

## Proponowany algorytm

### A. Normalizacja

Przed planowaniem zwykłych flow należy zebrać wszystkie insertion definitions
ze wszystkich route’ów, nie tylko z route o nazwie `quotes`. Walidacja powinna
sprawdzić identyfikatory, źródła, zakres stron, wymiary i zgodność typu
zawartości. Brak source lub niemożliwy wymiar powinien być diagnostyką planu,
nie cichym pominięciem elementu.

Tryb kompatybilny powinien konwertować obecne `insertionSlots` na definicje z
preferencją `exact slot`. Dzięki temu istniejące szablony nadal działają, ale
nowy model ma jeden punkt wejścia.

### B. Generowanie kandydatów

Dla każdego insertion należy wygenerować ograniczoną listę kandydatów, zamiast
próbować każdą współrzędną. Kandydaci powinni pochodzić z:

- dozwolonych stron,
- preferowanego y oraz granic tolerancji,
- początku i końca dostępnego flow,
- górnych i dolnych granic istniejących `flowBarrierBoxCandidate`,
- granic obrazów, tabel i innych wybranych insertionów,
- przesunięć o całe line-height oraz korekty wynikającej z baseline/font metrics,
- naturalnych przejść między kolumnami i stronami.

Kandydat musi zawierać pełny box, nie tylko cursor:

```ts
interface CompositionInsertionCandidate {
  insertionId: string;
  page: number;
  box: CompositionRect;
  contentMeasure: ContentMeasure;
  hardViolations: HardViolation[];
  score: ScoreBreakdown;
  origin: 'preferred' | 'barrier-boundary' | 'flow-boundary' | 'reflow';
}
```

Cursor pozostaje potrzebny do rysowania zwykłego flow, bo wskazuje następny
fragment źródła i bieżący punkt linii. Nie powinien jednak być jedynym źródłem
położenia wtrąceń. Dla insertion cursor dostarcza kolejność treści i ewentualny
anchor, natomiast box kandydata jest wynikiem osobnej fazy pozycjonowania.

### C. Pomiar zawartości

Każdy kandydat trzeba zmierzyć przed zatwierdzeniem przeszkody:

- cytat: podział na linie z aktualnym fontem, paddingiem i glifami,
- obraz: naturalny rozmiar, `contain`/`cover`, caption i ewentualny caption box,
- tabela: wysokości wierszy, nagłówków i kontynuacji,
- named flow: jego własny planner w zadanym boxie.

Istniejący adapter jsPDF do pomiaru fontów może pozostać wspólną usługą. Ważne,
aby planner otrzymywał wynik pomiaru jako dane geometryczne, a nie samodzielnie
rysował PDF.

### D. Tymczasowa przeszkoda i ocena

Po pomiarze kandydat tworzy tymczasowy `FlowObstacle`. Na tej podstawie trzeba
uruchomić układ odpowiednich flow lub przynajmniej lokalną symulację kolizji.
Dopiero wybrany kandydat trafia do finalnego `graphicPlacements`/obstacle
registry i wpływa na późniejsze zwykłe flow.

Score powinien być jawny i rozbity na składniki:

- twarde naruszenia: kandydat odrzucany,
- kara za odejście od preferowanego y,
- kara za nieutrzymanie strony/anchora soft,
- kara za pustą przestrzeń nad lub pod wtrąceniem,
- kara za nierówne zakończenia kolumn,
- kara za rozbicie bloku lub nagłówka,
- bonus za pełną szerokość i przecięcie obu kolumn, jeśli tak stanowi template,
- bonus za rozpoczęcie w naturalnej granicy flow,
- bonus za podobne marginesy i wyrównanie względem sąsiednich elementów.

Wagi muszą trafić do `server/templates/render-config.yml`, zgodnie z zasadą
repozytorium. Kod nie powinien zawierać kopii wartości typu „5 mm”, „1/4 strony”
ani arbitralnych wag.

### E. Stabilizacja

Po wyborze insertionów należy ułożyć zwykłe flow i sprawdzić, czy ich rozmiar
nie zmienił wymiarów lub pozycji insertionów. Iteracja powinna mieć:

- limit z konfiguracji,
- sygnaturę `(insertionId, page, x, y, width, height)`,
- diagnostykę przy braku zbieżności,
- wybór najlepszego legalnego planu z dotychczasowych iteracji.

Przy większej liczbie insertionów można użyć beam search lub enumeracji
ograniczonej do najlepszych kilku kandydatów. Nie należy od razu budować
globalnego optymalizatora; najpierw potrzebny jest deterministyczny lokalny
model z czytelnym score.

## Zakres zmian w kodzie

### 1. Model i schema

Rozszerzyć `server/src/composition/model.ts` oraz `server/src/contract/schema.ts`
o definicje constraints, insertion definitions, candidates, score breakdown i
hard violations. Obecne pola `insertionSlots` pozostawić jako kompatybilność i
oznaczyć w modelu jako legacy input.

W `CompositionPlan` dodać osobne kolekcje dla definicji, kandydatów i wybranych
położeń. `graphicPlacements` powinno oznaczać finalne przeszkody geometryczne;
nie powinno służyć do przechowywania niezatwierdzonych propozycji.

### 2. Wydzielenie planera insertionów

Z `text-planner.ts` wydzielić moduł roboczo nazwany
`server/src/composition/insertion-planner.ts`. Powinien zawierać:

- normalizację definicji,
- generowanie kandydatów,
- pomiar zawartości przez adapter,
- walidację kolizji,
- score i wybór,
- konwersję wybranego boxa do finalnej przeszkody.

`text-planner.ts` ma pozostać właścicielem kolejności flow i cursorów, ale
powinien otrzymywać już wybrane insertion obstacles oraz ich metadane, zamiast
znać szczegóły `quote`.

### 3. Adaptery zawartości

Wprowadzić wspólny interfejs w rodzaju:

```ts
interface InsertionContentAdapter {
  measure(input: InsertionMeasureInput): ContentMeasure;
  layout(input: InsertionLayoutInput): InsertionLayout;
  paint(input: InsertionPaintInput): void;
}
```

Adapter cytatu wykorzysta istniejące dzielenie tekstu na linie, quote padding,
font glyphów i `insertionLines`. Adapter grafiki zwróci box obrazu/caption,
zachowując obecne `assetId`, shape i fit mode. Adapter tabeli lub named flow
może dojść później bez zmiany pozycjonowania.

### 4. Szablony

Dodać w konfiguracji deklarację stref/preferencji, na przykład:

```yaml
insertions:
  - id: quote-1
    kind: quote
    source: { flow: main, block: quote-1 }
    placement:
      page: { range: { min: 2, max: 3 } }
      y: { fraction: 0.25, snap: line-boundary }
      same_as: { block: article-section-1, hard: false }
    collision: { wrap: around }
```

Dokładna składnia powinna pasować do obecnej składni YAML, ale semantyka musi
być niezależna od nazw `quote-a/b/c`. Dotychczasowe sloty zostawić jako
`legacy insertion slots`, aby można było porównać render i stopniowo migrować
profile.

### 5. Wspólny model dla grafik

Grafika powinna korzystać z tych samych:

- constraints strony i anchora,
- preferencji y/x/alignment,
- generatora kandydatów,
- score,
- rejestru finalnych obstacles,
- debugowego opisu `preferred`, `candidate`, `selected`, `rejected`.

Jej kształt pozostaje geometrią kolizji, a box obrazu i caption są wynikiem
adaptera. Dzięki temu grafika może być „na tej samej stronie co X”, preferować
1/3 wysokości, unikać cytatu albo dostać karę za wypchnięcie nagłówka — bez
tworzenia osobnej logiki w `text-planner.ts`.

### 6. Debug i diagnostyka

Rozszerzyć istniejący composition debug o warstwy:

- flow frame,
- collision obstacle,
- flow barrier candidate,
- insertion preferred position,
- insertion candidate,
- selected insertion,
- rejected candidate z powodem,
- padding/margin i content box,
- hard violation oraz składniki score.

Etykieta techniczna powinna być rysowana obok ramki, z automatycznym wyborem
strony zewnętrznej, żeby nie zasłaniała tekstu. Debug powinien korzystać z tych
samych obliczeń co zwykły renderer, a nie z osobnego przybliżenia.

## Plan migracji

1. Dodać model i walidację bez zmiany renderingu.
2. Zaimplementować adapter cytatu oraz konwersję starych slotów do definicji
   z dokładnie tym samym położeniem.
3. Dodać generowanie i rysowanie kandydatów w debug mode, nadal wybierając
   dotychczasowy slot jako selected candidate.
4. Włączyć score i wybór między kandydatami tylko dla jednego testowego cytatu.
5. Przenieść wszystkie cytaty editorialu na soft preferences i porównać PDF,
   score oraz plan z poprzednim baseline’em.
6. Podłączyć grafiki do tego samego engine’u, najpierw w trybie zachowującym
   bieżące sloty.
7. Dopiero po testach usunąć specjalne gałęzie `block.role === 'quote'` i
   legacy sloty, których nie potrzebują już profile.

## Testy i kryteria akceptacji

### Testy jednostkowe

- preferowany kandydat bez kolizji wygrywa z dalszym legalnym kandydatem,
- kandydat z twardą kolizją jest odrzucony niezależnie od score,
- `same_as` soft może zostać naruszone, a `same_as` hard nie może,
- zmiana długości cytatu zmienia wysokość boxa i kandydatów, nie łamie tekstu,
- obraz i cytat korzystają z tego samego generatora pozycji,
- cursor main zaczyna się na granicy wybranego obstacle, a nie na granicy
  niezatwierdzonego kandydata,
- różnica baseline/glif nie przesuwa ramy poza faktyczny ink box.

### Testy integracyjne

- obecny numbered editorial z czterema cytatami,
- editorial z jednym krótkim cytatem,
- długi cytat przechodzący przez dwie linie i obie kolumny,
- obraz full-width z caption i cytat w pobliżu,
- obraz kolizyjny tylko z jedną kolumną,
- kilka insertionów konkurujących o tę samą stronę,
- named flow `info` poza `main`.

Każdy przypadek powinien zachować artefakty: zwykły PDF, composition-debug PDF,
JSON planu, score breakdown i diagnostykę. Harness powinien sprawdzać nie tylko
czy PDF powstał, ale także:

- brak pustego placementu pomiędzy zapełnionymi placementami tego samego flow,
- brak hard violations,
- zgodność selected insertion z finalnym obstacle,
- zgodność boxów debugowych z boxami w planie,
- legalność i residual content.

### Kryteria wizualne

Nie wystarczy, że tekst nie nachodzi na przeszkodę. Trzeba sprawdzać również:

- równe paddingi i marginesy,
- naturalne granice po cytacie,
- brak nieuzasadnionego pustego boxa,
- heading wraz z minimalnym fragmentem tekstu,
- zgodność końców kolumn,
- położenie caption względem obrazu,
- czy glify nie wychodzą poza content/ink bounds.

## Poza zakresem pierwszej wersji

- dowolny kod JavaScript w konfiguracji score,
- optymalizacja całego dokumentu metodą globalną,
- swobodne skalowanie i obracanie elementów jako sposób naprawy układu,
- usunięcie kompatybilności ze slotami przed zapisaniem baseline’u,
- traktowanie debugowych ramek jako osobnego, ręcznie utrzymywanego layoutu.

## Decyzja architektoniczna

Najważniejsza granica brzmi: definicja insertionu jest miękka, ale wybrana
geometria insertionu jest twardą przeszkodą dla dalszego flow. `flowPlacement`
wyznacza legalny nurt tekstu, `flowBarrierBoxCandidate` wyznacza potencjalny
fragment tego nurtu po kolizji, a `cursor` prowadzi źródło tekstu przez wybrane
fragmenty. Żaden z tych obiektów samodzielnie nie powinien udawać preferencji
położenia cytatu lub grafiki.

To rozdzielenie pozwoli najpierw zobaczyć kandydatów w debug PDF, następnie
wyjaśnić score i dopiero na końcu włączyć wybór soft. Dzięki temu każda zmiana
położenia będzie miała jednocześnie geometryczne uzasadnienie, zapis w planie
i możliwość odtworzenia w harnessie.
