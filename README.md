# Imposter Party

**Lita inte på någon.** Ett ordspel för 3–20 personer som spelas i webbläsaren på en gemensam mobil. Svenska är standardspråk och engelska finns som alternativ.

1. Lägg till spelare och välj spelläge, kategorier och roller.
2. Skicka runt mobilen. Varje spelare visar sitt privata kort och döljer det innan mobilen lämnas vidare.
3. Spela tillsammans. Tryck **Visa roller** när gruppen är klar för att se ordet och vem som hade vilken roll. Undercover visar båda orden och Chaos visar det dragna läget.

Ni bestämmer själva hur ni ger ledtrådar, diskuterar och avslutar omgången.

Öppna **Spelregler** i sidhuvudet för att läsa om spelstegen, spellägena och rollerna.

**Random Imposters** drar ett antal mellan det lägsta och högsta tal ni väljer. Med sex spelare ger 0 ingen imposter, 5 Reverse och 6 alla som imposters. Välj samma lägsta och högsta tal för ett fast antal. Joker och andra extra roller kan begränsa vilka antal som går att välja.

## Starta med Python

Använd Python 3.14. Kommandona körs i projektmappen.

**Windows PowerShell**

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run.py
```

**Linux eller macOS**

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run.py
```

Öppna [http://localhost:5000](http://localhost:5000). Kopiera `.env.example` till `.env` om du vill ändra `APP_NAME`, `HOST` eller `PORT`.

## Sparade spelval och egna ordpaket

Inställningar och egna ordpaket sparas i webbläsaren. Spelarnamnen sparas när **Spara spelarnamn** är valt. Öppna **Egna ordpaket** under **Appval** för att exportera egna paket som JSON eller CSV och flytta dem till en annan webbläsare.

## Tester och GitHub Actions

```sh
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python -m pytest -q
node --test tests/test_extras.mjs
python tools/validate_content.py --write-report docs/content-report.md
```

Kommandona använder den virtuella miljön. Node används för utvecklingstester av JavaScript. Se [webbläsartesterna](docs/browser-testing.md) för att testa med installerad Chrome.

GitHub Actions kör Python- och JavaScript-tester, innehållsvalidering, webbläsartester och en Docker-start vid push och pull request. Arbetsflödet finns under **Actions → CI** och kan även köras manuellt. [.github/workflows/ci.yml](.github/workflows/ci.yml)

## Serverstart med Docker eller Gunicorn

```sh
docker compose up --build -d
```

På Linux kan appen även startas med `gunicorn --bind 127.0.0.1:5000 --workers 1 --threads 4 --no-control-socket wsgi:app`. Produktionsstarten har debug avstängt och körs i Docker med ett vanligt användarkonto. Hälsokontrollen finns på `/healthz`. Uppdatera en Compose-installation genom att köra `docker compose up --build -d` på nytt.

## Ändra spelet

| Ändring | Plats |
| --- | --- |
| Spelnamn och slogan | `APP_NAME` och `app/config.py` |
| Rollfördelning och spellägen | `data/rules.json`, `app/static/js/engine.mjs` och [motordokumentationen](docs/engine.md) |
| Ord, kategorier och ordpar | `data/words/`, `data/category_parts/`, `data/pairs/` och [innehållsguiden](docs/content.md) |
| Faktiska innehållsantal | [Innehållsrapporten](docs/content-report.md) |
| Gränssnitt och språk | `app/templates/index.html`, `app/static/css/` och `data/i18n/` |

Flask levererar appen och JSON-filerna. Webbläsarens JavaScript delar ut roller, håller de pågående korten i arbetsminnet och visar dem efter spelarens aktiva val.
