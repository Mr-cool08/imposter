# Gränssnittet

`app/templates/index.html` laddar ett gemensamt skal och språket från `/api/i18n/<lang>.json`. `ui.mjs` öppnar `mountLocal(ctx)` i spelinställningarna direkt på `/`. Egna ordpaket går att redigera via Appval mellan omgångar. Offlinepanelen visar vilka valda paket som har sparats.

## Spelvyn

1. `mountSettings(ctx, {root, settings, playerCount, onChange, onSelection})` visar läge, ordmaterial och val av roller. `getSelection()` ger `{words, pairs, issues, loading, error}`. Första rollkortet öppnas först när spelarna och urvalet har validerats.
2. Lokalvyn ber en spelare i taget att ta över mobilen. Spelaren trycker för att visa kortet och döljer det innan nästa spelare tar över. Fokusförlust, bakgrundsläge och återställning från webbläsarens snabbcache döljer kortet.
3. Efter sista kortet visas **Visa roller**. Knappen avslöjar roller och ord efter att gruppen har spelat. Resultatet ger val att spela igen eller återgå till inställningarna.

## Delade funktioner

- `ctx.t(key, values)` väljer text med aktuell språkkod. `ctx.modeName(id)` och `ctx.roleName(id)` visar läges- och rollnamn.
- `ctx.el` skapar DOM-element med textnoder. `ctx.button` skapar knappar med gemensam stil och `ctx.notify` visar status och fel.
- `ctx.storage` sparar namn och mindre inställningar som JSON i `localStorage`. En minneskopia används om lagring blockeras. Pågående privata kort lever i minnet.
- `mountExtras(ctx)` öppnar ordpaketsredigeraren. När redigeraren stängs uppdateras urvalet med `imposter:custom-content`.
- `mountOffline(ctx)` kan visa uppdateringen av appskalet mellan omgångar. Vyn aviserar språk och val via `imposter:language`, `imposter:round-state` och `imposter:local-settings`.
