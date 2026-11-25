import pytest

from app import create_app


@pytest.fixture(scope="module")
def app():
    return create_app({
        "TESTING": True,
        "APP_NAME": "Provspel",
    })


def test_game_shell_and_manifest(app):
    client = app.test_client()
    home = client.get("/")
    assert home.status_code == 200
    assert b"Provspel" in home.data
    assert "Lita inte på någon" in home.get_data(as_text=True)

    response = client.get("/manifest.webmanifest")
    assert response.mimetype == "application/manifest+json"
    manifest = response.json
    assert manifest["name"] == "Provspel"
    assert manifest["scope"] == manifest["start_url"] == "/"
    for icon in manifest["icons"]:
        assert client.get(icon["src"]).status_code == 200


def test_public_data_routes_agree_on_catalog_version(app):
    client = app.test_client()
    catalog = client.get("/api/content/manifest").json
    assert catalog["categories"]
    sample = catalog["categories"][0]["id"]
    pack = client.get(f"/api/content/packs/{sample}.json").json
    assert pack["version"] == catalog["version"]
    assert all(word["category"] == sample for word in pack["words"])
    assert client.get("/api/content/packs/missing-category.json").status_code == 404
    assert client.get("/api/content/rules").status_code == 200
    assert client.get("/healthz").json == {"status": "ok", "contentVersion": catalog["version"]}


def test_service_worker_has_root_scope(app):
    client = app.test_client()
    worker = client.get("/sw.js")
    assert worker.status_code == 200
    assert worker.headers["Service-Worker-Allowed"] == "/"
    assert worker.headers["Cache-Control"] == "no-cache"
    assert worker.data.startswith(b"self.IMPOSTER_SHELL = {")


def test_both_language_routes_have_the_same_messages(app):
    client = app.test_client()
    swedish = client.get("/api/i18n/sv.json").json
    english = client.get("/api/i18n/en.json").json
    assert swedish.keys() == english.keys()
    assert swedish and swedish != english
    assert client.get("/api/i18n/missing.json").status_code == 404


def test_multiplayer_endpoints_are_absent(app):
    client = app.test_client()
    for path in ("/join/ABC123", "/api/qr/ABC123.svg", "/socket.io/", "/static/js/online.mjs"):
        assert client.get(path).status_code == 404, path
