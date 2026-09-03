# Composition — dokumentacja kanoniczna

Ten katalog opisuje aktualny produkcyjny model composition. Jest źródłem
prawdy dla odpowiedzialności modułów, przebiegu planowania, ewaluacji i
uzasadnienia decyzji. Plany release opisują kolejność prac; research opisuje
badania historyczne i nie zastępuje tych dokumentów.

## Przebieg

```text
CompositionInput → flows → planner → CompositionPlan → evaluator → renderer
```

Planner wylicza kompletny plan przed rysowaniem. Evaluator sprawdza legalność,
a następnie jakość legalnych wariantów. Renderer wykonuje wybrany plan i nie
decyduje po fakcie o łamaniu tekstu.

## Dokumenty

- [Planner](planner.md) — wejście, etapy planowania, flow barriers, insertiony,
  kandydaci i refinement.
- [Evaluator](evaluator.md) — hard gate, score, składniki, konfiguracja i
  obserwowalność wyniku.
- [Decyzje](decisions.md) — dlaczego system ma taki podział odpowiedzialności
  i jakie kompromisy zostały przyjęte.

## Zasada aktualizacji

Zmiana kontraktu, kolejności etapów, sposobu liczenia score’u, reguły legalności
albo źródła geometrii wymaga jednoczesnej aktualizacji właściwego dokumentu w
tym katalogu oraz planu wykonawczego, który tę zmianę realizuje. Test i komentarz
w kodzie mogą doprecyzować zachowanie, ale nie są jedynym miejscem opisującym
regułę.

Każdy nowy block kind lub typ insertionu musi zostać dopisany do mapy wejście →
pomiar → placement → kolizje → ewaluacja → renderowanie przed uznaniem obsługi
za stabilną.
