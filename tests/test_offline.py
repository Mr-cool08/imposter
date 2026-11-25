import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import pytest

playwright_api = pytest.importorskip("playwright.sync_api")
STATIC = Path(__file__).resolve().parents[1] / "app" / "static"
MODE = {"categoryIds": ["food"], "language": "en"}


@pytest.fixture
def public_origin():
    version = {"shell": "shell-v1", "catalog": "catalog-v1"}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = urlparse(self.path).path
            if path == "/sw.js":
                prelude = "self.IMPOSTER_SHELL = " + json.dumps({
                    "version": version["shell"],
                    "assets": ["/static/js/offline.mjs"],
                }) + ";\n"
                self.reply(prelude + (STATIC / "sw.js").read_text(encoding="utf-8"), "text/javascript")
            elif path == "/static/js/offline.mjs":
                self.reply((STATIC / "js" / "offline.mjs").read_text(encoding="utf-8"), "text/javascript")
            elif path == "/":
                self.reply('<!doctype html><html><title>Offline test</title><body>Shell</body></html>', "text/html")
            elif path == "/api/content/manifest":
                self.reply_json({"version": version["catalog"], "categories": [{"id": "food"}, {"id": "animals"}]})
            elif path.startswith("/api/content/packs/"):
                category = Path(path).stem
                self.reply_json({
                    "version": version["catalog"],
                    "category": category,
                    "words": [{"id": category + "-" + version["catalog"]}],
                    "pairs": [],
                })
            elif path in ("/manifest.webmanifest", "/api/content/rules"):
                self.reply_json({})
            elif path in ("/api/i18n/sv.json", "/api/i18n/en.json"):
                self.reply_json({"language": Path(path).stem})
            elif path == "/api/private-fixture":
                self.reply_json({"private": True})
            else:
                self.send_error(404)

        def reply(self, body, mime):
            encoded = body.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(encoded)

        def reply_json(self, body):
            self.reply(json.dumps(body), "application/json")

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", version
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.fixture
def browser_page():
    with playwright_api.sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(channel=os.getenv("IMPOSTER_BROWSER_CHANNEL"))
        except playwright_api.Error as error:
            if "Executable doesn't exist" in str(error) or "distribution 'chrome' is not found" in str(error):
                pytest.skip("Playwright Chromium missing, run python -m playwright install chromium")
            raise
        with browser:
            context = browser.new_context()
            yield context.new_page()
            context.close()


def start_worker(page, origin):
    page.goto(origin)
    page.evaluate("async () => { window.offline = await import('/static/js/offline.mjs'); }")
    state = page.evaluate("options => offline.offlineStatus(options)", MODE)
    assert state == {"ready": False, "missing": ["food"], "update": False, "error": ""}


def test_downloaded_public_content_and_shell_work_offline(browser_page, public_origin):
    page = browser_page
    origin, _ = public_origin
    start_worker(page, origin)
    assert page.evaluate("options => offline.downloadOffline(options)", MODE)["ready"]
    assert page.evaluate("async () => (await fetch('/api/private-fixture')).json()") == {"private": True}
    cached = page.evaluate("""async () => {
        const keys = await caches.keys();
        const sets = await Promise.all(keys.map(async key => (await caches.open(key)).keys()));
        return sets.flat().map(request => new URL(request.url).pathname);
    }""")
    assert "/api/private-fixture" not in cached
    assert "/api/content/packs/animals.json" not in cached

    page.context.set_offline(True)
    page.goto(origin + "/?offline-test=1")
    assert page.title() == "Offline test"
    assert page.url.endswith("/?offline-test=1")
    assert page.evaluate("async () => (await fetch('/api/i18n/en.json')).json()") == {"language": "en"}
    assert page.evaluate("async () => (await fetch('/api/content/packs/food.json')).json()")["words"]
    assert page.evaluate("async () => (await fetch('/api/content/packs/animals.json')).status") == 503


def test_update_waits_and_migrates_downloaded_categories(browser_page, public_origin):
    page = browser_page
    origin, version = public_origin
    start_worker(page, origin)
    assert page.evaluate("options => offline.downloadOffline(options)", MODE)["ready"]

    version.update(shell="shell-v2", catalog="catalog-v2")
    page.evaluate("""async () => {
        window.offlineRegistration = await offline.startOffline();
        await offlineRegistration.update();
    }""")
    page.wait_for_function("() => Boolean(offlineRegistration.waiting)")
    state = page.evaluate("options => offline.offlineStatus(options)", MODE)
    assert state["update"], state
    assert page.evaluate("async () => (await fetch('/api/content/manifest')).json()")["version"] == "catalog-v1"

    assert page.evaluate("() => offline.applyOfflineUpdate()")
    page.context.set_offline(True)
    page.reload()
    pack = page.evaluate("async () => (await fetch('/api/content/packs/food.json')).json()")
    assert pack["version"] == "catalog-v2"
