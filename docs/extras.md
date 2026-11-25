# Egna ord och historik

`app/static/js/extras.mjs` är ingången för redigeraren och avslutad spelhistorik. Skalet monterar `mountExtras(root, context)` för `#/words` och `mountHistory(root, context)` för `#/history`. Vardera funktionen ersätter innehållet i `root`. Kontexten använder skalets `language` (`sv` eller `en`), `t(key, params?)`, `navigate` och `active` där den är tillgänglig. Texten hämtas från `data/i18n/extras.<lang>.json` via den gemensamma språkrouten. Ta med `extras.mjs`, `extras-history.mjs`, `extras.css` och aktuella språkpaket i offline-skalet.

## Integration med spel

- `listCustomPackages()` ger en kopia av sparade lokala paket. Varje paket har `{id,names,categories,words,pairs}` och `names` har `sv` och `en`. Visa namnet med rummets/gränssnittets aktuella språk.
- `getCustomPackage(id)` ger en kopia av `{categories,words,pairs}` eller `null`. Onlinevyn låter värden aktivt välja ett paket från listan och använder det avskalade objektet i rummets ordpaketshändelse. Serverns egna validerings-, storleks- och värdregler gäller. Onlinekoden ansvarar för att behandla svar och rumsstatus. Skicka bara det paket som valts.
- `getCustomContent(ids?)` kombinerar de valda lokala paketen. Utan `ids` inkluderas alla paket i det lokala kategoriurvalet. Ett tomt urval ger `{categories:[],words:[],pairs:[]}`. De tre listorna följer det gemensamma innehållsschemat. Ord- och parfiltrering tillhör innehållsmodulen.
- Anropa `recordRound({roundId, sessionId, source, completedAt, result, players, category})` när ett färdigt och redan avslöjat resultat finns. `source` är `'local'` eller `'online'`, `result` är motorns resultatsnapshot och `players` är omgångens `{id,name}`-lista. `roundId` är stabilt per spelad omgång, även vid ny rendering, uppdaterad status eller återanslutning. Skapa en unik omgångsidentitet en gång när omgången skapas, aldrig varje gång resultatet visas. `sessionId`, `completedAt` och `category` får utelämnas. Returen innehåller `ok`, `added` och `persisted`. Resultat för avbrutna eller pågående omgångar sparas först när de kan styrkas som avslutade med ett giltigt avslöjat resultat. Spelets aktuella sessionspoäng hör till spelets tillstånd, så historikimport ändrar aldrig en pågående topplista.

## Filformat

JSON-paket exporteras med `version:1`, `id`, `names`, `categories`, `words` och `pairs`. Import godtar även innehållskontraktets objekt med endast de tre listorna. Ord kräver båda språkens ord och ledtrådar på alla tre nivåer. Par använder ord-ID:n i samma paket.

CSV använder UTF-8 och en rubrikrad, med en typad rad för varje paket, kategori, underkategori, ord och par. ID:n och referenser är stabila. Vid fel visas posten, fältet och den lokaliserade valideringsorsaken innan något sparas. CSV-rubriker och begränsningar specificeras nedan tillsammans med implementationen.

Historik kan exporteras och importeras som JSON med `version:1` och `rounds`. Historikimport slår samman omgångar per ID. Lokala ledtrådsflaggor kan exporteras som JSON. Ett paket måste sparas separat efter granskning av importen.

## Lagring

Egna paket, flaggor och avslutade omgångar använder separata nycklar i `localStorage`. Vid blockerad eller full lagring fungerar ändringar i sidans minne. Vyn visar ett meddelande, och data går att exportera innan sidan laddas om. Data är lokala för webbläsarprofilen. Serverns ordlistor uppdateras aldrig av redigeraren.
