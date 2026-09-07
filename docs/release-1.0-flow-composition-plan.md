# Plan release 1.0: stabilny model flow i kompozycji

Status: indeks planów wykonawczych

## Cel

Release 1.0 ma zakończyć przejście na jeden sposób układania treści:

```text
CompositionInput → flows → planner → placements → evaluator → renderer
```

Chcemy mieć jeden deterministyczny i utrzymywalny przebieg, w którym:

- input opiera się na named flows i uporządkowanych blocks;
- template opisuje geometrię, sloty, trasy i miejsca zarezerwowane;
- planner mierzy treść i wybiera placements przed rysowaniem;
- grafiki i inne elementy zajmujące miejsce wpływają na układ tekstu;
- evaluator odrzuca nielegalne plany i punktuje legalne układy;
- planner może porównać ograniczoną liczbę kandydatów;
- zwykły PDF, debug PDF i `dry_run` opisują ten sam plan;
- renderer wykonuje plan, ale nie podejmuje po fakcie decyzji o łamaniu tekstu.

Nie przywracamy starego `Cursor` ani starego płaskiego `ReportData`. Nie
tworzymy nowego słownika pojęć ani nowego modelu domenowego tylko po to, aby
opakować obecne zachowanie innymi nazwami.

## Decyzje nadrzędne

1. Pętla planner–evaluator zostaje w zakresie release’u. Planner przygotowuje
   kandydatów, evaluator sprawdza legalność i score, a wynik wybierany jest
   spośród legalnych planów.
2. Hard violations są ważniejsze niż score. Nielegalny plan nie może wygrać
   dlatego, że wygląda dobrze w innych aspektach.
3. Zakres pierwszej pętli jest ograniczony i deterministyczny. Nie budujemy
   od razu globalnego solvera całego dokumentu.
4. Najpierw zabezpieczamy obecne zachowanie testami, potem wydzielamy kod
   planera według odpowiedzialności. Nie dzielimy funkcji mechanicznie.
5. Każda wartość wpływająca na layout, score, threshold albo visual QA ma
   pochodzić z istniejącej konfiguracji YAML.
6. Dokumentacja kanoniczna planera, evaluatora i uzasadnień decyzji jest
   aktualizowana w tym samym kroku co zmiana kontraktu lub reguły. Plan release
   nie jest jedynym miejscem opisu systemu.

## Plany wykonawcze

Szczegóły, zależności, testy i miejsca wymagające doprecyzowania są w:

1. [Pipeline i kontrakt](release-1.0/01-pipeline-and-contract.md)
2. [Geometria i wspólne ramy](release-1.0/02-geometry-and-frames.md)
3. [Evaluator i score](release-1.0/03-evaluator-and-scoring.md)
4. [Pętla planner–evaluator](release-1.0/04-planner-evaluator-loop.md)
5. [Render, dry_run i debug](release-1.0/05-render-dry-run-debug-parity.md)
6. [Utrzymywalność planera](release-1.0/06-planner-maintainability.md)
7. [Block kinds i miękkie insertiony](release-1.0/07-block-kinds-and-soft-insertions.md)
8. [Głębokość wyszukiwania kandydatów](release-1.0/08-candidate-search-depth.md)
9. [Kary za dzielenie struktur i obsługa formatów obrazów](release-1.0/09-structure-penalties-and-image-formats.md)

Dokumentacja aktualnego systemu znajduje się osobno w katalogu
[Composition](composition/README.md). Plany wykonawcze opisują kolejność prac,
a dokumenty Composition opisują stan i uzasadnienie reguł. Każda zakończona
zmiana planera, evaluatora albo kontraktu musi zaktualizować oba miejsca.

## Regresje z audytu composition

Te przypadki pozostają w harnessie jako regresje. Nie nagrywamy nowej baseline,
aby ukryć czerwony wynik. Każdy przypadek ma osobny status: naprawiony błąd
testu, niezaimplementowana zdolność composition albo realny sygnał jakości.

| Przypadek | Co obecnie sprawdza | Wynik audytu | Zadanie |
|---|---|---|---|
| `page-layout-editorial-two-column` | odczyt tekstu flow z PDF-a i obecność obu kolumn | test był fałszywie pusty, bo parser odrzucał niekompresowane strumienie; parser naprawiony, przypadek przechodzi | utrzymać test parsera i fail-closed, a docelowo porównywać pomiar z planem composition |
| `page-fill-table` | liczba stron i minimalne wypełnienie stron | parser naprawiony; aktualnie 57 przebiegów na stronie 1 i 9 na stronie 2, przy czym druga strona jest wizualnie rzadka | zdefiniować w planie jako test rozkładu treści/tabeli, wyłączyć chrome z pomiaru i dodać ocenę końcowego fragmentu |
| `inline-markup-report` | bold, italic, glyph fallback i markup w tabeli/listach | PDF jest czytelny, ale composition gubi styl runs, drukuje część markdownu dosłownie i gubi `U+2713`; to brak funkcji, nie zepsuty assertion | przenieść inline AST/runs przez composition, zdefiniować fallback glyphów i politykę tabel, dopiero potem przywrócić zielone oczekiwania |
| `page-fill-gap-tightening` | reakcję na zbyt rzadką ostatnią stronę | oczekiwanie warningu `A4 report gaps tightened by factor` pochodzi ze starego, dwuprzebiegowego renderera; obecny composition robi jeden przebieg, a fixture mieści się na jednej stronie | zastąpić warning asercją composition-native na legalność, fill i score albo świadomie dodać drugą iterację w planie 04 |

Szybka poprawka harnessu jest częścią planu 05. Pozostałe trzy przypadki są
celowo zachowane jako zadania regresyjne i nie wolno ich „naprawiać” przez
obniżenie oczekiwań bez zmiany kontraktu renderer’a.

## Zależności

```text
01 pipeline i kontrakt
        ↓
02 geometria i wspólne ramy
        ↓
03 evaluator i score
        ↓
04 pętla planner–evaluator
        ↓
05 render, dry_run i debug
        ↓
06 utrzymywalność planera
        ↓
07 kolejne block kinds i miękkie insertiony
        ↓
08 głębokość wyszukiwania kandydatów
        ↓
09 kary za dzielenie struktur i formaty obrazów
```

Plan 05 może być częściowo wykonywany wcześniej jako obserwacja obecnego
renderingu, ale jego pełne kryteria zależą od planu 04. Plan 07 jest
rozszerzeniem po udowodnieniu, że pętla działa na ograniczonym przypadku. Plan
08 jest celowo późniejszy: najpierw musimy wiedzieć, jakie ruchy elementu są
legalne i jak działa pełne przeliczenie tekstu, dopiero potem mierzymy, czy
przeszukujemy wystarczająco dużą część dozwolonego obszaru.

## Kryteria całego release’u

- jeden opisany produkcyjny format inputu oparty o flows;
- każdy obsługiwany block kind przechodzi walidację, pomiar, placement,
  ewaluację i renderowanie;
- brak utraty treści, nielegalnego overlapu i pustych placement gaps;
- planner, evaluator, debug i renderer używają tych samych ram;
- każdy kandydat jest oceniany raz, evaluator nie mutuje planu;
- wybrany jest najlepszy legalny plan, z deterministycznym tie-breakiem;
- `dry_run` i render opisują ten sam plan;
- działają testy composition oraz ręczny przegląd realnego editorialu;
- maintainer może znaleźć cały przebieg i właściciela reguły w dokumentacji.
- maintainer może znaleźć aktualny kontrakt planera, evaluatora oraz powód
  decyzji w [kanonicznej dokumentacji composition](composition/README.md), a
  nie tylko w historii planu lub komentarzu kodu.

## Granica zakresu

Research wykazał, że ograniczona pętla jest realna bez wymiany backendu PDF.
Globalny solver bez limitu, pełne floaty, arbitralne constrainty oraz pełne
RTL/CJK pozostają poza bazowym zakresem, dopóki wcześniejsze plany nie pokażą,
że obecne seam’y są wystarczające. Zobacz
[research wykonalności](research/release-1.0-feasibility-research.md).

Kiedy dokument wykonawczy mówi „wymaga uzupełnienia po X”, oznacza to, że
obecny kod nie daje jeszcze wystarczającej wiedzy do bezpiecznej specyfikacji.
Po wykonaniu X należy zaktualizować ten dokument, zanim zaczniemy kolejny
zależny etap.

## Zadania końcowe po planie 08

Szczegółowy zakres zadań końcowych znajduje się w [Planie 09](release-1.0/09-structure-penalties-and-image-formats.md):

- kara punktowa za nieestetyczne dzielenie list i tabel;
- obsługa WebP i AVIF w resolverze, rendererze i screeningu kontrastu;
- skrócenie czasu feedbacku testów bez usuwania pełnego gate’u release’owego.
