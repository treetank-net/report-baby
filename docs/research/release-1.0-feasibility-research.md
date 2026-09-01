# Release 1.0 — niezależny research wykonalności

Data: 2026-09-01

## Werdykt

Przedsięwzięcie jest realne jako inkrementalne release 1.0 dla zamkniętego,
deterministycznego zakresu: istniejący model `CompositionInput`, obecne
template'y A4, poziomy przepływ tekstu, obecne block kinds i adapter jsPDF.
Repozytorium ma już renderer-neutralny plan, pomiar przez capability seam,
legalność i diagnostykę. Nie ma jednak jeszcze pętli planner–evaluator w
znaczeniu wymaganym przez plan release: evaluator nie zwraca score, planner nie
otrzymuje feedbacku i nie zachowuje najlepszego legalnego kandydata.

Pełny, ogólny silnik paged-media z arbitrary constraints, wieloma systemami
pisma, prawdziwymi floatami i solverem zależności nie jest realistycznym
zakresem jednego inkrementalnego kroku. Wymagałby większej przebudowy seamów,
nie tylko dodania pętli.

## Verified facts

### Call graph i sprzężenia

Główna ścieżka raportu wygląda obecnie tak:

```text
render_report
  ├─ dry_run → resolveReportPlanOnly
  │             → compositionGeometry
  │             → compileTemplateSource → pageGeometryFromTemplate
  │             → resolveReportPlan → assertReportPlan
  └─ normal → renderReportPdfDetailed
              → renderReportCompositionPdf
                 → compositionGeometry
                 → compositionDocumentFromInput
                 → jsPDF metrics/capabilities
                 → planReportComposition
                    → compositionTemplateFromPageGeometry
                    → createTextCompositionEngine
                       → text planner
                       → evaluator
                 → evaluator (drugi raz)
                 → drawReportChrome / debug overlay
                 → renderComposition
                    → createJsPdfTextBackend
```

MCP rejestruje `render_report`; gałąź `dry_run` wywołuje starszy
`resolveReportPlanOnly`, a zwykły render wywołuje `renderReportPdfDetailed`.
Weryfikowane miejsca to [`render-tools.ts:188-216`](../../server/src/tools/render-tools.ts#L188-L216)
i [`report-renderer.ts:285-291`](../../server/src/report-renderer.ts#L285-L291).

Zwykły render buduje dokument, rozwiązuje obrazy, przygotowuje capabilities,
tworzy style i wywołuje `planReportComposition`; po przyjęciu planu rysuje
chrome, opcjonalny debug overlay i backend composition.
[`report-renderer.ts:306-387`](../../server/src/report-renderer.ts#L306-L387)

`planReportComposition` tworzy dokument i template, wstrzykuje metryki jsPDF,
scala politykę z YAML, uruchamia engine, a następnie ponownie wywołuje
`evaluateCompositionPlan`. To jest konkretne podwójne sprzężenie ewaluacji.
[`report-shadow.ts:329-359`](../../server/src/composition/report-shadow.ts#L329-L359)

Sam `CompositionEngine` wykonuje obecnie jeden `planner.plan()` i jeden
`evaluator.evaluate()`; nie ma tu generatora kolejnych kandydatów ani selekcji.
[`engine.ts:341-356`](../../server/src/composition/engine.ts#L341-L356)
[`engine.ts:378-384`](../../server/src/composition/engine.ts#L378-L384)

Backend dostaje zaakceptowany plan. Tworzy strony, renderuje tabele, grafiki,
atomic blocks, linie i glyphs; planner nie wywołuje API rysującego.
[`js-pdf-adapter.ts:866-947`](../../server/src/composition/js-pdf-adapter.ts#L866-L947)
To jest dobry istniejący seam do zachowania.

Geometria jest interpretowana w kilku etapach. `compileTemplateSource`
waliduje sloty, flowy, frames, constraints i stronę;
`pageGeometryFromTemplate` przelicza normalized frames na fizyczne segmenty,
reserved bands, obstacles, block frames i continuation;
`compositionTemplateFromPageGeometry` buduje następnie layouts, auxiliary
slots i routes dla composition.
[`template-contract.ts:348-469`](../../server/src/template-contract.ts#L348-L469)
[`page-geometry.ts:61-133`](../../server/src/page-geometry.ts#L61-L133)
[`page-template-adapter.ts:370-624`](../../server/src/composition/page-template-adapter.ts#L370-L624)

To nie są trzy całkowicie niezależne modele: adapter ponownie interpretuje
source slots, continuation frames, insertiony, wzrost i kolejność route.
W praktyce jest to główne miejsce ryzyka rozjechania geometrii, zwłaszcza że
`report-renderer.ts` nadal niezależnie rysuje chrome i fallbackowe bandy.
[`report-renderer.ts:103-143`](../../server/src/report-renderer.ts#L103-L143)

### Rozmiary funkcji, odpowiedzialności i testowalność

Pomiar został wykonany na aktualnych plikach TypeScript przez parser AST
TypeScript 5.9.3; liczba linii obejmuje deklarację i ciało funkcji.

| funkcja | plik i zakres | długość | obserwowane odpowiedzialności |
| --- | --- | ---: | --- |
| `planFlow` | `server/src/composition/text-planner.ts:1639-2304` | 666 linii | cursor po stronie i route, max pages, deferred/repositioned insertions, wybór slotu, collision, pomiar tabel, atomic blocks, growth, wrapping, heading/list keeps, widow/orphan-like fragment limits, placement, reflow i residual diagnostics |
| `evaluateCompositionPlan` | `server/src/composition/evaluator.ts:373-744` | 372 linii | targety slotów, containment, duplicate ranges, overlap linii/grafik/blocks/tables, kolejność flow, insertion order, coverage, residual content, atomic blocks, graphics i status |
| `compositionTemplateFromPageGeometry` | `server/src/composition/page-template-adapter.ts:370-624` | 255 linii | first/continuation/title layouts, normalized frames, segmenty, auxiliary flows, block/text/lockup slots, growth targets i route mapping |
| `drawCompositionDebugOverlay` | `server/src/report-renderer.ts:150-277` | 128 linii | chrome, flow placements, obstacles, barrier candidates, blocks, tables, footer/page number, lines i glyphs |
| `compositionStylesFromRenderConfig` | `server/src/composition/report-shadow.ts:65-185` | 121 linii | odczyt wartości PDF, body/list/title/subtitle/quote styles, padding, markers, glyphs i kolory |
| `compileTemplateSource` | `server/src/template-contract.ts:348-469` | 122 linii | walidacja schema, canvas/direction, regions, slotów, flowów, archetype, page, composition i no-overlap |
| `drawCompositionChart` | `server/src/composition/js-pdf-adapter.ts:437-546` | 110 linii | geometria wykresu, skale, osie, etykiety, kolory i rysowanie elementów chartu |
| `checkEmptyAndUnderfilledSlots` | `server/src/composition/evaluator.ts:211-310` | 100 linii | wykrywanie pustych route segments, underfill, minimalnych fragmentów i diagnostyki przejścia |

Rozmiary całych kluczowych modułów wynoszą: `text-planner.ts` 2418 linii,
`evaluator.ts` 744, `page-template-adapter.ts` 624, `js-pdf-adapter.ts` 947,
`report-shadow.ts` 374 i `report-renderer.ts` 400.
[`text-planner.ts:1-2418`](../../server/src/composition/text-planner.ts#L1-L2418)
[`evaluator.ts:1-744`](../../server/src/composition/evaluator.ts#L1-L744)
[`page-template-adapter.ts:1-624`](../../server/src/composition/page-template-adapter.ts#L1-L624)
[`js-pdf-adapter.ts:1-947`](../../server/src/composition/js-pdf-adapter.ts#L1-L947)

`planFlow` jest monolitem, ale nie jest tylko „dużą funkcją wrappingu”:
łączy co najmniej osiem różnych klas decyzji placementowych i diagnostycznych.
Konsekwencją jest duży blast radius zmian w generatorze kandydatów.
[`text-planner.ts:1639-2304`](../../server/src/composition/text-planner.ts#L1639-L2304)

Istnieją dobre punkty wstrzykiwania: `CompositionTextMetrics` udostępnia
`measureText`, `lineHeight`, opcjonalne ink bounds, gaps, `measureBlock` i
`measureTable`; `CompositionBackend` jest osobnym interfejsem.
[`engine.ts:3-29`](../../server/src/composition/engine.ts#L3-L29)
[`engine.ts:358-360`](../../server/src/composition/engine.ts#L358-L360)

Obecny interfejs ewaluacji jest jednak minimalny: `CompositionEvaluation`
zawiera tylko `status`, `diagnostics` i `residualContent`; nie ma score,
breakdown, hard violations jako osobnej kategorii ani identyfikatora kandydata.
[`engine.ts:335-352`](../../server/src/composition/engine.ts#L335-L352)

Legalność ma już szeroki zakres. Evaluator sprawdza m.in. brakujący slot,
wyjście linii poza slot, line overlap, wejście linii w wrapping graphic,
placement poza slotem, kolejność contentu, table row coverage, atomic block
overlap, graphic target i residual content.
[`evaluator.ts:373-423`](../../server/src/composition/evaluator.ts#L373-L423)
[`evaluator.ts:630-689`](../../server/src/composition/evaluator.ts#L630-L689)
Pokrycie słów jest sprawdzane jako ciągły zakres od zera do końca.
[`evaluator.ts:691-734`](../../server/src/composition/evaluator.ts#L691-L734)

Testy korzystają z tego seamu bezpośrednio. Test kontraktu wstrzykuje fake
planner i fake evaluator, potwierdza przekazanie document/metrics/plan oraz
blokuje render rejected planu.
[`test-composition-engine-contract.mjs:21-56`](../../server/scripts/test-composition-engine-contract.mjs#L21-L56)
[`test-composition-engine-contract.mjs:75-86`](../../server/scripts/test-composition-engine-contract.mjs#L75-L86)
Największy test text composition ma 1451 linii i 246 wywołań `assert.*`, z
przypadkami kolejności, overlapu, insertions, obstacles, glyphs, obrazów,
atomic blocks, tabel, growth i residual content.
[`test-text-composition-engine.mjs:1-1451`](../../server/scripts/test-text-composition-engine.mjs#L1-L1451)
W repo jest osiem skryptów testowych odwołujących się do composition planner/
evaluator/engine seamów, m.in. test engine contract, text engine, page adapter,
jsPDF adapter, shadow, oracle i numbered flow.
[`test-editorial-numbered-flow.mjs:504-541`](../../server/scripts/test-editorial-numbered-flow.mjs#L504-L541)
[`test-report-composition-oracle.mjs:167-194`](../../server/scripts/test-report-composition-oracle.mjs#L167-L194)

Statyczne bramki uruchomione podczas researchu: `npx tsc --noEmit` zakończyło
się sukcesem, a `npm run arch:check` zgłosił 53 moduły TypeScript bez
zabronionych cykli i naruszeń warstw. Test kontraktu nie doszedł do asercji:
jego tymczasowy bundle ESM zakończył się błędem esbuild/runtime
`Dynamic require of "process" is not supported`; nie traktuję tego jako
potwierdzenia poprawności testu integracyjnego.
[`architecture-check.mjs:1-101`](../../server/scripts/architecture-check.mjs#L1-L101)
[`test-composition-engine-contract.mjs:7-21`](../../server/scripts/test-composition-engine-contract.mjs#L7-L21)

### Co istnieje, a czego brakuje w pętli

Planner ma iterację, ale jest to iteracja stabilizacji insertion proposals:
`planDocumentOnce` buduje cały plan, a `createTextCompositionPlanner` porównuje
sygnaturę kolejnych propozycji i kończy po stabilizacji albo po limicie.
Nie ma w niej ewaluacji kandydata, porównania score ani pamięci najlepszego
legalnego planu.
[`text-planner.ts:2322-2379`](../../server/src/composition/text-planner.ts#L2322-L2379)
[`text-planner.ts:2382-2418`](../../server/src/composition/text-planner.ts#L2382-L2418)

Limit istnieje w render config: `planner_max_iterations: 4`,
`planner_minimum_fragment_lines: 3` i `composition_geometry_tolerance: 0.01`.
[`render-config.yml:67-73`](../../server/templates/render-config.yml#L67-L73)

Trace istnieje jako fazy, block traces, slot traces i flow placements.
`tracePlan` agreguje fragmenty, zakresy słów, statusy i decyzje.
[`engine.ts:227-332`](../../server/src/composition/engine.ts#L227-L332)
[`text-planner.ts:1417-1495`](../../server/src/composition/text-planner.ts#L1417-L1495)
Trace nie opisuje jednak kandydatów, rodzica wariantu, hard violations ani
score breakdown. Co więcej, evaluator dopisuje fazę `evaluation` bezpośrednio
do `plan.trace`, więc formalnie mutuje oceniany plan.
[`evaluator.ts:737-743`](../../server/src/composition/evaluator.ts#L737-L743)

Istnieje osobny prototyp score. Czyta YAML, rozdziela error diagnostics jako
hard violations, liczy komponenty jakości i ustawia score na `-Infinity`, gdy
plan ma error. Jest wyraźnie oznaczony jako heurystyczny prototyp, a nie
produkcyjny contract.
[`prototype-composition-debug.mjs:3-5`](../../server/scripts/prototype-composition-debug.mjs#L3-L5)
[`prototype-composition-debug.mjs:45-119`](../../server/scripts/prototype-composition-debug.mjs#L45-L119)
[`composition-score-prototype.yml:1-16`](../../server/templates/composition-score-prototype.yml#L1-L16)

`dry_run` nie korzysta z tego samego `CompositionPlan` co zwykły render:
wywołuje `resolveReportPlanOnly`, podczas gdy zwykły render korzysta z
`planReportComposition`. To narusza cel „one plan” niezależnie od jakości
samego starego planu.
[`render-tools.ts:200-215`](../../server/src/tools/render-tools.ts#L200-L215)
[`report-renderer.ts:395-400`](../../server/src/report-renderer.ts#L395-L400)

### Tekst i pomiar

Obecny flow breaker ma własny dynamic-programming-like wybór między
`FlowNode` breakpoints: generuje słowa i polskie breakpoints, liczy szerokości,
uwzględnia hyphenation, stretch/shrink, raggedness i karę za hyphenation.
[`text-runs.ts:367-373`](../../server/src/text-runs.ts#L367-L373)
[`text-runs.ts:392-420`](../../server/src/text-runs.ts#L392-L420)
[`text-runs.ts:483-565`](../../server/src/text-runs.ts#L483-L565)
Jednocześnie nie jest to ogólny Unicode line-breaking engine: wejście jest
dzielone głównie po whitespace i lokalnych `polishBreakPoints`; zakres dla
RTL/CJK/vertical writing pozostaje niepotwierdzony produkcyjnie.

Adapter jsPDF dostarcza planowaniu rzeczywiste `doc.getTextWidth`, line height,
ink bounds i style, a backend używa `doc.text`, `doc.rect`, `doc.addPage`,
`doc.addImage` i innych metod rysujących.
[`js-pdf-adapter.ts:799-864`](../../server/src/composition/js-pdf-adapter.ts#L799-L864)
[`js-pdf-adapter.ts:878-944`](../../server/src/composition/js-pdf-adapter.ts#L878-L944)

## Conclusions

1. Minimalna pętla planner–evaluator jest wykonalna bez wymiany renderera.
   Największa wartość już istnieje w `planDocumentOnce`, istniejącym
   `CompositionPlan`, legalności evaluatora i backend seamie. Trzeba dołożyć
   kontrakt kandydata, score i selekcję oraz zmienić engine z jednego wywołania
   na deterministyczną pętlę.

2. Funkcje 100+ linii nie są same w sobie dowodem niewykonalności, ale
   `planFlow` (666 linii) jest bezpośrednim ryzykiem dla bezpiecznej zmiany:
   kandydat zmieniający pozycję obrazu lub break tekstu będzie rekonstruował
   duży, mutable plan i może wpływać na niezwiązane reguły. Przed większą
   rozbudową pętli warto wydzielić małe, czyste seam’y: candidate proposal,
   materialization, local legality probes i score components. Nie należy ciąć
   funkcji mechanicznie; odpowiedzialności powinny pozostać widoczne w testach.

3. Inkrementalnie wykonalne są: score i breakdown w istniejącym evaluatorze,
   ograniczony generator alternatyw dla insertion/page/route, best-legal
   selection, stabilne zakończenie, candidate trace, usunięcie drugiej
   ewaluacji, oraz podłączenie `dry_run` do tego samego wyniku planowania.

4. Większego przebudowania wymagają: jedna autorytatywna reprezentacja
   geometrii end-to-end, pełne przeniesienie chrome do planu, ogólny dependency
   solver dla growth/pushes, pełna semantyka CSS float/exclusion/fragmentainer,
   oraz wielojęzyczny shaping i line breaking. Te cele należy odseparować od
   minimalnego release 1.0, inaczej nie będzie jasne, czy porażka wynika z
   pętli, geometrii czy backendu.

5. Standardy nie rozstrzygają, który legalny układ ma być najlepszy. Własny
   score i jawny tie-break są zatem koniecznym kontraktem produktu, a nie
   próbą „odczytania” jednego wyniku z W3C/Unicode. Najbezpieczniejszy model to
   lexicographic selection: najpierw brak hard violations i brak residual,
   potem score, potem stabilny tie-break po candidate id/signature.

## Hypotheses / open questions

- **Hipoteza:** obecne insertion proposals są wystarczającym pierwszym
  neighborhood dla pętli, jeśli release 1.0 ograniczy się do alternatywnych
  legalnych slotów, defer/page route i kilku break points. Nie potwierdzono
  jeszcze, że ten neighborhood znajdzie dobry układ dla jednoczesnej zmiany
  obrazu, quote, wzrostu intro i multi-column reflow.

- **Otwarte:** czy `CompositionEvaluation` ma dostać tylko score i breakdown,
  czy także jawne `hardViolations` oraz `candidateId`. Rekomendacja: rozszerzyć
  istniejący typ, bez nowego modelu domenowego, o `score`, `scoreBreakdown`,
  `hardViolations` i stabilny identyfikator wyniku.

- **Otwarte:** obecny evaluator przyjmuje tylko `(document, plan)` i wyszukuje
  slot w samym planie. Nie potwierdzono jeszcze, czy wszystkie legalności można
  bezpiecznie sprawdzić na tej podstawie; dla release 1.0 trzeba przekazać mu
  immutable geometry/template snapshot albo referencję do autorytatywnej
  geometrii.
  [`evaluator.ts:18-30`](../../server/src/composition/evaluator.ts#L18-L30)
  [`evaluator.ts:373-386`](../../server/src/composition/evaluator.ts#L373-L386)

- **Otwarte:** `keep-with-next` jest lokalnym językiem kontraktu Report Baby,
  nie znaleziono go jako identycznej właściwości w sprawdzonych specyfikacjach.
  Trzeba formalnie określić, które keeps są required, które preferred i jak
  są relaksowane przy overflow.

- **Niepotwierdzone:** dokumentacja jsPDF potwierdza dostępność API pomiaru i
  rysowania, ale nie daje gwarancji, że każda kombinacja fontu, kerningu,
  fallbacku glyphów i późniejszego `doc.text` będzie pikselowo identyczna z
  pomiarem. To wymaga corpusu realnych brand fonts i PDF bbox/pixel QA.

- **Niepotwierdzone:** obecny test composition contract nie przeszedł w tej
  sesji z powodu tymczasowego ESM bundle/runtime error. Przed uznaniem release
  za gotowy trzeba naprawić lub obejść ten problem w test harnessie i uruchomić
  pełny host/CI gate.

## Minimum viable implementation path

1. **Zamrozić wejście i baseline.** Zachować `CompositionInput`, obecne
   template'y, fixture'y i istniejące legalności. Nie rozszerzać zakresu o
   RTL/CJK/vertical writing ani arbitralny constraint solver.

2. **Rozdzielić czyste planowanie od selekcji.** Pozostawić `planDocumentOnce`
   jako materializację jednego wariantu, ale dodać deterministyczny
   `CandidateProposal`/signature jako techniczny rekord, nie nową encję
   domenową. Wariant powinien opisywać wyłącznie zmianę: insertion slot/page,
   route break, growth/defer albo wybrany break.

3. **Rozszerzyć ewaluację bez mutacji.** Zmienić evaluator tak, aby zwracał
   `status`, `diagnostics`, `residualContent`, `hardViolations`, `score` i
   `scoreBreakdown`. Usunąć dopisywanie fazy do `plan.trace` w evaluatorze;
   trace składa engine po zakończeniu oceny.

4. **Zdefiniować legality gate.** Hard violation obejmuje co najmniej
   containment, overlap, source-order, continuous coverage, residual,
   unsupported/missing asset, invalid atomic/table placement i niedopuszczalny
   overflow. Hard violation zawsze wyklucza kandydata, niezależnie od score.

5. **Przenieść prototyp score do konfiguracji produkcyjnej.** Użyć istniejących
   komponentów jako startu: niewykorzystane miejsce, internal empty route,
   balans kolumn, jakość insertion, heading-following i hyphenation. Wagi i
   progi muszą być w odpowiednim YAML render config, nie jako literały w
   plannerze. Dodać jawny, stabilny tie-break.

6. **Zbudować pętlę w engine.** Schemat:

   ```text
   seed candidate
     → materialize plan
     → evaluate exactly once
     → record candidate result
     → if legal: compare with best legal
     → ask planner for next deterministic proposal
     → stop on no proposal, stable signature, or YAML iteration budget
   ```

   Planner nie musi „rozmawiać” z LLM-em. Wystarczy funkcja generująca
   następną propozycję na podstawie poprzedniej ewaluacji; ważne, aby feedback
   zawierał kody hard violations, score components i przyczynę następnej
   zmiany.

7. **Zachować najlepszy legalny plan.** Jeśli są legalne kandydaty, wynik to
   maksimum score po stabilnym tie-break. Jeśli nie ma legalnego kandydata,
   zwracane jest `rejected` z agregatem prób; nie wolno renderować „najmniej
   złego” planu.

8. **Ujednolicić publiczne wyjście.** `render_report`, `dry_run`, zwykły PDF i
   debug powinny używać jednego `CompositionPlanResult`. Stary
   `ResolvedReportPlan` może pozostać kompatybilnościowym widokiem, ale nie
   może być drugim źródłem decyzji.

9. **Dodać testy przed dalszym rozszerzaniem.** Minimalny corpus powinien
   asercjami objąć: dwa legalne kandydaty i wybór wyższego score, legalny plan
   wygrywający z nielegalnym o wyższym surowym score, remis i tie-break,
   brak legalnego kandydata, limit iteracji, deterministyczną kolejność,
   trace wszystkich prób, brak drugiej ewaluacji oraz brak mutacji planu przez
   evaluator. Potem uruchomić pełny PDF text/bbox/pixel corpus.

## Risks

- **Kombinatoryka i koszt:** każda propozycja może uruchamiać pełne
  `planDocumentOnce`, w tym pomiary bloków, tabel, obrazów i reflow. Limit 4
  jest obecnie konfigurowany, ale nie ma jeszcze limitu liczby wariantów ani
  mechanizmu deduplikacji poza insertion signature.

- **Mutable plan/trace:** evaluator dopisuje do ocenianego planu fazę, a
  planner także dopisuje decyzje. To utrudnia cache, powtarzalną ewaluację i
  porównywanie kandydatów; trzeba wprowadzić copy-on-write albo immutable
  result assembly.

- **Geometry drift:** template contract, page geometry, page-template adapter,
  report plan i renderer mają nakładające się interpretacje. Własny score nie
  naprawi kandydata ocenianego względem innego prostokąta niż ten, który
  backend narysuje.

- **Hardcoded thresholds:** flow breaker ma stałe `FLOW_*` dla kar,
  stretch/shrink i fill, a assertion ma domyślne tolerance. To jest ryzyko
  powstania dwóch źródeł prawdy względem wymaganej konfiguracji YAML.
  [`text-runs.ts:367-373`](../../server/src/text-runs.ts#L367-L373)
  [`report-plan-assertions.ts:112-120`](../../server/src/report-plan-assertions.ts#L112-L120)

- **Pomiar kontra raster:** legalność geometryczna nie gwarantuje wizualnego
  rezultatu. Brand fonts, glyph fallback, kerning, captions, chart labels i
  chrome wymagają osobnego PDF bbox oraz pixel QA.

- **Test harness:** aktualny contract test buduje tymczasowy bundle ESM i w
  tej sesji zakończył się błędem dynamic require. Bez poprawnego uruchomienia
  testów trudno wiarygodnie ocenić zmianę w engine.

- **Zakres standardów:** W3C i Unicode zostawiają część wyboru implementacji.
  Nazwanie score „standardowym” byłoby błędem; jego wagi, tie-break i polityka
  degradacji muszą być wersjonowanym kontraktem Report Baby.

## Sources

### Repozytorium

- [`server/src/composition/engine.ts`](../../server/src/composition/engine.ts) — neutralne typy planu, evaluation, planner/evaluator/backend interfaces i engine.
- [`server/src/composition/text-planner.ts`](../../server/src/composition/text-planner.ts) — materializacja flow, wrapping, insertion, growth, obstacles, trace i obecna iteracja stabilizacyjna.
- [`server/src/composition/evaluator.ts`](../../server/src/composition/evaluator.ts) — obecna legalność, coverage, overlap i status.
- [`server/src/composition/page-template-adapter.ts`](../../server/src/composition/page-template-adapter.ts) — mapowanie page geometry na layouts/routes/slots.
- [`server/src/composition/js-pdf-adapter.ts`](../../server/src/composition/js-pdf-adapter.ts) — pomiar i wykonanie planu przez jsPDF.
- [`server/src/report-renderer.ts`](../../server/src/report-renderer.ts) i [`server/src/tools/render-tools.ts`](../../server/src/tools/render-tools.ts) — publiczny call graph, chrome, debug i `dry_run`.
- [`server/scripts/prototype-composition-debug.mjs`](../../server/scripts/prototype-composition-debug.mjs) — istniejący, ale prototypowy score z hard gate.

### Oficjalne źródła pierwotne

- [jsPDF API documentation — official repository docs](https://github.com/parallax/jsPDF/blob/master/docs/jsPDF.html) — oficjalny katalog i dokumentacja metod `text`, `rect`, `addPage`, `getTextWidth` i innych operacji PDF.
- [jsPDF `split_text_to_size` documentation](https://github.com/parallax/jsPDF/blob/master/docs/module-split_text_to_size.html) — oficjalny opis `getStringUnitWidth` i `splitTextToSize`, w tym użycia font width/kerning tables do określania długości.
- [W3C CSS Fragmentation Module Level 4](https://www.w3.org/TR/css-break-4/) — `break-inside`, `orphans`, `widows`, fragmentainers, fallback przy overflow i fakt, że specyfikacja nie definiuje precyzyjnego algorytmu wyboru konkretnego allowed break.
- [W3C CSS Text Module Level 3](https://www.w3.org/TR/css-text-3/) — line wrapping, line breaking, hyphenation, whitespace, bidi i interakcje z Unicode line-break classes.
- [W3C CSS Paged Media Module Level 3](https://www.w3.org/TR/css-page-3/) — paged media i relacja do CSS Fragmentation przy podziale na strony.
- [Unicode Standard Annex #14 — Unicode Line Breaking Algorithm](https://www.unicode.org/reports/tr14/) — normatywne break opportunities oraz wyraźne rozdzielenie ich wyznaczania od wyboru optymalnego miejsca i estetycznej oceny breaku.
- [Knuth and Plass, “Breaking Paragraphs into Lines”, Wiley, 1981](https://onlinelibrary.wiley.com/doi/abs/10.1002/spe.4380111102) — źródło pierwotne algorytmu boxes/glue/penalties, globalnej oceny akapitu i dynamic programming; użyte jako podstawa tezy, że jakościowe łamanie jest problemem optymalizacji, nie tylko lokalnego greediness.

Nie użyto wtórnych blogów jako podstawy zewnętrznych tez. Źródła W3C,
Unicode, oficjalna dokumentacja jsPDF i pierwotna publikacja Knutha/Plassa są
źródłami opisanych twierdzeń. Nie potwierdzono w źródłach standardowego,
uniwersalnego score dla całego dokumentu ani gotowego kontraktu
planner–evaluator; te elementy pozostają decyzją implementacyjną Report Baby.
