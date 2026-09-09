# Plan 09 — ciągłość struktur i formaty obrazów

Status: wykonany dla zakresu release’u. Scoring ciągłości list, tabel i małych
fragmentów, ingest WebP/AVIF, pełna bramka kontraktu obrazów oraz rozdzielenie
szybkiego i pełnego feedbacku są zaimplementowane. Kalibracja wag na hostach CI
pozostaje optymalizacją release 1.1, a nie brakującym kontraktem 1.0.

## Cel

Domknąć dwa braki, które wpływają na jakość końcowego PDF-a, ale nie powinny
tworzyć kolejnego równoległego systemu reguł:

1. planner i evaluator mają mocno obniżać score za nieestetyczne dzielenie
   list oraz tabel;
2. ścieżka obrazów ma obsługiwać WebP i AVIF tak samo jak obecnie obsługiwane
   formaty, także wtedy, gdy obraz jest potrzebny do oceny kontrastu.

## 1. Kara za przerywanie list i tabel

### Co mierzymy

- listę rozdzieloną między strony lub kolumny;
- tabelę rozdzieloną między strony lub kolumny;
- przeniesienie nagłówka tabeli bez wystarczającej liczby kolejnych wierszy;
- podział pojedynczego wiersza tabeli, jeżeli renderer i dane dopuszczają taki
  podział;
- sytuację, w której po przeniesieniu struktury powstaje samotny nagłówek,
  jeden element listy albo bardzo mały fragment tabeli.

Nie zakładamy, że każde przejście listy lub tabeli na kolejną stronę jest
błędem. Kara ma zależeć od jakości podziału: naturalny podział między
elementami jest mniej zły niż samotny nagłówek, a podział wiersza jest gorszy
od przeniesienia całego wiersza.

### Zasada punktacji

Kary są częścią ogólnej punktacji legalnego planu. Nie tworzymy osobnego
`fail` dla listy ani tabeli, o ile plan nadal spełnia twarde reguły geometrii i
zachowania treści. Wartości muszą trafić do `composition_score` w
`server/templates/render-config.yml`; kod nie może zawierać ich jako
duplikowanych literałów.

W kodzie istnieją osobne składniki `list-continuity`, `table-continuity` oraz
`tiny-fragments`. Każdy zwraca miękką karę i szczegóły użyte w trace/debug.
Wagi są konfigurowane w `composition_score` (`list_*`, `table_*` oraz
`tiny_fragment_*`) i nie zmieniają legalności planu.

Do kalibracji na realnych editorialach pozostają osobne wagi dla:

- podziału listy między kontenerami;
- podziału tabeli między kontenerami;
- samotnego nagłówka tabeli;
- podziału wiersza;
- fragmentu poniżej minimalnej liczby elementów lub wierszy.

Nie dobieramy tych liczb intuicyjnie. Porównujemy score z ręczną oceną PDF-ów
na krótkim fixture, długim editorialu i przypadkach granicznych. Jeżeli kara
poprawia ranking, ale nie odpowiada poprawie wizualnej, zostaje oznaczona jako
niezestrojona, a nie uznana za sukces.

### Testy

- jednostkowe: każda odmiana podziału daje oczekiwany składnik breakdownu
  (zrealizowane w `scripts/test-structure-scoring.mjs`);
- jednostkowe: legalny podział między elementami nie jest traktowany jak
  naruszenie twardej reguły;
- integracyjne: dwa plany z tym samym tekstem różnią się tylko ciągłością
  listy/tabeli i gorszy wariant ma niższy score;
- regresyjne: istniejący `page-fill-table` zachowuje treść, nagłówki i
  poprawne przejście strony;
- wizualne: PDF pokazuje wybrany plan, a debug trace pokazuje, z czego wynika
  kara.

## 2. WebP i AVIF

### Zakres

Image resolver powinien przyjmować WebP i AVIF z tych samych źródeł co inne
obrazy:

- HTTP(S);
- `root://` z `content_root`;
- `brand://` z katalogu lub ZIP-a marki;
- bezpośredni asset podany przez blok obrazu.

Po rozpoznaniu formatu resolver dostarcza wspólny, zdekodowany raster. W tej
wersji WebP i AVIF są transkodowane do PNG przez procesowy dekoder `ffmpeg`;
obecność tej komendy jest wymaganiem środowiska uruchomieniowego bundla (nie
jest to npm runtime dependency). Dalsze
moduły nie powinny rozróżniać PNG, JPEG, WebP i AVIF: renderer używa obrazu,
a sampler kontrastu próbuje kolory z tego samego rastra. Nie tworzymy osobnych
ścieżek logiki kontrastu dla każdego formatu.

### Weryfikacja

- test dekodowania WebP i AVIF z minimalnymi fixture’ami;
- test renderowania obu formatów do PDF-a;
- test brand ZIP z obrazem WebP/AVIF;
- test, że obraz trafia do cache i nie jest dekodowany osobno dla każdego
  kandydata;
- test kontrastu na obrazie o znanym tle, w tym po `contain` i po przesunięciu
  kandydata;
- test błędu dla uszkodzonego lub nieobsługiwanego pliku z komunikatem
  wskazującym źródło i format.

Wymagane jest sprawdzenie dostępności dekodera `ffmpeg` w środowisku
produkcyjnym, bundlu CLI i środowisku testowym. Sam fakt, że format otwiera się
lokalnie, nie wystarcza; brak dekodera musi kończyć się czytelnym błędem ze
źródłem i formatem.

## 3. Czas feedbacku testów

Obecny `test:brand` / `brand contract` wykonuje wiele pełnych renderów przez
CLI i brand tool, osobno dla mutacji slotów, regionów, metryk, szablonów oraz
formatów PNG/PPTX/PDF. Jest wartościowym kontraktem integracyjnym, ale jego
czas wykonania nie powinien blokować całego cyklu developmentu za każdym razem,
gdy zmieniamy planner lub renderer. Dlatego `brand` jest osobnym suite’em
harnessu: `npm test` obejmuje composition i artifacts, a `npm run test:brand`
pozostaje jawnie uruchamianym gate’em brandowym; `npm run test:release` nadal
obejmuje wszystko.

Przed finalizacją release’u należy:

- rozdzielić szybki, deterministyczny smoke test od ciężkiego kontraktu
  release’owego;
- współdzielić zbudowane bundle, przygotowane fixture’y i dane wejściowe tam,
  gdzie nie zmienia to zakresu asercji;
- ograniczyć powtarzane pełne rendery do przypadków, w których faktycznie
  sprawdzają inną własność, a pozostałe zachowania testować na planie lub
  mniejszym artefakcie;
- zachować pełny kontrakt brandowy jako osobny gate uruchamiany przed
  release’em, ale nie wymagać go przy każdej lokalnej zmianie kodu;
- zmierzyć czas każdej grupy testów i ustalić akceptowalny budżet dla
  szybkiego feedbacku oraz dla pełnego gate’u;
- utrzymać jedną, czytelną komendę uruchamiającą szybki pipeline oraz jedną
  komendę uruchamiającą pełną weryfikację release’u.

W repozytorium są teraz trzy jawne wejścia: `npm run test:smoke` (kontrakt
composition, kontrakt przepływów i scoring struktur), `npm run test:release`
(pełny zestaw bieżących suite’ów) oraz `npm run test:editorial-full` (pełna
macierz 506 fixture’ów przepływu redakcyjnego, uruchamiana przed wydaniem lub
nocą). Zwykły `editorial flow` w `test:release` sprawdza 26 reprezentatywnych
fixture’ów; pełny `test:editorial-full` sprawdza 506 fixture’ów (480 wariantów
bez artefaktu i 26 przypadków PDF) i nie blokuje codziennego feedbacku.
Harness raportuje czas każdego
checku i całej grupy, ostrzega po `quality.test_feedback.check_warning_ms`, a
budżety `smoke_budget_ms` i `release_budget_ms` są czytane z
`server/templates/render-config.yml`. Progi są początkową polityką release'u;
ich kalibracja na hoście CI pozostaje osobnym zadaniem. Test limitów stron używa
krótszego, nadal nadmiarowego dokumentu (4 strony limitu); nie koduje arbitralnie
12 stron jako wymogu produktu.

Szczegółowe czasy nie są już tylko komunikatem terminala. `npm run test:timings`
uruchamia cały zakres i przyrostowo zapisuje `server/qa/test-timings.jsonl`;
raport zawiera rekordy start/koniec każdego checku, status błędu oraz agregaty
per suite. Dzięki temu można wskazać konkretny wąski gardło bez ponownego
zgadywania na podstawie czasu całego release gate’u.

Pomiar z 2026-09-09 (bez builda) dał 503,6 s dla 39 unikalnych checków
harnessu. Osobny pomiar pełnej macierzy editorial 506 fixture’ów dał 242,32 s:
wszystkie przypadki przeszły. Nie sumujemy tych czasów, bo szybki check
editorial (26 fixture’ów) jest częścią obu przebiegów.
Wynik harnessu to: composition 92,9 s, artifacts 116,7 s, brand 128,9 s,
quality 162,9 s i smoke
2,1 s. Brand jest osobnym suite’em, więc lokalne `npm test` nie uruchamia go
automatycznie, ale `test:release` nadal go obejmuje. Te
wartości są punktem odniesienia dla decyzji o kosztownym artefakcie, a nie
docelowym SLA.

### Zadanie: decyzja, czy artefakt jest potrzebny

Audyt ma odpowiedzieć dla każdej asercji, czy artefakt jest koniecznym dowodem,
a nie tylko opisać, co test uruchamia dzisiaj. Jeżeli asercja pyta o wynik
planera — na przykład o stronę, `flowId`, `slotId`, kolejność placementów,
legalność albo residual — artefakt jest `not-generated`; test powinien użyć
`CompositionPlan` i `Evaluation`. Nie powinien uruchamiać backendu PDF,
rasteryzacji ani `pdftotext`. Ten sam input i ta sama asercja muszą być
dostępne przez renderer-neutral seam.

Render oznaczamy `retain` tylko dla asercji, których przedmiotem jest artefakt
lub backend: rzeczywista obecność glifów/obrazu, selekcja tekstu w PDF,
ink-occupancy, kontrast po rasteryzacji, poprawność PDF/PNG/PPTX albo
porównanie deterministycznego artefaktu. Gdy plik miesza takie asercje z
asercjami planu/procesu, decyzja brzmi `split`: zostaje jeden najmniejszy
fixture artefaktowy, a reszta przechodzi na plan/proces. Kontrakt CLI/MCP nie
uzasadnia artefaktu sam przez się — jeśli sprawdzamy tylko odpowiedź procesu,
artefakt pozostaje `not-generated`.

Kolejność realizacji:

1. Na podstawie `qa/test-timings.jsonl` wskazać testy dłuższe niż próg z
   `quality.test_feedback.check_warning_ms` i rozłożyć je na konkretne asercje.
2. Oznaczyć każdy check decyzją `not-generated`, `remove`, `retain` albo
   `split`, zależnie od tego, czy artefakt można usunąć, zachować lub ograniczyć.
3. Przenieść asercje bez artefaktu do bezpośredniego wejścia composition engine’u,
   współdzieląc fixture i konfigurację, bez zmiany zakresu ochrony.
4. Zostawić jeden mały test renderowy na własność backendu, a usunięte rendery
   zastąpić asercjami planu lub evaluatorów.
5. Ponownie zmierzyć cały gate i zapisać przed/po w raporcie JSONL.

Kryterium ukończenia: żadna asercja dotycząca wyłącznie planu nie renderuje
artefaktu, a każdy pozostawiony render ma w dokumentacji nazwany powód. Wynik
bez artefaktu musi być równoważny semantycznie z dotychczasową asercją; celem
jest redukcja czasu i obciążenia, nie osłabienie pokrycia.

Kryterium ukończenia: zmiana w plannerze daje szybki wynik lokalnie bez
czekania na wszystkie niezależne rendery, a pełny gate nadal sprawdza te same
kontrakty przed wydaniem i nie traci ochrony przed regresją artefaktów.

## Kryteria ukończenia

- ranking planów uwzględnia ciągłość list i tabel w jednym, udokumentowanym
  score;
- testy pokazują, że kara jest silna, ale nie jest osobnym automatycznym
  failem;
- wszystkie wartości kar i limity są konfigurowalne w YAML;
- WebP i AVIF przechodzą resolver, renderer, debug oraz screening kontrastu;
- normalny PDF, `dry_run` i debug używają tego samego zdekodowanego assetu;
- dokumentacja `composition`, planera i evaluatora opisuje nowe składniki score
  oraz ich interakcje z fragmentacją, orphanami i kontrastem.

## Wymaga uzupełnienia po wykonaniu punktu X

- konkretne wagi kar po porównaniu z realnymi editorialami;
- decyzja, czy podział pojedynczego wiersza tabeli jest w ogóle dopuszczalny
  przez docelowy renderer;
- wybrana biblioteka dekodująca WebP/AVIF po sprawdzeniu rozmiaru bundla,
  licencji i działania poza sandboxem;
- limity rozmiaru i kosztu dekodowania po benchmarku na rzeczywistych
  obrazach.
