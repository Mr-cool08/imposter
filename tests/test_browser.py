"""Browser journeys from setup to private cards and shared reveal."""

import json
import os
import re
from collections import Counter
from contextlib import contextmanager
from pathlib import Path
from threading import Event, Thread
from urllib.parse import urlsplit

import pytest

IN_CI = os.getenv("CI", "").lower() in {"1", "true"}
if IN_CI:
    from playwright import sync_api as playwright_api
else:
    playwright_api = pytest.importorskip("playwright.sync_api")


@contextmanager
def serve_app(app):
    from werkzeug.serving import make_server

    server = make_server("127.0.0.1", 0, app, threaded=True)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)


@pytest.fixture(scope="module")
def app_url():
    external_url = os.getenv("IMPOSTER_TEST_URL")
    if external_url:
        yield external_url.rstrip("/")
        return

    from app import create_app

    app = create_app({"APP_NAME": "Imposter Party", "TRUSTED_HOSTS": None})
    with serve_app(app) as url:
        yield url


@pytest.fixture(scope="module")
def chromium():
    with playwright_api.sync_playwright() as playwright:
        channel = os.getenv("IMPOSTER_BROWSER_CHANNEL")
        browser_type = playwright.chromium
        if not channel:
            if Path(browser_type.executable_path).exists():
                # Use the full Chromium browser so tab focus behaves like installed Chrome.
                channel = "chromium"
            else:
                message = "Install Chromium with `python -m playwright install chromium`."
                if IN_CI:
                    pytest.fail(message)
                local_chrome = Path(os.getenv("PROGRAMFILES", "/opt")) / (
                    "Google/Chrome/Application/chrome.exe" if os.name == "nt" else "google/chrome/chrome"
                )
                if not local_chrome.exists():
                    pytest.skip(message)
                channel = "chrome"
        browser = browser_type.launch(channel=channel, headless=True)
        try:
            yield browser, playwright.devices["Pixel 7"]
        finally:
            browser.close()


def expect_no_horizontal_scroll(page):
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


def expect_no_app_managed_round(page):
    removed_controls = page.get_by_test_id(re.compile(r"local-(clue-next|end-discussion|lock-vote)$"))
    playwright_api.expect(removed_controls).to_have_count(0)
    playwright_api.expect(page.get_by_role("timer")).to_have_count(0)


@pytest.mark.parametrize("device", ["desktop", "mobile"])
def test_start_page_and_public_apis(app_url, chromium, device):
    browser, mobile = chromium
    options = mobile if device == "mobile" else {"viewport": {"width": 1440, "height": 900}}
    context = browser.new_context(base_url=app_url, **options)
    page = context.new_page()
    try:
        errors = []
        requests = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("request", lambda request: requests.append(request.url))
        response = page.goto(app_url)
        assert response is not None and response.ok
        playwright_api.expect(page.locator("html")).to_have_attribute("lang", "sv")
        playwright_api.expect(page.get_by_test_id("local-player-name")).to_be_visible()
        playwright_api.expect(page.get_by_test_id("local-start")).to_be_disabled()
        playwright_api.expect(page.get_by_text("Onlinespel", exact=True)).to_have_count(0)
        expect_no_app_managed_round(page)
        assert page.request.get(f"{app_url}/healthz").ok
        catalog = page.request.get(f"{app_url}/api/content/manifest").json()
        assert {entry["id"] for entry in catalog["categories"]} >= {"minecraft", "clash-royale"}
        playwright_api.expect(page.locator('link[rel="manifest"]')).to_have_count(0)
        expect_no_horizontal_scroll(page)

        page.locator("#preferences-menu > summary").click()
        playwright_api.expect(page.get_by_text("Spela utan nätverk", exact=True)).to_have_count(0)
        page.locator("#app-language").select_option("en")
        playwright_api.expect(page.locator("html")).to_have_attribute("lang", "en")
        english = page.request.get("/api/i18n/en.json").json()
        swedish = page.request.get("/api/i18n/sv.json").json()
        assert english.keys() == swedish.keys()
        settings = page.locator("#local-view")
        playwright_api.expect(settings.get_by_role("heading", name=english["local.setup.title"], exact=True)).to_be_visible()
        playwright_api.expect(settings.get_by_role("heading", name=swedish["local.setup.title"], exact=True)).to_have_count(0)
        page.locator("#app-theme").select_option("light")
        playwright_api.expect(page.locator("html")).to_have_attribute("data-theme", "light")
        page.reload()
        playwright_api.expect(page.locator("html")).to_have_attribute("lang", "en")
        playwright_api.expect(page.locator("html")).to_have_attribute("data-theme", "light")
        playwright_api.expect(page.get_by_test_id("local-player-name")).to_be_visible()
        expect_no_horizontal_scroll(page)
        origin = urlsplit(app_url).netloc
        assert all(urlsplit(url).netloc == origin for url in requests if url.startswith(("http:", "https:")))
        assert not any("socket.io" in url or "/js/online.mjs" in url for url in requests)
        assert page.evaluate("async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0") == 0
        assert not errors
    finally:
        context.close()


def expect_rules_content(page, translations):
    expect = playwright_api.expect
    guide = page.get_by_test_id("rules-guide")
    expect(guide.get_by_role("heading", name=translations["guide.title"], exact=True)).to_be_visible()

    steps = guide.locator("#guide-steps")
    for step in ("setup", "cards", "reveal"):
        title = translations[f"guide.steps.{step}.title"]
        expect(steps.get_by_text(title, exact=True)).to_be_visible()
        description = translations[f"guide.steps.{step}.text"]
        expect(steps.get_by_text(description, exact=True)).to_be_visible()

    modes = guide.locator("#guide-modes")
    for mode in ("classic", "random", "joker", "undercover", "alliance", "blind", "chaos", "none", "reverse", "all"):
        entry = modes.locator(f'[data-mode="{mode}"]')
        expect(entry.get_by_text(translations[f"ui.mode.{mode}"], exact=True)).to_be_visible()
        expect(entry.get_by_text(translations[f"guide.mode.{mode}"], exact=True)).to_be_visible()
    expect(modes.locator('[data-mode="random"] [data-mode]')).to_have_count(3)

    roles = guide.locator("#guide-roles")
    for role in ("civil", "imposter", "joker", "spy", "accomplice", "double_agent", "undercover"):
        entry = roles.locator(f'[data-role="{role}"]')
        expect(entry.get_by_text(translations[f"rules.roleName.{role}"], exact=True)).to_be_visible()
        expect(entry.get_by_text(translations[f"guide.role.{role}"], exact=True)).to_be_visible()

    tabletop = roles.locator("details")
    tabletop.get_by_text(translations["guide.roles.tabletop"], exact=True).click()
    for role in ("detective", "guardian"):
        entry = tabletop.locator(f'[data-role="{role}"]')
        expect(entry.get_by_text(translations[f"guide.role.{role}"], exact=True)).to_be_visible()


def test_rules_page_direct_entry_navigation_and_localization(app_url, chromium):
    browser, mobile = chromium
    context = browser.new_context(base_url=app_url, **mobile)
    page = context.new_page()
    expect = playwright_api.expect
    try:
        page.goto(f"{app_url}/#regler")
        swedish = page.request.get("/api/i18n/sv.json").json()
        english = page.request.get("/api/i18n/en.json").json()
        expect_rules_content(page, swedish)
        expect(page.get_by_test_id("local-player-name")).not_to_be_visible()
        expect_no_horizontal_scroll(page)

        page.locator("#preferences-menu > summary").click()
        page.locator("#app-language").select_option("en")
        expect(page.locator("html")).to_have_attribute("lang", "en")
        expect(page).to_have_url(re.compile(r"#regler$"))
        expect_rules_content(page, english)
        expect_no_horizontal_scroll(page)

        page.get_by_role("link", name=english["guide.back"], exact=True).click()
        expect(page.get_by_test_id("local-player-name")).to_be_visible()
        expect(page.get_by_test_id("rules-guide")).not_to_be_visible()
        page.get_by_role("link", name=english["guide.navigation"], exact=True).click()
        expect(page).to_have_url(re.compile(r"#regler$"))
        expect(page.get_by_test_id("rules-guide")).to_be_visible()
        page.go_back()
        expect(page.get_by_test_id("local-player-name")).to_be_visible()
        expect(page.get_by_test_id("rules-guide")).not_to_be_visible()
    finally:
        context.close()


def add_players(page, names):
    name_input = page.get_by_test_id("local-player-name")
    for name in names:
        name_input.fill(name)
        page.get_by_test_id("local-add-player").click()
    playwright_api.expect(page.get_by_test_id("local-start")).to_be_enabled(timeout=15000)


def test_existing_service_worker_releases_the_website(chromium):
    from flask import Response, request

    from app import create_app

    app = create_app({"APP_NAME": "Imposter Party", "TRUSTED_HOSTS": None})
    publish_update = Event()

    @app.before_request
    def serve_legacy_worker():
        if request.path == "/sw.js" and not publish_update.is_set():
            return Response("""
                self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
                self.addEventListener("fetch", event => {
                    if (new URL(event.request.url).pathname === "/") {
                        event.respondWith(caches.match("/"));
                    }
                });
            """, mimetype="text/javascript", headers={"Cache-Control": "no-cache"})

    browser, _ = chromium
    with serve_app(app) as url, browser.new_context(base_url=url) as context:
        page = context.new_page()
        page.goto(url)
        add_players(page, ["Ellie", "Samir", "Lo"])
        page.evaluate("""async () => {
            const shell = await caches.open("imposter-shell-test");
            await shell.put("/", new Response("Cached legacy page"));
            await caches.open("imposter-content-test");
            await caches.open("unrelated-cache");
            await navigator.serviceWorker.register("/sw.js");
        }""")
        page.wait_for_function("navigator.serviceWorker.controller !== null")
        assert page.evaluate("async () => (await fetch('/')).text()") == "Cached legacy page"

        publish_update.set()
        page.evaluate("""async () => {
            const registration = await navigator.serviceWorker.getRegistration();
            registration.addEventListener("updatefound", () => {
                window.updatedWorker = registration.installing;
            }, { once: true });
            await registration.update();
        }""")
        page.wait_for_function("window.updatedWorker?.state === 'activated'")
        assert page.evaluate("async () => !(await navigator.serviceWorker.getRegistration())")
        assert page.evaluate("caches.keys()") == ["unrelated-cache"]

        response = page.reload()
        assert response is not None and response.ok and not response.from_service_worker
        playwright_api.expect(page.get_by_test_id("local-player-name")).to_be_visible()
        playwright_api.expect(page.get_by_text("Ellie", exact=True)).to_be_visible()


def read_private_cards(page, names, *, check_privacy=False):
    expect = playwright_api.expect
    handoff = page.get_by_test_id("local-handoff")
    private_content = page.get_by_test_id("local-private-content")
    reveal = page.get_by_test_id("local-show-roles")
    cards = []
    other_tab = None
    if check_privacy:
        other_tab = page.context.new_page()
        # Headless Playwright emulates focus per page unless it is disabled.
        for tab in (page, other_tab):
            page.context.new_cdp_session(tab).send("Emulation.setFocusEmulationEnabled", {"enabled": False})
        page.bring_to_front()

    for index, name in enumerate(names):
        expect(handoff.get_by_role("heading", level=1)).to_contain_text(name)
        expect(private_content).to_have_count(0)
        expect(reveal).to_have_count(0)
        page.get_by_test_id("local-show-private").click()
        expect(private_content).to_be_visible()
        value = private_content.locator(".local-card-value").inner_text()
        assert value
        if index == 0 and other_tab is not None:
            other_tab.bring_to_front()
            page.wait_for_function("!document.hasFocus()")
            expect(private_content).to_have_count(0)
            other_tab.close()
            page.bring_to_front()
            page.wait_for_function("document.hasFocus()")
            expect(private_content).to_have_count(0)
            page.get_by_test_id("local-show-private").click()
            expect(private_content.locator(".local-card-value")).to_have_text(value)
            page.get_by_role("link", name="Spelregler", exact=True).click()
            expect(page.get_by_test_id("rules-guide")).to_be_visible()
            expect(private_content).to_have_count(0)
            page.get_by_role("link", name="Tillbaka till spelet", exact=True).click()
            expect(handoff.get_by_role("heading", level=1)).to_contain_text(name)
            expect(private_content).to_have_count(0)
            page.get_by_test_id("local-show-private").click()
            expect(private_content.locator(".local-card-value")).to_have_text(value)
        title = private_content.get_by_role("heading", level=2).inner_text()
        cards.append((name, title, value))
        page.get_by_test_id("local-hide-card").click()
        expect(private_content).to_have_count(0)
    expect(reveal).to_be_visible()
    expect(reveal).to_have_accessible_name("Visa roller")
    return cards, reveal


def test_mobile_local_game_after_reload(app_url, chromium):
    browser, mobile = chromium
    context = browser.new_context(base_url=app_url, **mobile)
    page = context.new_page()
    names = ["Ellie", "Samir", "Lo"]
    expect = playwright_api.expect
    try:
        page.goto(app_url)
        start = page.get_by_test_id("local-start")
        expect(start).to_be_disabled()
        add_players(page, names)
        page.get_by_role("button", name="Rensa kategorier", exact=True).click()
        food = page.locator('[data-category="food"] .category-card__select input')
        food.check()
        expect(start).to_be_enabled(timeout=15000)
        page.goto(f"{app_url}/#regler")
        page.reload()
        guide = page.get_by_test_id("rules-guide")
        expect(guide.get_by_role("heading", name="Spelregler", exact=True)).to_be_visible()
        page.get_by_role("link", name="Tillbaka till spelet", exact=True).click()
        expect(start).to_be_enabled(timeout=15000)
        expect(food).to_be_checked()
        for name in names:
            expect(page.get_by_text(name, exact=True)).to_be_visible()
        expect_no_horizontal_scroll(page)
        start.click()
        cards, reveal = read_private_cards(page, names, check_privacy=True)
        word, matches = Counter(value for _, _, value in cards).most_common(1)[0]
        assert matches == 2

        result = page.get_by_test_id("local-result")
        expect(result).to_have_count(0)
        expect_no_app_managed_round(page)
        reveal.click()
        expect(result).to_be_visible()
        expect(result.get_by_text(word, exact=True).first).to_be_visible()
        for name, role, _ in cards:
            expect(result.get_by_role("row", name=f"{name} {role}", exact=True)).to_be_visible()
        expect(page.get_by_test_id("local-next-round")).to_be_enabled()
        expect_no_app_managed_round(page)
        expect_no_horizontal_scroll(page)
    finally:
        context.close()


def test_undercover_uses_indistinguishable_cards_and_reveals_both_words(app_url, chromium):
    browser, _ = chromium
    context = browser.new_context(base_url=app_url)
    page = context.new_page()
    expect = playwright_api.expect
    try:
        page.goto(app_url)
        names = ["Anna", "Bo", "Dani"]
        add_players(page, names)
        page.locator('select[name="mode"]').select_option("undercover")
        page.get_by_test_id("local-start").click()
        cards, reveal = read_private_cards(page, names)
        assert len({title for _, title, _ in cards}) == 1
        assert sorted(Counter(value for _, _, value in cards).values()) == [1, 2]
        reveal.click()
        result = page.get_by_test_id("local-result")
        expect(result).to_be_visible()
        assert set(result.locator(".local-card-value").all_text_contents()) == {word for _, _, word in cards}
        expect_no_app_managed_round(page)
    finally:
        context.close()


def open_random_settings(page):
    mode = page.locator('select[name="mode"]')
    options = mode.locator("option").evaluate_all("options => options.map(option => option.value)")
    assert {"all", "none", "reverse"}.isdisjoint(options)
    mode.select_option("random")
    minimum = page.locator('[data-random-range="main"] input[name="randomMin"]')
    maximum = page.locator('[data-random-range="main"] input[name="randomMax"]')
    playwright_api.expect(minimum).to_be_visible()
    playwright_api.expect(maximum).to_be_visible()
    return minimum, maximum


@pytest.mark.parametrize("actual_mode,imposters", [("none", 0), ("random", 2), ("reverse", 3), ("all", 4)])
def test_random_fixed_counts_reveal_resolved_mode(app_url, chromium, actual_mode, imposters):
    browser, _ = chromium
    context = browser.new_context(base_url=app_url)
    page = context.new_page()
    names = ["Alva", "Bill", "Cia", "Dante"]
    expect = playwright_api.expect
    try:
        page.goto(app_url)
        translations = page.request.get("/api/i18n/sv.json").json()
        add_players(page, names)
        minimum, maximum = open_random_settings(page)
        minimum.fill(str(imposters))
        maximum.fill(str(imposters))
        page.get_by_test_id("local-start").click()

        cards, reveal = read_private_cards(page, names)
        imposter = translations["rules.roleName.imposter"]
        civil = translations["rules.roleName.civil"]
        titles = Counter(title for _, title, _ in cards)
        assert set(titles) <= {imposter, civil}
        assert titles[imposter] == imposters
        assert titles[civil] == len(names) - imposters

        reveal.click()
        result = page.get_by_test_id("local-result")
        expect(result).to_be_visible()
        mode_label = result.get_by_text(translations["local.result.mode"], exact=True)
        expect(mode_label.locator("xpath=following-sibling::dd[1]")).to_have_text(
            translations[f"ui.mode.{actual_mode}"]
        )
        for name, title, _ in cards:
            expect(result.get_by_role("row", name=f"{name} {title}", exact=True)).to_be_visible()
    finally:
        context.close()


def test_saved_reverse_becomes_random_with_fixed_roster_relative_counts(app_url, chromium):
    browser, _ = chromium
    players = [{"id": f"saved-{index}", "name": name} for index, name in enumerate(["Alva", "Bill", "Cia"])]
    saved_state = {
        "cookies": [],
        "origins": [{
            "origin": app_url,
            "localStorage": [
                {"name": "imposter:localSettings", "value": json.dumps({"mode": "reverse"})},
                {"name": "imposter:localPlayers", "value": json.dumps(players)},
            ],
        }],
    }
    context = browser.new_context(base_url=app_url, storage_state=saved_state)
    page = context.new_page()
    expect = playwright_api.expect
    try:
        page.goto(app_url)
        mode = page.locator('select[name="mode"]')
        expect(mode).to_have_value("random")
        bounds = page.locator('[data-random-range="main"] input')
        expect(bounds).to_have_count(2)
        for bound in bounds.all():
            expect(bound).to_have_value("2")

        add_players(page, ["Dante"])
        for bound in bounds.all():
            expect(bound).to_have_value("3")
        page.reload()
        expect(mode).to_have_value("random")
        expect(bounds).to_have_count(2)
        for bound in bounds.all():
            expect(bound).to_have_value("3")
    finally:
        context.close()


def test_random_automatic_bounds_track_roster_and_reject_reversed_interval(app_url, chromium):
    browser, _ = chromium
    context = browser.new_context(base_url=app_url)
    page = context.new_page()
    expect = playwright_api.expect
    try:
        page.goto(app_url)
        translations = page.request.get("/api/i18n/sv.json").json()
        add_players(page, ["Alva", "Bill", "Cia"])
        minimum, maximum = open_random_settings(page)
        for bound in (minimum, maximum):
            expect(bound).to_have_attribute("min", "0")
            expect(bound).to_have_attribute("max", "3")
            expect(bound).to_have_value("")

        add_players(page, ["Dante"])
        expect(minimum).to_have_attribute("max", "4")
        expect(maximum).to_have_attribute("max", "4")
        automatic = translations["settings.auto_count"]
        expect(minimum).to_have_attribute("placeholder", automatic.replace("{count}", "0"))
        expect(maximum).to_have_attribute("placeholder", automatic.replace("{count}", "4"))
        minimum.fill("3")
        maximum.fill("2")
        start = page.get_by_test_id("local-start")
        expect(start).to_be_disabled()
        expect(page.get_by_text(translations["settings.issue.invalid_random_range"], exact=True)).to_be_visible()
        minimum.fill("")
        maximum.fill("")
        expect(start).to_be_enabled()
    finally:
        context.close()

