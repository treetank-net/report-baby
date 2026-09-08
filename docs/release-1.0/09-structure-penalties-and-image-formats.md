# Plan 09 — ciągłość struktur i formaty obrazów

Status: nierozpoczęty; zaplanowany po domknięciu soft insertionów i kalibracji
wyszukiwania kandydatów.

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

Do ustalenia podczas implementacji pozostają osobne wagi dla:

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

- jednostkowe: każda odmiana podziału daje oczekiwany składnik breakdownu;
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

Po rozpoznaniu formatu resolver dostarcza wspólny, zdekodowany raster. Dalsze
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

Wymagane jest sprawdzenie dostępności biblioteki dekodującej w środowisku
produkcyjnym, bundlu CLI i środowisku testowym. Sam fakt, że format otwiera się
lokalnie przez narzędzie systemowe, nie wystarcza.

## 3. Czas feedbacku testów

Obecny `test:brand` / `brand contract` wykonuje wiele pełnych renderów przez
CLI i brand tool, osobno dla mutacji slotów, regionów, metryk, szablonów oraz
formatów PNG/PPTX/PDF. Jest wartościowym kontraktem integracyjnym, ale jego
czas wykonania nie może blokować całego cyklu developmentu za każdym razem,
gdy zmieniamy planner lub renderer.

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
