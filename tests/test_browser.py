"""Browser journeys over a live, single-process Flask-SocketIO server."""

import os
import re
from collections import Counter
from contextlib import ExitStack
from pathlib import Path
from secrets import token_hex
from threading import Thread
from urllib.parse import urlsplit

import pytest

playwright_api = pytest.importorskip("playwright.sync_api")


@pytest.fixture(scope="module")
def app_url():
    external_url = os.getenv("IMPOSTER_TEST_URL")
    if external_url:
        yield external_url.rstrip("/")
        return

    from werkzeug.serving import make_server

    from app import create_app

    server = make_server(
        "127.0.0.1",
        0,
        create_app({"APP_NAME": "Imposter Party", "PROXY_HOPS": 0, "PUBLIC_ORIGIN": "", "TRUSTED_HOSTS": None}),
        threaded=True,
    )
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)


@pytest.fixture(scope="module")
def chromium():
    with playwright_api.sync_playwright() as playwright:
        channel = os.getenv("IMPOSTER_BROWSER_CHANNEL")
        browser_type = playwright.chromium
        if not channel and not Path(browser_type.executable_path).exists():
            local_chrome = Path(os.getenv("PROGRAMFILES", "/opt")) / (
                "Google/Chrome/Application/chrome.exe" if os.name == "nt" else "google/chrome/chrome"
            )
            if local_chrome.exists():
                channel = "chrome"
            else:
                pytest.skip("Install Chromium with `python -m playwright install chromium`.")
        browser = browser_type.launch(channel=channel, headless=True)
        try:
            yield browser, playwright.devices["Pixel 7"]
        finally:
            browser.close()


def expect_no_horizontal_scroll(page):
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")


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
        playwright_api.expect(
            page.get_by_role("heading", name=re.compile(r"Imposter\s+Party", re.IGNORECASE)).first
        ).to_be_visible()
        assert page.request.get(f"{app_url}/healthz").ok
        catalog = page.request.get(f"{app_url}/api/content/manifest").json()
        assert {entry["id"] for entry in catalog["categories"]} >= {"minecraft", "clash-royale"}
        manifest_url = page.locator('link[rel="manifest"]').get_attribute("href")
        assert manifest_url
        install_manifest = page.request.get(manifest_url).json()
        assert install_manifest["start_url"] == "/"
        assert install_manifest["display"] == "standalone"
        assert install_manifest["icons"]
        for icon in install_manifest["icons"]:
            assert page.request.get(icon["src"]).ok
        expect_no_horizontal_scroll(page)

        page.locator("#preferences-menu summary").click()
        page.locator("#app-language").select_option("en")
        playwright_api.expect(page.locator("html")).to_have_attribute("lang", "en")
        english = page.request.get("/api/i18n/en.json").json()
        swedish = page.request.get("/api/i18n/sv.json").json()
        assert english.keys() == swedish.keys()
        navigation = page.locator(".site-nav")
        playwright_api.expect(navigation.get_by_role("link", name=english["ui.rules"], exact=True)).to_be_visible()
        playwright_api.expect(navigation.get_by_role("link", name=swedish["ui.rules"], exact=True)).to_have_count(0)
        page.locator("#app-theme").select_option("light")
        playwright_api.expect(page.locator("html")).to_have_attribute("data-theme", "light")
        page.reload()
        playwright_api.expect(page.locator("html")).to_have_attribute("lang", "en")
        playwright_api.expect(page.locator("html")).to_have_attribute("data-theme", "light")
        expect_no_horizontal_scroll(page)
        origin = urlsplit(app_url).netloc
        assert all(urlsplit(url).netloc == origin for url in requests if url.startswith(("http:", "https:")))
        assert not errors
    finally:
        context.close()


def download_offline_from_menu(page):
    page.locator("#offline-menu summary").click()
    offline_menu = page.locator("#offline-tools")
    offline_menu.get_by_role("button", name="Ladda ner för offline").click(timeout=15000)
    playwright_api.expect(offline_menu.get_by_role("status")).to_have_text(
        "De valda ordpaketen är klara för lokalspel offline.", timeout=45000
    )
    page.wait_for_function("navigator.serviceWorker.controller !== null")
    cached_paths = page.evaluate("""async () => {
        const paths = [];
        for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
        }
        return paths;
    }""")
    assert "/api/content/rules" in cached_paths
    assert any(path.startswith("/api/content/packs/") for path in cached_paths)
    assert not any(path.startswith(("/socket.io", "/api/qr/")) for path in cached_paths)


def test_mobile_local_game_after_disabling_network(app_url, chromium):
    browser, mobile = chromium
    context = browser.new_context(base_url=app_url, **mobile)
    page = context.new_page()
    names = ["Ellie", "Samir", "Lo"]
    expect = playwright_api.expect
    try:
        page.goto(f"{app_url}/#local")
        start = page.get_by_test_id("local-start")
        expect(start).to_be_disabled()
        name_input = page.get_by_test_id("local-player-name")
        for name in names:
            name_input.fill(name)
            page.get_by_test_id("local-add-player").click()
        expect(start).to_be_enabled(timeout=15000)
        download_offline_from_menu(page)

        context.set_offline(True)
        page.wait_for_function("!navigator.onLine")
        page.reload()
        expect(start).to_be_enabled(timeout=15000)
        for name in names:
            expect(page.get_by_text(name, exact=True)).to_be_visible()
        expect_no_horizontal_scroll(page)
        start.click()

        handoff = page.get_by_test_id("local-handoff")
        secret = page.get_by_test_id("local-private-content")
        card_values = []
        other_tab = context.new_page()
        # Playwright keeps focus emulated per page unless it is explicitly disabled.
        for tab in (page, other_tab):
            context.new_cdp_session(tab).send("Emulation.setFocusEmulationEnabled", {"enabled": False})
        page.bring_to_front()
        for index, name in enumerate(names):
            expect(handoff.get_by_role("heading", level=1)).to_contain_text(name)
            expect(secret).to_have_count(0)
            page.get_by_test_id("local-show-private").click()
            expect(secret).to_be_visible()
            card_value = secret.locator(".local-card-value").inner_text()
            assert card_value
            if index == 0:
                other_tab.bring_to_front()
                page.wait_for_function("!document.hasFocus()")
                expect(secret).to_have_count(0)
                other_tab.close()
                page.bring_to_front()
                page.wait_for_function("document.hasFocus()")
                expect(secret).to_have_count(0)
                page.get_by_test_id("local-show-private").click()
                expect(secret.locator(".local-card-value")).to_have_text(card_value)
            card_values.append(card_value)
            page.get_by_test_id("local-hide-card").click()
            expect(secret).to_have_count(0)

        word, matches = Counter(card_values).most_common(1)[0]
        assert matches == 2
        for _ in names:
            page.get_by_test_id("local-clue-next").click()
        page.get_by_test_id("local-end-discussion").click()
        for name, target in zip(names, names[1:] + names[:1], strict=True):
            expect(handoff.get_by_role("heading", level=1)).to_contain_text(name)
            expect(secret).to_have_count(0)
            page.get_by_test_id("local-show-private").click()
            expect(secret.get_by_role("radio", name=name, exact=True)).to_have_count(0)
            secret.get_by_role("radio", name=target, exact=True).check()
            page.get_by_test_id("local-lock-vote").click()
        result = page.get_by_test_id("local-result")
        expect(result).to_be_visible()
        expect(result.locator(".local-card-value")).to_have_text(word)
        expect(page.get_by_test_id("local-next-round")).to_be_enabled()
        expect_no_horizontal_scroll(page)

        page.locator('.site-nav [data-route="history"]').click()
        history = page.locator("#app-view")
        history.locator("summary").filter(has_text=re.compile(r"\bClassic$")).click()
        expect(history.get_by_text(word, exact=True).first).to_be_visible()
    finally:
        context.close()


def open_websocket(page, url):
    page.goto(url)
    page.wait_for_function("typeof window.io === 'function'")
    page.evaluate("""() => {
        const socket = window.io({transports: ["websocket"], reconnection: false});
        window.roomTest = {socket, state: null};
        socket.on("room:state", state => { window.roomTest.state = state; });
    }""")
    page.wait_for_function("window.roomTest.socket.connected")
    assert page.evaluate("window.roomTest.socket.io.engine.transport.name") == "websocket"


def emit(page, event, payload, *, success=True):
    ack = page.evaluate(
        "([event, payload]) => window.roomTest.socket.timeout(5000).emitWithAck(event, payload)",
        [event, payload],
    )
    assert ack["ok"] == success, ack
    return ack


def room_state(page):
    return page.evaluate("window.roomTest.state")


def wait_for_phase(page, phase):
    page.wait_for_function(
        "phase => window.roomTest.state?.round?.phase === phase", arg=phase
    )
    return room_state(page)


def round_command(round_id, **fields):
    return {"roundId": round_id, "requestId": token_hex(12), **fields}


def act(page, round_id, action, **data):
    return emit(page, "room:action", round_command(round_id, action=action, data=data))


@pytest.fixture
def three_player_pages(app_url, chromium):
    browser, _ = chromium
    with ExitStack() as contexts:
        pages = []
        for _ in range(3):
            context = browser.new_context(base_url=app_url)
            contexts.callback(context.close)
            pages.append(context.new_page())
        yield pages


def test_online_game_using_lobby_and_game_controls(app_url, three_player_pages):
    expect = playwright_api.expect
    host, guest, third = three_player_pages
    host.goto(f"{app_url}/#online")
    create_form = host.locator("form").filter(has=host.get_by_role("heading", name="Skapa rum"))
    create_form.get_by_role("textbox", name="Ditt namn").fill("Alice")
    create_form.get_by_role("button", name="Skapa rum", exact=True).click()
    invite = host.get_by_role("textbox", name="Anslutningslänk")
    expect(invite).to_be_visible()
    invite_url = invite.input_value()
    code = urlsplit(invite_url).path.rsplit("/", 1)[-1]
    assert urlsplit(invite_url).path == f"/join/{code}"

    host.get_by_text("Visa QR-kod", exact=True).click()
    qr = host.get_by_role("img", name=f"QR-kod för rum {code}")
    expect(qr).to_be_visible()
    qr.scroll_into_view_if_needed()
    qr.evaluate("image => image.decode()")

    guest.goto(invite_url)
    third.goto(f"{app_url}/#online")
    for page, name, direct in [(guest, "Bertil", True), (third, "Clara", False)]:
        join_heading = f"Anslut till {code}" if direct else "Anslut till rum"
        join_form = page.locator("form").filter(has=page.get_by_role("heading", name=join_heading, exact=True))
        join_form.get_by_role("textbox", name="Ditt namn").fill(name)
        room_code = join_form.get_by_role("textbox", name="Rumskod")
        if direct:
            expect(room_code).to_have_value(code)
        else:
            room_code.fill(code)
        join_form.get_by_role("button", name="Anslut till rum", exact=True).click()

    start = host.get_by_role("button", name="Starta omgången", exact=True)
    expect(start).to_be_disabled()
    for page in (guest, third):
        page.get_by_role("button", name="Jag är redo", exact=True).click()
    expect(start).to_be_enabled()
    start.click()

    for page in three_player_pages:
        hidden_card_heading = page.get_by_role("heading", name="Ditt privata rollkort", exact=True)
        expect(hidden_card_heading).to_have_count(0)
        page.get_by_role("button", name="Visa mitt rollkort", exact=True).click()
        expect(hidden_card_heading).to_be_visible()
        page.get_by_role("button", name="Dölj och bekräfta", exact=True).click()
        expect(hidden_card_heading).to_have_count(0)

    names = ["Alice", "Bertil", "Clara"]
    turn_order = host.locator("details").filter(has=host.get_by_text("Turordning", exact=True))
    turn_order.locator("summary").click()
    expect(turn_order.locator("li")).to_have_count(3)
    order = turn_order.locator("li").all_text_contents()
    assert sorted(order) == names
    by_name = dict(zip(names, three_player_pages, strict=True))
    for name in order:
        by_name[name].get_by_role("button", name="Klar med min ledtråd", exact=True).click()
    host.get_by_role("button", name="Gå vidare till röstningen", exact=True).click()

    for name, target in zip(names, names[1:] + names[:1], strict=True):
        page = by_name[name]
        expect(page.get_by_role("radio", name=name, exact=True)).to_have_count(0)
        page.get_by_role("radio", name=target, exact=True).check()
        page.get_by_role("button", name="Lås min röst", exact=True).click()

    words = []
    for page in three_player_pages:
        expect(page.get_by_role("heading", name="Resultat", exact=True)).to_be_visible()
        word_label = page.get_by_text("Hemligt ord", exact=True)
        expect(word_label).to_be_visible()
        words.append(word_label.locator("xpath=following-sibling::dd[1]").inner_text())
        expect_no_horizontal_scroll(page)
    assert words[0] and words[0] == words[1] == words[2]


def test_real_websocket_round_and_reconnection(app_url, three_player_pages):
    pages = three_player_pages
    host, guest, third = pages
    open_websocket(host, app_url)
    created = emit(host, "room:create", {
        "name": "Alice",
        "settings": {"mode": "classic", "language": "en", "clueStyle": "text", "discussionSeconds": 0},
    })
    code = created["code"]
    invite = f"{app_url}/join/{code}"
    assert host.request.get(f"/api/qr/{code}.svg").headers["content-type"].startswith("image/svg+xml")
    open_websocket(guest, invite)
    open_websocket(third, app_url)
    joined = [
        created,
        emit(guest, "room:join", {"code": code, "name": "Bertil"}),
        emit(third, "room:join", {"code": code, "name": "Clara"}),
    ]
    for page in (guest, third):
        emit(page, "room:ready", {"ready": True})
    emit(host, "room:start", round_command(None))

    states = [wait_for_phase(page, "roles") for page in pages]
    round_id = states[0]["round"]["id"]
    cards = {}
    by_id = {}
    for page, info, state in zip(pages, joined, states, strict=True):
        player_id = info["playerId"]
        by_id[player_id] = page
        assert state["playerId"] == state["private"]["playerId"] == player_id
        assert state["round"] == states[0]["round"]
        assert state["round"]["result"] is None
        assert not {"roles", "votes", "word", "card"} & state["round"].keys()
        cards[player_id] = state["private"]["card"]

    imposters = [player_id for player_id, card in cards.items() if card["role"] == "imposter"]
    assert len(imposters) == 1
    imposter = imposters[0]
    civils = [player_id for player_id in cards if player_id != imposter]
    assert cards[imposter]["word"] is None and cards[imposter]["hint"]
    assert cards[civils[0]]["word"] == cards[civils[1]]["word"]
    assert cards[civils[0]]["word"]

    guest_id = joined[1]["playerId"]
    guest.evaluate("window.roomTest.socket.disconnect()")
    host.wait_for_function("window.roomTest.state?.pauseReason === 'connection'")
    assert not next(
        player["connected"] for player in room_state(host)["players"] if player["id"] == guest_id
    )
    open_websocket(guest, invite)
    resumed = emit(guest, "room:reconnect", {"code": code, "token": joined[1]["token"]})
    assert resumed["playerId"] == guest_id
    assert wait_for_phase(guest, "roles")["private"]["card"] == cards[guest_id]
    emit(host, "room:resume", round_command(round_id))

    for player_id, page in by_id.items():
        act(page, round_id, "ack_role")

    clues = ["Something familiar", "An unusual detail", "It fits the clues"]
    order = wait_for_phase(host, "clues")["round"]["order"]
    for player_id, clue in zip(order, clues, strict=True):
        act(by_id[player_id], round_id, "clue", text=clue)

    discussion = wait_for_phase(host, "discussion")
    assert [entry["text"] for entry in discussion["round"]["clues"]] == clues
    emit(guest, "room:chat", round_command(round_id, text="What do you think?"))
    host.wait_for_function("window.roomTest.state?.chat?.[0]?.text === 'What do you think?'")
    act(host, round_id, "end_discussion")
    wait_for_phase(host, "voting")

    initial_vote = round_command(round_id, action="vote", data={"targetId": imposter})
    emit(by_id[civils[0]], "room:action", initial_vote)
    emit(by_id[civils[0]], "room:action", initial_vote)
    emit(
        by_id[civils[0]],
        "room:action",
        round_command(round_id, action="vote", data={"targetId": civils[1]}),
        success=False,
    )
    act(by_id[imposter], round_id, "vote", targetId=civils[0])
    host.wait_for_function("window.roomTest.state?.round?.completed === 2")
    assert room_state(host)["round"]["result"] is None
    assert "votes" not in room_state(host)["round"]
    act(by_id[civils[1]], round_id, "vote", targetId=imposter)

    finished = [wait_for_phase(page, "reveal") for page in pages]
    result = finished[0]["round"]["result"]
    assert all(state["round"]["result"] == result and state["private"]["card"] is None for state in finished)
    assert result["word"] == cards[civils[0]]["word"]
    assert result["eliminated"] == imposter
    assert result["winnerTeam"] == "civils"
    assert result["votes"] == {civils[0]: imposter, civils[1]: imposter, imposter: civils[0]}
    assert result["points"] == {civils[0]: 2, civils[1]: 2, imposter: 0}
