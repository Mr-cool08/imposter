# Integration av egna ord och historik

Redigeraren följer `docs/ui.md` och exporterar `mountExtras(ctx)` för `custom` och `history`. Den stöder flera lokala paket. Lokalspel och gemensamma kategorifilter läser `getCustomContent()` från `extras.mjs` i stället för `ctx.storage.get("customPack", null)`. Onlinevyn använder `listCustomPackages()` för värdens aktiva val och `getCustomPackage(id)` för `room:create` eller `room:settings`. Se `docs/extras.md` för returformat. Orddata ingår först i onlinerummet när värden har valt och skickat ett paket. Vid rensning skickar värden `custom:null`.

Skalets `ctx.saveResult(result, source, {players, sessionId, completedAt} = {})` delegerar till `recordRound({roundId: result.id, source, result, players, sessionId, completedAt})`. Använd omgångens egna spelare och en `sessionId` som är stabil över flera omgångar för att historiken ska gå att filtrera per session. För online räcker rumskoden eller en unik serverstyrd rumsidentitet. För lokalspel är ett genererat ID som byts vid nollställning av sessionspoäng lämpligt. Omgångens ID är stabilt över återanslutningar.

Flasks genererade skalmanifest inkluderar `/static/js/extras.mjs`, `/static/js/extras-history.mjs` och `/static/css/extras.css`. Offlinepanelen behöver läsa lokala kategori-ID:n från `getCustomContent().categories`, så egna kategorier inte efterfrågas som offentliga serverpaket. CSS och översättningar har kopplats in i skalet.

## Verifiering och kvarvarande kopplingar

Redigeraren har körts i Chrome via Flask på dator och i Pixel 7-vy. Servern har verifierats med testet för validering och isolering av värdens privata paket. Vid kontrollen läste `online.mjs` och `offline.mjs` fortfarande den gamla lagringsnyckeln `customPack`. Värdens paketval och offlinepanelens filtrering behöver uppdateras i respektive filansvar innan de kan verifieras från gränssnittet.
