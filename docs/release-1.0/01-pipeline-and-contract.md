# Plan 01 — pipeline i kontrakt

Status: w większości wykonany; pozostał audyt publicznego kontraktu i legacy
ścieżek

## Uruchamianie testów

W repozytorium istnieje jeden kanoniczny runner testów: `server/scripts/test-harness.mjs`.
Pojedyncze pliki `test-*.mjs` są jego wewnętrznymi przypadkami, a nie osobnymi
komendami produktu ani elementami bundla runtime.

Z katalogu `server/`:

- `npm test` przebudowuje aktualne bundla i uruchamia release gate dla
  composition oraz końcowych artefaktów;
- `npm test -- --suite composition` uruchamia kontrakty planera;
- `npm test -- --suite artifacts` uruchamia testy PDF/PNG/PPTX, chrome,
  editorial i kontrakt brandów;
- `npm test -- --suite quality --no-build` uruchamia rozszerzone kontrole
  utrzymaniowe, poza podstawowym gate’em release;
- `npm run test:editorial-full` uruchamia pełną macierz 506 fixture’ów
  przepływu redakcyjnego; zwykły `test:release` korzysta z szybkiego zestawu
  reprezentatywnego;
- `npm run baseline:verify` pozostaje osobną kontrolą corpus, ponieważ
  porównuje zapisane artefakty i może wymagać świadomej aktualizacji baseline.

Runner buduje bundla przed domyślnym testem, aby testy nie użyły przypadkiem
starego `cli-bundle.cjs` lub `bundle.cjs`. `--no-build` służy tylko do szybkiego
powtarzania wcześniej zbudowanego przebiegu.

## Pomiar czasu suite’ów

Sam komunikat na stdout nie jest wystarczającym pomiarem: znika po zakończeniu
procesu i nie pokazuje, który check opóźnił cały przebieg. Do pełnego pomiaru
służy:

```sh
npm run test:timings -- --no-build
```

Polecenie uruchamia `test-harness.mjs --suite all` i zapisuje raport JSONL do
`server/qa/test-timings.jsonl`. Plik jest artefaktem QA i jest ignorowany przez
Git. Każdy rekord jest dopisywany natychmiast po zdarzeniu, więc przerwany
przebieg nadal zachowuje czasy ukończonych checków:

- `run-start` zawiera suite’y, liczbę unikalnych checków i informację, czy
  wykonano build;
- `check-start` oraz `check-complete` zawierają nazwę, skrypt, suite i
  `elapsedMs`; rekord końcowy ma również status `passed`/`failed`;
- `run-complete` zawiera łączny czas, `suiteTotals` oraz liczby
  `checkCount`/`plannedCheckCount`; gdy przebieg buduje bundla, build jest
  raportowany jako osobny pseudo-suite `build`.

Raport można zapisać poza repozytorium, np.:

```sh
TEST_TIMINGS_PATH=/tmp/report-baby-timings.jsonl npm run test:timings -- --no-build
```

Check współdzielony przez
kilka suite’ów jest wykonywany tylko raz; `suiteTotals.<name>.skippedDuplicateChecks`
opisuje pominięte kopie, aby sum suite’ów nie udawała czasu kolejnych uruchomień.

Wcześniej czas był mierzony tylko doraźnie przez komunikaty harnessu. Ostatnie
zapisane przebiegi dały orientacyjnie: smoke ~2,5 s, szybki editorial ~26,5 s,
limity stron ~23,4 s, a quality ~188,4 s. Są to czasy konkretnego środowiska,
nie kontrakt wydajnościowy; kanonicznym źródłem bieżących danych jest raport
JSONL z `test:timings`.

Snapshot pełnego `all` z 2026-09-09 (bez builda, 39 unikalnych checków) wyglądał
następująco:

| Suite | Czas sumy checków | Checki | Uwagi |
|---|---:|---:|---|
| smoke | 2,1 s | 3 | szybki kontrakt planera |
| composition | 92,9 s | 13 | 3 checki współdzielone ze smoke |
| artifacts | 245,6 s | 9 | wielokrotne renderowanie CLI/PDF/PNG/PPTX |
| quality | 162,9 s | 14 | kontrakty utrzymaniowe i brandowe |
| całość | 503,6 s | 39 | około 8 min 24 s, bez builda |

Największe pojedyncze koszty tego przebiegu to: `brand contract` 128,9 s,
`manifest consumers` 76,0 s, `configuration reach` 51,7 s, `report images`
43,4 s oraz `public MCP behavior` 28,4 s. To są pierwsze kandydaty do audytu
plan-only; sama nazwa checku nie przesądza jeszcze, które jego asercje można
odłączyć od renderowania.

## Wykonane w pierwszym przebiegu

- usunięto drugą ewaluację z `planReportComposition()`;
- wrapper zwraca teraz `result.evaluation` z engine’u;
- test composition potwierdza jedną fazę `evaluation` w wyniku;
- contract test potwierdza jedno wywołanie evaluatora dla jednego planu;
- bundlowanie testów composition używa CommonJS, dzięki czemu testy dochodzą
  do asercji zamiast kończyć się na `Dynamic require of "process"`;
- adapter input ma asercję pełnego mapowania obecnych block kinds.

## Wynik audytu ścieżek publicznych

- Nie znaleziono wewnętrznych importów z `composition/index.ts`; moduł jest
  używany jako publiczny seam bundlowany przez testy i potencjalnych callerów.
  Dlatego nie zawężam eksportów automatycznie — wymaga to osobnej decyzji
  breaking-change opartej na publicznym użyciu.
- Aliasy `main`, `header`, `footer`, `title`, `headerContent` i ich warianty
  są obsługiwane w `compositionInputSchema`, ale nie znaleziono ich użycia w
  wewnętrznym rendererze poza samym parserem. Nie usuwam ich w ciemno: trzeba
  potwierdzić, czy są częścią wspieranego wejścia zewnętrznego, czy tylko
  pozostałością migracji.
- Testowe fixture’y starego kształtu są przepisywane przez testowy helper do
  canonical `flows`; nie są dowodem, że produkcja potrzebuje starego
  `ReportData`.

## Cel

Uczynić jeden przebieg composition wiarygodnym i widocznym:

```text
CompositionInput
  → CompositionDocument
  → template / PageGeometry / CompositionTemplate
  → planner
  → evaluator
  → CompositionPlanResult
  → renderer
```

Wynik planowania ma być jedynym wynikiem używanym do decyzji o renderowaniu.

## Stan obecny

- `createCompositionEngine()` wywołuje planner, a następnie evaluator jeden
  raz: [`composition-engine.ts`](../../server/src/composition/composition-engine.ts).
- `planReportComposition()` zwraca wybraną `result.evaluation` z engine’u i
  nie wywołuje evaluatora ponownie:
  [`report-composition-entrypoint.ts`](../../server/src/composition/report-composition-entrypoint.ts#L57-L93).
- `dry_run` i zwykły render korzystają ze wspólnego przygotowania composition;
  `resolveReportPlanOnly()` pozostaje wyłącznie ścieżką legacy odpowiedzi.
- Rejestrator narzędzi znajduje się w
  [`interfaces/mcp/render-tools.ts`](../../server/src/interfaces/mcp/render-tools.ts).
- `report-composition-entrypoint.ts` nie jest drugim rendererem: jest
  produkcyjnym punktem wejścia, który składa input, metryki jsPDF, policy
  planera i capability renderera.
- Contract test dochodzi do asercji i potwierdza pojedynczą ewaluację planu;
  bundlowanie testów używa CommonJS.

## Kroki

1. W `planReportComposition()` zwrócić `result.evaluation` zamiast wywoływać
   evaluator ponownie.
2. Usunąć niepotrzebny import bezpośredniego evaluatora z tego wrappera.
3. Dodać do contract testu licznik wywołań evaluatora i asercję, że jeden
   konkretny plan jest oceniony raz.
4. Naprawić sposób budowania tymczasowego bundla contract testu. Nie zmieniać
   asercji tylko po to, aby ominąć błąd runtime. **Wykonane:** contract test i
   adapter test używają CommonJS oraz przechodzą do asercji.
5. Opisać, które dane są publicznym `CompositionInput`, a które są
   wewnętrznym etapem przygotowania composition.
6. Sprawdzić pełne mapowanie obecnych block kinds od schema do renderera.
   **Częściowo wykonane:** adapter input ma test wszystkich obecnych rodzajów;
   pozostaje potwierdzenie ich wspólnej ścieżki aż do renderera.
7. Zdecydować na podstawie użycia, które eksporty z `composition/index.ts` są
   publicznym seamem, a które powinny zostać wewnętrzne.
8. Zmapować wszystkie call site’y `report-composition-entrypoint.ts` i
   potwierdzić, że nie ma równoległej implementacji renderera. **Wykonane:**
   usunięto historyczną nazwę `shadow` z API, pliku i testu.
9. Utrzymać zasadę własności konfiguracji: evaluator może czytać tylko
   `composition_score`, planner nie czyta YAML, a adapter przekazuje mu policy
   z właściwego seamu `pdf`. `quality` i visual-QA nie mogą stać się zgodą na
   nielegalny plan.

## Testy i kryteria ukończenia

- contract test przechodzi aż do asercji;
- licznik potwierdza jedno wywołanie evaluatora dla jednego wyniku;
- normalny render nie zmienia zachowania istniejącego corpus;
- `CompositionPlanResult` jest przekazywany do renderera bez ponownego
  rozwiązywania legalności;
- punkt wejścia composition nie ukrywa drugiej ścieżki renderowania;
- konfiguracja nie jest pobierana przez moduł z niewłaściwej grupy ani przez
  rdzeń planera bezpośrednio z YAML;
- nie ma produkcyjnego translatora starego `ReportData` ani `Cursor`;
- nieznany block kind kończy się czytelnym błędem.

## Pozostały zakres po pierwszym przebiegu

- przeprowadzić audyt użycia eksportów `composition/index.ts`;
- zdecydować, które aliasy wejściowe są jeszcze potrzebne i przygotować ich
  usunięcie jako świadomy breaking change, jeżeli nie ma już call site’ów;
- podłączyć `dry_run` do tego samego wyniku planowania — to zależy od planu 05,
  ale jest odnotowanym brakiem tego etapu;
- potwierdzić wspólną ścieżkę block kinds od schema do backendu, nie tylko
  normalizację do `CompositionDocument`.
- potwierdzić w kolejnym audycie, że kanoniczny punkt wejścia pozostaje jedynym
  publicznym wejściem do planowania raportu;
- rozstrzygnąć, czy `composition_search` jest konfiguracją runtime planera,
  czy tylko konfiguracją testów i eksperymentów.
- Dodać do testów kontraktu przypadki regresyjne z visual QA jako opisane
  wejścia composition, a nie tylko jako snapshoty PDF-a. Szczególnie trzeba
  zachować sprawdzenie pełnego mapowania tekstu, tabeli, listy i glyphów.

## Wymaga uzupełnienia po wykonaniu punktu X

- Ostateczna lista publicznych eksportów wymaga uzupełnienia po punkcie 7,
  gdy znamy faktyczne call site’y i testy integracyjne.
- Dokładny kontrakt `dry_run` wymaga uzupełnienia po wykonaniu planu 05, bo
  dopiero wtedy będzie wiadomo, które pola planu mają być ujawnione.

## Poza zakresem

Nie przywracamy starego inputu jako drugiego formatu i nie tworzymy nowej
warstwy danych tylko po to, by opakować obecny `CompositionPlan`.
