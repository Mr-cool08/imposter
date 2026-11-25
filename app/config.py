from __future__ import annotations

import os
from pathlib import Path
from secrets import token_urlsafe
from urllib.parse import urlsplit

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent


def env_int(name: str, default: int, *, minimum: int = 1) -> int:
    value = int(os.getenv(name, default))
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    return value


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be true or false")


def load_config() -> dict:
    load_dotenv(ROOT / ".env")
    public_origin = os.getenv("PUBLIC_ORIGIN", "").strip().rstrip("/")
    if public_origin:
        url = urlsplit(public_origin)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username is not None
            or url.path
            or url.query
            or url.fragment
        ):
            raise ValueError("PUBLIC_ORIGIN must be an HTTP or HTTPS origin without a path.")

    max_packet = env_int("ONLINE_MAX_PACKET_BYTES", 196608, minimum=4096)
    max_custom = env_int("ONLINE_MAX_CUSTOM_BYTES", 131072, minimum=1024)
    if max_custom >= max_packet:
        raise ValueError("ONLINE_MAX_CUSTOM_BYTES must be smaller than ONLINE_MAX_PACKET_BYTES")
    return {
        "SECRET_KEY": os.getenv("SECRET_KEY") or token_urlsafe(32),
        "APP_NAME": os.getenv("APP_NAME", "Imposter Party"),
        "SLOGANS": {"sv": "Lita inte på någon", "en": "Trust no one"},
        "DATA_DIR": ROOT / "data",
        "PUBLIC_ORIGIN": public_origin,
        "TRUSTED_HOSTS": os.getenv("TRUSTED_HOSTS", "").split() or None,
        "PROXY_HOPS": env_int("PROXY_HOPS", 0, minimum=0),
        "SESSION_COOKIE_HTTPONLY": True,
        "SESSION_COOKIE_SAMESITE": "Lax",
        "SESSION_COOKIE_SECURE": public_origin.startswith("https:"),
        "MAX_CONTENT_LENGTH": max_packet,
        "ONLINE_MAX_PACKET_BYTES": max_packet,
        "ONLINE_MAX_CUSTOM_BYTES": max_custom,
        "ONLINE_MAX_ROOMS": env_int("ONLINE_MAX_ROOMS", 5),
        "ONLINE_ROOM_TTL_SECONDS": env_int("ONLINE_ROOM_TTL_SECONDS", 7200),
        "ONLINE_HISTORY_LIMIT": env_int("ONLINE_HISTORY_LIMIT", 30),
    }
