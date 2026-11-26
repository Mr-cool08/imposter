# Egna ord

`app/static/js/extras.mjs` innehåller redigeraren för egna ordpaket. Skalet monterar den via `mountExtras(ctx)`. Funktionen fyller `ctx.root` enligt `docs/ui.md`. Kontexten använder `ctx.lang` med värdet `sv`, `ctx.t(key, values?)` och skalets DOM-hjälpare. Texten hämtas från `data/i18n/extras.sv.json` via `/api/i18n/sv.json`.

## Integration med spel

- `listCustomPackages()` ger en kopia av sparade lokala paket. Varje paket har `{id,names,categories,words,pairs}` med paketnamnet i `names.sv`.
- `getCustomContent(ids?)` kombinerar de valda lokala paketen. Utan `ids` inkluderas alla paket i det lokala kategoriurvalet. Ett tomt urval ger `{categories:[],words:[],pairs:[]}`. De tre listorna följer det gemensamma innehållsschemat. De sparade paketen måste tillsammans hålla sig inom innehållsmodulens gränser, eftersom lokalspel använder dem som ett gemensamt urval. Ord- och parfiltrering tillhör innehållsmodulen.

## Filformat

JSON-paket exporteras med `version:1`, `id`, `names`, `categories`, `words` och `pairs`. Import godtar även innehållskontraktets objekt med endast de tre listorna. Varje ord kräver svenska ledtrådar på alla tre nivåer. Par använder ord-ID:n i samma paket.

CSV följer innehållsmodulens UTF-8-format och har radtyperna `category`, `subcategory`, `word` och `pair`. Rubrikerna är `type,id,category,subcategory,sv_name,icon,tags,level,review,sv_word,sv_aliases,sv_easy,sv_normal,sv_hard,left,right`. ID:n och referenser i ordlistan bevaras. Vid CSV-import skapas ett paket-ID och paketnamnet hämtas från paketets första kategori. Använd JSON för att bevara paketets separata namn och ID. CSV-fälten för taggar och alias innehåller JSON-listor. Importgränsen är 1 MiB per fil. Innehållet följer storleks- och fältgränserna i `docs/content.md`. Vid fel visas post eller fält och valideringsorsak innan något sparas.

Import av äldre JSON- och CSV-paket använder de svenska fälten. Ett importerat ordpaket öppnas först som utkast och sparas separat.

Lokala ledtrådsflaggor exporteras som `{version:1,flags}`. Varje flagga har ord-ID, språkkoden `sv`, ledtrådsnivå, text, orsak och tidsstämpel.

## Lagring

Egna paket och ledtrådsflaggor sparas som `imposter:customPackages.v1` och `imposter:hintFlags.v1` i `localStorage`. Vid blockerad eller full lagring fungerar ändringar i sidans minne. Vyn visar ett meddelande, och data går att exportera innan sidan laddas om. Data är lokala för webbläsarprofilen.
