"""Server-side round rules. Serialize rounds through the public and private views."""

from collections import Counter
from copy import deepcopy
from dataclasses import dataclass
from math import isfinite
from random import SystemRandom
import re
from time import time_ns
from unicodedata import normalize


_DEFAULT_RNG = SystemRandom().random
_WORD_SPACES = "\t\n\v\f\r \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"
_SPACE_RUN = re.compile(f"[{_WORD_SPACES}]+")
_COMMON_FIELDS = (
    "clueRounds", "discussionSeconds", "clueStyle", "language", "hint",
    "categories", "subcategories", "levels",
)
_PROFILE_FIELDS = ("joker", "extraRole", "randomMin", "randomMax", "lastGuess")
_TERMINAL = {"reveal", "aborted"}
_ACTUAL_IMPOSTERS = {"imposter", "spy"}
_IMPOSTOR_TEAM = _ACTUAL_IMPOSTERS | {"accomplice", "double_agent"}
_CIVILS = {"civil", "guardian", "detective"}
_ACTION_PHASES = {
    "ack_role": "roles",
    "clue": "clues",
    "ability": "abilities",
    "end_discussion": "discussion",
    "vote": "voting",
    "guess": "last_guess",
}


class EngineError(ValueError):
    """A stable error code with optional per-profile validation details."""

    def __init__(self, code, issues=None):
        super().__init__(code)
        self.code = code
        self.issues = [] if issues is None else issues


@dataclass
class _Profile:
    settings: dict
    counts: list[int]
    candidate_words: list[dict]
    candidate_pairs: list
    requires_pair: bool
    weight: float


def _nonempty(value):
    return isinstance(value, str) and bool(value.strip(_WORD_SPACES))


def _whole(value):
    return type(value) is int or (
        type(value) is float and isfinite(value) and value.is_integer()
    )


def _strings(values):
    return isinstance(values, list) and all(_nonempty(value) for value in values)


def _valid_settings(settings, rules):
    for field in ("clueRounds", "discussionSeconds"):
        if not _whole(settings[field]) or settings[field] not in rules[field]:
            return False
    for field, options in (
        ("clueStyle", "clueStyles"), ("language", "languages"), ("hint", "hints"),
    ):
        if not isinstance(settings[field], str) or settings[field] not in rules[options]:
            return False
    for field in ("categories", "subcategories", "levels"):
        if not _strings(settings[field]):
            return False
    if not settings["levels"] or any(level not in rules["levels"] for level in settings["levels"]):
        return False
    if type(settings["joker"]) is not bool or type(settings["lastGuess"]) is not bool:
        return False
    extra = settings["extraRole"]
    return (extra is None or isinstance(extra, str) and extra in rules["extras"]) and all(
        settings[field] is None or _whole(settings[field]) for field in ("randomMin", "randomMax")
    )


def _content(settings, words, pairs):
    categories = set(settings["categories"])
    subcategories = set(settings["subcategories"])
    levels = set(settings["levels"])
    eligible = {}
    for word in words:
        if not isinstance(word, dict) or not _nonempty(word.get("id")):
            continue
        if categories and word.get("category") not in categories:
            continue
        if subcategories and word.get("subcategory") not in subcategories:
            continue
        if word.get("level") not in levels:
            continue
        languages = word.get("languages")
        translation = languages.get(settings["language"]) if isinstance(languages, dict) else None
        if not isinstance(translation, dict) or not _nonempty(translation.get("word")):
            continue
        hints = translation.get("hints")
        if not isinstance(hints, dict) or not _nonempty(hints.get(settings["hint"])):
            continue
        eligible.setdefault(word["id"], word)

    eligible_pairs = []
    seen = set()
    for pair in pairs:
        if not isinstance(pair, list) or len(pair) != 2 or not _strings(pair):
            continue
        first, second = pair
        if first == second or first not in eligible or second not in eligible:
            continue
        key = frozenset(pair)
        if key not in seen:
            eligible_pairs.append((eligible[first], eligible[second]))
            seen.add(key)
    return list(eligible.values()), eligible_pairs


def _counts(settings, count, rule, extra, rules):
    mode = settings["mode"]
    number = rule["imposters"]
    if mode == "all":
        return [count], None
    if mode == "reverse":
        return [count - 1], None
    if mode in {"none", "undercover"}:
        return [0], None

    joker_count = int(settings["joker"])
    extra_impostor = int(bool(extra and extra["team"] == "impostors" and not extra.get("replacesImposter")))
    minimum_civils = rules["jokerCivilMin"] if joker_count else 1
    possible = list(range(1, (count - 1) // 2 + 1)) if number == "random" else [number]
    counts = []
    for actual in possible:
        impostors = actual + extra_impostor
        civils = count - joker_count - impostors
        if civils > impostors and civils >= minimum_civils:
            counts.append(actual)
    if not counts:
        return [], "invalid_distribution"
    if number == "random":
        lower = settings["randomMin"] if settings["randomMin"] is not None else counts[0]
        upper = settings["randomMax"] if settings["randomMax"] is not None else counts[-1]
        if lower not in counts or upper not in counts or lower > upper:
            return [], "invalid_random_range"
        counts = [actual for actual in counts if lower <= actual <= upper]
    return counts, None


def _weight(value):
    if type(value) not in (int, float):
        return None
    try:
        value = float(value)
    except OverflowError:
        return None
    return value if isfinite(value) and value > 0 else None


def _prepare(raw_settings, player_count, words, pairs, rules):
    issues = []
    profiles = []

    def issue(code, mode):
        issues.append({"code": code, "mode": mode if isinstance(mode, str) else None})

    if not isinstance(raw_settings, dict):
        issue("invalid_settings", None)
        return issues, profiles, None
    settings = rules["defaults"] | raw_settings
    mode = settings["mode"]
    if not isinstance(mode, str) or mode not in rules["modes"]:
        issue("invalid_mode", mode)
        return issues, profiles, settings
    if not _valid_settings(settings, rules):
        issue("invalid_settings", mode)
        return issues, profiles, settings

    if mode == "chaos":
        if not _whole(player_count) or not rules["modes"][mode]["min"] <= player_count <= rules["playerMax"]:
            issue("player_count", mode)
        pool = settings["chaos"]
        if not isinstance(pool, list) or not pool:
            issue("chaos_empty", mode)
            return issues, profiles, settings
    else:
        pool = [raw_settings | {"mode": mode, "weight": 1}]

    candidate_words, candidate_pairs = _content(settings, words, pairs)
    for raw_profile in pool:
        if not isinstance(raw_profile, dict):
            issue("invalid_settings", None)
            continue
        profile_mode = raw_profile.get("mode")
        weight = _weight(raw_profile.get("weight"))
        if weight is None:
            issue("chaos_weight", profile_mode)
        if not isinstance(profile_mode, str) or profile_mode not in rules["modes"] or profile_mode == "chaos":
            issue("invalid_mode", profile_mode)
            continue
        if mode == "chaos" and any(
            field in raw_profile and raw_profile[field] != settings[field] for field in _COMMON_FIELDS
        ):
            issue("invalid_settings", profile_mode)
            continue
        options = settings | {field: raw_profile[field] for field in _PROFILE_FIELDS if field in raw_profile}
        options["mode"] = profile_mode
        if not _valid_settings(options, rules):
            issue("invalid_settings", profile_mode)
            continue
        rule = rules["modes"][profile_mode]
        extra = rules["extras"].get(options["extraRole"])
        options["joker"] = bool(options["joker"] or rule.get("forcedJoker"))
        count_ok = _whole(player_count) and rule["min"] <= player_count <= rules["playerMax"]
        if not count_ok:
            issue("player_count", profile_mode)
        if options["joker"]:
            if not rule.get("joker"):
                issue("joker_incompatible", profile_mode)
            if _whole(player_count) and player_count < rules["jokerMin"]:
                issue("joker_players", profile_mode)
        if extra:
            if profile_mode not in extra["modes"]:
                issue("extra_incompatible", profile_mode)
            if _whole(player_count) and player_count < extra["min"]:
                issue("extra_players", profile_mode)
        counts = []
        if count_ok:
            counts, error = _counts(options, int(player_count), rule, extra, rules)
            if error:
                issue(error, profile_mode)
        if options["lastGuess"] and not rule.get("lastGuess"):
            if mode != "chaos" or "lastGuess" in raw_profile:
                issue("last_guess_incompatible", profile_mode)
            options["lastGuess"] = False
        requires_pair = bool(rule.get("requiresPair") or (extra and extra.get("requiresPair")))
        if not candidate_words:
            issue("no_words", profile_mode)
        if requires_pair and not candidate_pairs:
            issue("no_pairs", profile_mode)
        profiles.append(_Profile(options, counts, candidate_words, candidate_pairs, requires_pair, weight))
    return issues, profiles, settings


def profile_issues(settings, player_count, words, pairs, rules):
    """Describe each invalid setting or pool profile before a round may start."""
    issues, _, _ = _prepare(settings, player_count, words, pairs, rules)
    return issues


def _choose(values, rng):
    return values[int(rng() * len(values))]


def _shuffle(values, rng):
    values = list(values)
    for index in range(len(values) - 1, 0, -1):
        swap = int(rng() * (index + 1))
        values[index], values[swap] = values[swap], values[index]
    return values


def _weighted(profiles, rng):
    largest = max(profile.weight for profile in profiles)
    weights = [profile.weight / largest for profile in profiles]
    total = 0.0
    for weight in weights:
        total += weight
    draw = rng() * total
    cumulative = 0.0
    for profile, weight in zip(profiles, weights):
        cumulative += weight
        if draw < cumulative:
            return profile
    return profiles[-1]


def _draw_content(profile, used, rng):
    recent = {word_id: index for index, word_id in enumerate(used)}
    if not profile.requires_pair:
        rank = min(recent.get(word["id"], -1) for word in profile.candidate_words)
        candidates = [word for word in profile.candidate_words if recent.get(word["id"], -1) == rank]
        return _choose(candidates, rng), None, rank != -1

    def pair_rank(pair):
        indexes = [recent.get(word["id"], -1) for word in pair]
        return sum(index != -1 for index in indexes), max(indexes), min(indexes)

    rank = min(map(pair_rank, profile.candidate_pairs))
    pair = _choose([pair for pair in profile.candidate_pairs if pair_rank(pair) == rank], rng)
    if rng() >= 0.5:
        pair = pair[::-1]
    return *pair, rank[0] > 0


def _assign_roles(deal, settings, imposters):
    roles = dict.fromkeys(deal, "civil")
    mode = settings["mode"]
    if mode == "undercover":
        roles[deal[0]] = "undercover"
    elif mode == "reverse":
        for player_id in deal[1:]:
            roles[player_id] = "imposter"
    else:
        for player_id in deal[:imposters]:
            roles[player_id] = "imposter"
        if settings["joker"]:
            roles[deal[imposters]] = "joker"
        extra = settings["extraRole"]
        if extra == "spy":
            roles[deal[0]] = extra
        elif extra:
            roles[deal[imposters + int(settings["joker"])]] = extra
    return roles


def _instant(now):
    if now is None:
        return time_ns() // 1_000_000
    if not _whole(now):
        raise EngineError("invalid_data")
    return int(now)


def _text(value, limit):
    if not isinstance(value, str):
        raise EngineError("invalid_text")
    value = value.strip(_WORD_SPACES)
    if not value or len(value) > limit:
        raise EngineError("invalid_text")
    return value


def _guess_key(text):
    return _SPACE_RUN.sub(" ", normalize("NFC", text).lower()).strip(" ")


def create_round(players, settings, words, pairs, rules, *, rng=None, used=None, now=None):
    """Validate and initialize one private round."""
    if not isinstance(players, list):
        raise EngineError("invalid_players")
    clean_players = []
    ids = set()
    for player in players:
        if (
            not isinstance(player, dict) or not _nonempty(player.get("id"))
            or not _nonempty(player.get("name"))
            or player["id"] in ids or player["id"] in rules["groupOptions"]
        ):
            raise EngineError("invalid_players")
        ids.add(player["id"])
        clean_players.append({"id": player["id"], "name": player["name"]})
    issues, profiles, selected = _prepare(settings, len(players), words, pairs, rules)
    if issues:
        raise EngineError(issues[0]["code"], issues)
    _instant(now)

    rng = _DEFAULT_RNG if rng is None else rng
    hidden = selected["mode"] == "chaos"
    profile = _weighted(profiles, rng) if hidden else profiles[0]
    mode = profile.settings["mode"]
    imposters = _choose(profile.counts, rng) if mode == "random" else profile.counts[0]
    word, paired, reused = _draw_content(profile, used or [], rng)
    player_ids = [player["id"] for player in clean_players]
    deal = _shuffle(player_ids, rng)
    roles = _assign_roles(deal, profile.settings, imposters)
    accomplice_knows = None
    if profile.settings["extraRole"] == "accomplice":
        accomplice_knows = _choose([player_id for player_id in deal if roles[player_id] in _ACTUAL_IMPOSTERS], rng)
    order = _shuffle(player_ids, rng)
    round_id = "round-" + "".join(f"{int(rng() * 2**32):08x}" for _ in range(4))

    offered = rules["modes"][mode].get("groupOption")
    if hidden:
        groups = rules["groupOptions"] if any(
            rules["modes"][item.settings["mode"]].get("groupOption") for item in profiles
        ) else []
    else:
        groups = [offered] if offered else []
    neutral_guess = hidden and any(item.settings["lastGuess"] for item in profiles)
    return Round(
        round_id, clean_players, selected["mode"], profile.settings, word, paired,
        reused, roles, accomplice_knows, order, groups, neutral_guess, rules,
    )


class Round:
    """State machine for one private round. The caller serializes actions per room."""

    def __init__(
        self, round_id, players, selected_mode, settings, word, paired, reused, roles,
        accomplice_knows, order, groups, neutral_guess, rules,
    ):
        self.phase = "roles"
        self._id = round_id
        self._players = players
        self._selected_mode = selected_mode
        self._settings = settings
        self._mode = settings["mode"]
        self._word = word
        self._paired = paired
        self._reused = reused
        self._roles = roles
        self._order = order
        self._groups = list(groups)
        self._rules = rules
        self._neutral_guess = neutral_guess
        self._abilities = selected_mode == "chaos" or bool(
            rules["extras"].get(settings["extraRole"], {}).get("ability")
        )
        self._cards = self._make_cards(accomplice_knows)
        self._roles_ready = set()
        self._abilities_ready = set()
        self._clue_round = 1
        self._clue_turn = 0
        self._clues = []
        self._paused = False
        self._deadline = None
        self._remaining = None
        self._votes = {}
        self._guard = None
        self._investigation = None
        self._vote_winner = None
        self._eliminated = None
        self._protected = None
        self._guess_player = None
        self._guess = None
        self._winner_team = None
        self._reason = None
        self._result = None

    def _translation(self, word):
        return word["languages"][self._settings["language"]]

    def _make_cards(self, accomplice_knows):
        word = self._translation(self._word)
        hint = None if self._mode == "blind" else word["hints"][self._settings["hint"]]
        alliance = [player["id"] for player in self._players if self._roles[player["id"]] in _ACTUAL_IMPOSTERS]
        cards = {}
        for player_id, role in self._roles.items():
            card = {"role": role, "word": None, "hint": None, "partners": []}
            if role in {"imposter", "accomplice"}:
                card["hint"] = hint
                if role == "accomplice":
                    card["partners"] = [accomplice_knows]
                elif self._mode == "alliance":
                    card["partners"] = [partner for partner in alliance if partner != player_id]
            else:
                paired_card = role in {"spy", "undercover"}
                card["word"] = self._translation(self._paired)["word"] if paired_card else word["word"]
                if self._mode == "undercover" or (self._selected_mode == "chaos" and role == "civil"):
                    card["role"] = None
            cards[player_id] = card
        return cards

    def public_state(self):
        """The only view that is safe to share with every player."""
        completed = {
            "roles": len(self._roles_ready),
            "abilities": len(self._abilities_ready),
            "voting": len(self._votes),
        }
        return {
            "id": self._id,
            "mode": self._selected_mode,
            "phase": self.phase,
            "players": deepcopy(self._players),
            "order": list(self._order),
            "clueStyle": self._settings["clueStyle"],
            "clueRounds": self._settings["clueRounds"],
            "discussionSeconds": self._settings["discussionSeconds"],
            "clueRound": self._clue_round if self.phase == "clues" else None,
            "currentPlayerId": self._order[self._clue_turn] if self.phase == "clues" else None,
            "clues": deepcopy(self._clues),
            "completed": completed.get(self.phase, 0),
            "options": self._vote_options() if self.phase == "voting" else [],
            "paused": self._paused,
            "deadline": self._deadline,
            "remainingMs": self._remaining,
            "result": deepcopy(self._result),
        }

    def private_state(self, player_id):
        """Information for exactly one known player."""
        self._check_player(player_id)
        role = self._roles[player_id]
        active = self.phase not in _TERMINAL
        return {
            "playerId": player_id,
            "card": deepcopy(self._cards[player_id]) if active else None,
            "roleReady": player_id in self._roles_ready,
            "abilityReady": player_id in self._abilities_ready,
            "voted": player_id in self._votes,
            "ability": role if self.phase == "abilities" and role in {"detective", "guardian"} else None,
            "investigation": deepcopy(self._investigation) if active and role == "detective" else None,
            "canGuess": self.phase == "last_guess" and player_id == self._guess_player and self._guess is None,
        }

    def _check_player(self, player_id):
        if not isinstance(player_id, str) or player_id not in self._roles:
            raise EngineError("unknown_player")

    def _vote_options(self):
        return [player["id"] for player in self._players] + self._groups

    def _enter(self, phase, now, seconds=0):
        self.phase = phase
        self._paused = False
        self._remaining = None
        self._deadline = now + int(seconds) * 1000 if seconds else None

    def _discussion(self, now):
        self._enter("discussion", now, self._settings["discussionSeconds"])

    def act(self, player_id, action, data=None, now=None):
        """Apply a single current-phase action from an identified player."""
        self._check_player(player_id)
        if not isinstance(action, str) or action not in _ACTION_PHASES and action != "abort":
            raise EngineError("unknown_action")
        if data is not None and not isinstance(data, dict):
            raise EngineError("invalid_data")
        data = {} if data is None else data
        now = _instant(now)
        self.tick(now)
        if self.phase in _TERMINAL:
            raise EngineError("wrong_phase")
        if action == "abort":
            self._enter("aborted", now)
            return True
        if self._paused:
            raise EngineError("paused")
        if self.phase != _ACTION_PHASES[action]:
            raise EngineError("wrong_phase")

        if action == "ack_role":
            self._confirm(player_id, self._roles_ready)
            if len(self._roles_ready) == len(self._players):
                self._enter("clues", now)
        elif action == "clue":
            self._submit_clue(player_id, data, now)
        elif action == "ability":
            self._submit_ability(player_id, data, now)
        elif action == "end_discussion":
            self._enter("voting", now)
        elif action == "vote":
            self._submit_vote(player_id, data, now)
        elif action == "guess":
            self._submit_guess(player_id, data, now)
        return True

    @staticmethod
    def _confirm(player_id, ready):
        if player_id in ready:
            raise EngineError("already_done")
        ready.add(player_id)

    def _submit_clue(self, player_id, data, now):
        if player_id != self._order[self._clue_turn]:
            raise EngineError("not_your_turn")
        if self._settings["clueStyle"] == "text":
            clue = _text(data.get("text"), self._rules["clueMaxLength"])
            self._clues.append({"playerId": player_id, "round": self._clue_round, "text": clue})
        self._clue_turn += 1
        if self._clue_turn < len(self._order):
            return
        self._clue_turn = 0
        if self._clue_round < self._settings["clueRounds"]:
            self._clue_round += 1
        elif self._abilities:
            self._enter("abilities", now)
        else:
            self._discussion(now)

    def _submit_ability(self, player_id, data, now):
        if player_id in self._abilities_ready:
            raise EngineError("already_done")
        target = data.get("targetId")
        role = self._roles[player_id]
        if target is not None:
            if (
                role not in {"detective", "guardian"} or not isinstance(target, str)
                or target not in self._roles or target == player_id
            ):
                raise EngineError("invalid_target")
            if role == "detective":
                self._investigation = {
                    "playerId": target, "impostorTeam": self._roles[target] in _IMPOSTOR_TEAM,
                }
            else:
                self._guard = target
        self._abilities_ready.add(player_id)
        if len(self._abilities_ready) == len(self._players):
            self._discussion(now)

    def _submit_vote(self, player_id, data, now):
        if player_id in self._votes:
            raise EngineError("already_done")
        target = data.get("targetId")
        if not isinstance(target, str) or target == player_id or target not in self._vote_options():
            raise EngineError("invalid_target")
        self._votes[player_id] = target
        if len(self._votes) == len(self._players):
            self._resolve_votes(now)

    def _resolve_votes(self, now):
        totals = Counter(self._votes.values())
        most = max(totals.values())
        leaders = [target for target, count in totals.items() if count == most]
        self._vote_winner = leaders[0] if len(leaders) == 1 else None
        if self._vote_winner in self._roles:
            if self._vote_winner == self._guard:
                self._protected = self._guard
            else:
                self._eliminated = self._vote_winner

        role = self._roles.get(self._eliminated)
        if role == "joker":
            self._winner_team, self._reason = "joker", "joker_eliminated"
        elif self._mode in {"all", "none"}:
            correct = self._vote_winner == self._rules["modes"][self._mode]["groupOption"]
            self._winner_team = "all" if correct else "none"
            self._reason = f"{self._mode}_{'correct' if correct else 'missed'}"
        elif self._mode == "reverse":
            if role == "civil":
                self._winner_team, self._reason = "impostors", "reverse_civil_eliminated"
            else:
                self._winner_team, self._reason = "civils", "reverse_civil_survived"
        elif self._mode == "undercover":
            if role == "undercover":
                self._winner_team, self._reason = "civils", "undercover_eliminated"
            else:
                self._winner_team, self._reason = "impostors", "undercover_survived"
        elif role in _ACTUAL_IMPOSTERS:
            self._winner_team, self._reason = "civils", "imposter_eliminated"
            if self._settings["lastGuess"]:
                self._guess_player = self._eliminated
        else:
            self._winner_team, self._reason = "impostors", "imposter_survived"

        if self._guess_player is not None or self._neutral_guess:
            self._enter("last_guess", now, self._rules["guessSeconds"])
        else:
            self._reveal(now)

    def _submit_guess(self, player_id, data, now):
        if player_id != self._guess_player:
            raise EngineError("not_your_turn")
        if self._guess is not None:
            raise EngineError("already_done")
        value = data.get("text")
        text = _text(value, self._rules["guessMaxLength"]) if value is not None else None
        if text is None:
            self._finish_guess(None, False, "guess_timeout")
        else:
            word = self._translation(self._word)
            accepted = {_guess_key(candidate) for candidate in [word["word"], *word.get("aliases", [])]}
            correct = _guess_key(text) in accepted
            self._finish_guess(text, correct, "guess_correct" if correct else "guess_wrong")
        if not self._neutral_guess:
            self._reveal(now)

    def _finish_guess(self, text, correct, reason):
        self._guess = {"playerId": self._guess_player, "text": text, "correct": correct}
        self._winner_team = "impostors" if correct else "civils"
        self._reason = reason

    def _reveal(self, now):
        winner_roles = {
            "civils": _CIVILS,
            "impostors": _IMPOSTOR_TEAM | {"undercover"},
            "joker": {"joker"},
            "none": set(),
        }
        winners = [
            player["id"] for player in self._players
            if self._winner_team == "all" or self._roles[player["id"]] in winner_roles[self._winner_team]
        ]
        points = self._rules["jokerPoints"] if self._winner_team == "joker" else self._rules["teamPoints"]
        self._result = {
            "id": self._id,
            "mode": self._mode,
            "selectedMode": self._selected_mode,
            "wordId": self._word["id"],
            "word": self._translation(self._word)["word"],
            "pairedWordId": self._paired["id"] if self._paired else None,
            "pairedWord": self._translation(self._paired)["word"] if self._paired else None,
            "category": self._word["category"],
            "reused": self._reused,
            "roles": {player["id"]: self._roles[player["id"]] for player in self._players},
            "votes": {player["id"]: self._votes[player["id"]] for player in self._players},
            "voteWinner": self._vote_winner,
            "eliminated": self._eliminated,
            "protected": self._protected,
            "winners": winners,
            "winnerTeam": self._winner_team,
            "reason": self._reason,
            "guess": self._guess,
            "points": {player["id"]: points if player["id"] in winners else 0 for player in self._players},
        }
        self._enter("reveal", now)

    def tick(self, now=None):
        now = _instant(now)
        if self._paused or self._deadline is None or now < self._deadline:
            return False
        if self.phase == "discussion":
            self._enter("voting", now)
        elif self.phase == "last_guess":
            if self._guess_player is not None and self._guess is None:
                self._finish_guess(None, False, "guess_timeout")
            self._reveal(now)
        return True

    def pause(self, now=None):
        now = _instant(now)
        if self._paused or self.phase in _TERMINAL:
            return False
        changed = self.tick(now)
        if self.phase in _TERMINAL:
            return changed
        self._paused = True
        self._remaining = self._deadline - now if self._deadline is not None else None
        self._deadline = None
        return True

    def resume(self, now=None):
        now = _instant(now)
        if not self._paused:
            return False
        self._paused = False
        self._deadline = now + self._remaining if self._remaining is not None else None
        self._remaining = None
        return True
