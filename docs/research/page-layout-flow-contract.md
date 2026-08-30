# Page layouts and named text flows

Date: 2026-08-26

## Korekta modelu

`first-page-only` nie jest docelową semantyką. Opisuje tylko ograniczenie
obecnego spike'a, w którym jeden globalny layout próbuje obsłużyć wszystkie
strony. Docelowo każda strona wybiera layout/master, a layout deklaruje swoje
regiony. Obecność sidebara, intro albo quote boxa wynika z layoutu danej
strony, nie z wyjątku w strumieniu treści.

## Trzy różne identyfikatory

- `layoutId` — kompozycja strony, np. `opening`, `continuation`, `quote-spread`;
- `regionId` — fizyczny obszar layoutu, np. `lead`, `secondary`, `sidebar`;
- `flowId` — logiczny strumień treści, np. `main`, `sidebar`, `quote`.

Region może przyjmować treść z określonego flow. Ten sam flow może mieć inną
ścieżkę regionów na kolejnych stronach.

```yaml
layouts:
  opening:
    regions:
      - { id: intro, kind: box, span: [lead, secondary] }
      - { id: lead, kind: text, flow: main, order: 1 }
      - { id: secondary, kind: text, flow: main, order: 2 }
      - { id: sidebar, kind: text, flow: sidebar, order: 1 }
  continuation:
    regions:
      - { id: column-1, kind: text, flow: main, order: 1 }
      - { id: column-2, kind: text, flow: main, order: 2 }
      - { id: column-3, kind: text, flow: main, order: 3 }

flows:
  main:
    source: article
    on_exhaustion: continue
  sidebar:
    source: sidebar
    on_exhaustion: warn
```

W tym przykładzie `main` płynie na pierwszej stronie przez niebieski i
zielony region, a na drugiej przez trzy kolumny. `sidebar` ma tylko żółty
region na stronie otwierającej. Jeżeli jego treść się nie mieści, nie znika i
nie jest automatycznie przenoszona do layoutu artykułu: planner zostawia
resztę jako residual content i zwraca ostrzeżenie albo odrzuca plan zgodnie z
polityką flow.

## Boxy i flow

Box w layoutcie może być:

- `block` — zajmuje zadeklarowany obszar i przepycha tylko regiony, które
  przecina;
- `float` — jest przeszkodą podobną do obrazu i zmniejsza dostępną szerokość
  linii w przecinanych regionach;
- `text` — jest zwykłym regionem przyjmującym nazwany flow.

Intro i quote nie są więc typami uprzywilejowanymi. Intro może być blokiem
layoutu, a cytat może być boxem floatującym albo osobnym flow w regionie.

## Planowanie i brak miejsca

Planner buduje strony w pętli:

1. wybiera `layoutId` dla numeru strony;
2. rozwija jego regiony i boxy;
3. dla każdego regionu pobiera następny fragment przypisanego `flowId`;
4. wykonuje keep/widow/orphan i exclusion checks;
5. przy braku miejsca wybiera następny region tego flow albo następny layout;
6. gdy nie ma legalnego celu, raportuje konflikt wraz z pozostałą treścią.

Brak regionu `sidebar` na stronie drugiej jest prawidłową deklaracją, nie
błędem. Błędem jest dopiero niemożliwe wymaganie, np. sidebar-only flow z
większą ilością treści niż jego jedyny region przy polityce `on_exhaustion:
reject`.

## Stan implementacji

Produkcyjny legacy renderer już odczytuje dowolną liczbę kolumn i ich
indywidualne szerokości z YAML przez `pageGeometry`; `Cursor` przechodzi po
segmentach kolejno. Built-in `pages/editorial-three-column` jest fixture'em
tego kontraktu i ma trzy nierówne kolumny, a test legacy przechodzi również
przez wielostronicowy corpus.

Pierwszy produkcyjny seam dla statycznej grafiki to opcjonalne
`page.flow_obstacles`: lista prostokątnych ramek, które wycinają obszar z
segmentów tekstu. Jest to konserwatywna rezerwacja miejsca, szczególnie dobra
dla grafiki rozciągającej się przez kolumny. Opływanie grafiki mieszczącej się
w jednej kolumnie realizuje opcjonalne strukturalne `image.wrap`, a nie
koordynaty w payloadzie LLM. Obecny kontrakt strony stosuje statyczne
`flow_obstacles` do każdej strony danego template'u; wybór osobnego layoutu na
stronę pozostaje następnym krokiem.

Composition engine jest obecnie renderer-neutralnym planerem produkcyjnej
ścieżki raportów. Harness pozostaje szybkim sposobem testowania named flows,
boxów i boundary grafik, ale nie ma osobnego modelu rozmijanego z produkcją.
jsPDF jest adapterem wykonującym zaakceptowane placementy; inne formaty mogą
podłączyć własny adapter do tego samego planu. `report-renderer.ts` zachowuje
publiczne API i przygotowanie assetów, lecz nie powinien ponownie przejmować
decyzji o przepływie tekstu.

## Kontrakt ciągłego flow z wtrąceniami

Wtrącenie w ciągłym flow jest osobnym prostokątem-obstacle, a nie kolejnym
segmentem trasy. Planner stosuje następującą kolejność:

1. mierzy wtrącenie razem z paddingiem i marginesem;
2. rezerwuje jego kandydacki prostokąt przed ułożeniem zwykłego tekstu;
3. układa tekst źródłowy od góry do dołu, a potem od lewej do prawej;
4. traktuje przyszły prostokąt jako twardą granicę, więc tekst przed cytatem
   nie może zostać położony pod cytatem;
5. po cytacie wznawia ten sam slot poniżej obstacle'u, zamiast przechodzić do
   sąsiedniej kolumny.

Planer może wykonać kilka pełnych przebiegów. Kolejny przebieg bierze pozycje
wtrąceń z poprzedniego planu i sprawdza, czy rezerwacje są stabilne. Po
przekroczeniu limitu `pdf.planner_max_iterations` zwraca błąd, a nie plan,
który wygląda na poprawny tylko dlatego, że wtrącenie zostało pominięte.

Reguła wypełnienia jest fail-closed: jeżeli flow przechodzi do kolejnego
segmentu, choć w poprzednim pozostały co najmniej
`pdf.planner_minimum_fragment_lines` użyteczne linie, evaluator odrzuca plan.
Keep-with-next nie może rozdzielić nagłówka; może zostać poluzowane dopiero,
gdy sam nagłówek mieści się w pozostałym miejscu. Nie wolno dzielić nagłówka
ani przepuszczać kolejnego bloku nad wcześniejszym wtrąceniem.

Te zasady są testowane dwutorowo: numerowane słowa sprawdzają kompletność i
kolejność, a test pixel QA sprawdza, czy każdy oczekiwany prostokąt zawiera
atrament oraz czy obszar obstacle'u nie został użyty przez tekst.
