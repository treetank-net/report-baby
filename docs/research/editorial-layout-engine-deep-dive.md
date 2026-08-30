# Editorial layout engine deep dive

Date: 2026-08-26

## Zakres i metoda

To jest research techniczny dla ścieżki editorial Report Baby. Użyte są wyłącznie
specyfikacje W3C, oficjalne dokumentacje, oficjalne repozytoria i ich kod źródłowy.
Każda teza jest oznaczona jako **Fakt** (wynika bezpośrednio ze źródła) albo
**Inference** (wniosek dla Report Baby z kilku faktów). Dokument nie jest
marketingowym rankingiem: ograniczenia i koszty integracji są częścią wyniku.

Stan lokalny Report Baby pochodzi z istniejących, niezmienianych w tym researchu
plików `docs/research/document-layout-engine-landscape.md`,
`docs/research/composition-kernel-prototype-cases.md` oraz prototypu
`server/scripts/prototype-composition-kernel.mjs`.

## 1. Co naprawdę definiują standardy CSS

### Fragmentacja i fallback

**Fakt.** Fragmentainerem jest box strony, kolumny albo regionu; gdy łamliwa
treść przekracza block extent fragmentainera, przechodzi do następnego
fragmentainera. Jeden box może mieć wiele fragmentów. [CSS Fragmentation §2](https://www.w3.org/TR/css-break-3/#fragmentation-model)

**Fakt.** `break-before`, `break-after` i `break-inside` tworzą ograniczenia
łamliwości, a `orphans` i `widows` ograniczają łamanie między line boxes.
Wymuszone łamanie wygrywa z ograniczeniem `avoid`. [CSS Fragmentation §3](https://www.w3.org/TR/css-break-3/#breaking-controls)

**Fakt.** Fallback jest jawnie stopniowany: najpierw usuwa się warunek
widows/orphans, następnie ograniczenia `break-inside` i inne zakazy, a gdy nadal
nie ma miejsca, można ciąć margin/border/padding; jeśli nie ma punktu łamania
poniżej początku fragmentainera, user agent może złamać w dowolnym miejscu,
także pociąć monolityczny element, ale musi zapewnić postęp i nie zgubić treści.
[CSS Fragmentation §4.4](https://www.w3.org/TR/css-break-3/#unforced)

**Fakt.** Specyfikacja rekomenduje mniej łamań, możliwie równomierne wypełnienie
fragmentainerów i unikanie łamania replaced elementów, ale nie narzuca algorytmu
wyboru spośród dozwolonych punktów. [CSS Fragmentation §4.5](https://www.w3.org/TR/css-break-3/#optimizing-unforced-breaks)

**Inference.** Report Baby nie może traktować `keep` jako prostego booleanu.
Musi przechowywać siłę ograniczenia i określać, które ograniczenie może zostać
rozluźnione. W przeciwnym razie fallback silnika będzie niewidoczny dla MCP i
nie będzie można odróżnić akceptowalnej degradacji od utraty jakości.

### Multi-column

**Fakt.** Multi-column tworzy kontekst fragmentacji z anonimowymi column boxes,
które są niezależnymi block formatting contexts. [CSS Multi-column §1–2](https://www.w3.org/TR/css-multicol-1/#intro)

**Fakt.** Gutter zajmuje miejsce i ma wysokość równą wysokości kolumn. `column-fill`
rozróżnia wypełnianie sekwencyjne i balansowanie; element `column-span: all` jest
spannerem wyjętym z przepływu kolumn i przerywa column line. [CSS Multi-column §4](https://www.w3.org/TR/css-multicol-1/#column-gaps-and-rules), [§6](https://www.w3.org/TR/css-multicol-1/#column-span)

**Fakt.** Spanner zmienia strukturę: treść przed nim jest równoważona w
bezpośrednio poprzedzającym multi-column line, a treść za nim zaczyna kolejną
część układu. [CSS Multi-column §6.1](https://www.w3.org/TR/css-multicol-1/#column-span)

**Inference.** „Intro nad kolumnami” i „duża grafika nad/między kolumnami” powinny
być modelowane jako jawny span/slot, nie jako przypadkowe poszerzenie jednej
kolumny. Planner musi znać granicę row/line kolumn i ponownie złożyć treść po
spannerze.

### Floats, Shapes i Exclusions

**Fakt.** `shape-outside` definiuje float area, a nie zmienia box modelu ani
pozycjonowania floatu. Kształt jest przycinany do margin box i może tylko
zmniejszyć obszar floatu; przy lewym/prawym float treść nadal opływa go tylko po
odpowiedniej stronie. [CSS Shapes §1–2](https://www.w3.org/TR/css-shapes/#intro), [§2](https://www.w3.org/TR/css-shapes/#relation-to-the-box-model-and-float-behavior)

**Fakt.** Exclusion wnosi obszar wykluczenia do wrapping context; wrapping area
jest content area pomniejszonym o zbiór aktywnych exclusions. Exclusions i
floats to różne mechanizmy, choć oba wpływają na dostępny interwał inline.
[CSS Exclusions §2–3](https://www.w3.org/TR/css3-exclusions/#terminology)

**Fakt.** CSS Shapes Level 1 opisuje `shape-outside` dla floatów; `shape-inside`
dla układania treści wewnątrz kształtu zostało odłożone do przyszłego poziomu.
[CSS Shapes §1.2](https://www.w3.org/TR/css-shapes/#module-interactions)

**Fakt.** Page Floats przewidują referencję `inline`, `column`, `region` lub
`page`, kierunki `block-start`, `block-end`, `inline-start`, `inline-end`,
`clear` oraz odroczenie (`float-defer`). Specyfikacja obejmuje różne konteksty
fragmentacji, nie tylko strony. [CSS Page Floats §2–4](https://www.w3.org/TR/css-page-floats-3/)

**Inference.** Dla grafiki editorialnej trzeba rozdzielić trzy role: normal-flow
(zajmuje miejsce i może się fragmentować), reserved slot/page float (ma reguły
umieszczenia i wpływa na flow według referencji) oraz overlay (paint-only, nie
zmienia flow). Zwykły blok obrazka nie zastępuje ani exclusion, ani page float.

### Writing Modes

**Fakt.** `direction` steruje kierunkiem inline i bidi, a `writing-mode` wybiera
kierunek block flow; `text-orientation` steruje orientacją glifów w pionie.
Writing modes mają abstrakcyjne osie inline/block oraz mapowanie na fizyczne
strony. [CSS Writing Modes §2–3](https://www.w3.org/TR/css-writing-modes-4/#text-direction), [§6–7](https://www.w3.org/TR/css-writing-modes-4/#abstract-box-terminology)

**Fakt.** Przepływ prostopadły (np. pionowy child w poziomym parent) wymaga
osobnego etapu sizingu i positioning; zależności min/max-content nie są prostym
zamiennikiem `x/y`. [CSS Writing Modes §7.3](https://www.w3.org/TR/css-writing-modes-4/#orthogonal-flows)

**Inference.** Kontrakt Report Baby powinien operować na logical inline/block,
a fizyczne `x`, `y`, `width`, `height` pozostawić adapterowi PDF. Samo dodanie
flagi `vertical-rl` do obecnego geometrycznego composera nie obsłuży orthogonal
flows, floatów ani mapowania stron recto/verso.

## 2. Vivliostyle: najbliższy kandydat open-source

**Fakt.** Vivliostyle jest silnikiem typesettingu HTML+CSS z obsługą publikacji
EPUB/Web i eksportem przez CLI; oficjalny kod rozdziela między innymi page
masters, page floats, layout regionów/kolumn, CSS Paged Media i font handling.
[Vivliostyle repository](https://github.com/vivliostyle/vivliostyle.js), [source map of subsystems](https://github.com/vivliostyle/vivliostyle.js/wiki/Development)

**Fakt.** Obsługiwane są CSS Multi-column i Writing Modes (`direction`,
`writing-mode`, `text-orientation`, `text-combine-upright`, `unicode-bidi`).
[Vivliostyle supported CSS](https://docs.vivliostyle.org/en/reference/supported-css-features/)

**Fakt.** Root multicol jest implementowany niezależnie od browserowego
multicol; page area staje się kontenerem kolumn. `float-reference: column` jest
wspierane tylko dla root multicol, a `column-span: all` w root multicol ma
ograniczenie do page floats. [Vivliostyle multicol limitations](https://docs.vivliostyle.org/en/reference/supported-css-features/#css-multi-column-1)

**Fakt.** Non-root multicol zależy od implementacji kolumn w browserze. Pozwala
na zagnieżdżone multicol, różne liczby kolumn na stronie i spannery, lecz
Vivliostyle dokumentuje ryzyko WebKit: zagnieżdżenia i page breaking mogą być
wadliwe. [Vivliostyle non-root multicol note](https://docs.vivliostyle.org/en/reference/supported-css-features/#css-multi-column-1)

**Fakt.** Oficjalne materiały opisują named pages i page masters jako mechanizm
wyboru typu strony/regionów, a repozytorium ma osobny moduł `page-masters.ts`.
[Vivliostyle Cookbook](https://docs.vivliostyle.org/downloads/vivliostyle-cookbook-en.pdf), [page-masters source](https://github.com/vivliostyle/vivliostyle.js/wiki/Development)

**Fakt.** To nie jest dowód pełnej zgodności z każdym przypadkiem CSS. Zależność
non-root od browsera, ograniczenia root spannerów i ograniczenia page-float
oznaczają, że testy muszą używać konkretnego backendu i wersji.

**Inference.** Vivliostyle jest najlepszym pierwszym spike'iem dla editorial
composition: przyjmuje HTML/CSS i ma model stron, kolumn, page floats i writing
modes. Nie powinien jednak zastąpić Report Baby bez testu fixture'ów, eksportu
diagnostyki i sprawdzenia deterministyczności fontów/browsera.

## 3. Paged.js i WeasyPrint

### Paged.js

**Fakt.** Paged.js dzieli treść na strony przez chunker, używa CSS columns (każda
strona jest kolumną), a polisher tłumaczy deklaracje paged-media na CSS/browser
albo implementacje JavaScript. [Paged.js architecture](https://pagedjs.org/en/documentation/4-how-paged.js-works/)

**Fakt.** Oficjalna macierz wsparcia deklaruje `break-before/after: page` i
`break-inside: avoid`, ale `avoid-page`, `avoid-column`, `avoid-region` oraz
breaki column/region są oznaczone jako nieobsługiwane lub niepewne; `widows` i
`orphans` są delegowane do browsera. [Paged.js support matrix](https://pagedjs.org/en/documentation/14-supported-feature-of-the-w3c-specifications/)

**Fakt.** Paged.js wprost informuje, że page floats nie są zaimplementowane;
opisywany helper `float` jest przybliżeniem konkretnego przypadku, a nie pełną
specyfikacją page floats. [Paged.js page-float note](https://pagedjs.org/posts/en/avoid-whitespaces-on-pages/)

**Fakt.** Oficjalne repozytorium udostępnia hooki overflow/break token i własne
handlery, ale to oznacza integrację z etapowym DOM/browser layout, nie dostęp do
pełnego solvera editorialnego. [Paged.js source](https://github.com/pagedjs/pagedjs/)

**Inference.** Paged.js jest dobry do szybkiego HTML/CSS proof-of-concept i
custom handlerów, lecz ryzyko rośnie dokładnie w przypadkach Report Baby:
reserved slot, page float, backtracking keepów, wielokolumnowe wyjątki i
diagnostyka przy niepowodzeniu.

### WeasyPrint

**Fakt.** WeasyPrint jest własnym, pythonowym silnikiem CSS nastawionym na
paginację, nie pełnym browser engine. Jego aktualna dokumentacja stabilna ma
wersję 69.0 i ostrzega, że kolejne wydania mogą zmieniać sposób renderowania,
więc wersja musi być przypięta w eksperymencie. [WeasyPrint overview](https://doc.courtbouillon.org/weasyprint/stable/index.html), [stable API/versioning](https://doc.courtbouillon.org/weasyprint/stable/api_reference.html#versioning)

**Fakt.** Aktualna dokumentacja stabilna deklaruje proste multi-column: wspiera
`column-width`, `column-count`, gap/rules, `column-span` dla bezpośrednich dzieci
kolumn i podstawowe `column-fill`, ale constrained height, spanning columns i
column breaks nie są wspierane, a pagination/overflow nie są dobrze testowane.
[WeasyPrint multi-column](https://doc.courtbouillon.org/weasyprint/stable/api_reference.html#css-multi-column-layout-module)

**Fakt.** `break-before/after/inside` są wspierane dla stron, ale nie dla kolumn
i regionów; `orphans` i `widows` są wspierane. [WeasyPrint fragmentation support](https://doc.courtbouillon.org/weasyprint/stable/api_reference.html#css-fragmentation-module-level-3-4)

**Fakt.** Dokumentacja wymienia brak RTL/bidi w opisanej obsłudze CSS 2.1, a
oficjalne feature listy nie dają podstaw do uznania page floats, CSS Shapes ani
vertical writing za pełny, produkcyjny kontrakt. Ostrzeżenia o nieobsługiwanych
właściwościach są emitowane na stderr. [WeasyPrint API reference](https://doc.courtbouillon.org/weasyprint/stable/api_reference.html), [warnings and unsupported CSS](https://doc.courtbouillon.org/weasyprint/stable/first_steps.html#command-line)

**Inference.** WeasyPrint może być tanim baseline'em dla prostych raportów
stronicowanych, ale nie jest bezpiecznym wyborem dla obecnego deep-dive'u bez
własnych, negatywnych fixture'ów dla shapes, slots, multicol i writing modes.

## 4. Dojrzałe silniki i warstwy pomocnicze

### PrinceXML

**Fakt.** Prince dokumentuje kolumny, `column-fill`, column breaks i spanners;
floats mogą być referencjonowane do kolumny lub strony, a rozszerzenia
`-prince-float`, `-prince-float-reference` i placement obsługują top/bottom oraz
defer. [Prince columns and floats](https://www.princexml.com/doc/15/styling/#columns), [Prince float extensions](https://www.princexml.com/doc/15/styling/#floats)

**Fakt.** Prince dokumentuje `writing-mode`, kierunek PDF dla rootu RTL, zmianę
orientacji kolumn przy `vertical-rl`, named pages/page regions, running content,
overlay region oraz diagnostykę przez error/warning i structured log. [Prince writing mode](https://www.princexml.com/doc/12/doc-prince/#writing-mode), [Prince page regions](https://www.princexml.com/doc/12/doc-prince/#page-regions), [Prince diagnostics](https://www.princexml.com/doc/help/#output-log)

**Fakt.** `break-inside: avoid` może utrzymać figurę lub tabelę w całości, lecz
element dłuższy niż strona nadal jest dzielony; dokumentacja ogranicza ten
mechanizm do elementów in-flow. [Prince break-inside](https://www.princexml.com/doc/12/doc-prince/#page-breaks)

**Inference.** Prince ma najbardziej bezpośredni, weryfikowalny zestaw funkcji
dla produkcyjnego paged-media spośród badanych, ale koszt licencji, vendor CSS,
zewnętrzny proces i ograniczony dostęp do wewnętrznego planu są ryzykami. Należy
testować, czy jego log można mapować na stabilną diagnostykę Report Baby; nie
wolno zakładać, że vendorowy fallback jest równoważny kontraktowi MCP.

### Antenna House Formatter

**Fakt.** Oficjalny przewodnik AH dokumentuje rozszerzenia `axf:float-x` i
`axf:float-y`, z logicznymi wartościami `start/end` oraz mapowaniem top/bottom
w vertical writing. [Antenna House XSL Extensions, float position](https://www.antennahouse.com/hubfs/PDFS/XSL%20Extensions%20Guide/mastering-ah-xsl-extensions.pdf)

**Fakt.** Oficjalne przykłady AH pokazują page floats, referencję strony i
pozycjonowanie przez wiele kolumn. [Antenna House page-float sample](https://www.antennahouse.com/hubfs/XSLFO-CSS-Samples%20%5B2023%5D/5.%20Floats/axf-float-page-1/CSS_axf-float-page-1.pdf)

**Inference.** AH jest realnym kandydatem enterprise dla vertical writing i
floatów, ale dostępne dowody są głównie vendor extensions i przykłady, nie
publiczny open-source kod planera. Integracja wymaga osobnego adaptera licencji,
wersji, logów i mapowania XSL-FO/CSS do AST Report Baby.

### Typst, TeX/pTeX, Pango/HarfBuzz

**Fakt.** Typst jest językiem i kompilatorem typesettingu generującym PDF; jego
oficjalny layout ma kolumny, pagebreak, measure i place. [Typst overview](https://typst.app/docs/), [Typst layout reference](https://typst.app/docs/reference/layout/)

**Fakt.** Oficjalny RFC Typst dla vertical writing opisuje tę funkcję jako
proponowaną (z API `horizontal-tb`, `vertical-rl`, `vertical-lr`), a nie jako
ustabilizowany kontrakt dokumentacji. [Typst vertical-writing RFC](https://github.com/typst/typst/issues/5908)

**Inference.** Typst jest ciekawym niezależnym językiem składu, lecz wymaga
konwersji AST, utraty CSS-native kontraktu i własnej diagnostyki; nie jest teraz
drop-in backendem dla wymagań vertical CSS.

**Fakt.** Pango obsługuje bidi, vertical text i mieszane skrypty przez gravity;
layout można obracać macierzą, a Pango dobiera orientację runów. [Pango bidi and vertical text](https://docs.gtk.org/Pango/pango_bidi.html), [Pango gravity](https://docs.gtk.org/Pango/enum.Gravity.html)

**Fakt.** HarfBuzz jest warstwą shaping/font engine, nie silnikiem stron,
fragmentacji, kolumn, floatów ani slots. Oficjalne repozytorium opisuje go jako
open-source text shaping engine. [HarfBuzz repository](https://github.com/harfbuzz/harfbuzz)

**Inference.** Pango/HarfBuzz mogą poprawić produkcyjny własny renderer w
zakresie shaping, bidi, fontów i pionowej orientacji glifów, ale nie rozwiązują
planner/evaluator, fragmentainerów, keep graph ani semantyki editorialnych
obrazów. To warstwa pod composerem, nie jego zamiennik.

## 5. Kontrakt Report Baby

### Model danych

Rekomendowany neutralny model:

```text
WritingContext
  writingMode: horizontal-tb | vertical-rl | vertical-lr
  direction: ltr | rtl
  textOrientation, locale, script

Fragmentainer
  id, pageId, logical inline/block size, order, role
  flowId, capacity, min/preferred/max size

Placement
  normal-flow | reserved-slot | page-float | inline | exclusion | overlay
  anchor, allowed fragmentainers, defer/clear policy, intrinsic size

Constraint
  required | preferred | relaxable
  keep graph edge, widows/orphans, break-before/after/inside

CompositionOutcome
  fragments, placements, source ranges, decision trace, diagnostics
```

**Inference.** `normal-flow` konsumuje bieżącą pojemność; `reserved-slot` rezerwuje
miejsce przed złożeniem powiązanego flow; `page-float` ma osobny algorytm
defer/clear/reference; `exclusion` zmienia interwały inline; `overlay` nie zmienia
planu. Ta separacja jest niezbędna, ponieważ CSS rozdziela box model, float area,
wrapping context i page region.

### Planner/evaluator back-and-forth

1. Planner wybiera wariant mastera, fragmentainer i kandydackie położenia slotów/
   floatów.
2. Text shaper mierzy runy w konkretnym `WritingContext`; evaluator wylicza
   dostępne interwały po exclusions.
3. Layout zapisuje fragmenty i źródłowe zakresy, a evaluator sprawdza overlap,
   keep graph, kolejność, overflow, widows/orphans i minimalne miary tekstu.
4. Przy naruszeniu planner cofa kandydat (defer, kolejny fragmentainer, zmiana
   mastera, redukcja rozmiaru według polityki) i uruchamia pełną recomposition.
5. Po wyczerpaniu polityki wynik jest `accepted`, `needs-decision` albo
   `rejected`; nigdy nie jest „success” z częściowym PDF-em.

**Inference.** To jest potrzebne, bo CSS dopuszcza wybór spośród wielu legalnych
breaków i nie definiuje jednego algorytmu optymalizacji. Report Baby potrzebuje
deterministycznego wyboru oraz śladu decyzji, nawet gdy backendem będzie
Vivliostyle, Prince lub AH.

### Keep graph

Keep powinien być grafem relacji, nie tylko `keepTogether`: heading→prefix,
caption→figure, marker→first line, intro→pierwszy legalny fragment, sekcje
wewnętrznie zagnieżdżone. Każda krawędź ma `required/preferred`, zakres i sposób
relaksacji. Cykl lub required cluster większy niż każdy fragmentainer daje
stabilny błąd `KEEP_REQUIRED_OVERSIZE`.

### Degradation ladder

Proponowana, jawna kolejność:

1. wybierz następny legalny break i zachowaj required keeps;
2. odłóż float/slot do następnego dopuszczalnego fragmentainera;
3. rozluźnij preferred keep, nigdy required;
4. użyj alternatywnego mastera/tracku;
5. zastosuj jawnie skonfigurowane skalowanie grafiki z pełną recomposition;
6. zredukuj dekorację lub zamień float na block;
7. `needs-decision`/`rejected` z kodem, zakresem źródła i próbami.

**Inference.** Silnik może mieć własne fallbacki, ale adapter musi je przechwycić
i znormalizować; „brak overlapu” nie jest wystarczającym kryterium akceptacji.

### Diagnostyka dla MCP

MCP powinien otrzymywać co najmniej:

- status i kod decyzji;
- node/asset/constraint IDs oraz source range;
- page/master/fragmentainer i logical/physical geometry;
- aktywne exclusions i dostępne inline intervals;
- keep edges, złamane/relaksowane ograniczenia;
- próby placementu i przyczynę odrzucenia;
- residual content, overflow i przewidywany wpływ zmiany;
- backend, wersję, font manifest i hash wejścia.

## 6. Rekomendacja wdrożeniowa

**Inference.** Nie zastępować od razu obecnego renderera. Utrzymać jego ścieżkę
kompatybilności, a editorial uruchomić jako osobny backend za neutralnym
Composition Plan.

1. Zbudować wspólną macierz fixture'ów: duża grafika, reserved slot, span,
   float/exclusion, keep cluster, continuation page, low text volume, RTL,
   vertical writing i przypadki unsatisfiable.
2. Zrobić spike Vivliostyle jako pierwszy kompletny composer CSS/HTML, z
   konkretnym Chromium/backendem i eksportem logów.
3. Równolegle zmierzyć Prince (jeśli licencja jest akceptowalna) jako dojrzały
   paged-media reference; AH tylko po potwierdzeniu warunków integracji.
4. Paged.js i WeasyPrint traktować jako baseline'y ograniczeń, nie jako domyślny
   wybór dla page floats/shapes/vertical writing.
5. Jeśli potrzebna jest kontrola planu i diagnostyki, rozwijać własny planner,
   używając Pango/HarfBuzz do tekstu; nie implementować od razu całego CSS.

## 7. Tabela decyzyjna

| Capability | Report Baby current prototype | Production renderer | Vivliostyle | Paged.js | WeasyPrint | Prince/AH/TeX where evidenced | Recommendation |
|---|---|---|---|---|---|---|---|
| Flow + continuation | Prototyp ma deterministic tracks/pages | Obecnie własny Cursor/segmenty | Silny HTML/CSS flow i page masters | Chunker overflow loop | Paginacja własna | Prince/AH dojrzałe; TeX własny model | Neutralny `Fragmentainer` contract |
| Keep / widows / orphans | Keep cases i evaluator | Ograniczone proceduralnie | CSS support, ale testować backend | `avoid`/widows/orphans zależne od browsera | Page breaks + widows/orphans; brak column break controls | Prince dokumentuje avoid i widows/orphans | Keep graph + backend adapter |
| Multi-column | Asymmetric tracks, span fixtures | Liczba/szerokości/gutter | Root i non-root, z udokumentowanymi ograniczeniami | Browser columns, page=column | Simple only; spans/breaks limited | Prince/AH documented | Vivliostyle spike; Prince reference |
| Spanner / intro above columns | Prototype span cases | Ograniczony seam | `column-span` with root caveat | CSS/browser dependent | Direct-child support only | Prince documented | Jawny `span` placement |
| Page float / reserved slot | Prototype policies, not CSS engine | Block figures; no true page float | Page floats present, column caveats | Not implemented; helper approximation | Not evidenced as full support | Prince and AH documented | Required capability; test Vivliostyle/Prince |
| Shape/exclusion wrapping | Ellipse/polygon evaluator in prototype | No real image exclusion flow | CSS support must be fixture-verified | Browser behavior, no page floats | Not evidenced as full contract | Prince/AH evidence mainly floats/vendor docs | Keep exclusion geometry in neutral plan |
| Overlay | Explicit paint-only fixtures | Supported as paint concept | Page regions/overlays possible | Custom CSS/handlers | CSS positioning, not editorial contract | Prince `@prince-overlay` documented | Keep separate from flow |
| Writing modes | Not production; geometry mostly physical | ltr/rtl only seam | `direction`, writing-mode, orientation documented | No sufficient primary evidence for full vertical contract | No sufficient evidence; RTL limitation documented | Prince and AH evidence; pTeX strong vertical domain | Use logical axes; verify engine-specific behavior |
| Text shaping | Built-in Helvetica metrics | Current text-runs | Browser/font stack | Browser/font stack | Pango backend | Pango/HarfBuzz specialized; TeX engines own stack | Pango/HarfBuzz under custom planner |
| Named pages/masters | Template config, no CSS masters | YAML page geometry | Named pages and page masters documented | Named pages, support matrix caveats | `@page` support, less evidence for masters | Prince regions/named pages; AH vendor | Map master IDs into neutral contract |
| Diagnostics | Prototype decision codes/evaluator | Report plan coverage checks | Need adapter; internal plan not MCP contract | Hooks/break tokens, custom handlers | stderr warnings | Prince logs/structured log; AH integration-specific | Normalize stable MCP trace |
| Determinism/integration | Fresh-process canonical prototype target | Controlled Node/PDF path | Browser, fonts, CLI/version risks | DOM/browser and JS hooks | Python/Pango versions | External binaries/licensing/vendor CSS | Pin runtime/fonts and record manifest |
| Overall role | Research proof, not production | Compatibility baseline | First open-source editorial spike | Low-cost exploratory polyfill | Simple paged baseline | Production reference if budget permits | Hybrid: neutral planner contract + measured backend |

## Najważniejszy wynik

Najlepszym następnym krokiem jest nie wybór „silnika do wszystkiego”, lecz
neutralny kontrakt fragmentainerów, placementów, keep graph i diagnostyki oraz
porównawczy spike Vivliostyle/Prince na tej samej macierzy. Vivliostyle jest
najbardziej obiecującym pierwszym kandydatem open-source dla editorial HTML/CSS;
Prince/AH są mocnymi referencjami paged-media, ale mają koszty i vendorowy
kontrakt. Paged.js i WeasyPrint nie mają w oficjalnych materiałach wystarczająco
pewnego zakresu dla page floats, kształtów i pionowego składu. Pango/HarfBuzz
rozwiązują tekst, nie planowanie stron. Report Baby powinien zachować kontrolę
nad oceną i diagnostyką, nawet jeśli deleguje fizyczne składanie do zewnętrznego
silnika.
