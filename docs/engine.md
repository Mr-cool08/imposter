# Spelmotor

Imposter Party spelas på en gemensam mobil. JavaScriptmodulen `app/static/js/engine.mjs` använder regeldata från `data/rules.json`. Pythonmodulen `app.game.engine` används som referens i paritetstesterna.

## Flödet på mobilen

1. Välj spelare och inställningar. Lägg till `freePlay: true`, validera med `profileIssues(settings, playerCount, words, pairs, rules)` och starta med `createRound(players, settings, words, pairs, rules, {used, flow: "table"})`.
2. Lämna mobilen till en spelare i taget. Vyn hämtar spelarens kort med `privateState(id).card` vid ett aktivt tryck och döljer det före `act(id, "ack_role")`. Efter sista kortet går omgången från `roles` till `playing`.
3. Gruppen spelar runt bordet och väljer själv ordning, diskussion och när spelet är slut. Knappen för avslöjande anropar `act(id, "reveal_roles")`. Därefter visar `publicState().result` rollerna, huvudord och eventuellt parord samt läget som drogs i Chaos.

`reveal_roles` fungerar först i `playing`. Mellan korten och avslöjandet har `privateState(id).card` värdet `null` och `publicState().result` värdet `null`. Resultatet har samma allmänna form som nedan med `reason: "roles_revealed"`, `winners: []`, `votes: {}`, `points: {}` och `null` för `winnerTeam`, `voteWinner`, `eliminated`, `protected` och `guess`. Spara ord-ID för att undvika upprepning i nästa omgång.

## Start och validering i båda motorerna

- Python `profile_issues(settings, player_count, words, pairs, rules)` och JS `profileIssues(settings, playerCount, words, pairs, rules)` returnerar en lista av `{code, mode}`. `mode` är läges-ID eller `null`. Vid Chaos anges antingen läget för varje ogiltig profil i poolens ordning eller `chaos` för ett fel i gemensamma inställningar.
- Python `create_round(players, settings, words, pairs, rules, *, rng=None, used=None, now=None)` och JS `createRound(players, settings, words, pairs, rules, {rng, used, now, flow}={})` returnerar ett privat omgångsobjekt. Omgångens `phase` kan läsas direkt. JS-alternativet `flow: "table"` väljer mobilflödet. Om `flow` utelämnas används referensflödet. Andra uttryckliga värden ger `invalid_data`.
- `players` är en lista med `{id, name}`. ID:n är unika, icke-tomma strängar. `@all` och `@none` är reserverade. Namn ska innehålla synlig text.
- `words` och `pairs` har innehållsbibliotekets format. Motorn använder ord med giltig språkversion och applicerar omgångens valda filter. Båda sidorna av ett ordpar måste vara kvar. `categories: []` och `subcategories: []` väljer alla tillgängliga. `levels` är `["familiar"]` som standard och ska innehålla minst en nivå.
- Inställningarna får standardvärden från regeldata. Inga extra roller väljs med `extraRole: null` eller genom att utelämna fältet. `randomMin: null` och `randomMax: null` lämnar gränsen automatisk. Samma uttryckliga undre och övre gräns ger ett fast antal. En uttrycklig gräns utanför den tillåtna rollfördelningen ger ett fel. Enskilda automatgränser använder den validerade fördelningens yttervärde.
- Chaos använder en icke-tom lista av profiler med uttryckligt `mode` och positiv, ändlig `weight`. Vikter är relativa. `joker`, `extraRole`, `randomMin`, `randomMax` och `lastGuess` kan anges per profil och ärvs annars. Gemensamma fält `freePlay`, `clueRounds`, `discussionSeconds`, `clueStyle`, `language`, `hint`, `categories`, `subcategories` och `levels` ärvs från de övergripande inställningarna. En profil som anger gemensamma fält måste ha samma värde, så att omgångens offentliga flöde och materialurval är gemensamma. En profil som saknar stöd för sista gissningen har den avstängd när valet bara ärvts. En uttryckligt aktiverad sista gissning i ett sådant läge ger ett fel. `joker` som läges-ID innebär alltid att Jokern ingår.
- `used` är en lista med tidigare visade ord-ID:n, äldst först. Motorn ändrar aldrig listan. Anroparen lägger till resultatets `wordId` och eventuella `pairedWordId` en gång per avslutad omgång. Vanliga urval drar bland ospelade ord. Parurval drar först bland par med flest ospelade ord. När flera återanvända alternativ återstår undviks senast visade ord i första hand. Alla tillgängliga begrepp i samma urval kan därmed användas innan motorn behöver återgå helt till äldre ord. `reused` i resultatet visar att minst ett draget begrepp har förekommit tidigare.
- `now` är Unix-millisekunder och utelämnat värde ersätts med aktuell tid. Det valfria slumpgränssnittet `rng()` returnerar ett tal i `[0, 1)`. Produktion använder systemets kryptografiska slump. Testordningen är Chaos-viktat val, slumpat imposterantal i Random, valt ord/par, parorientering om relevant, Fisher–Yates för rolltilldelning från listans slut, eventuellt partner-ID för Accomplice, separat Fisher–Yates för turordning och sist omgångs-ID (`round-` följt av fyra sammanfogade, åtta tecken långa hexvärden). Val mellan kandidater och imposterantal drar ett värde även om ett enda alternativ finns.

## Random Imposters på gemensam mobil

Med `freePlay: true` och utan Joker eller extraroll väljer Random Imposters ett heltal med lika sannolikhet inom det valda intervallet. Automatisk min- och maxgräns är 0 respektive det totala antalet spelare. Fasta antal anges med samma min- och maxvärde.

| Draget antal | Faktiskt läge vid avslöjandet |
| --- | --- |
| 0 | `none`, alla får ordkort |
| En färre än spelarantalet | `reverse`, en spelare får ordet och övriga får ledtråden |
| Lika med spelarantalet | `all`, alla får samma ledtråd |
| Övriga giltiga antal | `random` |

På ett bord med sex spelare betyder exempelvis 0–6 att alla tre specialutfall kan dras, medan 4–4 alltid delar ut fyra imposterkort i Random. Den gemensamma vyn visar det valda läget `random` eller `chaos` fram till avslöjandet. Då innehåller `result.mode` det faktiska läget. Tidigare lagrade `none`, `reverse` och `all` är fortsatt giltiga indata.

Med Joker eller extraroll använder båda motorerna kompatibla positiva antal. Civilmajoritet och rollernas spelargränser gäller i dessa kombinationer. Automatiska gränser anpassas till fördelningen. Angivna gränser måste vara giltiga heltal i rätt ordning. En gräns utanför intervallet ger `invalid_random_range`. Referensflödet med `freePlay: false` använder också tidigare kompatibilitetsgränser.

## Tillstånd och referensflöde

Standardanropet för båda motorerna används för att testa regelmatrisen, fasövergångarna och de fullständiga regelutfallen. Den lokala webbappen använder bara mobilflödet ovan.

Python `public_state()` och JS `publicState()` ger samma JSON-objekt i gemensamt testläge. Lokalvyn använder vyn för den information som gruppen får se. Fält med `null` och tomma listor finns med.

| Fält | Värde |
| --- | --- |
| `id` | Unikt omgångs-ID |
| `mode` | Användarens valda öppna läge eller `chaos` |
| `phase` | `roles`, `playing`, `clues`, `abilities`, `discussion`, `voting`, `last_guess`, `reveal` eller `aborted`. `playing` används i mobilflödet |
| `players` | Lista med omgångens `{id, name}` |
| `order` | Slumpad turordning som lista med spelar-ID:n |
| `clueStyle`, `clueRounds`, `discussionSeconds` | Gemensamma omgångsinställningar |
| `clueRound` | Aktuell ledtrådsrunda från 1 under `clues`, annars `null` |
| `currentPlayerId` | Vems tur det är under `clues`, annars `null` |
| `clues` | Insända textledtrådar `[{playerId, round, text}]` i tidsordning. Muntliga ledtrådar har ingen textpost |
| `completed` | Antal bekräftade rollkort, privata steg eller låsta röster för respektive fas. I övriga faser 0 |
| `options` | Lista med alla spelar-ID:n följda av tillämpliga gruppalternativ under `voting`. Tom lista i övriga faser. Klienten döljer spelarens eget ID |
| `paused`, `deadline`, `remainingMs` | Pausindikator, aktivt Unix-slutvärde eller `null`, samt fryst tid i millisekunder eller `null` |
| `result` | Resultatobjektet nedan vid `reveal`, annars `null` |

Python `private_state(player_id)` och JS `privateState(playerId)` ger en spelares privata JSON-objekt. På den gemensamma mobilen ska vyn bara läsa och visa rollkortet för den som håller mobilen. Ett okänt ID ger `unknown_player`.

| Fält | Värde |
| --- | --- |
| `playerId` | Berörd spelare |
| `card` | `{role, word, hint, partners}` i kortfasen. Ordkorten i Undercover och vanliga civilkort i Chaos använder `role: null`. Övriga rollkort har roll-ID. `word` och `hint` är strängar eller `null`. `partners` innehåller kända medspelares ID:n. Referensflödet behåller kortet genom de aktiva faserna |
| `roleReady`, `abilityReady`, `voted` | Spelarens egna bekräftelser för omgången |
| `ability` | `detective`, `guardian` eller `null`. Endast satt under privatfasen |
| `investigation` | `{playerId, impostorTeam}` efter en undersökning. `impostorTeam` är boolesk. Annars `null`. Synligt för detektiven genom de aktiva faserna |
| `canGuess` | Sant för spelaren som får lämna sista gissningen under `last_guess` |

`result` har `{id, mode, selectedMode, wordId, word, pairedWordId, pairedWord, category, reused, roles, votes, voteWinner, eliminated, protected, winners, winnerTeam, reason, guess, points}`.

- `mode` är det spelade läget, även i Chaos. `selectedMode` är det valda öppna läget eller `chaos`. `wordId`, `word` och `category` gäller huvudordet. `pairedWordId` och `pairedWord` anges i Undercover och vid Spy, annars `null`.
- `roles`, `votes` och `points` är objekt med spelar-ID som nycklar. `roles` innehåller de faktiska rollerna. `votes` mappar till spelar-ID, `@all` eller `@none`. `points` innehåller poängökningen för varje spelare.
- `voteWinner` är vinnande ID eller gruppalternativ och `null` vid delad förstaplats. `eliminated` är utröstad spelares ID eller `null`. `protected` är spelar-ID när ett skydd faktiskt blockerade en utröstning, annars `null`.
- `winners` är vinnarnas ID:n i spelarlistans ordning. `winnerTeam` är `civils`, `impostors`, `joker`, `all` eller `none`. `reason` är `joker_eliminated`, `all_correct`, `all_missed`, `none_correct`, `none_missed`, `reverse_civil_eliminated`, `reverse_civil_survived`, `undercover_eliminated`, `undercover_survived`, `imposter_eliminated`, `imposter_survived`, `guess_correct`, `guess_wrong` eller `guess_timeout`. Skydd och delad förstaplats kan utläsas från resultatfälten ovan.
- `guess` är `null` eller `{playerId, text, correct}`. `text` är `null` om tiden löpte ut eller spelaren avstod. `correct` är boolesk.

## Handlingar och faser

`act(player_id, action, data, now)` i Python och `act(playerId, action, data, now)` i JS tar en handling från en känd spelare. `data` är ett objekt och kan utelämnas för handlingar utan data. `act`, `tick(now)`, `pause(now)` och `resume(now)` returnerar `true` efter en ändring. Upprepade eller inaktuella tick-, paus- och återupptagningsanrop returnerar `false` när tillståndet inte ändras. Felaktiga handlingar ger ett motorfel. Tabellen beskriver referensflödet som omfattas av motortesterna.

| Fas | Handlings-ID och data | Övergång |
| --- | --- | --- |
| `roles` | `ack_role` | Varje spelare bekräftar sitt kort. När alla är klara börjar ledtrådarna |
| `clues` | `clue` med `{text}` för textläge. Muntligt läge använder tom data | Endast aktuell spelare. I sista rundan går spelet vidare efter den sista spelaren |
| `abilities` | `ability` med `{targetId}`. `null` eller utelämnat mål betyder avstå eller neutralt steg | Om det finns en förmåga eller om valt läge är Chaos bekräftar alla ett privat steg här efter ledtrådarna. Bara Detective och Guardian får ange en annan spelare |
| `discussion` | `end_discussion` | Öppnar omröstningen. En tidsbestämd diskussion övergår också via `tick` när tiden löper ut |
| `voting` | `vote` med `{targetId}` | En giltig låst röst per spelare. Alla måste ha röstat före bedömningen. Skydd bedöms före Joker och lägesregler |
| `last_guess` | `guess` med `{text}`. `null` eller utelämnad text betyder avstå | Endast den utröstade faktiska impostern får agera. Bara en gissning. `tick` avslöjar automatiskt vid tidsgränsen |
| Aktiv fas | `abort` | Går till `aborted` utan resultat eller poäng. Tillåts även under paus |

Tid räknas under diskussion och sista gissning. `deadline` sätts när en tidsbestämd fas börjar. Paus fryser en eventuell tidsfrist och blockerar handlingar förutom `abort`. Återupptagning sätter en ny tidsfrist utifrån återstående tid. `act` tillämpar förfluten tid före handlingen, så en gissning som kommer vid eller efter tidsfristen avslutar som utebliven. Textledtrådar och gissningar trimmas i ändarna och har högsta längd enligt regeldata, mätt i Unicode-tecken. Gissningsmatchning använder NFC, gemener och sammanpressade blanksteg mot ordet och dess uttryckliga alias.

Om minst en profil i Chaos kan ge sista gissning använder referensflödet samma 20 sekunder långa `last_guess`-fas för alla omgångar i poolen. `canGuess` avgör privat om spelaren har en gissning kvar. Inlämning påverkar resultatet när tidsfristen löper ut. Öppna lägen avslöjar direkt när en berörd spelare har gissat eller avstått.

JS-referensflödets metod `localGuessNominee()` returnerar det unikt högst röstade spelar-ID:t före skydd och rollregler under `last_guess`. Vid lika röster eller gruppval används den första spelaren i ledtrådsordningen. Utanför fasen returnerar metoden `null`.

Gruppalternativ visas bara när röstfasen öppnar i referensflödet. Öppet `all` eller `none` lägger till sitt eget alternativ. Chaos och Random med `freePlay: true` erbjuder båda alternativ när ett av lägena är möjligt inom poolens profiler eller valda intervall. Ett unikt gruppval räknas aldrig som att någon person blivit utröstad.

## Felkoder

Python `EngineError` och exporterad JS `EngineError` har `code`. Vid startvalidering är `code` den första koden och `issues` innehåller hela listan enligt `profile_issues`. `issues` är en tom lista för andra fel.

| Kod | Betydelse |
| --- | --- |
| `player_count` | Utanför tillåtet antal spelare för det valda läget |
| `invalid_players` | Spelarlistan innehåller ett ogiltigt eller dubbelt ID eller ett tomt namn |
| `invalid_settings` | Ogiltig typ, värde eller Chaos-överskrivning för en spelinställning |
| `invalid_mode` | Okänt läge eller ett nästlat Chaos-läge |
| `chaos_empty`, `chaos_weight` | Chaos saknar profiler eller en vikt är ogiltig |
| `joker_incompatible`, `joker_players` | Joker får inte kombineras med läget eller behöver fler spelare |
| `extra_incompatible`, `extra_players` | Extra roll får inte kombineras med läget eller behöver fler spelare |
| `invalid_distribution`, `invalid_random_range` | Rollfördelningen eller det önskade Random-intervallet saknar stöd |
| `last_guess_incompatible` | Sista gissning stöds inte i läget |
| `no_words`, `no_pairs` | Urvalet saknar spelbara ord eller giltiga ordpar |
| `unknown_player`, `unknown_action`, `invalid_data` | Okänd spelare, okänd handling eller ogiltig data |
| `wrong_phase`, `paused`, `not_your_turn` | Handlingen är spärrad av fas, paus eller turordning |
| `already_done` | Spelaren har redan bekräftat steget eller låst sin röst |
| `invalid_target` | Otillgängligt mål, eget ID eller en roll som saknar förmåga |
| `invalid_text` | Tom, för lång eller ogiltig text |
