# Composition planner

## Odpowiedzialność

Planner przyjmuje `CompositionDocument` z named flows oraz metryki tekstu i
zwraca kompletny `CompositionPlan`. Wylicza strony, sloty, line boxes,
placements, obstacles, flow placements, decyzje i trace. Nie rysuje PDF-a i nie
wybiera zwycięzcy na podstawie jakości.

Główne interfejsy są w
[`composition/engine.ts`](../../server/src/composition/engine.ts), a tekstowy
planner w [`composition/text-planner.ts`](../../server/src/composition/text-planner.ts).

## Kolejność planowania

1. Preflight waliduje wejście, template, role flow i dostępne metryki.
2. Planner mierzy i rezerwuje insertiony oraz grafiki, które wpływają na
   dostępne miejsce tekstu. Wymiary contentu muszą być znane przed wyznaczeniem
   kolizji.
3. Dla każdego flow wybierana jest trasa przez sloty i kontynuacje stron.
4. `flowBarrierBoxCandidates` dzielą zwykły placement flow pomiędzy granicami
   flow i obstacle’u. Są używane przez wrapping zwykłego tekstu; narysowanie
   kandydata w debug nie tworzy samo w sobie nowej bariery.
5. Planner układa linie według mierzonego fontu, zachowuje kolejność słów,
   heading keeps, minimalne fragmenty i reguły przejścia między slotami.
6. Reflow jest wewnętrznym przebiegiem stabilizującym pojedynczy plan, gdy
   placement zależy od wcześniej wyliczonej treści lub obstacle’u. Liczba
   przebiegów jest zapisywana jako `reflowPasses`.
7. Planner rejestruje także puste i zablokowane miejsca, aby evaluator mógł
   odróżnić naturalny koniec flow od nielegalnej dziury.

## Kandydaci i ruchome insertiony

Domyślna ścieżka jest jednoplanowa. Alternatywy powstają tylko wtedy, gdy
polityka zawiera `movableInsertionBounds` dla istniejącej propozycji insertionu.
Rama opisuje dozwolony obszar, a nie rozmiar elementu. Planner:

- zachowuje zmierzony rozmiar insertionu;
- generuje skończoną, deterministyczną listę pozycji na osi `x` albo `y`;
- utrzymuje pozycję w całości w bounds;
- zachowuje preferowaną pozycję jako tie-break i punkt odniesienia refinementu;
- buduje pełny plan dla każdej pozycji;
- po ewaluacji najlepszego wariantu może wygenerować lokalne kandydatury
  refinementu.

`planCandidates` generuje coarse candidates. `planRefinedCandidates` dostaje
wybrany plan i numer rundy, ale nie dostaje prawa do mutowania wyniku
ewaluatora. Engine ocenia każdy wariant i wybiera najlepszy legalny plan.

W eksperymencie 1 użyto jednego ruchomego cytatu, okna pionowego z konfiguracji,
pięciu kandydatów coarse i jednej rundy z trzema kandydatami refinementu. Nie
jest to jeszcze globalne przeszukiwanie wszystkich grafik, cytatów i
breakpointów.

## Reflow a kandydat

Reflow nie jest samodzielnym kryterium jakości. Jest kosztem przygotowania
konkretnego kandydata. Gdy element ma już ustaloną legalną pozycję i jego
geometria nie zależy od tekstu, kandydat może przejść bez reflow. Gdy pozycja
zależy od tekstu lub wcześniejszej kolizji, reflow stabilizuje ten jeden wariant.
Trace musi pozwolić odróżnić liczbę kandydatów od liczby przebiegów reflow.

## Gwarancje planera

- tekst nie trafia do obstacle’u;
- blocks pozostają w kolejności źródłowej;
- insertiony pozostają poza zwykłym route flow, jeśli template deklaruje je jako
  osobny flow;
- każda linia ma geometrię opartą o te same miary fontu, które wykorzysta
  renderer;
- planner nie używa score do przepchnięcia nielegalnego planu;
- trace opisuje etapy, decyzje, placements, barriers i próby kandydatów.
