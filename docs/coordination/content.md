# Webbläsartest för lokalspel

Innehållsvalideringen, båda startsidefallen och service worker-testerna passerade. Vid körning av `test_mobile_local_game_after_disabling_network` med `IMPOSTER_BROWSER_CHANNEL=chrome` gick det att ladda ner ordpaket, ladda om utan nätverk, starta en omgång och visa första rollkortet. Testet stannade vid kontrollen att kortet döljs när en annan flik förs fram.

Ett fristående Playwright-prov med två flikar och Pixel 7-emulering visade att installerad Chrome i headless-läge behöll `document.visibilityState === "visible"` och `document.hasFocus() === true` i första fliken. Provet registrerade inga `blur`- eller `visibilitychange`-händelser när den andra fliken anropade `bring_to_front()`. Det verkliga fokusbytet behöver verifieras i det gemensamma webbläsarspåret.
