# Plan 03 — evaluator i score

Status: można przygotować po ustabilizowaniu kontraktu z planu 01

## Cel

Evaluator ma odpowiadać na dwa osobne pytania:

1. Czy plan jest legalny?
2. Jeżeli jest legalny, jak dobry jest jego układ?

Hard violation zawsze eliminuje plan, niezależnie od jego score. Score nie może
być sposobem na przepchnięcie utraty treści, overlapu albo placementu poza
ramą.

## Stan obecny

`CompositionEvaluation` zawiera obecnie `status`, `diagnostics` i
`residualContent`. Evaluator sprawdza już containment, overlap, kolejność,
coverage, grafiki, tabele, atomic blocks i residual content, ale nie zwraca
score ani jawnej listy hard violations.

Istnieje prototyp score w
[`prototype-composition-debug.mjs`](../../server/scripts/prototype-composition-debug.mjs),
ale nie jest produkcyjnym kontraktem.

## Kroki

1. Rozszerzyć istniejący `CompositionEvaluation` o:
   - score;
   - składniki score;
   - jawne hard violations;
   - informację wystarczającą do powiązania wyniku z kandydatem.
2. Nie tworzyć nowego modelu domenowego. Jeżeli potrzebny jest techniczny
   identyfikator wariantu, ma być częścią trace albo wyniku ewaluacji.
3. Przestać dopisywać fazę `evaluation` bezpośrednio do `plan.trace`.
   Evaluator ma zwracać dane, a engine ma złożyć trace.
4. Ustalić kolejność:
   - najpierw hard gate;
   - potem residual i ostrzeżenia;
   - potem score legalnego układu;
   - na końcu deterministyczny tie-break.
5. Przenieść istniejące komponenty prototypu do konfiguracji YAML. Na start
   rozważyć: puste miejsce, balans kolumn, jakość insertionu, heading-following,
   hyphenation i lokalne przerwy po obstacle.
6. Nie dodawać wag bez testu pokazującego, jaki układ dana waga zmienia.
7. Zdefiniować, czy residual content jest zawsze hard violation. Rekomendacja:
   tak dla release 1.0.

## Minimalny kontrakt wyboru

```text
legalność
  → brak hard violations
  → brak residual content
  → wyższy score
  → stabilny tie-break
```

Nie ma standardowego, uniwersalnego score dla jakości całego dokumentu. To jest
kontrakt Report Baby, więc wagi muszą być jawne, wersjonowane i konfigurowalne.

## Testy i kryteria ukończenia

- evaluator nie modyfikuje planu ani trace;
- legalny plan z niższym score przegrywa z legalnym planem z wyższym score;
- nielegalny plan z wysokim score zawsze przegrywa z legalnym;
- remis jest deterministyczny;
- breakdown wyjaśnia, skąd wzięła się punktacja;
- score obecnego editorialu można odczytać z JSON/trace/debug;
- powtórna ewaluacja tego samego planu daje ten sam wynik bez nowych wpisów
  w trace.

## Wymaga uzupełnienia po wykonaniu punktu X

- Wagi score wymagają uzupełnienia po wykonaniu punktu 2 planu 02, bo dopiero
  wspólne ramy pokażą, które miary są rzeczywiście dostępne i jednoznaczne.
- Lista hard violations wymaga uzupełnienia po testach punktu 5: każdy kod
  musi mieć przypadek testowy i jasne rozstrzygnięcie, czy jest blokujący.
- Składniki jakości dla cytatów, grafik i wykresów wymagają uzupełnienia po
  planie 07; nie zakładamy ich przed zdefiniowaniem wspólnych placements.

## Poza zakresem

Nie próbujemy wywnioskować z W3C jednej funkcji celu ani nie optymalizujemy
całego dokumentu bez ograniczenia kosztu.
