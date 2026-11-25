from __future__ import annotations

import json
from pathlib import Path

from flask import Flask

from .config import load_config


def create_app(config: dict | None = None) -> Flask:
    from .content import ContentCatalog
    from .routes import register_routes

    app = Flask(__name__)
    app.config.from_mapping(load_config())
    if config is not None:
        app.config.update(config)

    data_dir = Path(app.config["DATA_DIR"])
    app.extensions["content_catalog"] = ContentCatalog.load(data_dir)
    app.extensions["game_rules"] = json.loads((data_dir / "rules.json").read_text(encoding="utf-8"))
    app.json.ensure_ascii = False
    app.json.sort_keys = False
    register_routes(app, data_dir)
    return app
