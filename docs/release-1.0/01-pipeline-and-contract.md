# Plan 01 — pipeline i kontrakt

Status: można rozpocząć od razu

## Cel

Uczynić jeden przebieg composition wiarygodnym i widocznym:

```text
CompositionInput
  → CompositionDocument
  → template / PageGeometry / CompositionTemplate
  → planner
  → evaluator
  → CompositionPlanResult
  → renderer
```

Wynik planowania ma być jedynym wynikiem używanym do decyzji o renderowaniu.

## Stan obecny

- `createCompositionEngine()` wywołuje planner, a następnie evaluator jeden
  raz: [`engine.ts`](../../server/src/composition/engine.ts).
- `planReportComposition()` ignoruje jednak otrzymane `result.evaluation` i
  wywołuje `evaluateCompositionPlan()` ponownie:
  [`report-shadow.ts`](../../server/src/composition/report-shadow.ts#L329-L359).
- `dry_run` korzysta z `resolveReportPlanOnly()`, a zwykły render z
  `planReportComposition()`: [`render-tools.ts`](../../server/src/tools/render-tools.ts#L188-L216).
- Osobny contract test nie dochodzi obecnie do asercji z powodu błędu
  tymczasowego bundla ESM: `Dynamic require of "process" is not supported`.

## Kroki

1. W `planReportComposition()` zwrócić `result.evaluation` zamiast wywoływać
   evaluator ponownie.
2. Usunąć niepotrzebny import bezpośredniego evaluatora z tego wrappera.
3. Dodać do contract testu licznik wywołań evaluatora i asercję, że jeden
   konkretny plan jest oceniony raz.
4. Naprawić sposób budowania tymczasowego bundla contract testu. Nie zmieniać
   asercji tylko po to, aby ominąć błąd runtime.
5. Opisać, które dane są publicznym `CompositionInput`, a które są
   wewnętrznym etapem przygotowania composition.
6. Sprawdzić pełne mapowanie obecnych block kinds od schema do renderera.
7. Zdecydować na podstawie użycia, które eksporty z `composition/index.ts` są
   publicznym seamem, a które powinny zostać wewnętrzne.

## Testy i kryteria ukończenia

- contract test przechodzi aż do asercji;
- licznik potwierdza jedno wywołanie evaluatora dla jednego wyniku;
- normalny render nie zmienia zachowania istniejącego corpus;
- `CompositionPlanResult` jest przekazywany do renderera bez ponownego
  rozwiązywania legalności;
- nie ma produkcyjnego translatora starego `ReportData` ani `Cursor`;
- nieznany block kind kończy się czytelnym błędem.

## Wymaga uzupełnienia po wykonaniu punktu X

- Ostateczna lista publicznych eksportów wymaga uzupełnienia po punkcie 7,
  gdy znamy faktyczne call site’y i testy integracyjne.
- Dokładny kontrakt `dry_run` wymaga uzupełnienia po wykonaniu planu 05, bo
  dopiero wtedy będzie wiadomo, które pola planu mają być ujawnione.

## Poza zakresem

Nie przywracamy starego inputu jako drugiego formatu i nie tworzymy nowej
warstwy danych tylko po to, by opakować obecny `CompositionPlan`.
