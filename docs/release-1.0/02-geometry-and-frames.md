# Plan 02 — geometria i wspólne ramy

Status: pierwszy seam zabezpieczony testem; pozostała obserwowalność planu

## Cel

Planner, evaluator, debug i backend mają odnosić się do tych samych obliczonych
ram: slotów, segmentów, placements, obstacles, flow barriers, block frames,
grafik i chrome.

Nie dodajemy kolejnego modelu geometrii. Ustalamy odpowiedzialność istniejących
reprezentacji i usuwamy powtórne interpretacje.

## Stan obecny

Geometria przechodzi przez kilka etapów:

1. `template-contract.ts` waliduje i normalizuje template;
2. `page-geometry.ts` wylicza fizyczną geometrię stron, segmenty, bands,
   obstacles i continuation;
3. `page-template-adapter.ts` buduje z niej `CompositionTemplate`, slots,
   routes i część reguł insertionów;
4. planner tworzy faktyczne `flowPlacements` oraz wynikające z kolizji
   `flowBarrierBoxCandidates`;
5. renderer i debug rysują wynik w osobnych miejscach.

Źródła: [`template-contract.ts`](../../server/src/template-contract.ts),
[`page-geometry.ts`](../../server/src/page-geometry.ts),
[`page-template-adapter.ts`](../../server/src/composition/page-template-adapter.ts).

## Mapa odpowiedzialności

| Etap | Właściciel | Wejście | Wynik używany dalej |
|---|---|---|---|
| kompilacja template’u | `compileTemplateSource` w `template-contract.ts` | YAML/obiekt template’u | zwalidowany `CompiledTemplate` z normalnymi ramami, flow i slotami |
| fizyczna geometria strony | `pageGeometryFromTemplate` w `page-geometry.ts` | `CompiledTemplate.page` | `PageGeometry`: margins, content, bands, obstacles, segments i block frames |
| adaptacja do composition | `compositionTemplateFromPageGeometry` w `composition/page-template-adapter.ts` | `CompiledTemplate` + `PageGeometry` | layouts, slots i routes dla pierwszej oraz kolejnych stron |
| rezerwacja insertionów | `placeInsertionLayer` w `composition/text-planner.ts` | flows, propozycje, slots i pomiary | placements insertionów oraz grafiki będące obstacle dla zwykłego flow |
| układanie flow | `planFlow` w `composition/text-planner.ts` | route, slots, obstacle i metryki tekstu | linie tekstu, placements i decyzje planera |
| rejestr miejsc flow | `registerFlowPlacements` w `composition/text-planner.ts` | slots i faktyczne placements | uporządkowany rejestr także pustych miejsc |
| rozcięcie przy kolizjach | `registerFlowBarrierBoxCandidates` w `composition/text-planner.ts` | flow placements + graphic placements | kandydaci segmentów pomiędzy krawędziami flow i obstacle |
| legalność | `evaluateCompositionPlan` w `composition/evaluator.ts` | kompletny plan | accepted/rejected i diagnostyka |
| obserwacja PDF | `drawCompositionDebugOverlay` oraz `renderReportPdfDetailed` w `report-renderer.ts` | wynik planu | zwykły PDF, debug overlay i artefakt do QA |

Ta mapa opisuje istniejące funkcje, nie wprowadza nowych encji. Jeżeli kolejny
etap potrzebuje tej samej informacji, powinien rozszerzyć wynik właściciela,
a nie odtwarzać geometrię w evaluatorze, debug albo backendzie.

## Kroki

1. Narysować tabelę wejście → wyjście dla każdej funkcji geometrycznej:
   template, strona, flow, slot, segment, obstacle, placement.
2. Ustalić, w którym miejscu powstają:
   - granice całego flow;
   - kolizje wewnątrz flow;
   - faktyczne miejsca z treścią;
   - puste miejsca niedostępne dla treści;
   - kandydaci wynikający z punktu styku z obstacle.
3. Dla każdego wyliczenia wskazać właściciela i zakazać jego rekonstrukcji w
   evaluatorze, debug overlayu albo backendzie.
4. Sprawdzić szczególnie przesuwanie `blockFrames`, rozcinanie segmentów,
   insertion routes, growth i chrome.
5. Dodać testy geometrii dla grafik prostokątnych, elips, poligonów, wielu
   obstacles i przejścia między stronami.
6. Dodać test porównujący ramę kandydata z faktycznym pierwszym i ostatnim
   `flowPlacement` po obu stronach obstacle.
7. Ujawnić w trace, z jakiej geometrii powstał dany placement i kandydat.
8. Ustalić źródło geometrii dla pomiarów visual QA. Gate strony nie może
   rekonstruować kolumn z osobnego YAML-a, jeśli CompositionPlan ma już
   rozstrzygnięte flow i placements. Test `page-layout-editorial-two-column`
   ma porównać rzeczywiste początki przebiegów tekstu z tym planem.
9. Dla `page-fill-table` rozdzielić w pomiarze obszar treści od headera,
   footera i innych elementów chrome. Następnie zapisać, które placementy
   tabeli trafiły na każdą stronę, aby rozróżnić prawidłowy podział od zbyt
   rzadkiej strony końcowej.

## Kryteria ukończenia

- zmiana w template przechodzi przez geometry, planner, evaluator, debug i
  backend bez zmiany znaczenia;
- evaluator może wykryć placement poza ramą niezależnie od tego, co placement
  sam deklaruje jako swój slot;
- box kandydata nie jest rysowany jako faktyczna bariera, dopóki nie zostanie
  użyty przez planner;
- debug pokazuje rozróżnienie: flow, obstacle, faktyczny placement i kandydat;
- test potwierdza zgodność obliczonych i narysowanych współrzędnych.
- test adaptera potwierdza przejście template → `PageGeometry` oraz rozcięcie
  segmentów przez obstacle; obecnie jest to
  [`test-page-template-adapter.mjs`](../../server/scripts/test-page-template-adapter.mjs).

## Wymaga uzupełnienia po wykonaniu punktu X

- Ostateczne miejsce reguły przesuwania `blockFrames` wymaga uzupełnienia po
  punkcie 1 i 2. Nie należy przenosić tej reguły wcześniej.
- Zakres chrome, który musi ograniczać flow, wymaga uzupełnienia po planie 05,
  gdy zostanie porównany z faktycznym renderem.
- Czy `flowBarrierBoxCandidates` powinny stać się wejściem dla pierwszej pętli
  wymaga uzupełnienia po testach z planu 04. Na tym etapie są tylko danymi
  diagnostycznymi i potencjalnymi punktami decyzji.

## Poza zakresem

Nie budujemy ogólnego solvera geometrii ani pełnej semantyki CSS floatów.
