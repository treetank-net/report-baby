# Plan release 1.0: stabilny model flow i kompozycji

Status: plan do implementacji

Data: 2026-09-01

## Co chcemy osiągnąć

Release 1.0 ma zakończyć przejście na jeden sposób układania treści:

```text
CompositionInput → flows → planner → placements → renderer
```

Chcemy otrzymać stabilny, zrozumiały i możliwy do utrzymania system, w którym:

- artykuł jest przekazywany jako named flows z uporządkowanymi blocks;
- template opisuje geometrię strony, sloty, trasy i miejsca zarezerwowane;
- planner mierzy treść i wybiera placements przed rysowaniem;
- grafiki i inne elementy zajmujące miejsce są uwzględniane podczas układania
  tekstu;
- evaluator sprawdza gotowy plan przed renderowaniem;
- zwykły PDF, debug PDF i `dry_run` opisują ten sam plan;
- renderer wykonuje plan, ale nie podejmuje po fakcie decyzji o łamaniu tekstu;
- dodanie edytorialu albo pomocniczego artykułu nie wymaga poznawania starego
  renderer’a ani kilku konkurencyjnych formatów danych.

Nie próbujemy odtworzyć starego `Cursor` ani starego płaskiego `ReportData`.
Usunięcie tych ścieżek jest świadomą decyzją. Nie tworzymy też nowego słownika
pojęć tylko po to, aby opisać obecne zachowanie innymi nazwami.

## Słownik i mapa obecnego kodu

To jest mapa orientacyjna. Jej celem jest wskazać, gdzie szukać istniejących
pojęć, a nie ustanawiać nowe encje.

| Pojęcie | Gdzie jest obecnie | Rola |
| --- | --- | --- |
| `CompositionInput` | `server/src/contract/schema.ts` | publiczne dane wejściowe i ich walidacja |
| `CompositionDocument` | `server/src/composition/model.ts`, `composition/input.ts` | znormalizowane flows i blocks używane przez composition |
| template | `server/src/template-contract.ts` | walidacja YAML i opis template’u |
| `PageGeometry` | `server/src/page-geometry.ts` | fizyczna geometria stron, kolumn, bands i przeszkód |
| `CompositionTemplate` | `server/src/composition/model.ts`, `composition/page-template-adapter.ts` | template przekazany obecnie plannerowi |
| planner | `server/src/composition/text-planner.ts` | pomiar, łamanie, routing, placements, obstacles, reflow i trace |
| evaluator | `server/src/composition/evaluator.ts` | sprawdzanie planu i diagnostyka naruszeń |
| engine | `server/src/composition/engine.ts` | połączenie planner → evaluator oraz wejście do renderera |
| raportowa orkiestracja | `server/src/composition/report-shadow.ts` | przygotowanie dokumentu, template’u i metryk dla raportu |
| renderer PDF | `server/src/report-renderer.ts`, `composition/js-pdf-adapter.ts` | rysowanie zaakceptowanego planu i chrome |
| debug | `drawCompositionDebugOverlay()` w `report-renderer.ts` | wizualizacja planu na faktycznym PDF |
| trace | `CompositionPlan.trace` i funkcje trace w plannerze | opis faz i decyzji planera |

## Stan obecny i rzeczy do naprawy

### 1. Trudno znaleźć przebieg programu

Planner, evaluator i renderer są rozdzielone między kilka plików, a
`report-shadow.ts` brzmi jak prototyp mimo tego, że jest używany produkcyjnie.
Nie ma jednego krótkiego opisu mówiącego, co dzieje się po kolei.

### 2. Geometria jest przeliczana w kilku miejscach

Samo istnienie kilku typów nie jest błędem: template, geometria strony i plan
opisują różne etapy. Problemem jest to, że obecnie:

- `template-contract.ts` opisuje i normalizuje geometrię template’u;
- `page-geometry.ts` przelicza ją na stronę i dodatkowo przesuwa `blockFrames`;
- `page-template-adapter.ts` ponownie buduje sloty, trasy, segmenty i część
  reguł insertionów;
- `report-renderer.ts` nadal korzysta z geometrii niezależnie od composition
  planu, szczególnie dla chrome.

Musimy ustalić, która istniejąca reprezentacja jest używana na każdym etapie i
usunąć powtórne interpretowanie tych samych reguł. Nie dodajemy kolejnego typu
geometrii.

### 3. Planner robi zbyt wiele naraz

`text-planner.ts` obejmuje obecnie wrapping, line bounds, routing, growth,
obstacles, insertiony, tabele, grafiki, glyphy, reflow i trace. To utrudnia
zrozumienie kodu i zwiększa ryzyko, że poprawka w jednej regule zmieni inną.

Najpierw musimy opisać obecne funkcje i zabezpieczyć je testami. Dopiero potem
można przenosić istniejącą logikę do mniejszych modułów lub funkcji. Nie
tworzymy przy tym nowych pojęć domenowych ani nie rozcinamy pliku mechanicznie.

### 4. Pętla planowania i ewaluacji jest myląca

Obecny przebieg wygląda tak:

```text
render_report
  → renderReportPdfDetailed()
  → renderReportCompositionPdf()
  → planReportComposition()
  → createTextCompositionEngine().plan()
     → planner
     → evaluator
  → evaluator ponownie w planReportComposition()
  → renderComposition()
  → jsPDF
```

Pętla wewnątrz planera dotyczy stabilizacji propozycji insertionów. Nie jest
jeszcze ogólną pętlą optymalizacji, a evaluator nie wpływa na kolejny przebieg.
Ewaluator jest obecnie wywoływany drugi raz w `planReportComposition()`, a przy
tym dopisuje fazę do `plan.trace`. Należy to uprościć do jednego sprawdzenia
jednego wyniku.

### 5. `dry_run` nie używa tego samego planu

`dry_run` korzysta z `resolveReportPlanOnly()`, czyli ze starszej ścieżki
planowania. To oznacza, że odpowiedź diagnostyczna może opisywać coś innego niż
PDF wygenerowany dla tych samych danych. `reportPlan` i `compositionPlan` nie
powinny być konkurencyjnymi źródłami informacji.

### 6. Evaluator nie ma niezależnego punktu odniesienia

Obecnie evaluator otrzymuje `(document, plan)` i sprawdza sloty zapisane w
planie. Jeżeli wcześniejszy etap zmieni slot, evaluator może uznać placement
za legalny. Należy przekazać mu istniejącą geometrię template’u/strony jako
punkt odniesienia, bez wprowadzania nowej encji.

### 7. Publiczny moduł eksportuje zbyt wiele ścieżek

`composition/index.ts` eksportuje bezpośrednio planner, evaluator, adapter
template’u, metryki i backend. Caller może ominąć główny przebieg, nawet jeśli
nie powinien. Publiczna powierzchnia musi zostać ograniczona do istniejącego
composition engine’u, stabilnych typów oraz jawnie potrzebnych adapterów.

### 8. Część geometrii chrome nadal żyje obok planu

Header, footer, rule, logo i numer strony są rysowane w `report-renderer.ts`,
częściowo z fallbackami. Jeżeli ich wymiary wpływają na dostępny obszar flow,
muszą być widoczne w danych używanych przez plan. Numer strony może pozostać
chrome, ale nie może po fakcie zmieniać układu main flow.

## Cele release 1.0

### Cel A — jeden publiczny kontrakt danych

- utrzymać `CompositionInput` jako jedyny produkcyjny format;
- usunąć aliasy `main`, `header`, `footer`, `title` i pozostałe skróty, jeśli
  nie są częścią ostatecznego kontraktu;
- utrzymać named flows i jawną listę block kinds;
- doprowadzić do tego, aby każdy block kind miał jedno jawne mapowanie do
  `CompositionDocument`;
- nie przywracać produkcyjnego translatora starego `ReportData`.

Gotowe, gdy schema, MCP, CLI, renderer i testy używają tego samego inputu, a
nieznany alias lub typ kończy się czytelnym błędem.

### Cel B — jeden opisany przebieg composition

- udokumentować ścieżkę od `CompositionInput` do PDF;
- usunąć drugą ewaluację;
- sprawić, aby `dry_run`, zwykły render i debug korzystały z tego samego
  planu;
- pozostawić decyzje layoutowe w plannerze, a rysowanie w rendererze;
- nazwać lub opisać `report-shadow.ts` tak, aby nie sugerował drugiego
  renderer’a.

Gotowe, gdy jeden test integracyjny pokazuje kolejność:
`input → document → template/geometry → planner → evaluator → renderer`.

### Cel C — jednoznaczna odpowiedzialność istniejących reprezentacji

- pozostawić istniejące typy, ale opisać ich kolejność i zakres;
- wybrać jedno miejsce dla każdej reguły przeliczania geometrii;
- ograniczyć `page-template-adapter.ts` do mapowania, a nie ukrytych heurystyk;
- usunąć fallbacki geometrii w rendererze, jeśli dany wymiar należy do planu;
- sprawdzać, że debug i evaluator czytają te same dane, które dostaje backend.

Gotowe, gdy zmiana wartości w template’cie przechodzi bez zniekształcenia przez
geometrię, planner, evaluator, debug i PDF.

### Cel D — kod planera możliwy do utrzymania

- zachować działające zachowanie flow barriers, wrappingu, multiline i
  ochrony nagłówka z konfigurowanym minimum tekstu;
- opisać większe fragmenty `text-planner.ts` testami przez istniejący seam;
- wydzielać logikę tylko wtedy, gdy ma jasną odpowiedzialność i mały interfejs;
- nie mieszać pomiaru tekstu z rysowaniem;
- nie wprowadzać nowych encji tylko po to, aby ukryć obecny problem.

Gotowe, gdy nowy block kind można dodać przez istniejące capabilities, bez
edytowania każdej gałęzi routingu i wrappingu.

### Cel E — evaluator jako końcowa kontrola planu

- uruchamiać evaluator dokładnie raz dla wyniku przeznaczonego do renderu;
- nie mutować planu podczas ewaluacji;
- sprawdzać brak utraty contentu, nielegalny overlap, containment, kolejność
  flow i puste placementy pomiędzy zapełnionymi placementami;
- weryfikować plan względem geometrii użytej do planowania, a nie wyłącznie
  względem danych zapisanych w samym planie;
- zachować czytelne statusy accepted, accepted-with-warnings i rejected.

### Cel F — debug i trace jako obserwacja, nie drugi system

- debug PDF ma rysować ramki z tego samego planu co zwykły PDF;
- etykiety techniczne pozostają poza ramkami;
- widoczne są placementy, obstacles, flow barriers oraz padding/margin, jeżeli
  te wartości wpływają na decyzję;
- trace ma pokazywać fazy planowania i przyczyny odrzucenia kandydatów;
- debug nie może rekonstruować geometrii własnymi regułami.

## Kolejność prac

### Krok 0 — zamrożenie zakresu

1. Spisać w `docs/composition-model.md` istniejący słownik: input, flow,
   block, template, geometry, placement, obstacle, flow barrier, planner,
   evaluator, renderer, debug i trace.
2. Oznaczyć w nim, które rozwiązania są świadomym breaking change’em, a które
   są realnym brakiem do 1.0.
3. Nie dodawać nowych encji ani alternatywnego formatu danych.

### Krok 1 — kontrakt i wejście

1. Uporządkować `contract/schema.ts` i `composition/input.ts`.
2. Usunąć niepotrzebne aliasy i top-level legacy fields.
3. Zabezpieczyć pełne mapowanie block kinds testem wyczerpującym.
4. Utrzymać zewnętrzne ładowanie fontów i obecne mierzenie przez jsPDF.

### Krok 2 — geometria i template

1. Opisać dokładnie przejście `CompiledTemplate → PageGeometry →
   CompositionTemplate`.
2. Wskazać, gdzie obecnie reguły są powtarzane, szczególnie przesuwanie
   `blockFrames`, rozcinanie segmentów, insertion slots i chrome.
3. Usunąć powtórne decyzje z adaptera albo przenieść je do istniejącego
   wcześniejszego etapu.
4. Doprowadzić do tego, aby planner, evaluator, debug i renderer korzystały z
   tych samych wyliczonych wartości.
5. Przenieść `maxPages` do istniejącej konfiguracji/policy planera, jeśli nie
   jest częścią geometrii template’u.

### Krok 3 — planner

1. Opisać funkcje i fazy obecnego `text-planner.ts`.
2. Zachować jeden główny seam planowania i istniejące zachowanie.
3. W razie potrzeby wydzielić mniejsze funkcje lub moduły dla routingu,
   wrappingu, obstacles, bloków i trace, ale bez zmiany słownika domenowego.
4. Upewnić się, że `flowPlacements` są faktycznymi placementami, a
   `flowBarrierBoxCandidates` tylko kandydatami wynikającymi z kolizji.
5. Zachować działające grafiki, kształty, wrap, quotes, glyphy i ochronę
   nagłówków.

### Krok 4 — pętla i evaluator

1. Oddzielić w dokumentacji reflow insertionów od ewaluacji gotowego planu.
2. Usunąć drugie wywołanie `evaluateCompositionPlan()`.
3. Przestać mutować `plan.trace` w evaluatorze.
4. Przekazać evaluatorowi istniejący punkt odniesienia geometrii.
5. Dodać test, który wykrywa zmianę slotu lub placementu po planowaniu.

### Krok 5 — render i `dry_run`

1. Przenieść `dry_run` na tę samą ścieżkę planowania i ewaluacji co render.
2. Usunąć `reportPlan` z produkcyjnej odpowiedzi albo pozostawić go wyłącznie
   jako jawny, read-only widok tego samego composition planu.
3. Sprawdzić, że renderer nie zawija ani nie przesuwa treści ponownie.
4. Ujawnić w planie wszystkie wymiary chrome, które ograniczają flow.

### Krok 6 — testy i artefakty

1. Testy kontraktu: canonical input, block kinds, brak aliasów.
2. Testy flow: pełne pokrycie słów, kolejność, continuation, nagłówki,
   flow barriers i puste placementy.
3. Testy geometrii: grafiki prostokątne, elipsy, poligony, wrap i wiele
   obstacles.
4. Testy evaluator mutation: zmiana planu nie może zostać zalegalizowana.
5. Test pipeline: evaluator jest uruchamiany raz.
6. Test parity: `dry_run`, zwykły render i debug mają tę samą sygnaturę planu.
7. Dla realnego editorialu wygenerować zwykły PDF, debug PDF, JSON planu i
   trace oraz sprawdzić selectable text i wizualny układ.

### Krok 7 — dokumentacja

1. Utrzymywać `docs/composition-model.md` jako źródło prawdy terminów i
   przebiegu.
2. Utrzymywać osobny, krótki dokument authoringu template’u.
3. Skonsolidować trwałe decyzje z research notes w dokumentacji normatywnej i
   testach.
4. Dopiero po sprawdzeniu linków i użycia usunąć historyczne research notes.
5. Nie usuwać informacji, która nie została przeniesiona do źródła prawdy lub
   testu.

## Poza zakresem tego release’u

- generalizacja cytatów i grafik jako miękkich insertionów;
- scoring, ranking kandydatów i globalna optymalizacja wyglądu;
- pełne wsparcie RTL/CJK i dodatkowych systemów pisma;
- odtwarzanie starego `Cursor` i starego modelu `ReportData`;
- masowe dzielenie `text-planner.ts` na nowe pojęcia bez wcześniejszych testów;
- zachowanie starej diagnostyki jako drugiego źródła planu.

## Kryteria akceptacji 1.0

Release jest gotowy, gdy:

1. publiczny input ma jeden opisany format oparty o `flows`;
2. każdy obsługiwany block kind przechodzi walidację, pomiar, placement,
   ewaluację i renderowanie;
3. nie ma utraty treści, nielegalnego overlapu ani pustych placement gaps;
4. planner, evaluator, debug i renderer używają tych samych wyliczonych ram;
5. evaluator jest wywoływany dokładnie raz i nie zmienia planu;
6. `dry_run` i render opisują ten sam plan;
7. plan jest deterministyczny dla tych samych danych, template’u i fontów;
8. działają realne testy editorialu oraz ręczny przegląd PDF/debug PDF;
9. nowy maintainer może znaleźć planner, evaluator i pełny przebieg w jednym
   dokumencie;
10. dokumentacja normatywna nie zawiera pojęć ani reguł sprzecznych z kodem.

Najważniejszym rezultatem 1.0 nie jest liczba nowych funkcji. Jest nim fakt,
że istniejący model flow ma jeden czytelny przebieg, a każda reguła ma jedno
jasne miejsce w tym przebiegu.
