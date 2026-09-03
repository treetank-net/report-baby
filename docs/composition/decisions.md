# Decyzje composition i ich uzasadnienie

Ten dokument odpowiada na pytanie „dlaczego system robi to w ten sposób”.
Reguła obowiązuje, dopóki nie zostanie zmieniona tutaj, w planie wykonawczym,
w kodzie i w teście.

## Jeden model flow

Treść jest przekazywana jako named flows i uporządkowane blocks. Planner
decyduje o routingu i geometrii, evaluator o legalności i jakości, a renderer
wykonuje plan. Nie wracamy do starego płaskiego `ReportData`/`Cursor`, ponieważ
nie opisywały wspólnie multiline planningu, kolizji i kontrolowanego reflow.

## Hard gate przed jakością

Nielegalny overlap, utrata treści, zły porządek albo placement poza ramą nie
może wygrać tylko dlatego, że inne części strony wyglądają dobrze. Dlatego hard
violations są rozstrzygane przed score, a nie jako bardzo duże kary ujemne.

## Obstacle poza zwykłym flow

Cytat, grafika lub przyszły KPI może być osobnym insertionem. Jego zmierzony
box jest obstacle’em dla tekstu, ale jego tekst nie staje się liniami zwykłego
flow. Dzięki temu można zmienić typ elementu bez przepisywania mechaniki
kolumnowego tekstu.

## Flow barriers jako wspólne miejsca kontynuacji

`flowBarrierBoxCandidates` są prostokątami wynikającymi z przecięcia zwykłego
flow z obstacle’em. Jawnie pokazują, gdzie tekst może legalnie kontynuować się
przed lub za przeszkodą. Nie są dodatkowym szablonowym slotem ani kolejną
barierą tylko dlatego, że zostały narysowane w debug.

## Ruchome insertiony mają ograniczone bounds

Stałe sloty nie tworzą sensownej przestrzeni optymalizacji. Ruchomy element
otrzymuje jednak ograniczoną ramę, preferowaną pozycję i skończoną liczbę prób.
Planner generuje kompletne warianty, evaluator je porównuje, a refinement
szuka lokalnie wokół najlepszego wariantu. To daje wartość bez budowy globalnego
solvera.

## Legalna przerwa nadal może być brzydka

Fakt, że pusty obszar jest wymuszony nieruszalnym elementem, wyjaśnia przyczynę,
ale nie poprawia estetyki. Score karze nierówność i wielkość przerw także w tej
sytuacji. Przesunięcie innego ruchomego elementu może później tę przerwę zmienić.

## Reflow jest kosztem, nie jakością

Reflow służy ustabilizowaniu pojedynczego planu, gdy geometria zależy od
wcześniejszej treści. Nie jest automatycznie lepszym kandydatem. Dlatego trace
raportuje osobno liczbę kandydatów i przebiegów reflow.

## Geometria i konfiguracja są wspólne

Template, page geometry, planner, evaluator, debug i renderer mają używać tych
samych obliczonych ramek. Tunable wartości layoutu, score’u, progów i visual QA
trafiają do YAML, nie do literalów w skryptach.

## Aktualny zakres eksperymentu 1

Pierwsza optymalizacja dotyczy jednego ruchomego cytatu i realnego editorialu z
małymi akapitami. Nie rozszerzamy jeszcze tej pętli jednocześnie na wszystkie
grafiki, cytaty, breakpointy, growth i routing. Najpierw mierzymy legalność,
score, orphany, spacing, zmianę łamania oraz koszt reflow.
