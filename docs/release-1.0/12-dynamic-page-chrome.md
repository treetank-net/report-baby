# Plan 12 — dynamiczny page chrome i powtarzalne flow

Status: wykonany dla zakresu release’u. Dynamiczne sloty tekstowego headera,
powtarzalny footer oraz jawny blok `lockup` mają zerową ramę startową,
`fit_content`, wspólny pomiar i przesuwanie slotów `main`. Legacy rendererowy
fallback logo pozostaje świadomie dla niemigrowanych, stałych template'ów;
automatyczna materializacja lockupu z profilu marki jest osobnym zakresem 1.1.

Ten punkt wyciąga z wcześniejszych dokumentów pozostałą pracę dotyczącą
headera, footera, numeracji stron i innych elementów page chrome. Punkt 02
pozostaje zamkniętym punktem dotyczącym wspólnej geometrii ramek. Ten dokument
opisuje nowy kontrakt zachowania chrome opartego na rzeczywistej zawartości.

## Granica przyjęta dla release 1.0

W 1.0 dynamiczny chrome jest dostępny tam, gdzie template deklaruje jawne
flowy `header`/`footer` i ich sloty. Niemigrowane template'y zachowują swój
stały, rendererowy fallback logo jako świadomie zachowaną kompatybilność
wizualną; nie jest on drugim plannerem ani źródłem geometrii dynamicznego
template'u. Automatyczne tworzenie bloku `brand-lockup` z samego profilu marki,
usunięcie tego fallbacku ze wszystkich stałych template'ów oraz pełna
kalibracja wizualna należą do release 1.1/1.2. Dzięki temu 1.0 ma jeden nowy
kontrakt dynamiczny i nie zmienia bez potrzeby istniejących artefaktów.

## Cel

Elementy u góry i dołu strony mają być planowane tak samo jak pozostałe sloty,
ale z jawną polityką powtarzania i jawnym trybem wysokości. Stały box jest
dozwolonym wyborem template'u; problemem jest tylko ukryty, stały pas, który
ogranicza `main`, mimo że template nie zadeklarował takiego chrome. Tryb
`fit_content` ma wyliczać geometrię z zawartości zamiast z pustej ramy.

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

## Czy mamy już jednoznaczną definicję template'u i danych?

Nie. Mamy już wszystkie ważne klocki parsera (`slots`, `flows`, `repeat`,
`fit_content`, `overflow`), ale obecny kod nie składa ich jeszcze w jeden
kontrakt chrome:

- template deklaruje ramy i kolejność slotów, ale nie przechowuje ich treści;
- treść przychodzi w `CompositionInput.flows` i jest dopasowywana do slotów;
- `lockup` jest zwykłym atomowym blokiem composition; slot `type: lockup` jest
  adaptowany do kompatybilnego slotu `kind: block`;
- numer strony jest obecnie rysowany równolegle przez renderer i tylko częściowo
  opisany przez flow `footer`;
- `frame.height` jest obecnie wymagane i dodatnie. `fit_content: true` istnieje
  w parserze, ale pełne zwinięcie pustego slotu do zera wymaga zmiany
  materializacji layoutu.

Poniższy kontrakt jest kontraktem punktu 12. Przykład rozdziela
źródło danych od geometrii template'u, żeby nie powstał drugi, ukryty format
chrome.

### Źródło prawdy dla poszczególnych danych

| Artefakt | Odpowiada za | Nie odpowiada za |
|---|---|---|
| `CompositionInput.flows` | tekst i bloki do pokazania oraz kolejność w obrębie flowu | politykę kontynuacji, pozycję, rozmiar i powtarzanie na stronach |
| `PlacementRequests.insertion_flows` | jednorazowe lub request-owned sloty, ich `start_page` i `repeat` | politykę kontynuacji; tę definiuje route template'u, a dynamiczna deklaracja może korzystać tylko z już dozwolonego route'u |
| `CompositionInput.assets` / profil marki | źródło logo/mark oraz domyślną nazwę marki | wybór strony i boxa |
| template `slots` | rodzaj slotu, frame, `fit_content`, `grow`, `overflow`, dopuszczalne role/rodzaje | treść bloku |
| template `flows` | kolejność slotów, `repeat: each-page`, `start_page` i layoutowy harmonogram route'u | pomiar tekstu i rysowanie |
| `CompositionPlan` | zaakceptowane placementy, boxy, obstacles i diagnostykę | wymyślanie brakującej treści |
| `CompositionPagePlan.chrome` | projekcję wynikowych boxów/dekoracji dla backendu | drugi pomiar lub drugi kontrakt numeracji |

### Kanoniczny przykład danych wejściowych

W docelowym kontrakcie header i footer są zwykłymi nazwanymi flowami. Lockup
jest blokiem treści, tak jak tabela lub wykres; nie jest klasą `Header` ani
rendererowym wyjątkiem. Publiczne pola są snake_case, a adapter normalizuje je
do camelCase w `CompositionBlock`.

```yaml
flows:
  header:
    blocks:
      - type: lockup
        id: brand-lockup
        role: header
        lockup:
          mark_asset_id: brand-mark
          label: ACME Logistics
      - type: heading
        id: header-title
        role: header
        text: Freight market outlook
      - type: text
        id: header-period
        role: eyebrow
        text: Q3 2026

  footer:
    blocks:
      - type: text
        id: footer-page-label
        role: footer
        text: "Confidential · {{page.number}} / {{page.count}}"

  main:
    blocks:
      - type: heading
        id: section-1
        role: heading
        text: Capacity and rates
      - type: text
        id: body-1
        role: body
        text: Long-form report content continues here.

assets:
  - id: brand-mark
    source: brand://acme/primary/logo
    alt: ACME Logistics
```

`lockup.mark_asset_id` i `lockup.label` są jedynymi danymi składowymi lockupu.
Brak jednego z nich usuwa tylko brakujący element i jego odstęp; jawny blok bez
obu wartości jest odrzucany jako pusty, a brak obu wartości z domyślnego
profilu marki oznacza, że adapter w ogóle nie materializuje bloku.
Profil marki może dostarczyć te same wartości jako domyślne; adapter
materializuje wtedy blok `brand-lockup` przed planowaniem. Gdy request dostarcza
blok jawnie, wygrywa on z wartością domyślną. Nie utrzymujemy równoległych pól
`name`, `asset`, `description` ani osobnego obiektu `Header`.

Dotychczasowe pola `title`, `subtitle`, `period`, `brand`, `header` i `footer`
pozostają wejściem migracyjnym. Adapter mapuje je do powyższych flowów i bloków;
nie są one drugim właścicielem geometrii. Opcjonalna projekcja
`{{flow.title.blocks[0].text}}` może pozostać ograniczonym, tylko do odczytu
seamem migracyjnym, ale nie jest wymagana w kanonicznym przykładzie i nie może
oznaczać dowolnego dostępu do obiektu.

### Kanoniczny przykład template'u

Template opisuje tylko *gdzie* i *jak* ułożyć te bloki. Treść nie może być
wpisana w `slots.footer-page` ani `slots.header-title`; pochodzi z flowu.
Poniższy fragment używa istniejących nazw kluczy YAML (`type`, `frame`,
`continuation_frame`, `fit_content`, `overflow`, `gap`, `role`):

```yaml
slots:
  header-lockup:
    type: lockup
    frame: { x: 0.086, y: 0.024, width: 0.34, height: 0.045 }
    continuation_frame: { x: 0.086, y: 0.0168, width: 0.34, height: 0.045 }
    role: header
    fit_content: true
    overflow: reject
    gap: 4mm
  header-title:
    type: text
    frame: { x: 0.086, y: 0.078, width: 0.828, height: 0.06 }
    continuation_frame: { x: 0.086, y: 0.071, width: 0.828, height: 0.06 }
    role: header
    fit_content: true
    overflow: reject
  header-period:
    type: text
    frame: { x: 0.70, y: 0.024, width: 0.214, height: 0.035 }
    continuation_frame: { x: 0.70, y: 0.0168, width: 0.214, height: 0.035 }
    role: eyebrow
    align: right
    fit_content: true
    overflow: reject
  footer-page:
    type: text
    frame: { x: 0.086, y: 0.94, width: 0.828, height: 0.035 }
    role: footer
    align: right
    fit_content: true
    overflow: reject

flows:
  header:
    slots: [header-lockup, header-period, header-title]
    start_page: 2
    continuation: forbidden
    repeat: each-page
  main:
    slots: [content]
    continuation: allowed
  footer:
    slots: [footer-page]
    continuation: forbidden
    repeat: each-page
```

Pole `continuation` występuje tu wyłącznie przy flowach template'u. Nie ma go
w `CompositionInput`, ponieważ input dostarcza treść, a nie politykę route'u.
Obecny parser może jeszcze przyjąć stare pole inputu jako metadane migracyjne,
ale nie może ono konkurować z polityką skompilowanego template'u.

W tym przykładzie `frame.height` jest minimalną/stałą ramą wybraną przez
template, natomiast `fit_content: true` pozwala rosnąć do pomierzonej treści.
W pełnej migracji parser i materializer layoutu muszą dodatkowo dopuścić
`height: 0` dla pustego dynamicznego slotu albo wyliczać wysokość grupy po
pomiarze, bez fałszywego minimum z ramy. `overflow: reject` jest tu jawne:
przekroczenie wysokości lub kolizja odrzuca kandydata.

Kolejność w `flows.header.slots` jest kolejnością rozpatrywania bloków, nie
deklaracją trzech konkurujących headerów. Pozycje poziome wynikają z ramek:
lockup i okres zajmują pierwszy wiersz, a tytuł leży niżej. Jeśli potrzebujemy
innej relacji, zmieniamy ramy template'u, nie dodajemy warunku w rendererze.

### Jedna strona — przebieg i własność danych

```text
1. template_ref → wybór first/continuation/title layoutu
2. route.layouts + slotsByLayout → sprawdzenie, czy header/footer działa na tej stronie
3. CompositionInput → normalizacja bloków header/footer/main i assetów marki
4. pomiar lockupu, tytułu, okresu i footer-page (placeholdery mają wspólny resolver)
5. placement headera i wymaganych insertionów → obstacles i wynikowa granica main
6. placement main w pozostałej przestrzeni
7. placement footeru po ustaleniu legalnej strony
8. CompositionPlan → evaluator → pageChrome jako projekcja do PDF/debug/CLI
```

Header i footer nie konkurują o tę samą treść. Konkurują wyłącznie ich boxy i
obstacles; legalność wynika z geometrii, pokrycia bloków, polityki overflowu i
limitów strony. `CompositionPlan.decisions` służy obserwowalności, nie jest
źródłem prawdy legalności.

### Uwaga o `intro`, metrykach i wykresie

W bieżących template'ach `showcase-report*` lista `main.slots` zawiera
`intro`, `metric-1…metric-3`, `chart` i `content`. To jest historyczny skrót
adaptera, a nie docelowa własność tych treści. Docelowo `intro` powinno mieć
własny flow, metryki mogą być grupą bloków w flow `metrics`, a wykres własnym
flowem `chart`; `main` powinien prowadzić główny tekst przez `content`.
Nie tworzymy osobnego flowu dla każdego slotu metryki. Jeżeli wykres jest
rzeczywiście elementem liniowego artykułu, może pozostać blokiem `chart` w
`main`; jeżeli template rezerwuje dla niego osobny obszar otwarcia, należy go
przenieść do flowu `chart`. O przynależności decyduje cykl życia i route, nie
sam `block kind`.

### Co dokładnie znaczy `continuation`?

W repozytorium występuje kilka podobnie nazwanych pól. Nie są one zamienne i
nie wprowadzamy nowej encji ani pola `continuation_block`:

| Pole | Znaczenie | Status |
|---|---|---|
| `CompiledTemplateFlow.continuation` → `CompositionFlowRoute.continuation` | twarda polityka przekroczenia granicy strony przez bieżącą instancję flowu; przejście między kolejnymi slotami tej samej strony nadal jest dozwolone | obecnie używane przez planner; template jest twardym ograniczeniem |
| `CompositionInput.flows[id].continuation` → `CompositionFlow.continuation` | historyczna deklaracja inputu o możliwości kontynuacji | sprzeczna z własnością template'u; usuwamy z publicznego inputu i modelu |
| `PlacementRequests.insertion_flows[*].continuation` | historyczna próba ustawiania polityki request-owned flowu | nie jest docelowym override'em; request może wskazać sloty, ale politykę dostaje z template route'u |
| `continuation_slots` → `continuationSlots` | historyczna lista slotów używana po przejściu z pierwszej strony/layoutu | pole zostanie usunięte; docelowo legalne sloty wynikają z `layoutForPage(page)` i `slotsByLayout` |
| `continuation_frame` → `continuationFrame` | alternatywna rama tego samego slotu na continuation layout | obecnie używana przy materializacji slotu; nie decyduje o zgodzie na przejście |
| `page.continuation` → `PageGeometry.continuation` | alternatywna geometria strony (marginesy, bandy, segmenty) | obecnie używana przez adapter; to geometria, nie polityka flowu |
| `repeat: each-page` | utworzenie osobnej instancji tego samego flowu na każdej już materializowanej stronie | obecnie planowane po zwykłych flowach; każda instancja jest wymuszana z `continuation: forbidden` |

`continuation` pozostaje metadanym template route'u. Opisuje, czy dany flow w
tym konkretnym szablonie jest przeznaczony do kontynuowania po wyczerpaniu
bieżącej strony. Przykładowo bottom bar z przypisami może mieć
`continuation: allowed`, a jego slot `grow.max_height: 0.5` (50% wysokości
strony); page-local sidebar z ciekawostkami ma `continuation: forbidden`. Flaga
nie tworzy jednak miejsca sama z siebie: harmonogram layoutów musi jeszcze
udostępnić kompatybilny slot na następnej stronie.

`continuation` nie oznacza „nie używaj continuation layoutu”, „nie przechodź do
następnego slotu na tej samej stronie” ani „nie twórz następnej strony dla
całego dokumentu”. Dokument input dostarcza wyłącznie treść; nie może zmienić
tej właściwości template'u.

Przykłady rozróżniające te przypadki:

| Flow i route | Co może zrobić jedna instancja |
|---|---|
| `main`, route ma `content` na layoutach kolejnych stron | zapełnić slot strony 1, przejść do `content` na stronie 2 i dalej |
| `main`, route ma `continuation: allowed`, a layout strony 2 ma `content` | przejść na stronę 2, o ile `content` ma legalną pojemność |
| `sidebar`, route ma `continuation: forbidden`, a treść nie mieści się na stronie 1 | pozostała treść daje błąd/residual zamiast strony 2 |
| `footer`, `repeat: each-page`, `continuation: forbidden` | zostać zaplanowany osobno na każdej już utworzonej stronie; nie przenieść jednego placementu na kolejną |
| `quotes`, `continuation: allowed`, `insertion_slots` na stronach 2–5 | przypisywać kolejne quote'y do puli slotów kolejnych stron zgodnie z route'em |
| `quotes`, `continuation: forbidden` | wymagać, aby cała instancja quote-flow zmieściła się w dozwolonych slotach bieżącej strony/route'u |

Docelowo utrzymujemy jedną flagę polityki `continuation` i tylko w template
route. Legalność przejścia jest przecięciem tej polityki z harmonogramem
layoutów: `allowed` bez kompatybilnego slotu nadal kończy się błędem, a
`forbidden` blokuje przejście nawet wtedy, gdy taki slot istnieje.

`continuation_slots` jest oznaczone do usunięcia w refaktoryzacji. Nie będziemy
przenosić go do auxiliary/insertion flowów. `continuation_frame` nadal opisuje
wyłącznie geometrię; podczas migracji może zostać zachowane, dopóki sloty nie
będą w pełni wybierane przez layoutowy harmonogram.

### Zgodność z dotychczasową dokumentacją

Po porównaniu z [kanonicznym opisem Composition](../composition/README.md),
planem 01, 02, 07 oraz audytem Astra wynik jest następujący:

| Obszar | Zgodność | Wniosek |
|---|---|---|
| `main` nie przyjmuje insertion slots ani quote'ów | zgodne | plan 12 tego nie zmienia; chrome i insertiony pozostają poza głównym strumieniem |
| template jest właścicielem geometrii, planner placementów, evaluator legalności, renderer wykonania | zgodne | `pageChrome` pozostaje projekcją, a nie drugim plannerem |
| `{{page.number}}` i `{{page.count}}` jako jeden tekstowy placement | zgodne | zachowujemy istniejącą składnię i nie dodajemy aliasów |
| `reserved_bands` jako obecne źródło geometrii | zgodne po rozdzieleniu czasu | dziś jest aktywne; dopiero migracja 12 może zastąpić je granicą z aktywnych slotów |
| repeated flow planowany po zwykłym flowie | zgodne z obecnym stanem, nie z celem 12 | dokumentacja Astra opisuje fakt; punkt 12 jawnie proponuje zmianę kolejności i wymaga osobnych regresji |
| `CompositionInput.flows[*].continuation` jako właściciel reguły | niespójne z docelową własnością | input ma dostarczać treść; pole usuwamy, aby nie konkurowało z template route'em |
| `PlacementRequests.insertion_flows[*].continuation` jako override template'u | niespójne z docelową własnością | request nie może ustawiać polityki; dynamiczny flow musi korzystać z route'u o właściwej polityce |
| `continuation_slots` dla każdego flowu | świadomie usuwane | obecny parser i adapter mają to pole, ale docelowo legalne sloty wynikają z harmonogramu layoutów; nie rozszerzamy tej ścieżki |
| `overflow`, `gap`, `fit_content` dla każdego slotu | częściowo zgodne | parser je kompiluje, lecz adapter composition gubi `overflow` i `gap`, a block slots nie przenoszą `fit_content`; plan 12 opisuje pracę przyszłą, nie aktualną gwarancję |
| `route.layouts` jako biała lista | wymaga korekty nazwy | to pozycyjny harmonogram layoutów; `slotsByLayout` jest mapą slotów, a nie globalnym allowlistem |
| `start_page` zawsze walidowane | luka | ordinary flow jest walidowany, repeated flow może dziś nie wykonać się w ogóle, gdy start wypada za liczbą już utworzonych stron |
| `lockup` jako block kind | zgodne | input, adapter, slot, capability PDF i test dynamic-chrome traktują lockup jak zwykły blok atomowy |

W konsekwencji nie ma sprzeczności w samym kierunku architektury, ale byłyby
sprzeczności, gdyby fragmenty planu 12 były czytane jako opis aktualnego
runtime. W tym dokumencie każda taka różnica jest teraz oznaczona jako
`obecnie`, `docelowo` albo `luka do migracji`.

## Audyt aktualnych definicji chrome

Ta migracja nie ma zachowywać backward compatibility wewnętrznych funkcji ani
starych ścieżek kodu. Ma zachować dotychczasowy wygląd i znaczenie dokumentu,
o ile nie zmieniamy tego świadomie w nowym kontrakcie. Obecne źródła chrome są
rozproszone:

| Źródło | Co definiuje obecnie | Rola docelowa |
|---|---|---|
| `page.reserved_bands.header/footer` | stały obszar odejmowany od segmentów flow | wynikowa granica geometrii, wyliczana z aktywnych slotów headera/footera |
| `slots.header`, `header-period` | tekstowe ramy nagłówka w `showcase-report*` | zwykłe sloty powtarzalnego flow, mierzone przed `main` |
| `slots.header-lockup` | slot typu `block` z `allowedBlockKinds: [lockup]` | grupa logo + nazwa marki, której geometria jest widoczna w planie |
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
flowami. Jego kanoniczny model ma dwa opcjonalne content bounds:

```text
lockup group
  → mark (asset, opcjonalny)
  → gap_mm (tylko gdy mark i label istnieją)
  → label (tekst marki/opis marki, opcjonalny)
```

`mark` oznacza referencję do assetu, a `label` oznacza tekst obok znaku.
Nie wprowadzamy równoległych pól `name`, `asset` ani `description` na tym
samym poziomie. Obecna nazwa marki jest mapowana na `label`; obecny uppercase
pozostaje stylem wariantu, a nie ograniczeniem semantycznym pola.

Jego rozmiar wylicza jeden kalkulator:

```text
group.width  = mark.width + gap + label.width
group.height = max(mark.height, label.height)
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
    type: lockup
    fit_content: true
  header-period:
    type: text
    fit_content: true
  header-title:
    type: text
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

To jest zapis poglądowy, a nie drugi format konfiguracji. Jedyną kanoniczną
deklaracją pozostają `flows.header.slots` oraz ramy i kolejność slotów w
template'cie; poziome ułożenie wynika z ich relacji geometrycznej. Nie dodajemy
na tym etapie osobnego pola parsera `header_layout`. Nadal jest to jeden
`header` flow, a kalkulator mierzy sloty zgodnie z istniejącymi ramami i zwraca
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
    type: text
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
    type: lockup
    mark: brand-mark
    label: "ACME Logistics"
    fit_content: true
```

Powyższe przykłady są docelowym kontraktem planera; nie oznaczają jeszcze
istniejącej składni parsera. Wartości odstępów, paddingów i limitów pozostają
w `server/templates/render-config.yml`, a nie w literalach TypeScriptu.

### Źródło zawartości i stare struktury danych

Nie tworzymy osobnego modelu danych tylko dla chrome. Dotychczasowe pola
`title`, `header`, `footer`, `brand`, `subtitle` i `period` pozostają źródłem
treści. Adapter normalizuje je do nazwanych flowów (`title`, `header`,
`footer`), a template decyduje, które sloty i layouty przyjmują te flowy.
W ten sposób stare dane nadal opisują *co* ma zostać pokazane, natomiast flow
template'u opisuje *gdzie i w jakiej kolejności* ma to zostać ułożone.

W slotach tekstowych dopuszczamy ograniczone, tylko do odczytu zmienne ścieżki
do znormalizowanych flowów, na przykład:

```text
{{flow.title.blocks[0].text}}
```

Taka ścieżka jest projekcją treści do wskazanego slotu, a nie drugim przebiegiem
tego flowu. Nie pozwalamy na dowolne wywołania ani dowolny dostęp do obiektu.
Brak opcjonalnego źródła zwija slot; brak źródła wymaganego przez template
kończy się diagnostyką i odrzuceniem kandydata. Ten sam blok nie może być
jednocześnie wyświetlany przez projekcję i przez zwykły slot na tej samej
stronie.

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
- docelowo `repeat: each-page` jest oceniane po wyborze layoutu strony.
  `CompositionFlowRoute.layouts` jest wtedy pozycyjnym harmonogramem layoutów,
  a `slotsByLayout` wybiera sloty dla konkretnego layoutu; razem ograniczają
  strony, na których flow ma instancję. Nie jest to globalna biała lista nazw
  template'ów;
- sloty powtarzalnego flow są rozpatrywane przed `main` na każdej stronie;
- wymagane elementy mają pierwszeństwo przed soft insertionami, a soft
  insertiony przed `main` tylko w zakresie zadeklarowanej polityki strony;
- `start_page`, `continuation` i różnice layoutu pierwszej/kolejnych stron
  pozostają właściwościami flow/template'u, nie wyjątkami w rendererze;
- powtarzalny flow nie tworzy samowolnie nowych stron tylko dlatego, że jest
  powtarzany; `ensurePage` stosuje zwykłe reguły legalności i limitów.

### Kanoniczne fazy alokacji miejsca i kolejność paint

Nie opisujemy jednej listy „co rysuje się pierwsze”. Każdy blok ma dwa
niezależne aspekty:

- **fazę rezerwacji** — kiedy planner musi znać jego box, aby wyliczyć legalną
  przestrzeń dla innych bloków;
- **warstwę paint** — kiedy backend technicznie maluje go w PDF.

Faza rezerwacji musi najpierw znać wszystkie elementy, które ograniczają
miejsce dla `main`:

```text
1. geometria strony i tło/dekoracje
2. stały chrome: header, lockup, tytuł, inne stałe bloki oraz footer
3. wymagane pomocnicze flowy: intro, metrics, chart i podobne bloki
4. wymagane insertiony oraz page-local/sidebar/quote flowy
5. soft insertiony (w ramach konkretnego kandydata)
6. main — główny tekst w pozostałych legalnych slotach
7. finalizacja planu
```

Punkty 2–5 są rozpatrywane przed `main`, ponieważ ich końcowe boxy stają się
obstacle'ami albo zmieniają granicę dostępnej geometrii. `footer` jest więc
rezerwowany przed `main`, nawet jeśli jego warstwa paint znajduje się po tekście
`main` albo jest po prostu niżej na stronie. Nie oznacza to, że footer ma
„pierwszeństwo wizualne” przed tekstem.

`priority` oznacza siłę roszczenia do zachowania geometrii, a nie
samą fazę planowania, kolejność malowania ani ważność redakcyjną treści.
Wyższa liczba ma wyższy priorytet; poziomy `500`, `400`, ... zostawiają miejsce
na przyszłe podfazy bez renumerowania całej konfiguracji. Używamy numerowanych
klas roszczenia:

W kodzie release 1.0 jest to opcjonalne pole route’u template’u. Parser akceptuje
nieujemną liczbę całkowitą, adapter przenosi ją do `CompositionFlowRoute`, a
planner sortuje flowy malejąco przed materializacją zależnej geometrii (remis
zachowuje kolejność wejściową). Placementy i linie mogą nieść tę samą wartość
do debugowania. Brak pola ma jawnie migracyjne znaczenie wartości
`composition_priority.default` z `server/templates/render-config.yml` (obecnie
`100`), czyli najsłabsze roszczenie geometryczne; nie ma cichego odczytu
`priority` z inputu dokumentu.

| `priority` | Klasa | Przykłady | Skutek konfliktu |
|---|---|---|---|
| `500 template-chrome` | stały chrome | header, lockup, footer, stały sidebar | musi zostać spełniony; brak legalnego miejsca odrzuca plan lub uruchamia dozwoloną politykę strony |
| `400 required-auxiliary` | wymagane flowy pomocnicze | intro, metrics, chart | rezerwują miejsce przed `main`; nie mogą zostać cicho przeniesione do innego flowu |
| `300 required-insertion` | wymagany insertion | wymagany quote, sidebar page-local lub inny twardy insertion | rezerwuje obstacle przed `main`; jeśli nie ma legalnego miejsca, cały kandydat jest nielegalny |
| `200 primary-flow` | główny flow | `main` | podstawowa treść dokumentu; jest planowana po rezerwacji ograniczeń geometrycznych, ale jej brak nadal czyni plan nielegalnym |
| `100 optional-insertion` | opcjonalny insertion | opcjonalny quote, sidebar lub inny soft insertion | może zostać odrzucony w konkretnym kandydacie; nie wypycha wymaganych bloków ani kompletnego `main` |

`priority` nie jest osobnym polem paint-order template'u. Adapter może je
wyznaczyć lub przekazać z wejściowego route'u, planner niesie je razem z
placementem i używa do kolejności materializacji oraz rozstrzygania roszczeń, a
evaluator sprawdza wynikową legalność. Input dostarcza treść; nie może samowolnie
podnosić roszczenia flowu. Faza rezerwacji nadal wynika z zależności
geometrycznej: planner najpierw mierzy i umieszcza tymczasowo element o wyższym
roszczeniu, rejestruje jego box/obstacle, a dopiero potem wylicza geometrię
elementów zależnych. To jest materializacja planu, nie fizyczne rysowanie PDF-u.

Jeśli dwa elementy tej samej klasy konkurują o miejsce, kolejność ich slotów i
ewentualny tie-breaker definiuje template. Nazwy flowów nie tworzą ukrytego
wyjątku w plannerze. Sidebar stały należy do `500 template-chrome`, a
page-local ciekawostki do `300 required-insertion` albo `100 optional-insertion`,
zależnie od wymogu.

Ta liczba nie rozstrzyga sama konfliktu obowiązkowych bloków: dwa wymagane
bloki muszą zmieścić się jednocześnie albo nie powstaje plan. Dla bloku
`100 optional-insertion` liczba oznacza słabsze roszczenie i możliwość odrzucenia
kandydata, jeśli pozostawi `main` z nielegalnym residualem. Nie oznacza to, że
`main` jest mniej ważny — jest planowany później z powodu zależności
geometrycznej, a nie dlatego, że można go poświęcić.

Kierunek „wyższa liczba = wyższy `priority`” i rozdział tego pola od
fazy oraz paint wynikają z badania [praktyk priorytetów](../research/block-priority-practices.md).
Sama skala `500`–`100` jest konwencją tego repozytorium, nie standardem
narzuconym przez CSS, Kubernetes ani inny zewnętrzny system.

W samym PDF rozróżniamy dwa pojęcia:

- **paint order** — kolejność, w której backend wykonuje operacje rysowania;
- **`z-index`/stack level** — warstwa głębokości decydująca, co jest wizualnie
  nad czym, jeśli boxy mogą się nakładać.

`priority` nie wyznacza żadnego z nich w obecnym backendzie. Przy zwykłych,
niekolidujących boxach paint order nie zmienia legalności. Jeśli kiedyś pojawi
się świadome nakładanie wymagające `z-index`, będzie to osobna decyzja
kontraktu/backendu; nie używamy do tego `priority` i nie wprowadzamy takiego
pola w tej migracji. Jest to zgodne
z rozdzieleniem layoutu i stacking/painting w CSS ([W3C CSS 2.2, layered
presentation](https://www.w3.org/TR/CSS22/visuren.html#layers)).

Obecny paint order backendu pozostaje stały i niezależny od `priority`:

```text
tabele
→ grafiki
→ block placements (ramy i inne renderowane bloki)
→ zwykłe linie tekstu
→ linie insertionów
→ glyphy
```

Footer może więc być namalowany po tekście `main`, mimo że jego box został
zarezerwowany wcześniej. To nie oznacza automatycznie wyższego `z-index` — przy
braku dozwolonego nakładania oba boxy po prostu nie mogą się przeciąć. Dynamiczny
header/footer nie może być jednak malowany poza planem jako drugi, niezależny
mechanizm.

### Słownik istniejących pojęć `order` i `layer`

W dokumentacji występują już nazwy opisujące różne porządki. Nie są one
alternatywami dla `priority` i nie powinny zostać połączone w jedną liczbę:

| Pojęcie | Właściciel | Znaczenie | Relacja z `priority` |
|---|---|---|---|
| `flow`/route order | route i sloty template'u | kolejność, w której treść danego flowu przechodzi przez sloty i strony | ogranicza legalne miejsca; `priority` może ustalić, który route rezerwuje geometrię wcześniej |
| source/visual order | evaluator (`CONTENT_ORDER_VIOLATION`, `QUOTE_ORDER_VIOLATION`) | kolejność authored blocks/fragmentów po materializacji | jest twardą kontrolą legalności, nie paint order |
| `layer: flow \| insertion` | `CompositionLine` i backend | rozróżnienie zwykłego tekstu od tekstu insertionu; backend obecnie maluje insertion lines po zwykłych lines | nie jest warstwą głębokości i nie jest `priority` |
| `paint: boolean` | `CompositionGraphicPlacement` i backend | czy dana grafika ma zostać fizycznie narysowana; `paint: false` może pozostawić samą geometrię obstacle'u | przełącznik widoczności, nie kolejność rysowania |
| `reserved` | `CompositionSlotTemplate` | slot/box zajęty przez chrome lub inną geometrię bez zwykłego flowu | rezerwacja przestrzeni, nie warstwa paint |
| `flowBarrierBoxCandidates` / obstacles | planner i evaluator | geometryczne bariery, wokół których wolno kontynuować tekst | wpływają na obliczenia miejsca; nie są obiektami paint |
| `z_order` w prototypach occlusion | prototypowy raster/QA dla nakładających się grafik | test, który kolor/kształt jest widoczny w fizycznym przecięciu | dotyczy paint-only graphics, poza kontraktem flow/chrome |
| `paintOrder`, `readingOrder`, `selectionGroup` | stary TODO badawczy | możliwe przyszłe tagowanie/warstwy PDF | paint order został odłożony do [release 1.1](../release-1.1/01-paint-order-contract.md); reading/selection pozostają poza zakresem |

W praktyce `priority` jest nowym metadanym roszczenia do wcześniejszej
materializacji geometrii. `order` w route'ach i evaluatorze zachowuje swoje
dotychczasowe znaczenia, a `layer` pozostaje technicznym rozróżnieniem danych
renderowanych. Obecny backendowy porządek jest tylko baseline'em migracji;
możemy go później uczynić jawną polityką i powiązać z `priority`, jeśli
zdefiniujemy kierunek sortowania oraz remisy.

### Właściciel `priority` i kolejności rysowania

W release 1.0 `priority` służy wyłącznie do kolejności materializacji i
rezerwacji geometrii. Jawny paint order nie jest częścią tego kontraktu; jego
osobna propozycja znajduje się w [release 1.1](../release-1.1/01-paint-order-contract.md).
Jedno pojęcie `priority` może kiedyś zasilać również politykę malowania, ale
byłoby to jawne mapowanie backendu, a nie przypadkowy efekt kolejności tablic:

1. adapter może wyznaczyć/przekazać `priority` dla flowu lub placementu;
2. planner przenosi je razem z geometrią i używa do kolejności materializacji
   oraz rozstrzygania roszczeń do miejsca;
3. evaluator sprawdza legalność boxów, coverage i dozwolone kolizje;
4. backend w 1.0 zachowuje dotychczasową, stałą kolejność operacji; w 1.1 może
   stosować jawną politykę faz renderowania.

`priority` odpowiada więc na pytanie „czyją geometrię i obstacle musimy
rozstrzygnąć wcześniej?”. Nie jest drugim kontraktem określającym stacking.
Footer może mieć wysokie `priority`, aby jego box był znany przed `main`, a
backend nadal może narysować go w dotychczasowym miejscu/porządku. Jeśli kiedyś
pojawi się świadome nakładanie wymagające z-indexu, będzie to osobne rozszerzenie
backendu. Jeżeli powiążemy paint z `priority`, trzeba jawnie ustalić, czy
większa liczba oznacza późniejsze malowanie (element wyżej), czy tylko
wcześniejszą rezerwację. Nie może to pozostać nieudokumentowanym skutkiem
kolejności tablic.

`template_ref` wybiera obecnie jeden skompilowany template dla całego
przebiegu composition, więc repeat nie może przypadkiem przejść do innego
template'u. Harmonogram layoutów w route jest wystarczającym mechanizmem
wyjątków dla stron tytułowych i continuation; nie udajemy, że jest walidowaną
listą nazw. Dopiero gdy dokument będzie mógł łączyć różne `template_ref` na
poszczególnych stronach, dodamy analogiczną, obowiązkową białą listę
template'ów; nie wprowadzamy globalnego wyjątku po stronie renderer'a.

Do czasu migracji obowiązuje jednak stan obecny opisany w audycie Astra:
`planDocumentOnce()` najpierw materializuje stronę i planuje zwykłe flowy oraz
insertiony, a dopiero potem wykonuje każdy powtarzalny flow dla już istniejących
stron. Repeat nie wywołuje dziś `ensurePage`; przeniesienie go przed `main` jest
świadomą zmianą punktu 12, a nie zachowaniem już dostępnym w runtime.

Przykład zakresu powtarzania dla obecnego modelu:

| `template_ref` | layout strony | instancja `header` |
|---|---|---|
| `pages/showcase-report` | `pages/showcase-report:title` | nie, route headera nie obejmuje strony tytułowej |
| `pages/showcase-report` | `pages/showcase-report:first` | tylko jeśli route jawnie ma ten layout |
| `pages/showcase-report` | `pages/showcase-report:continuation` | tak, jeśli ten layout występuje w pozycji route'u dla danej strony |
| inny `template_ref` | dowolny jego layout | nie dziedziczy headera z `pages/showcase-report` |

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
- `overflow` zawsze pochodzi z definicji slotu template'u. `fit_content`
  określa, czy box może rosnąć, a `overflow` określa reakcję po przekroczeniu
  ramy lub limitu; brak deklaracji normalizujemy do `reject`. `shrink-to-fit`
  działa wyłącznie wtedy, gdy template jawnie go wybierze, i nie jest
  fallbackiem kodu planera;
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

## Zmiany konieczne i ich konsekwencje

Poniższa lista jest granicą implementacji. Sama zmiana YAML nie wystarczy,
ponieważ obecny pipeline zatrzymuje lockup i numer strony poza zwykłą ścieżką
bloku.

| Miejsce | Zmiana | Konsekwencja / ryzyko |
|---|---|---|
| `server/src/contracts/input/schema.ts` | **wykonane:** `type: lockup` z `lockup.mark_asset_id` i `lockup.label`; rozszerzone `allowed_block_kinds` | publiczny `CompositionInput` ma addytywny rodzaj bloku; walidacja odrzuca brak obu elementów |
| `server/src/composition/contracts/model.ts` | **wykonane:** renderer-neutral `CompositionLockup` i `CompositionBlockKind = ... | 'lockup'` | capability i dispatch są jawnie keyed by `lockup` |
| `server/src/composition/adapters/input.ts` + adapter marki | normalizować lockup oraz materializować domyślny blok z profilu marki tylko wtedy, gdy route ma slot lockupu | stary raport bez `flows.header` może stracić logo, jeśli template nie dostanie jawnego slotu; to jest zamierzona, wykrywalna zmiana kontraktu, nie fallback renderer'a |
| `server/src/composition/adapters/page-template-slots.ts` | **wykonane:** `declaredLockupSlotsForFlow()` zwraca zwykły slot `kind: block` z `allowedBlockKinds: ['lockup']` | lockup jest mierzony, pokrywany i oceniany jak tabela/wykres; nie ma niewidocznej rezerwacji pustego logo |
| `server/src/composition/adapters/page-template.ts` | przekazać `fit_content`, `grow`, `gap`, `overflow` i `continuation_frame`; zastąpić band-only `auxiliaryFrame` dla dynamicznego headera | `reserved_bands.header` przestaje być drugim źródłem granicy; stare template'y bez flowu headera trzeba jawnie sklasyfikować jako fixed albo dopisać do nich flow |
| `server/src/composition/layout/document-layout.ts` | materializować powtarzalny header przed insertionami i `main`, footer po stronie; wyliczać nową granicę przed planowaniem main | zmieni się kolejność placementów i kolejność wpisów debug/decisions; nie wolno reużywać starej kolejności tylko dlatego, że test oczekuje historycznego offsetu |
| capability pomiaru bloków | **wykonane:** pomiar znaku + labelu + gapu z faktycznymi bounds assetu | brak logo nie rezerwuje szerokości; długi label podlega geometrii slotu |
| `server/src/composition/layout/structured-block-placement.ts`, `page-state.ts`, evaluator | **wykonane:** lockup jest blokiem atomowym, z kompatybilnością i wzrostem slotu | lockup w `main` jest możliwy tylko przy jawnym dopuszczeniu rodzaju |
| placeholder resolver + PDF backend | jeden resolver `{{page.number}}`/`{{page.count}}` dla pomiaru, debug i renderu; footer-page jest jednym tekstowym placementem | usuwa się rozjazd między szerokością mierzoną a napisem `${page} / ${pageCount}`; finalny count musi być znany przed renderem, bez drugiego planowania |
| `server/src/report/renderer.ts` | usunąć bezpośrednie malowanie logo, brand name i numeru strony z `drawReportChrome()`; zachować tam tylko dekoracje, których template nie modeluje jako bloków | PDF przestanie “naprawiać” niepełny plan po cichu; template bez footer flow nie pokaże numeru strony, dopóki nie dostanie jawnej migracji |
| `server/src/composition/contracts/engine-contracts.ts` | zachować `CompositionPagePlan.chrome` jako projekcję, ale wskazywać źródłowe placementy/boxy zamiast drugich wymiarów treści | istniejące API debug/CLI może wymagać aktualizacji pól, ale nie zmienia się transport MCP ani nazwy narzędzi |
| `server/templates/pages/*` + `server/src/generated/builtin-template-files.ts` | dodać jawne sloty/flowy header/footer w template'ach, które mają renderować chrome; przebudować wygenerowane pliki | template bez migracji zachowuje tylko świadomie wybrany fixed band albo traci stary rendererowy chrome; `npm run build:templates` jest częścią migracji |
| testy composition/PDF/visual QA | rozdzielić fixture'y fixed i dynamic; dodać brakujące elementy lockupu, długi tytuł, kolizje, 1/10+ stron i title layout | część asercji opartych na `headerBandHeight` musi przejść na wynikowe `slotBoxes`; testy badające konkretny fixed band pozostają bez zmian |

### Skutki dla istniejących template'ów

1. `showcase-report*` ma flow `header` i slot `header-lockup`; dynamiczny
   template ma teraz ten sam slot jako zwykły blok. Trzeba jeszcze dostarczyć
   `brand-lockup` automatycznie z profilu marki, jeśli input go nie podaje.
2. `default-report` oraz template'y `editorial-*` mają obecnie głównie
   `reserved_bands`. Należy wybrać dla każdego z nich jedną opcję: pozostawić
   świadomy fixed chrome jako fixture/regresję albo przepisać go na jawny flow
   header/footer. Nie wolno utrzymywać obu źródeł z różnymi wysokościami.
3. Title layout może mieć footer, ale header nie powinien pojawić się tam przez
   dziedziczenie. `route.layouts` i `slotsByLayout` pozostają białą listą stron,
   na których repeat jest legalny.
4. Jeżeli template ma tylko `reserved_bands.footer` i nie ma footer flowu,
   numer strony nie jest po migracji automatycznie generowany. To jest celowe:
   każde widoczne chrome ma mieć właściciela w template'cie albo być jawnie
   oznaczoną dekoracją.

### Skutki dla publicznego MCP/CLI

Zmiana nie wymaga nowego narzędzia ani nowego trybu wywołania. `render_report`,
`dry_run`, `composition_debug` i ścieżka CLI nadal przyjmują ten sam request;
zmienia się jedynie addytywna unia bloków i wynikowa geometria. Odpowiedź może
zawierać placement lockupu tak jak inne bloki. Kontrakt należy uznać za
niekompatybilny wizualnie dla template'u, który wcześniej polegał na
rendererowym fallbacku logo/numeru strony, dlatego migracja template'ów i
artefaktów wygenerowanych jest obowiązkowa przed usunięciem fallbacku.

## Strategia migracji testów

Istniejące testy często sprawdzają wysokość stałego headera. Nie usuwamy tego
założenia mechanicznie. Każdy fixture otrzymuje jedną z dwóch jawnych
klasyfikacji:

| Rodzaj fixture'u | Ustawienie | Asercja |
|---|---|---|
| testuje geometrię zależną od zawartości | `fit_content: true` | początek `main` i kolejne sloty wynikają z boxa zmierzonego headera |
| testuje konkretny stały band/template | `fit_content` pominięte, stała rama | zachowana wysokość i granica zadeklarowana przez template |

Test nie może przypadkiem sprawdzać stałej wysokości tylko dlatego, że zna
historyczny offset renderera. Oczekiwany offset należy wyprowadzać z planu
(`slotBoxes`, obstacle albo wynikowej granicy chrome). Stała rama pozostaje
tam, gdzie jej zachowanie jest istotą testu, np. regresja konkretnego
template'u, a nie jako domyślne założenie wszystkich testów.

## Zmienne generowane stron

Zachowujemy istniejącą składnię placeholderów:

```text
{{page.number}}  — numer strony od 1
{{page.count}}   — liczba stron zaakceptowanego planu
```

Obie zmienne są dostępne w każdym tekstowym slocie, także w headerze,
footerze i innych powtarzalnych flowach. Nie wprowadzamy aliasów `{page}` ani
`{numberOfPages}`. `pageCount` pozostaje lokalną nazwą implementacyjną.

Nie są to dwa osobne bloki ani dwa placementy. Template deklaruje jeden slot
tekstowy, na przykład `footer-page-number`, którego treść brzmi
`"{{page.number}} / {{page.count}}"`; resolver podstawia obie wartości w tym
samym tekście, a planner mierzy cały wynikowy napis jako jeden blok.

`{{page.number}}` i `{{page.count}}` są podstawiane po ustaleniu finalnego
zaakceptowanego planu, ale ich box jest mierzony wcześniej z szerokością
rezerwowaną dla największej dozwolonej liczby stron (`maxPages`). Dzięki temu
nie wprowadzamy drugiej iteracji planera tylko dlatego, że `9` zmieniło się na
`10`. Pomiar i render korzystają z tego samego kalkulatora szerokości; jeżeli
plan przekroczyłby skonfigurowany limit stron, jest odrzucany jak każdy inny
plan poza limitem.

Przykładowe deklaracje:

```text
footer text: "{{page.number}} / {{page.count}}"
header title source: "{{flow.title.blocks[0].text}}"
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
| `{{page.number}}` zmienia szerokość z `9` na `10` | box był mierzony z rezerwą `maxPages`; render używa tego samego kalkulatora |
| `{{page.count}}` nie jest jeszcze znane | box ma zarezerwowaną szerokość `maxPages`, a finalna liczba jest podstawiana po akceptacji planu |
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
   były rozstrzygnięte przed `main`. **Wykonane dla powtarzalnego headera:**
   header jest materializowany przed zwykłym flow, a nowo utworzone strony
   dostają go w drugim przebiegu bez duplikowania pierwszej strony.
4. Dodać kalkulator dynamicznej geometrii grupy headera i footeru. **Wykonane
   dla headera tekstowego:**
   ma zwracać boxy oraz informację o powodach wzrostu lub zwinięcia.
5. Włączyć wynik kalkulatora do obstacle'ów/ram dostępnych dla `main` i
   insertionów. **Wykonane:** `grow.pushes` przesuwa sloty main podczas
   materializacji headera.
6. Zmienić `pageChrome()` w projekcję wynikowych slotów oraz dekoracji, bez
   niezależnego wyliczania wysokości header band. **Częściowo wykonane:**
   dynamiczny band bierze granicę z aktywnych slotów headera; jawny lockup jest
   już renderowany z planu, a fallback pozostaje tylko dla dokumentów bez bloku.
7. Usunąć hard-coded składanie numeru strony tam, gdzie numer jest już
   zadeklarowanym slotem tekstowym.
8. Dodać walidację legalności dla minimum, maksimum, kolizji, overflowu i
   pustych stron.
9. Uzupełnić debug, `dry_run`, manifest i PDF o tę samą geometrię.
10. Przepisać testy chrome na fixture'y krótkiego, długiego, pustego i
    wielostronicowego headera oraz zmiany liczby cyfr numeracji. **Wykonane dla
    zakresu 1.0:** parser, planner i PDF mają fixture długiego oraz pustego
    dynamicznego headera, jawnego lockupu i powtarzalnego footera; migracja
    automatycznego lockupu z profilu marki pozostaje zakresem 1.1.

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
