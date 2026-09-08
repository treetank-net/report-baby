# Plan 10 — kategorie i migracja modułów composition

Status: przyjęty kierunek, migracja rozpoczęta po zatwierdzeniu planu

## Cel

Uporządkować `server/src/composition` według odpowiedzialności i kierunku
zależności, bez wprowadzania nowych encji domenowych i bez zmiany zachowania
planera. Katalog `runtime/` nie jest tworzony: publiczny runtime pozostaje
bezpośrednio w `composition/`.

Migracja ma łączyć funkcje, które posiadają tę samą wiedzę domenową, nawet gdy
obecnie znajdują się w kilku plikach i są wywoływane z różnych miejsc. Nie
dzielimy plików wyłącznie według liczby linii i nie tworzymy modułów
`helpers`, `utils` ani `types` jako worków bez właściciela.

## Docelowa mapa katalogów

```text
server/src/composition/
├── contracts/
│   ├── model.ts
│   ├── engine-contracts.ts
│   ├── flow-planning.ts
│   ├── planner-policy.ts
│   └── pdf.ts
├── geometry/
│   ├── rectangles.ts
│   ├── visual-geometry.ts
│   └── glyph-geometry.ts
├── text/
│   ├── tokenization.ts
│   ├── text-layout.ts
│   └── style-name.ts
├── layout/
│   ├── page-state.ts
│   ├── flow-space.ts
│   ├── plan-lines.ts
│   ├── insertion-layout.ts
│   ├── flow-planner.ts
│   ├── flow-text-decision.ts
│   ├── document-layout.ts
│   ├── text-planner.ts
│   ├── planner-candidates.ts
│   ├── graphic-planning.ts
│   ├── structured-block-placement.ts
│   └── glyph-objects.ts
├── evaluation/
│   ├── evaluator.ts
│   ├── content.ts
│   ├── legality.ts
│   ├── scoring.ts
│   ├── diagnostics.ts
│   ├── plan-queries.ts
│   └── contrast.ts
├── observability/
│   └── planning-observability.ts
├── adapters/
│   ├── input.ts
│   ├── page-template.ts
│   ├── render-config.ts
│   ├── text-engine.ts
│   └── pdf/
│       ├── backend.ts
│       ├── text.ts
│       ├── image.ts
│       ├── metric.ts
│       ├── chart.ts
│       └── table.ts
├── composition-engine.ts
├── report-composition-entrypoint.ts
└── index.ts
```

Wewnątrz katalogów nie dodajemy `index.ts`. Bezpośrednie importy mają ujawniać
rzeczywistą zależność. Istniejący `composition/index.ts` pozostaje jedyną
publiczną fasadą, jeśli wymagają tego konsumenci pakietu.

## Właściciele odpowiedzialności

### `contracts/`

Wyłącznie deklaracje typów i interfejsów. Nie może importować runtime, adapterów
ani evaluatora.

- `model.ts` — bloki, strony, sloty, layouty, plan i placementy;
- `engine-contracts.ts` — interfejsy silnika, evaluatora, planera i backendu;
- `flow-planning.ts` — `FlowPlanningContext`, `FlowRuntime`, `FlowTarget` oraz
  powiązane rekordy stanu przebiegu;
- `planner-policy.ts` — typy i polityka wejściowa planera.
- `pdf.ts` — kontrakty stylów, assetów, rendererów i capability adaptera PDF;
  implementacja jsPDF nie może być właścicielem tych typów.

`engine.ts` jest cienką ścieżką kompatybilności. Kontrakty znajdują się w
`contracts/engine-contracts.ts`, a implementacja w `composition-engine.ts`;
nowe moduły nie powinny importować typów z fasady kompatybilności.

### `geometry/`

Tylko czyste obliczenia przestrzenne i wizualne. Funkcje nie mutują planu,
strony ani slotów.

- `rectangles.ts` — `rectBottom`, przecięcia, nakładanie, containment;
- `visual-geometry.ts` — geometria obrazu i grafiki (`graphic-geometry` oraz
  `image-geometry`);
- `glyph-geometry.ts` — czyste boxy próbkowania glifów (`glyph-sampling`).

Jeżeli funkcja zna `CompositionPlan`, `PageState` albo flow, nie należy do tego
katalogu, nawet jeśli zwraca prostokąt.

### `text/`

Wiedza o tekście: tokenizacja, metryki, wrapping i wyznaczanie placementów.

- `tokenization.ts` — jeden właściciel `wordsOf` i pochodnych tokenów;
- `text-layout.ts` — połączenie `text-measurement`, `text-wrapping`,
  `text-placement` oraz `line-capacity`;
- `style-name.ts` — mapowanie rodzaju bloku na nazwę stylu.

`text-layout.ts` może pozostać większym modułem, ale jego funkcje muszą mieć
pojedynczą odpowiedzialność: pomiar, wrapping, capacity albo materializacja.

### `layout/`

Stan i reguły układania dokumentu.

- `page-state.ts` — połączenie `page-management`, `route-slots`,
  `flow-cursor` i `slot-growth`;
- `flow-space.ts` — połączenie `flow-occupancy` i `flow-barriers`;
- `insertion-layout.ts` — połączenie `insertion-planning` i `insertion-order`;
- `flow-planner.ts` — orkiestracja jednego flow;
- `flow-text-decision.ts` — reguły decyzji dla tekstu;
- `document-layout.ts` — pełny cykl planowania dokumentu;
- `text-planner.ts` — publiczna orkiestracja kandydatów i wyboru planu;
- `planner-candidates.ts` — tworzenie i doprecyzowanie wariantów;
- `graphic-planning.ts` — planowanie grafik;
- `structured-block-placement.ts` — placement tabel, KPI i innych bloków
  atomowych.
- `glyph-objects.ts` — materializacja authored/generated glyph placements;
  pozostaje w layout, bo zna `CompositionPlan` i mutuje jego wynik.

Nie łączymy całych `flow-planner.ts` i `flow-text-decision.ts`: pierwszy
koordynuje przebieg, drugi implementuje politykę decyzji. Nie łączymy też
`document-layout.ts` z `text-planner.ts`, bo odtworzyłoby to poprzedni god
moduł.

### `evaluation/`

Evaluator pozostaje tylko do odczytu planu.

- `content.ts` — kompletność i ciągłość treści;
- `legality.ts` — twarde wymagania i legalność;
- `scoring.ts` — jakość legalnego planu;
- `contrast.ts` — pomiar kontrastu i raster sampling;
- `diagnostics.ts` — konstrukcja diagnostyk;
- `plan-queries.ts` — nazwane zapytania do artefaktu planu;
- `evaluator.ts` — orkiestracja.

`evaluation-support.ts` nie jest docelowym modułem. Każda funkcja z tego pliku
trafia do właściwego właściciela, zamiast do nowego worka pomocniczego.

### `observability/`

`planning-records` i `planning-trace` tworzą jeden moduł obserwowalności. Zapis
decyzji odbywa się przez `recordFlowDecision`; wywołujący przekazuje istniejący
kontekst, a nie syntetyczny obiekt decyzji.

### `adapters/`

Adaptery tłumaczą zewnętrzne dane na kontrakty composition i nie zawierają reguł
wyboru layoutu.

Implementacja adaptera PDF była największym workiem. Dzielimy ją według
capability backendu na `pdf/backend`, `pdf/text`, `pdf/image`, `pdf/metric`,
`pdf/chart` i `pdf/table`. Każdy adapter implementuje istniejący kontrakt;
planner nie importuje jsPDF.

Kontrakt tych capability znajduje się w `contracts/pdf.ts`. Implementacja jest
rozdzielona na moduły capability; funkcja składania capability pozostaje w
`adapters/pdf/backend.ts`, ponieważ jest częścią orkiestracji backendu, a nie
kontraktem typu.

### Runtime w `composition/`

`composition-engine.ts` i `report-composition-entrypoint.ts` pozostają
bezpośrednio w katalogu `composition/`. Są punktami składania systemu, a nie
osobną domeną katalogową. `index.ts` eksportuje tylko publiczny kontrakt.

## Reguły zależności

```text
contracts
   ↓
geometry / text
   ↓
layout
   ↓
evaluation / observability
   ↓
composition-engine
   ↑
adapters
```

- kontrakty nie zależą od implementacji;
- geometria i tokenizacja są czyste;
- layout może mutować stan planowania;
- evaluator czyta plan, ale go nie zmienia;
- obserwowalność zapisuje decyzje i diagnostykę przez jawny seam;
- adaptery zależą do środka, nigdy odwrotnie;
- importy są bezpośrednie, bez wewnętrznych barrel exporterów.

## Kolejność migracji

### Etap 0 — zabezpieczenie

1. Zachować bieżący commit jako punkt odniesienia.
2. Wygenerować inventory importów i publicznych eksportów.
3. Uruchomić testy composition przed pierwszym ruchem.

### Etap 1 — kontrakty

1. Utworzyć `contracts/`.
2. Przenieść typy z `flow-planning-types.ts` do `contracts/flow-planning.ts`.
3. Oddzielić typy z `engine.ts` od implementacji.
4. Zaktualizować importy bez zmiany nazw publicznych.

### Etap 2 — czyste obliczenia

1. Ujednolicić `wordsOf` w `text/tokenization.ts`.
2. Przenieść wspólną geometrię prostokątów do `geometry/rectangles.ts`.
3. Połączyć geometrię wizualną i glifów.
4. Uruchomić testy po każdym logicznym seamie.

### Etap 3 — text i layout

1. Połączyć moduły tekstowe w `text/text-layout.ts`.
2. Połączyć stan strony w `layout/page-state.ts`.
3. Połączyć zajętość i bariery w `layout/flow-space.ts`.
4. Połączyć insertion planning i ordering w `layout/insertion-layout.ts`.
5. Dopiero potem przenosić funkcje pozostające w `flow-planner.ts`.

### Etap 4 — evaluator i obserwowalność

1. Usunąć `evaluation-support.ts` przez rozdzielenie jego funkcji.
2. Przenieść trace i records do `observability/`.
3. Utrzymać evaluator jako read-only wobec planu.

### Etap 5 — adaptery i runtime

1. Rozdzielić `js-pdf-adapter.ts` według capability.
2. Wydzielić kontrakt i implementację z `engine.ts`.
3. Przenieść adaptery do `adapters/`, a runtime bezpośrednio do
   `composition/`.

## Kryteria każdego kroku

- brak zmiany publicznego zachowania planera;
- brak nowych encji domenowych;
- brak importu z adaptera do czystej geometrii lub kontraktu;
- brak duplikatu `wordsOf` i podstawowych operacji geometrycznych;
- brak obiektów decyzji konstruowanych w wywołujących funkcjach;
- przechodzą testy TypeScript, testy composition i test architektury;
- zmiana jest osobnym, małym commitem możliwym do odtworzenia.

## Zrealizowane etapy

- `bf7a31c` — zapisanie tego planu i korekta: runtime pozostaje bezpośrednio w
  `composition/`;
- `33ba4f9` — przeniesienie `flow-planning-types.ts` do
  `contracts/flow-planning.ts`;
- `73019a0` — przeniesienie obecnych modułów evaluatora do `evaluation/`;
- `74671e7` i `ca753e0` — przeniesienie modułów tekstowych do `text/`,
  utworzenie wspólnej tokenizacji, połączenie geometrii obrazu i grafiki w
  `geometry/visual-geometry.ts` oraz usunięcie starych ścieżek;
- `4b4f65d` — przeniesienie modułów stanu stron, flow-space i insertionów do
  `layout/` oraz wydzielenie `contracts/layout-state.ts`.
- `182056a` — połączenie zarządzania stroną, route slots, kursora i wzrostu
  slotów w `layout/page-state.ts`.
- `22e4664` — połączenie zajętości flow i barier w `layout/flow-space.ts`.
- `24eb756` — połączenie planowania insertionów i ich kolejności w
  `layout/insertion-layout.ts`.
- `9fa1f70` — rozdzielenie funkcji dawnego worka `evaluation-support.ts` na
  diagnostykę, zapytania planu i geometrię legalności.
- `e3cd97a` — przeniesienie implementacji jsPDF do `adapters/pdf/`.
- `3f0ff4b` — wydzielenie kontraktów adaptera PDF do `contracts/pdf.ts` i
  odpięcie typów od implementacji jsPDF.
- `7b0c43d` — rozcięcie implementacji PDF według capability na `backend.ts`,
  `text.ts`, `image.ts`, `metric.ts`, `chart.ts` i `table.ts`; usunięcie
  monolitycznego `js-pdf-adapter.ts` i aktualizacja importów do konkretnych
  właścicieli.
- `64a65c9` — rozdzielenie kontraktów engine od implementacji: typy trafiły do
  `contracts/engine-contracts.ts`, orkiestracja do `composition-engine.ts`, a
  `engine.ts` został cienką ścieżką kompatybilności.
- `7f29533` — połączenie pomiaru, wrappingu, capacity i materializacji linii w
  `text/text-layout.ts`; `tokenization.ts` i `style-name.ts` pozostały
  niezależnymi, czystymi modułami, a zależności przeszły na jawny typ
  `WrappedLine[]`.
- `ae7df91` — przeniesienie polityki planera i typów ruchomych ramek do
  `contracts/planner-policy.ts`; implementacje kandydatów nie są już
  właścicielem kontraktu polityki.
- `033883c` — ułożenie pozostałych modułów według docelowej domeny: flow,
  document, graphic, structured-block, planner-candidates i text-planner
  trafiły do `layout/`, evaluator otrzymał nazwy `content.ts`, `legality.ts`
  i `scoring.ts`, a records i trace połączono w
  `observability/planning-observability.ts`.
- `ea333ea` — rozdzielenie próbkowania glifów od materializacji obiektów:
  czyste obliczenia trafiły do `geometry/glyph-geometry.ts`, a funkcje
  mutujące plan do `layout/glyph-objects.ts`.
- `67e3e3c` — udokumentowanie właścicieli modułu glifów i reguły, że funkcje
  znające `CompositionPlan` nie trafiają do czystej geometrii.
- `1ab6867` — odświeżenie skryptu inventory tak, aby rekurencyjnie skanował
  aktualne `composition/**/*.ts`, ignorował nieistniejące historyczne cele i
  poprawnie raportował aktualne ścieżki evaluatora.
- `bbcddf8` — adaptery wejścia, geometrii szablonu, konfiguracji renderera
  i składania text engine trafiły do `composition/adapters/`: odpowiednio
  `input.ts`, `page-template.ts`, `render-config.ts` i `text-engine.ts`.
- `adc11c8` — usunięcie starych ścieżek adapterów po przełączeniu wszystkich
  importów; `6116673` — aktualizacja kanonicznej mapy modułów i dokumentacji
  konfiguracji oraz block-kinds.
- Bieżący seam cleanup — wspólna projekcja linii planu trafiła do
  `layout/plan-lines.ts`, odczyt tekstu bloku jest współdzielony przez text i
  observability, `pdfNumber` ma jednego właściciela w adapterze konfiguracji,
  a `insertionKey` jest współdzielony przez planowanie insertionów i kandydatów.
  Decyzje przepływów i faz planera są zapisywane przez
  `recordFlowDecision`/`recordPlanDecision`; funkcje wywołujące nie konstruują
  już obiektów decyzji.

Po każdym etapie `npx tsc --noEmit` i `node server/scripts/architecture-check.mjs`
przechodziły pomyślnie. Pełny suite `npm run test:composition` przeszedł na
hoście wszystkie 13 kontroli, włącznie z oracle PDF, obrazami, kontrastem,
przepływem numerowanym i limitami stron. W sandboxie oracle nadal może kończyć
się `spawnSync pdftotext EPERM`; nie jest to błąd migracji.

## Domknięcie migracji i świadomie pozostawione seamy

Analiza wspólnych obliczeń `flow-planner.ts` i `flow-text-decision.ts` nie
wykazała bezpiecznej funkcji, którą można połączyć bez mieszania stanu kursora,
wyboru slotu i reguł tekstowych. Wspólne operacje są już za seamami
`page-state.ts`, `flow-space.ts`, `text/text-layout.ts` i
`observability/planning-observability.ts`; oba planery pozostają osobnymi
modułami orkiestrującymi.

Kolejka siedmiu funkcji powyżej 80 linii została przejrzana. Każda z nich ma
jedną spójną odpowiedzialność za własnym interfejsem (adapter szablonu,
placement structured block, adapter stylów/PDF albo algorytm wrappingu), więc
nie jest dzielona mechanicznie. Pozostawienie ich jako głębokich modułów jest
celowe; dalszy podział wymagałby nowego wariantu interfejsu lub drugiego
adaptera, którego obecnie nie ma.

Publiczne eksporty nadal przechodzą przez jedyną fasadę `composition/index.ts`.
Po każdym seamie sprawdzamy kompilację, architekturę i suite composition.

Pełny `npm test` uruchomiony po migracji zatrzymuje się poza suite composition
na istniejącym scenariuszu `public MCP behavior` dla
`pages/editorial-metrics-two-column` (`EMPTY_FLOW_SLOT`). Zmiany tej migracji
nie dotykają evaluatora ani logiki przepływu odpowiedzialnej za ten komunikat;
przypadek pozostaje osobnym zadaniem zachowania publicznego.

### Aktualny inventory

`server/scripts/planner-function-dependency-report.mjs` skanuje cały bieżący
podkatalog `composition/`, zbiera sygnatury, wartości zwracane, wywołania
lokalnych funkcji i importy, a następnie pokazuje końcowy fan-out względem
docelowych modułów. Raport jest zapisany w
`planner-function-dependency-inventory.md`; przed kolejnym ruchem należy go
regenerować poleceniem:

```sh
node server/scripts/planner-function-dependency-report.mjs \
  --write-report docs/release-1.0/planner-function-dependency-inventory.md
```

Obecny snapshot obejmuje 406 nazwanych funkcji w 39 plikach. Tabela rozmiarów
jest dolną granicą kodu funkcji, a nie obietnicą redukcji LOC: o przeniesieniu
decyduje wspólna wiedza domenowa i kształt zależności. Fizycznie, razem z
adnotacjami katalogowymi, największe aktualne moduły to
`evaluation/legality.ts` (659 LOC), `adapters/page-template.ts` (634 LOC),
`flow-text-decision.ts` (588 LOC), `text/text-layout.ts` (525 LOC),
`insertion-layout.ts` (455 LOC), `flow-space.ts` (415 LOC) i
`flow-planner.ts` (408 LOC). Dalsza praca ma badać duplikaty obliczeń,
nie ciąć funkcji mechanicznie tylko po to, aby zmniejszyć liczbę linii. Po
usunięciu powtórzonych projekcji i wrapperów inventory wykazuje jedną grupę
potencjalnego duplikatu (dwa typowane wrappery kandydatów), siedem funkcji
powyżej 80 linii oraz zero funkcji bez adnotacji właściciela.
