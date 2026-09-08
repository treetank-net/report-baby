# Plan 07 — block kinds i miękkie insertiony

Status: częściowo wykonany; mapa block kinds, ścieżka authored graphics oraz
ograniczone ruchome insertiony działają. Wspólna polityka soft insertionów i
pełne zachowanie inline AST/runs pozostają otwarte.

Aktualny zakres nie traktuje `quote` jako ścieżki legacy w `main`: quote jest
tekstem dostarczanym przez nazwany, nie-main flow z zadeklarowanymi
`insertionSlots`. `main` nie może ani zawierać quote, ani deklarować
`insertionSlots`; te reguły są sprawdzane w preflight i przez evaluator.
Wspólna walidacja ram insertionów i grafik znajduje się w
`composition/layout/movable-placement-validation.ts`, ale nie oznacza jeszcze,
że każdy block kind może być przemieszczany.

## Cel

Ten sam model flow i placementów ma umożliwić dodawanie treści takich jak:

- cytat;
- grafika;
- KPI;
- box z metrykami;
- wykres;
- tabela lub inny block kind.

Element może być umieszczony poza głównym flow, ale jego pozycja i wymiary mają
wpływać na dostępne miejsce dla tekstu. Cytat nie powinien być na stałe
wbudowany w szablon jako „zawsze trzecia pozycja na stronie”.

## Stan obecny

Grafiki, cytaty, glyphy, tabele i atomic blocks mają już częściowe ścieżki w
composition. Pierwszy slice soft placementu jest teraz wykonany dla
autorskiej grafiki: `CompositionGraphic.size` wyznacza mierzony box, a
`movableGraphicBounds` używa tego samego coarse/refinement search co quote.
Nie jest to jeszcze jednolity mechanizm dla image-blocków, KPI i wykresów.

Public input accepts authored graphics through `graphics`; the input adapter
maps them into the same `CompositionGraphic` model used by internal callers.
This completes declaration and normalization, but not yet the general policy
that makes every image, KPI, or chart movable.

Kanoniczna mapa obecnych rodzajów bloków znajduje się w
[`docs/composition/block-kinds.md`](../composition/block-kinds.md). Opisuje
ona osobno `heading`, `paragraph`, `list-item`, `image`, `table`, `metric` i
`chart`, a także wyjaśnia, dlaczego quote jest rolą tekstu, a glyph nie jest
blokiem treści. Test dokumentacji sprawdza, że każdy kind z modelu jest w tej
mapie wymieniony.

Istnieje również starszy plan miękkich insertionów:
[`soft-insertion-placement-plan.md`](../research/soft-insertion-placement-plan.md).
Należy traktować go jako materiał badawczy do konfrontacji z planami 02–04,
nie jako drugie źródło prawdy.

## Audyt inline AST/runs — 2026-09-08

Obecny przepływ zachowuje AST, ale jeszcze go nie renderuje jako styled runs:

```text
markdown-normalizer
  → NormalizedContentNode[]
  → composition/adapters/input.ts
  → CompositionBlock.content + plain block.text
  → text-layout i adapter PDF używają block.text
```

`server/src/content/text-runs.ts` zawiera starszy parser regexowy, pomiar,
fallback fontów i łamanie styled runs, ale nie ma importów z produkcyjnego
`server/src` ani z testowych entrypointów i nie trafia do bundla przez bieżącą
ścieżkę composition. Jest więc kandydatem do usunięcia, nie dowodem działającej
obsługi inline. Nie usuwamy go jeszcze: najpierw trzeba wybrać kontrakt punktu
7 — albo przenieść `NormalizedContentNode[]` do renderer-neutralnego modelu
linii i zachować style, albo formalnie zakończyć starszą ścieżkę runs wraz z jej
testami. Mieszanie obu parserów utrwalałoby dwie różne interpretacje tego samego
tekstu.

## Kroki

1. Dla każdego obecnego block kind opisać:
   - dane wejściowe;
   - sposób pomiaru;
   - wymagane wymiary;
   - placement;
   - kolizje;
   - renderowanie;
   - ocenę legalności i jakości.
2. Ustalić, które elementy są częścią flow, a które są wtrąceniem wpływającym
   na flow.
3. Dla cytatu i grafiki zdefiniować ograniczoną listę dozwolonych miejsc,
   zamiast przeszukiwania dowolnej strony.
4. Wyliczać wymiary elementu przed planowaniem tekstu, jeżeli jego box wpływa
   na kolizje.
5. Przepuścić element przez tę samą pętlę legalność → score → wybór, co tekst.
6. Dodać KPI i wykres dopiero po przejściu grafiki przez pełną ścieżkę.
7. Utrzymać glyphy jako elementy renderowania zależne od właściciela, bez
   mieszania ich z boxem tekstu, chyba że faktycznie uczestniczą w kolizji.
8. Domknąć regresję `inline-markup-report`: zachować strukturę runs podczas
   mapowania do composition dla akapitów, list i komórek tabeli; określić,
   które glyphy wymagają fallbacku oraz jakie ostrzeżenie ma powstać, gdy
   fallbacku nie ma. Test ma wykazać zarówno wygląd bold/italic, jak i brak
   utraty znaków w warstwie tekstowej.

## Kryteria ukończenia

- nowy block kind ma jedno jawne mapowanie od inputu do renderera;
- jego wymiary są dostępne przed decyzją o kolizjach;
- można zdefiniować preferowane miejsca bez hardcodowania strony 2/3 lub
  pozycji 1/4, 2/4, 3/4;
- legalność i score rozróżniają „nie można” od „można, ale gorzej wygląda”;
- realny editorial z inną grafiką, cytatami i treścią przechodzi pełny gate.

## Wymaga uzupełnienia po wykonaniu punktu X

- Wspólny kontrakt wymiarów wymaga uzupełnienia po punkcie 1, ponieważ obecne
  block kinds mają różne capability seams.
- Zasady „soft” wymagają uzupełnienia po planie 04: dopiero działająca pętla
  pokaże, jakie alternatywy da się bezpiecznie przeszukiwać.
- Wsparcie KPI/wykresów wymaga uzupełnienia po przejściu grafiki przez punkty
  3–5; nie zakładamy, że ich pomiar i kolizje są identyczne.

## Poza zakresem release’u bazowego

Pełna generalizacja wszystkich insertionów może pozostać kolejnym etapem, jeśli
wyniki planu 04 pokażą zbyt duży koszt lub niejednoznaczność geometrii.
