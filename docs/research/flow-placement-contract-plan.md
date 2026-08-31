# Plan kontraktu flow placements

Date: 2026-08-31

## Cel

Utrzymać rozdział pomiędzy:

- `slot` — przestrzenią zaoferowaną przez template jako legalne miejsce;
- `obstacle` — przestrzenią zarezerwowaną przez obraz lub osobny flow,
  której zwykły tekst nie może przykryć;
- `placement` — rzeczywistym przydziałem fragmentu treści do slotu;
- `line` — dokładną geometrią pojedynczej narysowanej linii;
- `cursor` — stanem przejścia po źródłowym flow, a nie geometrią layoutu.

Planner może używać kursora do pamiętania `blockIndex`, `startWord`, strony i
indeksu route. Kursor nie może przenosić nieograniczonej informacji o
położeniu z jednego placementu do innego placementu. Każda informacja o
wolnej przestrzeni musi być związana z konkretnym `(flowId, page, slotId)` albo
z materializowanym pod-placementem.

## Obowiązujący przebieg planowania

1. Template materializuje sloty i ich kolejność route na konkretnych stronach.
2. Planner rezerwuje twarde elementy: intro, obrazki i insertion flows.
3. Rezerwacja tworzy osobny placement oraz exclusion/obstacle; nie zmienia
   kolejności ani zawartości głównego flow.
4. Planner dzieli tekst na linie w aktualnym slocie, odejmując obstacle od
   dostępnych interwałów każdej linii.
5. `cursor` przesuwa się dopiero po wyczerpaniu bieżącego legalnego miejsca
   albo po spełnieniu reguły keep/minimum fragmentu.
6. Po planowaniu powstaje pełny `flowPlacements` registry, zawierający także
   legalne, ale puste miejsca końcowe.
7. Planner publikuje `flowBarriers`: finalne boksy kolizji przypisane do
   konkretnego docelowego flowu. Są obecnie rejestrem diagnostycznym i są
   rysowane w composition debug; następny krok to uczynienie ich jedynym
   źródłem przeszkód dla cursora.
8. Evaluator odrzuca plan, gdy niezablokowany placement jest pusty pomiędzy
   placementem zawierającym treść wcześniej i placementem zawierającym treść
   później.
9. Renderer PDF może działać wyłącznie na planie zaakceptowanym przez
   evaluator.

## Niezmienniki testowe

### Rozdział flowów

- `main`, `intro`, `quotes`, `chart` i `footer` mają osobne route'y;
- linie insertion flowu nie są liczone jako linie `main`;
- quote może być obstacle'em dla `main`, ale nie staje się jego zwykłym
  blokiem tekstowym;
- obstacle może wyłączyć część slotu, ale nie może wyłączyć całego slotu
  bez jawnego `blockedBy`.

### Kolejność i ciągłość

- placementy jednego flow są sortowane według `(page, routeIndex)`;
- tekst wypełnia route od góry do dołu, a następnie przechodzi do następnego
  legalnego miejsca zgodnie z route;
- tekst nie może pojawić się w późniejszym placement bez wcześniejszego
  placementu, jeśli wcześniejszy jest legalny i ma wolną przestrzeń;
- pusty placement pomiędzy dwoma zajętymi placementami jest błędem;
- pusty placement za ostatnią treścią jest legalny;
- miejsce całkowicie zajęte przez obstacle jest legalne jako puste, ale musi
  mieć jawnie zarejestrowane `blockedBy`.

### Geometria i atrament

- każda narysowana linia mieści się w swoim slocie i nie przecina obstacle;
- dla każdego placementu, który ma treść, istnieje co najmniej jedna linia
  lub atomowy placement z odpowiadającym `blockId`;
- fixture z obstacle'em w 1/3 i 2/3 strony wymaga atramentu w każdym
  niezablokowanym pasie, a nie tylko gdziekolwiek w dużym prostokącie slotu;
- kontrola PNG/PDF sprawdza pozycję atramentu, nie tylko deklarowane
  `hasContent`.

### Pokrycie źródła

- każdy blok zaakceptowanego flowu jest obecny w trace;
- zakresy słów są ciągłe, bez luk i nakładania;
- ostatni zakres kończy się na liczbie słów źródłowych;
- brakujące treści powodują `residualContent` i odrzucenie planu.

## Eksperyment `flowPlacements`

Harness wykonuje dwa niezależne sprawdzenia:

1. Na prawidłowym fixtureze porównuje registry z rzeczywistymi liniami,
   sprawdza route order, zajętość, `blockedBy` i atrament w pasie przed oraz po
   obstacle.
2. Tworzy mutację planu, która usuwa zawartość z placementu pomiędzy dwoma
   zajętymi placementami. Publiczny evaluator musi zwrócić
   `EMPTY_FLOW_PLACEMENT`, a test musi potwierdzić, że taki plan nie może
   wygenerować artefaktu.

Eksperyment osobno sprawdza przypadek pustego placementu końcowego. Jest on
dozwolony, ale tylko wtedy, gdy nie ma późniejszego zajętego placementu.

## Kryterium zakończenia etapu

Etap jest zakończony, gdy:

- fixture numbered-flow przechodzi z co najmniej 1000 numerowanych słów;
- wszystkie legalne pasy z treścią mają zmierzony atrament;
- mutacja pustego placementu jest odrzucona;
- aktualny edytorial Trans.INFO przechodzi plan, evaluator i PDF/PNG;
- drugi edytorial z innym tekstem, cytatami i grafiką przechodzi ten sam
  kontrakt bez specjalnych wyjątków.

Docelowe wzmocnienie po tym etapie to materializowanie pod-placementów
`before-obstacle` i `after-obstacle`. Obecny etap już wymaga ich zachowania w
geometrii linii i w kontroli atramentu, ale nie zmienia jeszcze publicznego
modelu na pełny solver pasów.
