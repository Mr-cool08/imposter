"""Trådsäker, tillfällig rumsstatus för den enskilda serverprocessen."""

from __future__ import annotations

from collections import OrderedDict, deque
from dataclasses import dataclass, field
from hashlib import sha256
from hmac import compare_digest
from secrets import choice, token_urlsafe
from threading import Lock
from time import time_ns

from .engine import create_round, profile_issues


CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
CODE_LENGTH = 5
PLAYER_LIMIT = 20
CHAT_LIMIT = 60
REQUEST_LIMIT = 128
IMPOSTOR_ROLES = {"imposter", "spy", "accomplice", "double_agent"}


class RoomError(ValueError):
    def __init__(self, code, *, issues=None):
        super().__init__(code)
        self.code = code
        self.issues = issues


def unix_ms():
    return time_ns() // 1_000_000


def token_digest(token):
    return sha256(token.encode("ascii")).digest()


@dataclass
class Member:
    id: str
    name: str
    sid: str | None
    digest: bytes = field(repr=False)
    ready: bool = False
    departed: bool = False
    last_chat_at: int | None = None
    requests: OrderedDict = field(default_factory=OrderedDict, repr=False)

    @classmethod
    def connect(cls, name, sid, *, ready=False):
        token = token_urlsafe(32)
        return cls(token_urlsafe(9), name, sid, token_digest(token), ready), token

    def known_request(self, key, operation):
        if key not in self.requests:
            return False
        if self.requests[key] != operation:
            raise RoomError("request_conflict")
        self.requests.move_to_end(key)
        return True

    def remember_request(self, key, operation):
        self.requests[key] = operation
        if len(self.requests) > REQUEST_LIMIT:
            self.requests.popitem(last=False)


@dataclass
class Connection:
    lock: Lock = field(default_factory=Lock, repr=False)
    room_code: str | None = None
    player_id: str | None = None
    closed: bool = False


@dataclass
class Score:
    id: str
    name: str
    points: int = 0
    played: int = 0
    wins: int = 0
    imposter_games: int = 0
    imposter_wins: int = 0
    by_role: dict = field(default_factory=dict)
    by_mode: dict = field(default_factory=dict)

    def record(self, result):
        role = result["roles"][self.id]
        won = self.id in result["winners"]
        self.played += 1
        self.wins += won
        self.points += result["points"][self.id]
        if role in IMPOSTOR_ROLES:
            self.imposter_games += 1
            self.imposter_wins += won
        for breakdown, key in ((self.by_role, role), (self.by_mode, result["mode"])):
            entry = breakdown.setdefault(key, {"played": 0, "wins": 0})
            entry["played"] += 1
            entry["wins"] += won

    def snapshot(self):
        return {
            "id": self.id,
            "name": self.name,
            "points": self.points,
            "played": self.played,
            "wins": self.wins,
            "imposterGames": self.imposter_games,
            "imposterWins": self.imposter_wins,
            "byRole": self.by_role,
            "byMode": self.by_mode,
        }


class Room:
    """Alla ändringar och projektioner efter skapandet sker under rummets lås."""

    def __init__(self, host, catalog, rules, settings, custom, now, history_limit):
        self.code = ""
        self.lock = Lock()
        self.closed = False
        self.revision = 0
        self.last_activity = now
        self.members = {host.id: host}
        self.host_id = host.id
        self.catalog = catalog
        self.rules = rules
        self.settings = {}
        self.custom = None
        self.selection = None
        self._issues_by_player_count = {}
        self.configure(settings, custom)
        self.round = None
        self.round_id = None
        self.round_players = []
        self.active_ids = set()
        self.pause_reason = None
        self.aborted_id = None
        self.scored_id = None
        self.chat = deque(maxlen=CHAT_LIMIT)
        self.history = deque(maxlen=history_limit)
        self.scores = {}
        self.used = {}

    @property
    def playing(self):
        return self.round is not None and self.round.phase != "reveal"

    def identity(self, player_id, sid):
        member = self.members.get(player_id)
        return member if member and member.sid == sid else None

    def available(self):
        return [member for member in self.members.values() if member.sid is not None]

    def missing_participants(self):
        return any(self.members[player_id].sid is None for player_id in self.active_ids)

    def configure(self, settings, custom):
        self.selection = self.catalog.select(settings, custom=custom)
        self.settings = settings
        self.custom = custom
        self._issues_by_player_count.clear()

    def issues(self, count):
        if count not in self._issues_by_player_count:
            self._issues_by_player_count[count] = profile_issues(
                self.settings, count, self.selection["words"], self.selection["pairs"], self.rules,
            )
        return self._issues_by_player_count[count]

    def add(self, name, sid):
        if len(self.members) >= PLAYER_LIMIT:
            raise RoomError("room_full")
        member, token = Member.connect(name, sid)
        self.members[member.id] = member
        self.elect_host_if_missing()
        return member, token

    def find_token(self, token):
        digest = token_digest(token)
        for member in self.members.values():
            if not member.departed and compare_digest(member.digest, digest):
                return member
        raise RoomError("invalid_token")

    def restore(self, member, sid):
        old_sid = member.sid
        member.sid = sid
        self.elect_host_if_missing()
        return old_sid

    def elect_host_if_missing(self):
        host = self.members.get(self.host_id)
        host_connected = host is not None and host.sid is not None
        if host_connected and (not self.playing or self.host_id in self.active_ids):
            return
        available = self.available()
        if not available:
            return
        active = next((member for member in available if member.id in self.active_ids), None)
        if active is not None:
            self.host_id = active.id
        elif not host_connected:
            self.host_id = available[0].id

    def lose(self, member, *, leave, now):
        member.sid = None
        if leave or not self.playing:
            member.ready = False
        if leave:
            member.departed = True
            self.discard_departed()
        if self.playing and member.id in self.active_ids:
            self.round.pause(now)
            self.pause_reason = "connection"
        if member.id == self.host_id:
            self.elect_host_if_missing()

    def discard_departed(self):
        for member in list(self.members.values()):
            if member.departed and (not self.playing or member.id not in self.active_ids):
                del self.members[member.id]

    def start(self, now):
        available = self.available()
        issues = self.issues(len(available))
        if issues:
            raise RoomError("invalid_settings", issues=issues)
        if any(not member.ready for member in available if member.id != self.host_id):
            raise RoomError("players_not_ready")
        players = [{"id": member.id, "name": member.name} for member in available]
        self.round = create_round(
            players, self.settings, self.selection["words"], self.selection["pairs"], self.rules,
            used=list(self.used), now=now,
        )
        self.round_id = self.round.public_state()["id"]
        self.round_players = players
        self.active_ids = {player["id"] for player in players}
        self.chat.clear()
        for member in available:
            member.last_chat_at = None
        self.aborted_id = None
        self.pause_reason = None

    def abort(self, now):
        self.round.act(self.round_players[0]["id"], "abort", {}, now)
        self.aborted_id = self.round_id
        self.round = None
        self.round_id = None
        self.round_players = []
        self.active_ids.clear()
        self.chat.clear()
        self.pause_reason = None
        self.discard_departed()

    def settle(self):
        if self.round is None or self.round.phase != "reveal":
            return
        result = self.round.public_state()["result"]
        if result["id"] == self.scored_id:
            return
        for player in self.round_players:
            score = self.scores.setdefault(player["id"], Score(player["id"], player["name"]))
            score.record(result)
        self.history.appendleft({**result, "players": self.round_players})
        for word_id in (result["wordId"], result["pairedWordId"]):
            if word_id is not None:
                self.used.pop(word_id, None)
                self.used[word_id] = None
        self.scored_id = result["id"]
        self.pause_reason = None
        self.discard_departed()

    def advance(self, now):
        if not self.playing or not self.round.tick(now):
            return False
        self.settle()
        return True

    def snapshots(self, now, *, only=None):
        round_state = self.round.public_state() if self.round is not None else None
        stage = "playing" if self.playing else "result" if round_state is not None else "lobby"
        available = self.available()
        players = [
            {
                "id": member.id,
                "name": member.name,
                "ready": member.ready or member.id == self.host_id,
                "connected": member.sid is not None,
                "waiting": self.playing and member.id not in self.active_ids,
            }
            for member in self.members.values()
        ]
        ranks = [self.scores.get(member.id) or Score(member.id, member.name) for member in self.members.values()]
        ranks.extend(score for player_id, score in self.scores.items() if player_id not in self.members)
        ranks.sort(key=lambda score: (-score.points, -score.wins, score.name.casefold()))
        shared = {
            "code": self.code,
            "hostId": self.host_id,
            "revision": self.revision,
            "serverNow": now,
            "stage": stage,
            "players": players,
            "pauseReason": self.pause_reason,
            "aborted": self.aborted_id,
            "settings": self.settings,
            "selection": {key: len(value) for key, value in self.selection.items()},
            "issues": self.issues(len(available)),
            "customCategories": self.custom["categories"] if self.custom else [],
            "round": round_state,
            "history": list(self.history),
            "scores": [score.snapshot() for score in ranks],
        }
        for member in available:
            if only is not None and member.sid != only:
                continue
            participant = member.id in self.active_ids
            private = self.round.private_state(member.id) if self.round is not None and participant else None
            yield member.sid, {
                **shared,
                "playerId": member.id,
                "private": private,
                "chat": list(self.chat) if participant else [],
            }


class RoomDirectory:
    """Registret används kort under eget lås och väntar aldrig på ett rumslås."""

    def __init__(self, socketio, app):
        self.socketio = socketio
        self.app = app
        self.catalog = app.extensions["content_catalog"]
        self.rules = app.extensions["game_rules"]
        self.clock = unix_ms
        self.max_rooms = app.config["ONLINE_MAX_ROOMS"]
        self.ttl_ms = app.config["ONLINE_ROOM_TTL_SECONDS"] * 1000
        self.sweep_interval = app.config.get("ONLINE_SWEEP_INTERVAL_SECONDS", 0.5)
        self.history_limit = app.config.get("ONLINE_HISTORY_LIMIT", 30)
        self.lock = Lock()
        self.rooms = {}
        self.connections = {}
        self.worker = None

    def connect(self, sid):
        with self.lock:
            self.connections[sid] = Connection()
            if self.sweep_interval and self.worker is None:
                self.worker = self.socketio.start_background_task(self._run)

    def connection(self, sid):
        with self.lock:
            return self.connections.get(sid)

    def disconnect(self, sid):
        with self.lock:
            connection = self.connections.pop(sid, None)
        if connection is None:
            return
        with connection.lock:
            connection.closed = True
            room = self.lookup(connection.room_code)
            if room is None:
                return
            with room.lock:
                member = room.identity(connection.player_id, sid)
                now = self.clock()
                if member is not None and self.live(room, now):
                    room.advance(now)
                    room.lose(member, leave=False, now=now)
                    self.publish(room, now)

    def lookup(self, code):
        with self.lock:
            return self.rooms.get(code)

    def find(self, code):
        room = self.lookup(code)
        if room is None:
            raise RoomError("room_not_found")
        return room

    def create(self, sid, name, settings, custom, now):
        member, token = Member.connect(name, sid, ready=True)
        room = Room(member, self.catalog, self.rules, settings, custom, now, self.history_limit)
        with self.lock:
            if len(self.rooms) >= self.max_rooms:
                raise RoomError("server_full")
            while not room.code or room.code in self.rooms:
                room.code = "".join(choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            self.rooms[room.code] = room
        return room, member, token

    def publish(self, room, now, *, only=None):
        room.last_activity = now
        if only is None:
            room.revision += 1
        for sid, state in room.snapshots(now, only=only):
            self.socketio.emit("room:state", state, to=sid)

    def close(self, room, *, expired=False):
        room.closed = True
        with self.lock:
            if self.rooms.get(room.code) is room:
                del self.rooms[room.code]
        if expired:
            for member in room.available():
                self.socketio.emit("room:expired", {"code": room.code}, to=member.sid)

    def live(self, room, now):
        if not room.closed and now - room.last_activity >= self.ttl_ms:
            self.close(room, expired=True)
        return not room.closed

    def sweep(self):
        with self.lock:
            rooms = list(self.rooms.values())
        for room in rooms:
            with room.lock:
                now = self.clock()
                if self.live(room, now) and room.advance(now):
                    self.publish(room, now)

    def _run(self):
        while True:
            self.socketio.sleep(self.sweep_interval)
            try:
                self.sweep()
            except Exception:
                self.app.logger.exception("Online room maintenance failed")
