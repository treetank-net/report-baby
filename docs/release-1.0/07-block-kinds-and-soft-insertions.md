# Plan 07 — block kinds i miękkie insertiony

Status: wykonany dla zakresu release 1.0. Mapa block kinds, ścieżka authored
graphics, ruchome insertiony, renderer-neutralne inline runs oraz fallback
glyphów działają. Każdy obsługiwany block kind może być przypisany do jawnego
`insertionSlots` przez ograniczenia slotu; planner mierzy i materializuje tekst,
tabele oraz atomic blocks (image, metric, chart) jako jedną warstwę obstacle.
Pozostaje jedynie rozszerzanie tego kontraktu o nowe rodzaje bloków poza obecnym
modelem.

Aktualny zakres nie traktuje `quote` jako ścieżki legacy w `main`: quote jest
tekstem dostarczanym przez nazwany, nie-main flow z zadeklarowanymi
`insertionSlots`. `main` nie może ani zawierać quote, ani deklarować
`insertionSlots`; te reguły są sprawdzane w preflight i przez evaluator.
Pozostałe block kinds mogą być insertionami, jeżeli slot jawnie dopuszcza ich
rolę/rodzaj. Pozycje insertionów są ograniczane przez jawne ruchome bounds
polityki (slot jest punktem wyjścia i właścicielem warstwy). Wspólna walidacja ram insertionów i grafik znajduje się w
`composition/layout/movable-placement-validation.ts`, a ich pomiar i
materializacja korzystają z tych samych capability seams co zwykły flow.

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

Grafiki, cytaty, glyphy, tabele i atomic blocks mają jednolitą ścieżkę w
composition. `CompositionGraphic.size` wyznacza mierzony box, a
`movableGraphicBounds` używa tego samego coarse/refinement search co
`movableInsertionBounds`. Insertion block jest mierzony przez capability
`measureBlock` albo `measureTable`, dostaje placement właściwy dla rodzaju i
zawsze rejestruje prostokątny obstacle dla głównego flow.

Public input accepts authored graphics through `graphics`; the input adapter
maps them into the same `CompositionGraphic` model used by internal callers.
The generic insertion path now applies the same policy to every currently
supported content kind: the slot filters the block, the shared capability
measures it, and the placement layer materializes the corresponding text,
table, or atomic placement before ordinary flow text is laid out.

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

Obecny przepływ zachowuje AST i przenosi go do renderer-neutralnych styled runs:

```text
markdown-normalizer
  → NormalizedContentNode[]
  → composition/adapters/input.ts
  → CompositionBlock.content + inlineRuns + plain block.text
  → text-layout przenosi zakres runów do CompositionLine
  → adapter PDF mierzy i renderuje runy osobnymi stylami
```

Starszy parser regexowy `server/src/content/text-runs.ts` został usunięty po
potwierdzeniu, że nie ma importów produkcyjnych ani testowych. Jego zakres jest
teraz rozdzielony: AST → `CompositionInlineRun` należy do adaptera inputu,
łamanie zakresów do `composition/text`, a odczyt cmap i wybór fallbacku do
adaptera PDF. Dzięki temu nie utrzymujemy dwóch interpretacji tego samego
tekstu.

Kontrakt composition używa `CompositionInlineRun`: run zawiera tekst oraz
semantyczne markery `strong`, `emphasis` i `link`. Adapter inputu buduje je
bezpośrednio z `NormalizedContentNode[]`; `wrapBlock` przenosi odpowiedni
zakres runów do `CompositionLine`, a adapter PDF wybiera wagę/krój dla każdego
runu. Tekst pozostaje dzięki temu w selekcjonowalnej warstwie PDF. Brak osobnego
kroju italic jest rozwiązywany przez jawny fallback do dostępnego stylu upright
i ostrzeżenie. Brak glyphu w foncie marki jest rozwiązywany per run (a w tabeli
per komórka) przez zarejestrowany fallback font oraz ostrzeżenie z kodem
diagnostycznym. Samo zachowanie AST nie jest już jedyną obsługą tego przypadku.

Regresja `inline-markup-report` przechodzi: PDF używa osobnych zasobów fontu
dla marki, fallbacku i bolda, a analiza strumieni potwierdza siedem linii z
przełączeniem fontu. `pdftotext` zwraca znaki `✓` oraz tekst tabel bez literalnych
delimiterów markdown. Brak kroju italic nie kończy planowania — jest raportowany
jako ostrzeżenie i rysowany upright.

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

## Dalsze rozszerzenia po release 1.0

- Nowe block kinds wymagają osobnego capability seamu (pomiaru i placementu);
  nie są automatycznie uznawane za insertiony.
- Dalsza kalibracja zasad „soft” należy do punktu 08 i kolejnych benchmarków,
  nie do deklaracji slotów.
- Osobne testy rendererów mogą rozszerzyć obsługę formatów obrazów, ale nie
  powinny przenosić dekodowania do planera.

## Poza zakresem release’u bazowego

Nowe block kinds spoza obecnego modelu wymagają osobnych capability seams i nie
są automatycznie uznawane za insertiony. Nie dodajemy globalnego solvera ani
nie pozwalamy na insertion sloty w `main`.
