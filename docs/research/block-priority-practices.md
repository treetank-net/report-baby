# Praktyki definiowania priorytetów bloków

Date: 2026-09-09

## Zakres

To badanie dotyczy liczbowego priorytetu elementów, które konkurują o
ograniczoną geometrię strony. Nie utożsamiamy go z kolejnością czytania,
kolejnością slotów ani z kolejnością malowania PDF-u. Sprawdzamy przede
wszystkim dwa pytania:

1. Czy liczba powinna rosnąć razem z ważnością elementu?
2. Czy jedna liczba może jednocześnie opisywać kolejność rezerwacji miejsca,
   ważność konfliktu i warstwę paint?

## Fakty ze źródeł

### Nie istnieje jedna globalna konwencja kierunku liczby

Różne systemy używają liczb do różnych celów i przyjmują przeciwne kierunki.
Kierunek nie wynika z samej nazwy `priority`; musi być częścią kontraktu danego
systemu.

- Kubernetes definiuje `PriorityClass.value` jako całkowitą wartość priorytetu
  poda i wprost stwierdza, że wyższa wartość oznacza wyższy priorytet. Scheduler
  może wywłaszczać pody o niższym priorytecie, aby zrobić miejsce dla poda o
  wyższym priorytecie. Wartości mogą być rozrzucone w dozwolonym zakresie, a nie
  muszą tworzyć kolejne liczby całkowite. Zob. [Pod Priority and
  Preemption](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/)
  oraz [PriorityClass API](https://kubernetes.io/docs/reference/kubernetes-api/scheduling/priority-class-v1/).
- Java `PriorityQueue` zwraca jako głowę kolejki najmniejszy element względem
  komparatora. To jest konwencja struktury danych („co pobrać najpierw”), a nie
  twierdzenie, że mniejsza liczba oznacza większą wagę biznesową. Zob.
  [Java PriorityQueue](https://docs.oracle.com/javase/8/docs/api/java/util/PriorityQueue.html).
- CSS `order` używa liczb całkowitych jako ordinal groups i układa elementy od
  najniższej wartości do najwyższej. Jest to kolejność layoutu/display, nie
  semantyczna ważność. Specyfikacja ostrzega również, że zmiana wizualnej
  kolejności może rozbiegać się z kolejnością dokumentu i dostępności. Zob.
  [CSS Display, §3.1 Display Order](https://www.w3.org/TR/css-display-3/#order-property)
  oraz [CSS Grid, §6.3 Reordered Grid Items](https://www.w3.org/TR/css3-grid-layout/#order-property).

Wniosek z tych przykładów: nie kopiujemy kierunku z `PriorityQueue` ani z CSS
`order`. Dla report-baby jawnie wybieramy semantykę „wyższa liczba = silniejszy
priorytet”, ponieważ odpowiada ona znaczeniu słowa priorytet i praktyce
systemów schedulingowych takich jak Kubernetes.

### Priorytet, kolejność planowania i paint order to różne porządki

CSS rozdziela kolejność layoutu od kolejności warstw. W modelu `z-index` W3C
wyższy stack level jest malowany z przodu, a elementy o tym samym poziomie są
rozstrzygane kolejnością drzewa. Jednocześnie CSS `order` zmienia kolejność
rozmieszczania elementów flex/grid. To są dwa odrębne mechanizmy. Zob.
[
  CSS Positioned Layout, §4 Painting Order and Stacking Context
](https://www.w3.org/TR/css-position-4/#painting-order-and-stacking-contexts)
oraz [CSS 2.2, §9.9 Layered Presentation](https://www.w3.org/TR/CSS22/visuren.html#layers).

W3C opisuje też painter's model: elementy z dołu stosu są malowane wcześniej,
a elementy wyżej później i bliżej użytkownika. Ten porządek nie mówi nic o
tym, który element powinien dostać przestrzeń w plannerze. Zarezerwowanie
stopki przed głównym tekstem może być poprawne nawet wtedy, gdy backend namaluje
stopkę po tekście albo w osobnej warstwie.

### Wartość jest kluczem porządkującym, a remis wymaga osobnej reguły

Kubernetes używa wartości liczbowej do porównania ważności, ale klasy priorytetu
mają również nazwę i opis. Java dokumentuje, że remisy w `PriorityQueue` nie są
rozstrzygane stabilną kolejnością (dla równych wartości głowa może być
wybrana arbitralnie). CSS przy równym `z-index` używa kolejności drzewa, a przy
równym `order` kolejności dokumentu.

Dla deterministycznego planera liczba nie wystarczy. Potrzebna jest jawna
reguła tie-breakera, na przykład kolejność deklaracji slotu w template'cie.
Nazwa flowu nie powinna być ukrytym tie-breakerem.

### Liczby nie niosą znaczenia absolutnego

Kubernetes pozwala używać dowolnych poprawnych wartości całkowitych w szerokim
zakresie i mapuje je na nazwane klasy. CSS dopuszcza całkowite `z-index`, w tym
wartości ujemne, ale ich sens jest lokalny dla danego stacking contextu. Z tego
wynika praktyka, aby:

- traktować liczby jako porządek względem innych elementów w tym samym
  kontekście, a nie jako uniwersalną miarę ważności w całym systemie;
- zostawić odstępy między poziomami, jeśli template będzie rozszerzany;
- nazwać poziomy i opisać ich znaczenie zamiast zmuszać autora template'u do
  odgadywania, co oznacza np. `437`;
- nie nadawać różnicy między `400` i `300` znaczenia ilościowego („o 100
  ważniejszy”). Liczy się tylko relacja `>`.

## Wnioski dla report-baby

### Jedna liczba opisuje siłę roszczenia do geometrii

W report-baby `priority` powinien oznaczać siłę roszczenia elementu do
zachowania jego miejsca w konflikcie. Wyższa liczba wygrywa porównanie
priorytetu. Planner może dzięki temu rozpatrywać elementy w kolejności malejącej
według priorytetu, ale nie wolno z tego wyciągać wniosku o ich położeniu na
stronie.

Przykład: footer ma wysoki priorytet rezerwacji, bo jego dynamiczny box musi
być znany przed wyliczeniem wolnego miejsca dla `main`. Jego położenie na dole
strony i kolejność paint pozostają niezależne.

### Nie łączyć w jednej liczbie trzech niezależnych odpowiedzialności

`priority` nie powinien kodować naraz:

1. **reservation priority** — który blok pierwszy otrzymuje/rezerwuje
   konkurującą przestrzeń;
2. **obligation** — czy niespełnienie wymogu odrzuca cały plan, czy blok jest
   opcjonalny i może zostać pominięty;
3. **paint order** — która warstwa jest malowana nad którą.

To rozdzielenie jest istotne dla istniejących polityk:

- `header`, `footer`, lockup i wymagany stały sidebar mogą mieć wysoki
  `priority`, ale footer nie staje się przez to elementem górnej
  warstwy PDF;
- `main` może być planowany po geometrycznej rezerwacji chrome, ale pozostaje
  wymaganym flowem; późniejsza kolejność planowania nie oznacza, że wolno go
  cicho zgubić;
- soft quote może mieć niższy priorytet i `obligation: optional`, a wymagany
  quote może mieć podobny poziom liczbowy, ale `obligation: required`;
- `continuation` pozostaje osobną polityką route'u template'u. Priorytet nie
  decyduje, czy flow może przejść na następną stronę.

Na poziomie domeny rozróżniamy te trzy pytania. W release 1.0 nie dokładamy
jeszcze osobnego publicznego pola `paintOrder`, ale nie dlatego, że jawna
konfiguracja byłaby niemożliwa. Możemy później skonfigurować paint order albo
powiązać go z `priority`; trzeba wtedy zdefiniować kierunek, remisy i zakres
obowiązywania. Obecny backendowy porządek pozostaje baseline'em migracji; osobny
kontrakt tej propozycji znajduje się w
[`release-1.1/01-paint-order-contract.md`](../release-1.1/01-paint-order-contract.md).

Schemat pojęciowy (nie docelowy publiczny YAML) wygląda więc tak:

```yaml
priority: 500         # wyższa liczba = silniejsze roszczenie do geometrii
obligation: required  # istniejąca polityka hard | soft
continuation: allowed # istniejąca polityka route'u
```

`priority` jest jedynym nowym pojęciem porządkującym materializację. Nie wolno
jednak niejawnie traktować go jako `z-index`: jeżeli ma sterować również
paintem, backend musi dostać jawnie opisaną regułę mapowania.

### Zakres obowiązywania priorytetu

Priorytet powinien być znormalizowaną metadaną planu i obowiązywać w obrębie
jednego kontekstu planowania strony/kandydata. Adapter może go wyznaczyć lub
przekazać z konfiguracji route'u; nie dokładamy przez to osobnego pola
`paintOrder` do template'u. Input dokumentu dostarcza treść; nie powinien
samowolnie zmieniać priorytetu route'u ani podnosić soft insertionu do poziomu
chrome.

Priorytet nie zastępuje innych kontraktów:

- route i kolejność slotów określają, gdzie flow może się znaleźć;
- `continuation` określa, czy może przejść do kolejnej strony;
- `repeat` tworzy kolejną instancję flowu i nie jest kontynuacją;
- `obligation` określa, czy brak miejsca unieważnia plan, czy tylko usuwa
  kandydata opcjonalnego;
- evaluator nadal sprawdza kolizje, coverage, kolejność źródłową i legalność
  geometrii.

### Dwa elementy o tym samym priorytecie

Jeśli dwa bloki mają tę samą wartość, planner powinien użyć stabilnego,
template'owego tie-breakera:

1. jawna kolejność deklaracji w planie strony lub route'u;
2. kolejność slotów w layoutcie;
3. dopiero w ostateczności stabilny identyfikator techniczny.

Nie sortujemy po nazwie flowu, czasie utworzenia obiektu ani przypadkowej
kolejności kluczy mapy. Remis priorytetu nie powinien powodować losowych zmian
w PDF-ie.

## Rekomendacja skali

### Rekomendowany kontrakt kierunku

Przyjmujemy:

```text
higher number = higher reservation priority
```

Comparator planera ma sortować priorytety malejąco. W dokumentacji i nazwach
klas należy konsekwentnie pisać „wyższy priorytet” dla większej liczby.

### Rekomendowana skala poziomów

Dokładne liczby nie są standardem zaczerpniętym z CSS ani Kubernetes. Są
lokalnym kontraktem report-baby. Żeby skala była czytelna i rozszerzalna,
rekomenduję pięć nazwanych poziomów z odstępem 100:

| Wartość | Nazwa klasy | Typowe użycie | Znaczenie |
|---:|---|---|---|
| `500` | `template-chrome` | header, lockup, footer, wymagany stały sidebar | najpierw zabezpiecz geometrię chrome; konflikt nie może być rozwiązany cichym usunięciem |
| `400` | `required-auxiliary` | intro, metrics, chart, wymagany auxiliary flow | wymagany content poza `main`; brak legalnego miejsca unieważnia plan |
| `300` | `required-insertion` | twardy quote, wymagany page-local sidebar | wymagany insertion; nie może przejąć slotu innego flowu |
| `200` | `primary-flow` | `main` | podstawowa treść dokumentu, planowana po rezerwacji ograniczeń geometrycznych |
| `100` | `optional-insertion` | soft quote, opcjonalny sidebar lub inna wstawka | próbowana opcjonalnie; może odpaść, gdy szkodzi legalności albo coverage |

`500/400/300/200/100` nie oznacza odległości ważności. Odstęp 100 jest tylko
rezerwą na przyszły poziom pomiędzy istniejącymi klasami. Jeśli system nie
potrzebuje rozszerzania poziomów, równie poprawna byłaby mała skala
`5/4/3/2/1`; wybrana skala 100-500 jest czytelniejsza w YAML i nie zachęca do
używania ułamków.

Nie rekomenduję wartości `10/20/30/40/50` z dwiema wadami obecnej propozycji:
po pierwsze odwracały intuicję użytkownika („wyższy priorytet” wyglądał jak
mniejsza liczba), a po drugie były opisywane jako kolejność faz, mimo że miały
równocześnie udawać ważność konfliktu. Skala 500→100 naprawia kierunek, ale
nie zwalnia z rozdzielenia `priority`, `obligation` i paint order.

### Kolejność rezerwacji wynikająca ze skali

Dla typowej strony planner może rozpatrywać roszczenia w kolejności:

```text
500 template-chrome
400 required-auxiliary
300 required-insertion
200 primary-flow
100 optional-insertion
```

To jest kolejność *ustalania ograniczeń i rozwiązywania konfliktów*, nie
obietnica kolejności wizualnej. W szczególności footer z poziomu `500` może
zostać namalowany na dole strony, po tekście `main`.

Jeżeli dwa wymagane elementy nie mieszczą się jednocześnie, nie rozstrzygamy
tego samą liczbą: oba wymagania są niespełnialne i kandydat jest nielegalny.
Jeżeli opcjonalny element koliduje z wymaganym elementem lub pozostawia
residual `main`, odrzucamy jego kandydata. Priorytet wskazuje kolejność
rozpatrzenia i siłę roszczenia, ale nie tworzy wyjątku od twardej legalności.

## Decyzja do wpisania do kontraktu

1. `priority` jest znormalizowaną liczbą przekazywaną do planu przez adapter;
   większa liczba oznacza wyższy priorytet rezerwacji.
2. Priorytet jest lokalny dla kontekstu planowania i nie jest miarą jakości,
   ważności redakcyjnej ani kolejności paint.
3. `obligation`/hard-vs-soft oraz `continuation` pozostają osobnymi polami.
4. Równe priorytety są rozstrzygane deterministyczną kolejnością template'u.
5. Początkowa skala to `500`, `400`, `300`, `200`, `100` z nazwanymi klasami
   powyżej. To konwencja repozytorium, nie uniwersalny standard sieciowy.
6. Na etapie implementacji trzeba ustalić konkretny seam adaptera i planu, ale
   nie dodajemy publicznego `paintOrder`. Źródłem `priority` może być adapterowa
   konfiguracja route'u; input dokumentu nie może samowolnie zmieniać tej
   wartości.
