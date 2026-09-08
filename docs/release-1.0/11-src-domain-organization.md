# Plan 11 — domenowe uporządkowanie `server/src`

Status: przyjęty kierunek migracji; najpierw porządkujemy katalogi, potem
optymalizujemy implementacje. Zmiana nie może usuwać funkcjonalności MCP ani
opcjonalnego CLI.

## Stan migracji — 2026-09-08

Pierwszy etap organizacji został wykonany bez zmiany publicznego flow:

- źródła content, brand, source, template, rendering, report, artifacts,
  contracts oraz interfejsy MCP/CLI mają własne katalogi;
- ścieżki bundlowania zostały przełączone na nowe entrypointy;
- strażnik architektury poprawnie rozwiązuje importy `.js` do źródeł `.ts` i
  potwierdza brak zakazanych cykli;
- `update_plugin` kopiuje wszystkie cztery bundle runtime, oba manifesty
  pluginów oraz pełny `server/templates/**` z rejestru generowanych builtinów;
- `npm run build` i pełny `npm run test:composition` przechodzą na hoście z
  procesami potomnymi. W ograniczonym sandboxie testy PDF mogą kończyć się
  `spawnSync ... EPERM`, co jest problemem środowiska, nie regresją kodu.

To jest checkpoint organizacyjny. Dopiero po nim zaczyna się optymalizacja
wnętrza dużych modułów; każda taka zmiana ma zachować te same bundle i kontrakty
narzędzi MCP/CLI.

## Stan optymalizacji — 2026-09-08

Pierwszy przebieg optymalizacji nie zmienia przepływu danych ani publicznych
eksportów. Usunięto dwa worki odpowiedzialności:

| Moduł | Odpowiedzialność po podziale | LOC |
| --- | --- | ---: |
| `presentation/svg-renderer.ts` | SVG pojedynczego slajdu | 285 |
| `presentation/pptx-renderer.ts` | PPTX i deduplikacja mediów | 327 |
| `presentation/pdf-renderer.ts` | PDF/PNG przez rasteryzację | 127 |
| `presentation/slide-layout.ts` | geometria, RTL i dopasowanie tekstu | 286 |
| `presentation/slide-validation.ts` | walidacja zawartości slajdu | 18 |
| `presentation/contracts.ts` | kontrakty decku | 25 |
| `presentation/slides.ts` | stabilna fasada eksportów | 11 |
| `brand/context.ts` | odczyt źródeł, profili i orkiestracja | 478 |
| `brand/theme.ts` | rozwiązywanie theme/composition | 174 |
| `brand/assets.ts` | ścieżki, cache i ostrzeżenia assetów | 124 |
| `brand/color.ts` | palette i kontrast | 80 |
| `brand/value.ts` | bezpieczne wartości dokumentu | 38 |
| `brand/paths.ts` | bezpieczne ścieżki względne | 12 |
| `brand/contracts.ts` | `BrandOverrides`, `RenderComposition` | 28 |

Wcześniejsze `slides.ts` (ponad 1000 LOC) i `brand-context.ts` (ponad 900 LOC)
nie są już miejscami, w których miesza się renderer, layout, assety i
orkiestracja. `slides.ts` pozostał kompatybilną fasadą, więc MCP i CLI nie
muszą znać nowego podziału. `brand/context.ts` zachowuje istniejące operacje
publiczne (`resolveBrandContext`, `inspectBrand`, `listBrandbooks`), a nowe
moduły są ich wewnętrznymi seamami.

Po tym przebiegu `server/src` ma 18 711 linii TypeScript. Jest to metryka
orientacyjna: kolejnym krokiem będzie usuwanie powtórzeń i ręcznych obliczeń w
modułach composition, a nie mechaniczne dalsze rozcinanie każdego pliku.

Weryfikacja tego przebiegu:

- `npx tsc --noEmit` — przechodzi;
- `node scripts/architecture-check.mjs` — 101 modułów, brak zakazanych cykli;
- `npm run build` — cztery bundle oraz 19 wbudowanych szablonów;
- `npm run test:composition` na hoście — 13/13 testów przechodzi, w tym oracle,
  obrazy, kontrast, flow redakcyjny i limity stron.

Pełny `npm test` dochodzi do bramki `public MCP behavior`, ale istniejący
checkpoint `957f957` odtwarza ten sam błąd dla `pages/editorial-metrics-two-column`:
`EMPTY_FLOW_SLOT` na `1:first:segment-1` i `1:first:segment-2`. Porównanie z
czystym checkoutem checkpointu potwierdziło, że nie jest to regresja podziału
`presentation`/`brand`; pozostaje osobnym zadaniem testowo-planistycznym.

Następny seam adaptera template’u został wydzielony w
`composition/adapters/page-template-slots.ts` (192 LOC). Zawiera wspólne
mapowanie deklaracji tekstowych, blokowych, lockupów i grafik, wzrost slotów oraz
rozwijanie celów `content`. Dzięki temu `page-template.ts` (422 LOC) jest
orkiestratorem geometrii, layoutów, routingu i polityki title/auxiliary; nie
definiuje już funkcji wewnątrz `compositionTemplateFromPageGeometry` ani nie
duplikuje mapowania text/block slots. Test adaptera zachowuje dotychczasowe dwa
layouty i 142 linie planu.

## Kontekst produktu

`report-baby` jest przede wszystkim bundlowanym serwerem MCP. CLI jest drugim
frontem do tych samych operacji, a nie osobną implementacją renderera.

```text
MCP:  index.ts → rejestratory narzędzi → wspólne operacje
CLI:  cli.ts / example.ts / brand-tool.ts → wspólne operacje
```

Wzorcem są `meta-ads-baby` i `google-ads-baby`: `index.ts` uruchamia długowieczny
serwer stdio, a publiczne narzędzia pozostają dostępne przez nazwę i stabilny
schemat. W `report-baby` dodatkowo budowane są `cli-bundle.cjs`,
`example-bundle.cjs` i `brand-tool-bundle.cjs`.

Niezmienny kontrakt release:

- `server/bundle.cjs` pozostaje bundlem MCP;
- `scripts/start-mcp.js` pobiera bundle tylko wtedy, gdy nie ma go na dysku;
- `update_plugin` pozostaje publicznym narzędziem MCP;
- aktualizator rozróżnia wersję na dysku i wersję działającego procesu;
- aktualizacja jest atomowa i nie może nadpisać nowszej lokalnej instalacji;
- aktualizator kopiuje wszystkie bundle MCP/CLI, oba manifesty pluginów,
  `package.json`, launcher, `CHANGELOG.md` oraz źródła szablonów
  `server/templates/**`;
- MCP i CLI używają tych samych kontraktów oraz operacji domenowych.

## Zasady organizacji

1. Katalog domenowy grupuje wiedzę, nie przypadkowy typ pliku.
2. Kontrakty danych nie importują implementacji ani MCP/CLI.
3. Rejestrator MCP jest adapterem interfejsu; nie jest domeną renderowania.
4. CLI nie importuje `McpServer` ani nie zależy od sposobu rejestracji MCP.
5. Nie wprowadzamy nowych encji tylko po to, aby zmniejszyć plik. Istniejące
   modele (`CompositionPlan`, `SlideInput`, `RenderTheme`, `Template`) pozostają
   kontraktami lub wartościami domenowymi.
6. Nie tworzymy worków `helpers`, `utils` ani ogólnego `types`.
7. `composition/` pozostaje właścicielem planowania, placementów i evaluatora.
8. `rendering/` zna format wyjściowy, ale nie podejmuje decyzji planera.
9. Wartości liczbowe pozostają w `server/templates/render-config.yml`.
10. Każdy ruch pliku zachowuje bezpośrednie importy; wewnętrzne barrel exportery
    nie są potrzebne.

## Obecny podział odpowiedzialności

| Obszar | Obecne pliki | Główne ryzyko |
| --- | --- | --- |
| Composition | `composition/**` | najbliżej docelowego układu; nie przenosić ponownie bez seam’u |
| Input/content | `contracts/input/schema.ts`, `content/**` | schema i normalizacja są rozdzielone od composition |
| Template/config | `template/**` | kontrakty, builtin loader, kierunek i geometria mają wspólny kontekst |
| Brand | `brand/context.ts`, `brand/theme.ts`, `brand/assets.ts`, `brand/asset-preparation.ts` | dalszy seam to rozdzielenie template’ów/showcase od orkiestracji |
| Source | `source/**` | materializacja i kontekst źródeł mają osobny kontrakt |
| Presentation | `presentation/**` | layout, SVG, PDF/PNG, PPTX i walidacja są rozdzielone |
| Report | `report/**`, `composition/report-composition-entrypoint.ts` | renderer raportu i legacy plan są rozdzielone od composition |
| Rendering | `rendering/**` | prymitywy i rozwiązywanie obrazów nie należą do planerów |
| Interfaces | `interfaces/mcp/**`, `interfaces/cli/**` | rejestracja MCP i CLI są osobnymi adapterami |

`server/src` ma obecnie 18 711 linii TypeScript. Największe pozostałe moduły to
`composition/evaluation/legality.ts`, `composition/layout/text-planner.ts`,
`composition/layout/flow-planner.ts` oraz `composition/layout/insertion-layout.ts`.
Rozmiar nie jest samodzielnym kryterium podziału; ważniejsze jest to, czy moduł
ma jeden kierunek wiedzy i głęboki interfejs.

## Docelowa mapa katalogów

```text
src/
├── contracts/
│   ├── input/
│   │   ├── composition.ts
│   │   ├── slides.ts
│   │   ├── brand-source.ts
│   │   └── tool-options.ts
│   └── artifacts/
│       └── manifest.ts
├── content/
│   ├── contracts/normalized-content.ts
│   └── markdown-normalizer.ts
├── template/
│   ├── contracts.ts
│   ├── compiler.ts
│   ├── loader.ts
│   ├── builtins.ts
│   ├── geometry.ts
│   └── direction.ts
├── brand/
│   ├── contracts.ts
│   ├── references.ts
│   ├── documents.ts
│   ├── theme.ts
│   ├── assets.ts
│   ├── templates.ts
│   ├── showcase.ts
│   └── context.ts
├── source/
│   ├── contracts.ts
│   ├── context.ts
│   ├── materialization.ts
│   ├── zip-policy.ts
│   └── transports/
├── composition/
│   └── ... istniejąca mapa z planu 10 ...
├── presentation/
│   ├── contracts/
│   ├── planning/
│   │   ├── slide-context.ts
│   │   └── slide-plan.ts
│   ├── layout/
│   │   ├── slide-layout.ts
│   │   └── text-fit.ts
│   └── rendering/
│       ├── slide-svg.ts
│       ├── slide-pdf.ts
│       ├── slide-png.ts
│       ├── slide-pptx.ts
│       └── media.ts
├── report/
│   ├── contracts.ts
│   ├── template-catalog.ts
│   ├── template-resolution.ts
│   ├── composition-runtime.ts
│   ├── chrome.ts
│   ├── debug-overlay.ts
│   ├── renderer.ts
│   └── legacy-plan.ts
├── rendering/
│   ├── fonts.ts
│   ├── pdf.ts
│   ├── raster.ts
│   ├── color.ts
│   ├── image-resolver.ts
│   └── svg/
│       ├── primitives.ts
│       ├── charts.ts
│       └── metric-cards.ts
├── artifacts/
│   ├── manifest.ts
│   └── drawing-recorder.ts
├── application/
│   ├── render/
│   ├── brand-management/
│   ├── update-plugin.ts
│   └── tool-contracts.ts
├── interfaces/
│   ├── mcp/
│   │   ├── server.ts
│   │   ├── render-tools.ts
│   │   ├── brand-tools.ts
│   │   ├── update-tools.ts
│   │   └── responses.ts
│   └── cli/
│       ├── cli.ts
│       ├── example.ts
│       └── brand-tool.ts
└── infrastructure/
    ├── config.ts
    ├── update/
    └── version.ts
```

`application/` nie jest nową domeną. To miejsce dla operacji wywoływanych przez
więcej niż jeden front. MCP i CLI zależą od niego, ale nie od siebie nawzajem.

## Właściciele funkcji

### Presentation

Z `slides.ts` przenosimy według osi odpowiedzialności:

- `SlideDeck` i model renderowania → `presentation/contracts`;
- `slideLayout`, `lockupGeometry`, RTL, boxy i fit tekstu → `presentation/layout`;
- `frame`, SVG text helpers i `renderSlideSvg` → `rendering/slide-svg`;
- `renderSlidesPdf` i `PdfImage` → `rendering/slide-pdf`;
- `renderSlidesPng` → `rendering/slide-png`;
- `renderSlidesPptx`, nagłówek i footer → `rendering/slide-pptx`;
- `deduplicatePptxMedia` → `rendering/media`;
- `validateSlideContent` → walidacja prezentacji, nie renderer.

`SlideInput` (flow-based) i stary archetypowy `Slide` muszą mieć różne nazwy.
Adapter w `slide-context.ts` pozostaje tymczasowym, jawnym seamem do czasu
usunięcia starego modelu.

### Brand

`brand-context.ts` dzielimy na dokumenty/profile, referencje, theme/kolory,
asset paths, template’y brandowe, showcase oraz cienką orkiestrację `context.ts`.
`asset-preparation.ts` pozostaje procesorem assetów; kodeki PNG nie należą do
brand context.

### Template

`template-contract.ts` dzielimy na kontrakty, compiler, loader i geometrię.
`builtin-template-source.ts` staje się loaderem builtinów i konfiguracji, a nie
właścicielem wszystkich kontraktów template’u.

### Report

`report-renderer.ts` dzielimy na katalog i rozwiązywanie template’u, chrome,
debug overlay oraz orkiestrację PDF. `report-plan.ts` pozostaje jawnie pod
`legacy-plan.ts`, dopóki odpowiedź publiczna nie przejdzie całkowicie na
`CompositionPlan`.

### Tools i entrypointy

Rejestratory w `interfaces/mcp` deklarują schemat MCP i tłumaczą wynik na
response. Operacja renderowania, brand managementu lub aktualizacji znajduje
się w `application/` i nie zna `McpServer`.

`update_plugin` otrzymuje własny rejestrator MCP, ale jego semver, download,
atomic rename i komunikat o restarcie są wspólną operacją. Nie przenosimy go do
renderowania ani do domeny brandu.

## Artefakty release i szablony

Builtin template’y są osadzane w `server/src/generated/builtin-template-files.ts`
podczas `npm run build:templates`, więc bundle może działać bez katalogu
`server/templates`. Katalog źródłowy nadal jest ważny dla:

- budowania i regenerowania embedded template’ów;
- lokalnych override’ów przez `REPORT_BABY_TEMPLATE_DIR`;
- diagnostyki i pracy developerskiej;
- kompatybilności instalacji pobieranych jako checkout.

Dlatego lista aktualizatora musi kopiować `server/templates/**` wraz z bundle’ami,
a test release powinien sprawdzać obecność co najmniej `render-config.yml`,
`slides/standard/template.yml` i wszystkich `pages/*/template.yml`.

Przenoszenie źródeł w `src` nie może zmienić nazw ani lokalizacji artefaktów:
`bundle.cjs`, `cli-bundle.cjs`, `example-bundle.cjs` i `brand-tool-bundle.cjs`.

## Kierunek zależności

```text
interfaces/mcp, interfaces/cli
              ↓
        application operations
              ↓
 brand / source / template / content / composition / presentation / report
              ↓
        rendering adapters
              ↓
        infrastructure and files
```

`composition` nie importuje MCP, CLI ani rendererów slajdów. `rendering` może
korzystać z kontraktu theme i planu, ale nie z orkiestratora brandu. `contracts`
nie importują żadnych implementacji.

## Kolejność migracji

1. Poprawić `architecture-check.mjs`, aby rozwiązywał importy `.js` do źródeł
   `.ts`; obecny raport „brak cykli” jest przez to częściowo niewiarygodny.
2. Rozdzielić publiczne input contracts i nazwać jawnie oba modele slajdu.
3. Przenieść content i template’y bez zmiany zachowania.
4. Przenieść source i asset processing.
5. Rozciąć `brand-context.ts`.
6. Rozciąć `slides.ts` na layout oraz renderery formatów.
7. Rozciąć raport i oznaczyć legacy plan.
8. Wydzielić rendering primitives/SVG.
9. Wydzielić wspólne operacje narzędzi i cienkie adaptery MCP/CLI.
10. Wykonać audyt usunięć: `text-runs.ts`, stary `Slide`, legacy plan oraz
    nieużywane template’y.

Po każdym seamie uruchamiamy `tsc --noEmit`, architecture check, testy
composition oraz właściwe testy MCP, CLI, brand i artefaktów. Przed uznaniem
migracji za zakończoną trzeba dodatkowo sprawdzić `update_plugin` oraz launcher
na instalacji zawierającej zarówno bundle, jak i źródła template’ów.
