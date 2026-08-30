# Document layout engine landscape

Date: 2026-08-25

## Cel

Sprawdzić, jaki model jest potrzebny, aby Report Baby mógł obsługiwać
wydawnicze szablony z wieloma i nierównymi kolumnami, blokami span, grafikami
opływanymi lub wyłączającymi fragment tekstu, paginacją oraz różnymi trybami
pisma. Sprawdzić też, czy obecny renderer powinien być dalej rozwijany, czy
lepiej oprzeć warstwę layoutu na innym silniku.

## Najważniejsze rozróżnienia

`direction`, `writing-mode` i `text-orientation` opisują różne rzeczy:

- `direction` opisuje kierunek bidi i inline-start/inline-end;
- `writing-mode` wybiera orientację osi inline/block: `horizontal-tb`,
  `vertical-rl` albo `vertical-lr`;
- `text-orientation` opisuje obrót/orientację znaków w pionowym składzie.

`vertical-lr` nie oznacza pisania od dołu do góry. Wartości pionowe nadal
prowadzą linie od góry do dołu; różnią się kierunkiem progresji kolumn. `vertical-rl`
jest typowy dla japońskiego składu pionowego, a `vertical-lr` między innymi dla
skryptów mongolskiego i mandżurskiego. Japoński wymaga dodatkowo obsługi tekstu
mieszanego, orientacji znaków i reguł typu tate-chu-yoko.

Źródła: [CSS Writing Modes Level 4](https://www.w3.org/TR/css-writing-modes-4/),
[W3C: Vertical Text](https://www.w3.org/International/articles/vertical-text/),
[Pango bidi and vertical text](https://docs.gtk.org/Pango/pango_bidi.html).

## Co wynika ze standardów

CSS rozdziela przepływ treści od fragmentacji. Fragmentacja dzieli jeden flow
na strony, kolumny lub regiony i posiada jawne reguły `break-before`,
`break-after`, `break-inside`, widows/orphans oraz fallback, gdy wszystkich
ograniczeń nie da się spełnić. Multi-column rozróżnia przepływ sekwencyjny i
balansowanie kolumn oraz pozwala na element rozpięty na wszystkich kolumnach.

Page floats opisują osobny mechanizm umieszczania elementów względem strony,
kolumny lub regionu, z `clear` i kierunkami logicznymi. To jest bliższy model
dla grafik redakcyjnych niż traktowanie każdej grafiki jako zwykłego bloku.

Źródła: [CSS Fragmentation Level 3](https://www.w3.org/TR/css-break-3/),
[CSS Multi-column Layout Level 1](https://www.w3.org/TR/css-multicol-1/),
[CSS Page Floats](https://www.w3.org/TR/css-page-floats-3/).

## Stan obecnego Report Baby

Obecny kontrakt ma kierunek ograniczony do `ltr`/`rtl`, geometryczne ramki w
układzie fizycznym oraz kolumny opisane liczbą, gutterem i szerokościami.
`resolvePlan` lustrzanie odbija ramki dla RTL. `page-geometry.ts` buduje
segmenty przez fizyczne `x`, `top`, `width`, `bottom`, a rezerwowane pasy i ramki
bloków są rozwiązywane w modelu poziomych współrzędnych.

To wystarcza dla obecnych szablonów, ale nie jest jeszcze seamem dla pionowego
pisma, logicznych osi, fragmentacji ani wykluczeń. Dodanie kolejnych flag do
obecnego kontraktu nie rozwiąże problemu: trzeba wprowadzić model kontekstu
pisma i przepływu, a dopiero potem adapter do PDF.

## Porównanie kandydatów

### Obecny własny composer

Zaletą jest kontrola nad JSON/YAML, planem wynikowym, diagnostyką i obecnymi
artefaktami. Wadą jest konieczność samodzielnego rozwiązania kształtowania
tekstu, bidi, pionowych osi, łamania, kolumn, floatów i stabilizacji po zmianie
rozmiaru bloku. Rozszerzanie go o kolejne wyjątki byłoby rozwijaniem zbyt
 płytkiego modułu.

### Vivliostyle

To najbardziej bezpośredni kandydat do eksperymentu dla ścieżki editorialnej:
HTML/CSS, PDF/EPUB, CSS Paged Media, Fragmentation, Multi-column, Page Floats,
Writing Modes i Logical Properties są częścią opisywanego ekosystemu. Szablon
może być pakietem CSS/theme, co daje użytkownikowi realny mechanizm tworzenia
nowych layoutów.

Koszty to zmiana języka szablonów, kontrola deterministyczności fontów i
renderowania, integracja z normalizowanym AST, uzyskanie pełnego planu i
diagnostyki oraz osobna integracja z artefaktami, które nie są stroną
editorialną.

Źródła: [Vivliostyle documentation](https://docs.vivliostyle.org/en/),
[supported CSS features](https://docs.vivliostyle.org/publications/reference-en/index.html),
[themes and CSS](https://github.com/vivliostyle/vivliostyle-cli/blob/main/docs/themes-and-css.md).

### Pango + HarfBuzz

Pango i HarfBuzz są dobrym fundamentem dla kształtowania tekstu, bidi,
orientacji pionowej, fontów i glifów. Nie są jednak kompletnym composerem
dokumentu: kolumny, fragmentacja, grafiki, wykluczenia, paginacja i wybór
wariantu layoutu pozostają po stronie Report Baby.

To sensowna droga, jeśli plan ma pozostać własnym, strukturalnym planem
renderowania, ale nie jest to gotowy zamiennik całego silnika.

Źródła: [Pango bidi and vertical text](https://docs.gtk.org/Pango/pango_bidi.html),
[Pango gravity](https://docs.gtk.org/Pango/enum.Gravity.html),
[HarfBuzz](https://github.com/harfbuzz/harfbuzz).

### Paged.js i WeasyPrint

Oba należą do świata HTML/CSS paged media, więc są warte testu porównawczego,
ale nie należy z samego faktu obsługi CSS wywnioskować kompletnej obsługi
pionowego składu, floatów i wszystkich przypadków fragmentacji. Paged.js ma
udokumentowane przypadki brzegowe związane z `break-inside` i łamaniem tabel;
WeasyPrint wymaga osobnego potwierdzenia zakresu writing modes przed wyborem.

### TeX/pTeX i Typst

pTeX jest dojrzałym kandydatem dla wysokiej jakości japońskiego składu
pionowego, ale ma koszt integracji, inny model autorstwa i trudniejszą wymianę
planów/diagnostyki z obecnym pipeline'em. Typst jest interesujący jako język
layoutu, lecz jego obsługa vertical writing była opisana jako RFC, więc nie
powinien być obecnie traktowany jako gotowy silnik dla wymagań
`vertical-rl`/`vertical-lr`.

Źródła: [pTeX manual](https://github.com/texjporg/ptex-manual),
[pTeX guide](https://mirrors.ctan.org/info/ptex-manual/ptex-guide-en.pdf),
[Typst vertical writing RFC](https://github.com/typst/typst/issues/5908).

## Wniosek badawczy

Nie ma podstaw, aby już teraz zastąpić cały Report Baby jednym silnikiem.
Najrozsądniejszy eksperyment to porównać:

1. Vivliostyle jako kompletny composer editorialny;
2. własny planer z Pango/HarfBuzz jako warstwą tekstową;
3. obecny renderer jako baseline kompatybilności.

Porównanie musi używać tego samego normalizowanego dokumentu, brandu, fontów i
macierzy przypadków. Sukces to nie tylko podobny PDF: potrzebne są także
czytelne błędy braku miejsca, stabilność powtórnego renderowania, poprawna
warstwa tekstowa, brak przecieków między trackami i możliwość wskazania, co
agent ma zmienić, gdy plan jest niewykonalny.

## Konsekwencja dla planu architektury

Docelowy kontrakt powinien mieć osobne pojęcia:

- `WritingContext`: writing mode, direction, text orientation, locale/script;
- logiczne osie inline/block oraz ich mapowanie na fizyczną stronę;
- named flow i fragmentainers/tracks z rozmiarem min/preferred/max;
- relacje elementów: normal flow, span, fixed, anchored, float, exclusion,
  decoration;
- reguły break/keep/widows/orphans i jawna kolejność rozluźniania ograniczeń;
- wynikowy plan fragmentów, glifów, warstw i diagnostyki.

Implementację należy prowadzić od macierzy fixture'ów i kontraktu
wykonalności, przez mały spike silników, dopiero potem przez wybór ścieżki
produkcyjnej. Presety typu „2 kolumny”, „3 kolumny”, „nierówna kolumna” czy
„intro nad kolumnami” powinny być złożeniem tych prymitywów, nie osobnymi
hardkodowanymi rendererami.
