from __future__ import annotations

import hashlib
import io
import json
import re
from pathlib import Path

import qrcode
from flask import Response, abort, jsonify, render_template, request, url_for
from qrcode.image.svg import SvgPathImage

KNOWN_LANGUAGES = ("sv", "en")
STATIC_EXTENSIONS = {".css", ".mjs", ".js", ".png", ".svg", ".webp", ".ico", ".woff2", ".wav", ".mp3"}
ROOM_CODE = re.compile(r"[A-Z0-9]{4,10}")


def read_translations(data_dir: Path) -> dict:
    translations = {}
    for language in KNOWN_LANGUAGES:
        messages = {}
        for source in sorted((data_dir / "i18n").glob(f"*.{language}.json")):
            fragment = json.loads(source.read_text(encoding="utf-8"))
            if not isinstance(fragment, dict):
                raise ValueError(f"Translation fragment {source.name} must be a JSON object")
            duplicate = messages.keys() & fragment.keys()
            if duplicate:
                raise ValueError(f"Repeated translation keys in {source.name}: {', '.join(sorted(duplicate))}")
            messages.update(fragment)
        translations[language] = messages
    if translations["sv"].keys() != translations["en"].keys():
        raise ValueError("Swedish and English translation keys differ")
    return translations


def shell_manifest(app, translations: dict) -> dict:
    static_dir = Path(app.static_folder)
    template_dir = Path(app.root_path) / app.template_folder
    files = sorted(
        path for path in static_dir.rglob("*")
        if path.is_file() and path.suffix in STATIC_EXTENSIONS and path.name != "sw.js"
    )
    fingerprint = hashlib.sha256()
    configuration = {
        "name": app.config["APP_NAME"],
        "slogans": app.config["SLOGANS"],
        "categories": app.extensions["content_catalog"].version,
        "rules": app.extensions["game_rules"],
        "translations": translations,
    }
    fingerprint.update(json.dumps(configuration, sort_keys=True).encode())
    for path in [*files, *sorted(template_dir.rglob("*.html")), static_dir / "sw.js"]:
        if path.is_file():
            fingerprint.update(path.name.encode())
            fingerprint.update(path.read_bytes())
    return {
        "version": fingerprint.hexdigest()[:20],
        "assets": [f"/static/{path.relative_to(static_dir).as_posix()}" for path in files],
    }


def register_routes(app, data_dir: Path) -> None:
    catalog = app.extensions["content_catalog"]
    translations = read_translations(data_dir)
    shell = shell_manifest(app, translations)

    @app.after_request
    def headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    @app.get("/", defaults={"code": None})
    @app.get("/join/<code>")
    def home(code):
        return render_template(
            "index.html",
            app_name=app.config["APP_NAME"],
            slogans=app.config["SLOGANS"],
            slogan=app.config["SLOGANS"]["sv"],
            public_origin=app.config["PUBLIC_ORIGIN"],
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

    @app.get("/api/i18n/<language>.json")
    def i18n(language):
        if language not in translations:
            abort(404)
        return jsonify(translations[language])

    @app.get("/manifest.webmanifest")
    def web_manifest():
        response = jsonify({
            "id": "/",
            "name": app.config["APP_NAME"],
            "short_name": app.config["APP_NAME"],
            "description": app.config["SLOGANS"]["sv"],
            "lang": "sv",
            "start_url": "/",
            "scope": "/",
            "display": "standalone",
            "background_color": "#131323",
            "theme_color": "#131323",
            "icons": [
                {"src": "/static/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                {"src": "/static/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                {"src": "/static/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
            ],
        })
        response.mimetype = "application/manifest+json"
        return response

    @app.get("/sw.js")
    def worker():
        script_path = Path(app.static_folder) / "sw.js"
        if not script_path.is_file():
            abort(404)
        script = f"self.IMPOSTER_SHELL = {json.dumps(shell)};\n{script_path.read_text(encoding='utf-8')}"
        return Response(script, mimetype="text/javascript", headers={
            "Service-Worker-Allowed": "/",
            "Cache-Control": "no-cache",
        })

    @app.get("/api/qr/<code>.svg")
    def qr_join(code):
        code = code.upper()
        if not ROOM_CODE.fullmatch(code):
            abort(404)
        origin = app.config["PUBLIC_ORIGIN"] or request.host_url.rstrip("/")
        image = qrcode.make(origin + url_for("home", code=code), image_factory=SvgPathImage)
        output = io.BytesIO()
        image.save(output)
        return Response(output.getvalue(), mimetype="image/svg+xml", headers={"Cache-Control": "no-store"})
