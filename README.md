# Imposter Party

**Lita inte på någon.** Ett tvåspråkigt ordspel för 3–20 personer. Spela på en gemensam mobil eller anslut till ett onlinerum med kod, länk eller QR-kod. Servern kör Flask med Socket.IO. Omgångar och rum ligger i serverprocessens minne. Medföljande ordpaket och regler ligger i JSON.

## Starta med Python

Använd Python 3.14 med `pip`. Spelet behöver varken en databas eller Node/npm. Skapa den virtuella miljön i projektmappen.

**Windows PowerShell**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python run.py
```

Om PowerShell blockerar aktivering kan du använda `.\.venv\Scripts\python.exe` i Python-kommandona efter att miljön skapats.

**Linux eller macOS**

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
python run.py
```

Öppna [http://localhost:5000](http://localhost:5000). Standardvärdena i `.env.example` räcker för att börja. Kör `python -c "from secrets import token_urlsafe; print(token_urlsafe(32))"` för att generera en egen `SECRET_KEY` inför drift.

## Spela och förbered offline

- Välj **Spela lokalt**, lägg till spelare och välj kategorier och läge. Det lokala överlämningsflödet ber varje deltagare visa och dölja sitt kort aktivt. Öppna reglerna före start för att se möjliga utfall.
- Välj **Spela online** för att skapa eller ansluta till ett rum. Alla behöver nå samma Flask-server. På ett delat lokalt nätverk räcker åtkomst till servern utan internet. Sätt `HOST=0.0.0.0`, använd värddatorns lokala IP-adress på de andra enheterna och tillåt den valda porten i brandväggen. Skapa rummet från den adress som övriga spelare kan nå.
- Använd offlinepanelen och ladda ner valda ordpaket innan nätverket försvinner. Telefoner behöver normalt HTTPS för installation och offline. `localhost` fungerar på värden eftersom webbläsaren behandlar det som ett säkert ursprung. Vanlig HTTP till en annan enhets lokala IP-adress kan användas för nätverksspel. Öppna offlinepanelen för att se vad webbläsaren kan spara på det aktuella ursprunget.
- Egna paket, inställningar och avslutad historik hör till webbläsaren och ursprunget där de sparades. Exportera via **Egna ord** och **Historik** för att flytta dem mellan enheter. Ett eget paket som värden väljer för ett rum skickas till rummets tillfälliga minne.

## Testa och validera innehåll

```sh
python -m pip install -r requirements-dev.txt
python -m pip check
python -m pytest
python -m tools.validate_content
```

Webbläsartesterna kan använda en installerad kompatibel Chrome eller Playwrights Chromium. Vid behov hämtas det senare med `python -m playwright install chromium`. Se [webbläsartester](docs/browser-testing.md) för val av webbläsare och enskilda testflöden. Node kan användas för de fristående verifieringarna av JavaScript-motorn. Projektet distribuerar JavaScript direkt till webbläsaren.

## Kör i produktion

På Linux startas en trådad Gunicorn-worker. Socket.IO kan då använda WebSocket via `simple-websocket` och ett aktivt rum får alltid samma auktoritativa spelstatus.

```sh
python -m pip install -r requirements.txt
gunicorn --bind 127.0.0.1:5000 --worker-class gthread --workers 1 --threads 128 wsgi:app
```

Alternativt, kör projektets enda Compose-tjänst från projektmappen:

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs app
```

Sätt `PUBLIC_ORIGIN` till spelarnas externa HTTPS-adress, exempelvis `https://spel.example.com`. `TRUSTED_HOSTS` kan avgränsa vilka värdnamn Flask accepterar. Sätt `PROXY_HOPS` till antal betrodda proxyled som skriver `X-Forwarded-For` och `X-Forwarded-Proto`. Bind serverporten så att klienter når den avsedda proxyn. Konfigurera proxyn att vidarebefordra ursprungligt `Host`, stötta `Upgrade` och `Connection` för `/socket.io` samt tillåta lämpliga långlivade anslutningar utan svarsbuffring. Gunicorn-starten via `wsgi.py` har debug avstängt. [Flask-SocketIOs driftguide](https://flask-socketio.readthedocs.io/en/stable/deployment.html)

`GET /healthz` visar om servern och den laddade katalogen svarar. Dockerbildens hälsokontroll använder samma rutt. Öka antalet Gunicorn-trådar om fler aktiva anslutningar behöver rymmas än standardkonfigurationen tillåter. Varje aktiv WebSocket upptar en tråd. `ONLINE_MAX_ROOMS` är fem som standard med högst 20 spelare i varje rum.

| Variabel | Betydelse |
| --- | --- |
| `APP_NAME` | Centralt namn i spel, sidtitel och installationsmanifest. |
| `HOST`, `PORT` | Lyssningsadress och port i utveckling samt värdens bindning i Compose. |
| `IMPOSTER_DEBUG` | Flask-debug i `run.py`, avstängd som standard. |
| `SECRET_KEY` | Flask-nyckel. Om värdet är tomt skapas en tillfällig nyckel. |
| `PUBLIC_ORIGIN`, `TRUSTED_HOSTS`, `PROXY_HOPS` | Extern adress till QR-inbjudningar och betrodd proxykonfiguration. |
| `ONLINE_MAX_ROOMS`, `ONLINE_ROOM_TTL_SECONDS` | Tak för öppna rum och hur länge inaktiva rum lever. |
| `ONLINE_MAX_PACKET_BYTES`, `ONLINE_MAX_CUSTOM_BYTES`, `ONLINE_HISTORY_LIMIT` | Storleksgränser för meddelanden och egna paket samt maxantal skickade historikposter. |

Byt version mellan spelomgångar. Med Compose uppdaterar du källfilerna och kör `docker compose up --build -d` igen. Gamla aktiva rum försvinner vid varje processomstart. Efter en serveruppdatering kan PWA:n erbjuda ett nytt cachepaket när omgången är avslutad. Säkerhetskopiera projektets `data/` och webbläsarens exporterade JSON-paket och historik. Serverns aktiva rum är tillfälliga. Projektet är gjort för självhostning. Kostnaden för värd, domän och nätverk beror på var det körs.

## Ändra spelet

| Förändring | Plats |
| --- | --- |
| Lägen, grundval och beräkning | `data/rules.json`, `app/game/engine.py` och `app/static/js/engine.mjs`. Använd spelmotorernas gemensamma testfall. |
| Ord och kategorier | `data/words/`, `data/category_parts/`, `data/pairs/` och [innehållsguiden](docs/content.md). |
| Översättningar | Svenska och engelska JSON-fragment i `data/i18n/`. |
| Design och varumärke | `app/templates/index.html`, `app/static/css/`, `app/static/icons/`, `APP_NAME` och slogans i `app/config.py`. |
| Online och drift | [Onlinekontraktet](docs/online.md), `app/socket_events.py`, `app/config.py`, `Dockerfile` och `compose.yaml`. |
| Installation och nedladdning | [Offlineguiden](docs/offline.md), `app/static/sw.js` och `app/static/js/offline.mjs`. |
