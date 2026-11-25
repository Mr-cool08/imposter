# Webbläsartester för Imposter Party

`python -m pytest tests/test_browser.py -q` startar Flask med en ledig lokal port för testsviten. Playwright behöver Chromium eller en lokal Chrome-installation. Installera Chromium med `python -m playwright install chromium` om det saknas. Sätt `IMPOSTER_BROWSER_CHANNEL=chrome` för att använda installerad Chrome. Testerna kör inga externa webbanrop.

Sätt `IMPOSTER_TEST_URL` till exempelvis `http://127.0.0.1:5051` för att köra mot en redan startad instans. Kör med `-k real_websocket` för att verifiera WebSocket-transporten i produktionsstarten. Pågående testrum ligger i den serverns minne.

## Monteringspunkter

Testerna använder tillgängliga rubriker, namn och formulärfält samt identifierare med prefixet `local-` i den lokala spelvyn. Kontrakten i `docs/ui.md`, `docs/offline.md` och `docs/online.md` beskriver hur vyerna monteras.

| Vy | Vad som behöver gå att hitta |
| --- | --- |
| Start | Lokalt spel, onlinespel, språkval |
| Offline | Spara valda paket, status för nedladdning |
| Lokala inställningar | Namnfält, lägg till spelare, val av kategori, spela omgång |
| Privat rollkort | Namn på den som ska få mobilen, visa kort, kortinnehåll, dölj kort |
| Ledtrådar och diskussion | Aktiv spelare, gå vidare, starta röstning |
| Privat röstning | Namn på röstande, visa alternativ, röstmål, lås röst |
| Resultat | Omgångens resultat och möjlighet till nästa omgång |
| Onlinelobby | Skapa rum, anslut med kod eller direktlänk, redo, starta omgång |
| Onlineomgång | Egna kort, bekräftelse, ledtrådstur, övergång till röstning, egna röstmål, resultat |

## Avgränsning

Webbläsartesterna verifierar att funktionerna går att använda via gränssnittet. Regelmatris, alla kombinationer av roller och granskning av privata Socket.IO-meddelanden ingår i motor- och servertesterna.
