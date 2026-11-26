# Webbläsartester för Imposter Party

`python -m pytest tests/test_browser.py -q` startar Flask med en ledig lokal port för testsviten. Playwright behöver Chromium eller en lokal Chrome-installation. Installera Chromium med `python -m playwright install chromium` om det saknas. Sätt `IMPOSTER_BROWSER_CHANNEL=chrome` för att använda installerad Chrome. Testerna kör inga externa webbanrop.

I CI räknas saknad Playwright eller Chromium som ett testfel.

Sätt `IMPOSTER_TEST_URL` till exempelvis `http://127.0.0.1:5051` för att köra mot en redan startad Flask- eller Docker-instans. Testet för avregistrering av en äldre service worker startar en egen lokal testserver.

## Monteringspunkter

Testerna använder tillgängliga rubriker, namn och formulärfält samt identifierare med prefixet `local-`. Kontraktet i `docs/ui.md` beskriver hur vyerna monteras.

| Vy | Vad som behöver gå att hitta |
| --- | --- |
| Start | Spelinställningar på svenska direkt på `/` och temaval |
| Spelregler | Direktlänk till `/#regler`, spelsteg, spellägen, roller och tillbaka till spelet |
| Spelinställningar | Namnfält, lägg till spelare, val av läge och starta utdelning |
| Privat rollkort | Namn på den som ska få mobilen, visa kort, kortinnehåll, dölj kort |
| Fritt spel | Visa handlingen för att avslöja roller först efter sista kortet |
| Avslöjande | Hemligt ord, roller per spelare och möjlighet till nästa omgång |

## Avgränsning

Sviten provar den svenska startvyn i dator- och mobilemulering, temabytet och hela spelflödet. Fokus flyttas till en annan webbläsarflik under ett öppet rollkort. Sviten testar också Undercover, där spelarna får likadana kort och båda orden visas först vid gemensamt avslöjande.

Starttestet laddar äldre sparade språkval och kontrollerar att spelet öppnas på svenska utan språkval och att en omgång går att starta.

Regelsidan testas i mobilstorlek via direktlänk och navigation. Testet kontrollerar spelstegen, de valbara spellägena, Random Imposters tre specialutfall och de roller som går att spela. Mobiltestet laddar om regelsidan innan spelomgången startas och kontrollerar att valda kategorier och spelarnamn har sparats. Det öppnar också reglerna med ett synligt rollkort och bekräftar att spelaren själv behöver öppna kortet när omgången återupptas.

För Random Imposters kontrollerar sviten att de automatiska gränserna följer spelarantalet från noll till alla. Ett intervall där minvärdet är större än maxvärdet ska blockera start. Omgångar med fyra spelare och fasta antal på noll, två, tre och fyra kontrollerar privata kort, rollfördelningen och lägesnamnet vid avslöjandet. Ett sparat Reverse-val från en äldre version ska öppnas som Random Imposters. Båda gränserna ska vara ett lägre än spelarantalet när gruppen växer.
