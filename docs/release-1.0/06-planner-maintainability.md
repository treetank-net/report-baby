# Plan 06 — utrzymywalność planera

Status: po uruchomieniu pierwszej pętli; nie zaczynać od mechanicznego splitu

## Cel

Kod ma być możliwy do zrozumienia i rozszerzania bez ryzyka, że zmiana
wrappingu zmieni routing grafiki albo ochronę nagłówka.

## Stan obecny

`server/src/composition/text-planner.ts` ma około 2418 linii. `planFlow` ma
około 666 linii i łączy m.in. cursor po stronie i route, insertiony, kolizje,
grafiki, tabele, growth, wrapping, heading keeps, fragment limits, placements,
reflow i diagnostykę.

To nie oznacza, że każdą funkcję trzeba skrócić. Problemem jest skupienie wielu
odpowiedzialności i stanu mutable w jednym przebiegu.

## Kroki

1. Zabezpieczyć obecne zachowanie testami przez istniejące publiczne seamy.
2. Opisać wejścia i wyjścia `planFlow`, `planDocumentOnce`, wrappingu,
   placementów, obstacles, blocks i trace.
3. Wskazać fragmenty, które są czystymi obliczeniami i mogą zostać wydzielone
   bez zmiany kontraktu.
4. Wydzielać tylko istniejące odpowiedzialności:
   - routing;
   - wrapping i breakpointy;
   - obstacles i flow barriers;
   - blocks;
   - insertiony;
   - trace.
5. Po każdym wydzieleniu uruchamiać composition gate i test realnego
   editorialu.
6. Nie przenosić decyzji do rendererów i nie rozdzielać kodu według samych
   rozmiarów funkcji.
7. Dodać krótką mapę modułów do dokumentacji normatywnej, wskazującą właściciela
   każdej reguły.
8. Zabezpieczyć osobny, mały seam pomiaru artefaktu: parser PDF i gate nie
   powinny być splecione z regułami planera. Test błędnego dekodowania ma
   jednoznacznie odróżniać „brak treści w dokumencie” od „nie umiem odczytać
   treści z PDF-a”.

## Kryteria ukończenia

- maintainer może znaleźć planner, evaluator i renderer z jednego dokumentu;
- nowe zachowanie ma test na właściwym seamie;
- `planFlow` nie jest miejscem, w którym trzeba zmieniać każdą niezależną
  regułę jednocześnie;
- planowanie pozostaje niezależne od jsPDF poza capability seamem;
- composition gate i realny editorial są zielone po refaktoryzacji.

## Wymaga uzupełnienia po wykonaniu punktu X

- Docelowy podział plików wymaga uzupełnienia po punktach 2 i 3, bo dopiero
  analiza przepływu stanu pokaże bezpieczne granice.
- Zakres refaktoryzacji `planFlow` wymaga uzupełnienia po planie 04. Pętla może
  ujawnić, że pierwszym seamem powinno być generowanie wariantów, a nie routing.
- Kryteria wydajności wymagają uzupełnienia po benchmarku z planu 04.

## Poza zakresem

Nie wprowadzamy nowych encji domenowych i nie dzielimy pliku wyłącznie po to,
aby każda funkcja miała mniej niż 100 linii.
