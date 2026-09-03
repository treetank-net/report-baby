# Plan 08 — głębokość wyszukiwania kandydatów

Status: eksperyment screeningu i renderer-neutralny sampler wykonane;
integracja z asset adapterem i evaluatorem oczekuje na osobny krok
implementacyjny

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
  wraz ze statusem `pass`, `fail` albo `unknown` i kosztem pomiaru;
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
kandydatów bliskich remisu albo progu. Jeżeli dokładna weryfikacja odrzuci
zwycięzcę, wybieramy następnego legalnego kandydata. `unknown` nie jest
automatycznym `pass`: brak informacji o przezroczystości, cropie albo tle musi
być widoczny i mieć osobną decyzję polityki.

Progi 4.5:1 dla zwykłego tekstu i 3:1 dla dużego tekstu są punktem wyjścia z
WCAG 2.2, a nie dowodem pełnej zgodności PDF-a. Dla znanego jednolitego tła
wynik poniżej progu może być twardym odrzuceniem. Dla obrazu screening może
odrzucić zaobserwowaną porażkę, ale pozytywny wynik pozostaje tymczasowy do
chwili dokładnego sprawdzenia. Ozdobne glyphy i logo nie powinny automatycznie
dostać twardej reguły tekstu głównego.

Pierwszy benchmark powinien mierzyć: czas dekodowania i czas próbkowania,
trafienia cache, rozbieżność między screeningiem a wynikiem dokładnym oraz
przypadek, w którym przesunięcie tego samego tekstu nad obrazem zmienia status
kontrastu. Dopiero po tym można dodać wagi kontrastu do `composition_score`.

### Wynik pierwszego eksperymentu

Prototyp w
[`server/scripts/test-contrast-evaluation-prototype.mjs`](../../server/scripts/test-contrast-evaluation-prototype.mjs)
przeszedł jako element composition gate. Na kontrolowanym obrazie z lokalnym
ciemnym pasem przetestowano 8 pozycji tekstu:

- obraz został przygotowany raz, a 7 kolejnych kandydatów skorzystało z cache;
- screening `6x6` zużył 288 próbek, podczas gdy referencyjne przejście po
  wszystkich pikselach zużyło 1920 próbek;
- globalna średnia dała fałszywy `pass` z wynikiem `5.28:1` dla pozycji, która
  zawierała czarny fragment o rzeczywistym kontraście `1:1`;
- lokalny screening wykrył oba kandydaty z czarnym fragmentem jako `fail` i
  zgodził się z referencyjnym przejściem dla wszystkich pozycji;
- znane tło pod przezroczystym PNG dało wynik, a brak koloru pod spodem dał
  `unknown`.

To potwierdza kierunek taniego screeningu, ale jeszcze nie dowodzi poprawności
dla wszystkich formatów wejściowych ani zgodności z finalnym rasterem PDF-a.
Fixture jest syntetyczny, a referencja skanuje region prostokątny, nie dokładną
maskę glifów. Przed produkcyjnym podłączeniem trzeba sprawdzić realny asset po
rzeczywistym `contain`/cropie oraz przypadek, w którym screening przepuszcza,
a dokładniejszy pomiar odrzuca.

Eksperyment ujawnił też rozbieżność do usunięcia: istniejące funkcje kontrastu
w `brand-context.ts` i `visual-qa.mjs` używają granicy sRGB `0.03928`, podczas
gdy aktualna definicja WCAG podaje `0.04045`. Przed użyciem nowej miary trzeba
ujednolicić wzór i objąć zmianę testem kontraktu, aby evaluator, visual QA i
screening nie wydawały różnych werdyktów dla tego samego koloru.

## Następny krok po eksperymencie

Renderer-neutralny sampler został już dodany w
[`server/src/composition/contrast.ts`](../../server/src/composition/contrast.ts)
i sprawdzony na publicznym composition seam. Nie dekoduje on obrazów i nie
zna PDF-a — przyjmuje przygotowany raster oraz region w jego współrzędnych.

Następnie trzeba podłączyć go do adaptera assetów, zachowując evaluator bez
zależności od dekodera pikseli, a potem dostarczyć do istniejącego wyniku ewaluacji
status, najgorszy pomiar i obszar próbki, bez dodawania kontrastu do łamania
linii. Pierwsza wersja produkcyjna powinna obsługiwać znane kolory i
znormalizowane obrazy PNG; JPEG/SVG i nieznane tła powinny jawnie zwracać
`unknown`, dopóki nie będą miały bezpiecznego dekodowania.

Przed tym podłączeniem należy ujednolicić granicę sRGB w istniejących
implementacjach kontrastu i potwierdzić, że wynik dla granic testowych jest
zgodny z WCAG.

Dopiero po tym dodajemy test na prawdziwym obrazie, test mapowania cropu,
test fallbacku po dokładnym odrzuceniu zwycięzcy oraz benchmark dla 20+
kandydatów. Wagi scoringu pozostają niezmienione do czasu porównania wyników
z ręczną oceną PDF-ów.

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
- metoda i koszt weryfikacji kontrastu wymagają uzupełnienia po benchmarku
  próbek obrazu i dokładnego renderowania;
- decyzja, czy `unknown` ma blokować publikację dla określonych typów tekstu,
  wymaga osobnego ustalenia produktu;
- wartości limitów wymagają uzupełnienia po pomiarze czasu na realnym
  editorialu;
- decyzja, czy dodatkowe punkty rzeczywiście odpowiadają poprawie wizualnej,
  wymaga porównania z ręczną oceną PDF-ów.
