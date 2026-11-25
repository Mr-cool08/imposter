# Lokal integration

Lokalvyn startar med `createRound(players, settings, words, pairs, rules, {used, flow: "table"})`. Använd `privateState(id).card` och `act(id, "ack_role")` under överlämningen. Sista bekräftelsen byter fas till `playing`. Visa en knapp för att avslöja rollerna. Vid tryck anropar vyn `act(players[0].id, "reveal_roles")` och läser `publicState().result` i fas `reveal`. Det finns ingen inbyggd turordning eller timer under `playing`. Resultatet innehåller rollfördelning och ord, med tomma röster, vinnare och poängökningar. Resultatkoden är `roles_revealed`.

`used` är läst historik i ordning äldst till nyast. Efter ett nytt avslöjande sparar anroparen `wordId` och `pairedWordId` om det finns, en gång per omgångs-ID. Motorn uppdaterar varken historik eller poänglagring.

`freePlay: true` ger Random Imposters automatiskt intervallet 0 till aktuellt spelarantal utan Joker eller extraroll. UI skickar `null` för automatisk gräns och samma explicita min/max för ett fast antal. Läget i den publika vyn förblir `random` eller `chaos`. Draget 0, spelarantal minus ett eller spelarantalet ger `none`, `reverse` respektive `all` i `result.mode`. Med Joker eller extraroll räknas tidigare kompatibla gränser fram från spelarna.

Random-ändringen verifierades med Python 3.14.7. `python -m pytest -q tests/test_engine.py --tb=short` gav 106 godkända tester, inklusive Python–JavaScript-paritet, alla möjliga fasta antal för 3–20 spelare, Chaos och kompatibla gränser för Joker och extraroller. Båda JavaScript-filerna passerade `node --check`.
