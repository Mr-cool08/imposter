"""Socket.IO-gränssnitt för onlinespel."""

from __future__ import annotations

import json
import re
from unicodedata import category

from flask import request

from .game.engine import EngineError
from .game.rooms import CODE_ALPHABET, CODE_LENGTH, RoomDirectory, RoomError


CODE_PATTERN = re.compile(f"[{CODE_ALPHABET}]{{{CODE_LENGTH}}}", re.ASCII)
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}", re.ASCII)
REQUEST_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}", re.ASCII)
MAX_NAME_LENGTH = 32
MAX_CHAT_LENGTH = 280

SETTINGS_TYPES = {
    "mode": (str,),
    "joker": (bool,),
    "extraRole": (str, type(None)),
    "randomMin": (int, type(None)),
    "randomMax": (int, type(None)),
    "lastGuess": (bool,),
    "clueRounds": (int,),
    "discussionSeconds": (int,),
    "clueStyle": (str,),
    "language": (str,),
    "hint": (str,),
    "categories": (list,),
    "subcategories": (list,),
    "levels": (list,),
}

ACTION_FIELDS = {
    "ack_role": (),
    "clue": ("text",),
    "ability": ("targetId",),
    "end_discussion": (),
    "vote": ("targetId",),
    "guess": ("text",),
}

EVENT_FIELDS = {
    "create": (("name",), ("settings", "custom")),
    "join": (("code", "name"), ()),
    "reconnect": (("code", "token"), ()),
    "leave": ((), ()),
    "ready": (("ready",), ()),
    "settings": (("settings",), ("custom",)),
    "start": (("roundId", "requestId"), ()),
    "action": (("roundId", "requestId", "action", "data"), ()),
    "pause": (("roundId", "requestId"), ()),
    "resume": (("roundId", "requestId"), ()),
    "abort": (("roundId", "requestId"), ()),
    "chat": (("roundId", "requestId", "text"), ()),
    "reset_scores": ((), ()),
    "clear_history": ((), ()),
}
HOST_EVENTS = {"settings", "start", "pause", "resume", "abort", "reset_scores", "clear_history"}
ROUND_MUTATIONS = {"action", "pause", "resume", "abort", "chat"}


def _json_size(value):
    try:
        return len(json.dumps(value, allow_nan=False, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    except (ValueError, TypeError, RecursionError) as error:
        raise RoomError("bad_payload") from error


def _fields(value, required=(), optional=()):
    return (
        isinstance(value, dict)
        and all(key in value for key in required)
        and all(key in required or key in optional for key in value)
    )


def _is_visible_text(value):
    return (
        any(character.isprintable() and not character.isspace() for character in value)
        and all(category(character) not in {"Cc", "Cs"} for character in value)
    )


def _text(value, max_length, error_code):
    if not isinstance(value, str):
        raise RoomError(error_code)
    value = value.strip()
    if not value or len(value) > max_length or not _is_visible_text(value):
        raise RoomError(error_code)
    return value


def _settings(value, *, profile=False):
    types = SETTINGS_TYPES | ({"weight": (int, float)} if profile else {"chaos": (list,)})
    if not isinstance(value, dict):
        raise RoomError("invalid_settings")
    for key, item in value.items():
        if key not in types or type(item) not in types[key]:
            raise RoomError("invalid_settings")
        if key == "chaos":
            if len(item) > 64:
                raise RoomError("invalid_settings")
            for entry in item:
                _settings(entry, profile=True)
        elif isinstance(item, list):
            if len(item) > 512 or any(not isinstance(entry, str) or len(entry) > 100 for entry in item):
                raise RoomError("invalid_settings")
        elif isinstance(item, str) and len(item) > 100:
            raise RoomError("invalid_settings")
    return value


def _custom(value, directory, max_bytes):
    if value is None:
        return None
    if _json_size(value) > max_bytes:
        raise RoomError("too_large")
    try:
        return directory.catalog.validate_custom(value)
    except ValueError as error:
        raise RoomError("invalid_custom") from error


def _current_member(directory, room, player_id, sid, now):
    if not directory.live(room, now):
        raise RoomError("room_not_found")
    member = room.identity(player_id, sid)
    if member is None:
        raise RoomError("not_in_room")
    return member


def _ack(room, member, token):
    return {"ok": True, "code": room.code, "playerId": member.id, "token": token}


def _enter(directory, event, body, connection, sid, custom_limit):
    previous = directory.lookup(connection.room_code)
    if previous is not None:
        with previous.lock:
            if directory.live(previous, directory.clock()) and previous.identity(connection.player_id, sid):
                raise RoomError("already_bound")
    connection.room_code, connection.player_id = None, None

    if event == "create":
        name = _text(body["name"], MAX_NAME_LENGTH, "bad_name")
        settings = _settings(body.get("settings", {}))
        custom = _custom(body.get("custom"), directory, custom_limit)
        room, member, token = directory.create(sid, name, settings, custom, directory.clock())
        with room.lock:
            connection.room_code, connection.player_id = room.code, member.id
            directory.publish(room, directory.clock())
        return _ack(room, member, token)

    value = body["code"]
    if not isinstance(value, str) or not value.isascii() or not CODE_PATTERN.fullmatch(code := value.strip().upper()):
        raise RoomError("bad_code")
    room = directory.find(code)
    with room.lock:
        now = directory.clock()
        if not directory.live(room, now):
            raise RoomError("room_not_found")
        if room.advance(now):
            directory.publish(room, now)
        if event == "join":
            name = _text(body["name"], MAX_NAME_LENGTH, "bad_name")
            member, token = room.add(name, sid)
        else:
            token = body["token"]
            if not isinstance(token, str) or not TOKEN_PATTERN.fullmatch(token):
                raise RoomError("invalid_token")
            member = room.find_token(token)
            old_sid = room.restore(member, sid)
            if old_sid is not None:
                directory.socketio.emit("room:replaced", {"code": room.code}, to=old_sid)
        connection.room_code, connection.player_id = room.code, member.id
        directory.publish(room, now)
    return _ack(room, member, token)


def _round_command(room, member, event, body, now):
    if event == "start":
        if room.playing:
            raise RoomError("wrong_phase")
        room.start(now)
    elif event == "abort":
        room.abort(now)
    elif event == "pause":
        if room.round.pause(now):
            room.pause_reason = "host"
    elif event == "resume":
        if room.missing_participants():
            raise RoomError("players_offline")
        if room.round.resume(now):
            room.pause_reason = None
    elif member.id not in room.active_ids:
        raise RoomError("waiting")
    elif room.pause_reason is not None:
        raise RoomError("paused")
    elif event == "chat":
        _chat(room, member, body["text"], now)
    else:
        _action(room, member, body, now)


def _chat(room, member, value, now):
    state = room.round.public_state()
    if room.round.phase != "discussion" or state["clueStyle"] != "text":
        raise RoomError("wrong_phase")
    text = _text(value, MAX_CHAT_LENGTH, "bad_text")
    if member.last_chat_at is not None and now - member.last_chat_at < 400:
        raise RoomError("chat_rate")
    member.last_chat_at = now
    room.chat.append({
        "id": f"{state['id']}-{room.revision}",
        "playerId": member.id,
        "name": member.name,
        "text": text,
        "at": now,
    })


def _action(room, member, body, now):
    action, data = body["action"], body["data"]
    if not isinstance(action, str) or action not in ACTION_FIELDS or not _fields(data, optional=ACTION_FIELDS[action]):
        raise RoomError("invalid_action")
    if action == "end_discussion" and member.id != room.host_id:
        raise RoomError("not_host")
    for key, value in data.items():
        if value is not None and (not isinstance(value, str) or len(value) > 300):
            raise RoomError("invalid_action")
        if key == "text" and value is not None and not _is_visible_text(value.strip()):
            raise RoomError("invalid_action")
    room.round.act(member.id, action, data, now)


def _handle(directory, event, body, connection, sid, custom_limit):
    if connection.room_code is None:
        raise RoomError("not_in_room")
    room = directory.find(connection.room_code)
    with room.lock:
        now = directory.clock()
        member = _current_member(directory, room, connection.player_id, sid, now)
        if room.advance(now):
            directory.publish(room, now)
        round_command = event in ROUND_MUTATIONS or event == "start"
        if round_command:
            key = body["requestId"]
            if not isinstance(key, str) or not REQUEST_PATTERN.fullmatch(key):
                raise RoomError("bad_payload")
            operation = (event, body)
            if member.known_request(key, operation):
                return {"ok": True}
        if event in HOST_EVENTS and member.id != room.host_id:
            raise RoomError("not_host")

        only = None
        if round_command:
            if body["roundId"] != room.round_id:
                raise RoomError("wrong_round")
            if event != "start" and not room.playing:
                raise RoomError("not_playing")
            before_guess = (
                room.round.public_state()
                if event == "action" and body["action"] == "guess"
                else None
            )
            _round_command(room, member, event, body, now)
            member.remember_request(key, operation)
            room.settle()
            if before_guess is not None and before_guess == room.round.public_state():
                # A neutral Chaos guess must not leave a public notification or revision gap.
                only = sid
        elif event == "ready":
            if not isinstance(body["ready"], bool):
                raise RoomError("bad_payload")
            if member.ready == body["ready"]:
                return {"ok": True}
            member.ready = body["ready"]
        elif event == "leave":
            room.lose(member, leave=True, now=now)
            connection.room_code, connection.player_id = None, None
            if all(member.departed for member in room.members.values()):
                directory.close(room)
                return {"ok": True}
        else:
            if room.playing:
                raise RoomError("wrong_phase")
            if event == "settings":
                settings = _settings(body["settings"])
                custom = _custom(body["custom"], directory, custom_limit) if "custom" in body else room.custom
                room.configure(settings, custom)
            elif event == "reset_scores":
                room.scores.clear()
            elif event == "clear_history":
                room.history.clear()
        directory.publish(room, now, only=only)
    return {"ok": True}


def register_socket_events(socketio, app):
    directory = RoomDirectory(socketio, app)
    app.extensions["online_rooms"] = directory
    packet_limit = app.config["ONLINE_MAX_PACKET_BYTES"]
    custom_limit = app.config["ONLINE_MAX_CUSTOM_BYTES"]

    @socketio.on("connect")
    def connect(auth=None):
        directory.connect(request.sid)

    @socketio.on("disconnect")
    def disconnect(reason=None):
        directory.disconnect(request.sid)

    def make_handler(event, required, optional):
        def handle(body=None, *extra):
            try:
                if body is None and not required:
                    body = {}
                if extra or not _fields(body, required, optional):
                    raise RoomError("bad_payload")
                if _json_size(body) > packet_limit:
                    raise RoomError("too_large")
                sid = request.sid
                connection = directory.connection(sid)
                if connection is None:
                    raise RoomError("not_in_room")
                with connection.lock:
                    if connection.closed:
                        raise RoomError("not_in_room")
                    if event in {"create", "join", "reconnect"}:
                        return _enter(directory, event, body, connection, sid, custom_limit)
                    return _handle(directory, event, body, connection, sid, custom_limit)
            except RoomError as error:
                detail = {"code": error.code}
                if error.issues is not None:
                    detail["issues"] = error.issues
                return {"ok": False, "error": detail}
            except EngineError as error:
                if event == "start":
                    return {"ok": False, "error": {"code": "invalid_settings", "issues": error.issues}}
                return {"ok": False, "error": {"code": "invalid_action"}}

        return handle

    for event, (required, optional) in EVENT_FIELDS.items():
        socketio.on_event(f"room:{event}", make_handler(event, required, optional))
