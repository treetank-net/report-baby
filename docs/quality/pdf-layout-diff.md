# Tekstowy diff layoutu PDF

`server/scripts/compare-pdf-layout.mjs` porównuje dwa lokalne PDF-y na podstawie
warstwy tekstowej `pdftotext -bbox-layout`. Jest to szybki filtr przed ręcznym
oglądaniem PNG; nie zastępuje wizualnego QA.

Uruchomienie z katalogu `server/`:

```sh
npm run compare:pdf-layout -- \
  --expected /tmp/legacy/report.pdf \
  --actual /tmp/composition/report.pdf \
  --out /tmp/report-layout-diff.txt \
  --json /tmp/report-layout-diff.json
```

Raport pokazuje:

- kompletność tekstu jako multizbiór tokenów (`missing`/`extra`),
- zmianę liczby stron,
- przeniesienie rozpoznanych linii między stronami oraz ich przesunięcie,
- zmianę obwiedni tekstu strony,
- duże luki między liniami w tym samym torze tekstu,
- przerwy przy krawędzi strony jako `info/page edge`, ponieważ header i footer
  mogą celowo tworzyć dużą pustą przestrzeń.

Porównanie ma trzy istotne wyniki:

- `identical` — nie wykryto różnicy w tekście ani w badanych odstępach,
- `changed` — treść jest ta sama, ale geometria lub rytm tekstu się zmieniły,
- `incomparable-content` — PDF-y mają inną treść; raport pokazuje tylko częściowe
  kotwice geometryczne.

Różnica względem legacy nie jest sama w sobie błędem. Jeżeli nowy layout jest
poprawniejszy, zostawiamy go i zapisujemy decyzję jako celową rozbieżność w
fixture/raporcie. Błąd jakościowy to dopiero brak treści, nieuzasadniona zmiana
strony, luka wewnątrz toru tekstu albo naruszenie reguł konkretnego szablonu.

Do automatycznej bramki można dodać `--fail-on-errors`. Progi i tolerancje są
czytane z `templates/render-config.yml` (`quality.layout_diff`); narzędzie nie
definiuje własnych progów layoutowych w kodzie.

## Ciągły flow i przeszkody

Test `server/scripts/test-text-composition-engine.mjs` zawiera syntetyczny
fixture z numerowanymi słowami oraz pełnoszeroką przeszkodą na każdej stronie.
Wymusza on i sprawdza cztery reguły:

- tekst przechodzi w dół tej samej kolumny przed przejściem do prawej,
- przeszkoda usuwa tylko swój pas dostępnej powierzchni; nie tworzy osobnego
  toru ani nie przestawia kolejności flow,
- wszystkie słowa trafiają do planu dokładnie raz i pozostają w kolejności,
- żadna linia nie wchodzi w obszar przeszkody.

Test `server/scripts/test-editorial-numbered-flow.mjs` dodatkowo sprawdza
semantyczny slot intro, kompletność numerowanego PDF-a, brak pustej kolumny
przed kontynuacją oraz zapisuje plansze debugowe. Na planszy jasny obrys oznacza
pojemność slotu, wypełniony pas oznacza faktycznie zaplanowaną linię, a
pomarańczowy prostokąt oznacza aktywną przeszkodę; otwarty slot cytatu nie jest
już wizualizowany jako zajęta powierzchnia.

## Showcase parity audit

Weryfikacja bieżącego bundla na wszystkich fixture'ach `examples/brand-showcase`
wykazała:

- wszystkie raporty generują się bez odrzuconego planu; zwykłe raporty mają po
  jednej stronie, a `flux/pagination-report` ma trzy strony;
- slajdy PDF/PNG/PPTX korzystają z tego samego planu; pikselowy diff PNG wynosi
  zero dla wszystkich slajdów poza celową zmianą koloru tytułu Pyrus;
- pagination zachowuje treść akapitu na stronie kontynuacji i dlatego rozkłada
  tabelę inaczej niż dawny renderer. To jest celowa poprawa przepływu, nie
  utrata treści;
- rasteryzowane wykresy mają niewidzialną, zaznaczalną warstwę tytułu i
  podtytułu. Te tokeny pojawiają się jako `extra` względem starego PDF-u,
  ponieważ stary renderer nie miał tej warstwy; nie są to dodatkowe widoczne
  elementy;
- różnice rzędu kilku milimetrów w rytmie kart i sekcji są oceniane wizualnie,
  a nie automatycznie kasowane na rzecz starego położenia. Każda taka decyzja
  musi zostać opisana jako świadoma rozbieżność albo naprawiona w template'cie.

Artefakty showcase można odtworzyć poleceniem:

```sh
node scripts/render-brand-showcase.js \
  --brand-root examples/brand-showcase/brands \
  --out /tmp/report-baby-brand-showcase \
  --formats pdf,png,pptx
```
### Raster ink occupancy

The editorial numbered-flow gate also rasterizes the final PDF with
`pdftoppm` and checks the rendered pixels inside every planned main-flow line
and every non-empty text segment. This is deliberately separate from
`pdftotext`: a plan can contain a line that the renderer failed to paint, and
text extraction would not detect that distinction. The gate uses the page
geometry and the same YAML-configured values under
`quality.pdf_pixel_qa` for DPI, background tolerance, inset, and the minimum
ink count. It writes `ink-occupancy.json` beside the PDF when
`REPORT_BABY_ARTIFACT_DIR` is set.

The numbered 1000-word variant extends this into an explicit occupancy
contract: pages 1 and 2 each have left and right top, middle, and bottom zones
split by two known obstacle bands; every zone must receive text. Page 3 has the
two final column zones. The fixture uses realistic lorem-ipsum words with an
ordinal suffix, for example `lorem0001 ipsum0002 dolor0003`, so source
completeness, column order, and zone occupancy are checked independently.

The same editorial shape is also covered by `npm run test:editorial-parity`.
This is the stable neutral regression fixture: lorem tokens retain the source
block lengths, four quote insertions and a 1600×900 illustration retain their
geometry, and the `pages/editorial-inset-two-column` template is rendered with
the trademark-free `Editorial QA` theme. Its expected normalized PDF hash is
tracked in `docs/quality/editorial-baseline.json`; changing it is therefore an
explicit parity decision, not an accidental change to the showcase corpus.

`ink-occupancy.json` is positional, not just a counter. Every line and checked
slot contains `boxMm`, the measured `boundsMm`, and `rowBands` with `x`, `y`,
`width`, and `height` in page coordinates (origin at the top-left). A region
with no measured pixels is explicitly marked `status: "empty"`. This makes it
possible to compare planned rectangles with actual painted rows and to locate
a gap without opening the PDF manually; the raster DPI and background threshold
remain recorded alongside the measurements.
