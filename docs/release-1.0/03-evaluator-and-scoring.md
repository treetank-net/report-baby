# Plan 03 — evaluator i score

Status: hard gate, konfigurowalny score i porównanie kandydatów są
zaimplementowane i zweryfikowane w eksperymencie 1; wagi pozostają heurystyczne
i wymagają późniejszej kalibracji na korpusie

## Cel

Evaluator ma odpowiadać na dwa osobne pytania:

1. Czy plan jest legalny?
2. Jeżeli jest legalny, jak dobry jest jego układ?

Hard violation zawsze eliminuje plan, niezależnie od jego score. Score nie może
być sposobem na przepchnięcie utraty treści, overlapu albo placementu poza
ramą.

## Stan obecny

`CompositionEvaluation` zawiera `status`, `diagnostics`, `hardViolations`,
`score`, `scoreBreakdown` i `residualContent`. Evaluator sprawdza containment,
overlap, kolejność, coverage, grafiki, tabele, atomic blocks i residual content.
Score korzysta wyłącznie z danych planu i konfiguracji `composition_score` w
`render-config.yml`.

Istnieje prototyp score w
[`prototype-composition-debug.mjs`](../../server/scripts/prototype-composition-debug.mjs),
ale nie jest produkcyjnym kontraktem. Produkcyjny evaluator czyta wyłącznie
`composition_score` z `render-config.yml`.

## Decyzja po eksperymencie 1: skąd jest score

Nie jest to standard CSS, funkcja z W3C, model statystyczny ani wynik
kalibracji na danych. To jawna, deterministyczna heurystyka produktu Report
Baby, wyprowadzona z wcześniejszego prototypu debugowego i obserwacji
rzeczywistych artefaktów editorialu. Jej rolą jest uporządkować legalne
alternatywy, a nie ogłosić obiektywnie „ładny” dokument.

Wartość score’u jest liczona jako:

```text
base + suma punktów składników jakości
```

Aktualne składniki są następujące:

| Składnik | Pomiar | Wpływ |
|---|---|---|
| `column-balance` | Średnia, dla stron wielokolumnowych, z `min(lineCount) / max(lineCount)` | dodatni, przez `column_balance_weight` |
| `heading-following-line` | Liczba nagłówków, po których w tym samym page/slot występuje tekst | dodatni, przez `heading_following_line_bonus` |
| `paragraph-fragmentation` | Liczba akapitów rozdzielonych między różne page/slot | ujemny, przez `paragraph_fragmentation_penalty` |
| `orphan-lines` | Liczba jedno-liniowych fragmentów akapitu oddzielonych od reszty przerwą co najmniej `orphan_min_gap_mm`, gdy przerwę wywołuje obstacle | ujemny, przez `orphan_penalty` |
| `insertion-spacing` | Nierówność paddingu wewnątrz insertionu, przerwy przed/po nim oraz rozrzut tych przerw między strumieniami | ujemny, przez trzy wagi spacingu |

Wszystkie pomiary powstają z geometrii planu w milimetrach. Evaluator nie
odczytuje rastrowego PDF-a, nie zgaduje pozycji na podstawie obrazu i nie
zmienia planu podczas ewaluacji. Raster służy osobnemu testowi artefaktu.

Ważna decyzja estetyczna: przerwa może być całkowicie legalna, bo niżej
znajduje się nieruszalny obstacle, ale nadal obniża score jako brzydka przerwa.
Przyczyna jest zapisywana w `details.graphicId`/decyzjach planera, lecz nie
zeruje kary jakościowej. Przesunięcie innego elementu może zmienić tę przerwę,
więc legalność przyczyny nie jest zwolnieniem z oceny wyglądu.

Wagi `100`, `12`, `4`, `3`, `4` oraz `1/1/1` są pierwszym ręcznie dobranym
zakresem roboczym. Test eksperymentu 1 pokazuje, że zmiana pozycji cytatu
zmienia wynik oraz że kara orphanów i spacingu wpływa na wybór, ale nie jest to
jeszcze kalibracja psychowizualna ani dowód, że proporcje są właściwe dla
każdego szablonu. Dlatego konfiguracja jest wersjonowana, a dalsze wagi
wymagają korpusu przypadków i porównania z oceną wizualną.

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
5. Utrzymywać komponenty jakości w konfiguracji YAML. Aktualny zakres to
   balans kolumn, heading-following, fragmentacja akapitów, orphan lines oraz
   lokalne spacingi insertionów. Hyphenation, puste miejsca i kolejne miary
   wymagają osobnych obserwowalnych definicji.
6. Nie dodawać ani nie zmieniać wag bez testu pokazującego, jaki układ dana
   waga zmienia. Eksperyment 1 spełnia ten warunek tylko dla obecnego zakresu.
7. Zdefiniować, czy residual content jest zawsze hard violation. Rekomendacja:
   tak dla release 1.0.
8. Dodać regresyjne przypadki jakościowe, w których plan jest legalny, ale
   wynik może być niekorzystny: rzadka końcowa strona tabeli, nierówny lokalny
   odstęp po insertionie oraz niepotrzebne rozdzielenie headingu od pierwszej
   linii. Nie zamieniać ich automatycznie w hard violation.
9. Dla każdego składnika score dopisać obserwowalną miarę i przykład z
   `page-fill-table` albo realnego editorialu. Jeżeli miary nie da się jeszcze
   wiarygodnie wyznaczyć z planu, oznaczyć punkt jako wymagający uzupełnienia,
   zamiast oceniać go z rastrowego domysłu.

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

- evaluator nie modyfikuje planu ani trace; wpis fazy `evaluation` składa engine;
- legalność i score są rozdzielone: hard violation daje `-Infinity`,
  niezależnie od potencjalnych punktów jakości;
- comparator preferuje legalny plan, następnie wyższy score, a równy wynik
  pozostawia do stabilnego tie-breaku wyżej;
- legalny plan z niższym score przegrywa z legalnym planem z wyższym score;
- nielegalny plan z wysokim score zawsze przegrywa z legalnym;
- remis jest deterministyczny;
- breakdown wyjaśnia, skąd wzięła się punktacja;
- score obecnego editorialu można odczytać z JSON/trace/debug;
- powtórna ewaluacja tego samego planu daje ten sam wynik bez nowych wpisów
  w trace.

## Wymaga uzupełnienia po wykonaniu punktu X

- Wagi score wymagają kalibracji na większym korpusie editoriali i porównania
  z oceną człowieka. Obecne wartości są świadomą heurystyką, nie wartością
  referencyjną.
- Lista hard violations wymaga uzupełnienia po testach punktu 5: każdy kod
  musi mieć przypadek testowy i jasne rozstrzygnięcie, czy jest blokujący.
- Składniki jakości dla cytatów, grafik i wykresów wymagają uzupełnienia po
  planie 07; nie zakładamy ich przed zdefiniowaniem wspólnych placements.
- Detektor orphanów wymaga dalszych przypadków granicznych: naturalnego końca
  akapitu, fragmentu przechodzącego przez różne sloty oraz kilku sąsiadujących
  obstacles.

## Poza zakresem

Nie próbujemy wywnioskować z W3C jednej funkcji celu ani nie optymalizujemy
całego dokumentu bez ograniczenia kosztu.
