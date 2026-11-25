import json
from dataclasses import dataclass, field
from itertools import count

import pytest

from app import create_app


@dataclass
class Clock:
    now: int = 1_780_000_000_000

    def __call__(self):
        return self.now


def emit(client, event, payload):
    reply = client.emit(event, payload, callback=True)
    assert isinstance(reply, dict), (event, reply)
    return reply


def expect_ok(reply):
    assert reply["ok"] is True, reply
    return reply


def expect_error(reply, code=None):
    assert reply["ok"] is False, reply
    if code is not None:
        assert reply["error"]["code"] == code, reply
    return reply["error"]


@dataclass
class Player:
    client: object
    id: str
    token: str
    states: list = field(default_factory=list)

    def read(self):
        for event in self.client.get_received():
            if event["name"] == "room:state":
                self.states.append(event["args"][0])
        assert self.states, self.id
        return self.states[-1]

    def send(self, event, payload):
        return emit(self.client, f"room:{event}", payload)


@pytest.fixture
def start_server():
    clients = []

    def start(**config):
        app = create_app({
            "TESTING": True,
            "TRUSTED_HOSTS": None,
            "HOST_GRACE_SECONDS": 0,
            "ONLINE_SWEEP_INTERVAL_SECONDS": 0,
            **config,
        })
        socketio = app.extensions["socketio"]
        rooms = app.extensions["online_rooms"]
        clock = Clock()
        rooms.clock = clock

        def new_client():
            client = socketio.test_client(app, flask_test_client=app.test_client())
            assert client.is_connected()
            clients.append(client)
            return client

        return app, new_client, rooms, clock

    yield start

    for client in reversed(clients):
        if client.is_connected():
            client.disconnect()


def enter(client, event, **payload):
    reply = expect_ok(emit(client, f"room:{event}", payload))
    return reply["code"], Player(client, reply["playerId"], reply["token"])


@dataclass
class Game:
    code: str
    players: list
    requests: object = field(default_factory=lambda: count(1))

    @property
    def host(self):
        return self.players[0]

    def payload(self):
        snapshot = self.host.read()
        return {
            "roundId": snapshot["round"]["id"] if snapshot["round"] else None,
            "requestId": f"test-{next(self.requests)}",
        }

    def act(self, player, action, **data):
        return player.send("action", {**self.payload(), "action": action, "data": data})

    def start(self):
        for player in self.players[1:]:
            expect_ok(player.send("ready", {"ready": True}))
        expect_ok(self.host.send("start", self.payload()))

    def give_clues(self):
        for player in self.players:
            expect_ok(self.act(player, "ack_role"))
        by_id = {player.id: player for player in self.players}
        round_state = self.host.read()["round"]
        assert round_state["phase"] == "clues"
        for index, player_id in enumerate(round_state["order"], 1):
            current = self.host.read()["round"]
            assert current["phase"] == "clues"
            assert current["currentPlayerId"] == player_id
            data = {"text": f"Ledtråd {index}"} if current["clueStyle"] == "text" else {}
            expect_ok(self.act(by_id[player_id], "clue", **data))


def create_game(new_client, settings=None, custom=None):
    options = {"settings": settings or {}}
    if custom is not None:
        options["custom"] = custom
    code, host = enter(new_client(), "create", name="Ada", **options)
    players = [host]
    for name in ("Boel", "Cleo"):
        joined_code, player = enter(new_client(), "join", code=code, name=name)
        assert joined_code == code
        players.append(player)
    return Game(code, players)


def test_three_clients_finish_text_round_and_receive_only_their_private_state(start_server):
    _, new_client, _, _ = start_server()
    game = create_game(new_client, {"mode": "classic", "clueStyle": "text"})
    host = game.host
    assert host.read()["stage"] == "lobby"
    assert host.read()["hostId"] == host.id
    expect_error(host.send("start", game.payload()), "players_not_ready")
    expect_error(game.players[1].send("start", game.payload()), "not_host")
    game.start()

    snapshots = {player.id: player.read() for player in game.players}
    assert all(state["stage"] == "playing" for state in snapshots.values())
    assert all(state["round"] == snapshots[host.id]["round"] for state in snapshots.values())
    assert all(state["playerId"] == state["private"]["playerId"] for state in snapshots.values())
    cards = {player_id: state["private"]["card"] for player_id, state in snapshots.items()}
    assert sorted(card["role"] for card in cards.values()) == ["civil", "civil", "imposter"]
    imposter = next(player for player in game.players if cards[player.id]["role"] == "imposter")
    civilians = [player for player in game.players if player != imposter]
    secret_word = cards[civilians[0].id]["word"]
    hint = cards[imposter.id]["hint"]
    assert secret_word and hint
    assert cards[civilians[1].id]["word"] == secret_word
    assert all(cards[player.id]["hint"] is None for player in civilians)
    assert cards[imposter.id]["word"] is None
    assert all(card["partners"] == [] for card in cards.values())

    _, waiting = enter(new_client(), "join", code=game.code, name="Dani")
    assert waiting.read()["private"] is None
    assert waiting.id not in {player["id"] for player in waiting.read()["round"]["players"]}
    assert next(player for player in waiting.read()["players"] if player["id"] == waiting.id)["waiting"]
    expect_error(game.act(waiting, "ack_role"), "waiting")

    game.give_clues()
    discussion = host.read()["round"]
    assert discussion["phase"] == "discussion"
    assert [clue["text"] for clue in discussion["clues"]] == ["Ledtråd 1", "Ledtråd 2", "Ledtråd 3"]
    participant = game.players[1]
    forged = {**game.payload(), "text": "Hej!", "playerId": host.id}
    expect_error(participant.send("chat", forged), "bad_payload")
    expect_error(participant.send("chat", {**game.payload(), "text": "x" * 281}), "bad_text")
    chat_payload = {**game.payload(), "text": "<b>Bröd</b>"}
    chat_ack = expect_ok(participant.send("chat", chat_payload))
    assert participant.send("chat", chat_payload) == chat_ack
    for player in game.players:
        chat = player.read()["chat"]
        assert len(chat) == 1
        assert chat[0]["playerId"] == participant.id
        assert chat[0]["text"] == "<b>Bröd</b>"
    assert waiting.read()["chat"] == []

    expect_error(game.act(participant, "end_discussion"), "not_host")
    expect_ok(game.act(host, "end_discussion"))
    expect_error(game.act(civilians[0], "vote", targetId=civilians[0].id), "invalid_action")
    vote = {**game.payload(), "action": "vote", "data": {"targetId": imposter.id}}
    vote_ack = expect_ok(civilians[0].send("action", vote))
    assert civilians[0].send("action", vote) == vote_ack
    expect_error(civilians[0].send("action", {**vote, "data": {"targetId": civilians[1].id}}), "request_conflict")
    expect_error(game.act(civilians[0], "vote", targetId=civilians[1].id), "invalid_action")
    expect_ok(game.act(imposter, "vote", targetId=civilians[0].id))
    assert civilians[0].read()["private"]["voted"] is True
    assert civilians[1].read()["private"]["voted"] is False
    assert host.read()["round"]["completed"] == 2

    all_players = (*game.players, waiting)
    for player in all_players:
        player.read()
        for snapshot in player.states:
            encoded = json.dumps(snapshot, ensure_ascii=False)
            assert all(other.token not in encoded for other in all_players)
            current = snapshot["round"]
            if current is not None:
                assert current["result"] is None
                assert "votes" not in current and "roles" not in current
                assert secret_word not in json.dumps(current, ensure_ascii=False)
                assert hint not in json.dumps(current, ensure_ascii=False)
            private = snapshot["private"]
            if private is not None:
                assert private["playerId"] == player.id
                assert "vote" not in private and "votes" not in private
        if player == imposter or player == waiting:
            assert secret_word not in json.dumps(player.states, ensure_ascii=False)

    last_vote = {**game.payload(), "action": "vote", "data": {"targetId": imposter.id}}
    final_ack = expect_ok(civilians[1].send("action", last_vote))
    assert civilians[1].send("action", last_vote) == final_ack
    expect_error(game.act(civilians[1], "vote", targetId=imposter.id))

    results = [player.read() for player in all_players]
    result = results[0]["round"]["result"]
    assert result["word"] == secret_word
    assert result["winnerTeam"] == "civils"
    assert result["eliminated"] == imposter.id
    assert result["votes"] == {civilians[0].id: imposter.id, civilians[1].id: imposter.id, imposter.id: civilians[0].id}
    assert result["roles"] == {player_id: card["role"] for player_id, card in cards.items()}
    for state in results:
        assert state["stage"] == "result"
        assert state["round"]["result"] == result
        assert [entry["id"] for entry in state["history"]] == [result["id"]]
        scores = {score["id"]: score for score in state["scores"]}
        for player in civilians:
            assert (scores[player.id]["points"], scores[player.id]["played"], scores[player.id]["wins"]) == (2, 1, 1)
        assert (scores[imposter.id]["points"], scores[imposter.id]["played"], scores[imposter.id]["imposterGames"]) == (0, 1, 1)

    for player in all_players:
        expect_ok(player.send("ready", {"ready": True}))
    restart_payload = game.payload()
    restart_ack = expect_ok(host.send("start", restart_payload))
    restarted = waiting.read()
    assert restarted["round"]["id"] != result["id"]
    assert restarted["private"]["playerId"] == waiting.id
    assert host.send("start", restart_payload) == restart_ack
    assert waiting.read()["round"]["id"] == restarted["round"]["id"]


def test_disconnect_freezes_timer_and_reconnect_preserves_role_and_vote(start_server):
    _, new_client, rooms, clock = start_server()
    game = create_game(new_client, {"discussionSeconds": 30})
    game.start()
    first_host = game.host
    original_card = first_host.read()["private"]["card"]
    game.give_clues()
    assert first_host.read()["round"]["deadline"] == clock.now + 30_000

    clock.now += 9_000
    first_host.client.disconnect()
    snapshot = game.players[1].read()
    assert snapshot["pauseReason"] == "connection"
    assert snapshot["round"]["paused"] is True
    assert snapshot["round"]["deadline"] is None
    assert snapshot["round"]["remainingMs"] == 21_000
    assert snapshot["hostId"] != first_host.id
    replacement = next(player for player in game.players if player.id == snapshot["hostId"])
    game.players = [replacement, first_host, next(player for player in game.players if player not in (replacement, first_host))]
    expect_error(replacement.send("resume", game.payload()), "players_offline")

    clock.now += 100_000
    rooms.sweep()
    assert replacement.read()["round"]["phase"] == "discussion"
    assert replacement.read()["round"]["remainingMs"] == 21_000
    anonymous = new_client()
    expect_error(emit(anonymous, "room:reconnect", {"code": game.code, "token": game.code}), "invalid_token")
    expect_error(emit(anonymous, "room:action", {**game.payload(), "action": "vote", "data": {"targetId": replacement.id}}), "not_in_room")
    _, restored = enter(anonymous, "reconnect", code=game.code, token=first_host.token)
    game.players[1] = restored
    assert restored.id == first_host.id
    assert restored.read()["private"]["card"] == original_card
    assert restored.read()["pauseReason"] == "connection"
    expect_error(restored.send("resume", game.payload()), "not_host")
    expect_ok(replacement.send("resume", game.payload()))
    assert restored.read()["round"]["deadline"] == clock.now + 21_000

    clock.now += 20_999
    rooms.sweep()
    assert replacement.read()["round"]["phase"] == "discussion"
    clock.now += 1
    rooms.sweep()
    assert replacement.read()["round"]["phase"] == "voting"

    vote = {**game.payload(), "action": "vote", "data": {"targetId": replacement.id}}
    vote_ack = expect_ok(restored.send("action", vote))
    _, other_tab = enter(new_client(), "reconnect", code=game.code, token=restored.token)
    assert other_tab.id == restored.id
    assert other_tab.read()["private"]["voted"] is True
    assert other_tab.read()["private"]["card"] == original_card
    assert other_tab.send("action", vote) == vote_ack
    if restored.client.is_connected():
        assert any(event["name"] == "room:replaced" for event in restored.client.get_received())
        expect_error(game.act(restored, "vote", targetId=game.players[2].id), "not_in_room")
    expect_error(game.act(other_tab, "vote", targetId=game.players[2].id), "invalid_action")
    assert replacement.read()["round"]["completed"] == 1

    other_tab.client.disconnect()
    assert replacement.read()["pauseReason"] == "connection"
    assert replacement.read()["round"]["result"] is None
    aborted_id = replacement.read()["round"]["id"]
    abort = game.payload()
    abort_ack = expect_ok(replacement.send("abort", abort))
    assert replacement.send("abort", abort) == abort_ack
    after = replacement.read()
    assert after["stage"] == "lobby"
    assert after["aborted"] == aborted_id
    assert after["round"] is None
    assert after["history"] == []
    assert all(score["played"] == score["points"] == 0 for score in after["scores"])


@pytest.mark.parametrize("special_mode", ["all", "none"])
def test_chaos_uses_neutral_steps_and_group_options_until_reveal(start_server, special_mode):
    _, new_client, _, _ = start_server()
    game = create_game(new_client, {"mode": "chaos", "chaos": [{"mode": special_mode, "weight": 1}]})
    game.start()
    game.give_clues()
    assert game.host.read()["round"]["phase"] == "abilities"
    for player in game.players:
        assert player.read()["private"]["ability"] is None
        expect_ok(game.act(player, "ability"))
    expect_ok(game.act(game.host, "end_discussion"))
    for player in game.players:
        snapshot = player.read()
        assert set(snapshot["round"]["options"]) == {p.id for p in game.players} | {"@all", "@none"}
        for seen in player.states:
            if seen["round"] is not None:
                assert seen["round"]["mode"] == "chaos"
                assert seen["round"]["result"] is None
    for player in game.players:
        expect_ok(game.act(player, "vote", targetId=f"@{special_mode}"))
    result = game.host.read()["round"]["result"]
    assert result["mode"] == special_mode
    assert result["selectedMode"] == "chaos"
    assert result["winnerTeam"] == "all"
    assert result["points"] == {player.id: 2 for player in game.players}


def test_room_capacity_expiry_and_server_restart(start_server):
    _, new_client, rooms, clock = start_server(MAX_ROOMS=1, ROOM_TTL_SECONDS=2)
    code, host = enter(new_client(), "create", name="Ada")
    wait = new_client()
    expect_error(emit(wait, "room:create", {"name": "Boel"}), "server_full")
    expect_error(emit(wait, "room:join", {"name": "Boel", "code": "!"}), "bad_code")
    clock.now += 2_001
    rooms.sweep()
    assert any(event["name"] == "room:expired" and event["args"] == [{"code": code}] for event in host.client.get_received())
    expect_error(emit(wait, "room:reconnect", {"code": code, "token": host.token}), "room_not_found")
    code2, host2 = enter(wait, "create", name="Boel")

    _, restarted_client, _, _ = start_server()
    recovered = restarted_client()
    expect_error(emit(recovered, "room:reconnect", {"code": code2, "token": host2.token}), "room_not_found")
    _, fresh_host = enter(recovered, "create", name="Boel")
    assert fresh_host.id != host2.id
    assert fresh_host.read()["history"] == []
    assert all(score["points"] == 0 for score in fresh_host.read()["scores"])


def test_custom_package_is_validated_and_absent_from_public_content(start_server):
    app, new_client, _, _ = start_server(ONLINE_MAX_CUSTOM_BYTES=2_048)
    category = {
        "id": "test-pocket",
        "names": {"sv": "Fickföremål", "en": "Pocket objects"},
        "icon": "🔑",
        "subcategories": [{"id": "test-pocket-trinkets", "names": {"sv": "Småsaker", "en": "Trinkets"}}],
    }
    word = {
        "id": "test-pocket-oracle",
        "category": category["id"],
        "subcategory": category["subcategories"][0]["id"],
        "tags": [],
        "level": "familiar",
        "review": "editorial",
        "languages": {
            "sv": {
                "word": "Bärnstensorakel",
                "aliases": [],
                "hints": {"easy": "En förstenad glimt", "normal": "Viskar om morgondagen", "hard": "I en gyllene droppe"},
            },
            "en": {
                "word": "Amber oracle",
                "aliases": [],
                "hints": {"easy": "A fossilized glimpse", "normal": "Whispers about tomorrow", "hard": "In a golden drop"},
            },
        },
    }
    package = {"categories": [category], "words": [word], "pairs": []}
    settings = {"categories": [category["id"]]}
    host_client = new_client()
    bad_upload = {**package, "words": [dict(word, subcategory="unknown-subcategory")]}
    expect_error(emit(host_client, "room:create", {"name": "Ada", "custom": bad_upload}), "invalid_custom")
    large_upload = {**package, "padding": "x" * 3_000}
    expect_error(emit(host_client, "room:create", {"name": "Ada", "custom": large_upload}), "too_large")

    game = create_game(new_client, settings, package)
    for player in game.players:
        snapshot = player.read()
        assert snapshot["selection"] == {"words": 1, "pairs": 0}
        assert snapshot["customCategories"] == [category]
        assert word["id"] not in json.dumps(snapshot)
        assert word["languages"]["sv"]["word"] not in json.dumps(snapshot, ensure_ascii=False)
    expect_error(game.players[1].send("settings", {"settings": {}, "custom": None}), "not_host")

    public = app.test_client()
    assert public.get(f"/api/content/packs/{category['id']}.json").status_code == 404
    manifest = public.get("/api/content/manifest").get_json()
    assert category["id"] not in {item["id"] for item in manifest["categories"]}

    game.start()
    for player in game.players:
        snapshot = player.read()
        assert word["id"] not in json.dumps(snapshot)
        card = snapshot["private"]["card"]
        language = word["languages"]["sv"]
        expected = {"word": None, "hint": language["hints"]["normal"]} if card["role"] == "imposter" else {"word": language["word"], "hint": None}
        assert {key: card[key] for key in ("word", "hint")} == expected
