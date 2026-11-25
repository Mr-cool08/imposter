"""Content contracts shared by Flask and the offline browser."""

from copy import deepcopy
import json
from pathlib import Path
import shutil
import subprocess

import pytest

from app.content import ContentCatalog, ContentValidationError, audit_content


CONTENT_MODULE = Path(__file__).resolve().parents[1] / "app" / "static" / "js" / "content.mjs"


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def category(category_id, *subcategories):
    return {
        "id": category_id,
        "names": {"sv": category_id, "en": category_id},
        "icon": "🍏",
        "subcategories": [
            {"id": subcategory, "names": {"sv": subcategory, "en": subcategory}}
            for subcategory in subcategories
        ],
    }


def word(word_id, category_id, subcategory, sv, en, *, level="familiar", review="editorial"):
    return {
        "id": word_id,
        "category": category_id,
        "subcategory": subcategory,
        "tags": ["fixture"],
        "level": level,
        "review": review,
        "languages": {
            "sv": {"word": sv, "aliases": [], "hints": {
                "easy": "Växer i täta grupper", "normal": "Trivs i fukt", "hard": "Under löven",
            }},
            "en": {"word": en, "aliases": [], "hints": {
                "easy": "Grows in clusters", "normal": "Likes moisture", "hard": "Under the leaves",
            }},
        },
    }


@pytest.fixture
def data_dir(tmp_path):
    write_json(tmp_path / "categories.json", [
        category("food", "food-fruit", "food-grains"),
        category("nature", "nature-trees", "nature-plants"),
    ])
    write_json(tmp_path / "words" / "food.json", [
        word("food-apple", "food", "food-fruit", "Äpple", "Apple"),
        word("food-pear", "food", "food-fruit", "Päron", "Pear", review="needs_review"),
        word("food-rye", "food", "food-grains", "Råg", "Rye", level="intermediate"),
    ])
    write_json(tmp_path / "words" / "nature.json", [
        word("nature-birch", "nature", "nature-trees", "Björk", "Birch"),
        word("nature-fir", "nature", "nature-trees", "Ädelgran", "Fir", level="expert"),
        word("nature-moss", "nature", "nature-plants", "Mossa", "Moss"),
    ])
    write_json(tmp_path / "pairs" / "pairs.json", [
        ["food-apple", "food-pear"],
        ["food-apple", "nature-birch"],
        ["nature-birch", "nature-fir"],
    ])
    return tmp_path


@pytest.fixture
def custom_package():
    first = word("garden-pine", "garden", "garden-tree", "Tall", "Pine")
    first["tags"] = ["natur", "sällskap, träd"]
    first["languages"]["sv"]["aliases"] = ["Tall, vanlig", '"tall"']
    first["languages"]["sv"]["hints"]["easy"] = 'Kotte, "tung"'
    return {
        "categories": [category("garden", "garden-tree")],
        "words": [first, word("garden-spruce", "garden", "garden-tree", "Gran", "Spruce")],
        "pairs": [["garden-pine", "garden-spruce"]],
    }


def ids(contents):
    return {item["id"] for item in contents["words"]}


def pairs(contents):
    return {frozenset(pair) for pair in contents["pairs"]}


def test_filter_counts_use_both_members_of_each_pair(data_dir):
    catalog = ContentCatalog.load(data_dir)

    defaults = catalog.select({})
    assert ids(defaults) == {"food-apple", "food-pear", "nature-birch", "nature-moss"}
    assert pairs(defaults) == {
        frozenset(("food-apple", "food-pear")), frozenset(("food-apple", "nature-birch")),
    }
    assert catalog.select({"language": "en", "hint": "hard"}) == defaults

    food_only = catalog.select({"categories": ["food"], "subcategories": []})
    assert ids(food_only) == {"food-apple", "food-pear"}
    assert food_only["pairs"] == [["food-apple", "food-pear"]]

    filtered = catalog.select({
        "categories": ["food", "nature"],
        "subcategories": ["food-fruit", "nature-trees"],
        "levels": ["familiar", "expert"],
    })
    assert ids(filtered) == {"food-apple", "food-pear", "nature-birch", "nature-fir"}
    assert len(filtered["pairs"]) == 3
    assert catalog.select({"categories": []}) == {"words": [], "pairs": []}
    assert catalog.select({"levels": []}) == {"words": [], "pairs": []}


def test_pack_includes_cross_category_pairs_and_shares_catalog_version(data_dir):
    catalog = ContentCatalog.load(data_dir)
    food = catalog.pack("food")
    nature = catalog.pack("nature")

    assert food["version"] == nature["version"] == catalog.version
    assert food["category"] == category("food", "food-fruit", "food-grains")
    assert ids(food) == {"food-apple", "food-pear", "food-rye"}
    assert ["food-apple", "nature-birch"] in food["pairs"]
    assert ["food-apple", "nature-birch"] in nature["pairs"]
    assert ["nature-birch", "nature-fir"] not in food["pairs"]
    assert catalog.version == ContentCatalog.load(data_dir).version
    with pytest.raises(KeyError):
        catalog.pack("unknown")

    food_path = data_dir / "words" / "food.json"
    records = json.loads(food_path.read_text(encoding="utf-8"))
    records[0]["languages"]["en"]["hints"]["normal"] = "More than one kind in an orchard"
    write_json(food_path, records)
    assert catalog.version != ContentCatalog.load(data_dir).version


def test_flask_manifest_and_pack_match_the_catalog(data_dir):
    from flask import Flask

    from app.routes import register_routes

    catalog = ContentCatalog.load(data_dir)
    app = Flask(__name__)
    app.config.update(APP_NAME="Fixture game", SLOGANS={"sv": "Svenska", "en": "English"})
    app.extensions.update(content_catalog=catalog, game_rules={})
    register_routes(app, data_dir)

    client = app.test_client()
    assert client.get("/api/content/manifest").get_json() == {
        "version": catalog.version, "categories": catalog.categories,
    }
    assert client.get("/api/content/packs/food.json").get_json() == catalog.pack("food")
    assert client.get("/api/content/packs/unknown.json").status_code == 404


def test_catalog_discovers_metadata_and_words_in_new_json_files(tmp_path):
    write_json(tmp_path / "category_parts" / "first.json", category("food", "food-fruit"))
    write_json(tmp_path / "category_parts" / "second.json", [category("nature", "nature-trees")])
    fragments_only = ContentCatalog.load(tmp_path)
    assert {item["id"] for item in fragments_only.categories} == {"food", "nature"}
    assert fragments_only.select({}) == {"words": [], "pairs": []}

    write_json(tmp_path / "words" / "fruit.json", [word("food-apple", "food", "food-fruit", "Äpple", "Apple")])
    assert ids(ContentCatalog.load(tmp_path).select({})) == {"food-apple"}

    old_food = category("food", "food-dried")
    write_json(tmp_path / "categories.json", [old_food])
    assert ids(ContentCatalog.load(tmp_path).select({})) == {"food-apple"}


def test_audit_detects_duplicate_pairs_and_missing_pair_references(data_dir):
    write_json(data_dir / "pairs" / "extra.json", [
        ["food-pear", "food-apple"],
        ["food-apple", "food-unknown"],
    ])
    audit = audit_content(data_dir)

    assert len(audit.pairs) == 3
    assert any(issue.code == "duplicate_pair" and issue.severity == "warning" for issue in audit.issues)
    assert any(issue.severity == "error" and "food-unknown" in issue.message for issue in audit.issues)
    with pytest.raises(ContentValidationError) as invalid:
        ContentCatalog.load(data_dir)
    assert any(issue.severity == "error" for issue in invalid.value.issues)


def test_audit_matches_aliases_after_normalization_but_preserves_swedish_letters(tmp_path):
    write_json(tmp_path / "categories.json", [category("food", "food-grains")])
    first = word("food-limpa", "food", "food-grains", "Limpa", "Loaf")
    first["languages"]["sv"]["aliases"] = ["RA\u030aG   LIMPA"]
    write_json(tmp_path / "words" / "food.json", [
        first,
        word("food-rye", "food", "food-grains", "Råg limpa", "Rye bread"),
        word("food-rag", "food", "food-grains", "Rag limpa", "Seasoned bread"),
    ])

    audit = audit_content(tmp_path)

    remaining = {entry["id"] for entry in audit.words}
    assert "food-rag" in remaining
    assert len(remaining & {"food-limpa", "food-rye"}) == 1
    assert any("duplicate" in issue.code for issue in audit.issues)


def test_custom_is_validated_and_filtered_alongside_built_in_content(data_dir, custom_package):
    catalog = ContentCatalog.load(data_dir)
    empty = {"categories": [], "words": [], "pairs": []}

    assert catalog.validate_custom(empty) == empty
    assert catalog.validate_custom(custom_package) == custom_package
    garden = catalog.select({"categories": ["garden"]}, custom_package)
    assert garden == {"words": custom_package["words"], "pairs": custom_package["pairs"]}
    both = catalog.select({"categories": ["food", "garden"]}, custom_package)
    assert len(both["words"]) == 4
    assert len(both["pairs"]) == 2
    assert "garden" not in {item["id"] for item in catalog.categories}


def test_custom_rejects_bad_references_duplicates_and_built_in_collisions(data_dir, custom_package):
    catalog = ContentCatalog.load(data_dir)
    invalid_packages = [
        {**custom_package, "words": custom_package["words"][:1]},
        {**custom_package, "pairs": custom_package["pairs"] + [["garden-spruce", "garden-pine"]]},
        {"categories": [category("food", "garden-tree")], "words": [], "pairs": []},
        {**custom_package, "words": custom_package["words"] * 2},
    ]
    for package in invalid_packages:
        with pytest.raises(ContentValidationError) as invalid:
            catalog.validate_custom(package)
        assert invalid.value.issues


def run_content_js(program, data):
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is optional and is used here to verify the browser content module.")
    result = subprocess.run(
        [node, "--input-type=module", "--eval", program, CONTENT_MODULE.as_uri()],
        input=json.dumps(data), capture_output=True, encoding="utf-8", timeout=20,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_browser_fetch_and_filter_matches_python(data_dir, custom_package):
    catalog = ContentCatalog.load(data_dir)
    selections = [
        {}, {"categories": []}, {"levels": []},
        {"language": "en", "categories": ["nature", "garden"], "levels": ["expert", "familiar"]},
        {"categories": ["food", "nature"], "subcategories": ["food-fruit", "nature-trees"]},
        {"categories": ["food"], "subcategories": ["nature-trees"]},
    ]
    results = run_content_js(
        """
        import {readFileSync} from 'node:fs';
        const {loadContent, selectContent} = await import(process.argv[1]);
        const {packs, manifest, custom, selections} = JSON.parse(readFileSync(0, 'utf8'));
        const fetches = [];
        const fetch = async (url) => {
            fetches.push(url);
            const body = url === '/api/content/manifest' ? manifest :
                packs.find(pack => url === `/api/content/packs/${pack.category.id}.json`);
            return {ok: Boolean(body), json: async () => body};
        };
        const selected = selections.map(settings => selectContent(settings, packs, custom));
        const fetched = await loadContent(selections[3], {custom, fetch});
        console.log(JSON.stringify({selected, fetched, fetches}));
        """,
        {"packs": [catalog.pack(entry["id"]) for entry in catalog.categories],
         "manifest": {"version": catalog.version, "categories": catalog.categories},
         "custom": custom_package, "selections": selections},
    )
    expected = [catalog.select(settings, custom_package) for settings in selections]
    assert results["selected"] == expected
    assert results["fetched"] == expected[3]
    assert results["fetches"] == ["/api/content/manifest", "/api/content/packs/nature.json"]


def test_browser_custom_import_export_preserves_unicode_quotes_and_aliases(custom_package):
    result = run_content_js(
        """
        import {readFileSync} from 'node:fs';
        const content = await import(process.argv[1]);
        const custom = JSON.parse(readFileSync(0, 'utf8'));
        const csv = content.exportCustomCSV(custom);
        const json = content.exportCustomJSON(custom);
        const fromCSV = content.parseCustomCSV(csv);
        const fromJSON = content.parseCustomJSON(json);
        let rejectsInvalidCSV = false;
        try { content.parseCustomCSV(csv + '\\r\\n"unterminated'); }
        catch { rejectsInvalidCSV = true; }
        console.log(JSON.stringify({fromCSV, fromJSON, rejectsInvalidCSV}));
        """,
        custom_package,
    )

    assert result == {"fromCSV": custom_package, "fromJSON": custom_package, "rejectsInvalidCSV": True}


def test_browser_validation_matches_python_for_order_and_duplicate_tags(data_dir, custom_package):
    catalog = ContentCatalog.load(data_dir)
    custom_package["words"].reverse()
    expected = catalog.validate_custom(custom_package)
    invalid = deepcopy(custom_package)
    invalid["words"][0]["tags"] = ["fixture", " FIXTURE "]
    with pytest.raises(ContentValidationError):
        catalog.validate_custom(invalid)

    result = run_content_js(
        """
        import {readFileSync} from 'node:fs';
        const {validateCustom} = await import(process.argv[1]);
        const {valid, invalid} = JSON.parse(readFileSync(0, 'utf8'));
        let rejected = false;
        try { validateCustom(invalid); }
        catch { rejected = true; }
        console.log(JSON.stringify({valid: validateCustom(valid), rejected}));
        """,
        {"valid": custom_package, "invalid": invalid},
    )

    assert result == {"valid": expected, "rejected": True}


def test_browser_matches_python_when_custom_terms_overlap_in_either_language(data_dir, custom_package):
    catalog = ContentCatalog.load(data_dir)
    custom_package["words"][0]["languages"]["sv"]["aliases"].append("Äpple")
    settings = {"language": "en"}

    matches = run_content_js(
        """
        import {readFileSync} from 'node:fs';
        const {selectContent} = await import(process.argv[1]);
        const {settings, packs, custom} = JSON.parse(readFileSync(0, 'utf8'));
        console.log(JSON.stringify(selectContent(settings, packs, custom)));
        """,
        {"settings": settings, "packs": [catalog.pack("food"), catalog.pack("nature")],
         "custom": custom_package},
    )

    assert matches == catalog.select(settings, custom_package)
    assert "garden-pine" not in ids(matches)
    assert ["garden-pine", "garden-spruce"] not in matches["pairs"]


def test_browser_filters_an_aggregate_of_individually_valid_custom_packs(custom_package):
    orchard = {
        "categories": [category("orchard", "orchard-tree")],
        "words": [word("orchard-pine", "orchard", "orchard-tree", "Tall", "Pine")],
        "pairs": [],
    }
    matches = run_content_js(
        """
        import {readFileSync} from 'node:fs';
        const {selectContent, validateCustom} = await import(process.argv[1]);
        const {garden, orchard} = JSON.parse(readFileSync(0, 'utf8'));
        const first = validateCustom(garden);
        const second = validateCustom(orchard);
        const aggregate = Object.fromEntries(Object.keys(first).map(
            key => [key, [...first[key], ...second[key]]],
        ));
        const both = selectContent({}, [], aggregate);
        const orchardOnly = selectContent({categories: ['orchard']}, [], aggregate);
        console.log(JSON.stringify({both, orchardOnly}));
        """,
        {"garden": custom_package, "orchard": orchard},
    )

    assert ids(matches["both"]) == {"garden-pine", "garden-spruce"}
    assert ids(matches["orchardOnly"]) == {"orchard-pine"}


def test_browser_rejects_a_pack_from_a_different_catalog_version(data_dir):
    pack = ContentCatalog.load(data_dir).pack("food")
    loaded = run_content_js(
        """
        import {readFileSync} from 'node:fs';
        const {loadPack} = await import(process.argv[1]);
        const pack = JSON.parse(readFileSync(0, 'utf8'));
        const fetch = async () => ({ok: true, json: async () => pack});
        const matching = await loadPack('food', {version: pack.version, fetch});
        let rejected = false;
        try { await loadPack('food', {version: 'stale-version', fetch}); }
        catch { rejected = true; }
        console.log(JSON.stringify({matching, rejected}));
        """,
        pack,
    )

    assert loaded == {"matching": pack, "rejected": True}
