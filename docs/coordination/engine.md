# Lokal integration

Lokalvyn startar med `createRound(players, settings, words, pairs, rules, {used, flow: "table"})`. Använd `privateState(id).card` och `act(id, "ack_role")` under överlämningen. Sista bekräftelsen byter fas till `playing`. Visa en knapp för att avslöja rollerna. Vid tryck anropar vyn `act(players[0].id, "reveal_roles")` och läser `publicState().result` i fas `reveal`. Det finns ingen inbyggd turordning eller timer under `playing`. Resultatet innehåller rollfördelning och ord, med tomma röster, vinnare och poängökningar. Resultatkoden är `roles_revealed`.

`used` är läst historik i ordning äldst till nyast. Efter ett nytt avslöjande sparar anroparen `wordId` och `pairedWordId` om det finns, en gång per omgångs-ID. Motorn uppdaterar varken historik eller poänglagring.

Verifiering med Python 3.14.7 och Chrome. `python -m pytest -q tests/test_engine.py tests/test_browser.py --tb=short` gav 72 godkända tester, inklusive Python–JavaScript-paritet, Undercover och en hel omgång med nätverket avstängt.
