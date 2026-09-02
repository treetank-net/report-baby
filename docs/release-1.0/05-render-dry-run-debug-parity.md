# Plan 05 — render, dry_run i debug

Status: zależy od planów 01–04

## Cel

Każdy obserwowalny rezultat ma opisywać ten sam plan:

- zwykły PDF;
- debug PDF z ramkami;
- odpowiedź `dry_run`;
- JSON planu i trace.

Debug jest warstwą obserwacji zwykłego renderingu, a nie drugim mechanizmem
wyliczania geometrii.

## Stan obecny

- zwykły render korzysta z composition planner/evaluator i backendu jsPDF;
- `drawCompositionDebugOverlay()` rysuje ramki na faktycznym PDF-ie;
- `dry_run` nadal przechodzi starszą ścieżką `resolveReportPlanOnly()`;
- część chrome jest rysowana w `report-renderer.ts` poza composition planem;
- overlay pokazuje już m.in. placements, obstacles, flow barriers, padding i
  margin, ale wymaga dalszej kontroli czy ramy pochodzą bezpośrednio z planu.
- manifest raportu przekazuje `compositionPlan` i `compositionEvaluation`, a
  page-layout gate korzysta z planu zamiast odtwarzać kolumny z template’u.

## Kroki

1. Przenieść `dry_run` na ten sam wynik planowania co zwykły render.
2. Zdefiniować wspólną sygnaturę planu do porównania render/dry_run/debug.
3. Zrobić test, że te trzy ścieżki mają te same placements, strony, zakresy
   słów i ramy.
4. Oznaczać na debug PDF osobno:
   - flow bounds;
   - obstacle bounds;
   - faktyczne placements;
   - flow barrier candidates;
   - padding/margins wpływające na decyzję;
   - elementy chrome ograniczające flow.
5. Przenieść etykiety techniczne poza ramki albo zapewnić im osobną przestrzeń,
   aby nie zasłaniały tekstu.
6. Zostawić ramki pod tekstem, jeśli poprawia to czytelność, ale nie zmieniać
   przez to geometrii renderowania.
7. Sprawdzić PDF text layer, PDF bbox i raster dla realnego editorialu.
8. Utrzymać parser PDF w harnessie dla obu poprawnych form strumienia: z
   `/Filter` oraz niekompresowanej. Jeżeli nie da się odczytać żadnego
   przebiegu tekstu, gate ma zakończyć się jednoznacznym `fail`, a nie
   przejściem pustego pomiaru.
9. Traktować cztery przypadki z audytu jako regresje o różnych kontraktach:
   układ kolumn, fill tabeli, inline markup/glyph fallback oraz zachowanie
   przy rzadkiej stronie. Oczekiwania mają wynikać z aktualnego kontraktu
   composition, nie z warningów usuniętego renderera.
10. Dla każdej regresji zachować trzy warstwy dowodu: wynik planu/manifestu,
    selectable text w PDF-ie oraz raster do przeglądu wizualnego. Brak jednej
    warstwy ma być odnotowany jako brak danych, nie jako sukces.

## Kryteria ukończenia

- debug nie odtwarza geometrii własnymi regułami;
- etykieta każdej ramy ma właściciela w planie lub trace;
- nie istnieje nieopisana linia/ramka bez źródła;
- `dry_run` wskazuje ten sam plan, który trafia do PDF-a;
- debug overlay nie przesuwa ani nie przycina tekstu;
- realny PDF zachowuje selectable text i poprawne strony.
- niekompresowany strumień PDF nie jest pomijany przez żaden gate;
- `page-layout-editorial-two-column` przechodzi dzięki zmierzonym przebiegom,
  a nie dlatego, że lista pomiarów jest pusta;
- `inline-markup-report` i `page-fill-gap-tightening` pozostają czerwone lub
  zostają przepisane dopiero po świadomej zmianie kontraktu.

## Wymaga uzupełnienia po wykonaniu punktu X

- Pełna lista kolorów i typów ramek wymaga uzupełnienia po punkcie 2 planu 02,
  kiedy będzie znany ostateczny właściciel każdej geometrii.
- Zakres chrome w CompositionPlan wymaga uzupełnienia po porównaniu
  `drawReportChrome()` z rzeczywistymi ograniczeniami flow.
- Stabilna sygnatura planu wymaga uzupełnienia po planie 04, gdy plan może
  zawierać wiele prób i najlepszy wybrany wariant.

## Poza zakresem

Nie tworzymy osobnego debug planera ani alternatywnego layoutu tylko na potrzeby
overlayu.
