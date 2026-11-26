# Gränssnittet

`app/templates/index.html` laddar ett gemensamt skal och språket från `/api/i18n/<lang>.json`. `ui.mjs` öppnar `mountLocal(ctx)` i spelinställningarna direkt på `/`. Egna ordpaket går att redigera via Appval mellan omgångar.

## Spelvyn

1. `mountSettings(ctx, {root, settings, playerCount, onChange, onSelection})` visar läge, ordmaterial och val av roller. `getSelection()` ger `{words, pairs, issues, loading, error}`. Första rollkortet öppnas först när spelarna och urvalet har validerats.
2. Lokalvyn ber en spelare i taget att ta över mobilen. Spelaren trycker för att visa kortet och döljer det innan nästa spelare tar över. Fokusförlust, bakgrundsläge och återställning från webbläsarens snabbcache döljer kortet.
3. Efter sista kortet visas **Visa roller**. Knappen avslöjar roller och ord efter att gruppen har spelat. Resultatet ger val att spela igen eller återgå till inställningarna.

## Spelregler

Skalet visar `/#regler` i `#guide-view` och anropar `mountGuide(ctx)` från `app/static/js/guide.mjs` med `ctx.root` satt till `#guide-content`. Guiden skapar rubriker och innehåll där med `ctx.t`, `ctx.el`, `ctx.modeName` och `ctx.roleName`. Den laddas om i vyn när språket byts.

Länken i sidhuvudet och länkarna tillbaka använder samma dokument. Hashen fungerar även vid direktstart och webbläsarens bakåt- och framåtnavigering. Lokalvyn döljer privata kort när den lämnas och behåller spelarnas plats i omgången.

## Random Imposters

Minsta och högsta antal imposters kan väljas från 0 till antalet tillagda spelare. Tomma gränser använder det tillåtna spannet automatiskt. Om båda gränserna är lika blir antalet fast. Joker och extra roller kan minska spannet.

Utfallet kan vara ingen imposter, Reverse med en ordkunnig spelare eller att alla är imposters. Det dragna utfallet visas vid avslöjandet. Random Imposters kan även användas som en profil i Chaos.

Tidigare sparade speciallägen flyttas till Random Imposters med motsvarande fast antal. För gamla val av Reverse och alla imposters följer antalet spelarlistan fram till att en gräns redigeras.

## Delade funktioner

- `ctx.t(key, values)` väljer text med aktuell språkkod. `ctx.modeName(id)` och `ctx.roleName(id)` visar läges- och rollnamn.
- `ctx.el` skapar DOM-element med textnoder. `ctx.button` skapar knappar med gemensam stil och `ctx.notify` visar status och fel.
- `ctx.storage` sparar namn och mindre inställningar som JSON i `localStorage`. En minneskopia används om lagring blockeras. Pågående privata kort lever i minnet.
- `mountExtras(ctx)` öppnar ordpaketsredigeraren. När redigeraren stängs uppdateras urvalet med `imposter:custom-content`.
- Vyn aviserar språkbyte via `imposter:language`.
