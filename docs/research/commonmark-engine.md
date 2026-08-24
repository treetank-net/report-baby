# Silnik CommonMark dla report-baby

Data: 2026-08-24
Status: rekomendacja architektoniczna; bez zmiany runtime'u.

## Wniosek

Wprowadzić warstwę `MarkdownDocument -> NormalizedContent` opartą na **`remark-parse` + `mdast-util-from-markdown` (praktycznie: `remark-parse` przez `unified`)**, z małym, własnym adapterem mdast do modelu renderera. To jedyny oceniany wariant, w którym stabilny, zwykły obiektowy AST, pozycje źródłowe i ekosystem transformacji są bezpośrednio dopasowane do znormalizowanego modelu treści. Jest zgodny z Node 18 i TypeScript, a esbuild może zbundlować ESM do obecnego CommonJS. Cena to wyraźnie większy graf zależności niż `commonmark.js` lub sam `micromark`.

Jeżeli potrzebą jest wyłącznie pełne CommonMark do HTML, a nie model dokumentu, wybrać **`micromark`**: jest mały, bezpieczny domyślnie i deklaruje 100% zgodności. Nie powinien jednak stanowić granicy domeny report-baby, bo jego bezpośrednim wynikiem jest HTML; AST wymaga dołączenia `mdast-util-from-markdown`. [Micromark](https://github.com/micromark/micromark#feature-highlights)

Nie używać `cmark` jako domyślnej ścieżki serwera Node: świetnie nadaje się jako referencja zgodności, ale wprowadza binarium/natywny mostek poza obecny samowystarczalny bundle JavaScript. `commonmark.js` jest rozsądnym wariantem minimum (referencyjny JavaScript AST), lecz API jest węzłowe i mutowalne, a nie typowanym, serializowalnym modelem treści. `markdown-it` ma bardzo dobre reguły rozszerzeń, ale zwraca tokeny przeznaczone przede wszystkim do renderowania HTML; adapter i własna dyscyplina diagnostyczna pozostają po stronie report-baby.

## Kontekst repo

`server/src/text-runs.ts` używa jednego wyrażenia regularnego do trzech ograniczonych form inline: `**bold**`, `*italic*` i `__bold__`. Nie rozpoznaje bloków, list, linków, obrazów, referencji linków, code spans, escapingu ani zagnieżdżeń. To nie jest parser CommonMark: specyfikacja definiuje dokument jako sekwencję bloków i inline’ów oraz wymaga najpierw rozpoznać strukturę blokową, a dopiero potem inline’y. [CommonMark Spec 0.31.2](https://spec.commonmark.org/0.31.2/)

`server/package.json` wymaga Node `>=18`, używa TypeScript i buduje minifikowane bundlery CJS przez `npx esbuild --bundle --platform=node --target=node18 --format=cjs`. Ocena poniżej zakłada pozostawienie tej ścieżki. Nie wykonano pomiaru końcowego rozmiaru bundla, bo nie dodawano pakietów ani nie modyfikowano lockfile'a; liczba zależności i deklarowany rozmiar są wskaźnikami, nie zastępują lokalnego pomiaru po prototypie.

## Porównanie

| Wariant | Zgodność CommonMark | Struktura wejściowa | Obrazy i caption | Rozszerzenia / normalized model | Node 18, TS, esbuild | HTML i diagnostyka | Zależności / rozmiar |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cmark` (C reference) | Najsilniejsza podstawa: projekt deklaruje przejście wszystkich testów conformance. | Pełny, programowo modyfikowalny AST; renderuje HTML, XML, LaTeX, man i CommonMark. | AST ma obraz jako element CommonMark; title jest częścią składni resource. Caption nie istnieje w CommonMark, więc trzeba go wyprowadzić własną regułą. | Dobry AST, lecz adapter FFI/subprocess i dystrybucja binarium są dodatkowym produktem. | Nie jest biblioteką Node/TS; esbuild nie bundluje C. | Renderery i AST, ale w dokumentacji nie ma modelu diagnostycznego dla błędów authoringu. HTML traktować jako dane nieufne przed dalszym renderem. | Sama biblioteka: C99 bez zewnętrznych zależności; koszt przenosi się na natywną dystrybucję. |
| `commonmark.js` | JavaScriptowa implementacja referencyjna projektu CommonMark. | Mutowalne węzły z `type`, relacjami rodzic/dziecko i `sourcepos` tylko dla bloków. | Węzeł `image`, `destination`, `title`; alt wynika z dzieci/tekstu obrazu. Caption własny. | AST można transformować, ale własny adapter musi przejść pointerową strukturę węzłów i ustalić serializację. | Pakiet wystawia CommonJS i moduł; obecny esbuild powinien go zbundlować. TypeScript wymaga sprawdzenia dostępnych deklaracji/adaptacji. | Renderer `safe` blokuje raw HTML i niebezpieczne URL-e; bez `safe` dokumentacja zaleca sanitizację. Źródłowe pozycje bloków pomagają w błędach. | Trzy bezpośrednie zależności produkcyjne (`entities`, `mdurl`, `minimist`); istnieje własny plik minified `dist`. |
| `markdown-it` | Deklaruje podążanie za specyfikacją; użyć presetu `commonmark`, nie domyślnego zestawu rozszerzeń. | `Token[]`, nie pełny dokumentowy AST. | Token obrazka zawiera atrybuty/children w zależności od reguły; title i alt trzeba znormalizować w adapterze. Caption własny. | Bardzo dobra rozszerzalność: reguły block/inline/core, pluginy i własne reguły rendererów. Model domenowy nadal własny. | Aktualne API TypeScript i import ESM; esbuild jest naturalnym bundlerem. Sprawdzić interop CJS w rzeczywistym buildzie. | HTML jest domyślnie wyłączone, ale preset `commonmark` ma je włączone; trzeba jawnie ustawić politykę. Brak wbudowanego kanału komunikatów porównywalnego z VFile. | Sześć deklarowanych zależności produkcyjnych; cięższy graf niż commonmark.js i micromark. |
| `remark-parse` / `unified` (z micromark) | `remark-parse` deklaruje CommonMark domyślnie; pod spodem stos jest oparty na micromark. | mdast: JSON-podobne węzły z `type`, `children`, `position`; dobrze pasuje do jawnego adaptera. | `image` ma `url`, `title`, `alt`; `imageReference` też `alt`. Caption nie jest CommonMark — zdefiniować w `NormalizedImage` (np. następny paragraph albo rozszerzona dyrektywa), nie improwizować w parserze. | Najlepszy wybór: pluginy przed/po adapterze, frontmatter/GFM/directives jako jawne rozszerzenia, zwykłe obiekty do walidacji Zod. | ESM-only, Node 16+ i pełne typy TS, więc Node 18 pasuje. Esbuild obsługuje bundlowanie ESM do CJS, ale to obowiązkowy test integracyjny. | mdast reprezentuje raw HTML jako `html`; nie renderować go bez świadomej polityki. `unified` przekazuje metadane i messages w VFile, a pluginy mogą emitować diagnostykę z pozycjami. | Graf pakietów największy z kandydatów; wybrać tylko potrzebne elementy, bez HTML pipeline jeśli PDF/PPTX renderuje własny model. |
| `micromark` | Projekt deklaruje 100% CommonMark, testy/fuzzing i rozszerzenia GFM/MDX/directives/frontmatter. | Bezpośrednio kompiluje Markdown do HTML (oraz ma stream); sam nie jest publicznym AST API. | HTML zawiera obraz, lecz wyciąganie alt/title z HTML jest niewłaściwą granicą modelu. Do AST dołączyć `mdast-util-from-markdown`. Caption własny. | Niskopoziomowe `SyntaxExtension`/`HtmlExtension`; bardzo dobre, gdy świadomie buduje się parser, ale większy koszt niż remark dla domenowego AST. | ESM-only i Node 16+, więc zgodne z Node 18; esbuild powinien zbundlować ESM. | Bezpieczny domyślnie: koduje/odrzuca HTML i niebezpieczne protokoły, lecz opcje dangerous otwierają XSS. Nie zapewnia wysokopoziomowych komunikatów authoringu. | Autor deklaruje około 14 kB jako najmniejszy parser CM; dodatkowy AST utility zwiększy wynik. |

## Uzasadnienie faktów i granic

CommonMark jest specyfikacją syntaktyczną, nie schematem treści redakcyjnej. Obraz ma tekst alternatywny, destination i opcjonalny title; nie definiuje caption. Dlatego `title` należy zachować jako metadane zasobu, `alt` jako dostępny opis, a `caption` musi być jawnie zdefiniowane w modelu report-baby i w regule mapowania. Nie należy automatycznie utożsamiać `title` z caption. [Spec: images](https://spec.commonmark.org/0.31.2/#images), [mdast: Image](https://github.com/syntax-tree/mdast#image)

`cmark` jest referencyjny, przenośny i bez zależności, a jego autorzy deklarują pełne przejście testów CommonMark. To czyni go dobrym oraclem do testów kontraktowych adaptera, nawet gdy nie jest wybranym runtime'em. [cmark README](https://github.com/commonmark/cmark#cmark)

`commonmark.js` daje parser AST i renderery HTML/XML, węzły z `destination` i `title`, oraz źródłowe pozycje bloków. Jego `safe: true` wyłącza przepuszczanie raw HTML i niebezpiecznych URL-i; domyślna ścieżka nie jest sanitizatorem. [commonmark.js README](https://github.com/commonmark/commonmark.js#usage)

`markdown-it` ma `parse()` zwracające tokeny, presety w tym `commonmark`, oraz publiczne `enable`, `disable`, `use` i reguły renderera. Wartość `html` jest domyślnie `false`, ale dokumentacja zaznacza `true` dla presetu `commonmark`: polityka HTML musi więc zostać jawnie narzucona po konfiguracji presetu. [API markdown-it](https://markdown-it.github.io/markdown-it/interfaces/MarkdownIt.html), [opcje](https://markdown-it.github.io/markdown-it/interfaces/MarkdownItOptions.html)

`remark-parse` opisuje się jako parser Markdown do drzewa składni; używa mdast, jest w pełni typowany TypeScriptem i wymaga Node 16+. `unified` przechowuje metadata oraz messages w VFile i modeluje drzewa jako zwykłe obiekty z polem `type`. To daje najczystszą ścieżkę: parser → walidujący adapter → `NormalizedContent` → istniejący renderer PDF/PPTX, bez HTML jako pośredniego formatu. [remark-parse README](https://github.com/remarkjs/remark/tree/main/packages/remark-parse), [unified README](https://github.com/unifiedjs/unified#syntax-tree)

`micromark` jest ESM-only, Node 16+, ma tryb buforowany i streamingowy, oraz wprost zaleca `mdast-util-from-markdown` i `mdast-util-to-markdown`, gdy wymagany jest AST. Dla nieufnego Markdown jego domyślna polityka jest korzystna, ale opcje `allowDangerousHtml` i `allowDangerousProtocol` nie mogą być włączone dla treści użytkownika. [micromark README](https://github.com/micromark/micromark#when-should-i-use-this), [security](https://github.com/micromark/micromark#security)

## Decyzje report-baby ponad standardem CommonMark

Poniższe reguły są decyzjami produktu, a nie obietnicą specyfikacji:

- CommonMark `title` obrazu jest zachowywany jako metadana, a jeśli nie ma
  jawnego `caption`, adapter report-baby używa go także jako widocznego
  captionu. Jawny `caption` ma pierwszeństwo.
- `alt` pozostaje opcjonalnym metadanym w v1; parser może je zachować, ale
  obecny renderer nie obiecuje jeszcze tagowanego PDF/PPTX.
- `caption` jest osobnym polem znormalizowanego modelu, mimo że CommonMark go
  nie definiuje.
- Raw HTML nie trafia bezpośrednio do rendererów PDF/PNG/PPTX; jest mapowany na
  kontrolowany węzeł unsupported albo diagnostykę.

## Rekomendowany projekt integracji

1. Dodać osobny moduł wejściowy, np. `server/src/markdown.ts`, który wywołuje `fromMarkdown` albo `unified().use(remarkParse).parse(value)`. Nie rozszerzać `text-runs.ts` o kolejne regexy.
2. Zdefiniować mały `NormalizedContent` niezależny od mdast, np. `Document`, `Paragraph`, `Heading`, `Text`, `Emphasis`, `Strong`, `Link`, `Image`, `List`, `Code`, `Quote` i kontrolowany `Unsupported`. Zod waliduje wynik adaptera przed renderowaniem.
3. W adapterze zachować `position` dla komunikatów; w VFile dopisywać warnings dla elementów, których renderer nie obsługuje. To zastępuje ciche degradacje.
4. Przed ustaleniem polityki rozszerzeń dopuścić tylko CommonMark core. GFM, frontmatter, math i directives aktywować pojedynczo wraz z mapowaniem do modelu i testami. `html` mapować na warning/`Unsupported` albo bezpieczny tekst — nie przepuszczać go do SVG/PDF.
5. Zdefiniować osobny kontrakt obrazów: `src`, `title?: string`, `alt?: string`, `caption?: InlineContent[]`. Caption jest decyzją report-baby, ponieważ CommonMark go nie dostarcza.
6. Dodać testy oparte na `commonmark-spec` oraz testy adaptera na: referencyjne obrazy, escaped delimiters, zagnieżdżone emphasis, link references, raw HTML, niebezpieczne URL-e i pozycje błędów. Spec zawiera ponad 500 przykładów conformance. [commonmark-spec](https://github.com/commonmark/commonmark-spec#running-tests-against-the-spec)
7. W krótkim spike'u doinstalować wybrany minimalny zestaw, uruchomić `npm run build` i porównać wielkość `bundle.cjs` przed/po. Dopiero ten pomiar jest miarodajny dla esbuild; nie należy kopiować rozmiarów z cudzych bundli.

## Decyzja

**Wybrać `remark-parse`/mdast jako granicę parsera i normalizować natychmiast do własnego modelu.** Daje to pełne parserowe pokrycie, naturalne dane dla obrazów, pozycje źródłowe i kontrolowaną drogę do rozszerzeń. `micromark` pozostaje preferowaną alternatywą, jeśli po spike'u wymagania zostaną zawężone do bezpośredniego CommonMark → HTML bez AST. `cmark` pozostaje kandydatem do niezależnego oracle'a zgodności, nie zależnością produkcyjnego bundla.
