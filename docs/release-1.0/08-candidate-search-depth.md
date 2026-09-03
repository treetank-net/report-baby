# Plan 08 — głębokość wyszukiwania kandydatów

Status: zaplanowane po ustabilizowaniu planów 01–07

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
- wartości limitów wymagają uzupełnienia po pomiarze czasu na realnym
  editorialu;
- decyzja, czy dodatkowe punkty rzeczywiście odpowiadają poprawie wizualnej,
  wymaga porównania z ręczną oceną PDF-ów.
