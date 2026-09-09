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
- `document-layout.ts` planuje zwykłe flow przed powtarzanymi flowami, więc
  dynamiczny header nie może jeszcze przesuwać wcześniej ułożonego `main`;
- backend obsługuje istniejące placeholdery `{{page.number}}` i
  `{{page.count}}`, ale numeracja w `pageChrome` jest nadal drugim skrótem
  implementacyjnym;
- `reserved_bands.header` pozostaje przejściowym źródłem geometrii, dopóki
  planowanie headera nie przejmie jego odpowiedzialności.

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

- pusty header nie zajmuje miejsca, chyba że template jawnie deklaruje
  niezerowe minimum, np. dla lockupu marki;
- niepusty header otrzymuje wysokość zmierzonej zawartości plus wspólny
  `padding-top` i `padding-bottom` z konfiguracji renderowania;
- zawinięty tytuł zwiększa wysokość headera, a następne sloty są przesuwane
  bez zmiany ich kolejności;
- `fit_content`, wzrost i maksymalna wysokość są właściwościami slotu/layoutu,
  a nie specjalnym kodem `pageChrome`;
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
| brak tytułu, brak lockupu | header zwija się do zera; `main` zaczyna się od zwykłej pozycji contentu |
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
