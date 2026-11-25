# Onlinespel

Socket.IO 4 kör på samma ursprung som Flask med standardnamnrymden och sökvägen `/socket.io`. Appskalet laddar den lokala klienten `/static/vendor/socket.io.min.js`. Anslutningslänken är `/join/<code>` och QR-bilden hämtas från `/api/qr/<code>.svg`. Endast rumskoden ingår i länken och QR-koden.

Klientfilen är Socket.IO 4.8.4. Bredvid den finns originalets MIT-licens, licensnotiser för inbäddade beroenden och den matchande källkartan. [Socket.IO:s klientinstallation och kontrollsumma](https://socket.io/docs/v4/client-installation/)

## Socket-händelser

Händelser tar ett JSON-objekt. Alla kommandon besvaras med `{ok:true}` eller `{ok:false,error:{code,issues?}}`. Framgång för skapa, anslut och återanslut ger också `code`, `playerId` och `token`. En lyckad ändring skickar en ny tillståndsbild till berörda spelare. Klienten registrerar lyssnare före första kommandot, eftersom bilden kan komma före kvittensen.

| Klienthändelse | Fält | Beteende |
| --- | --- | --- |
| `room:create` | `{name, settings?, custom?}` | Skapar ett rum och ansluter värden. |
| `room:join` | `{code, name}` | Ansluter en ny spelare. Under en pågående omgång väntar spelaren till nästa. |
| `room:reconnect` | `{code, token}` | Återtar samma spelar-ID. Den tidigare sockeln upphör att företräda spelaren. |
| `room:leave` | `{}` | Lämnar rummet och återkallar spelartoken. En aktiv spelare som lämnar pausar omgången. |
| `room:ready` | `{ready}` | Markerar den anslutna spelaren som redo eller ej redo. |
| `room:settings` | `{settings, custom?}` | Värden ersätter inställningarna mellan omgångar. Utelämnat paket behålls. `custom:null` tömmer paketet. |
| `room:start` | `{roundId, requestId}` | Värden startar med anslutna, redo spelare. Värden behöver ingen egen redo-markering. `roundId` är `null` i lobbyn och senaste omgångens ID i resultatvyn. |
| `room:action` | `{roundId, requestId, action, data}` | Deltagaren utför en handling enligt spelmotorns kontrakt. |
| `room:pause`, `room:resume`, `room:abort` | `{roundId, requestId}` | Värden pausar, återupptar eller avbryter en pågående omgång. |
| `room:chat` | `{roundId, requestId, text}` | En aktiv deltagare skriver i textdiskussionen. Text behandlas som ren text, högst 280 tecken. |
| `room:reset_scores`, `room:clear_history` | `{}` | Värden nollställer poäng respektive rensar rumshistoriken mellan omgångar. |

`requestId` är en klientgenererad unik sträng med 1–64 alfanumeriska tecken, bindestreck eller understreck. Använd samma ID och samma meddelande vid en omsändning. Servern minns de senaste 128 lyckade kommandona per spelare. Omgångs-ID och motorns fasregler skyddar också äldre handlingar från att upprepas. `action` och `data` följer [spelmotorgränssnittet](engine.md). Transporten härleder avsändaridentiteten från den anslutna sockeln. Ett giltigt spelar-ID som mål för exempelvis en röst ligger i handlingens `data`.

## Serverhändelser

- `room:state` är en fullständig, individuell tillståndsbild. `code`, `playerId`, `hostId`, `revision` och `serverNow` (Unix-millisekunder) finns alltid. `stage` är `lobby`, `playing` eller `result`. En rent privat uppdatering efter en dold gissning går enbart till gissaren och har samma publika revision.
- `players` innehåller `{id,name,ready,connected,waiting}`. `waiting` gäller spelare som står över den pågående omgången. `pauseReason` är `null`, `connection` eller `host`. `aborted` är senast avbrutna omgångens ID i lobbyn eller `null`.
- `settings` innehåller värdens val. `selection` är `{words,pairs}` med antal valbara ord och par. `issues` är spelmotorns lista med valideringsproblem för nästa start. `customCategories` innehåller den uppladdade katalogens kategorimetadata. Orden, ledtrådarna och paketets par ligger i serverminnet.
- `round` är spelmotorns publika projektion eller `null`. `private` är den egna privata projektionen för en deltagare eller `null`. Motorns privata `card` är `null` efter avslöjandet. Timervärden i spelmotorn och `serverNow` använder samma klocka.
- `chat` innehåller upp till 60 poster `{id,playerId,name,text,at}` från omgångens textdiskussion och skickas till omgångens deltagare. `history` innehåller avslutade resultat enligt spelmotorns resultatform, nyast först och med omgångens `players` tillagda. `scores` är en lista med `{id,name,points,played,wins,imposterGames,imposterWins,byRole,byMode}`. Roll- och lägesuppdelningar använder `{played,wins}`.
- `room:replaced` med `{code}` informerar en sockel vars spelartoken använts på en ny anslutning. `room:expired` med `{code}` skickas när ett inaktivt rum stängs. Vid serveromstart får återanslutningen `room_not_found` och klienten visar vägen till ett nytt rum.

Fel som klienten ska översätta inkluderar `bad_payload`, `too_large`, `bad_name`, `bad_code`, `room_not_found`, `room_full`, `server_full`, `invalid_token`, `not_in_room`, `already_bound`, `not_host`, `not_playing`, `wrong_phase`, `waiting`, `paused`, `wrong_round`, `request_conflict`, `players_not_ready`, `players_offline`, `invalid_settings`, `invalid_custom`, `bad_text`, `chat_rate` och `invalid_action`. `invalid_settings` vid start kan ha en detaljerad `issues`-lista. Spelmotorfel i en handling visas som `invalid_action`.

## Körning och gränser

Flask skapar en `SocketIO`-instans med `async_mode="threading"`, standardkontrollen för ursprung och `max_http_buffer_size=app.config["ONLINE_MAX_PACKET_BYTES"]`. `register_socket_events(socketio, app)` registrerar händelserna och installerar `app.extensions["online_rooms"]`. `/healthz` kontrollerar att processen svarar och behöver inte simulera en Socket.IO-anslutning. Ingen rumsstatus behöver exponeras i hälsosvaret.

| Flask-konfiguration | Standard | Betydelse |
| --- | ---: | --- |
| `ONLINE_MAX_ROOMS` | 5 | Maximalt antal samtidiga rum i processen. |
| `ONLINE_ROOM_TTL_SECONDS` | 7200 | Rum stängs efter så här många sekunder utan aktivitet. |
| `ONLINE_SWEEP_INTERVAL_SECONDS` | 0,5 | Intervall för timerkontroll och städning. Sätt 0 i tester som kör svep manuellt. |
| `ONLINE_MAX_PACKET_BYTES` | 196608 | Övre gräns för inkommande Socket.IO-paket. |
| `ONLINE_MAX_CUSTOM_BYTES` | 131072 | Övre gräns för värdens privata JSON-paket. |
| `ONLINE_HISTORY_LIMIT` | 30 | Antal avslutade resultat som rummet skickar till anslutna spelare. |

Driften använder en process och en bakgrundstråd i samma process för timer och städning. Reverse proxy måste tillåta WebSocket-uppgradering och längre anslutningar till `/socket.io`. En processomstart stänger alla rum. Klienten bör lagra sin token per rum i `sessionStorage`, undvika att lägga token i URL eller loggar och rensa den när spelaren lämnar rummet.

Rummets värd väljs automatiskt bland anslutna spelare när den tidigare värden försvinner, med företräde för dem som spelar. Om endast väntande spelare är anslutna kan en väntande spelare bli värd tills en deltagare återkommer. Återanslutna spelare behåller plats och roll. Automatisk paus kräver att den nuvarande värden återupptar omgången efter att berörda deltagare har återkommit. Avbrott ger inga poäng och har inget avslöjande. Mellan omgångar deltar endast anslutna spelare vid nästa start.
