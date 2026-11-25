# Lokal integration

Lokalvyn startar med `createRound(players, settings, words, pairs, rules, {used, flow: "table"})`. Använd `privateState(id).card` och `act(id, "ack_role")` under överlämningen. Sista bekräftelsen byter fas till `playing`. Visa en knapp för att avslöja rollerna. Vid tryck anropar vyn `act(players[0].id, "reveal_roles")` och läser `publicState().result` i fas `reveal`. Det finns ingen inbyggd turordning eller timer under `playing`. Resultatet innehåller rollfördelning och ord, med tomma röster, vinnare och poängökningar. Resultatkoden är `roles_revealed`.

`used` är läst historik i ordning äldst till nyast. Efter ett nytt avslöjande sparar anroparen `wordId` och `pairedWordId` om det finns, en gång per omgångs-ID. Motorn uppdaterar varken historik eller poänglagring.

Verifiering av mobilflödet med Python 3.14.7. 68 motortester, inklusive table-flödet och Python–JavaScript-paritet, passerade. Första gemensamma körningen efter att språkfilerna uppdaterats gav 71 godkända tester och ett testfel i webbläsarens radlokalisering. Avslöjandet hade redan renderat rätt roll per spelare. I `tests/test_browser.py` behöver `filter(has=row_header)` få en relativ selektor från `page.get_by_role("rowheader", ...)` i stället för en selektor som är begränsad till resultatvyn.
