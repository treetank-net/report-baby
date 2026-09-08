# Plan 08 — głębokość wyszukiwania kandydatów

Status: częściowo wykonany; renderer-neutralny sampler, próbkowanie komórek
glifów dla całego korpusu, integracja PNG z asset adapterem i evaluatorem oraz
deterministyczna kolejność kandydatów i trace liczników kosztu wyszukiwania
działają. Trace zawiera również obserwowany czas planowania, który nie jest
metryką deterministyczną. Nadal trzeba wykonać
kalibrację na realnych editorialach, porównać screening z finalnym PDF-em i
objąć pozostałe formaty.

## Cel

Sprawdzić, czy sposób szukania pozycji elementu znajduje wystarczająco dobry
układ, a nie tylko pierwszy sensowny wariant. Pięć pozycji jest dobrym
startem, ale nie traktujemy tej liczby jako prawdy. Po pierwszym przybliżonym
wyszukiwaniu chcemy móc sprawdzić kilka dokładniejszych pozycji w pobliżu
najlepszego wyniku.

To nie jest pozwolenie na przeszukiwanie całej strony bez limitu. Każda próba
ma być deterministyczna, ograniczona i widoczna w trace.

## Kolejność prac

1. Zmierzyć koszt obecnego wyszukiwania jednego ruchomego elementu: liczba
   kandydatów, czas planowania, liczba przeliczeń tekstu i liczba wariantów
   odrzuconych.
2. Dla tego samego zakresu porównać wyszukiwanie zgrubne, lokalne doprecyzowanie
   i kilka kolejnych rund doprecyzowania.
3. Sprawdzić, czy dodatkowe warianty faktycznie poprawiają score, łamanie
   akapitów, liczbę orphanów i równomierność odstępów.
4. Sprawdzić przypadek, w którym najlepsza pozycja leży pomiędzy pierwszymi
   kandydatami, a nie dokładnie na ich współrzędnej.
5. Sprawdzić przypadek, w którym dodatkowe szukanie nic nie poprawia i powinno
   zakończyć się wcześniej.
6. Dopiero po tym dobrać limity i wartości konfiguracyjne dla realnych
   editoriali.

## Miary wyniku

Dla każdej rundy zapisujemy:

- liczbę wygenerowanych i unikalnych kandydatów;
- liczbę pełnych przeliczeń tekstu;
- liczbę reflowów każdego kandydata;
- czas planowania;
- liczbę planów nielegalnych;
- score każdego legalnego planu i jego breakdown;
- zmianę liczby fragmentacji, orphanów i nierównych odstępów;
- wynik sprawdzenia kontrastu tekstu względem rzeczywistego tła kandydata,
  wraz z minimum ratio, znormalizowaną jakością, punktami i kosztem pomiaru;
- różnicę pomiędzy zwycięzcą danej rundy a najlepszym znanym wynikiem.

Nie wystarczy, że score wzrósł. Musimy zobaczyć, czy wzrost odpowiada
rzeczywistej poprawie na PDF-ie.

## Warianty wyszukiwania do porównania

Pierwszy eksperyment powinien porównać trzy ograniczone sposoby:

- kilka równomiernie rozłożonych pozycji w całym dozwolonym zakresie;
- lokalne pozycje wokół najlepszego kandydata z mniejszym odstępem;
- kolejną rundę tylko wtedy, gdy poprzednia runda poprawiła wynik albo gdy
  najlepszy wynik leży przy granicy badanego zakresu.

Nie wybieramy z góry, że najlepsza będzie konkretna metoda. Wynik ma wynikać
z realnego editorialu z długim tekstem i małymi akapitami oraz z małego
fixture’u, gdzie łatwo sprawdzić pojedyncze fragmenty.

## Kryteria ukończenia

- test potwierdza, że dodatkowa runda potrafi znaleźć lepszą pozycję niż samo
  wyszukiwanie zgrubne;
- test potwierdza, że dodatkowe rundy kończą się po osiągnięciu limitu lub po
  braku poprawy;
- liczba kandydatów i liczba przeliczeń są ograniczone konfiguracją;
- kolejność kandydatów i wybór zwycięzcy są deterministyczne;
- PDF/debug/trace pokazują tę samą pozycję zwycięzcy;
- dodatkowe kandydaty poprawiają przynajmniej jedną mierzalną właściwość bez
  pogorszenia twardych zasad i bez nieakceptowalnego kosztu;
- jeśli dodatkowe wyszukiwanie poprawia tylko liczbę punktów, ale nie poprawia
  obrazu dokumentu, pozostawiamy to jako otwartą kwestię kalibracji score, a
  nie jako dowód, że trzeba szukać głębiej.

## Kontrast jako dodatkowa miara kandydata

Przesunięcie grafiki albo tekstu może zmienić tło znajdujące się bezpośrednio
pod literami. Dlatego kontrast powinien być liczony po ustaleniu geometrii
kandydata, ale przed jego wyborem przez ewaluatora. Nie powinien być częścią
algorytmu łamania linii.

Wszystkie kandydaty mogą dostać tani screening: obraz dekodujemy i
downsample'ujemy raz, a dla kolejnych pozycji tylko pobieramy próbki z
odpowiedniego cropu. Nie używamy samej średniej ani samego rozmycia, ponieważ
jasne i ciemne fragmenty obrazu mogą dać średnią, która wygląda bezpiecznie,
choć część tekstu leży na tle o złym kontraście. Zachowujemy najgorszą lub
dolną część wyników próbek i pokazujemy obszar próbki w debug trace.

Dokładniejsze, ograniczone renderowanie wykonujemy dopiero dla zwycięzcy i
kandydatów bliskich remisu albo punktu kalibracyjnego. Nie służy ono do
odrzucania planu, tylko do sprawdzenia, czy przybliżony pomiar dobrze porządkuje
rozwiązania. `unknown` nie udaje pomiaru: pozostaje widoczny w breakdownie i
jest obecnie neutralny punktowo.

Progi 4.5:1 dla zwykłego tekstu i 3:1 dla dużego tekstu są punktami odniesienia
z WCAG 2.2, a nie twardymi bramkami planera. Aktualny evaluator nie używa już
prostego clampowania minimum. Dla każdego glifu średni kontrast zasila rozproszoną
ocenę jakości, natomiast najgorszy punkt próbkowania glifu zasila lokalny sygnał
widoczności, a liczba glifów z najgorszym punktem poniżej
`contrast_severe_ratio` zasila osobny, wysycający się sygnał szerokości problemu.
Każdy sygnał jest normalizowany asymptotycznie funkcją
`x / (x + response)`, a ich wpływ kontrolują wagi w `composition_score`.
Wartość `contrast.body_minimum` jest konfigurowalnym celem punktacji, nie
automatycznym odrzuceniem. Ozdobne glyphy i logo mogą w przyszłości dostać
osobne wagi, ale nadal jako jakość, nie legalność.

Pierwszy benchmark powinien mierzyć: czas dekodowania i czas próbkowania,
trafienia cache, rozbieżność między screeningiem a wynikiem dokładnym oraz
przypadek, w którym przesunięcie tego samego tekstu nad obrazem zmienia
znormalizowane punkty kontrastu. Wagi można dostrajać dopiero po porównaniu z
PDF-ami i ręczną oceną wizualną.

### Wynik pierwszego eksperymentu

Prototyp w
[`server/scripts/test-contrast-evaluation-prototype.mjs`](../../server/scripts/test-contrast-evaluation-prototype.mjs)
przeszedł jako element composition gate. Na kontrolowanym obrazie z lokalnym
ciemnym pasem przetestowano 8 pozycji tekstu:

- obraz został przygotowany raz, a 7 kolejnych kandydatów skorzystało z cache;
- screening `6x6` zużył 288 próbek, podczas gdy referencyjne przejście po
  wszystkich pikselach zużyło 1920 próbek;
- globalna średnia dała fałszywie bezpieczny wynik `5.28:1` dla pozycji, która
  zawierała czarny fragment o rzeczywistym kontraście `1:1`;
- lokalny screening wykrył oba kandydaty z czarnym fragmentem i zgodził się z
  referencyjnym minimum dla wszystkich pozycji;
- znane tło pod przezroczystym PNG dało wynik, a brak koloru pod spodem dał
  `unknown`.

To potwierdza kierunek taniego screeningu, ale jeszcze nie dowodzi poprawności
dla wszystkich formatów wejściowych ani zgodności z finalnym rasterem PDF-a.
Fixture jest syntetyczny, a referencja skanuje region prostokątny, nie dokładną
maskę glifów. Przed produkcyjnym podłączeniem trzeba sprawdzić realny asset po
rzeczywistym `contain`/cropie oraz przypadek, w którym dokładniejszy pomiar
zmienia ranking punktowy.

Eksperyment ujawnił rozbieżność, którą usunięto: istniejące funkcje kontrastu
w `brand-context.ts` i `visual-qa.mjs` używały granicy sRGB `0.03928`, podczas
gdy aktualna definicja WCAG podaje `0.04045`. Wzór został ujednolicony i objęty
testem kontraktu, aby evaluator, visual QA i screening nie wydawały różnych
werdyktów dla tego samego koloru.

## Stan implementacji po eksperymencie

Silnik composition zapisuje teraz `trace.candidateSearch`. Dla rundy zgrubnej
i każdej rundy doprecyzowania trace pokazuje liczbę wygenerowanych,
unikalnych i ewaluowanych planów, liczbę legalnych kandydatów, wynik najlepszego
wariantu, liczbę reflowów i informację, czy runda poprawiła zwycięzcę. Trace
agreguje także czas planowania oraz liczbę pełnych przeliczeń planu. Kandydaci
nie są usuwani przed ewaluacją, więc istniejąca kolejność i tie-break pozostają
kompatybilne; unikalność jest raportowana osobno. Runda kończy się wcześniej,
gdy nie poprawia zwycięzcy, a limit pozostaje kontrolowany przez konfigurację
`candidateCount`, `refinementRounds` i `refinementCandidateCount`.

Kontrakt silnika ma test, w którym doprecyzowanie znajduje lepszy wariant niż
wyszukiwanie zgrubne, a następna runda kończy się z jawnym powodem
`no-improvement`. Fixture ruchomego cytatu nadal sprawdza rzeczywiste pozycje,
score i reflowy, ale jego najlepsza lokalna pozycja jest obecnie remisem z
wariantem zgrubnym; nie traktujemy tego jako dowodu kalibracji wizualnej.

Renderer-neutralny sampler został dodany w
[`server/src/composition/contrast.ts`](../../server/src/composition/contrast.ts)
i sprawdzony na publicznym composition seam. Nie dekoduje on obrazów i nie
zna PDF-a — przyjmuje przygotowany raster oraz region w jego współrzędnych.

Sampler jest podłączony do istniejącego seam-u asset adapter → evaluator.
Adapter dekoduje PNG raz, mapuje rzeczywisty prostokąt obrazu po `contain`, a
evaluator zapisuje status, najgorszy pomiar, komórki glifów, najgorszy punkt,
regiony próbek i ostrzeżenia bez dodawania kontrastu do łamania linii. JPEG oraz nieznane rastry zwracają
`unknown`; SVG jest obsługiwane tylko wtedy, gdy resolver dostarczy raster.
Planer pozostaje wolny od dekodowania pikseli.

Granica sRGB w istniejących implementacjach kontrastu została ujednolicona do
`0.04045` i objęta testem kontraktu zgodności z granicą WCAG. Kontrast jest
sprawdzany względem koloru tła całej strony oraz obrazów znajdujących się pod
komórkami glifów; nie ogranicza się do glifów przecinających grafikę.

### Pomiar kosztu na rzeczywistym obrazie

Wykonano osobny, jednorazowy benchmark na rzeczywistym obrazie PNG z artefaktu
editorialu: 1620×1080 px, RGB, 1 200 915 bajtów. Benchmark używał
produkcyjnego `sampleCompositionContrast`; przygotowanie obrazu i pełny skan
były osobnymi operacjami pomiarowymi. Mediany lokalnego uruchomienia były
następujące:

| Operacja | Zakres | Mediana |
|---|---:|---:|
| Dekodowanie pełnego PNG | 1 obraz | 95,5 ms |
| Zmniejszenie do thumbnaila 320×213 | 1 obraz | 1,53 ms |
| Zmniejszenie do thumbnaila osobno dla 20 kandydatów | 20 przygotowań | 25,1 ms |
| Screening 20 kandydatów na pełnym, zdekodowanym obrazie | 20 × 6×6 próbek | 0,92 ms |
| Screening 20 kandydatów na jednym cached thumbnailu | 20 × 6×6 próbek | 0,91 ms |
| Skan wszystkich pikseli w 20 regionach | 20 regionów | 2079 ms |

Wniosek praktyczny jest ważniejszy niż dokładne milisekundy z jednej maszyny:
obraz należy przygotować raz, a potem próbkować lokalnie dla każdego kandydata.
Jeżeli pełny raster jest już potrzebny do późniejszego renderingu, użycie jego
próbek jest tańsze i dokładniejsze niż tworzenie rozmytej kopii. Thumbnail ma
sens jako ograniczenie pamięci albo drugi, przybliżony etap, ale nie jako
warunek screeningu. Generowanie thumbnaila osobno dla każdego kandydata jest
niepotrzebnym mnożeniem kosztu.

Benchmark nie mierzył JPEG-a, SVG ani częściowego renderowania PDF. Obecny
`image-resolver` zachowuje JPEG jako JPEG, a renderer-neutralny sampler
otrzymuje już raster; dlatego integracja musi najpierw jawnie określić decoder
JPEG/SVG i cache. Nie wolno przenosić tego kosztu do każdego kandydata.

Kontrast powinien być obowiązkowo sprawdzany, gdy tekst leży na grafice,
przezroczystym obrazie, nakładce albo tle z niestandardowej palety. „Obowiązkowo
sprawdzany” nie oznacza automatycznie „twardo odrzucany”: znany poniżej-progowy
wynik obniża ogólny score kandydata, a wynik `unknown` pozostaje widoczny i
neutralny do czasu kalibracji. Dla jednolitego koloru nie ma powodu dekodować
obrazu — można policzyć dokładny kontrast z koloru tła.

Benchmark dla 20 kandydatów na prawdziwym obrazie został wykonany. Test ścieżki
adaptera, mapowania `contain`, komórek glifów i deterministycznego strumienia
losowego również istnieje. Pozostaje test porównujący screening z finalnym
renderem PDF-a oraz kalibracja wpływu `composition_score.contrast_penalty`.
Waga pozostaje robocza do czasu porównania wyników z ręczną oceną PDF-ów.

## Zależność od wcześniejszych planów

Plan 08 nie może zastąpić planu 04. Najpierw musimy znać legalne bounds,
dozwolone zmiany rozmiaru, relacje do flow i sposób ponownego układania
tekstu. Nie można oceniać głębokości wyszukiwania, jeśli kandydat nie opisuje
pełnego i poprawnego planu.

Nie zaczynamy też od optymalizacji wielu insertionów naraz. Najpierw jeden
element, potem grafika i cytat z różnymi ograniczeniami, a dopiero później
kilka elementów.

## Wymaga uzupełnienia po wykonaniu punktu X

- konkretna metoda przeszukiwania wymaga uzupełnienia po benchmarku planu 04
  i pierwszej wersji miękkich insertionów;
- dokładna weryfikacja kontrastu względem finalnego rastera PDF wymaga
  uzupełnienia po pomiarze renderowania częściowego;
- koszt dekodowania JPEG/SVG oraz częściowego renderowania PDF wymaga osobnego
  pomiaru przed dopuszczeniem tych ścieżek do screeningu;
- obowiązkowe wykonanie pomiaru kontrastu jest już podłączone dla PNG, ale
  waga `contrast_penalty` i neutralna polityka `unknown` nadal wymagają
  kalibracji na PDF-ach;
- decyzja, jak wycenić brak pomiaru (`unknown`) dla określonych typów tekstu,
  wymaga osobnego ustalenia produktu; nie jest to obecnie twarda bramka;
- wartości limitów wymagają uzupełnienia po pomiarze czasu na realnym
  editorialu;
- decyzja, czy dodatkowe punkty rzeczywiście odpowiadają poprawie wizualnej,
  wymaga porównania z ręczną oceną PDF-ów.
