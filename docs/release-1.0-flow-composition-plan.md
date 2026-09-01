# Plan release 1.0: stabilny model flow i kompozycji

Status: plan do implementacji

Data: 2026-09-01

## Decyzja produktowa

Report Baby przechodzi na kanoniczny model:

```text
named flows → planner → placements → obstacles → renderer
```

To jest docelowa architektura, a nie warstwa kompatybilności ze starym
rendererem. Przed 1.0 dopuszczamy breaking changes, jeśli prowadzą do jednego,
stabilnego i łatwego w utrzymaniu kontraktu.

Obowiązujące zasady:

- flow definiuje kolejność i ciągłość treści;
- template definiuje legalną geometrię, regiony, sloty i trasy;
- planner wybiera konkretne placementy i mierzy zawartość przed renderowaniem;
- placement jest przypisaniem bloku lub fragmentu bloku do geometrii;
- obstacle jest finalnym obszarem niedostępnym dla późniejszego tekstu;
- renderer jest adapterem planu, nie miejscem podejmowania decyzji redakcyjnych;
- ten sam model ma obsługiwać artykuły główne, pomocnicze flow, grafiki,
  cytaty, KPI, metryki, wykresy i tabele.

Nie celem jest odtworzenie zachowania starego `Cursor` ani zachowanie starego
płaskiego `ReportData`. Celem jest stabilny model, z którego można łatwo
budować nowe edytoriale.

## Stan wyjściowy

Branch `composition-checkpoint-2026-08-30` zawiera działający vertical slice:

- `CompositionInput` i named flows są wejściem produkcyjnego `render_report`;
- tekst jest planowany przed rysowaniem;
- nagłówki mogą być utrzymywane z minimalnym fragmentem kolejnego tekstu;
- obrazy `wrap: left/right` tworzą planner-only boundaries;
- graphics `wrap: around` są przeszkodami dla zwykłego flow;
- prostokąty, elipsy i poligony mogą dostarczać geometrię kolizji;
- `flowPlacements` opisują rzeczywisty nurt tekstu;
- `flowBarrierBoxCandidates` opisują segmenty nurtu po rozcięciu przeszkodą;
- cursor przeprowadza źródło przez wybrane segmenty, ale nie wybiera położenia
  niezależnych wtrąceń;
- evaluator sprawdza pokrycie treści, kolejność, containment i overlap;
- debug PDF pokazuje planowane placementy, obstacles i flow barriers;
- fonty są ładowane z zewnętrznego brand source i mierzone przez ten sam
  mechanizm jsPDF, który później rysuje tekst.

To nie jest lista funkcji do cofnięcia. To jest baza, którą trzeba oczyścić,
ujednolicić i domknąć przed 1.0.

## Krytyka Solego

Sol potwierdził kierunek flow i wskazał dwa realne ryzyka:

1. Geometria jest częściowo rekonstruowana równolegle przez compiler template’u
   oraz `page-template-adapter`. Przed 1.0 trzeba ustalić jedną canonical
   representation geometrii.
2. `text-planner.ts` jest zbyt płytkim modułem z bardzo dużym interfejsem
   pośrednim: łączy wrapping, routing, growth, tabele, graphics, cytaty,
   iteracje i trace. Trzeba go rozciąć na wewnętrzne seams, nie powielając
   decyzji w callerach.

Sol wskazał również, czego nie robić:

- nie wracać do współrzędnych i retry starego `Cursor`;
- nie utrzymywać produkcyjnego translatora starego `ReportData`;
- nie wprowadzać `kind: quote` jako specjalnego modelu soft insertion;
- nie oddawać decyzji layoutowych rendererowi;
- nie rozwijać soft placement przed ustabilizowaniem kanonicznego kontraktu.

## Zakres 1.0

### P0 — kanoniczny kontrakt

Ustalić i opublikować jeden kontrakt `CompositionInput`.

Kanoniczna forma ma zawierać named flows:

```json
{
  "flows": {
    "main": {
      "continuation": "allowed",
      "blocks": [
        { "type": "heading", "text": "..." },
        { "type": "text", "text": "..." },
        { "type": "metric", "label": "...", "value": 12 },
        { "type": "chart", "chart_type": "bar", "data": [] },
        { "type": "image", "asset_id": "..." },
        { "type": "table", "head": [], "body": [] }
      ]
    }
  }
}
```

Lista typów musi być jawna. Obecne `list-item` należy świadomie utrzymać jako
semantyczny wariant bloku tekstowego albo usunąć/przenieść do modelu listy.
Nie może pozostać przypadkowym dodatkowym typem.

Usunąć przed 1.0:

- top-level legacy `sections`, `kpis`, `charts`, `table`, `highlights`;
- aliasy `main`, `header`, `footer` poza `flows`, jeśli nie są niezbędne dla
  ostatecznego authoring contract;
- testowy translator legacy z publicznej ścieżki;
- nieudokumentowane pola, które nie mają odpowiednika w modelu flow.

Pozostawić jako osobne, jawne koncepty:

- `blocks` — treść semantyczna;
- `assets` — źródła grafik;
- `glyphs` — dekoracje przypięte do planowanej geometrii, nie treść;
- `template` — wybór geometrii, nie sposób przekazania artykułu.

**Kryterium ukończenia:** schema, dokumentacja, MCP, CLI i testy używają tego
samego wejścia. Nie istnieje produkcyjna ścieżka z drugim formatem danych.

### P0 — jedna reprezentacja geometrii

Obecnie compiler template’u i `page-template-adapter` mają częściowo nakładające
się odpowiedzialności. Trzeba ustalić jedną granicę:

```text
raw YAML
  → template compiler
  → canonical CompositionTemplate
  → page geometry / layout instances
  → planner
```

Compiler powinien być jedynym miejscem, które:

- waliduje YAML;
- normalizuje jednostki i ramy;
- rozstrzyga layout opening/continuation;
- tworzy regiony, sloty, bands i flow obstacles.

`page-template-adapter` może pozostać adapterem do istniejącego publicznego
modelu, ale nie może po cichu ponownie wymyślać reguł geometrii.

**Kryterium ukończenia:** dla tego samego template’u istnieje jedna struktura
canonical geometry używana przez planner, debug, evaluator i renderer.

### P0 — głęboki planner flow

Zachować publiczny seam planera jako jeden główny moduł:

```ts
planComposition(document, template, capabilities, policy): CompositionPlan
```

Wewnątrz wydzielić prywatne moduły/seams:

- `flow-router` — kolejność flow, route index, przejścia stron i slotów;
- `line-layout` — line height, font bounds, wrapping i przyszłe hyphenation;
- `obstacle-index` — finalne obstacles i zapytania o interwały linii;
- `barrier-segments` — wyliczanie i konsumowanie flow barrier candidates;
- `block-layout` — pomiar i fragmentowanie typów bloków;
- `insertion-planner` — wybór boxów dla elementów poza zwykłym nurtem;
- `plan-trace` — zapis decyzji i wyjaśnień bez wpływania na layout.

Nie chodzi o mechaniczne rozbicie pliku na wiele cienkich funkcji. Każdy moduł
ma dostać mały interfejs i ukryć znaczną część implementacji. Planner główny
pozostaje głębokim modułem dla rendererów i testów.

**Kryterium ukończenia:** dodanie nowego typu mierzonego bloku lub nowego źródła
obstacle nie wymaga edycji wszystkich ścieżek wrappingu i routingu.

### P0 — wspólny model bloków i adapterów

Istniejące capabilities `measureBlock`, `measureTable` i `blockRenderers` są
dobrym seamem. Ustabilizować go jako interfejs adapterów:

```ts
interface CompositionBlockAdapter {
  supports(kind: CompositionBlockKind): boolean;
  measure(input: MeasureBlockInput): BlockMeasure;
  layout(input: LayoutBlockInput): BlockLayout;
  paint(input: PaintBlockInput): void;
}
```

Adaptery dla `text`, `image`, `metric`, `chart` i `table` mają być wymienne.
Planner nie zna szczegółów rysowania KPI, PNG wykresu ani captionu.

Tabela może być fragmentowana na wierszach. Obraz, KPI i wykres powinny być
atomiczne, chyba że konkretny adapter jawnie deklaruje fragmentowanie.

**Kryterium ukończenia:** każdy typ bloku przechodzi tę samą ścieżkę:
`validate → measure → place → evaluate → paint`.

### P0 — twarde obstacles jako stabilny kontrakt

Utworzyć jeden renderer-neutralny model finalnej przeszkody:

```ts
interface FlowObstacle {
  id: string;
  sourceId: string;
  page: number;
  box: CompositionRect;
  shape: ObstacleShape;
  wrap: 'none' | 'around';
  paint: boolean;
}
```

Do tego modelu trafiają:

- declared graphics;
- obrazy inline z `wrap: left/right`;
- fixed insertiony;
- przeszkody wynikające z template’u, jeśli są częścią flow geometry.

`flowBarrierBoxCandidates` pozostają pochodną finalnych obstacles i finalnych
flow placements. Nie mogą być źródłem geometrii ani udawać wybranych pozycji.

**Kryterium ukończenia:** debug i evaluator czytają dokładnie ten sam obstacle
registry co line layout. Nie ma osobnego debugowego przybliżenia.

### P0 — chrome jako jawna geometria

`title`, `header` i `footer` pozostają named flows. To jest właściwy model.

Dodać jednak jawne niekolizyjne boxy dla:

- header lockup;
- header rule;
- footer rule;
- page number.

Page number może pozostać chrome rysowanym po ustaleniu liczby stron. Nie jest
potrzebne sztuczne robienie z niego zwykłego flow. Musi jednak korzystać z
zaplanowanej geometrii i nie może zmieniać dostępności main flow po fakcie.

**Kryterium ukończenia:** wszystkie miejsca zajmujące stronę są widoczne w
planie; renderer nie ma ukrytego paddingu ani implicitnego obszaru kolizji.

### P1 — line breaking

Dodać możliwość dzielenia słów jako capability, nie jako obowiązkowe zachowanie
każdego flow.

Policy powinna rozróżniać:

- `word` — tylko granice słów;
- `hyphenate` — dzielenie słów według języka;
- `character` — awaryjne dzielenie, jeśli brand/template je dopuszcza.

Line breaker musi korzystać z tych samych font metrics co renderer. Powinien
zwracać informację o źródłowym zakresie tekstu, aby evaluator nadal mógł
sprawdzać pełne pokrycie.

**Kryterium ukończenia:** długi wyraz w wąskim interwale nie powoduje
nieuzasadnionego pustego miejsca, ale każde dzielenie pozostaje widoczne w
planie i jest deterministyczne.

### P1 — wzrost i zależności geometryczne

Obecne `grow.pushes` obsługuje podstawowy przypadek. Przed 1.0 trzeba jasno
zdefiniować zależności:

```text
intro measured height → main top
image measured height → following block top
insertion height → obstacle bottom → main continuation
header/footer height → usable flow bounds
```

Planner powinien wykonywać ograniczoną iterację po zależnościach, z:

- limitem z konfiguracji;
- sygnaturą geometrii;
- diagnostyką braku zbieżności;
- fail-closed przy residual content lub hard violation.

Nie budować ogólnego solvera constraintów. Potrzebujemy deterministycznego
grafu zależności kompozycji.

### P1 — generalizacja insertionów

Po ustabilizowaniu P0 obecne quote-only insertiony zastąpić definicją opartą
na bloku lub named flow, nie na `kind: quote`:

```ts
interface InsertionDefinition {
  id: string;
  source: { flowId: string; blockId: string };
  placement: PlacementPreferences;
  collision: CollisionPolicy;
}
```

Cytat będzie zwykłym blokiem tekstowym z rolą i stylem. KPI, metric, chart,
image i table będą mogły korzystać z tego samego mechanizmu, jeśli ich adapter
potrafi zmierzyć zawartość przed wyborem boxa.

Kolejność:

1. zachować obecny fixed-slot rendering jako test referencyjny;
2. wygenerować wielu kandydatów, ale nadal wybrać dotychczasowy kandydat;
3. pokazać kandydatów w debug PDF;
4. włączyć score tylko dla jednego typu insertionu;
5. rozszerzyć na wszystkie kompatybilne typy bloków;
6. usunąć quote-specific planner branches.

**Kryterium ukończenia:** wybrany insertion tworzy finalny obstacle, a main flow
nie musi wiedzieć, czy przeszkodą jest cytat, wykres czy obraz.

### P1 — scoring i debug

Score ma być narzędziem wyboru, nie dekoracją. Wprowadzić rozdział:

- hard violation — kandydat odrzucony;
- soft penalty — kandydat legalny, ale gorszy;
- bonus — legalny układ korzystniejszy wizualnie.

Debug powinien pokazywać:

- preferred position;
- wszystkie rozważone candidates;
- selected candidate;
- rejected candidate i przyczynę;
- final obstacle;
- padding/margin/content/ink box;
- breakdown score.

Etykiety techniczne pozostają poza ramkami. Wszystkie kolory, grubości linii,
insety i rozmiary etykiet nadal pochodzą z `render-config.yml`.

## Test plan

### Kontrakt inputu

- brak `flows` odrzuca input;
- nieznany top-level legacy field odrzuca input;
- każdy canonical block kind ma walidację;
- każdy block kind ma adapter measure/layout/paint;
- glyph jest dekoracją, nie ukrytym blokiem treści.

### Flow

- pełne pokrycie słów od zera do końca;
- monotoniczna kolejność bloków i fragmentów;
- brak pustego placementu między zapełnionymi placementami;
- poprawne przejście kolumna → kolumna i strona → strona;
- poprawne zachowanie `continuation: forbidden`;
- nagłówek z konfigurowanym minimalnym fragmentem tekstu;
- line breaking i opcjonalna hyphenation;
- deterministyczna sygnatura planu.

### Obstacles

- prostokąt zasłaniający część kolumny;
- elipsa/poligon z poprawnymi interwałami linii;
- obraz `wrap: left/right`;
- obstacle full-width rozcinający obie kolumny;
- kilka przeszkód w jednym flow;
- przeszkoda kończąca się pomiędzy nominalnymi liniami;
- tekst przesuwany na górną granicę następnego barrier candidate z uwzględnieniem
  line bounds;
- debug box identyczny z boxem użytym przez evaluator i renderer.

### Structured blocks

- metric jako zwykły blok i jako insertion;
- chart jako zwykły blok i jako insertion;
- image z captionem jako zwykły blok i jako insertion;
- table kontynuowana po granicy wiersza;
- mieszany dokument zawierający text, image, metric, chart i table;
- brak renderer capability powoduje rejection, nie ciche pominięcie.

### Realne artefakty

Każdy release candidate renderować jako:

- zwykły PDF;
- composition-debug PDF;
- JSON planu i trace;
- test selectable text/bbox;
- test z zewnętrznym brand fontem;
- test realnego editorialu z co najmniej jednym obrazem i kilkoma typami bloków.

Testy wymagające child processes uruchamiać poza ograniczonym sandboxem zgodnie
z `AGENTS.md`; `spawnSync ... EPERM` nie jest wynikiem testu produktu.

## Release gates 1.0

Release jest możliwy, gdy:

1. istnieje jeden canonical input contract;
2. nie ma produkcyjnego legacy translatora;
3. planner, evaluator, debug i renderer korzystają z jednej geometrii;
4. każdy wspierany block kind ma adapter i test artefaktowy;
5. wszystkie hard violations kończą plan statusem rejected;
6. nie ma utraty treści, nielegalnego overlapu ani pustych placement gaps;
7. plan jest deterministyczny dla tych samych danych, template’u i fontów;
8. named flows obejmują main, title, header, footer oraz pomocnicze flow;
9. istnieje realny editorial smoke test i ręczny przegląd PDF/debug PDF;
10. dokumentacja normatywna nie przeczy implementacji.

## Plan redukcji dokumentacji

Obecne repozytorium ma około 55 plików Markdown. Nie wszystkie są dokumentacją
produktu. Przed usunięciem trzeba je sklasyfikować, ale docelowo aktywne źródła
prawdy powinny być nieliczne.

### Zachować jako aktywne

- `README.md` — publiczne narzędzia, canonical input, uruchomienie;
- `CONTEXT.md` — glossary i niezmienne pojęcia domenowe;
- `ROADMAP.md` — aktualna kolejność prac i status release;
- `CHANGELOG.md` — publiczna historia zmian;
- `docs/composition-model.md` — normatywny model flow/template/placement/
  obstacle/block/insertion;
- `docs/template-authoring.md` — jak tworzyć szablony i flow;
- `docs/quality/README.md` — release gates i sposób ich uruchomienia;
- `docs/quality/INPUT_ERRORS.md` — kontrakt błędów wejściowych;
- `docs/quality/BASELINE.md` — tylko jeśli baseline nadal jest release gate’em;
- `AGENTS.md` oraz `skills/*/SKILL.md` — instrukcje operacyjne, nie źródło
  prawdy produktu;
- pliki licencyjne.

### Skonsolidować

Wnioski z poniższych dokumentów przepisać do `docs/composition-model.md` lub
`docs/quality/README.md`, a następnie usunąć ich kopie:

- `docs/research/composition-engine-status.md`;
- `docs/research/composition-input-migration.md`;
- `docs/research/composition-planner-seam.md`;
- `docs/research/page-layout-flow-contract.md`;
- `docs/research/content-template-brand-contract.md`;
- `docs/composition-debug-findings.md`;
- `docs/research/soft-insertion-placement-plan.md`;
- `docs/quality/pdf-layout-diff.md`;
- `docs/quality/METRICS.md` i `docs/quality/WORK.md`, jeśli ich gate’y zostaną
  przepisane do jednego dokumentu jakości.

### Usunąć po audycie linków

Research notes i wyniki jednorazowych spike’ów nie powinny pozostać aktywną
specyfikacją. Dotyczy to w szczególności:

- boundary sweep;
- breaking-policy corpus;
- commonmark progress;
- composition kernel prototype cases;
- document layout engine landscape;
- editorial engine/layout/reserved-slot spikes;
- pure layout planner;
- star occlusion corpus;
- historycznych adapter spikes.

Przed usunięciem każdego pliku:

1. wyszukać linki i odwołania w repozytorium;
2. przenieść tylko trwałe decyzje i testable invariants do źródła prawdy;
3. sprawdzić, że skrypty i testy nie używają pliku jako inputu;
4. usunąć plik w osobnym commicie dokumentacyjnym.

Git pozostaje historią zmian. Nie potrzebujemy utrzymywać research diary w
working tree, jeśli wynik został już zapisany jako kontrakt lub test.

### Aktualizacja dokumentacji przy kodzie

Każda zmiana kontraktu musi aktualizować w tym samym commicie:

- schema;
- `docs/composition-model.md`;
- przykład w `README.md`;
- test kontraktowy;
- changelog, jeśli zmiana jest user-visible.

Można dodać prosty check, który odrzuci linki do usuniętych research docs oraz
sprawdzi, że publiczny przykład README przechodzi walidację schema.

## Kolejność realizacji

### Etap 0 — zamrożenie decyzji

- zatwierdzić canonical block vocabulary;
- zatwierdzić usunięcie legacy inputu i aliasów;
- uzgodnić listę active docs;
- zapisać baseline planu i realnego editorialu.

### Etap 1 — kontrakt i geometria

- uporządkować schema;
- usunąć publiczny legacy translator;
- ujednolicić compiler/template adapter;
- dodać canonical geometry assertions.

### Etap 2 — głębienie planera

- wydzielić internal seams bez zmiany zachowania;
- utrzymać istniejące flow barrier tests;
- utrzymać debug PDF jako obserwację tego samego planu.

### Etap 3 — block capabilities

- ujednolicić adaptery measure/layout/paint;
- przeprowadzić każdy block kind przez tę samą ścieżkę;
- dopisać mixed-content artifact tests.

### Etap 4 — line breaking i zależności

- dodać optional word splitting/hyphenation;
- jawnie zapisać graf zależności wzrostu;
- dodać limit iteracji i fail-closed diagnostics.

### Etap 5 — chrome

- planować jawne chrome boxes;
- zachować title/header/footer jako named flows;
- przenieść reguły i page number do jawnych renderer-owned chrome boxes.

### Etap 6 — soft insertions

- najpierw fixed-slot adapter jako kontrola regresji;
- potem candidates i debug;
- następnie scoring i wybór;
- na końcu cytat, graphic, metric, chart i image przez wspólny insertion
  interface.

### Etap 7 — dokumentacja i release

- skonsolidować źródła prawdy;
- usunąć research duplicates;
- uruchomić pełne gates w środowisku z child processes;
- wygenerować i ręcznie obejrzeć realne PDF-y;
- wydać 1.0 z changelogiem breaking changes.

## Definicja sukcesu

Release 1.0 jest osiągnięty, gdy autor może opisać artykuł jako named flows z
semantycznymi blokami, wybrać template geometrii i otrzymać deterministyczny
plan bez znajomości cursorów, slotów quote ani współrzędnych PDF.

Nowy typ treści powinien wymagać przede wszystkim nowego adaptera pomiaru i
renderowania. Nie powinien wymagać tworzenia nowej ścieżki przepływu tekstu,
nowego typu przeszkody ani kolejnego wyjątku w plannerze.

To jest właściwa granica maintainability: mały, głęboki interface planera,
wyspecjalizowane adaptery bloków i jedna canonical reprezentacja geometrii.
