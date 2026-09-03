# Composition evaluator

## Odpowiedzialność

Evaluator przyjmuje kompletny `CompositionDocument` i `CompositionPlan`, po czym
zwraca `CompositionEvaluation`. Nie zmienia planu ani trace i nie renderuje
artefaktu.

Kod znajduje się w
[`composition/evaluator.ts`](../../server/src/composition/evaluator.ts), a
interfejs wyniku w
[`composition/engine.ts`](../../server/src/composition/engine.ts).

## Dwa niezależne pytania

1. Czy plan jest legalny?
2. Jeżeli jest legalny, który wariant wygląda lepiej?

Diagnostyka o severity `error` tworzy `hardViolations`. Plan z hard violation
albo residual content dostaje `-Infinity` i nie może wygrać przez wysoki score.
Dopiero plan bez takiego błędu otrzymuje score jakości.

Comparator stosuje kolejność:

```text
legalny plan > nielegalny plan
wyższy score > niższy score
remis → stabilna kolejność kandydatów
```

## Obecny score

Score jest deterministyczną heurystyką produktu Report Baby. Nie jest
standardem CSS/W3C, modelem statystycznym ani wynikiem kalibracji
psychowizualnej. Służy do uporządkowania legalnych alternatyw w ramach tego
samego template’u i konfiguracji.

```text
score = composition_score.base + suma(points składników)
```

Wszystkie wartości pochodzą z
[`render-config.yml`](../../server/templates/render-config.yml), a wszystkie
miary są liczone z geometrii planu:

| Kod | Co mierzy | Punktacja |
|---|---|---|
| `column-balance` | Średnią `min(lineCount) / max(lineCount)` na stronach z co najmniej dwiema kolumnami | dodatnia: `value * column_balance_weight` |
| `heading-following-line` | Nagłówki, po których w tym samym page/slot występuje tekst | dodatnia: liczba * `heading_following_line_bonus` |
| `paragraph-fragmentation` | Akapity rozdzielone między różne page/slot | ujemna: liczba * `paragraph_fragmentation_penalty` |
| `orphan-lines` | Jedno-liniowe fragmenty akapitu oddzielone przerwą co najmniej `orphan_min_gap_mm`, gdy przerwę wywołuje obstacle | ujemna: liczba * `orphan_penalty` |
| `insertion-spacing` | Nierówność paddingu wewnątrz insertionu, przerw przed/po oraz rozrzut przerw między strumieniami | ujemna: suma miar * odpowiednie wagi |

Przerwa może być legalna i wynikać z nieruszalnego obiektu, ale nadal jest
estetycznie niekorzystna. Jej przyczyna pozostaje w szczegółach ewaluacji i
decyzjach planera; nie zwalnia to z kary jakościowej.

## Pochodzenie wag

Pierwsza heurystyka powstała w prototypie debugowego composition score. Wagi
produkcyjne zostały następnie przeniesione do `render-config.yml` i rozszerzone
w kolejnych eksperymentach o fragmentację, spacing i orphan lines. Obecny zakres
`base: 100`, `column_balance_weight: 12`, bonus `4`, kary `3` i `4` oraz wagi
spacingu `1/1/1` jest ręcznie dobranym zakresem roboczym.

Testy pokazują, że składniki wpływają na wybór kandydatów, ale nie dowodzą
jeszcze, że proporcje są właściwe dla każdego artykułu. Kalibracja wymaga
większego korpusu i porównania z oceną człowieka. Nie należy zmieniać wagi bez
testu pokazującego, jaki wariant przez to wygrywa.

## Obserwowalność

`CompositionEvaluation.scoreBreakdown` zawiera wartość, punkty i szczegóły
każdego składnika. Trace engine’a zapisuje to dla każdego kandydata wraz z
placementami insertionów, statusem, liczbą hard violations i `reflowPasses`.
Rasterowy PDF/PNG jest osobnym testem artefaktu; evaluator nie wyciąga score’u
z obrazu.
