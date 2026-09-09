# Plan 13 — audyt kosztu testów przed release 1.0

Status: audyt poziomu harnessu wykonany; pierwsza redukcja artefaktów została
wdrożona i zmierzona. Liczba checków nie jest liczbą przypadków testowych:
pełna macierz editorial zawiera dodatkowo 506 fixture’ów. Pozostałe checki
oznaczone jako `split` wymagają następnych, osobnych migracji.

Aktualny follow-up jest podzielony na trzy niezależne paczki: kontrakty planu
composition, macierz editorial oraz kontrakty public/backend. Każda paczka ma
scalać fixture’y i procesy zgodnie z decyzjami poniżej, zachowując asercje i
mierząc czas wyłącznie bezpośrednich skryptów testowych (bez `test-harness`).
Po scaleniu wyników wymagane są: przegląd diffu, `node --check` oraz ponowny
pomiar właściwych skryptów; pełny `npm run test` pozostaje poza zakresem tej
iteracji, dopóki nie potwierdzimy, że nie ma zmian kontraktu.

## Cel i granice

Nie każdy test, który używa słowa „render”, potrzebuje artefaktu jako dowodu.
W tym audycie klasyfikujemy decyzję projektową, a nie aktualny sposób
uruchomienia testu:

- `not-generated` — test nie tworzy artefaktu wyjściowego albo już sprawdza
  kontrakt na planie/procesie; nie ma czego usuwać;
- `remove` — cały obecny artefakt jest zbędny dla asercji i może zostać
  zastąpiony planem lub odpowiedzią procesu;
- `retain` — artefakt jest właściwym dowodem (np. PDF, raster, PPTX, glify,
  selekcja tekstu albo deterministyczny hash) i musi pozostać;
- `split` — plik miesza asercje, z których część można przenieść do planu lub
  procesu, ale trzeba zachować mniejszy test artefaktowy.

Kontrakt CLI/MCP jest niezależną osią: może mieć decyzję `not-generated`, gdy
sprawdzamy wyłącznie odpowiedź procesu, albo `split`, gdy ten sam check ma
również dowód PDF/PNG/PPTX.

Stan inwentaryzacji: 21 checków ma `not-generated`, 10 ma `retain`, 8 ma
`split`, a 0 ma obecnie `remove`. To nie znaczy, że nie ma oszczędności — osiem
checków `split` może stracić większość swoich renderów — tylko że nie
potwierdziliśmy jeszcze przypadku, w którym cały istniejący artefakt można
usunąć bez pozostawienia choć jednego dowodu backendu.

### Checki a przypadki testowe

`check` oznacza jeden skrypt uruchamiany przez `test-harness`; może zawierać
wiele asercji albo przypadków. `fixture` oznacza konkretny scenariusz wejściowy
w macierzy. W szczególności:

- `npm run test:timings -- --no-build` obejmuje 39 unikalnych checków harnessu;
- `npm run test:editorial-full` obejmuje 506 fixture’ów: 480 wariantów
  macierzy, 7 reproducerów i 19 seeded fixtures; pomiar poza sandboxem dał
  242,32 s, a wszystkie 506 przypadków przeszły;
- szybki `editorial flow` w harnessie uruchamia tylko 26 z tych 506 fixture’ów
  i jest już uwzględniony w pomiarze 39 checków.

W obecnym planie liczba 519 wynika najpewniej z 506 fixture’ów editorial plus
13 unikalnych checków composition. To jednak mieszanka dwóch poziomów, a nie
kanoniczna liczba wszystkich testów repozytorium. Nie wolno sumować jej z 39
checkami bez wskazania poziomu, który liczymy.
Na poziomie przypadków pełna macierz editorial ma decyzję `not-generated` dla
480 wariantów (dry-run) i `retain` dla 26 fixture’ów PDF; poziom pozostałych
checków wymaga takiego samego rozpisania, jeśli mają być raportowane jako
pojedyncze przypadki zamiast skryptów.

### Rzeczywisty `npm run test`

Domyślne `npm run test` nie uruchamia pełnej macierzy editorial, suite’u
`quality` ani osobnego suite’u `brand`. Wykonuje 24 checki: 16 composition i 8
artifacts. Pomiar z buildem z 2026-09-09 zakończył się sukcesem w 229,06 s,
w tym 4,74 s zajęło budowanie bundli. Ten przebieg nie tworzy 300 PDF-ów.
Największy zbiór przypadków w tej komendzie to szybki `editorial flow` z 26
fixture’ami, ale po redukcji tylko dwa z nich zapisują PDF; pozostałe przechodzą
dry-runem planera. Pełne 506 fixture’ów jest osobnym poleceniem i z jego 480
wariantów żaden nie tworzy PDF.

Statyczny przegląd ścieżek zapisu przed redukcją dawał co najmniej 84 zapisane
PDF-y: editorial flow 26, report images 11, public MCP behavior 13, jsPDF
adapter 9, composition oracle 7, public CLI 6, composition adapter 4, report
chrome 2, editorial numbered flow 2 oraz po jednym w text composition engine,
composition image, editorial parity i slide artifacts. To były ścieżki zapisu,
nie liczba stron ani liczba asercji.

Pierwsza redukcja została wdrożona i zweryfikowana w domyślnym gate'cie:

| Check | Przed | Po | Zmiana | Zasada |
|---|---:|---:|---:|---|
| editorial flow | 26 | 2 | -24 | dwa PDF-y reprezentują geometrię kolumn i tabel; pozostałe 24 fixture’y nadal przechodzą przez CLI jako plan-only |
| report images | 11 | 2 | -9 | jeden wieloobrazowy PDF oraz jeden PDF ze źródłem ZIP; intro, float, caption i WebP/AVIF są asercjami tego samego planu/artefaktu |
| public MCP behavior | 13 | 7 | -6 | trasy planner/metric/chart/overflow/template-ref są dry-run; ostrzeżenie notatek jest sprawdzane na istniejącym PDF-ie slajdów |
| public CLI | 6 | 2 | -4 | jeden zwykły i jeden brand-resolver PDF; parity/debug/warning są dry-run |
| jsPDF adapter | 9 | 6 | -3 | bar/line/pie są jednym wieloblokowym PDF-em; eliptyczny boundary pozostaje asercją planu |
| composition adapter | 4 | 1 | -3 | metric/chart/table pozostają testami planu i capability mappingu; jeden PDF dowodzi ścieżki tekstowej/graficznej |
| report chrome | 2 | 1 | -1 | dynamiczny chrome jest sprawdzany z planu, bez drugiego renderu |
| pozostałe retain (oracle, text engine, image, numbered flow, parity, slides) | 13 | 13 | 0 | te artefakty dowodzą odrębnych backendów, warstwy tekstowej, rasteru albo zgodności PDF |
| **łącznie** | **84** | **34** | **-50** | żadna własność planowania nie została usunięta; kosztowny dowód przeniesiono na plan tam, gdzie był wystarczający |

Po zmianie pełny domyślny `npm run test -- --no-build` nadal przechodzi 24
checki. Najnowszy pomiar poza sandboxem z `--timings` to 205,15 s wobec
229,06 s przed redukcją (około 10,4% krócej); wcześniejszy pomiar 182,01 s
pokazuje, że koszt zależy też od obciążenia hosta. Liczba 34 oznacza zapisane
tymczasowe PDF-y w kodzie harnessów; część testów tworzy jeszcze obiekty PDF w
pamięci albo raster/PNG/PPTX, więc nie należy utożsamiać jej z liczbą procesów
renderujących.

To ważne rozróżnienie dla optymalizacji: jeden PDF nie zastąpi testu PNG,
PPTX, warstwy tekstowej, dekodowania WebP/AVIF ani różnych ścieżek błędów, ale
większość powtórzeń w jednym checku można zastąpić planem i jednym minimalnym
artefaktem reprezentującym daną własność.

### Docelowy minimalny zestaw artefaktów

Nie ustalamy globalnej reguły „jeden PDF na cały release”, tylko jedną próbę
na własność backendu. W praktyce oznacza to:

- jeden wieloblokowy PDF dla podstawowego adaptera composition; metric/chart/table
  są sprawdzane renderer-neutralnie, a osobne PDF-y zostają tylko wtedy, gdy
  różnią się kontraktem backendu albo ścieżką błędu;
- jeden PDF obrazu z wariantami PNG/WebP/AVIF oraz osobny minimalny przypadek
  dla ZIP/resolvera, jeżeli sam plan nie dowodzi źródła assetu;
- jeden PDF chrome i jeden PDF editorial parity;
- jeden reprezentatywny zestaw PDF/PNG/PPTX dla publicznego procesu slajdów,
  zamiast powtarzania tej samej treści dla wielu fixture’ów;
- w macierzy editorial 480 przypadków pozostaje bez artefaktu, a z 26 fixture’ów
  tylko dwa zapisują reprezentatywny PDF; pozostałe przechodzą plan-only.

Kandydatem do usunięcia jest render, nie asercja. Przed usunięciem renderu
  musimy wskazać, jaka własność pozostaje dowiedziona przez plan, odpowiedź
  procesu albo zachowany minimalny artefakt.

### Przydatność pełnej ścieżki: plan najpierw, renderer na końcu

Dotychczasowa klasyfikacja `retain` mówiła, że artefakt jest dobrym dowodem
jakiejś własności. Nie odpowiadała jednak na ważniejsze pytanie: czy ta
własność jest częścią kontraktu planera, czy backendu. Dla release 1.0
przyjmujemy następujący podział:

1. `P — plan-only`: scenariusz kończy się na `planReportComposition` albo
   `createTextCompositionEngine(...).plan`. Sprawdzamy `accepted`/`rejected`,
   twarde diagnostyki, strony, sloty, linie, placementy bloków i relacje pudeł.
   To jest właściwy test legalności, kolejności, overflowu, continuation,
   dynamicznej wysokości i pozycji elementów.
2. `T — transport/dry-run`: przez publiczne CLI albo MCP sprawdzamy, czy wejście
   dochodzi do tego samego planera i czy odpowiedź ma właściwy kontrakt. Nie
   przekazujemy `output_path`, więc nie uruchamiamy renderera.
3. `B — backend smoke`: jeden minimalny artefakt na odrębny kontrakt wyjścia
   (PDF, PNG, PPTX, obraz w PDF). Sprawdzamy, że backend umie zapisać poprawny
   format, zachować minimalny tekst/obraz i nie odrzuca legalnego planu. Nie
   powtarzamy tu asercji współrzędnych, bo te należą do `P`.
4. `V — visual/compatibility`: rasteryzacja, ink-occupancy, hash albo porównanie
   z oracle. To jest wolny test regresyjny, a nie podstawowy dowód „da się
   wygenerować X”; powinien być osobnym gate'em manualnym, nightly albo
   rozszerzonym `test:release:visual`.

Plan jest źródłem prawdy dla geometrii. Przykładowe asercje, które nie wymagają
PDF-a, to: każda linia mieści się w slocie, placement flow nie wychodzi poza
stronę, chrome wypycha main, insertion należy do właściwego flow, blok ma
legalny slot, twarde wymaganie ma placement albo plan jest odrzucony, a
residual opisuje dokładnie treść, której nie udało się umieścić. Backend ma
jedynie dowieść, że taki zaakceptowany plan można zmaterializować.

#### Decyzja dla obecnych checków

| Grupa | Checki | Docelowy sposób | Czy pełna ścieżka jest potrzebna? |
|---|---|---|---|
| Czysty plan | `composition engine contract`, `composition input adapter`, `template flow contract`, `report plan contract`, `text composition engine`, `generic soft insertions`, `dynamic insertion slots`, `page template adapter`, `contrast evaluation prototype`, `composition page limits`, `structure scoring` | Bezpośredni planner/evaluator, ewentualnie syntetyczny backend w pamięci | Nie. Te checki badają legalność i geometrię planu. |
| Granica publiczna | `dynamic insertion public contract`, `input errors`, `MCP schema`, `architecture`, `script duplication`, `source context`, `source materialization`, `Markdown normalizer`, `composition documentation`, `brand release template` | Walidacja danych, dry-run, inspekcja plików i odpowiedzi | Nie. Renderowanie nie wnosi dowodu do tych kontraktów. |
| Plan + mały backend smoke | `jsPDF adapter`, `composition adapter`, `composition image`, `editorial numbered flow`, `report chrome`, `report images`, `public CLI behavior`, `public MCP behavior`, `editorial flow`, `brand contract`, `manifest contract`, `manifest consumers`, `brand assets` | Wszystkie warianty i pozycje w planie; jeden minimalny render na właściwy backend/format | Nie w obecnej skali. Tak, ale tylko jako pojedynczy reprezentant kontraktu backendu. |
| Konfiguracja | `configuration reach` | Warianty geometrii porównują znormalizowany plan; jeden render sprawdza, że konfiguracja dociera do backendu, a zmiana score nie zmienia artefaktu | Nie. Dziewięć pełnych renderów nie jest potrzebnych. |
| Sam plan zamiast obecnego PDF parity | `composition oracle` | Porównanie planów, tokenów, stron i placementów; jeden smoke PDF w adapterze | Nie jako pełny oracle PDF. |
| Wolny regresyjny gate | `editorial parity`, raster/ink części `editorial numbered flow`, raster części `report images` | Osobny test visual-QA uruchamiany jawnie lub nightly | Nie w szybkim `test:release`; zachować poza nim, jeśli nadal chcemy ochrony wizualnej. |
| Niezależny format | `slide artifacts` | Jeden mały deck sprawdzający PDF, PNG i PPTX oraz tekst edytowalny | Tak, ale tylko jeden wspólny fixture; nie wiele pełnych decków. |
| Dekoder wejściowy | `image resolver` | Bez PDF: rzeczywiste dekodowanie PNG/WebP/AVIF, rozmiar i root confinement | Nie. To test resolvera, nie renderera. |

`configuration reach` jest przypadkiem granicznym. Warianty zmieniające
geometrię powinny sprawdzać różnicę w znormalizowanym planie, a nie generować
dziewięć PDF-ów. Zostaje jeden smoke dowodzący, że konfiguracja dochodzi do
backendu; wariant score pozostaje testem planu/evaluatora.

`composition oracle` i `editorial parity` nie odpowiadają na pytanie „czy da
się wygenerować legalny dokument”. Odpowiadają na pytanie „czy wynik jest
zgodny z poprzednim rendererem albo obrazem referencyjnym”. Zachowujemy je
jako ochronę kompatybilności, ale nie mogą wymuszać pełnego renderu dla każdej
ścieżki planera.

#### Tańsze techniki wykonania

- Wszystkie scenariusze pozycji, overflowu, priorytetu, chrome i insertionów
  uruchamiać w jednym procesie planera i asercjami relacji między boxami;
  `newPdf()` może pozostać obiektem w pamięci, ale nie wolno wywoływać
  `output()`, `pdftotext` ani `pdftoppm` bez backendowej własności do sprawdzenia.
- Dla CLI/MCP używać `dry_run` dla każdego wariantu, a jedną legalną ścieżkę
  każdego publicznego narzędzia przepuścić do backendu. Błędy wejścia i twarde
  odrzucenia nie powinny tworzyć artefaktów.
- Połączyć warianty w jeden fixture, gdy dowodzą tego samego backendu: jeden
  PDF może zawierać tekst, tabelę, chart i grafikę; jeden deck może zawierać
  tytuł, metryki, tabelę i narrację.
- Nie uruchamiać osobno `pdftoppm`, ImageMagick, FFmpeg ani LibreOffice dla
  asercji, które plan już rozstrzyga. Zostawić je wyłącznie przy testach
  formatu, dekodowania lub visual-QA.
- Nie powtarzać bundlowania i startu procesów dla każdego wariantu. Plannerowe
  macierze powinny importować wspólny bundle/test fixture, a publiczne testy
  mogą używać jednego procesu w trybie batch.
- Rozdzielić szybki release gate od pełnego visual-QA. Każdy pozostawiony
  artefakt musi mieć nazwany kontrakt backendu; sam fakt, że test historycznie
  wykonywał pełny render, nie jest wystarczającym powodem.

Przybliżony potencjał oszczędności wynika z aktualnego pomiaru: `brand
contract`, `manifest consumers` i `configuration reach` to razem około 256 s.
Przeniesienie ich wariantów do planu i pozostawienie pojedynczych smoke
renderów powinno usunąć większość tego kosztu. Nie zakładamy konkretnego czasu
docelowego przed ponownym pomiarem, ponieważ część opóźnienia pochodzi z
zewnętrznych procesów i obciążenia hosta.

### Brand showcase jako jedyny test wizualny

`examples/brand-showcase` jest zestawem demonstracyjnym i wystarcza jako jeden
wizualny smoke test produktu. Generujemy go raz po zmianie rendererów albo
szablonów i zostawiamy wynik jako artefakt demonstracyjny. Nie porównujemy
piksel po pikselu każdego brandu z osobnym baseline'em w każdym przebiegu
`test:release`.

W konsekwencji:

- `brand contract` ma sprawdzać plan, manifest i odrzucenia, a nie wykonywać
  kilkadziesiąt pełnych renderów mutacji; jeden wspólny showcase potwierdza
  materializację PDF/PNG/PPTX;
- `manifest consumers` mają konsumować przygotowane drzewo showcase i badać
  audyt/inspekcję, bez ponownego generowania wszystkich brandów;
- `editorial parity`, ink-occupancy oraz porównania oracle są opcjonalnym
  visual/compatibility gate'em, nie częścią szybkiego dowodu legalnego planu;
- Poppler, ImageMagick, FFmpeg i LibreOffice nie są potrzebne do asercji
  pozycji. Mogą pozostać narzędziami jednorazowego visual-QA, ale nie mogą
  decydować o przejściu planistycznego release gate'u.

Obecnie `examples/*/generated/` jest ignorowane przez Git. Jeżeli wygenerowane
PDF/PNG/PPTX mają być faktycznie zostawione w repo jako demo, trzeba w osobnej
zmianie usunąć ten wpis z `.gitignore`, ograniczyć zestaw do jednego showcase i
opisać go jako artefakt demonstracyjny, a nie baseline testowy.

### Pełne dane ostatniego przebiegu i decyzja dla każdego checka

Poniższe czasy są przybliżeniem z ostatniego `npm run test:release` po
minutowym odczekaniu, zakończonego wynikiem 486,381 ms / 39 checków. To log
jednego hosta, więc wartości mogą się wahać. `P` oznacza plan, `T` transport
lub `dry_run`, `B` pojedynczy smoke backendu, a `V` osobny visual-QA.

| Check | ~s | Tryb docelowy | Co skrócić, scalić albo usunąć |
|---|---:|---|---|
| composition engine contract | 1,4 | P | Zachować; bez renderera. |
| template flow contract | 0,4 | P | Zachować; bez renderera. |
| structure scoring | 0,3 | P | Zachować; czyste funkcje. |
| composition input adapter | 0,5 | P | Zachować; normalizacja i schema. |
| report plan contract | 0,7 | P | Zachować do czasu usunięcia legacy planu; potem przenieść asercje do adaptera i usunąć osobny bundle. |
| text composition engine | 21,9 | P | Zachować przypadki planera; usunąć obowiązkową rasteryzację i współdzielić bundle. |
| generic soft insertions | 0,8 | P | Zachować; placementy i legalność z planu. |
| dynamic insertion slots | 1,5 | P | Zachować; bez publicznego renderu. |
| page template adapter | 4,6 | P | Zachować; nie bundlować niezależnie dla każdego wariantu. |
| jsPDF adapter | 1,6 | B | Jeden minimalny PDF; bez powtarzania asercji geometrii. |
| composition adapter | 4,1 | P+B | Wszystkie capability w planie, jeden wspólny PDF dla backendu. |
| composition oracle | 10,5 | P/V | Porównać plany; PDF oracle przenieść do visual/compatibility. |
| composition image | 4,5 | P+B | Box i flow sprawdzać w planie; jeden minimalny test osadzenia obrazu. |
| contrast evaluation prototype | 0,1 | P | Zachować; syntetyczny raster jest wejściem evaluatora, nie PDF-em. |
| editorial numbered flow | 27,6 | P+B | Kolejność i bariery z planu; najwyżej jeden PDF z tekstem, bez Popplera i ink-occupancy. |
| composition page limits | 13,9 | P | Zachować; test odrzucenia i residualu bez artefaktu. |
| public MCP behavior | 26,8 | T+B | Batch/dry-run dla tras; jeden reprezentatywny render publiczny. |
| dynamic insertion public contract | 5,9 | T | Dodać siedem asercji do `public MCP behavior` i usunąć osobny check. |
| public CLI behavior | 7,4 | T+B | Jeden PDF; parity, warning i warianty planu jako dry-run. |
| report images | 30,9 | P+B | Codec i pozycja w planie/resolverze; jeden PDF obrazu, bez ImageMagick/Popplera. |
| report chrome | 6,0 | P+B | Dynamiczną wysokość i położenie sprawdzać w planie; reuse jednego PDF-a publicznego. |
| editorial flow | 12,8 | P+B | Wszystkie fixture’y plan-only; jeden lub dwa PDF-y reprezentatywne, bez rasteru. |
| editorial parity | 6,1 | V | Wyłączyć z szybkiego release; zastąpić jednorazowym showcase visual-QA. |
| slide artifacts | 1,1 | B | Zachować jeden deck: PDF + PNG + PPTX. |
| brand contract | 128,5 | P/T+B | Największy kandydat: mutacje i błędy plan/dry-run, jeden showcase zamiast dziesiątek renderów. |
| composition documentation | 0,1 | P | Zachować; kontrola statyczna. |
| manifest contract | 0,9 | T+B | Walidować jeden przygotowany manifest showcase. |
| manifest consumers | 75,7 | T | Zachować audyt/inspekcję, usunąć ponowne renderowanie showcase. |
| input errors | 5,2 | T | Wszystkie przypadki w jednym procesie; nigdy nie renderować błędnego wejścia. |
| MCP schema | 2,4 | T | Zachować jedno `listTools`. |
| configuration reach | 51,3 | P+B | Warianty geometrii porównywać w planie; jeden render sprawdzający seam konfiguracji. |
| architecture | 0,6 | P | Zachować; analiza statyczna. |
| script duplication | 0,0 | P | Zachować; analiza statyczna. |
| source context | 0,2 | P | Zachować; root confinement. |
| source materialization | 0,1 | P | Zachować; ZIP/cache/traversal bez renderera. |
| Markdown normalizer | 0,1 | P | Zachować; AST i diagnostyka. |
| image resolver | 9,3 | P | Zachować rzeczywiste dekodowanie PNG/WebP/AVIF, ale bez PDF; współdzielić fixture’y. |
| brand assets | 15,8 | P+B | Publish/derivative i jeden embed smoke; bez pełnego decku dla każdego przypadku. |
| brand release template | 0,3 | P | Zachować; inspekcja template’u. |

Najbardziej oczywiste usunięcia lub scalenia po dodaniu brakujących asercji to:

1. osobny `dynamic insertion public contract` (asercje w `public MCP
   behavior`);
2. ponowne generowanie showcase w `manifest consumers` (manifest z jednego
   demo/showcase);
3. raster i współrzędne z `editorial numbered flow`, `report chrome`,
   `report images` i `composition oracle` (geometria jest już w planie);
4. `editorial parity` z szybkiego release (jeden ręcznie generowany showcase
   wystarcza jako visual smoke);
5. `report plan contract` po zamknięciu legacy seamu, po przeniesieniu jego
   asercji do istniejącego testu adaptera.

Nie usuwamy asercji. Usuwamy tylko powtarzane materializacje i narzędzia, które
nie dowodzą niczego ponad zaakceptowany plan.

## Pomiar bazowy

Źródłem jest `server/qa/test-timings.jsonl`, wygenerowany 2026-09-09 przez
`npm run test:timings -- --no-build`. Przebieg zakończył się sukcesem: 39
unikalnych checków w 503,6 s. Pomiar wykonano przed wydzieleniem suite’u
`brand`; dlatego w tabeli czas dawnego wpisu `brand contract` został
przypisany do nowego suite’u `brand`, a pozostałe wpisy artifacts pomniejszono
o ten czas. Czasy w tabeli są sumą czasu checków (współdzielone wpisy są
wykonywane raz i przypisane do pierwszego suite’u).

| Suite | Łącznie | Unikalne checki |
|---|---:|---:|
| smoke | 2,1 s | 3 |
| composition | 92,9 s | 13 (+3 współdzielone ze smoke) |
| artifacts | 116,7 s | 8 |
| brand | 128,9 s | 1 |
| quality | 162,9 s | 14 |
| całość | 503,6 s | 39 |

### Pomiar po pierwszej redukcji

Najnowszy pełny przebieg `npm run test -- --no-build --timings` (poza
sandboxem, 2026-09-09) przeszedł wszystkie 24 checki w 205,15 s:

| Suite | Łącznie | Checki |
|---|---:|---:|
| composition | 99,28 s | 16 |
| artifacts | 105,86 s | 8 |
| całość | 205,15 s | 24 |

Najdroższe pozostałe checki to `report images` (35,50 s), `public MCP
behavior` (28,04 s), `editorial numbered flow` (28,83 s), `text composition
engine` (23,33 s) i `composition page limits` (14,71 s). Ich czas wynika
głównie z osobnych procesów, bundlowania i rasteryzacji; sama liczba zapisanych
PDF-ów nie jest jedynym kosztem. To są następne kandydaty do optymalizacji,
ale nie redukujemy ich bez zachowania dowodu właściwego dla danego backendu.

Najdroższe checki: `brand contract` 128,9 s, `manifest consumers` 76,0 s,
`configuration reach` 51,7 s, `report images` 43,4 s, `public MCP behavior`
28,4 s, `editorial numbered flow` 27,8 s i `text composition engine` 21,7 s.

## Inwentaryzacja checków

### Smoke

| Check | Czas | Decyzja artefaktowa | Tańszy odpowiednik / decyzja |
|---|---:|---|---|
| composition engine contract | 1,4 s | `not-generated` | Zachować; testuje seam plan–evaluator i używa atrap backendu tylko do sprawdzenia odmowy renderu odrzuconego planu. |
| template flow contract | 0,4 s | `not-generated` | Zachować; kompilacja template’u i geometria nie wymagają PDF. |
| structure scoring | 0,3 s | `not-generated` | Zachować; czyste funkcje scoringu na sztucznym planie. |

### Composition

| Check | Czas | Decyzja artefaktowa | Tańszy odpowiednik / decyzja |
|---|---:|---|---|
| composition engine contract | współdzielony | `not-generated` | Nie uruchamiać drugi raz; właściciel w smoke. |
| composition input adapter | 0,5 s | `not-generated` | Zachować; schema i normalizacja dokumentu. |
| template flow contract | współdzielony | `not-generated` | Nie uruchamiać drugi raz; właściciel w smoke. |
| report plan contract | 0,7 s | `not-generated` | Zachować; `resolveReportPlan` i asercje planu. |
| text composition engine | 21,7 s | `split` | Większość asercji nie potrzebuje artefaktu. Wydzielić długi przypadek raster/PDF obstacle QA do jednego testu artefaktu, a pozostałe przypadki utrzymać przy engine’u. |
| generic soft insertions | 0,8 s | `not-generated` | Zachować; placementy metric/chart/image/table są sprawdzane z planu. |
| dynamic insertion slots | 1,5 s | `not-generated` | Zachować; `applyDynamicInsertionRequests` i legalność slotów są renderer-neutral. |
| page template adapter | 4,6 s | `not-generated` | Zachować; test używa engine’u tekstowego, nie potrzebuje PDF. Osobny koszt to trzy bundlowania testowe. |
| jsPDF adapter | 1,9 s | `retain` | Zachować; sprawdza realny PDF, `pdftotext`, `pdfimages` i backend block capabilities. |
| composition adapter | 4,3 s | `split` | Asercje planu przenieść do bezpośredniego `planReportComposition`; zostawić minimalny PDF dla tekstu, tabeli, chartu i grafiki. |
| composition oracle | 10,6 s | `retain` | Zachować jako test porównania backendu/oracle; nie zastępować samym planem. |
| composition image | 4,5 s | `retain` | Zachować; sprawdza obraz, boundary, caption i tekst po renderze. |
| contrast evaluation prototype | 0,1 s | `not-generated` | Zachować; syntetyczne rastry i evaluator, bez PDF. |
| editorial numbered flow | 27,8 s | `split` | Asercje planowania, kolejności i candidate search mogą być bez artefaktu; zostawić jeden render/raster dla ink-occupancy i zgodności plan→PDF. |
| composition page limits | 14,0 s | `not-generated` | Zachować bez renderu; dalsza optymalizacja fixture’a tylko jeśli zachowa próbę strony ponad limitem. |
| structure scoring | współdzielony | `not-generated` | Nie uruchamiać drugi raz; właściciel w smoke. |

### Artifacts

| Check | Czas | Decyzja artefaktowa | Tańszy odpowiednik / decyzja |
|---|---:|---|---|
| public MCP behavior | 28,4 s | `split` | Zachować proces MCP i minimalne reprezentatywne PDF/PNG/PPTX; warianty powtarzające wyłącznie plan przenieść do odpowiedzi bez artefaktu. |
| dynamic insertion public contract | 5,8 s | `not-generated` | Już używa `dry_run`; nie dodawać PDF. Asercje planu są prawidłowo wykonywane bez renderera. |
| public CLI behavior | 8,3 s | `split` | Zachować jeden realny PDF i jeden test plan/render parity; warianty ostrzeżeń mogą korzystać z `dry_run`. |
| report images | 43,4 s | `retain` | Zachować; WebP/AVIF, caption, float, raster i `pdftotext` są przedmiotem testu. Ograniczyć powtarzanie tych samych scenariuszy w innych checkach. |
| report chrome | 6,4 s | `retain` | Zachować; położenie słów i linii footeru musi być sprawdzone po malowaniu. Test planu może być dodatkowym szybkim testem, nie zamiennikiem. |
| editorial flow | 17,6 s | `split` | Macierz 480 przypadków już nie potrzebuje artefaktu. Spośród 26 fixture’ów PDF wybrać reprezentantów klas błędów, a pozostałe asercje przenieść do planu dopiero po zbudowaniu odpowiednika geometrii. |
| editorial parity | 5,8 s | `retain` | Zachować; porównuje znormalizowany PDF i ink-occupancy. |
| slide artifacts | 0,9 s | `retain` | Zachować; PDF→PNG i edytowalny PPTX są celem testu. |

### Brand

| Check | Czas | Decyzja artefaktowa | Tańszy odpowiednik / decyzja |
|---|---:|---|---|
| brand contract | 128,9 s | `split` | Nie usuwać w ciemno. Rozdzielić testy manifestu/template planu od mutacji, które rzeczywiście muszą potwierdzić zmianę PNG/PPTX; uruchamiać pełny kontrakt jako osobny gate release. |

### Quality

| Check | Czas | Decyzja artefaktowa | Tańszy odpowiednik / decyzja |
|---|---:|---|---|
| composition documentation | 0,1 s | `not-generated` | Zachować; kontrola statycznych dokumentów. |
| manifest contract | 0,9 s | `retain` | Manifest powstaje z renderu decku; można ograniczyć do jednego minimalnego decku, ale nie zastąpić go samym obiektem. |
| manifest consumers | 76,0 s | `split` | Największy kandydat do rozdzielenia: audit/inspect manifestu i jego schematu mogą działać na przygotowanym drzewie, a renderować tylko jeden fixture per format wymagający dowodu. |
| input errors | 5,2 s | `not-generated` | CLI/MCP muszą odrzucać błędy na granicy; nie renderować poprawnych artefaktów. |
| MCP schema | 2,4 s | `not-generated` | Połączenie MCP jest przedmiotem testu, ale nie potrzebuje `render_report`. Zachować jedno `listTools`. |
| configuration reach | 51,7 s | `retain` | Test celowo dowodzi, że zmiana geometrii zmienia PDF, a zmiana score nie zmienia PDF. Zredukować liczbę mutacji przez grupowanie pól, nie usunąć renderu. |
| architecture | 0,6 s | `not-generated` | Zachować; analiza modułów i cykli. |
| script duplication | 0,0 s | `not-generated` | Zachować; analiza źródeł. |
| source context | 0,2 s | `not-generated` | Zachować; ścieżki i granice rootów. |
| source materialization | 0,1 s | `not-generated` | Zachować; ZIP, cache i traversal. |
| Markdown normalizer | 0,1 s | `not-generated` | Zachować; AST i diagnostyka. |
| image resolver | 9,2 s | `not-generated` | Nie tworzy artefaktu wyjściowego; wymaga realnego dekodowania PNG/WebP/AVIF, więc optymalizacja dotyczy współdzielenia wejściowych rastrów, nie usuwania PDF. |
| brand assets | 16,0 s | `retain` | Publikacja i derivative manifestu są testowane na plikach; PDF embedding można ograniczyć do jednego przypadku. |
| brand release template | 0,3 s | `not-generated` | Zachować; inspekcja i kompilacja template’u bez renderera. |

## Wnioski i kolejność prac

1. Nie skracamy testów przez usunięcie asercji ani przez zmianę testowanego
   kontraktu. Najpierw pytamy, czy dana asercja potrzebuje artefaktu jako
   dowodu; jeśli nie, przenosimy ją do planu albo odpowiedzi procesu.
2. Największy bezpieczny zysk powinien pochodzić z checków `split`:
   `manifest consumers`, `brand contract`, `editorial flow` oraz mieszanych
   testów composition. Każdy z nich wymaga osobnego seam’u, ponieważ obecnie
   część asercji jest zakodowana przez `pdftotext` lub wynik procesu.
3. Checki `retain` pozostają artefaktowe, bo ich dowód dotyczy backendu:
   `report images`, `report chrome`, `editorial parity`, `jsPDF adapter`,
   `configuration reach` i `slide artifacts`.
4. Po każdej migracji uruchamiamy najpierw zmieniony check bez artefaktu,
   potem minimalny test artefaktu, a na końcu `test:timings`. Za ukończone
   uznajemy dopiero rozwiązanie, w którym każdy pozostawiony render ma
   nazwany powód, a czas i pokrycie są porównywalne z tym snapshotem.

## Kryterium ukończenia zadania

Każdy z 39 unikalnych checków ma oznaczoną decyzję artefaktową i uzasadnienie.
Obecnie nie ma checku z decyzją `remove`: testy bez artefaktu już są oznaczone
`not-generated`, a przypadki mieszane wymagają najpierw rozdzielenia. Po
migracji żadna asercja dotycząca wyłącznie planu nie powinna uruchamiać
renderera. Każdy test z decyzją `retain` musi mieć najmniejszy fixture
dowodzący konkretnej własności, a pełny kontrakt brandowy i procesowe testy
publiczne pozostają osobnymi gate’ami przed wydaniem.

## Decyzja przy każdej funkcji testowej

Audyt obejmuje wszystkie 24 skrypty wykonywane przez domyślne `npm run test`
(suite `composition` i `artifacts`), sam `test-harness.mjs` oraz współdzielone
testowe helpery z `server/scripts/lib/`, które te skrypty importują. W każdym z
nich każda nazwana lokalna funkcja ma bezpośrednio nad deklaracją komentarz
`@test-decision` i `@test-action`. Komentarz mówi nie tylko, czy funkcję
zachować, ale także czy docelowo:

- pozostawić ją jako asercję planu (`plan-only`, `plan-assertion`),
- scalić fixture’y lub wspólne asercje (`plan-fixture-or-assertion`),
- scalić uruchamianie transportu i procesów (`merge-transport`,
  `merge-process-runner`),
- współdzielić bundlowanie (`merge-shared-bundle`),
- utrzymać jedną partię planowania (`plan-batch`), albo
- przenieść kosztowną weryfikację do jednego smoke/showcase gate’u
  (`visual-gate`),
- usunąć osierocony helper po potwierdzeniu braku wywołań
  (`remove-candidate`).

Nie dopisujemy komentarzy do anonimowych callbacków `map`/`filter` ani do
funkcji domenowych importowanych z `src/`: nie są testowymi seamami tego
harnessu, a ich odpowiedzialność jest opisana w dokumentacji modułów. Decyzja
o koszcie takiej funkcji znajduje się przy testowym call-site. Współdzielone
funkcje z `scripts/lib/` są natomiast objęte komentarzami, bo to kod testowy i
to tam powstają wspólne procesy, fixture’y i dekodery. Jeżeli w kolejnym kroku
będziemy przenosić helpery do wspólnych modułów, ten sam komentarz i decyzję
trzeba przenieść razem z deklaracją.

Najważniejsze decyzje scalające wynikające z komentarzy:

1. `build` nie powinien być wykonywany w każdym teście; jeden wspólny bundle
   jest przygotowywany przez harness albo helper testowy.
2. Procesowe MCP/CLI łączymy w scenariusze transportowe i utrzymujemy jeden
   proces na partię, zamiast uruchamiać go dla każdego wariantu.
3. Fixture’y i asercje planu z `text-composition-engine`, `editorial-flow` i
   `editorial-numbered-flow` łączymy według własności planu, a nie według
   obecnego pliku.
4. PDF/XML/raster/ink helpers nie są usuwane bez dowodu; przechodzą do jednego
   reprezentatywnego showcase/visual-QA gate’u. Szybki test używa planu.
5. Powtarzające się normalizatory tokenów, geometrii i asercji mogą trafić do
   `server/scripts/lib/plan-test-utils.mjs`, ale dopiero po porównaniu
   komunikatów błędów i zakresu danych wejściowych.

### Konkretne scalenia suite’ów

Scalanie nie oznacza zlania wszystkich kontraktów w jeden nieczytelny test.
Oznacza wspólny fixture, proces i warstwę asercji tam, gdzie dowód jest ten
sam:

| Docelowy przebieg | Obecne checki/funkcje | Co wspólnie sprawdza | Co pozostaje osobne |
|---|---|---|---|
| `composition-plan-contract` | engine contract, input adapter, template flow, report plan, soft insertions, dynamic slots, page limits, structure scoring, contrast prototype | wejście → normalizacja → legalność → placementy, sloty, diagnostyka i scoring w pamięci | kontrakt publicznego transportu i backend PDF |
| `editorial-plan-matrix` | planowe części `editorial flow` i `editorial numbered flow` | jedna macierz fixture’ów oraz wspólne asercje kolumn, flow barriers, continuation i insertionów | reprezentatywny render oraz visual-QA |
| `public-transport-contract` | public MCP behavior, dynamic insertion public, public CLI behavior | wspólne dane wejściowe, oczekiwane odpowiedzi, błędy i dry-run; jeden proces na partię scenariuszy danego transportu | MCP i CLI pozostają dwoma adapterami, bo mają różne protokoły |
| `pdf-backend-smoke` | jsPDF adapter, composition adapter, composition image, report chrome, report images | jeden minimalny dokument zawierający tekst, tabelę, obraz, chrome i insertion; asercje formatu oraz zapisu | testy specyficzne dla resolvera obrazów i osobne formaty PNG/PPTX |
| `visual-showcase` | raster/PDF helpers z text engine, numbered flow, composition oracle, editorial parity | jedna materializacja demonstracyjna, ink/token/box parity i oracle | nie jest częścią szybkiego `npm run test`; uruchamiany jawnie/nightly |

W każdym wierszu najpierw przenosimy asercje do wspólnego planu, następnie
uruchamiamy jeden reprezentatywny smoke. Dopiero potem można usunąć stare
wywołania renderera. Samo połączenie plików bez wspólnego fixture’a nie jest
scaleniem i nie obniży kosztu.

### Pomiar po pierwszej serii scaleń

Poniższe czasy pochodzą z bezpośrednich uruchomień pojedynczych skryptów poza
`test-harness` (host, 2026-09-09). Są orientacyjne, bo zależą od obciążenia i
throttlingu CPU:

| Skrypt | Czas | Wynik | Zmiana/scalenie |
|---|---:|---|---|
| `test-composition-report-data-adapter.mjs` | 0,19 s | PASS | dwa bundlowania → jeden build wielowejściowy |
| `test-template-flow-contract.mjs` | 0,10 s | PASS | dwa bundlowania → jeden build |
| `test-report-plan.mjs` | 0,17 s | PASS | trzy bundlowania → jeden build |
| `test-page-template-adapter.mjs` | 4,27 s | PASS | trzy bundlowania → jeden build |
| `test-composition-page-limits.mjs` | 5,40 s | PASS | cztery bundlowania → jeden build; mniejsze fixture’y |
| `test-editorial-flow.mjs` | 13,32 s | PASS | 24 warianty plan-only + 2 PDF reprezentanty |
| `test-editorial-numbered-flow.mjs` | 30,60 s | PASS | jeden backend smoke; raster/PDF parity opt-in |
| `test-dynamic-insertion-public.mjs` | 5,91 s | PASS | bezpośredni MCP contract, 7 insertion lines, 4 strony |
| `test-cli.mjs` | 6,32 s | PASS | pięć requestów render/dry-run w jednej partii |
| `test-report-images.mjs` | 31,77 s | PASS | jeden PDF dla PNG/WebP/AVIF/float/ZIP; bez raster QA |
| `test-report-composition-adapter.mjs` | 4,42 s | PASS | jeden adapter smoke dla tekstu, tabeli, chartu i grafiki |
| `test-report-composition-image.mjs` | 4,86 s | PASS | jeden image boundary/caption plan + backend smoke |
| `test-report-chrome.mjs` | 6,33 s | PASS | jeden PDF chrome |

Agentowe pomiary tej samej serii mieściły się w granicach: page-template
5,55 s, page-limits 7,91 s, editorial flow 16,93 s, CLI 6,69 s, report images
33,34 s, composition adapter 6,05 s i composition image 5,29 s. Różnica nie
oznacza regresji; jest spodziewaną zmiennością środowiska. Nie uruchamiano
`npm run test` ani testów, które uruchamiają inne testy.

Weryfikacja statyczna po audycie wykazała 227 nazwanych funkcji w tych skryptach
i współdzielonych helperach oraz jeden nazwany callback właściwości MCP; 0
deklaracji pozostało nieoznaczonych. Same komentarze nie zmieniają ścieżki
wykonania, dlatego nie uruchamiamy pełnego, wielominutowego suite’u ponownie;
przed każdą zmianą implementacyjną obowiązuje jednak `node --check` dla
zmienionych skryptów oraz test właściwego suite’u.

Rozkład decyzji w tym snapshotcie to: `visual-gate` 98,
`plan-fixture-or-assertion` 52, `plan-assertion` 41, `plan-only` 11,
`merge-process-runner` 3, `merge-shared-bundle` 4, `merge-transport` 4,
`merge-showcase-manifest` 6, `merge-timing` 2,
`merge-shared-assertions` 3 oraz po jednej funkcji dla
`centralize-manifest`, `shared-harness`, `plan-batch` i
`remove-candidate`. To są decyzje dla funkcji, nie nowe testy ani dodatkowe
przebiegi harnessu.
