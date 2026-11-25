# Genomförande och arkitektur

Appen öppnar inställningarna på `/`. Spelarna lägger till namn, väljer ordmaterial och läge, och visar sina privata kort i tur och ordning på samma enhet. När korten döljs börjar gruppens fria spel. Avslöjandet visar ord, roller och faktiskt läge efter ett aktivt val.

- Flask levererar Jinja-skalet, regeldata på `/api/content/rules`, språkfiler och offentliga ordpaket. `app/content.py` läser och validerar JSON med hjälp av [innehållskontraktet](content.md).
- `app/static/js/engine.mjs` fördelar roller, förvarar den pågående omgången i minnet och exponerar privata kort och avslöjande. Gemensam regeldata och testfall kan köras mot Python- och JavaScript-motorerna. Se [motorgränssnittet](engine.md).
- `app/static/js/ui.mjs`, `local.mjs` och `settings.mjs` styr inställningar, privat överlämning och avslöjande. `extras.mjs` redigerar egna ordpaket. Se [monteringskontraktet](ui.md).
- Service workern cachar appskalet och valda offentliga ordpaket. Namn, preferenser och egna paket använder `localStorage`. Se [offlineguiden](offline.md).
- Python-, Browser- och JavaScript-tester verifierar spelflöde, språk, datavalidering och rollhemlighet. GitHub Actions kör dem och verifierar att Docker-bilden startar.
