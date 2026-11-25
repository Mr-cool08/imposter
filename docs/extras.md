# Egna ord och historik

`app/static/js/extras.mjs` är ingången för redigeraren och avslutad spelhistorik. Skalet monterar `mountExtras(ctx)` för `/#custom` och `/#history`. Funktionen fyller `ctx.root` enligt `docs/ui.md`. Kontexten använder `ctx.lang`, `ctx.t(key, values?)` och skalets DOM-hjälpare. Historikvyn finns i `extras-history.mjs`. Flask inkluderar JavaScript- och CSS-filerna i offline-skalet. Texten hämtas från `data/i18n/extras.<lang>.json` via den gemensamma språkrouten.

## Integration med spel

- `listCustomPackages()` ger en kopia av sparade lokala paket. Varje paket har `{id,names,categories,words,pairs}` och `names` har `sv` och `en`. Visa namnet med rummets/gränssnittets aktuella språk.
- `getCustomPackage(id)` ger en kopia av `{categories,words,pairs}` eller `null`. Onlinevyn låter värden aktivt välja ett paket från listan och använder det avskalade objektet i rummets ordpaketshändelse. Serverns egna validerings-, storleks- och värdregler gäller. Onlinekoden ansvarar för att behandla svar och rumsstatus. Skicka bara det paket som valts.
- `getCustomContent(ids?)` kombinerar de valda lokala paketen. Utan `ids` inkluderas alla paket i det lokala kategoriurvalet. Ett tomt urval ger `{categories:[],words:[],pairs:[]}`. De tre listorna följer det gemensamma innehållsschemat. De sparade paketen måste tillsammans hålla sig inom innehållsmodulens gränser, eftersom lokalspel använder dem som ett gemensamt urval. Ord- och parfiltrering tillhör innehållsmodulen.
- Anropa `recordRound({roundId, sessionId, source, completedAt, result, players, category})` när ett färdigt och redan avslöjat resultat finns. `source` är `'local'` eller `'online'`, `result` är motorns resultatsnapshot och `players` är omgångens `{id,name}`-lista. Använd motorns `result.id` vid varje rendering, statusuppdatering och återanslutning. `sessionId`, `completedAt` och `category` får utelämnas. Returen innehåller `ok`, `added` och `persisted`. Historiken förutsätter ett giltigt avslöjat resultat. Historikimport påverkar enbart den här webbläsarens historik och statistik.

## Filformat

JSON-paket exporteras med `version:1`, `id`, `names`, `categories`, `words` och `pairs`. Import godtar även innehållskontraktets objekt med endast de tre listorna. Ord kräver båda språkens ord och ledtrådar på alla tre nivåer. Par använder ord-ID:n i samma paket.

CSV följer innehållsmodulens UTF-8-format och har radtyperna `category`, `subcategory`, `word` och `pair`. Rubrikerna är `type,id,category,subcategory,sv_name,en_name,icon,tags,level,review,sv_word,sv_aliases,sv_easy,sv_normal,sv_hard,en_word,en_aliases,en_easy,en_normal,en_hard,left,right`. ID:n och referenser i ordlistan bevaras. Vid CSV-import skapas ett paket-ID och paketnamnet hämtas från paketets första kategori. Använd JSON för att bevara paketets separata namn och ID. CSV-fälten för taggar och alias innehåller JSON-listor. Importgränsen är 1 MiB per fil. Innehållet följer storleks- och fältgränserna i `docs/content.md`. Vid fel visas post eller fält och valideringsorsak innan något sparas.

Historik kan exporteras och importeras som JSON med `version:1` och `rounds`. Varje post lagrar `{roundId,sessionId,source,completedAt,category,players,result}`. `completedAt` lagras som en ISO-tidsstämpel. Import slår samman omgångar per ID, behåller befintliga poster vid samma ID och godkänner filen som helhet innan någon post sparas. Historikfilens maxstorlek är 16 MiB. Statistik kan filtreras på källa, spelat läge och session. Imposterframgång räknas med antal omgångar som Imposter eller Spy som nämnare. Lokala ledtrådsflaggor exporteras som `{version:1,flags}`. Varje flagga har ord-ID, språk, ledtrådsnivå, text, orsak och tidsstämpel. Ett importerat ordpaket öppnas först som utkast och sparas separat.

## Lagring

Egna paket, flaggor och avslutade omgångar använder `imposter:customPackages.v1`, `imposter:hintFlags.v1` och `imposter:history.v1` i `localStorage`. Vid blockerad eller full lagring fungerar ändringar i sidans minne. Vyn visar ett meddelande, och data går att exportera innan sidan laddas om. Data är lokala för webbläsarprofilen. Serverns ordlistor uppdateras aldrig av redigeraren.
