import itertools
import json
from collections import Counter
from pathlib import Path
import shutil
import subprocess

import pytest

from app.game.engine import EngineError, create_round, profile_issues


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
NOW = 1_700_000_000_000


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


RULES = read_json(ROOT / "data" / "rules.json")
CONTENT = read_json(FIXTURES / "engine_content.json")
WORDS = CONTENT["words"]
PAIRS = CONTENT["pairs"]
CASES = read_json(FIXTURES / "engine_rounds.json")
MIXED = {"classic", "random", "alliance", "blind"}
EXTRAS = (None, "detective", "guardian", "spy", "accomplice", "double_agent")
OPPOSITION = {"imposter", "spy", "accomplice", "double_agent", "undercover"}
ACTUAL_IMPOSTERS = {"imposter", "spy"}
INVALID_SETTINGS_CASES = [
    ({"mode": "chaos"}, "chaos_empty"),
    ({"mode": "chaos", "chaos": [{"mode": "classic", "weight": 0}]}, "chaos_weight"),
    ({"mode": "chaos", "chaos": [{"mode": "classic", "weight": False}]}, "chaos_weight"),
    ({"mode": "chaos", "chaos": [{"mode": "chaos", "weight": 1}]}, "invalid_mode"),
    ({"mode": "chaos", "chaos": [{"mode": "classic", "language": "en", "weight": 1}]}, "invalid_settings"),
    ({"language": "en"}, "invalid_settings"),
    ({"mode": "random", "randomMin": 2, "randomMax": 1}, "invalid_random_range"),
    ({"mode": "random", "randomMax": True}, "invalid_settings"),
    ({"mode": "random", "freePlay": 1}, "invalid_settings"),
    ({"mode": "random", "freePlay": True, "randomMin": -1}, "invalid_random_range"),
    ({"mode": "random", "freePlay": True, "randomMax": 7}, "invalid_random_range"),
    ({"mode": "random", "freePlay": True, "randomMin": 5, "randomMax": 4}, "invalid_random_range"),
    ({"mode": "random", "freePlay": True, "joker": True, "randomMax": 3}, "invalid_random_range"),
    ({"mode": "random", "freePlay": True, "extraRole": "guardian", "randomMin": 0}, "invalid_random_range"),
    ({"mode": "random", "freePlay": True, "extraRole": "double_agent", "randomMax": 2}, "invalid_random_range"),
    ({"mode": "random", "randomMin": 0}, "invalid_random_range"),
    ({"mode": "chaos", "freePlay": True, "chaos": [{"mode": "random", "freePlay": False, "weight": 1}]}, "invalid_settings"),
    ({"mode": "undercover", "lastGuess": True}, "last_guess_incompatible"),
    ({"mode": "classic", "levels": []}, "invalid_settings"),
    ({"mode": "classic", "discussionSeconds": "60"}, "invalid_settings"),
    ({"mode": "classic", "extraRole": ["guardian", "detective"]}, "invalid_settings"),
    ({"mode": "chaos", "chaos": [{}]}, "invalid_mode"),
    ({"categories": ["animals"]}, "no_words"),
    ({"mode": "undercover", "subcategories": ["food-snacks"]}, "no_pairs"),
]


def players(count):
    return [{"id": f"p{i}", "name": f"Spelare {i}"} for i in range(1, count + 1)]


def start(settings=None, *, count=6, rolls=(), used=None):
    rolls = iter(rolls)
    return create_round(
        players(count), settings or {}, WORDS, PAIRS, RULES,
        rng=lambda: next(rolls, 0), used=used, now=NOW,
    )


def issues(settings, count=6, words=WORDS, pairs=PAIRS):
    return profile_issues(settings, count, words, pairs, RULES)


def matrix_settings(mode, count):
    for joker, extra in itertools.product((False, True), EXTRAS):
        yield {"mode": mode, "joker": joker, "extraRole": extra}
    if mode == "random":
        for joker, extra in itertools.product((False, True), EXTRAS):
            for actual_count in range(1, (count - 1) // 2 + 2):
                yield {
                    "mode": mode, "joker": joker, "extraRole": extra,
                    "randomMin": actual_count, "randomMax": actual_count,
                }


def expected_counts(settings, count):
    mode = settings["mode"]
    joker_requested = settings["joker"]
    joker = joker_requested or mode == "joker"
    extra = settings["extraRole"]
    if count < (5 if mode in {"joker", "alliance"} else 3) or count > 20:
        return set()
    if joker and (count < 5 or mode not in MIXED | {"joker"}):
        return set()
    if extra and (count < 6 or mode not in MIXED):
        return set()
    if extra == "spy" and mode not in {"classic", "random"}:
        return set()
    if mode not in MIXED | {"joker"}:
        return {count if mode == "all" else count - 1 if mode == "reverse" else 0}

    if mode == "random":
        fixed = settings.get("randomMin")
        possible = range(1, (count - 1) // 2 + 1) if fixed is None else [fixed]
    else:
        possible = [2 if mode == "alliance" else 1]
    valid = set()
    for actual in possible:
        impostor_team = actual + (extra in {"accomplice", "double_agent"})
        civilians = count - impostor_team - joker
        if civilians > impostor_team and (not joker or civilians >= 3):
            valid.add(actual)
    return valid


def role_counts(round):
    return Counter(round.private_state(id_)["card"]["role"] for id_ in round.public_state()["order"])


def free_play_counts(player_count):
    for actual in range(player_count + 1):
        settings = {"mode": "random", "freePlay": True, "randomMin": actual, "randomMax": actual}
        yield actual, settings


@pytest.mark.parametrize("player_count", range(3, 21))
def test_free_play_random_can_draw_or_fix_every_count(player_count):
    for actual, settings in free_play_counts(player_count):
        assert issues(settings, player_count) == []
        fixed = start(settings, count=player_count)
        roll = (actual + 0.5) / (player_count + 1)
        random = start({"mode": "random", "freePlay": True}, count=player_count, rolls=[roll])
        for round in (fixed, random):
            assert round.public_state()["mode"] == "random"
            assert role_counts(round)["imposter"] == actual
            assert role_counts(round)["civil"] == player_count - actual


@pytest.mark.parametrize("mode", ("classic", "random", "all", "none", "reverse", "joker", "undercover", "alliance", "blind"))
def test_configuration_matrix(mode):
    for count in range(2, 22):
        for settings in matrix_settings(mode, count):
            expected = expected_counts(settings, count)
            profile_errors = issues(settings, count)
            assert bool(expected) == (not profile_errors), (count, settings, profile_errors)
            if not expected:
                continue
            for first_roll, expected_actual in ((0, min(expected)), (0.99999, max(expected))):
                round = start(settings, count=count, rolls=[first_roll])
                actual_roles = role_counts(round)
                assert sum(actual_roles.values()) == count
                assert sum(actual_roles[role] for role in ACTUAL_IMPOSTERS) == expected_actual
                assert actual_roles["joker"] == (settings["joker"] or mode == "joker")
                for extra in EXTRAS[1:]:
                    assert actual_roles[extra] == (settings["extraRole"] == extra)
                if mode == "undercover":
                    assert actual_roles == {None: count}
                assert round.phase == "roles"


class Replay:
    def __init__(self, case, used=()):
        self.players = players(case.get("count", 6))
        self.ids = [player["id"] for player in self.players]
        self.used = list(used)
        self.settings = case["settings"]
        self.rolls = case.get("rolls", [])
        self.round = start(self.settings, count=len(self.players), rolls=self.rolls, used=self.used)
        self.events = []
        self.frames = [self.snapshot()]

    @property
    def public(self):
        return self.frames[-1]["public"]

    @property
    def private(self):
        return self.frames[-1]["private"]

    def snapshot(self, outcome=None):
        return {
            "outcome": outcome,
            "public": self.round.public_state(),
            "private": {id_: self.round.private_state(id_) for id_ in self.ids},
        }

    def invoke(self, method, *args, error=None):
        self.events.append([method, *args])
        try:
            outcome = getattr(self.round, method)(*args)
        except EngineError as exc:
            assert error is not None, (method, args, exc.code)
            assert error is True or exc.code == error
            outcome = {"code": exc.code, "issues": exc.issues}
        else:
            assert error is None, (method, args, error)
        self.frames.append(self.snapshot(outcome))
        return outcome

    def act(self, player, action, data=None, now=NOW, *, error=None):
        return self.invoke("act", player, action, data or {}, now, error=error)

    def input(self):
        return {
            "players": self.players, "settings": self.settings, "rolls": self.rolls,
            "used": self.used, "now": NOW, "events": self.events,
        }


def role_target(cards, role):
    if role.startswith("@"):
        return role
    if role in {"undercover-minority", "undercover-majority"}:
        counts = Counter(card["word"] for card in cards.values())
        return next(id_ for id_, card in cards.items() if (counts[card["word"]] == 1) == (role == "undercover-minority"))
    return next(id_ for id_, card in cards.items() if card["role"] == role)


def check_cards(replay, case):
    cards = {id_: view["card"] for id_, view in replay.private.items()}
    mode = case["settings"].get("mode", "classic")
    played_mode = case.get("playedMode", mode)
    if played_mode == "undercover":
        assert sorted(Counter(card["word"] for card in cards.values()).values()) == [1, len(cards) - 1]
        assert all(card == {"role": None, "word": card["word"], "hint": None, "partners": []} for card in cards.values())
    if mode == "chaos":
        assert all(card["role"] != "civil" for card in cards.values())
    if "actualImposters" in case:
        assert sum(card["role"] in ACTUAL_IMPOSTERS for card in cards.values()) == case["actualImposters"]
    imposters = {id_ for id_, card in cards.items() if card["role"] == "imposter"}
    for id_, card in cards.items():
        role = card["role"]
        if role in {"imposter", "accomplice"}:
            assert card["word"] is None
            assert (card["hint"] is None) == (played_mode == "blind")
            if role == "accomplice":
                assert len(card["partners"]) == 1
                assert set(card["partners"]) <= imposters
            else:
                assert set(card["partners"]) == (imposters - {id_} if played_mode == "alliance" else set())
        elif role == "spy":
            assert card["word"] == "Äppelpaj"
            assert card["hint"] is None and card["partners"] == []
        else:
            assert card["word"] is not None
            assert card["hint"] is None and card["partners"] == []
    return cards


def drive_case(case):
    replay = Replay(case)
    cards = check_cards(replay, case)
    ids = replay.ids
    mode = case["settings"].get("mode", "classic")
    assert replay.public["mode"] == mode and replay.public["phase"] == "roles"
    assert replay.public["result"] is None and replay.public["options"] == []
    replay.act(ids[0], "vote", {"targetId": ids[1]}, error="wrong_phase")
    for index, id_ in enumerate(ids, 1):
        replay.act(id_, "ack_role")
        assert replay.private[id_]["roleReady"] is True
        if index == 1:
            replay.act(id_, "ack_role", error="already_done")

    public_clues = []
    while replay.public["phase"] == "clues":
        actor = replay.public["currentPlayerId"]
        clue_round = replay.public["clueRound"]
        other = next(id_ for id_ in ids if id_ != actor)
        replay.act(other, "clue", {"text": "fel tur"}, error="not_your_turn")
        if replay.public["clueStyle"] == "text":
            replay.act(actor, "clue", {"text": "😺" * 81}, error="invalid_text")
            replay.act(actor, "clue", {"text": " " + "😺" * 80 + " "})
            public_clues.append({"playerId": actor, "round": clue_round, "text": "😺" * 80})
        else:
            replay.act(actor, "clue")
        assert replay.public["clues"] == public_clues

    has_ability = case["settings"].get("extraRole") in {"detective", "guardian"}
    assert (replay.public["phase"] == "abilities") == (mode == "chaos" or has_ability)
    if replay.public["phase"] == "abilities":
        for id_ in ids:
            ability = replay.private[id_]["ability"]
            assert ability == (cards[id_]["role"] if cards[id_]["role"] in {"detective", "guardian"} else None)
            ability_target = case.get("investigate") if ability == "detective" else case.get("protect") if ability == "guardian" else None
            target_id = role_target(cards, ability_target) if ability_target else None
            assert replay.public["result"] is None and replay.public["options"] == []
            if ability:
                replay.act(id_, "ability", {"targetId": id_}, error="invalid_target")
            replay.act(id_, "ability", {"targetId": target_id})
            if ability == "detective" and target_id:
                assert replay.private[id_]["investigation"] == {
                    "playerId": target_id, "impostorTeam": cards[target_id]["role"] in OPPOSITION,
                }
                assert all(view["investigation"] is None for other, view in replay.private.items() if other != id_)

    assert replay.public["phase"] == "discussion"
    now = NOW
    if case.get("pauseTimer"):
        assert replay.public["deadline"] == NOW + 30_000
        assert replay.invoke("tick", NOW + 5_000) is False
        assert replay.invoke("pause", NOW + 5_000) is True
        assert replay.invoke("pause", NOW + 6_000) is False
        assert replay.public["remainingMs"] == 25_000 and replay.public["deadline"] is None
        replay.act(ids[0], "end_discussion", now=NOW + 60_000, error="paused")
        assert replay.invoke("tick", NOW + 60_000) is False
        assert replay.invoke("resume", NOW + 60_000) is True
        assert replay.invoke("resume", NOW + 61_000) is False
        now = NOW + 85_000
        assert replay.public["deadline"] == now and replay.public["remainingMs"] is None
        assert replay.invoke("tick", now - 1) is False
        assert replay.invoke("tick", now) is True
    else:
        if case["settings"].get("discussionSeconds") == 0:
            assert replay.public["deadline"] is None
            now = NOW + 120_000
            assert replay.invoke("tick", now) is False
        replay.act(ids[0], "end_discussion", now=now)

    assert replay.public["phase"] == "voting"
    pool_modes = {profile["mode"] for profile in case["settings"].get("chaos", [])}
    group = [f"@{mode}"] if mode in {"all", "none"} else []
    if pool_modes & {"all", "none"}:
        group = ["@all", "@none"]
    assert replay.public["options"] == ids + case.get("groupOptions", group)
    want_tie = case["voteFor"] == "tie"
    target = None if want_tie else role_target(cards, case["voteFor"])
    votes = {}
    for index, id_ in enumerate(ids):
        replay.act(id_, "vote", {"targetId": id_}, now, error="invalid_target")
        alternative = ids[(index + 1) % len(ids)]
        choice = alternative if want_tie or id_ == target else target
        replay.act(id_, "vote", {"targetId": choice}, now)
        votes[id_] = choice
        assert replay.private[id_]["voted"] is True
        if index < len(ids) - 1:
            assert replay.public["completed"] == index + 1
            assert replay.public["result"] is None
            replay.act(id_, "vote", {"targetId": choice}, now, error="already_done")

    eligible_guess = "guess" in case or "guessAtDeadline" in case
    has_guess_window = eligible_guess or case.get("neutralGuess", False)
    assert (replay.public["phase"] == "last_guess") == has_guess_window
    if has_guess_window:
        assert replay.public["result"] is None and replay.public["options"] == []
        deadline = replay.public["deadline"]
        assert deadline == now + 20_000
        guessers = [id_ for id_, view in replay.private.items() if view["canGuess"]]
        assert guessers == ([target] if eligible_guess else [])
        if guessers:
            other = next(id_ for id_ in ids if id_ != target)
            replay.act(other, "guess", {"text": "fel spelare"}, now, error="not_your_turn")
            if "guessAtDeadline" in case:
                replay.act(target, "guess", {"text": case["guessAtDeadline"]}, deadline, error=True)
            else:
                replay.act(target, "guess", {"text": case["guess"]}, deadline - 1)
        if mode == "chaos":
            assert replay.public["phase"] == "last_guess" and replay.public["result"] is None
            if guessers:
                replay.act(target, "guess", {"text": "andra gissningen"}, deadline - 1, error=True)
            assert replay.invoke("tick", deadline - 1) is False
            assert replay.invoke("tick", deadline) is True

    result = replay.public["result"]
    assert replay.public["phase"] == "reveal"
    assert result["selectedMode"] == mode and result["mode"] == case.get("playedMode", mode)
    assert result["reason"] == case["reason"] and result["winnerTeam"] == case["winnerTeam"]
    assert result["votes"] == votes and result["voteWinner"] == target
    assert result["protected"] == (target if "protect" in case else None)
    assert result["eliminated"] == (target if target in ids and "protect" not in case else None)
    assert (result["pairedWord"] is not None) == (mode == "undercover" or case["settings"].get("extraRole") == "spy")
    if has_guess_window and guessers:
        assert result["guess"]["playerId"] == target
        assert result["guess"]["correct"] == (case["reason"] == "guess_correct")
        assert (result["guess"]["text"] is None) == (case["reason"] == "guess_timeout")
    else:
        assert result["guess"] is None
    assert all(view["card"] is None and not view["canGuess"] for view in replay.private.values())
    expected_winners = winning_ids(result["winnerTeam"], result["roles"], ids)
    assert result["winners"] == expected_winners
    points = 3 if result["winnerTeam"] == "joker" else 2
    assert result["points"] == {id_: points if id_ in expected_winners else 0 for id_ in ids}
    assert replay.invoke("tick", now + 60_000) is False
    return replay


def winning_ids(team, roles, ids):
    if team == "all":
        return ids
    if team == "none":
        return []
    if team == "joker":
        return [id_ for id_ in ids if roles[id_] == "joker"]
    if team == "impostors":
        return [id_ for id_ in ids if roles[id_] in OPPOSITION]
    return [id_ for id_ in ids if roles[id_] not in OPPOSITION | {"joker"}]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_round_scenarios(case):
    drive_case(case)


def test_validation_reports_invalid_chaos_profiles_in_pool_order():
    settings = {
        "mode": "chaos",
        "chaos": [
            {"mode": "alliance", "weight": 1},
            {"mode": "classic", "weight": 1},
            {"mode": "undercover", "weight": 1, "joker": True},
        ],
    }
    expected = issues(settings, count=4)
    assert list(dict.fromkeys(issue["mode"] for issue in expected)) == ["alliance", "undercover"]
    assert {"code": "player_count", "mode": "alliance"} in expected
    assert {"code": "joker_incompatible", "mode": "undercover"} in expected
    with pytest.raises(EngineError) as raised:
        start(settings, count=4)
    assert raised.value.code == "player_count" and raised.value.issues == expected


@pytest.mark.parametrize(("settings", "code"), INVALID_SETTINGS_CASES + [
    ({"mode": "chaos", "chaos": [{"mode": "classic", "weight": float("inf")}]}, "chaos_weight"),
])
def test_specific_validation_errors(settings, code):
    assert code in {issue["code"] for issue in issues(settings)}


def test_only_pairs_with_both_selected_words_are_playable():
    assert issues({"mode": "undercover"}, words=WORDS[1:]) == [{"code": "no_pairs", "mode": "undercover"}]
    assert issues({"mode": "classic", "extraRole": "spy", "levels": ["expert"]}) == [{"code": "no_pairs", "mode": "classic"}]
    assert issues({"categories": ["animals"]}) == [{"code": "no_words", "mode": "classic"}]
    assert issues({"mode": "undercover", "language": "sv", "subcategories": ["food-desserts"]}) == []


def result_after_voting(round):
    state = round.public_state()
    ids = [player["id"] for player in state["players"]]
    for id_ in ids:
        round.act(id_, "ack_role", {}, NOW)
    while round.phase == "clues":
        round.act(round.public_state()["currentPlayerId"], "clue", {}, NOW)
    round.act(ids[0], "end_discussion", {}, NOW)
    for index, id_ in enumerate(ids):
        round.act(id_, "vote", {"targetId": ids[(index + 1) % len(ids)]}, NOW)
    return round.public_state()["result"]


def test_word_pool_drains_then_reuses_oldest_selected_word():
    blueberry, apple, popcorn, _ = [word["id"] for word in WORDS]
    used = []
    for expected in (blueberry, apple, popcorn):
        result = result_after_voting(start(used=used))
        assert result["wordId"] == expected and result["reused"] is False
        assert expected not in used
        used.append(expected)
    result = result_after_voting(start(used=used))
    assert used == [blueberry, apple, popcorn]
    assert result["wordId"] == blueberry and result["reused"] is True
    changed = result_after_voting(start({"subcategories": ["food-desserts"]}, used=[apple, blueberry]))
    assert changed["wordId"] == apple and changed["reused"] is True


def test_pair_orientation_and_preference_for_unseen_concepts():
    blueberry, apple, popcorn, _ = [word["id"] for word in WORDS]
    rng = iter([0, 0.8])
    round = create_round(
        players(6), {"mode": "undercover"}, WORDS, [[blueberry, apple], [apple, popcorn]], RULES,
        rng=lambda: next(rng, 0), used=[blueberry], now=NOW,
    )
    result = result_after_voting(round)
    assert (result["wordId"], result["pairedWordId"], result["reused"]) == (popcorn, apple, False)
    result = result_after_voting(start({"mode": "undercover"}, used=[blueberry]))
    assert (result["wordId"], result["pairedWordId"], result["reused"]) == (blueberry, apple, True)


def test_active_projections_and_abort_do_not_expose_round_answers():
    replay = Replay({"settings": {"mode": "classic"}})
    round = replay.round
    assert set(replay.public) == {
        "id", "mode", "phase", "players", "order", "clueStyle", "clueRounds", "discussionSeconds",
        "clueRound", "currentPlayerId", "clues", "completed", "options", "paused", "deadline", "remainingMs", "result",
    }
    assert set(replay.private["p1"]) == {
        "playerId", "card", "roleReady", "abilityReady", "voted", "ability", "investigation", "canGuess",
    }
    with pytest.raises(EngineError, match="unknown_player"):
        round.private_state("outsider")
    replay.act("outsider", "ack_role", error="unknown_player")
    assert replay.invoke("pause", NOW) is True
    replay.act("p1", "abort")
    assert replay.public["phase"] == "aborted" and replay.public["result"] is None
    assert all(view["card"] is None for view in replay.private.values())


def test_invalid_player_ids_cannot_break_vote_targets():
    roster = players(6)
    for invalid in ("@all", "@none", "", "p2"):
        roster[0]["id"] = invalid
        with pytest.raises(EngineError) as raised:
            create_round(roster, {}, WORDS, PAIRS, RULES, now=NOW)
        assert raised.value.code == "invalid_players"


def replay_javascript(cases, configurations=()):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js saknas för JavaScriptmotorns fristående testkörning")
    completed = subprocess.run(
        [node, str(FIXTURES / "engine_replay.mjs")],
        input=json.dumps({
            "content": CONTENT, "rules": RULES, "cases": cases,
            "configurations": configurations,
        }), encoding="utf-8", capture_output=True, timeout=30,
    )
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def test_javascript_table_play_reveals_only_after_physical_play():
    roster = players(6)
    blueberry, apple, popcorn, _ = [word["id"] for word in WORDS]
    rounds = [
        ({}, (), [blueberry], apple, None, False, "classic", {"civil": 5, "imposter": 1}),
        ({"mode": "blind"}, (), [apple, popcorn, blueberry], apple, None, True, "blind", {"civil": 5, "imposter": 1}),
        ({"mode": "undercover"}, (0, 0.8), [], apple, blueberry, False, "undercover", {"civil": 5, "undercover": 1}),
        ({"extraRole": "spy", "joker": True}, (), [], blueberry, apple, False, "classic", {"civil": 4, "spy": 1, "joker": 1}),
        ({"mode": "chaos", "chaos": [{"mode": "classic", "weight": 1}, {"mode": "all", "weight": 1}]},
         (0.6,), [], blueberry, None, False, "all", {"imposter": 6}),
        ({"mode": "random", "freePlay": True, "randomMin": 0, "randomMax": 0},
         (), [], blueberry, None, False, "none", {"civil": 6}),
        ({"mode": "random", "freePlay": True, "randomMin": 5, "randomMax": 5},
         (), [], blueberry, None, False, "reverse", {"civil": 1, "imposter": 5}),
        ({"mode": "random", "freePlay": True},
         (0.99,), [], blueberry, None, False, "all", {"imposter": 6}),
    ]
    opening = [
        (["act", "p1", "reveal_roles", {}, NOW], "wrong_phase"),
        (["act", "p1", "ack_role", {}, NOW], True),
        (["act", "p1", "ack_role", {}, NOW], "already_done"),
    ]
    acknowledgments = [(["act", player["id"], "ack_role", {}, NOW], True) for player in roster[1:]]
    playing = [
        (["tick", NOW + 600_000], False),
        (["act", "p1", "clue", {"text": "En ledtråd"}, NOW], "wrong_phase"),
        (["act", "p1", "ability", {}, NOW], "wrong_phase"),
        (["act", "p1", "end_discussion", {}, NOW], "wrong_phase"),
        (["act", "p1", "vote", {"targetId": "p2"}, NOW], "wrong_phase"),
        (["act", "p1", "guess", {"text": "Äppelpaj"}, NOW], "wrong_phase"),
        (["act", "outsider", "reveal_roles", {}, NOW], "unknown_player"),
    ]
    ending = [
        (["act", "p1", "reveal_roles", {}, NOW], True),
        (["act", "p1", "reveal_roles", {}, NOW], "wrong_phase"),
    ]
    steps = opening + acknowledgments + playing + ending
    inputs = [
        {"players": roster, "settings": settings, "rolls": rolls, "used": used, "now": NOW,
         "flow": "table", "events": [event for event, _ in steps]}
        for settings, rolls, used, *_ in rounds
    ]
    observed = replay_javascript(inputs)["rounds"]
    for actual, (settings, _, used, word, paired, reused, played_mode, roles) in zip(observed, rounds, strict=True):
        frames = actual["frames"]
        assert actual["used"] == used
        assert not any(actual["localGuessNominees"])
        assert frames[0]["outcome"] is None
        for frame, (_, expected) in zip(frames[1:], steps, strict=True):
            assert frame["outcome"] == ({"code": expected, "issues": []} if isinstance(expected, str) else expected)

        mode = settings.get("mode", "classic")
        start_playing = len(opening) + len(acknowledgments)
        for frame in frames[:start_playing]:
            assert frame["public"]["phase"] == "roles"
            assert frame["public"]["result"] is None
            assert all(view["card"] is not None for view in frame["private"].values())
        initial_cards = [view["card"] for view in frames[0]["private"].values()]
        if mode == "undercover":
            assert Counter(card["word"] for card in initial_cards) == {"Äppelpaj": 5, "Blåbärspaj": 1}
            assert all(card["role"] is None for card in initial_cards)
        if mode == "blind":
            assert [card for card in initial_cards if card["role"] == "imposter"] == [
                {"role": "imposter", "word": None, "hint": None, "partners": []},
            ]

        for frame in frames[start_playing:-2]:
            public = frame["public"]
            assert public["phase"] == "playing" and public["mode"] == mode
            assert public["result"] is None and public["options"] == [] and public["clues"] == []
            assert public["deadline"] is None and public["currentPlayerId"] is None
            assert all(view["card"] is None and not view["canGuess"] for view in frame["private"].values())

        final = frames[-1]["public"]
        assert final["phase"] == "reveal" and final == frames[-2]["public"]
        result = final["result"]
        assert result["reason"] == "roles_revealed"
        assert result["selectedMode"] == mode and result["mode"] == played_mode
        assert result["wordId"] == word and result["pairedWordId"] == paired and result["reused"] is reused
        assert Counter(result["roles"].values()) == roles
        assert result["votes"] == {} and result["points"] == {} and result["winners"] == []
        assert all(result[field] is None for field in ("winnerTeam", "voteWinner", "eliminated", "protected", "guess"))


def test_python_and_javascript_engine_parity():
    configurations = [
        {"settings": settings, "count": count}
        for count in range(2, 22)
        for mode in ("classic", "random", "all", "none", "reverse", "joker", "undercover", "alliance", "blind")
        for settings in matrix_settings(mode, count)
    ]
    for case in CASES:
        configurations.append({"settings": case["settings"], "count": case.get("count", 6)})
    configurations.extend({"settings": settings, "count": 6} for settings, _ in INVALID_SETTINGS_CASES)
    configurations.extend(
        {"settings": settings, "count": count}
        for count in range(3, 21)
        for _, settings in free_play_counts(count)
    )
    rounds = [drive_case(case) for case in CASES]
    parity = replay_javascript([round.input() for round in rounds], configurations)
    assert len(parity["issues"]) == len(configurations)
    for actual, configuration in zip(parity["issues"], configurations, strict=True):
        assert actual == issues(configuration["settings"], configuration["count"]), configuration
    for actual, expected, case in zip(parity["rounds"], rounds, CASES, strict=True):
        assert len(actual["frames"]) == len(expected.frames)
        for index, (js, python) in enumerate(zip(actual["frames"], expected.frames, strict=True)):
            event = expected.events[index - 1] if index else None
            assert js == python, (case["name"], index, event)
        result = expected.public["result"]
        nominee = result["voteWinner"]
        if nominee not in expected.ids:
            nominee = expected.public["order"][0]
        expected_nominees = [nominee if frame["public"]["phase"] == "last_guess" else None for frame in expected.frames]
        assert actual["localGuessNominees"] == expected_nominees, case["name"]
