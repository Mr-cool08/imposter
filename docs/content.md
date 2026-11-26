# Innehåll i Imposter Party

`data/categories.json` listar kategorierna i visningsordning. Lägg ord i `data/words/*.json` och ordpar i `data/pairs/*.json`. Varje ord- och parfil innehåller en JSON-lista. Kategorimetadata kan också ligga i `data/category_parts/*.json`, med ett kategoriobjekt eller en lista per fil. Ett fragment ersätter motsvarande kategori i den sammanställda listan. Dubbla kategori-ID:n inom samma källa ger valideringsfel. Flask läser metadata från båda källorna vid start och skickar den sammanslagna listan som manifest.

Använd UTF-8 och stabila, småbokstaviga ASCII-ID:n med bindestreck eller understreck mellan delarna. Underkategori-ID:n ska vara globalt unika. Använd `<kategori>-<namn>` för grundinnehållets ord-ID:n. Ordets kategori och underkategori måste finnas i metadatan, och båda ord-ID:n i ett par måste finnas i samma innehållskälla. Par får gå över kategorigränser.

I grundpaketen består varje ledtråd av ett ord. En lätt ledtråd ger en tydlig association, medan en svår ledtråd har en mer indirekt koppling till svaret.

**Välkända** är ord som en blandad grupp kan känna igen utan specialkunskap. **Mellannivå** rymmer ämnesspecifika ord som är vanliga inom kategorin. **Expert** är till för ovanliga begrepp och detaljer som kräver fördjupad ämneskunskap. Minecraft och Clash Royale börjar på Mellannivå eftersom innehållet bygger på spelkunskap.

## Python och HTTP

`ContentCatalog.load(data_dir)` läser, validerar och laddar innehållet. `catalog.categories` innehåller kategoriobjekten. `catalog.version` identifierar innehållet och ändras vid ändringar i metadatan, orden eller paren. `catalog.pack(category_id)` returnerar `{version, category, words, pairs}` med kategoriobjektet och alla giltiga par där minst ett ord hör till kategorin. Ett okänt ID ger `KeyError`. `/api/content/manifest` returnerar `{version, categories}` och `/api/content/packs/<category>.json` levererar `catalog.pack(category)`.

`catalog.select(settings, custom=None)` returnerar `{words, pairs}` med kompletta ordobjekt. Ett par kan bara användas när båda orden ingår i urvalet. `catalog.validate_custom(custom)` returnerar ett validerat och normaliserat `{categories, words, pairs}` eller kastar `ContentValidationError`, en `ValueError` med en lista `.issues`. `audit_content(data_dir)` ger valideringsdiagnostik även när en fil har fel. Varje diagnostik har `severity`, `code`, `path` och `message`.

## JavaScript

Importera från `/static/js/content.mjs`. Funktionerna som hämtar innehåll använder de offentliga API-rutterna ovan.

- `loadManifest({fetch} = {})` hämtar `{version, categories}`.
- `loadPack(categoryId, {fetch, version} = {})` hämtar ett paket. Om `version` anges måste paketets version stämma.
- `loadContent(settings = {}, {manifest, custom, fetch} = {})` hämtar valda paket och returnerar `{words, pairs}`. Skicka gärna manifestet som redan används av kategoriinställningarna. Utelämnat `fetch` använder webbläsarens `fetch`.
- `selectContent(settings = {}, packs = [], custom = null)` returnerar `{words, pairs}` från redan hämtade paket och ett eventuellt eget paket.

För lokalspel kan `custom` från `getCustomContent()` innehålla flera redan validerade lokala paket. Gränserna för filimport gäller per paket. Vid urvalet räknas överlappande begrepp en gång.

`settings.language` är `sv` som standard och kan sättas till `en`. Utelämnade `categories` väljer alla kategorier och `categories: []` väljer inga. En ifylld `subcategories` begränsar urvalet till dessa ID:n, även vid flera valda kategorier. Utelämnade eller tomma `subcategories` väljer alla underkategorier i de valda kategorierna. Utelämnade `levels` väljer `familiar` och `levels: []` väljer inga. `hint` ändrar ledtråden på rollkortet. Ord och par sorteras efter ID. Antalen som visas i inställningarna är `words.length` och `pairs.length`.

## Egna paket

Ett eget paket har rotobjektet `{categories, words, pairs}`. Alla tre fält är listor som får vara tomma. Kategoriobjekt har `{id, names: {sv, en}, icon, subcategories: [{id, names: {sv, en}}]}`. Ordobjekt har `{id, category, subcategory, tags, level, review, languages: {sv, en}}`. Varje språkfält har `{word, aliases, hints: {easy, normal, hard}}`. `level` är `familiar`, `intermediate` eller `expert`. `review` är `editorial` eller `needs_review`. Ett par är en lista med två olika ord-ID:n som finns i det egna paketet.

JS exporterar `validateCustom(value)`, `parseCustomJSON(text)`, `parseCustomCSV(text)`, `exportCustomJSON(package)` och `exportCustomCSV(package)`. Validering ger ett normaliserat paket eller ett fel med `.issues`. CSV är en tabell med radtypen `category`, `subcategory`, `word` eller `pair`. Listorna med taggar och alias representeras som JSON-arrayer i sina CSV-celler. Exportera ett paket för att få de exakta kolumnnamnen och radformatet.

`CUSTOM_LIMITS` beskriver gränserna som också tillämpas på servern. Den serialiserade JSON-datan får vara högst 256 KiB. Paketet får innehålla upp till 50 kategorier, 200 underkategorier, 500 ord och 1 000 par. Ett ord får ha upp till 16 taggar och 16 alias per språk. ID:n får ha högst 100 tecken, `icon` 64, namn, ord och alias 100, ledtrådar 160 och taggar 40. Visningstext får inte innehålla kontrolltecken. Texten trimmas och okända fält utelämnas vid normalisering. Egna paket måste ha unika ID:n och tre olika ledtrådar per språk. ID:n som används i samma typ av post i grundinnehållet får inte återanvändas i egna paket.

Onlinerum har dessutom transportgränsen `ONLINE_MAX_CUSTOM_BYTES` som beskrivs i [onlinedokumentationen](online.md).

Ord blir dubblettkandidater om deras huvudord matchar, eller ett huvudord matchar det andra ordets uttryckliga alias, i samma språk. Jämförelsen normaliserar Unicode, gemener och blanksteg och bevarar svenska diakritiska tecken. Dubbletter i grundinnehållet rapporteras och räknas en gång. Ett eget paket med interna dubbletter avvisas. Två olika begrepp med samma huvudord kan särskiljas med etablerade preciseringar i visningsnamnet.

## Validering och rapport

Kör `python tools/validate_content.py --write-report docs/content-report.md --write-categories data/categories.json` från projektroten. Kommandot kontrollerar struktur, referenser, dubbletter, ledtrådar och mängden innehåll. Det skriver rapporten även om utgivningsgränserna underskrids. Flaggan `--allow-incomplete` godtar en ofullständig katalog vid lokalt författararbete, medan strukturella fel alltid ger en felkod. Den redaktionella bedömningen av fakta, ledtrådarnas styrka och sambandet inom ordpar behöver göras av innehållsförfattarna.
