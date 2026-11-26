# Webbläsartest för lokalspel

Ett fristående Playwright-prov med två flikar och Pixel 7-emulering visade att installerad Chrome i headless-läge behöll `document.visibilityState === "visible"` och `document.hasFocus() === true` i första fliken. Provet registrerade inga `blur`- eller `visibilitychange`-händelser när den andra fliken anropade `bring_to_front()`. Det verkliga fokusbytet behöver verifieras i det gemensamma webbläsarspåret.
