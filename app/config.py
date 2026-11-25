from __future__ import annotations

import os
from pathlib import Path

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
    return {
        "APP_NAME": os.getenv("APP_NAME", "Imposter Party"),
        "SLOGANS": {"sv": "Lita inte på någon", "en": "Trust no one"},
        "DATA_DIR": ROOT / "data",
    }
