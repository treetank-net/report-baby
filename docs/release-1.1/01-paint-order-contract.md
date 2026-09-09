# Release 1.1 — jawny paint order

Status: propozycja docelowego kontraktu; nie jest jeszcze implementacją.

## Granica względem release 1.0

W release 1.0 obowiązują dwa fakty:

1. `priority` służy wyłącznie do wcześniejszej rezerwacji i wyliczania
   geometrii placementów;
2. backend zachowuje dotychczasowy porządek komend jako baseline migracji.

Nie wyciągamy z `priority` kolejności rysowania i nie zmieniamy przez to
backendu w ramach punktu 12. Ten dokument opisuje osobny kontrakt release 1.1.

## Dlaczego potrzebujemy jawnego kontraktu

Obecny backend nie posiada pola ani polityki paint order. Kolejność wynika z
tego, że `render()` przechodzi kolejno po osobnych tablicach planu:

```text
tablePlacements
→ graphicPlacements
→ blockPlacements
→ zwykłe linie tekstu
→ insertion lines
→ glyphPlacements
```

To działa, ponieważ planner i evaluator zazwyczaj zabraniają kolizji. Nie jest
jednak wystarczająco jawne dla:

- kontrolowanego nakładania dekoracji i grafik;
- wielu backendów renderujących ten sam plan;
- przewidywalnej widoczności glyphów, teł i insertionów;
- testów, które mają odróżnić poprawny box od poprawnego wyniku wizualnego;
- świadomego utrzymania kolejności content streamu PDF.

Kolejność pętli jest więc obecnie faktem implementacyjnym, a nie kontraktem
domenowym. Release 1.1 ma nadać jej nazwę, właściciela i testowalną regułę.

## Definicje

### `priority`

`priority` jest metadanym planera. Wyższa liczba oznacza silniejsze roszczenie
do wcześniejszego rozwiązania geometrii. Planner może sortować placementy
malejąco, aby najpierw zarezerwować ich przestrzeń. W okresie migracji brak
wartości oznacza jawnie `composition_priority.default` z YAML (obecnie `100`)
— najniższy poziom roszczenia — a nie `0`.

`priority` nie odpowiada na pytanie, co ma być wizualnie nad czym. W release 1.0
nie jest źródłem paint order.

### Paint order

Paint order to kolejność, w której adapter backendu emituje fizyczne komendy
rysowania do PDF/PNG/SVG. Jest to porządek wykonania renderera, nie:

- kolejność flowu i slotów;
- kolejność authored blocks;
- kolejność kontynuacji na stronach;
- kolejność rezerwacji geometrii;
- automatyczny `z-index`.

### `paint phase`

W release 1.1 paint order będzie reprezentowany przez nazwane fazy. Faza jest
stabilnym kluczem backendu, a nie nowym rodzajem bloku ani publiczną encją
treści.

## Przyjęty model release 1.1

### Jedna jawna lista faz backendu

Źródłem kolejności będzie konfiguracja renderera, nie przypadkowa kolejność
tablic planu:

```yaml
pdf:
  paint_order:
    - page-background
    - table
    - graphic
    - block
    - flow-text
    - insertion-text
    - glyph
    - debug
```

Lista jest uporządkowana od malowania najwcześniejszego do najpóźniejszego.
Element późniejszej fazy może wizualnie przykryć element wcześniejszej fazy,
jeżeli kontrakt legalności dopuszcza ich nakładanie. Pozycja na liście jest
jedyną istotną relacją; nie wprowadzamy osobnych, rozproszonych liczb w kodzie.

Domyślna lista odtwarza obecny backendowy porządek dla faz, które już istnieją.
`page-background` i `debug` są nazwami przyszłych/otaczających operacji i nie
mogą być udawane przez zwykłe placementy.

### Mapowanie placementów na fazy

Backend albo jego adapter normalizuje każdy renderowalny wynik planu do fazy:

| Wynik planu | Domyślna faza | Uwagi |
|---|---|---|
| `tablePlacements` | `table` | renderer tabeli pozostaje atomowy wewnątrz własnego placementu |
| `graphicPlacements` z `paint !== false` | `graphic` | `paint: false` nie emituje komendy, ale geometria nadal może być obstacle'em |
| `blockPlacements` | `block` | obejmuje image, metric, chart i przyszły lockup |
| `CompositionLine` z `layer !== 'insertion'` | `flow-text` | zachowuje zwykły tekst flowów |
| `CompositionLine` z `layer === 'insertion'` | `insertion-text` | zachowuje rozdzielenie tekstu insertionów |
| `glyphPlacements` | `glyph` | domyślnie pozostają nad treścią, jeśli ich box może się nakładać |
| debug overlay | `debug` | obserwacja; nie zmienia planu ani geometrii |

Mapowanie nie zmienia rodzaju bloku, flowu ani route'u. Jest decyzją adaptera
renderera, który zna możliwości konkretnego backendu.

### Tie-breaker

Dwa placementy w tej samej fazie są renderowane deterministycznie według:

1. numeru strony;
2. stabilnej kolejności placementu zapisanej w planie;
3. technicznego identyfikatora wyłącznie jako ostatniego remisu.

Nie sortujemy po czasie utworzenia obiektu, kolejności kluczy mapy ani nazwie
flowu. Zmiana paint orderu musi być widoczna w konfiguracji lub w jawnej
zmianie stabilnej kolejności planu.

## Relacja z `priority`

W podstawowym kontrakcie release 1.1 `priority` i paint phase są osobne:

```text
priority ↓  → wcześniejsza rezerwacja geometrii
paint phase ↑ → późniejsze wykonanie komendy i potencjalne przykrycie
```

Nie oznacza to, że nie mogą mieć wspólnego źródła. Adapter może kiedyś
zbudować obie wartości z jednej polityki semantycznej, ale mapowanie musi być
jawne i testowalne. Nie wolno uzależniać paint orderu od samej kolejności
planowania tylko dlatego, że oba przebiegi używają słowa „priority”.

Przykład: footer może mieć wysokie `priority`, aby jego dynamiczna geometria
została rozstrzygnięta przed `main`, ale jego paint phase może pozostać późna
albo wczesna zależnie od decyzji wizualnej. Przy niekolidujących boxach nie
zmienia to legalności.

Jeżeli produkt wybierze jedną wspólną liczbę w przyszłości, musi przyjąć jawne
mapowanie, np. wyższy `priority` oznacza późniejszy paint i wyższą warstwę.
Nie jest to jednak kontrakt 1.0 ani wymaganie tego dokumentu.

## Właściciele

```text
render-config.yml
  → adapter konfiguracji renderera
  → mapowanie placementu do paint phase
  → backend tworzy komendy i sortuje je fazą + tie-breakerem
  → evaluator sprawdza legalność nakładania niezależnie od kolejności komend
```

- `render-config.yml` jest właścicielem domyślnej listy faz i jej kolejności;
- adapter może odrzucić nieznaną fazę albo użyć jawnego fallbacku;
- planner nie importuje konfiguracji ani API PDF;
- evaluator nie legalizuje kolizji przez sam fakt późniejszego malowania;
- backend odpowiada za wykonanie komend i stan graficzny PDF;
- template określa sloty, geometrię i dozwolone rodzaje treści, ale nie musi
  znać technicznych komend jsPDF.

Jeśli różne backendy wymagają różnych faz, każdy adapter może mieć własną
mapę wykonawczą przy zachowaniu tych samych semantycznych kategorii. Nie
tworzymy publicznego `paintOrder` jako pola tekstowego w każdym bloku.

## Wymagana zmiana techniczna

Obecne osobne tablice planu nie wystarczą do dowolnego, jawnego sortowania.
Backend potrzebuje wewnętrznej listy komend renderera, np.:

```text
RenderCommand {
  page,
  phase,
  stableIndex,
  render(): void
}
```

To jest typ adaptera, nie nowa encja domenowa. Komenda zachowuje referencję do
istniejącego placementu i wywołuje jego capability. Nie przenosimy pomiaru,
routingu ani legalności do backendu.

Renderery atomowe, takie jak tabela albo karta metryki, zachowują własną
wewnętrzną kolejność rysowania. Paint phase steruje kolejnością placementów,
nie pojedynczych komórek tabeli lub fragmentów glyphów. Jeżeli kiedyś trzeba
będzie przeplatać komendy wewnątrz jednego bloku, będzie to osobny kontrakt
capability.

## Legalność i nakładanie

Paint order nie zastępuje evaluatora. Dla każdej pary elementów obowiązuje
jedna z trzech sytuacji:

1. boxy nie nachodzą na siebie — paint order jest wizualnie obojętny;
2. nakładanie jest jawnie dozwolone — faza decyduje, który element jest
   widoczny na wierzchu;
3. nakładanie jest niedozwolone — plan zostaje odrzucony niezależnie od tego,
   który element zostałby narysowany później.

`paint: false` oznacza brak fizycznej komendy, a nie zgodę na kolizję. Obstacle
pozostaje częścią geometrii planu i może ograniczać tekst.

## Testy wymagane przed wdrożeniem

### Kontrakt konfiguracji

- brak fazy lub powtórzona nazwa kończy się czytelnym błędem konfiguracji;
- każda renderowalna kategoria ma mapowanie do jednej fazy;
- domyślna lista daje obecny wynik dla niekolidujących placementów;
- kolejność jest stabilna między uruchomieniami i backendami.

### Nakładanie

- grafika tła i tekst nad nią;
- dwa grafiki o różnych fazach;
- insertion i zwykły tekst w legalnym przypadku nakładania;
- glyph nad albo pod tekstem, zależnie od fazy;
- `paint: false` z zachowaną geometrią obstacle'u;
- niedozwolona kolizja odrzucona niezależnie od paint orderu.

### Artefakty

- PDF, PNG/debug i `dry_run` wskazują te same placementy;
- selectable text zachowuje osobny, semantyczny porządek źródła;
- zmiana fazy zmienia tylko zweryfikowaną warstwę wizualną, a nie routing ani
  coverage treści;
- aktualny corpus nie zmienia się bez jawnej zmiany konfiguracji.

## Kolejność implementacji

1. Zinwentaryzować wszystkie komendy obecnego backendu i ustalić, które są
   placement-level, a które wewnętrzne dla capability.
2. Dodać walidację listy `pdf.paint_order` w seamie konfiguracji adaptera.
3. Wprowadzić wewnętrzny `RenderCommand` bez zmiany publicznego
   `CompositionPlan`.
4. Zachować bieżący porządek jako domyślny fallback i porównać PDF/text/bbox/
   raster z baseline'em.
5. Dodać kontrolowane przypadki nakładania i testy evaluatorowe.
6. Dopiero potem rozważyć mapowanie wybranych placementów do niestandardowej
   fazy lub powiązanie polityki z `priority`.

## Poza zakresem

- automatyczny globalny solver geometrii;
- zmiana polityki `continuation`;
- zmiana route/slot order albo source/reading order;
- przenoszenie treści `main` do insertionów;
- arbitralny CSS `z-index` dla każdego bloku;
- publiczne pola `readingOrder` i `selectionGroup`.
