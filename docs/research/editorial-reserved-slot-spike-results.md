# Editorial reserved-slot spike — named flows and partitions

Date: 2026-08-26

## Pytanie

Czy Vivliostyle może samodzielnie utrzymać relację:

- główny lead zaczyna się na stronie 1;
- grafika albo sidebar jest przypisany do bocznego partitionu tej samej strony;
- każdy flow może kontynuować się niezależnie na kolejnych stronach;
- keep constraints nie pozwalają osamotnić nagłówka;
- niemożliwa geometria kończy się diagnostyką, a nie cichym overflowem?

## Fixture i uruchomienie

Generator:

`server/scripts/editorial-reserved-slot-spike.mjs`

Geometria eksperymentu jest w osobnym pliku prototype:

`server/templates/editorial-engine-prototype.yml`

Uruchomienie:

```text
npm run prototype:reserved-slot -- --render --out /tmp/report-baby-editorial-reserved-slot-spike/vivliostyle-run-v2
```

Backend: `@vivliostyle/cli@11.2.0`.

Vivliostyle deklaruje obsługę `@-epubx-page-template`, `@-epubx-page-master`,
`@-epubx-partition`, `-epubx-flow-into` i `-epubx-flow-from`, ale EPUB Adaptive
Layout pozostaje niestandardowym rozszerzeniem. [Dokumentacja funkcji](https://docs.vivliostyle.org/en/reference/supported-css-features/),
[specyfikacja EPUB Adaptive Layout](https://idpf.org/epub/pgt/).

## Wynik

| Case | Pages | Markers | Ocena |
|---|---:|---|---|
| `reserved` | 4 | `lead-start`: 1, `reserved-image`: 4, `lead-continuation`: 3 | `needs-policy` |
| `sidebarOverflow` | 13 | `lead-start`: 1, `sidebar-start`: 6, `sidebar-end`: 12 | `needs-policy` |
| `keepCluster` | 5 | `KEEP-HEADER`: 4, `KEEP-THREE-LINES`: 4 | `pass-basic` |
| `tooTallMedia` | 3 | `too-tall-image`: 3 | `needs-rejection` |

## Co zostało udowodnione

### Named flow nie synchronizuje się automatycznie z leadem

Po pozostawieniu głównej treści w `body` flow Vivliostyle wygenerował PDF, ale
named `media` flow został odłożony do strony 4. Lead zaczynał się na stronie 1,
więc sam fakt istnienia bocznego partitionu nie oznacza „umieść obok pierwszej
porcji leadu”.

To jest dokładnie przypadek, w którym planner musi przekazać dodatkową relację,
np.:

```text
media.anchor = article-1
media.page = first-fragment(article-1)
media.required_with = [lead-start, intro]
```

Samo `flow-into`/`flow-from` opisuje strumień i pojemnik, ale nie opisuje
zależności między dwoma strumieniami.

### Sidebar może być niezależnym strumieniem, ale nie dostaje automatycznie
semantyki „sidebaru tej strony”

W przypadku `sidebarOverflow` sidebar pojawił się dopiero na stronie 6, a jego
koniec na stronie 12. Flow kontynuował się, lecz nie był związany z pierwszym
fragmentem artykułu. To jest technicznie poprawna paginacja flow, ale zła
kompozycja editorialna.

Planner musi więc rozróżniać co najmniej:

- `same_page_slot` — element ma być na tej samej stronie co kotwica;
- `deferred_slot` — element może przejść na następną stronę;
- `continuing_sidebar` — sidebar ma własny flow i może być kontynuowany;
- `page_local_sidebar` — sidebar może istnieć tylko na wskazanej stronie/masterze.

### Keep constraints działają na poziomie podstawowym

`break-inside: avoid` utrzymał `KEEP-HEADER` oraz `KEEP-THREE-LINES` na jednej
stronie. To nadaje się jako backendowa realizacja prostych keep rules, ale
planner nadal musi ustalić, czy wolno poświęcić miejsce, przenieść cały klaster
czy zmienić master.

### Niemożliwa geometria nie kończy się błędem

`too-tall-image` miał wysokość większą od dostępnego partitionu. Vivliostyle
wygenerował PDF i pokazał grafikę, więc „PDF powstał” nie może być warunkiem
sukcesu. Evaluator musi porównać wymagany box z dostępną geometrią i zwrócić
diagnostykę typu:

```text
media exceeds partition height
required: 240mm
available: 250mm page area, but reserved side region policy: 235mm
action: reject | scale | defer | choose alternate master
```

W obecnym fixtureze zapisujemy to jako `needs-rejection`; nie akceptujemy
cichego overflowu.

## Próby, które zawisły

Pierwsze wersje przypisywały również lead do named `lead` flow i zawierały
puste partitiony dla nieużywanych flow. Vivliostyle nie zwrócił PDF-u przed
timeoutem. Po przejściu na główny `body` flow PDF powstał, ale synchronizacja
reserved slotu nadal była niespełniona.

To ma znaczenie operacyjne: EAL/page-master musi być uruchamiany w izolowanym
procesie z timeoutem, a timeout powinien stać się diagnostyką planowania, nie
blokować MCP.

## Artefakty

- [manifest](/tmp/report-baby-editorial-reserved-slot-spike/vivliostyle-run-v2/manifest.json)
- [reserved — strona 1](/tmp/report-baby-editorial-reserved-slot-spike/vivliostyle-run-v2/vivliostyle/reserved/page-1.png)
- [reserved — strona 4](/tmp/report-baby-editorial-reserved-slot-spike/vivliostyle-run-v2/vivliostyle/reserved/page-4.png)
- [sidebar — strona 1](/tmp/report-baby-editorial-reserved-slot-spike/vivliostyle-run-v2/vivliostyle/sidebarOverflow/page-01.png)
- [sidebar — strona 6](/tmp/report-baby-editorial-reserved-slot-spike/vivliostyle-run-v2/vivliostyle/sidebarOverflow/page-06.png)
- [keep cluster — strona 4](/tmp/report-baby-editorial-reserved-slot-spike/vivliostyle-run-v2/vivliostyle/keepCluster/page-4.png)
- [too tall media — strona 3](/tmp/report-baby-editorial-reserved-slot-spike/vivliostyle-run-v2/vivliostyle/tooTallMedia/page-3.png)

## Decyzja projektowa po eksperymencie

Nie opieramy semantyki Report Baby na samym named flow. Kontrakt powinien być
dwuwarstwowy:

1. planner ustala relacje między fragmentami, kotwice, priorytety i degradację;
2. backend dostaje prostszy układ flow/partition/float i renderuje konkretną
   propozycję;
3. evaluator sprawdza geometrię, kolejność, keep rules, wypełnienie i brak
   overflowu;
4. planner może zaakceptować, zmienić parametry albo zgłosić listę sprzecznych
   wymagań.

Najbardziej obiecujący następny krok to nie dalsze „magiczne” named flows, tylko
połączenie jawnego planu fragmentainerów z backendowym floatem/partitionem:

```text
article fragment 1
  reserved slot: right, same-page, 62mm x 78mm
  exclusion: rectangle(image-box) or shape(image-contour)
  keep: heading + intro prefix, min 3 lines
  overflow: defer image / choose next master / reject
```

Wtedy silnik odpowiada za lokalne łamanie tekstu, a Report Baby zachowuje
kontrolę nad tym, co może przepychać co i kiedy PDF jest uznany za poprawny.
