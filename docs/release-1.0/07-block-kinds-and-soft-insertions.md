# Plan 07 — block kinds i miękkie insertiony

Status: wykonany dla zakresu release 1.0. Mapa block kinds, ścieżka authored
graphics, ruchome insertiony, renderer-neutralne inline runs oraz fallback
glyphów działają. Każdy obsługiwany block kind może być przypisany do jawnego
`insertionSlots` przez ograniczenia slotu; planner mierzy i materializuje tekst,
tabele oraz atomic blocks (image, metric, chart) jako jedną warstwę obstacle.
Pozostaje jedynie rozszerzanie tego kontraktu o nowe rodzaje bloków poza obecnym
modelem.

Aktualny zakres nie traktuje `quote` jako ścieżki legacy w `main`: quote jest
tekstem dostarczanym przez nazwany, nie-main flow z zadeklarowanymi
`insertionSlots`. `main` nie może ani zawierać quote, ani deklarować
`insertionSlots`; te reguły są sprawdzane w preflight i przez evaluator.
Pozostałe block kinds mogą być insertionami, jeżeli slot jawnie dopuszcza ich
rolę/rodzaj. Pozycje insertionów są ograniczane przez jawne ruchome bounds
polityki (slot jest punktem wyjścia i właścicielem warstwy). Wspólna walidacja ram insertionów i grafik znajduje się w
`composition/layout/movable-placement-validation.ts`, a ich pomiar i
materializacja korzystają z tych samych capability seams co zwykły flow.

## Cel

Ten sam model flow i placementów ma umożliwić dodawanie treści takich jak:

- cytat;
- grafika;
- KPI;
- box z metrykami;
- wykres;
- tabela lub inny block kind.

Element może być umieszczony poza głównym flow, ale jego pozycja i wymiary mają
wpływać na dostępne miejsce dla tekstu. Cytat nie powinien być na stałe
wbudowany w szablon jako „zawsze trzecia pozycja na stronie”.

## Stan obecny

Grafiki, cytaty, glyphy, tabele i atomic blocks mają jednolitą ścieżkę w
composition. `CompositionGraphic.size` wyznacza mierzony box, a
`movableGraphicBounds` używa tego samego coarse/refinement search co
`movableInsertionBounds`. Insertion block jest mierzony przez capability
`measureBlock` albo `measureTable`, dostaje placement właściwy dla rodzaju i
zawsze rejestruje prostokątny obstacle dla głównego flow.

Public input accepts authored graphics through `graphics`; the input adapter
maps them into the same `CompositionGraphic` model used by internal callers.
The generic insertion path now applies the same policy to every currently
supported content kind: the slot filters the block, the shared capability
measures it, and the placement layer materializes the corresponding text,
table, or atomic placement before ordinary flow text is laid out.

## Jednorazowy insertion z boxem z requestu

Jeżeli dokument potrzebuje pojedynczej, niestandardowej wstawki, nie musi to
oznaczać dodawania trwałego slotu do pliku template'u. Dopuszczalnym
rozszerzeniem kontraktu jest deklaracja placementu na poziomie requestu, obok
`data.flows`, na przykład:

```json
{
  "template": "pages/editorial-two-column",
  "data": {
    "flows": {
      "main": { "blocks": [] },
      "quotes": {
        "continuation": "forbidden",
        "blocks": [
          {
            "id": "quote-1",
            "type": "text",
            "role": "quote",
            "text": "Jednorazowy cytat."
          }
        ]
      }
    }
  },
  "placement_requests": {
    "insertions": [
      {
        "flow_id": "quotes",
        "block_id": "quote-1",
        "page": 1,
        "frame": { "x": 0.1, "y": 0.333, "width": 0.8, "height": "auto" },
        "sizing": { "mode": "fit-content", "max_height": "page" }
      }
    ]
  }
}
```

`placement_requests` nie tworzy zapisanego template'u ani nie mutuje
globalnej konfiguracji. Adapter buduje wyłącznie dla tego przebiegu tymczasowy
slot i route `quotes` z jednym `insertionSlots`, po czym przekazuje je do
zwykłego pipeline'u insertionów. Quote nadal musi należeć do nie-`main` flow;
request określa tylko jego jednorazową geometrię i stronę.

W publicznym requestcie mówimy o `frame`, tak samo jak w template'cie. Nie
dodajemy `frame` do samego `CompositionBlock`. Treść pozostaje w
`data.flows`, a geometria w deklaracji placementu. Planner nadal sprawdza
przynależność flow, rodzaj i rolę bloku, zawarcie frame'u w stronie, kolizje z
chrome'em i innymi twardymi elementami oraz legalność głównego flow wokół
obstacle. Brak legalnego miejsca oznacza odrzucenie planu, nie ciche
przesunięcie poza żądany frame.

Terminologia jest celowo rozdzielona: `slot` to nazwane miejsce z regułami,
`frame` to deklarowana geometria slotu lub requestu, a `box` to zmaterializowany
prostokąt w jednostkach planu (`CompositionRect`) używany przez sloty stanu,
placementy i obstacle. `box` nie jest dodatkowym rodzajem slotu.

Rozszerzenie jest teraz dostępne jako opcjonalne pole `placement_requests` w
publicznym `render_report` oraz w wejściu CLI. `CompositionInput` nadal jest
ścisły i content-only; request adapter buduje niemutowalną nakładkę slotów na
czas jednego planowania. Nie powstaje zapisany template ani osobna ścieżka
planera.

### Auto-height w jednorazowym insertionie

Docelowe `height: "auto"` w frame oznacza, że szerokość i pozycja są zadane
przez request, natomiast wysokość wynika z pomiaru treści. `fit-content` powinno
zwrócić naturalną wysokość tekstu, tabeli, wykresu, metryki lub obrazu; obstacle
otrzymuje dokładnie ten sam końcowy box. Wzrost musi następnie przesunąć
deklarowane kolejne insertiony albo zakończyć się błędem kolizji.

Requestowe `height: "auto"` i `sizing.mode: "fit-content"` są obsługiwane:
adapter wyznacza maksymalną wysokość do końca obszaru treści, a pomiar zwęża
slot i synchronizuje obstacle z placementem. Stały tryb wymaga liczbowej
wysokości i zgłasza `INSERTION_OVERFLOW`, zamiast samoczynnie rosnąć. Relacje
`grow.pushes` są walidowane; nakładające się dynamiczne sloty są legalne tylko
gdy mają jawną relację przesunięcia. Przesuwanie już zarezerwowanych,
następnych obstacle'ów pozostaje osobnym krokiem dalszej migracji.

Jeżeli `custom block` oznacza nowy rodzaj bloku, sam request z boxem nie
wystarczy. Potrzebne są osobne schema, capability pomiaru, placement i
renderer. Dla obecnych rodzajów (`text`, `table`, `chart`, `metric`, `image`)
jednorazowy insertion może korzystać ze wspólnej ścieżki.

### Pula slotów powtarzana na stronach

Jeden slot nie musi odpowiadać jednemu blokowi w całym dokumencie. Template
może zdefiniować na przykład `insertion_slots: [quote-a, quote-b]`; planner
enumeruje te dwa sloty dla każdego layoutu strony. W kontrolnym przypadku
pięciu stron i siedmiu cytatów wykorzystuje wtedy pierwsze siedem z dziesięciu
dostępnych miejsc, zamiast wymagać siedmiu definicji slotów. Kolejność bloków w
flow pozostaje kolejnością przypisania: dwa pierwsze cytaty trafiają na
pierwszą stronę, dwa następne na kolejną itd. Brak miejsca dla kolejnego
wymaganego bloku pozostaje błędem planu.

Dla jednorazowego layoutu ten sam model może być zadeklarowany w requestcie
jako jedna pula slotów powtarzana na stronach (nazwa pola jest jeszcze
kontraktem do ustalenia):

```json
{
  "placement_requests": {
    "insertion_flows": [
      {
        "flow_id": "quotes",
        "start_page": 1,
        "repeat": "each-page",
        "slots": [
          { "id": "quote-a", "frame": { "x": 0.1, "y": 0.25, "width": 0.8, "height": "auto" } },
          { "id": "quote-b", "frame": { "x": 0.1, "y": 0.55, "width": 0.8, "height": "auto" } }
        ]
      }
    ]
  }
}
```

To jest pula pojemności, nie globalny solver. Domyślnie planner zachowuje
autoredakcyjną kolejność bloków i wybiera pierwsze legalne miejsce. Jeżeli
konkretny cytat ma preferować albo wymagać wskazanego slotu, można dodać
osobne przypisanie `block_id` → `slot_id`/`page`; treść nadal pozostaje
wymagana, a preferencja konkretnego miejsca może być miękka. Wzrost pierwszego
slotu musi przesunąć następne sloty albo spowodować odrzucenie planu — nie może
przykryć kolejnego cytatu.

## Zakres testu puli dynamicznych slotów

Pierwszy fixture testowy celowo jest mały: pięć stron, siedem syntetycznych
cytatów i dwa sloty na stronę. Główny flow zawiera dość tekstu, aby przejść
przez wszystkie pięć stron, ale test nie korzysta z zewnętrznego artykułu ani
marki. Bazowy układ musi przejść jako legalny przed wykonaniem jakiejkolwiek
mutacji testowej. Każdy przypadek negatywny kopiuje ten układ i zmienia jedną
regułę, dzięki czemu porażka nie wynika z kilku wcześniejszych konfliktów.

### Stałe i rosnące sloty

Testujemy oba tryby, ponieważ mają różne kontrakty:

| Tryb | Oczekiwane zachowanie |
|---|---|
| stały (`fit_content` wyłączone, brak `grow`) | box zachowuje rozmiar; krótka treść może zostawić pustą przestrzeń, a treść większa od boxa kończy się `INSERTION_OVERFLOW` |
| rosnący (`fit_content` + `grow`) | końcowy box wynika z pomiaru; wzrost przesuwa następny slot lub kończy się odrzuceniem przy braku miejsca |
| auto-height | pozycja i szerokość są zadane przez frame, wysokość jest wynikiem pomiaru; nie wolno udawać auto-height przez stałą wysokość końcową |

W obu trybach obstacle musi mieć dokładnie ten sam końcowy prostokąt co
placement insertionu. Stały slot nie może zostać przesunięty tylko dlatego, że
planner chciałby „uratować” kompozycję.

### Macierz sytuacji nielegalnych

Każdy poniższy przypadek powinien mieć test na właściwym seamie i jednoznaczny
wynik odrzucenia. Najpierw odrzuca się błędy requestu/overlay, następnie błędy
planowania, a na końcu niespójności wykryte przez evaluator.

| Kategoria | Mutacja fixture'u | Oczekiwany skutek |
|---|---|---|
| tożsamość | nieznany `flow_id` | request odrzucony; brak route |
| tożsamość | `flow_id: main` | odrzucony; insertion nie może należeć do `main` |
| tożsamość | nieznany `block_id` | odrzucony; brak przypisanego bloku |
| tożsamość | ten sam blok przypisany dwa razy | odrzucony; brak podwójnego placementu |
| tożsamość | blok jednocześnie zwykły i insertionowy | odrzucony; brak dwóch właścicieli treści |
| flow | quote w flow bez `insertionSlots` | `QUOTE_INSERTION_FLOW_REQUIRED` |
| flow | `continuation: forbidden` przy wymaganiu kolejnej strony | odrzucony; brak cichego przejścia dalej |
| flow | `start_page > maxPages` | odrzucony; route nie ma legalnej strony startowej |
| geometria | `x`, `y`, `width` lub stała `height` niedodatnie | odrzucony przed plannerem |
| geometria | frame wychodzi poza stronę | odrzucony przed plannerem |
| geometria | frame nachodzi na header/footer/lockup | odrzucony jako konflikt z chrome'em |
| geometria | dwa dynamiczne frame'y nachodzą na siebie | odrzucony przed przypisaniem bloków |
| geometria | dynamiczny frame nachodzi na twardy insertion | odrzucony; nie wolno przykrywać obstacle |
| geometria | `grow.max_height` poniżej minimum albo poza stroną | odrzucony jako niepoprawna polityka wzrostu |
| geometria | `grow.pushes` wskazuje nieistniejący lub ten sam slot | odrzucony jako niepoprawna relacja przesunięcia |
| slot | slot ma rodzaj `graphic` albo `lockup` | odrzucony jako niedozwolony cel insertionu |
| slot | rola bloku nie pasuje do `allowedRoles` | slot pominięty; brak legalnego celu kończy plan błędem |
| slot | rodzaj bloku nie pasuje do `allowedBlockKinds` | slot pominięty; brak legalnego celu kończy plan błędem |
| slot | `allowedBlockIds` wyklucza blok | slot pominięty; blok nie może zmienić właściciela |
| pojemność | siedem cytatów przy pojemności 10 jest legalne, jedenaście nie | nadmiar kończy się residualem i odrzuceniem planu |
| pojemność | siedem cytatów, ale wszystkie sloty poza stronami route'u | odrzucony; nie wolno zapełniać przypadkowych stron |
| pomiar | brak `measureBlock` dla obrazu/metryki/wykresu | `INSERTION_MEASUREMENT_UNAVAILABLE` |
| pomiar | capability rzuca wyjątek | `INSERTION_MEASUREMENT_FAILED` |
| pomiar | pomiar zwraca zero/ujemną wysokość | odrzucony jako niepoprawny measurement |
| pomiar | tabela nie kończy się w dostępnych wierszach | `INSERTION_OVERFLOW` i residual tabeli |
| pomiar | tekst przekracza stały box | `INSERTION_OVERFLOW`; stały slot nie rośnie |
| wzrost | rosnący `quote-a` przykrywa `quote-b` | odrzucony albo `quote-b` przesunięty zgodnie z polityką |
| wzrost | wzrost przekracza footer lub dolną granicę strony | odrzucony; brak kompresji treści |
| plan | placement wskazuje inny slot niż route | `INSERTION_SLOT_NOT_FOUND` lub mismatch |
| plan | obstacle ma inny box niż placement | evaluator odrzuca niesynchronizowany plan |
| plan | main line przecina obstacle | evaluator odrzuca kolizję |
| plan | insertion pozostaje w residualu mimo dostępnego legalnego slotu | test wykrywa błąd przypisania |
| plan | dwa placementy używają tego samego slotu instancji strony | odrzucony; jedna instancja slotu ma jednego właściciela |

Po tej macierzy uruchamiamy `server/scripts/test-dynamic-insertion-slots.mjs`
oraz publiczny smoke `server/scripts/test-dynamic-insertion-public.mjs`:
fixture ma pięć stron, siedem cytatów i dwa sloty na stronę. Test sprawdza
zaakceptowany plan, siedem placementów, brak residuali, pulę dziesięciu
instancji oraz każdą istotną klasę odrzucenia (main, brak flow, zakres stron,
duplikaty, kolizje, wzrost, stały overflow i przekroczenie pojemności). Test
PDF jest końcowym testem artefaktu, a nie substytutem kontroli planu.

Kanoniczna mapa obecnych rodzajów bloków znajduje się w
[`docs/composition/block-kinds.md`](../composition/block-kinds.md). Opisuje
ona osobno `heading`, `paragraph`, `list-item`, `image`, `table`, `metric` i
`chart`, a także wyjaśnia, dlaczego quote jest rolą tekstu, a glyph nie jest
blokiem treści. Test dokumentacji sprawdza, że każdy kind z modelu jest w tej
mapie wymieniony.

Istnieje również starszy plan miękkich insertionów:
[`soft-insertion-placement-plan.md`](../research/soft-insertion-placement-plan.md).
Należy traktować go jako materiał badawczy do konfrontacji z planami 02–04,
nie jako drugie źródło prawdy.

## Audyt inline AST/runs — 2026-09-08

Obecny przepływ zachowuje AST i przenosi go do renderer-neutralnych styled runs:

```text
markdown-normalizer
  → NormalizedContentNode[]
  → composition/adapters/input.ts
  → CompositionBlock.content + inlineRuns + plain block.text
  → text-layout przenosi zakres runów do CompositionLine
  → adapter PDF mierzy i renderuje runy osobnymi stylami
```

Starszy parser regexowy `server/src/content/text-runs.ts` został usunięty po
potwierdzeniu, że nie ma importów produkcyjnych ani testowych. Jego zakres jest
teraz rozdzielony: AST → `CompositionInlineRun` należy do adaptera inputu,
łamanie zakresów do `composition/text`, a odczyt cmap i wybór fallbacku do
adaptera PDF. Dzięki temu nie utrzymujemy dwóch interpretacji tego samego
tekstu.

Kontrakt composition używa `CompositionInlineRun`: run zawiera tekst oraz
semantyczne markery `strong`, `emphasis` i `link`. Adapter inputu buduje je
bezpośrednio z `NormalizedContentNode[]`; `wrapBlock` przenosi odpowiedni
zakres runów do `CompositionLine`, a adapter PDF wybiera wagę/krój dla każdego
runu. Tekst pozostaje dzięki temu w selekcjonowalnej warstwie PDF. Brak osobnego
kroju italic jest rozwiązywany przez jawny fallback do dostępnego stylu upright
i ostrzeżenie. Brak glyphu w foncie marki jest rozwiązywany per run (a w tabeli
per komórka) przez zarejestrowany fallback font oraz ostrzeżenie z kodem
diagnostycznym. Samo zachowanie AST nie jest już jedyną obsługą tego przypadku.

Regresja `inline-markup-report` przechodzi: PDF używa osobnych zasobów fontu
dla marki, fallbacku i bolda, a analiza strumieni potwierdza siedem linii z
przełączeniem fontu. `pdftotext` zwraca znaki `✓` oraz tekst tabel bez literalnych
delimiterów markdown. Brak kroju italic nie kończy planowania — jest raportowany
jako ostrzeżenie i rysowany upright.

## Kroki

1. Dla każdego obecnego block kind opisać:
   - dane wejściowe;
   - sposób pomiaru;
   - wymagane wymiary;
   - placement;
   - kolizje;
   - renderowanie;
   - ocenę legalności i jakości.
2. Ustalić, które elementy są częścią flow, a które są wtrąceniem wpływającym
   na flow.
3. Dla cytatu i grafiki zdefiniować ograniczoną listę dozwolonych miejsc,
   zamiast przeszukiwania dowolnej strony.
4. Wyliczać wymiary elementu przed planowaniem tekstu, jeżeli jego box wpływa
   na kolizje.
5. Przepuścić element przez tę samą pętlę legalność → score → wybór, co tekst.
6. Dodać KPI i wykres dopiero po przejściu grafiki przez pełną ścieżkę.
7. Utrzymać glyphy jako elementy renderowania zależne od właściciela, bez
   mieszania ich z boxem tekstu, chyba że faktycznie uczestniczą w kolizji.
8. Domknąć regresję `inline-markup-report`: zachować strukturę runs podczas
   mapowania do composition dla akapitów, list i komórek tabeli; określić,
   które glyphy wymagają fallbacku oraz jakie ostrzeżenie ma powstać, gdy
   fallbacku nie ma. Test ma wykazać zarówno wygląd bold/italic, jak i brak
   utraty znaków w warstwie tekstowej.

## Kryteria ukończenia

- nowy block kind ma jedno jawne mapowanie od inputu do renderera;
- jego wymiary są dostępne przed decyzją o kolizjach;
- można zdefiniować preferowane miejsca bez hardcodowania strony 2/3 lub
  pozycji 1/4, 2/4, 3/4;
- legalność i score rozróżniają „nie można” od „można, ale gorzej wygląda”;
- realny editorial z inną grafiką, cytatami i treścią przechodzi pełny gate.

## Dalsze rozszerzenia po release 1.0

- Nowe block kinds wymagają osobnego capability seamu (pomiaru i placementu);
  nie są automatycznie uznawane za insertiony.
- Dalsza kalibracja zasad „soft” należy do punktu 08 i kolejnych benchmarków,
  nie do deklaracji slotów.
- Osobne testy rendererów mogą rozszerzyć obsługę formatów obrazów, ale nie
  powinny przenosić dekodowania do planera.

## Poza zakresem release’u bazowego

Nowe block kinds spoza obecnego modelu wymagają osobnych capability seams i nie
są automatycznie uznawane za insertiony. Nie dodajemy globalnego solvera ani
nie pozwalamy na insertion sloty w `main`.
