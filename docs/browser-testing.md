# Webbläsartester för Imposter Party

`python -m pytest tests/test_browser.py -q` startar Flask med en ledig lokal port för testsviten. Playwright behöver Chromium eller en lokal Chrome-installation. Installera Chromium med `python -m playwright install chromium` om det saknas. Sätt `IMPOSTER_BROWSER_CHANNEL=chrome` för att använda installerad Chrome. Testerna kör inga externa webbanrop.

I CI räknas saknad Playwright eller Chromium som ett testfel.

Sätt `IMPOSTER_TEST_URL` till exempelvis `http://127.0.0.1:5051` för att köra mot en redan startad Flask- eller Docker-instans. Webbläsaren behöver ett säkert ursprung, exempelvis `localhost` eller `127.0.0.1`, för att testet av service workern ska fungera.

## Monteringspunkter

Testerna använder tillgängliga rubriker, namn och formulärfält samt identifierare med prefixet `local-`. Kontrakten i `docs/ui.md` och `docs/offline.md` beskriver hur vyerna monteras.

| Vy | Vad som behöver gå att hitta |
| --- | --- |
| Start | Spelinställningar direkt på `/`, språkval och temaval |
| Offline | Spara valda paket, status för nedladdning |
| Spelinställningar | Namnfält, lägg till spelare, val av läge och starta utdelning |
| Privat rollkort | Namn på den som ska få mobilen, visa kort, kortinnehåll, dölj kort |
| Fritt spel | Visa handlingen för att avslöja roller först efter sista kortet |
| Avslöjande | Hemligt ord, roller per spelare och möjlighet till nästa omgång |

## Avgränsning

Sviten provar startvyn i dator- och mobilemulering, språk- och temabytet och hela flödet när Playwright har stängt av nätverket. Fokus flyttas till en annan webbläsarflik under ett öppet rollkort. Sviten testar också Undercover, där spelarna får likadana kort och båda orden visas först vid gemensamt avslöjande.

För Random Imposters kontrollerar sviten att de automatiska gränserna följer spelarantalet från noll till alla. Ett intervall där minvärdet är större än maxvärdet ska blockera start. Omgångar med fyra spelare och fasta antal på noll, två, tre och fyra kontrollerar privata kort, rollfördelningen och lägesnamnet vid avslöjandet. Ett sparat Reverse-val från en äldre version ska öppnas som Random Imposters. Båda gränserna ska vara ett lägre än spelarantalet när gruppen växer.
