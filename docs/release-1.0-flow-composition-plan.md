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

1. W pipeline istnieje kilka reprezentacji geometrii, ale nie wszystkie są
   problemem. Prawidłowe są osobne etapy:

   ```text
   raw YAML
     → CompiledCompositionTemplate  (legalne warianty, sloty, routes, chrome)
     → PageLayoutInstance[]          (fizyczne instancje konkretnych stron)
     → CompositionPlan               (wybrane placementy i finalne obstacles)
   ```

   Problemem jest częściowe powielanie odpowiedzialności między compilerem,
   `page-geometry.ts` i `page-template-adapter.ts`: reguła może zostać
   znormalizowana w jednym miejscu, a następnie zinterpretowana ponownie w
   innym. Dodatkowo `report-renderer.ts` tworzy później
   `ResolvedReportPlan`, który może wyglądać jak drugi plan layoutu. Przed 1.0
   trzeba zachować różne typy dla różnych etapów, ale wyznaczyć jednego
   writera każdego kanonicznego artefaktu i jedną jawną proweniencję między
   etapami.
2. `text-planner.ts` jest zbyt płytkim modułem z bardzo dużym interfejsem
   pośrednim: łączy wrapping, routing, growth, tabele, graphics, cytaty,
   iteracje i trace. Trzeba wydzielić internal seams oraz jednego `PlanBuilder`
   jako writera planu, bez mechanicznego rozcinania pliku i bez powielania
   decyzji w callerach.

Sol wskazał również, czego nie robić:

- nie wracać do współrzędnych i retry starego `Cursor`;
- nie utrzymywać produkcyjnego translatora starego `ReportData`;
- nie wprowadzać `kind: quote` jako specjalnego modelu soft insertion;
- nie oddawać decyzji layoutowych rendererowi;
- nie rozwijać soft placement przed ustabilizowaniem kanonicznego kontraktu.

### Druga konsultacja: obserwowalność i rzeczywisty przebieg pipeline’u

To, że kod działa, nie oznacza jeszcze, że jego architektura jest dostępna dla
człowieka utrzymującego projekt. Obecnie znalezienie planera wymaga przejścia
przez kilka plików, a nazwa `report-shadow.ts` sugeruje prototyp, mimo że jest
to produkcyjny adapter ścieżki raportowej. Ten brak discoverability jest
aktywnym problemem release 1.0, nie kwestią kosmetyczną.

Rzeczywisty przebieg jest obecnie następujący:

```text
renderReportPdfDetailed()
  → renderReportCompositionPdf()
    → planReportComposition()                 report-shadow.ts
      → compositionDocumentFromInput()        model/input adapter
      → compositionTemplateFromPageGeometry() page-template-adapter.ts
      → createJsPdfTextMetrics()              jsPDF measurement adapter
      → createTextCompositionEngine().plan()  text-engine.ts
        → planner.plan()                      engine.ts seam
          → createTextCompositionPlanner()    text-planner.ts
            → planDocumentOnce()
              → reserve obstacles
              → place insertions
              → plan ordinary flows
              → register placements/barriers/glyphs
            → optional insertion-proposal reflow
        → evaluator.evaluate()                engine.ts seam
          → evaluateCompositionPlan()         evaluator.ts
    → renderComposition()                     engine.ts
      → jsPDF backend                         js-pdf-adapter.ts
```

Istotne rozróżnienie, które musi być jawnie opisane w dokumentacji:

- pętla w `createTextCompositionPlanner()` nie jest pętlą
  planner–evaluator–optimizer; powtarza planowanie, aby ustabilizować
  propozycje insertionów i ich sygnaturę;
- `createCompositionEngine()` uruchamia ewaluatora po zakończeniu planowania;
- `planReportComposition()` obecnie wywołuje `evaluateCompositionPlan()` raz
  jeszcze po wyniku engine’u. To jest zbędna podwójna ewaluacja i powinno
  zostać usunięte przez przekazanie istniejącego `result.evaluation`;
- wynik ewaluatora nie wraca obecnie do wyboru kandydata ani do optymalizacji
  score. To będzie osobny etap po ustabilizowaniu kontraktu, trace i geometrii.

Brakującym elementem jest jeden krótki dokument źródła prawdy z mapą kodu,
call graphem i definicją terminów `flow`, `placement`, `obstacle`, `barrier`,
`candidate`, `planner`, `evaluator`, `backend` oraz `trace`. Bez niego nowy
autor może pomylić:

- `flowPlacements` — faktyczne przypisania treści do nurtu;
- `flowBarrierBoxCandidates` — możliwe segmenty nurtu wynikające z kolizji;
- `graphicPlacements` — finalnie wybrane grafiki i przeszkody;
- insertion proposals — propozycje pozycji wtrąceń przed kolejnym przebiegiem;
- evaluator diagnostics — raport położenia, a nie mechanizm wyboru pozycji.

Mapa obecnego kodu, potrzebna do audytu przed refaktoryzacją (nie jest jeszcze
docelowym podziałem odpowiedzialności):

| Odpowiedzialność | Moduł |
| --- | --- |
| canonical blocks, flows, slots, placements | `server/src/composition/model.ts` |
| walidacja i normalizacja template’u | `server/src/template-contract.ts` |
| fizyczne instancje stron i przeszkód | `server/src/page-geometry.ts` |
| przejściowe mapowanie do template’u planera | `server/src/composition/page-template-adapter.ts` |
| publiczny seam planner → evaluator | `server/src/composition/engine.ts` |
| konfiguracja metryk i złożenie text engine’u | `server/src/composition/text-engine.ts` |
| planowanie bloków, flow i reflow | `server/src/composition/text-planner.ts` |
| niezależne sprawdzanie planu | `server/src/composition/evaluator.ts` |
| adapter raportu do composition pipeline’u | `server/src/composition/report-shadow.ts` |
| orkiestracja PDF i backend jsPDF | `server/src/report-renderer.ts`, `server/src/composition/js-pdf-adapter.ts` |

Druga konsultacja wykazała jeszcze trzy konkretne braki:

- istnieją dwa typy nazwane `PageGeometry`: jeden w kontrakcie kompilowanego
  template’u, z częściowo znormalizowanymi ramami, oraz drugi w
  `page-geometry.ts`, z fizycznymi instancjami stron; to utrudnia ocenę, czy
  patrzymy na dane wejściowe, czy na geometrię po odjęciu przeszkód;
- renderer nadal równolegle korzysta z `PageGeometry` do chrome, footerów i
  fallbacków, podczas gdy planner dostaje `CompositionTemplate`; każda taka
  równoległa ścieżka może rozjechać debug, evaluator i faktyczny render;
- `dry_run` korzysta z `resolveReportPlanOnly()` i nie przechodzi przez
  produkcyjny planner/evaluator, a odpowiedź może eksponować stary
  `reportPlan` obok `compositionPlan`. To łamie zasadę, że planowanie i
  renderowanie są tym samym pipeline’em.

Evaluator wymaga też niezależniejszego wejścia. Dziś przyjmuje
`(document, plan)` i weryfikuje sloty z samego planu. Docelowo powinien dostać
`(document, compiledTemplate, pageInstances, plan)`, aby móc sprawdzić, czy
placement lub slot nie został sztucznie powiększony przez wcześniejszy etap.
W przeciwnym razie część geometrii jest zaufanym wynikiem planera, a nie
niezależnym warunkiem poprawności.

Nie wolno rozwiązać tego przez samą zmianę nazw. Potrzebne są: jeden opisany
publiczny seam pipeline’u, małe interfejsy modułów wewnętrznych, trace faz oraz
testy sprawdzające, że każdy etap korzysta z właściwej reprezentacji.

Konkretny audyt stanu obecnego wskazuje ponadto, że:

- `CompositionTemplate` przechowuje `maxPages`, choć jest to policy planera,
  a nie fakt geometrii;
- `page-geometry.ts` nie tylko materializuje jednostki, ale przesuwa
  `blockFrames` względem bands i wcześniejszych ramek, więc faktycznie posiada
  regułę rozmieszczania;
- `page-template-adapter.ts` podejmuje decyzje o kolejności slotów,
  quote-specific routingu, rozcinaniu segmentów, `pushes`, fallbackach i
  powtarzaniu headera, więc nie jest obecnie mechanicznym adapterem;
- obstacles są kodowane jako `graphicPlacements`, zamiast mieć osobny
  renderer-neutral `FlowObstacle[]` i jednego writera registry;
- `composition/index.ts` eksportuje wiele internal seams, co pozwala callerom
  omijać właściwy pipeline;
- block kinds są zadeklarowane osobno w schema i modelu, a ręczne mapowanie w
  `input.ts` nie ma jeszcze wyczerpującego gate’u;
- renderer ma własne fallbacki geometrii chrome, a `ResolvedReportPlan` i
  `dry_run` tworzą konkurencyjną ścieżkę względem composition planu.

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
  → CompiledCompositionTemplate
  → PageLayoutInstance[]
  → planner
```

Compiler powinien być jedynym miejscem, które:

- waliduje YAML;
- normalizuje jednostki i ramy;
- rozstrzyga layout opening/continuation;
- tworzy regiony, sloty, bands i flow obstacles.

`page-template-adapter` może pozostać przejściowym adapterem do istniejącego
publicznego modelu, ale nie może po cichu ponownie wymyślać reguł geometrii.
Docelowo jego odpowiedzialność należy ograniczyć do mechanicznego mapowania
albo zastąpić go `composition/template-compiler.ts`, który zwraca bezpośrednio
planner-facing `CompositionTemplate`.

`PageGeometry` z `template-contract.ts` i `PageGeometry` z
`page-geometry.ts` należy rozdzielić nazwami (np. `CompiledTemplateGeometry`
i `PageLayoutGeometry`) albo usunąć dublujący typ. Musi być jasne, gdzie
kończą się ramy znormalizowane, gdzie zaczynają fizyczne ramy strony i gdzie
powstaje finalna geometria planera. `maxPages` pozostaje policy planera, nie
częścią geometrii template’u.

Usunąć równoległe źródła planu: `dry_run` musi wywoływać ten sam planner i
evaluator co render, a raportowa diagnostyka może być widokiem
`CompositionPlan`, nie drugim layout engine’em. Jeśli `ResolvedReportPlan`
zostanie tymczasowo zachowany, powinien być jawnie oznaczonym read-only
adapterem bez własnych reguł rozmieszczania.

**Kryterium ukończenia:** dla tego samego template’u istnieje jeden
`CompiledCompositionTemplate` i jedna lista `PageLayoutInstance[]`; planner,
debug, evaluator i renderer odwołują się do tych samych instancji, a żaden z
nich nie rekonstruuje geometrii niezależnie.

### P0 — jakość kodu i discoverability pipeline’u

Przed dalszym rozszerzaniem planera trzeba sprawić, aby osoba znająca tylko
model flow mogła szybko odpowiedzieć na pytania: gdzie jest planner, gdzie jest
evaluator, kto tworzy geometrię, kiedy powstają obstacles i gdzie kończy się
planowanie, a zaczyna renderowanie.

Wprowadzić:

- `docs/composition-model.md` jako normatywne źródło prawdy dla terminów,
  lifecycle’u i mapy modułów; obecne research notes mają zostać materiałem do
  audytu, a nie równoległą dokumentacją kontraktu;
- jeden nazwany publiczny seam dla raportowego pipeline’u, zamiast eksponowania
  prototypowo brzmiącego `planReportCompositionShadow`;
- JSDoc przy seamach `createCompositionEngine`,
  `createTextCompositionEngine`, `evaluateCompositionPlan`,
  `compositionTemplateFromPageGeometry`, `planReportComposition` i
  `renderComposition`, z informacją o wejściu, wyjściu i fazie pipeline’u;
- jawny typ wyniku pipeline’u zawierający co najmniej `plan`, `evaluation` i
  `trace`, aby caller nie musiał zgadywać, które dane są diagnostyką, a które
  wykonywalnym planem;
- jednoznaczne nazwy dla modułu raportowego: albo zmiana
  `report-shadow.ts` na produkcyjną nazwę, albo wyraźne udokumentowanie, że
  „shadow” jest historycznym aliasem, nie alternatywnym rendererem;
- trace faz planowania: preflight, materializacja grafik, rezerwacja
  obstacles, insertion placement, ordinary-flow placement, flattening,
  barriers/glyphs i evaluation;
- test architektoniczny, że planner nie importuje backendu PDF, renderer nie
  podejmuje decyzji o kolejności flow, a `ResolvedReportPlan` nie uruchamia
  drugiego layout engine’u;
- test z podmienionym ewaluatorem, który dowodzi, że dla jednego wyniku engine’u
  ewaluacja jest wykonana dokładnie raz. Obecne ponowne wywołanie w
  `planReportComposition()` usunąć.

Rozdzielić również testy według seamów:

- model i schema — czy input jest kanoniczny;
- adapter template’u — czy z `CompiledTemplate` i `PageGeometry` powstaje
  właściwy `CompositionTemplate`;
- planner — czy powstają placementy, fragmenty, obstacles i barriers;
- evaluator — czy wykrywa naruszenia planu bez zmieniania planu;
- backend — czy wiernie rysuje zaakceptowany plan;
- pipeline integration — czy fazy są wywołane w prawidłowej kolejności.

#### Mapa odpowiedzialności, a nie mapa plików

Single source of truth nie oznacza jednego ogromnego modułu. Oznacza jednego
właściciela każdej decyzji oraz jednokierunkowe reprezentacje pochodne. Tabela
jest docelowym kontraktem architektonicznym; ścieżki plików opisują stan obecny
i mogą się zmienić podczas refaktoryzacji.

| Decyzja | Jeden właściciel w 1.0 | Pochodny wynik | Czego nie wolno robić poza właścicielem |
| --- | --- | --- | --- |
| Publiczny kształt `CompositionInput` i polityka aliasów | docelowo `contract/composition-input.ts` jako executable contract, przejściowo `contract/schema.ts` | zwalidowany input przekazany do adaptera | utrzymywać drugi ręczny schema albo rekonstruować treść w rendererze |
| Znormalizowany `CompositionDocument`, named flows i vocabulary bloków | `composition/model.ts` + `composition/input.ts` jako jeden domain seam | `CompositionDocument` | pozwalać callerom omijać adapter albo zmieniać znaczenie bloku w rendererze |
| Reguły template’u, sloty, route’y, constraints, chrome i jednostki | docelowo `composition/template-compiler.ts`, przejściowo `template-contract.ts` | immutable `CompiledCompositionTemplate` | wymyślać reguły YAML w rendererze lub plannerze |
| Instancja geometrii na konkretnej stronie | docelowo `composition/page-instantiator.ts`, przejściowo `page-geometry.ts` | immutable `PageLayoutInstance[]` | zmieniać semantykę flow albo ponownie rozstrzygać sloty |
| Mapowanie template → page instances | jeden przejściowy adapter, docelowo mechaniczna materializacja | `PageLayoutInstance[]` | dodawać heurystyki quote/legacy i tworzyć trzecią równoległą geometrię |
| Fonty, line height, ink bounds i pomiary | `js-pdf-adapter.ts` przez `CompositionTextMetrics` | capabilities pomiarowe | mierzyć tekst inaczej w plannerze i backendzie |
| Kolejność flow, wybór slotu i fragmentowanie bloków | głęboki moduł `composition/planner/index.ts` | `CompositionPlan` | przenosić decyzje layoutowe do report renderera |
| Interwały i finalne przeszkody | prywatny `composition/planner/obstacle-index.ts` | frozen `FlowObstacle[]` i zapytania o interwały | kodować obstacle jako `graphicPlacement` albo traktować candidate jako finalny obstacle |
| Faktyczne przypisania treści | plannerowy `PlanBuilder` | `placements`, `lines`, `flowPlacements` | tworzyć placementy dopiero w rendererze albo zapisywać je z kilku miejsc |
| Kandydaci wynikający z kolizji | `obstacle-index` / line-layout jako internal seam | `flowBarrierBoxCandidates` | udawać, że candidate jest wybraną pozycją |
| Niezależna poprawność planu | `composition/evaluator.ts` | `CompositionEvaluation` | ufać slotom zmutowanym w planie; zmieniać plan lub trace podczas oceny |
| Renderowanie zaakceptowanego planu | `composition/renderer.ts` + backend adapter | PDF | ponownie zawijać, przesuwać lub wybierać treść |
| Przebieg faz i wyjaśnienia decyzji | `composition/trace.ts` | append-only `CompositionTrace` | nadpisywać historię wcześniejszego passu lub mieszać trace z layoutem |
| Publiczne ostrzeżenia i błędy | `composition/diagnostics.ts` + evaluator status | diagnostyka zwrócona callerowi | produkować konkurencyjny `reportPlan` poza composition pipeline’em |
| Publiczny interfejs composition | jeden moduł orchestration, eksportowany przez `composition/index.ts` | stabilny wynik pipeline’u | wystawiać każdy internal seam jako równorzędną ścieżkę dla callerów |

W tej tabeli „właściciel” nie oznacza, że moduł musi zawierać całą
implementację. Może mieć prywatne internal seams i adaptery. Oznacza, że tylko
on definiuje regułę, a pozostałe moduły konsumują jego wynik. To jest punkt,
którego brakowało w samej wcześniejszej mapie plików.

Docelowy przepływ artefaktów należy zamrozić jako dwa równoległe, ale
jednokierunkowe łańcuchy:

```text
raw input → CompositionInput → CompositionDocument

raw YAML → CompiledCompositionTemplate → PageLayoutInstance[]
                                               ↓
                         planner → CompositionPlan + FlowObstacle[]
                                               ↓
                                    evaluator (raz)
                                               ↓
                         CompositionResult { document, pages, plan,
                                             evaluation, trace, diagnostics }
                              ↙ dry_run       ↓ render       ↘ debug
```

Obecne `CompositionTemplate` powinno zostać świadomie zmapowane do tego
modelu: albo stanie się nazwą kanonicznego template’u kompilowanego, albo
zostanie wchłonięte przez `CompiledCompositionTemplate`. Nie może pozostać
trzecią, równorzędną geometrią obok `CompiledTemplate` i `PageGeometry`.

`CompositionResult` powinien być jedynym wynikiem publicznego pipeline’u:

```ts
interface CompositionResult {
  document: CompositionDocument;
  pageInstances: readonly PageLayoutInstance[];
  plan: Readonly<CompositionPlan>;
  evaluation: CompositionEvaluation;
  trace: CompositionTrace;
  diagnostics: readonly CompositionDiagnostic[];
}
```

`dry_run`, zwykły render i debug mają konsumować ten sam wynik. Różnią się
wyłącznie końcowym adapterem: odpowiednio serializatorem, backendem PDF lub
debug overlayem.

#### Jak mapa wykrywa rozbieżność

Do każdego wiersza należy dopisać test lub assertion:

- schema mutation test: input spoza canonical contractu odpada przed
  `CompositionDocument`;
- geometry identity test: ten sam template ma zgodną sygnaturę w plannerze,
  debug PDF i backendzie;
- adapter one-way test: zmiana fizycznego layoutu zmienia wynik adaptera, ale
  adapter nie zmienia źródłowego `CompiledTemplate` ani nie tworzy nowych reguł;
- metrics parity test: planowanie i rysowanie używają tych samych fontów,
  line-height i ink bounds;
- planner/evaluator mutation test: sztuczne powiększenie slotu, przesunięcie
  placementu albo usunięcie fragmentu musi zostać wykryte niezależnie od
  trace’u planera;
- backend fidelity test: backend rysuje dokładnie boxy z planu i nie tworzy
  nowych placementów;
- dry-run/render parity test: oba tryby zwracają ten sam `CompositionPlan`
  oraz `CompositionEvaluation` dla tych samych danych, template’u i fontów;
- trace determinism test: powtórzenie planowania daje ten sam trace, a
  kolejne passy nie usuwają historii poprzednich prób;
- architectural import test: moduł nie może importować zależności z warstwy,
  której decyzje ma konsumować, np. planner nie importuje backendu PDF.
- public-export test: `composition/index.ts` eksponuje tylko stabilny seam
  pipeline’u, typy domenowe i jawne adaptery; prywatne etapy planera nie są
  przypadkowo alternatywnym publicznym wejściem.

Jeżeli dwa moduły muszą niezależnie odtworzyć tę samą regułę, mapa ma oznaczyć
to jako naruszenie single source of truth, a nie jako „częściową zgodność”.

**Kryterium ukończenia:** mapa z dokumentu prowadzi do planera i ewaluatora
bez czytania całego repozytorium; test integracyjny pokazuje pełną sekwencję
od `CompositionInput` do backendu; istnieje dokładnie jeden evaluator result
przekazywany dalej; nazwy „shadow”, „legacy” i „prototype” nie opisują
produkcyjnej ścieżki bez wyraźnego komentarza kompatybilności.

### P0 — głęboki planner flow

Zachować publiczny seam planera jako jeden główny moduł:

```ts
compose(document, pageInstances, capabilities, policy): CompositionResult
```

Wewnątrz jednego publicznego seamu pozostaje głęboki planner:

```ts
planComposition(document, pageInstances, capabilities, policy): CompositionPlan
```

Wewnątrz wydzielić prywatne moduły/seams:

- `flow-router` — kolejność flow, route index, przejścia stron i slotów;
- `line-layout` — line height, font bounds, wrapping i przyszłe hyphenation;
- `obstacle-index` — jeden registry finalnych obstacles i zapytania o interwały
  linii;
- `block-layout` — pomiar i fragmentowanie typów bloków;
- `plan-builder` — jedyny writer placementów, linii, residuals i wyników passu;
- `plan-trace` — zapis decyzji i wyjaśnień bez wpływania na layout.

`barrier-segments` pozostaje wewnętrzną częścią `obstacle-index` lub
`line-layout`, dopóki nie będzie miał własnego głębokiego interfejsu.
Quote-specific `insertion-planner` pozostaje P1; w P0 izolujemy istniejącą
ścieżkę, ale nie generalizujemy jej przed ustabilizowaniem podstawowego
pipeline’u. Nie dzielimy mechanicznie dużego pliku na wiele płytkich modułów.

Nie chodzi o mechaniczne rozbicie pliku na wiele cienkich funkcji. Każdy moduł
ma dostać mały interfejs i ukryć znaczną część implementacji. Planner główny
pozostaje głębokim modułem dla rendererów i testów.

**Kryterium ukończenia:** dodanie nowego typu mierzonego bloku lub nowego źródła
obstacle nie wymaga edycji wszystkich ścieżek wrappingu i routingu.

### P0 — wspólny model bloków i adapterów

Istniejące capabilities `measureBlock`, `measureTable` i `blockRenderers` są
dobrym materiałem na seamy, ale pomiar/layout i malowanie nie powinny tworzyć
jednego szerokiego interfejsu. Ustabilizować je jako osobne porty:

```ts
interface CompositionBlockMeasurementAdapter {
  supports(kind: CompositionBlockKind): boolean;
  measure(input: MeasureBlockInput): BlockMeasure;
  layout(input: LayoutBlockInput): BlockLayout;
}

interface CompositionBlockPainter {
  supports(kind: CompositionBlockKind): boolean;
  paint(input: PaintBlockInput): void;
}
```

`measure/layout` i `paint` są osobnymi portami. Jeden adapter jsPDF może
implementować oba, ale planner otrzymuje wyłącznie port pomiaru i layoutu, a
nie painter. Adaptery dla `text`, `image`, `metric`, `chart` i `table` mają być
wymienne. Planner nie zna szczegółów rysowania KPI, PNG wykresu ani captionu.

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
3. planner, evaluator, debug i renderer korzystają z tych samych
   `PageLayoutInstance[]`; żaden nie rekonstruuje geometrii niezależnie;
4. każdy wspierany block kind ma adapter i test artefaktowy;
5. wszystkie hard violations kończą plan statusem rejected;
6. nie ma utraty treści, nielegalnego overlapu ani pustych placement gaps;
7. plan jest deterministyczny dla tych samych danych, template’u i fontów;
8. named flows obejmują main, title, header, footer oraz pomocnicze flow;
9. istnieje realny editorial smoke test i ręczny przegląd PDF/debug PDF;
10. `dry_run` i render używają tego samego planner/evaluator pipeline’u;
11. evaluator może niezależnie porównać plan z canonical template geometry;
12. trace zachowuje identyfikatory passów, reflow i końcowej ewaluacji;
13. każdy kanoniczny artefakt ma jednego writera, a architektura ma test
    single-writer;
14. dokumentacja normatywna nie przeczy implementacji i pozwala znaleźć każdy
    główny seam bez czytania całego repozytorium.

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
- wprowadzić `CompiledCompositionTemplate` i `PageLayoutInstance[]` jako
  jawne artefakty etapów;
- ograniczyć page-template adapter do mapowania, a heurystyki przenieść do
  jednego właściciela albo usunąć;
- dodać canonical geometry provenance i assertions;
- wyprowadzić `maxPages` z template’u do policy planera.

### Etap 2 — głębienie planera

- wydzielić internal seams bez zmiany zachowania;
- wprowadzić `PlanBuilder` jako jedynego writera placementów i linii;
- wprowadzić `ObstacleIndex` oraz `FlowObstacle[]` zamiast używać
  `graphicPlacements` jako ukrytego registry;
- utrzymać istniejące flow barrier tests;
- utrzymać debug PDF jako obserwację tego samego planu.

### Etap 2a — pipeline i discoverability

- usunąć podwójną ewaluację w `planReportComposition()`;
- wprowadzić jeden publiczny seam composition pipeline’u i usunąć produkcyjne
  aliasy `shadow`;
- przenieść `dry_run` na ten sam planner/evaluator co zwykły render;
- przekazywać canonical template do ewaluatora i dodać testy mutacji geometrii;
- rozdzielić porty `measure/layout` od `paint`;
- zamknąć internal seams w `composition/index.ts`, pozostawiając jeden publiczny
  composition pipeline;
- utrwalać trace wszystkich passów, zamiast zastępować wcześniejszy plan
  ostatnim `latestPlan`;
- dodać `docs/composition-model.md`, mapę kodu i test kolejności faz.

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
