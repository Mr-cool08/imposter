from __future__ import annotations

import json
from pathlib import Path

from flask import Flask
from flask_socketio import SocketIO
from werkzeug.middleware.proxy_fix import ProxyFix

from .config import load_config


def create_app(config: dict | None = None) -> Flask:
    from .content import ContentCatalog
    from .routes import register_routes
    from .socket_events import register_socket_events

    app = Flask(__name__)
    app.config.from_mapping(load_config())
    if config is not None:
        app.config.update(config)
    if app.config["PROXY_HOPS"]:
        hops = app.config["PROXY_HOPS"]
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=hops)

    data_dir = Path(app.config["DATA_DIR"])
    app.extensions["content_catalog"] = ContentCatalog.load(data_dir)
    app.extensions["game_rules"] = json.loads((data_dir / "rules.json").read_text(encoding="utf-8"))
    app.json.ensure_ascii = False
    app.json.sort_keys = False
    register_routes(app, data_dir)

    socketio = SocketIO(
        app,
        async_mode="threading",
        manage_session=False,
        max_http_buffer_size=app.config["ONLINE_MAX_PACKET_BYTES"],
    )
    register_socket_events(socketio, app)
    return app
