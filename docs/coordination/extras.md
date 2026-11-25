# Integration av egna ord och historik

Redigeraren följer `docs/ui.md` och exporterar `mountExtras(ctx)` för `custom` och `history`. Den stöder flera lokala paket. Lokalspel och gemensamma kategorifilter läser `getCustomContent()` från `extras.mjs` i stället för `ctx.storage.get("customPack", null)`. Onlinevyn använder `listCustomPackages()` för värdens aktiva val och `getCustomPackage(id)` för `room:create` eller `room:settings`. Se `docs/extras.md` för returformat. Orddata ingår först i onlinerummet när värden har valt och skickat ett paket. Vid rensning skickar värden `custom:null`.

Skalets `ctx.saveResult(result, source, {players, sessionId, completedAt} = {})` delegerar till `recordRound({roundId: result.id, source, result, players, sessionId, completedAt})`. Använd omgångens egna spelare och en `sessionId` som är stabil över flera omgångar för att historiken ska gå att filtrera per session. För online räcker rumskoden eller en unik serverstyrd rumsidentitet. För lokalspel är ett genererat ID som byts vid nollställning av sessionspoäng lämpligt. Omgångens ID är stabilt över återanslutningar.

Flasks genererade skalmanifest inkluderar `/static/js/extras.mjs`, `/static/js/extras-history.mjs` och `/static/css/extras.css`. Offlinepanelen behöver läsa lokala kategori-ID:n från `getCustomContent().categories`, så egna kategorier inte efterfrågas som offentliga serverpaket. CSS och översättningar har kopplats in i skalet.

## Verifiering och kvarvarande kopplingar

Redigeraren har körts i Chrome via Flask på dator och i Pixel 7-vy. Ett separat webbläsartest verifierade att värden kunde välja ett av två lokala paket, att bara det valda paketet hamnade i rummet och att båda paketen saknades i den publika katalogen. I Pixel 7-vy gick det att ladda om det cachade skalet utan nätverk och öppna ett sparat eget paket och en avslutad omgång. 11 extratester i Node och 29 Flask-, innehålls- och rumstester i Python 3.14.7 passerade.

Den gemensamma webbläsarsviten rapporterade 4 passerade tester och ett fel i lokalflödets flikbyte. Vid en senare omkörning stannade testet på `document.hasFocus()` eftersom Chrome i headless-läge aldrig rapporterade att första fliken tappade fokus. Testet har därmed inte verifierat rollkortets beteende vid verklig fokusförlust. `offline.mjs` läste också fortfarande `customPack` vid sista kontrollen. Offlinepanelens hantering av egna kategori-ID:n behöver uppdateras enligt ovan.
