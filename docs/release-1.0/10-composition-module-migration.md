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
│   └── planner-policy.ts
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
│   ├── insertion-layout.ts
│   ├── flow-planner.ts
│   ├── flow-text-decision.ts
│   ├── document-layout.ts
│   ├── text-planner.ts
│   ├── planner-candidates.ts
│   ├── graphic-planning.ts
│   └── structured-block-placement.ts
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

`engine.ts` jest obecnie połączeniem kontraktów i implementacji. Najpierw
wydzielamy z niego typy do `contracts/engine-contracts.ts`, a dopiero potem
przenosimy implementację do `composition-engine.ts`.

### `geometry/`

Tylko czyste obliczenia przestrzenne i wizualne. Funkcje nie mutują planu,
strony ani slotów.

- `rectangles.ts` — `rectBottom`, przecięcia, nakładanie, containment;
- `visual-geometry.ts` — geometria obrazu i grafiki (`graphic-geometry` oraz
  `image-geometry`);
- `glyph-geometry.ts` — boxy próbkowania i końcowe boxy glifów
  (`glyph-sampling` oraz `glyph-objects`).

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

`js-pdf-adapter.ts` jest obecnie największym workiem. Dzielimy go według
capability backendu na `pdf/backend`, `pdf/text`, `pdf/image`, `pdf/metric`,
`pdf/chart` i `pdf/table`. Każdy adapter implementuje istniejący kontrakt;
planner nie importuje jsPDF.

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

Po każdym etapie `npx tsc --noEmit` i `node server/scripts/architecture-check.mjs`
przechodziły pomyślnie. Suite `test:composition` przeszedł kontrakty engine,
input, template, planner, adaptery i composition adapter; zatrzymał się dopiero
na oracle PDF przez sandboxowe `spawnSync pdftotext EPERM`. Ten przypadek wymaga
ponowienia na hoście/CI z możliwością uruchamiania procesów potomnych.

## Pierwszy zakres implementacyjny

Pierwszy commit po tym planie obejmuje wyłącznie utworzenie katalogu
`contracts/`, przeniesienie `flow-planning-types.ts` i aktualizację importów.
Następny commit obejmie czystą geometrię i tokenizację. Nie przenosimy
jednocześnie adaptera PDF ani całego evaluatora, ponieważ utrudniłoby to
wykrycie zmiany zależności.
