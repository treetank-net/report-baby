# Release 1.1 — jawny paint order

Status: propozycja kontraktu; implementacja nierozpoczęta.

Release 1.0 koncentruje się na geometrii: `priority` ma określać siłę
roszczenia placementu do wcześniejszej rezerwacji i materializacji miejsca.
Wartość pominięta w migrowanym template'cie pochodzi z
`composition_priority.default` w YAML (obecnie `100`), nigdy z kodowego `0`.
Fizyczny porządek rysowania PDF-u pozostaje w 1.0 kompatybilnym baseline'em.

Jawny, konfigurowalny paint order jest osobnym zakresem release 1.1 i został
opisany w [01-paint-order-contract.md](01-paint-order-contract.md).
