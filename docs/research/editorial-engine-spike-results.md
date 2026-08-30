# Editorial engine spike — Vivliostyle

Date: 2026-08-26

## Cel

Uruchomić tę samą minimalną macierz HTML/CSS w kompletnym silniku paged-media
i sprawdzić, czy model z researchu odpowiada rzeczywistemu zachowaniu:
reserved slot, float/exclusion, spanner, continuation, page float oraz
`vertical-rl`.

Fixture generator: `server/scripts/editorial-engine-spike.mjs`.

## Uruchomienie

```text
npm run prototype:engine-spike -- --render --out /tmp/report-baby-editorial-engine-spike/vivliostyle-run-v2
```

Backend: `@vivliostyle/cli@11.2.0`; wygenerowany PDF raportuje
`Vivliostyle.js 2.45.0` i Chrome `152.0.7977.54`. Prince nie był dostępny
lokalnie, więc nie został udawanie porównany.

Artefakty bieżącego runu są w:

`/tmp/report-baby-editorial-engine-spike/vivliostyle-run-v2/`

Manifest i źródła HTML są w tym katalogu, a PDF/PNG w
`vivliostyle/<case>/`.

## Wynik macierzy

| Case | PDF pages | Text extraction ratio | Ocena | Wniosek |
|---|---:|---:|---|---|
| `slot` | 3 | 0.998 | `needs-policy` | CSS Grid rozdzielił lead i secondary na różne strony; nie jest to dowód poprawnego reserved slotu |
| `float` | 2 | 0.999 | `pass-basic` | Elipsa zmienia opływanie, a późniejszy tekst jest kontynuowany |
| `span` | 2 | 0.999 | `pass-basic` | `column-span: all` tworzy osobny wiersz kolumn i nie zostawia tekstu obok spannera |
| `continuation` | 4 | 1.000 | `pass-basic` | Flow przechodzi przez kolumny i strony bez utraty tekstu |
| `pageFloat` | 3 | 0.999 | `needs-policy` | Page float działa, ale duża pusta przestrzeń wymaga reguły jakości/pozycjonowania |
| `vertical` | 1 | 1.208 | `needs-verification` | `vertical-rl` renderuje się wizualnie; ekstrakcja PDF nie jest porównywalna z poziomym tekstem |

Extraction ratio jest kontrolą kompletności, nie pełnym dowodem kolejności
źródłowej. Dla `vertical` trzeba sprawdzić kolejność glifów, mieszanie CJK/Latin
i semantyczny reading order osobnym narzędziem.

## Najważniejsze obserwacje

### Reserved slot

Najważniejszy negatywny wynik: zwykły CSS Grid nie dał oczekiwanego modelu
„lead tekstu i obraz w secondary na tej samej stronie”. Lead został
rozfragmentowany na stronę 1, a drugi element gridu z obrazem zaczął się na
stronie 2. To nie jest błąd kompletności tekstu; to błąd spełnienia relacji
layoutowej.

Wniosek: reserved slot musi być wspierany jako prymityw page/region layoutu
albo przez jawny planner, a nie wynikać przypadkiem z `display: grid`.

### Float i spanner

Vivliostyle potwierdził, że CSS jest użytecznym językiem opisu dla:

- eliptycznego opływania przez `shape-outside`/`clip-path`;
- spannera przez `column-span: all`;
- zwykłej kontynuacji przez multicol i paginację.

To są dobre kandydatury do delegowania do backendu, pod warunkiem że Report Baby
potrafi odczytać wynik i sprawdzić go własnym evaluatorem.

### Page float

`float: block-start` z `float-reference: page` został narysowany i tekst nie
wchodzi w jego obszar, ale zostaje dużo wolnego miejsca. Silnik spełnił
geometrię, lecz nie rozstrzygnął za nas, czy taki skład jest editorialnie
akceptowalny. Potrzebujemy osobnej polityki: minimalne wypełnienie, defer,
alternatywny master albo `needs-decision`.

## Decyzja

Vivliostyle przechodzi jako pierwszy open-source backend do dalszego spike’a
editorialnego. Nie przechodzi jeszcze jako bezpośredni zamiennik własnego
planera, ponieważ:

1. CSS Grid nie rozwiązuje naszego modelu niezależnych strumieni i reserved
   slotów;
2. legalny geometrycznie page float może nadal być złą kompozycją;
3. PDF nie daje sam z siebie stabilnego planner trace’a ani MCP diagnostics;
4. writing mode wymaga osobnej walidacji reading order i font shaping.

## Następny eksperyment

Zbudować drugi fixture slotu bez CSS Grid:

1. named flow/region albo page float z jawnie przypisanym `float-reference`;
2. osobny article flow i sidebar flow;
3. keep graph dla `heading → image/caption → paragraph prefix`;
4. evaluator geometrii, kolejności źródeł i jakości wypełnienia;
5. ten sam fixture uruchomić w Vivliostyle i — po zapewnieniu licencji — w
   Prince jako reference backend.

Źródła modelu: [CSS Fragmentation](https://www.w3.org/TR/css-break-3/),
[CSS Multi-column](https://www.w3.org/TR/css-multicol-1/),
[CSS Page Floats](https://www.w3.org/TR/css-page-floats-3/),
[Vivliostyle supported features](https://vivliostyle.github.io/vivliostyle.js/docs/en/supported-features.html).
