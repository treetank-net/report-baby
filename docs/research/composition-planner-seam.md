# Composition planner seam

Date: 2026-08-26

> Status correction (2026-08-28): the implementation described below has
> advanced beyond the transitional `ReportData`/legacy-renderer stage. The
> current contract and migration boundary are summarized in
> [composition-input-migration.md](./composition-input-migration.md). The
> historical sections remain useful as design notes, but their old status
> statements are not authoritative.

## Cel

Planner ma obliczać strony, sloty, linie, obrazy, decyzje i
diagnostykę bez znajomości konkretnego API PDF. Konkretna biblioteka — obecnie
`jsPDF` — jest adapterem metryk i późniejszego rysowania planu.

To nie oznacza, że planner ignoruje możliwości backendu. Backend przekazuje mu
jawny kontrakt pomiaru tekstu. Dzięki temu planner planuje względem rzeczywistej
szerokości fontu, ale nie wywołuje `doc.text()`, `doc.addPage()` ani innych
operacji rysujących.

## Nadrzędny cel planu prototypu

Zachować prosty, semantyczny model wejściowy dla LLM-a, a całą rosnącą
złożoność kompozycji przenieść do wewnętrznego modelu dokumentu, planera i
ewaluatora.

LLM powinien nadal przekazywać przede wszystkim treść i jej znaczenie — tytuł,
sekcje, akapity, listy, cytaty, obrazy oraz ewentualne nazwane flow, gdy
potrzebne jest odejście od domyślnego układu. Nie powinien ręcznie wyznaczać
współrzędnych, dzielić tekstu na strony ani budować zagnieżdżonej geometrii.

Szablony stają się bardziej sprawcze: definiują dostępne layouty stron,
nazwane flow i sloty, kolejność ich kontynuacji, sloty statyczne i floatujące,
reguły naturalnego rozpychania, ograniczenia oraz zachowanie przy braku
miejsca. Brand dostarcza wygląd, fonty, spacing tokens, assety i gotowe
komponenty graficzne. Dzięki temu autor szablonu może opisać reguły prostą
deklaracją, a silnik rozwiązuje wynikową geometrię przez pomiar, przepływ,
przesuwanie i zmianę rozmiaru elementów.

To jest cel kompatybilności, a nie zaproszenie do stworzenia DSL-a, który
LLM musiałby codziennie obsługiwać. Obecny semantyczny payload powinien być
normalizowany do bogatszego modelu wewnętrznego, zamiast zostać zastąpiony
obowiązkowym opisem layoutu:

```text
simple semantic input
  → normalized document / AST / named flows
  → template-driven regions, slots and routes
  → planner
  → evaluator and diagnostics
  → backend adapter (jsPDF or another PDF engine)
```

### Kryteria spełnienia celu

- Typowy request nadal działa bez znajomości regionów, slotów, geometrii i zasad
  łamania; `sections` trafiają do domyślnego flow `main`.
- `intro`, `sidebar`, `header`, `footer` i cytaty mogą być reprezentowane
  jako zwykłe sloty, bez osobnych wyjątków w algorytmie planowania.
- Szablon może zmieniać layout pomiędzy stronami, zachowując nazwane flow,
  np. `main` przechodzące z dwóch regionów na stronie otwierającej do trzech
  kolumn na stronie kontynuacji.
- Planner podejmuje decyzje o przepływie, rozpychaniu, kontynuacji,
  alternatywnym layoucie i braku miejsca; evaluator sprawdza, czy decyzje
  spełniają kontrakt, zanim backend narysuje PDF.
- Niespełnione wymagania nie znikają po cichu: wynik zawiera residual content,
  konflikty, ostrzeżenia lub odrzucenie planu zgodnie z polityką szablonu.
- `jsPDF` pozostaje wymienialnym adapterem. Metryki backendu są potrzebne do
  planowania, ale planner nie zależy od jego metod rysujących.
- Ten sam model i te same przypadki testowe mogą być użyte przez MCP, CLI,
  prototyp PNG oraz docelowy renderer PDF.

### Granica prostoty dla autora szablonu

Autor szablonu powinien deklarować zasady, nie wykonywać ręcznie obliczeń.
Minimalna definicja powinna móc określić: format strony, regiony, flowy,
kolejność trasy, paddingi i marginesy, ograniczenia rozmiaru, zachowanie
slotów oraz politykę overflow. Naturalne konsekwencje tych reguł — wysokość
tekstu, przesunięcie kolejnych slotów, złamanie flowu i wybór strony —
wylicza silnik.

Bloki, których nie da się bezpiecznie dzielić (np. pojedyncza karta KPI), mają
jawny atomic placement. Slot `kind: block` nie przyjmuje zwykłego akapitu;
planner mierzy blok przez capability `measureBlock`, a adapter wykonuje go
przez jawnie podany renderer. Obraz może być atomowym blokiem w zwykłym slocie
tekstu: po jego zmierzonym prostokącie kolejny tekst zaczyna się niżej w tym
samym slocie, a gdy prostokąt się nie mieści, obraz przechodzi do następnego
legalnego slotu lub strony. Brak pomiaru lub renderer'a nie prowadzi do
cichego pominięcia. Cała tabela nie jest jednak atomowa: docelowo dzielimy ją
po wierszach i sprawdzamy coverage wierszy oraz komórek.

Pierwszym konkretnym mechanizmem rozpychania jest `grow` dla pionowego bloku
page-template. Template wskazuje `flow.lead`, a blok definiuje `grow.max_height`
oraz opcjonalne `pushes`: slot rośnie do potrzebnej wysokości, a wskazane sloty
poniżej są przesuwane i skracane o ten sam przyrost. Gdy limit zostanie
osiągnięty, reszta treści korzysta ze zwykłej trasy flowu i może przejść do
kolejnej kolumny albo strony. Ta sama reguła może obsługiwać intro, cytat, obraz
lub inny box; rola treści nie zmienia mechaniki. Nie jest to jeszcze pełny
solver zależności między dowolnymi boxami — dlatego nie deklarujemy jeszcze
podmiany renderer'a.

Jeśli do utworzenia szablonu potrzebny jest skrypt zawierający współrzędne lub
osobna procedura dla `intro`, oznacza to brakujący element deklaratywnego
kontraktu, a nie prawidłowy obowiązek autora szablonu. Skrypty mogą pozostać
opcjonalnym rozszerzeniem dla nietypowych komponentów graficznych lub
backendowych efektów, ale nie powinny być wymagane do zwykłego layoutu.

## Przejście z obecnego Report Baby do modelu docelowego

Nie wymieniamy obecnego kontraktu wejściowego ani nie przepisujemy od razu
całego renderer'a. Migracja ma być kompatybilnym przejściem, w którym obecny
`ReportData` staje się jednym ze źródeł dokumentu wewnętrznego.

### Etap 0 — zamrożenie zachowania produktu

Zachowujemy obecny request `render_report`, istniejące brandy, fonty, assety,
domyślne layouty i harness testowy. Corpus PDF/PNG oraz testy tekstowe są
kontrolą regresji starego produktu, a nie czymś do usunięcia przy okazji
refaktoru. Najpierw trzeba rozdzielić porażkę nowego planera od istniejącej
różnicy baseline'u albo problemu środowiska.

### Etap 1 — normalizacja bez zmiany renderowania

Wprowadzamy importowalny, renderer-neutralny model:

```text
ReportData / Markdown / structured nodes
  → normalized document AST
  → named flows and semantic blocks
```

Adapter zachowuje kompatybilność między polami:

- `sections` → domyślny flow `main`;
- `intro` → zwykły slot przed `main`;
- `footer` → domyślny powtarzalny slot;
- `title_page` → wybór layoutu strony tytułowej;
- obrazy Markdown i structured images → wspólny model assetu/graphic node;
  w `intro` i sekcjach są rozdzielane na zwykły tekst oraz atomowy blok obrazu,
  bez utraty tekstu przed/po obrazku. Placement obrazu może również nieść
  wynikowy `imageBox`, `captionBox` i współczynnik skali, więc drugi backend nie
  musi ponownie zgadywać geometrii.

Na tym etapie stary renderer może nadal rysować po staremu. Celem jest
udowodnienie, że treść i jej tożsamość nie giną podczas normalizacji.

### Etap 2 — deklaratywne layouty, regiony i trasy flowów

Rozszerzamy kontrakt template'u o jawne `layoutId`, `regionId` i `flowId` oraz
reguły przejścia między layoutami. W tym miejscu formalizujemy również
relacje, których same named flows nie rozwiązują:

- `same_page` — slot związany z kotwicą na tej samej stronie;
- `deferred` — element może zostać odłożony;
- `continuing_flow` — flow kontynuuje się w kolejnych regionach;
- `page_local` — slot istnieje wyłącznie w konkretnym layoucie.

`first-page-only` pozostaje wyłącznie adapterem starego fixture'u. Docelowo
strona wybiera layout, a nie dostaje globalny master z wyjątkami dla intro i
sidebara.

### Etap 3 — planner i evaluator jako jedyne miejsce decyzji

Planner przejmuje decyzje o fragmentach, kolejności regionów, keep/widow/orphan,
exclusion geometry, naturalnym rozpychaniu, zmianie layoutu i overflow.
Evaluator przed renderowaniem sprawdza co najmniej:

- brak kolizji z innymi slotami i kształtami;
- brak tekstu poza regionem lub stroną;
- zachowanie wymaganych klastrów, np. nagłówek + pierwsze linie;
- poprawny remainder każdego flowu;
- brak cichego zgubienia treści;
- spełnienie polityki wypełnienia i łamania;
- wykonalność grafiki większej niż dostępny region.

PDF nie jest uznawany za sukces tylko dlatego, że backend go wygenerował.
Evaluator zwraca `accepted`, `accepted-with-warnings` albo `rejected` wraz z
decyzjami, konfliktami i residual content.

### Etap 4 — adapter `jsPDF`

`jsPDF` otrzymuje zaakceptowany plan oraz kontrakt metryk fontu i bloków. Adapter nie
wybiera już samodzielnie, gdzie zaczyna się kolejna kolumna, nie łamie ponownie
flowu i nie odtwarza specjalnych ścieżek dla intro/sidebara. Jego zadaniem jest
mapowanie planu na API PDF oraz zgłoszenie ograniczeń backendu.

Planowanie musi jednak znać metryki i możliwości wybranego backendu — pełna
niezależność od PDF byłaby pozorna. Rozwiązujemy to przez jawny adapter
`measureText`, `lineHeight`, capabilities i draw operations, zamiast przez
importowanie `jsPDF` do planera.

### Etap 5 — parytet, brandy i usunięcie ścieżek specjalnych

Najpierw przełączamy jeden istniejący layout A4 na planowany rendering, potem
layouty wielostronicowe, obrazy floatujące i named flows, a dopiero później
usuwamy stare proceduralne ścieżki. Każdy etap musi przejść:

1. test kontraktu wejściowego i normalizacji;
2. test planu oraz diagnostyki;
3. test tekstu w PDF;
4. pixel QA PNG;
5. przypadki brandów, fontów, obrazów i kierunków pisma.

Do czasu osiągnięcia parytetu stary renderer pozostaje kontrolą porównawczą,
nie równoległym źródłem prawdy dla nowych decyzji layoutowych.

## Strategia adopcji obecnego prototypu

Obecny prototyp i przygotowany pod niego harness są częścią aktywa migracji.
Nie przepisujemy ich od zera i nie kasujemy przypadków tylko dlatego, że
zmieniają się nazwy `flowBoxes`, regionów albo pól wejściowych. Możemy wykonać
kontrolowaną kopię kernela do nowego modułu, a następnie adaptować ją do
produkcyjnego kontraktu.

Kolejność adopcji:

1. Zamrozić corpus fixture'ów, oczekiwane plany, PNG oraz pozostałe artefakty
   porównawcze jako złoty corpus prototypu. Oryginalny harness nadal musi dać
   wynik bazowy.
2. Skopiować algorytm do importowalnego modułu silnika, bez zmieniania jego
   decyzji. Usunąć tylko CLI, globalny stan i zależności fixture'ów.
3. Dodać adapter wejścia, który tłumaczy stary format fixture'ów na nowy
   model `region`/`slot`/`flow`/`placement`. Stary i nowy input mają prowadzić
   do tego samego planu.
4. Uruchamiać stary harness przeciwko nowemu silnikowi. Dla każdego przypadku
   porównywać nie tylko status, ale też sloty, placementy, strony, linie,
   decyzje, ostrzeżenia i PNG.
5. Dopiero po uzyskaniu parytetu podłączać ten moduł do adaptera
   `ReportData`/`jsPDF`, zachowując prototypowy renderer PNG jako tanią ścieżkę
   debugowania.

Wymaganie „ten sam output” oznacza domyślnie:

- ten sam wynik accepted/rejected i te same powody;
- tę samą liczbę stron, kolejność flowów i podział treści;
- te same geometryczne sloty, placementy i decyzje;
- identyczny albo zaakceptowany przez istniejący próg PNG;
- zgodność tekstu i geometrii PDF, jeżeli fixture produkuje PDF.

Jeżeli nowy model ma celowo naprawić błąd prototypu, nie aktualizujemy
hurtowo snapshotów. Najpierw oznaczamy przypadek jako świadomą zmianę
kontraktu, zapisujemy przyczynę, dodajemy regresję starego błędu i dopiero
przenosimy jego oracle. W ten sposób zmiana nazw i typów nie rozlewa się na
zmianę zachowania.

Kopia kernela jest etapem przejściowym, nie docelowym duplikatem. Po przejściu
corpus i podłączeniu produkcyjnego wejścia stary prototyp powinien zostać
zredukowany do kompatybilnego harnessu albo usunięty, ale testy i ich artefakty
porównawcze pozostają własnością silnika.

### Blokery podmiany silnika

Podmianę można uznać za bezpieczną dopiero wtedy, gdy nowa ścieżka potrafi
przejść obecny corpus treści i brandów oraz jawnie obsłużyć następujące
przypadki:

- wielostronicowe `main` z różną liczbą kolumn na kolejnych layoutach;
- sidebar istniejący tylko w wybranych layoutach;
- sloty i grafiki rozpychające lub wykluczające tekst;
- keep rules dla nagłówków, intro i krótkich klastrów;
- RTL, LTR, `vertical-rl` i `vertical-lr` tam, gdzie backend je wspiera;
- za duże grafiki, zbyt długie tokeny i brak kompatybilnego slotu;
- ostrzeżenia i odrzucenia przekazywane przez MCP/CLI;
- realne fonty i assety brandowe, a nie wyłącznie placeholdery.

Jeśli którykolwiek z tych przypadków działa tylko dzięki ukrytemu wyjątku w
rendererze, migracja nie jest zakończona — nawet gdy obraz wynikowego PDF-u
wygląda poprawnie dla prostego fixture'u.

## Krytyka planu przed przełączeniem produkcyjnym

Niezależna krytyka Sola potwierdziła kierunek, ale uznała obecny plan za
niekompletny jako plan produkcyjny. Poniższe punkty są bramkami P0, a nie
opcjonalnymi usprawnieniami.

- **AST musi być minimalnym kontraktem semantycznym.** Na tym etapie wystarczą
  węzły treści, dzieci, role semantyczne, referencje assetów i przypisanie do
  flowu. Nie dokładamy jeszcze wersjonowania, stabilnych identyfikatorów,
  provenance ani source ranges; to późniejszy hardening granicy integracyjnej.
  Już teraz wymagamy jednak jawnego typed diagnostic dla utraty lub
  nieobsłużenia authored contentu.
- **Słownik layoutu musi być zamknięty.** `layout`, `region`, `slot`, `flow`
  i `route` muszą mieć jednoznaczne znaczenia. Wersja
  template'u musi deklarować zakończenie route'u, relacje anchor, fallbacki,
  deterministic tie-breaks oraz limity prób i stron, aby wybór layoutu nie
  mógł wejść w cykl.
- **Constraints muszą być twarde zgodnie z deklaracją.** Required keep,
  utrata treści, overflow linii i brak wymaganego assetu kończą się rejectem.
  Preferred keep, underfill oraz jawnie dozwolone scale/defer mogą dawać
  warning lub decision. Nie używamy statusu `accepted-with-decisions` jako
  substytutu jakości — decyzje są częścią każdego planu.
- **Remainder musi być dokładny.** Każdy flow musi zwracać monotoniczny zakres
  źródła: `consumedRange`, `remainingRange`, `remainingRows` dla tabel,
  `reason` i `lastLegalTarget`. Częściowo wyrenderowany akapit nie może zgubić
  suffixu tylko dlatego, że pierwsza linia została umieszczona; analogicznie
  nieumieszczona tabela raportuje zakres wierszy.
- **Potrzebne są dwa evaluatory.** Plan evaluator sprawdza constraints i
  coverage przed rysowaniem. Artifact evaluator sprawdza PDF/PNG po rysowaniu:
  obecność, brak duplikatów i dodatkowego tekstu, kolejność, strony, geometrię
  oraz zgodność z planem. Samo wygenerowanie PDF nie jest dowodem sukcesu.
- **Typografia wymaga capability preflight.** Płytkie `measureText` wystarcza
  dla kontrolowanego Latin LTR spike'a, ale nie dla shaping, fallbacku,
  clusterów, bidi, CJK ani vertical writing. P0 powinno fail-closed dla
  niezweryfikowanych systemów pisma, zamiast udawać pełną obsługę.
- **Trzeba przygotować macierz parytetu.** Dla każdego pola `ReportData`,
  layoutu, brandu, fontu, assetu i trybu wielostronicowego zapisujemy obecne
  zachowanie, nową semantykę, oracle testowy i dopuszczalną różnicę. Bez tego
  „parytet” pozostaje deklaracją.
- **Harness ma znane granice.** Testy planu i PNG są wartościowe, ale token
  multiset nie dowodzi kolejności bidi/shapingu, a adapter fixture'ów może
  spłaszczać tabele, obrazy i inline styling. Te luki muszą być jawnie
  oznaczone jako acceptance gaps.
- **Bezpieczeństwo należy objąć limitem całej próby.** Oprócz obecnych limitów
  ZIP/source/image potrzebne są limity dokumentu, glyphów, stron, assetów,
  prób planera i czasu oraz jawna polityka remote hosts/redirectów dla danego
  deployment profile.

### Zaktualizowana kolejność P0

Przed przełączeniem pierwszego layoutu A4 zamykamy: (1) minimalny AST i
diagnostykę utraty treści, (2) słownik template v2 oraz capability matrix, (3) exact remainder i twardy
plan evaluator, (4) typography/asset preflight, (5) artifact evaluator oraz
macierz parytetu dla jednego realnego layoutu i brandu. Dopiero zaliczenie tych
bram uprawnia do pionowego slice'a z nowym rendererem; kolejne layouty,
vertical writing, arbitralne kontury i tagged PDF są późniejsze.

Wersjonowanie AST, stabilne identyfikatory, provenance i source ranges pozostają
świadomym zadaniem hardeningowym po ustabilizowaniu podstawowego modelu i
granicy integracyjnej. Nie są wymaganiem, które ma opóźniać działający
prototyp.

## Obecny kontrakt prototypu

```js
const metrics = {
  units: 'mm',
  family: 'brand-family',
  measureText(text, styleName) {
    return widthInMillimetres;
  },
  lineHeight(styleName) {
    return leadingInMillimetres;
  },
};

const { plan } = planFixture(fixture, metrics);
```

`units` musi być obecnie równe `mm`. `measureText` i `lineHeight` muszą zwracać
wartości skończone i dodatnie (szerokość może wynosić zero dla pustego tekstu)
w tych samych jednostkach, których używa geometria strony. `styleName` jest
rozwiązywany przez adapter; planner zna tylko role `body`, `sidebar`, `heading`
i `intro`. Wynik planowania zawiera linie i sloty, ale nie dokument PDF.

## Sloty w przepływie

`flowBoxes` są technicznym, legacy formatem prototypu. Docelowo planner
materializuje je jako sloty: konkretne miejsca na stronie przypisane do
regionu, treści lub flowu. Legacy pole `intro` jest normalizowane do tego
samego rodzaju deklaracji co pozostałe regiony.
Slot może mieć własny tekst, styl, padding, zakres regionów i politykę strony.
W prototypie `pagePolicy: first-page-only` oznacza, że slot jest umieszczany
wyłącznie na stronie 1; kolejne strony dostają ten sam master kolumn, ale bez
ponownego slotu.

Slot nie jest bezwarunkowo dostępnym celem. Każdy placement zużywa jego
pojemność i może zmienić slot z otwartego na częściowo dostępny albo wyczerpany.
Przed następnym placementem planner ponownie sprawdza wysokość, exclusion,
keep rules i overflow policy. Slot wyczerpany nie może przyjąć kolejnego
placementu; planner przechodzi do następnego slotu na route albo zgłasza
residual content, jeśli legalnego celu już nie ma.

Dzięki temu ten sam mechanizm obsługuje zarówno kolumnę przyjmującą wiele
fragmentów tekstu, jak i slot grafiki, który po jednym placement staje się
zamknięty.
Projekcja legacy do kontraktu oznacza ten stan na podstawie faktycznego
obwiedni placementów; nie raportuje już wszystkich slotów jako `open`.
Niezależny sidebar może mieć `sidebarStart: prelude`, wtedy zaczyna się na
wysokości intro zamiast czekać na jego zakończenie; na kolejnych stronach wraca
do standardowego body top.
Pusty slot bez jawnej wysokości zapada się do zera i nie zachowuje paddingu ani
marginesu. Wysokość slotu z treścią wynika z jego line-boxów. Zmiana liczby słów zmienia więc
`bodyTop` pierwszej strony i liczbę fragmentów, które mogą się na niej zmieścić.

Slot może jawnie wskazać `spanRegions`, np. `lead`, `secondary` i `sidebar`.
Slot typu `block` przepycha tylko wskazane regiony; dlatego intro nad
`secondary` i sidebarem nie powinno opuszczać leadu. Slot typu `float` jest
prostokątną barierą podobną do obrazu: dostaje własne line-boxy, a tekst
artykułu dostaje w kolejnych liniach zmniejszoną szerokość. To jest świadomie
prosty prototyp „cytatu w poprzek kolumn”, nie pełny silnik arbitralnych
kształtów tekstowych. Jeżeli `spanRegions` obejmuje sidebar, jego niezależny
strumień również widzi tę barierę. Gdy pozostawiona szerokość nie mieści nawet
pojedynczego słowa, planner przenosi linię pod slot zamiast produkować ukryty
overflow; słów nie łamie.

### TODO: logiczne grupy zaznaczania PDF

Rozważyć w przyszłości rozdzielenie `paintOrder`, `readingOrder` i
`selectionGroup`, ewentualnie przez tagowany PDF. Zwykłe warstwy PDF/OCG
sterują przede wszystkim widocznością i nie dają wiarygodnej kontroli nad tym,
co natywny viewer zaznaczy podczas przeciągania. To eksperyment o bardzo niskim
priorytecie; nie jest wymaganiem jakościowym ani blokadą wymiany silnika.

Przypadki obejmujące ten kontrakt generuje:

```text
npm run test:prototype-flow-boxes -- --out /tmp/report-baby-flow-box-contract
```

Harness sprawdza jednocześnie plan i PNG/PDF: slot musi pokrywać zadeklarowany region,
jego line-boxy nie mogą wyjść poza granice, nie może pojawić się na stronie
kontynuacji, a wymagany keep nagłówka i treści musi pozostać w jednym
regionie. Zbyt wysoki slot ma status `rejected` i kod
`FLOW_BOX_OVERFLOW`; nie produkuje PDF.

Fixture `flowBoxFloatQuotes` sprawdza dodatkowo dwa sloty-cytaty zachowujące się
jak obrazy: pierwszy przecina lead i secondary, drugi zajmuje fragment
secondary, a tekst ma omijać ich prostokąty bez kolizji.

`createJsPdfTextMetrics(doc)` jest adapterem dla aktualnego renderer’a. Jest
tworzony dopiero w ścieżce CLI, która faktycznie generuje PDF. `jsPDF` jest
ładowany dynamicznie, więc test planera może użyć sztucznego adaptera metryk i
nie tworzy dokumentu PDF. Atomiczne KPI i wykresy mają osobne capabilities
`measureBlock`/`blockRenderers`; chart jest deklarowany jako `type: chart`, a
nie wciskany do slota tekstowego. Po planowaniu renderer nie łamie ponownie slotów:
plan zapisuje ich line-boxy w technicznym `plan.boxes`, tak samo jak line-boxy treści.
Nadal mierzy szerokości słów przy justowaniu, ponieważ jsPDF potrzebuje tych
metryk do rozstawienia słów w już wybranej linii; nie podejmuje jednak decyzji
o tym, które słowa należą do linii.

## Odpowiedzialności

Planner:

- interpretuje strukturę bloków i politykę łamania;
- korzysta z metryk tekstu;
- wylicza sloty, line boxes, exclusion geometry i decyzje;
- zwraca plan, diagnostykę i outcome.

Adapter backendu:

- ładuje fonty i zna ich metryki;
- mapuje style na konkretne API renderer’a;
- renderuje zaakceptowany plan;
- zgłasza backendowe ograniczenia, których plan nie może spełnić.

Evaluator:

- działa na planie, nie na obiekcie PDF;
- decyduje, czy artefakt jest eligible do renderowania;
- nie powinien być zastępowany przez samą obecność pliku PDF.

## Status refaktoru

Warstwa produkcyjna ma już pierwszy renderer-neutralny model TypeScript w
`server/src/composition/`. `compositionDocumentFromReportData` zachowuje
obecny porządek pól raportu, normalizuje Markdown/structured content do
wspólnego modelu bloków, tworzy named flows `main`/`footer` i nie zna jsPDF.
`resolveReportPlan` korzysta z tego modelu do rozpoznania obecności intro oraz
logicznych grup treści, przy zachowaniu dotychczasowej geometrii. Test
`test:composition-data-adapter` sprawdza pełny zestaw bloków, zachowanie
obrazów i diagnostykę odrzuconego fragmentu oraz zapadanie pustego intro.
Ścieżka renderowania buduje dokument raz i przekazuje go do planu, a
`ResolveReportPlanInput` pozwala później podać plannerowi ten sam
znormalizowany dokument bez ponownego parsowania.
Minimalny kontrakt `server/src/composition/engine.ts` rozdziela planner,
evaluator i backend: plan opisuje strony, sloty, placementy, linie, decyzje,
diagnostykę oraz residual content, a backend nie jest wymagany do obliczeń.
Test `test:composition-engine-contract` pilnuje tej granicy przez wstrzyknięte
implementacje testowe.

Kontrakt tekstowego przepływu jest już w osobnym, renderer-neutralnym module
`server/scripts/prototype-composition-text-flow.mjs`; nie importuje on jsPDF.
Sam algorytm planowania nadal znajduje się w pliku prototypowego kernela.
Pierwszy etap adopcji jest już rozpoczęty przez
`server/scripts/lib/composition-engine.mjs`: udostępnia on semantyczny input
`flows.main`/`flows.sidebar`, tłumaczy go na legacy fixture i deleguje do
istniejącego kernela. Test `test:prototype-engine-adapter` dowodzi, że dla
tego samego fixture'u plan starego i nowego wejścia jest identyczny.
Test `test:prototype-engine-adapter-corpus` rozszerza tę gwarancję na cały
zaadaptowany corpus Report Baby; każdy przypadek musi zachować plan względem
legacy kernela, a nie tylko status i liczbę stron.

### Walidacja po pierwszym wejściu seamu do produktu (2026-08-27)

Przeszły: `npm run build`, hostowy `npm test`, `test:composition-data-adapter`,
`test:report-plan`, `test:prototype-planner-seam`,
`test:prototype-engine-adapter`, `test:prototype-engine-adapter-corpus`,
`test:prototype-flow-boxes` oraz corpus 199 fixture'ów kompozycji.

Dwa starsze corpusy wymagają osobnej rekalkibracji i nie zostały po cichu
zaktualizowane: `test:prototype-boundary` obserwuje 31/32/33/34 linii zamiast
deklarowanych 30/31/32/33, a `test:prototype-breaking` obserwuje pięć
warningów `UNDERFILL_PROTECTED_BREAK` więcej niż manifest. Kernel i manifest
tych corpusów nie były zmieniane przez ten seam; przed zmianą oracle trzeba
ustalić, czy poprawić logikę underfill, czy świadomie zmienić kontrakt testów.

Następny etap powinien przenieść samą implementację planowania do
importowalnego modułu bez `process.argv`, globalnego brandu i efektów
ubocznych, a następnie użyć tego samego interfejsu w MCP/CLI i testach.

Test seamu:

```text
npm run test:prototype-planner-seam
```

Test używa wymienialnego adaptera metryk i nie przekazuje plannerowi `jsPDF`.

### Renderer-neutralny planner tekstu i adapter geometrii (2026-08-27)

Pierwsza implementacja algorytmu została przeniesiona do importowalnego
`server/src/composition/text-planner.ts`. Przyjmuje ona jawny template z
layoutami, slotami i trasami flow oraz adapter `CompositionTextMetrics`; nie
ładuje `jsPDF` i nie korzysta z globalnego kontekstu CLI. `evaluator.ts` sprawdza
granice line-boxów, placementów, duplikaty zakresów oraz rzeczywiste kolizje
line-boxów w tym samym slocie. Residual content ma zakres zużytych i
pozostałych słów.

Slot może opcjonalnie deklarować `allowedRoles`. To nie jest osobny rodzaj
bloku: np. intro nadal jest zwykłym tekstowym boxem, ale template może
powiedzieć, że ten box przyjmuje wyłącznie rolę `intro`. Dzięki temu następny
akapit omija wolne miejsce intro i trafia do kolumn, a gdy nie ma już legalnego
slotu na stronie, planner podejmuje decyzję o przejściu na kolejną stronę.

`compositionTemplateFromPageGeometry` tłumaczy istniejący szablon
`pages/editorial-two-column` i jego `PageGeometry` na dwa layouty: pierwszy z
intro i kolumnami przyciętymi pod intro oraz layout kontynuacji z kolumnami.
Jeżeli YAML deklaruje `page.continuation`, drugi layout korzysta z jego
geometrii, więc liczba i szerokość kolumn mogą zmienić się między stronami.
Test `test:page-template-adapter` używa prawdziwego YAML, kompilatora template'u
i realnej geometrii, a długi, deterministyczny lorem ipsum sprawdza przejście
na stronę kontynuacji. To jest działający seam dla jednego layoutu; publiczny
`render_report` korzysta z niego dla wspieranego editorial slice, a
`createJsPdfTextBackend` wykonuje zaakceptowany plan. Pozostałe pola nadal mają
jawny legacy fallback, dopóki nie przejdą osobnych testów parytetu.
Planner tekstowy jawnie odrzuca metric/chart/table, jeśli nie ma dla nich
odpowiedniej capability, zamiast udawać, że blok został wyrenderowany. KPI i
chart mają jawne capabilities atomowego placementu, a table używa osobnej
capability `measureTable` i placementów z zakresem wierszy. Nagłówek tabeli jest
powtarzany przy kontynuacji; brakujące lub zdublowane wiersze odrzuca
evaluator.

Po tej zmianie pełna kompilacja, hostowy test publicznego zachowania, test
brandowy, test adaptera A4, test planera tekstowego, test granicy obrazów oraz
corpus fixture'ów przeszły ponownie. Nie jest to jeszcze dowód gotowej podmiany
silnika całego raportu: istniejący fallback nadal obsługuje title page oraz
część bloków atomowych.

### Pierwszy wykonywalny backend PDF

`server/src/composition/js-pdf-adapter.ts` zamyka pierwszy kontrakt wykonawczy:
`createJsPdfTextMetrics` przekazuje plannerowi `getTextWidth()` i line-height,
a `createJsPdfTextBackend` rysuje zaakceptowane line-boxy na właściwych stronach
PDF. Oba elementy są adapterami — rdzeń planera nadal nie zna `jsPDF`.
Style (`fontSize`, `lineHeight`, `baselineOffset`, `fontStyle`) są wymagane od
wywołującego, więc następny krok może wstrzyknąć wartości z brandu i YAML-a.
Test `test:js-pdf-adapter` tworzy prawdziwy dwustronicowy PDF i sprawdza KPI,
trzy typy wykresu oraz tabelę dzieloną po wierszach. Nadal nie jest to pełny
renderer raportu ani obsługa authored assetów.

Kolejny krok dodał do modelu `CompositionGraphic` oraz placementy grafik.
Grafika wskazuje `graphic slot`, kształt (`rectangle`, `ellipse`, `triangle`,
`star` lub `polygon`), stronę i tryb `wrap`. Gwiazda wymaga jawnego
`vertexCount` i `innerRatio`, a wielokąt jawnych punktów. Wspólna geometria kształtów jest
używana przez planner do wyznaczania dostępnych przedziałów każdej linii oraz
przez evaluator do wykrywania wejścia tekstu w faktyczny kształt, a nie tylko w
jego prostokąt graniczny. Adapter PDF potrafi narysować te kształty przez
`jsPDF`, jeśli otrzyma jawny styl graficzny. Grafika zadeklarowana na stronie,
której tekst nie wymusza, nadal materializuje tę stronę; grafika bez deklaracji
strony trafia wyłącznie na stronę 1.
Test planera obejmuje wszystkie pięć kształtów, pełne zasłonięcie slotu przez
grafikę, grafikę na pustej stronie 2 oraz kontrolę, że line-box nie wchodzi w
faktyczny obszar kształtu.

### Wynik krytyki Sola i aktualny krok ekstrakcji (2026-08-27)

Sol ocenił ten stan jako **NO-GO dla podmiany renderera**. Krytyka nie
unieważnia seamu, ale precyzuje, czego nie wolno uznać za zakończenie migracji:

- `CompositionDocument` i `CompositionPlan` są na razie kontraktem przejściowym;
  residual content musi zawierać dokładny zużyty i pozostały zakres słów albo
  wierszy, a nie tylko `blockId` i powód;
- `server/scripts/lib/composition-engine.mjs` jest adapterem harnessu, nie
  produkcyjnym silnikiem — obecnie dopuszcza tylko `main` i `sidebar`, a
  metryki, wykresy i tabele projektuje do tekstu wyłącznie dla zachowania
  parytetu z legacy kernelem;
- `resolveReportPlan` nadal nie jest konsumowany przez `CompositionPlan`, a
  `report-renderer.ts` wciąż renderuje proceduralnie; plan nie jest jeszcze
  autorytatywny dla PDF;
- przed przełączeniem potrzebny jest artifact evaluator porównujący wynik PDF/
  PNG z planem oraz macierz parytetu dla pól `ReportData`, brandów, fontów,
  assetów i kontynuacji stron;
- brak pełnego shaping/bidi/CJK/vertical-writing oraz brak rzeczywistych
  assetów w corpusie pozostaje jawnie otwartym ryzykiem, a nie dowodem ich
  obsługi.

Wykonany krok ekstrakcji pozostawia `planFixture` jako kompatybilne wejście
legacy, ale dodaje `createPrototypePlanner(options)` w
`server/scripts/prototype-composition-kernel.mjs`. CLI wybiera domyślny
kontekst, natomiast test lub przyszły adapter może wstrzyknąć stronę, layout,
style, konfigurację, kolory, brand i preset. Planner nadal używa wyłącznie
adaptera `CompositionTextMetrics`; dynamiczne ładowanie jsPDF pozostaje tylko
w ścieżce renderującej CLI. `lib/composition-engine.mjs` korzysta już z tej
fabryki, a test adaptera sprawdza także layout wstrzyknięty poza CLI.

To jest świadomy etap przejściowy dla legacy harnessu. Główny planner jest już
importowalnym modułem w `server/src/composition/`; następny krok musi usunąć
równoległą proceduralną ścieżkę z `report-renderer.ts`, a nie tworzyć kolejny
adapter oparty na globalnym kontekście.

Równolegle kontrakt istniejących template'ów przyjął opcjonalne deklaracje
`flows`: każdy nazwany flow wskazuje kolejność slotów i mówi, czy może być
kontynuowany na kolejnych stronach. Walidator odrzuca nieistniejące sloty i
nieznaną politykę kontynuacji. Dotychczasowe template'y bez `flows` pozostają
kompatybilne; `pages/editorial-two-column` deklaruje `main -> content` oraz
`footer -> footer`.
Test `test:template-flow-contract` chroni tę prostą granicę template/engine.

### Planner path z wejściem Report Baby (2026-08-27)

`report-shadow.ts` składa istniejące wejście `ReportData` przez
`compositionDocumentFromReportData`, tłumaczy prawdziwy YAML strony na layout i
tworzy metryki z `jsPDF.getTextWidth()`. Style i offsety baseline'u pochodzą z
`render-config.yml`, więc test nie ma drugiego, ukrytego zestawu wartości
typograficznych. Wynik zawiera dokument, template, metryki, plan i ewaluację;
można go od razu przekazać do `createJsPdfTextBackend`.

Adapter strony obsługuje teraz również zadeklarowane flow pomocnicze, jeśli ich
nazwa odpowiada pasmu albo ramce strony. W `editorial-two-column` `footer` jest
więc zwykłym tekstowym slotem `flow:footer`, z kontynuacją zabronioną. Flow,
którego template nie umie umiejscowić, nadal kończy się jawnym błędem przy
adaptacji — treść nie może zniknąć dlatego, że adapter zgadywał.

`test:report-composition-shadow` sprawdza realne `ReportData`, deterministyczny
lorem ipsum, intro, wielostronicową kontynuację i footer, a także customowe
sloty KPI, chartu i fragmentowanej tabeli. Osobny test granicy obrazów podaje
rzeczywisty asset przez `SourceContext`: publiczny tor planuje obraz jako
atomowy blok, rysuje go dokładnie raz, zachowuje podpis i sprawdza tekst obok
oraz pod nim. To jest pierwszy wykonywalny tor od danych produktu do planu i
artefaktu z authored obrazem. Pełna parytetowa integracja z brandowym
headerem nadal nie istnieje.

`renderReportCompositionPdf` jest seamem integracyjnym dla istniejącego
template'u page: używa brandowego ładowania fontów, planuje `ReportData` przez
CompositionDocument, renderuje zaakceptowany plan przez adapter jsPDF i
dokłada istniejący chrome. `renderReportCompositionShadowPdf` pozostaje
kompatybilną nazwą dla harnessu. Nieprzepięte możliwości mają jawny legacy
fallback; odrzucony plan nie jest przekazywany do backendu.

### Fail-closed acceptance gate (2026-08-27)

Ewaluator nie może uznać planu za poprawny tylko dlatego, że wszystkie
zaplanuowane line-boxy mieszczą się w slotach. Dla każdego niepustego bloku
sprawdza teraz ciągłość zakresów słów od zera do końca; brak zakresu, luka,
nakładanie albo zakres poza długością bloku daje błąd. Diagnostyki wejścia są
przenoszone do wyniku jako ostrzeżenia, a wynik bez błędów, ale z ostrzeżeniami,
ma status `accepted-with-warnings`.

Planner path ma dodatkowy preflight pól `ReportData`: metadata nagłówka i
`title_page` nadal nie są przez niego rysowane; KPI, chart i tabela są
akceptowane tylko wtedy, gdy template deklaruje właściwy block slot i caller
przekazuje capability pomiaru oraz renderera. Dzięki
temu backend nie dostaje artefaktu, który wygląda na sukces, choć zgubił część
wejścia. Ten gate jest włączony do `npm test` przez
`npm test -- --suite composition`.

Świeża krytyka Sola potwierdziła: pierwszy planner path jest dobrym krokiem
migracji, ale podmiana renderera całego raportu nadal ma status NO-GO. Następne blokery to parytet z
oracle'em, realne assety i captiony, powtarzalny header/footer z numeracją,
pełny backend pól ReportData, style/justowanie/widows-orphans oraz porównanie
PDF/PNG i selectable text z wynikiem planu. Corpus prototypowy pozostaje
regresją starego kernela, dopóki nie zostanie przepięty na TypeScript planner.
