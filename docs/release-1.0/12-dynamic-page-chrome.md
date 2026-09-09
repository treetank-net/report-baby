# Plan 12 — dynamiczny page chrome i powtarzalne flow

Status: zaplanowany, implementacja nierozpoczęta.

Ten punkt wyciąga z wcześniejszych dokumentów pozostałą pracę dotyczącą
headera, footera, numeracji stron i innych elementów page chrome. Punkt 02
pozostaje zamkniętym punktem dotyczącym wspólnej geometrii ramek. Ten dokument
opisuje nowy kontrakt zachowania chrome opartego na rzeczywistej zawartości.

## Cel

Elementy u góry i dołu strony mają być planowane tak samo jak pozostałe sloty,
ale z jawną polityką powtarzania. Ich geometria nie może wynikać z pustego,
stałego pasa zarezerwowanego w template'cie.

Docelowy przepływ dla każdej strony:

```text
layoutForPage(page)
  → utworzenie slotów layoutu
  → powtarzalny header
  → wymagane insertiony i inne flow o wyższym priorytecie
  → walidacja kolizji i twardych wymagań
  → flow main w pozostałej przestrzeni
  → powtarzalny footer i elementy zależne od finalnej strony
  → projekcja page chrome do renderera
```

„Header” nie jest nową encją. Jest zwykłym flow z `repeat: each-page`. Różnicą
jest polityka cyklu życia, a nie osobny mechanizm layoutu lub pomiaru.

## Stan obecny

- `CompositionPagePlan.chrome` zawiera `headerBand`, opcjonalny
  `headerRule`, `footerRule`, `pageNumber` i `lockup`;
- `pageChrome()` w `server/src/report/renderer.ts` wylicza wysokość header band
  z `reserved_bands.header` i buduje numer strony poza tekstowym flow;
- template'y `showcase-report` i `showcase-report-band` mają osobny flow
  `header`, ale jego slot tytułu jest obecnie stałą ramą;
- większość template'ów `pages/editorial-*` oraz `default-report` deklaruje
  tylko `reserved_bands.header` i `reserved_bands.footer`, bez tekstowego
  flowu `header`; brand/logo pojawia się wtedy wyłącznie z rendererowego
  chrome;
- `document-layout.ts` planuje zwykłe flow przed powtarzanymi flowami, więc
  dynamiczny header nie może jeszcze przesuwać wcześniej ułożonego `main`;
- backend obsługuje istniejące placeholdery `{{page.number}}` i
  `{{page.count}}`, ale numeracja w `pageChrome` jest nadal drugim skrótem
  implementacyjnym;
- `reserved_bands.header` pozostaje przejściowym źródłem geometrii, dopóki
  planowanie headera nie przejmie jego odpowiedzialności.

## Audyt aktualnych definicji chrome

Ta migracja nie ma zachowywać backward compatibility wewnętrznych funkcji ani
starych ścieżek kodu. Ma zachować dotychczasowy wygląd i znaczenie dokumentu,
o ile nie zmieniamy tego świadomie w nowym kontrakcie. Obecne źródła chrome są
rozproszone:

| Źródło | Co definiuje obecnie | Rola docelowa |
|---|---|---|
| `page.reserved_bands.header/footer` | stały obszar odejmowany od segmentów flow | wynikowa granica geometrii, wyliczana z aktywnych slotów headera/footera |
| `slots.header`, `header-period` | tekstowe ramy nagłówka w `showcase-report*` | zwykłe sloty powtarzalnego flow, mierzone przed `main` |
| `slots.header-lockup` | zarezerwowany box typu `lockup` | grupa logo + nazwa marki, której geometria jest widoczna w planie |
| `flows.header` | powtarzanie headera od zadeklarowanej strony | jedyna reguła specjalna: `repeat: each-page` |
| `slots.footer` + `flows.footer` | stały slot i powtarzany footer | zwykły powtarzalny flow z wygenerowanymi placeholderami |
| `CompositionPagePlan.chrome` | ramy header band, reguły, footer, numer strony i lockup | projekcja wynikowej geometrii do rendererów |
| `pageChrome()` / `drawReportChrome()` | stałe bandy, logo, brand name, reguły i `${page} / ${pageCount}` | renderer dekoracji; bez osobnego właściciela geometrii treści |
| `pdf.header_*` | mieszanka aktywnych wartości i historycznych fallbacków | tylko wartości używane przez nowy seam; reszta do usunięcia po testach |
| `chrome.report_lockup.*` | rozmiar logo, rozmiar nazwy, wyrównanie i `gap_mm` | domyślny styl wewnętrznego layoutu lockupu |

`chrome.lockup.*` w tym samym `render-config.yml` dotyczy slajdów (PPTX/SVG),
nie raportowego page chrome. Nie należy mieszać tych dwóch układów w jednym
module; można jedynie zachować zgodną semantykę odstępu.

### Co jest aktywne, a co przejściowe

- Aktywnym kontraktem composition są named flows, sloty, `repeat`,
  `fit_content`, `grow`, reserved bands i wynikowe placementy.
- Aktywnym źródłem wizualnego odstępu raportowego lockupu jest obecnie
  `chrome.report_lockup.standard.gap_mm` lub wariant `continuation`, używany
  bezpośrednio przez `drawReportChrome()`.
- `CompiledTemplateSlot.gap` jest parsowany wyłącznie dla slotu `lockup`, ale
  adapter composition nie przekazuje go do `CompositionSlotTemplate`, a
  raportowy renderer go nie odczytuje. Nie wolno udawać, że template już
  kontroluje ten odstęp.
- `PDF_CONFIG.headerBandHeight`, `headerRepeatBandHeight`, `headerTitleTop`,
  `headerBandTitleTop`, `headerRepeatTopLineY` i `headerRepeatTitleY` są
  kandydatami do usunięcia lub scalenia po dodaniu nowego kalkulatora. Ich
  obecność w YAML nie oznacza, że każdy wpływa na raportowy composition.
- `pageChrome()` ma fallback do `PDF_CONFIG.headerBandHeight`, nawet gdy dany
  layout nie deklaruje bandu headera. To jest źródło pustej przestrzeni, a nie
  wymaganie nowego modelu.

## Lockup: logo, nazwa marki i odstęp

### Zachowanie obecne

Raportowy renderer wybiera wariant `standard` albo `continuation` z
`chrome.report_lockup`. Logo jest dopasowywane przez `drawContainedImage()` do
`mark_width_mm` albo `full_logo_width_mm` i `max_height_mm`. Nazwa marki jest
rysowana obok rzeczywiście wyrenderowanej szerokości logo z odstępem
`gap_mm`, a jej baseline jest wyrównywany względem wysokości logo.

Warto zachować ten wygląd jako punkt odniesienia:

- wariant standardowy i continuation mogą mieć różne wymiary oraz font;
- wyrównanie domyślne pozostaje `middle`;
- odstęp jest poziomy i liczony od faktycznego bounds logo, nie od pustej ramy;
- nazwa marki jest uppercase, tak jak obecnie;
- jeżeli asset logo nie istnieje, obecny renderer nadal rezerwuje jego
  domyślne wymiary. W nowym kontrakcie ten przypadek powinien zwijać brakujący
  element zamiast tworzyć niewidoczny odstęp.

### Kontrakt po migracji

Lockup jest jednym złożonym slotem/grupą headera, a nie dwoma niezależnymi
flowami. Wewnątrz ma dwa opcjonalne content bounds:

```text
lockup group
  → mark (asset, opcjonalny)
  → gap_mm (tylko gdy mark i name istnieją)
  → name (tekst brandu, opcjonalny)
```

Jego rozmiar wylicza jeden kalkulator:

```text
group.width  = mark.width + gap + name.width
group.height = max(mark.height, name.height)
               + padding_top + padding_bottom
```

W trybie stałym grupa respektuje box template'u i overflow policy. W trybie
`fit_content` box rośnie do pomierzonego contentu, ale nigdy poza `max_width`
i `max_height` z konfiguracji. Brak jednego z elementów nie pozostawia jego
fikcyjnych wymiarów ani odstępu.

Opis marki, okres i tytuł headera pozostają osobnymi slotami tylko wtedy, gdy
template chce je niezależnie pozycjonować. Ich kolizja z rozrastającym się
lockupem jest błędem geometrii, a nie powodem do cichego zmniejszania tekstu.

### Co znaczy „inline” w tym zadaniu

„Inline” opisuje tutaj relację lockupu do pozostałych elementów chrome, a nie
`CompositionInlineRun` wewnątrz jednej linii tekstu. Lockup nie jest jedynym
blokiem w definicji headera: może współistnieć z tytułem artykułu, okresem,
regułą albo innym slotem metadanych. Każdy z tych elementów ma własny pomiar i
box, a layout układa je w zadanej kolejności i z zadanymi odstępami.

Przykładowy header z lockupem, tytułem i okresem może wyglądać tak:

```yaml
flows:
  header:
    repeat: each-page
    slots:
      - header-lockup
      - header-period
      - header-title

slots:
  header-lockup:
    kind: lockup
    fit_content: true
  header-period:
    kind: text
    fit_content: true
  header-title:
    kind: text
    fit_content: true
```

Wynikowa kompozycja jednej strony nie oznacza trzech konkurujących headerów,
tylko jeden powtarzalny flow z trzema układanymi elementami:

```text
┌──────────────────────────────────────────────────────────┐
│ [lockup: znak + nazwa marki]       [okres publikacji]    │
│ Tytuł artykułu, który może zająć jedną lub kilka linii    │
│ ───────────────────────────────────────────────────────── │
└──────────────────────────────────────────────────────────┘
                         ↓ zmierzona granica headera
                    [flow main / insertiony]
```

Sama kolejność slotów nie przesądza jeszcze o kierunku ułożenia. Template musi
opisać relację geometryczną, na przykład pierwszy wiersz poziomy oraz tytuł
złożony pod nim:

```yaml
header_layout:
  - row: [header-lockup, header-period]
  - stack: [header-title]
```

To nadal jest jeden `header` flow: `row` i `stack` są sposobem ułożenia jego
slotów, a nie kolejnymi flowami ani konkurencyjnymi wariantami pierwszej
strony. Kalkulator mierzy każdy slot, następnie mierzy wiersze/stosy i zwraca
jedną granicę headera dla `main`.

Jeżeli tytuł urośnie do dwóch linii, rośnie tylko jego slot oraz wynikowa
wysokość grupy headera; lockup zachowuje swoje wymiary, a `main` zaczyna się
poniżej nowej granicy. Jeżeli lockup nie ma ani znaku, ani nazwy, jego slot
znika w trybie `fit_content`, ale pozostałe sloty nadal są układane.

Numer strony jest analogicznym slotem metadanych, jednak domyślnie należy go
umieścić w footerze. Przykład pełnego powtarzalnego chrome:

```yaml
flows:
  footer:
    repeat: each-page
    slots:
      - footer-rule
      - footer-page-number

slots:
  footer-page-number:
    kind: text
    text: "{{page.number}} / {{page.count}}"
    fit_content: true
```

Lockup może też być użyty poza headerem, o ile wybrany slot dopuszcza jego
rodzaj. Wtedy pozostaje tym samym mierzonym blokiem, a zmienia się tylko
miejsce i polityka powtarzania:

```yaml
flows:
  sidebar:
    slots:
      - sidebar-lockup

slots:
  sidebar-lockup:
    kind: lockup
    asset: brand-mark
    label: "ACME Logistics"
    fit_content: true
```

Powyższe przykłady są docelowym kontraktem planera; nie oznaczają jeszcze
istniejącej składni parsera. Wartości odstępów, paddingów i limitów pozostają
w `server/templates/render-config.yml`, a nie w literalach TypeScriptu.

Domyślne `gap_mm` raportowego lockupu zachowujemy bez zmiany wizualnej.
Pierwszy przebieg migracji nie dodaje drugiego, niezależnego źródła odstępu.
Jeżeli później template ma świadomie nadpisywać gap, istniejące pole `gap`
trzeba jawnie przeprowadzić przez adapter i opisać jego priorytet względem
`chrome.report_lockup`; nie wolno pozostawić pozornie działającej, ignorowanej
definicji.

### Chrome a „zgniatanie” `main` w obecnej implementacji

Obecne zachowanie nie jest negocjacją chrome z flow:

- `reserved_bands.header` i `reserved_bands.footer` są od początku odejmowane
  od segmentów dostępnych dla tekstu; działają jako twarde granice, a nie jako
  placementy przesuwane przez planner;
- insertiony są natomiast materializowane przed zwykłym flow i stają się
  rzeczywistymi obstacle'ami, które mogą zmniejszyć dostępne miejsce dla
  `main`;
- powtarzany `header` jest obecnie planowany po zwykłych flowach, a
  `pageChrome` jest dołączany po planowaniu, więc zmiana jego wysokości nie
  powoduje ponownego ułożenia `main`;
- system nie ma ogólnego mechanizmu zmniejszania fontu, line-height ani
  dowolnego ściskania `main` w celu dopasowania chrome. Istniejące lokalne
  skracanie odstępu headingu dotyczy wyłącznie decyzji wewnątrz tekstowego
  flowu.

W punkcie 12 „wpływ chrome na `main`” oznacza zatem zmianę granicy dostępnej
  geometrii: większy header przesuwa lub ogranicza `main`, mniejszy header
  zwalnia miejsce. Nie oznacza kompresowania treści. Gdy twarde wymagania lub
  limity strony nie mogą być spełnione, kandydat ma zostać odrzucony albo
  `ensurePage` ma utworzyć kolejną legalną stronę zgodnie z polityką flow.

## Przyjęty kontrakt

### Header i footer

- header i footer są zwykłymi flowami z `repeat: each-page`;
- sloty powtarzalnego flow są rozpatrywane przed `main` na każdej stronie;
- wymagane elementy mają pierwszeństwo przed soft insertionami, a soft
  insertiony przed `main` tylko w zakresie zadeklarowanej polityki strony;
- `start_page`, `continuation` i różnice layoutu pierwszej/kolejnych stron
  pozostają właściwościami flow/template'u, nie wyjątkami w rendererze;
- powtarzalny flow nie tworzy samowolnie nowych stron tylko dlatego, że jest
  powtarzany; `ensurePage` stosuje zwykłe reguły legalności i limitów.

### Wysokość zależna od treści

- Domyślny tryb pozostaje stały: pominięte `fit_content` oznacza, że slot
  respektuje ramę template'u. Zmienny tryb jest jawnym `fit_content: true` i
  nie może zostać włączony samym pojawieniem się dłuższego tekstu.
- pusty header nie zajmuje miejsca, chyba że template jawnie deklaruje
  niezerowe minimum, np. dla lockupu marki, albo działa w stałym trybie;
- niepusty header otrzymuje wysokość zmierzonej zawartości plus wspólny
  `padding-top` i `padding-bottom` z konfiguracji renderowania;
- zawinięty tytuł zwiększa wysokość headera, a następne sloty są przesuwane
  bez zmiany ich kolejności;
- `fit_content`, wzrost i maksymalna wysokość są właściwościami slotu/layoutu,
  a nie specjalnym kodem `pageChrome`;
- w trybie stałym przekroczenie ramy podlega polityce slotu (`reject` albo
  jawnie dozwolone `shrink-to-fit`); tryb zmienny nie może być domyślnym
  fallbackiem dla przepełnienia stałego slotu;
- przekroczenie maksymalnej wysokości, dolnej granicy strony albo twardego
  obstacle'u odrzuca kandydat jako nielegalny; nie wolno ściskać `main`, aby
  ukryć naruszenie;
- paddingi i limity są konfigurowalne w YAML render-config, nie jako literały
  w TypeScript.

### Page chrome jako projekcja

`pageChrome` pozostaje strukturą wyjściową dla backendu renderującego, ale nie
jest właścicielem treści ani geometrii headera. Renderer może z niej korzystać
do narysowania:

- tła lub pasma nagłówka;
- reguły pod headerem;
- lockupu/logo;
- reguły footera;
- numeru strony i innych metadanych zależnych od finalnego planu.

Każdy z tych elementów musi mieć wskazane źródło geometrii: slot flowu,
wyliczoną grupę headera albo jawnie zdefiniowaną dekorację template'u. Nie
utrzymujemy drugiego, ukrytego prostokąta, który niezależnie ogranicza `main`.

## Zmienne generowane stron

Zachowujemy istniejącą składnię placeholderów:

```text
{{page.number}}  — numer strony od 1
{{page.count}}   — liczba stron zaakceptowanego planu
```

Obie zmienne są dostępne w każdym tekstowym slocie, także w headerze,
footerze i innych powtarzalnych flowach. Nie wprowadzamy aliasów `{page}` ani
`{numberOfPages}`. `pageCount` pozostaje lokalną nazwą implementacyjną.

Placeholdery są rozwiązywane po ustaleniu finalnego zaakceptowanego planu.
Jeżeli ich podstawienie może zmienić łamanie tekstu, pomiar musi uwzględnić
rozmiar wygenerowanego tekstu albo zastosować drugi, jawny przebieg
finalizacji. Nie wolno renderować innego tekstu niż ten, którego szerokość
została użyta do decyzji o legalności.

Przykładowe deklaracje:

```text
footer text: "{{page.number}} / {{page.count}}"
header text: "{{section.title}} — {{page.number}} / {{page.count}}"
```

Numer strony nie powinien być dodatkowo składany jako `${page} / ${pageCount}`
w rendererze, jeżeli template deklaruje go jako slot tekstowy.

## Przypadki, które muszą mieć jawny wynik

| Przypadek | Oczekiwane zachowanie |
|---|---|
| brak tytułu, brak lockupu, tryb zmienny | header zwija się do zera; `main` zaczyna się od zwykłej pozycji contentu |
| brak tytułu, tryb stały | zostaje zadeklarowana pusta rama; jest to świadomy wybór template'u |
| brak tytułu, lockup marki | pozostaje tylko zadeklarowane minimum lockupu i jego paddingi |
| krótki tytuł | jedna linia, wspólne paddingi, brak pustej nadmiarowej wysokości |
| długi tytuł | zawinięcie i wzrost slotu; kolejne insertiony oraz `main` przesuwają się w dół |
| tytuł przekracza maksymalną wysokość | kandydat odrzucony z diagnostyką, bez kompresowania treści |
| `{{page.number}}` zmienia szerokość z `9` na `10` | pomiar i render używają tego samego rozwiązania placeholdera |
| `{{page.count}}` nie jest jeszcze znane | pozostaje nierozwiązane do finalizacji; planer nie udaje wartości końcowej |
| footer bez treści | footer nie tworzy pustej ramy, chyba że template wymaga minimum |
| footer z numerem strony | zwykły powtarzalny slot tekstowy z istniejącymi placeholderami |
| pierwsza strona bez headera | wynika z `start_page`/layoutu, a nie z warunku w rendererze |
| kolejne strony z innym headerem | każdy layout strony mierzy własny zestaw slotów |
| header koliduje z twardym insertionem | kandydat nielegalny; nie wolno przykrywać insertionu |
| header wypycha `main` poza stronę | kandydat nielegalny albo tworzona jest następna strona według zwykłych reguł |
| strona zawiera wyłącznie chrome | nie tworzymy pustej strony kontynuacyjnej bez wymaganej treści |
| debug PDF i zwykły PDF | obie ścieżki korzystają z tych samych boxów wynikowego planu |
| logo + nazwa marki | lockup zachowuje wariantowy `gap_mm` i pionowe wyrównanie względem rzeczywistego logo |
| logo bez nazwy marki | grupa zawiera tylko logo; nie ma pustego końcowego gapu |
| nazwa marki bez logo | grupa zawiera tylko tekst; nie rezerwuje niewidocznej szerokości logo |
| długi opis/nazwa marki | szerokość jest mierzona; przekroczenie limitu kończy się `shrink-to-fit` albo odrzuceniem zgodnie z polityką slotu |
| standard vs continuation | każdy wariant zachowuje własny rozmiar logo, font, wysokość maksymalną i gap |
| lockup koliduje z `header-period` | kandydat jest nielegalny; nie przesuwamy tekstu poza zadeklarowany slot bez reguły layoutu |

## Kolejność implementacji

1. Ustalić w kontraktach template'u grupę headera/footeru oraz konfigurację
   paddingów, minimum i maksimum wysokości.
2. Wydzielić wspólny resolver istniejących placeholderów i użyć go zarówno w
   pomiarze, jak i w backendzie PDF.
3. Zmienić kolejność planowania strony tak, aby header i wymagane insertiony
   były rozstrzygnięte przed `main`.
4. Dodać kalkulator dynamicznej geometrii grupy headera i footeru. Kalkulator
   ma zwracać boxy oraz informację o powodach wzrostu lub zwinięcia.
5. Włączyć wynik kalkulatora do obstacle'ów/ram dostępnych dla `main` i
   insertionów.
6. Zmienić `pageChrome()` w projekcję wynikowych slotów oraz dekoracji, bez
   niezależnego wyliczania wysokości header band.
7. Usunąć hard-coded składanie numeru strony tam, gdzie numer jest już
   zadeklarowanym slotem tekstowym.
8. Dodać walidację legalności dla minimum, maksimum, kolizji, overflowu i
   pustych stron.
9. Uzupełnić debug, `dry_run`, manifest i PDF o tę samą geometrię.
10. Przepisać testy chrome na fixture'y krótkiego, długiego, pustego i
    wielostronicowego headera oraz zmiany liczby cyfr numeracji.

## Kryteria ukończenia

- zmiana wysokości tytułu zmienia box headera i początek `main` bez ręcznej
  korekty innego template'u;
- pusty header nie zostawia nieuzasadnionej pustej przestrzeni;
- header i footer są powtarzalnymi flowami, a nie alternatywną ścieżką
  renderera;
- `{{page.number}}` i `{{page.count}}` mają jeden resolver oraz jeden kontrakt;
- plan, debug i PDF korzystają z tych samych ramek chrome;
- finalna liczba stron jest ustalona przed rozwiązaniem `{{page.count}}`;
- każda nielegalna kolizja lub overflow kończy się odrzuceniem planu z
  diagnostyką, a nie cichym przycięciem;
- testy obejmują brak treści, lockup bez tytułu, tytuł wieloliniowy, limity,
  pierwszą stronę, continuation, footer i numerację 1–9 oraz 10+;
- test visual QA potwierdza spójne paddingi i brak pustego pasa po zwinięciu
  headera;
- MCP, CLI, `dry_run` i zwykły PDF zachowują dotychczasowy kontrakt poza
  zamierzoną zmianą dynamicznej geometrii chrome.

## Poza zakresem

Nie budujemy globalnego solvera CSS ani nowej encji `Header`. Nie zmieniamy
istniejącej składni placeholderów i nie przenosimy treści `main` do
`insertionSlots`.
