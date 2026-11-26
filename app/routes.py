from __future__ import annotations

import json
from pathlib import Path

from flask import abort, jsonify, render_template, send_file

def read_translations(data_dir: Path) -> dict:
    messages = {}
    for source in sorted((data_dir / "i18n").glob("*.sv.json")):
        fragment = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(fragment, dict) or any(not isinstance(value, str) for value in fragment.values()):
            raise ValueError(f"Translation fragment {source.name} must map keys to strings")
        duplicate = messages.keys() & fragment.keys()
        if duplicate:
            raise ValueError(f"Repeated translation keys in {source.name}: {', '.join(sorted(duplicate))}")
        messages.update(fragment)
    return messages


def register_routes(app, data_dir: Path) -> None:
    catalog = app.extensions["content_catalog"]
    translations = read_translations(data_dir)

    @app.after_request
    def headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    @app.get("/")
    def home():
        return render_template(
            "index.html",
            app_name=app.config["APP_NAME"],
            slogan=app.config["SLOGANS"]["sv"],
        )

    @app.get("/healthz")
    def health():
        return jsonify(status="ok", contentVersion=catalog.version)

    @app.get("/api/content/manifest")
    def content_manifest():
        return jsonify(version=catalog.version, categories=catalog.categories)

    @app.get("/api/content/packs/<category>.json")
    def content_pack(category):
        try:
            pack = catalog.pack(category)
        except KeyError:
            abort(404)
        if pack is None:
            abort(404)
        return jsonify(pack)

    @app.get("/api/content/rules")
    def content_rules():
        return jsonify(app.extensions["game_rules"])

    @app.get("/api/i18n/sv.json")
    def i18n():
        return jsonify(translations)

    @app.get("/sw.js")
    def retire_worker():
        # Keep the old URL so existing registrations can receive the cleanup script.
        return send_file(Path(app.root_path) / "retire-sw.js", mimetype="text/javascript", max_age=0)

