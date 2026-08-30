# Pure layout planner prototype

Date: 2026-08-26

## Cel

Sprawdzić, czy można zaplanować wielostronicowy skład bez HTML, PDF i
przeglądarki: mierzyć tekst w ramach, dzielić go wyłącznie na pełne słowa/linie,
a następnie przenosić remainder do następnej ramy.

Uruchomienie:

```text
npm run prototype:pure-planner -- --out /tmp/report-baby-pure-layout-planner-v5
```

Generator: `server/scripts/pure-layout-planner-prototype.mjs`.

Geometria i profil fontu: `server/templates/pure-layout-prototype.yml`.

## Strategie

| Strategia | Zachowanie |
|---|---|
| `atomic` | paragraf, heading, cluster i obraz są nierozdzielne |
| `line-flow` | paragraf dzieli się tylko między pełnymi liniami; słowa pozostają całe |
| `line-flow-scale-images` | jak wyżej, ale grafika może zostać zmniejszona |
| `line-flow-defer-images` | jak wyżej, ale grafika może przejść do następnej ramy |

## Wyniki

- `line-flow` poprawnie przenosi tekst przez kolumny i strony bez łamania słów;
- `atomic` zachowuje klastry, ale odrzuca długie paragrafy i marnuje miejsce;
- `cluster` utrzymuje heading + intro razem, rozwiązując samotny nagłówek;
- `float-right` tworzy exclusion box, więc kolejne linie dostają mniejszą
  szerokość zamiast wjechać pod grafikę;
- `scale` jest skuteczną, ale potencjalnie niepożądaną degradacją grafiki;
- `reject` jest bezpieczniejszy dla assetów editorialnych;
- słowo/URL szersze od ramy wymaga jawnego `unbreakable-token` diagnostic — sama
  paginacja nie może tego naprawić.

## Istotne odkrycie

To nie powinien być algorytm „blok mieści się / nie mieści się”. Potrzebujemy
operacji:

```text
measure(block, frame, state) -> line fragments + consumed height
split(block, available) -> prefix + remainder
place(block, frame) -> placement | diagnostic
```

`remainder` jest podstawowym stanem planera. Dzięki temu druga strona nie
„przelicza tekstu od nowa”, tylko dostaje dokładnie niezużyty fragment i układa
go od początku swojej ramy.

## Granica prototypu

Metrics adapter jest deterministyczną aproksymacją profilu `Liberation Sans`.
Nie jest jeszcze shaperem obsługującym kerning, ligatury, bidi, RTL ani realne
fonty brandowe. To jest celowy seam: planner można zachować, a adapter później
podmienić na Pango/HarfBuzz/FreeType albo pomiar backendu PDF.

Nie łamiemy słów w pierwszej wersji. Jeśli pojedynczy token nie mieści się w
ramie, wynik musi zawierać odrzucenie/overflow diagnostic, a nie ciche
przesunięcie lub deformację tekstu.

## Decyzja

Pure planner rozwiązuje kilka problemów, których nie rozwiązał sam Vivliostyle:

1. planner kontroluje kolejność ramek i dokładny remainder;
2. keep rules są częścią decyzji, nie przypadkowym efektem CSS;
3. grafika może zarezerwować exclusion zanim zmierzone zostaną kolejne linie;
4. overflow ma jawny policy (`reject`, `scale`, `next-frame`);
5. backend renderujący staje się wykonawcą planu i źródłem walidacji, nie jedynym
   miejscem podejmowania decyzji.

Następny krok powinien polegać na podmianie aproksymacyjnego adaptera metryk na
rzeczywiste pomiary fontów, bez zmiany logiki `remainder`, frame cursor i
evaluatorów.

Artefakty bieżącego runu:

- [raport tekstowy](/tmp/report-baby-pure-layout-planner-v5/report.md)
- [wyniki JSON](/tmp/report-baby-pure-layout-planner-v5/results.json)
- [trace JSON](/tmp/report-baby-pure-layout-planner-v5/trace.json)
