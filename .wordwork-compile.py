"""Compile the hand-authored category data during this authoring session."""

from collections import Counter, defaultdict
import json
from pathlib import Path
import re


SOURCES = ("kitchen-garden", "workshop", "software", "networking", "hardware")
TAGS = {
    "everyday-kitchen": "cooking",
    "everyday-workshop": "tools",
    "everyday-furniture": "furniture",
    "everyday-office": "office",
    "everyday-garden": "gardening",
    "technology-software": "software",
    "technology-computers": "computing",
    "technology-networking": "networking",
    "technology-electronics": "electronics",
}
FIXES = {
    "wifi": {"sv_aliases": "wi-fi"},
    "domain-name": {"sv_easy": "Namnet du skriver för att hitta en webbplats"},
    "peer-to-peer": {"sv_word": "peer-to-peer-nätverk", "sv_aliases": "peer-to-peer|P2P"},
    "nat": {"sv_word": "NAT", "sv_aliases": "nätadressöversättning"},
    "cdn": {"sv_word": "CDN", "sv_aliases": "innehållsleveransnätverk"},
    "barcode": {
        "sv_easy": "Kassaläsaren tolkar mönstret av parallella ränder",
        "sv_normal": "Samma artikel brukar ha samma mönster på alla förpackningar",
        "en_easy": "A checkout scanner reads the pattern of parallel bars",
        "en_normal": "The same item usually has the same pattern on every packet",
    },
    "screenshot": {"en_aliases": "screen grab"},
    "passkey": {"sv_word": "passkey", "sv_aliases": "inloggningsnyckel"},
    "private-browsing": {
        "sv_easy": "Besökshistoriken försvinner när den särskilda surfsessionen stängs",
        "en_easy": "The local visit history goes away when the special session ends",
    },
    "software-container": {"sv_word": "container", "sv_aliases": "programvarubehållare"},
    "sandbox": {"sv_word": "digital sandlåda", "en_word": "software sandbox", "sv_aliases": "sandlådemiljö"},
    "recycle-bin": {"sv_word": "digital papperskorg", "sv_aliases": "", "en_aliases": ""},
}
FIELDS = (
    "slug", "subcategory", "level", "sv_word", "en_word",
    "sv_easy", "sv_normal", "sv_hard", "en_easy", "en_normal", "en_hard",
    "sv_aliases", "en_aliases",
)
PAIRS = {
    "everyday": (
        ("chefs-knife", "bread-knife"),
        ("sieve", "colander"),
        ("corkscrew", "bottle-opener"),
        ("whisk", "hand-mixer"),
        ("blender", "food-processor"),
        ("frying-pan", "wok"),
        ("springform-pan", "loaf-pan"),
        ("leaf-rake", "bow-rake"),
        ("garden-spade", "garden-fork"),
        ("lawnmower", "string-trimmer"),
        ("pruners", "loppers"),
        ("low-tunnel", "cold-frame"),
        ("lawn-aerator", "scarifier"),
        ("sparskruvmejsel", "kryssmejsel"),
        ("skruvstycke", "skruvtving"),
        ("sticksag", "cirkelsag"),
        ("bandslip", "excenterslip"),
        ("handhyvel", "stamjarn"),
        ("metallfil", "rasp"),
        ("mattband", "tumstock"),
        ("soffa", "fatolj"),
        ("soffbord", "sangbord"),
        ("sideboard", "vitrinskap"),
        ("arkivskap", "arkivbox"),
        ("brevstall", "brevkorg"),
    ),
    "technology": (
        ("web-browser", "search-engine"),
        ("word-processor", "presentation-software"),
        ("qr-code", "barcode"),
        ("cloud-storage", "backup"),
        ("file-manager", "task-manager"),
        ("autocomplete", "autocorrect"),
        ("speech-recognition", "text-to-speech"),
        ("virtual-machine", "software-container"),
        ("wifi", "bluetooth"),
        ("wifi", "cellular-network"),
        ("latency", "bandwidth"),
        ("wifi-extender", "mesh-network"),
        ("dns", "domain-name"),
        ("tcp", "udp"),
        ("desktop-computer", "laptop"),
        ("solid-state-drive", "hard-disk-drive"),
        ("computer-mouse", "touchpad"),
        ("memory-card", "flash-drive"),
        ("printer", "scanner"),
        ("toner-cartridge", "ink-cartridge"),
        ("headphones", "earbuds"),
        ("speaker", "soundbar"),
        ("television", "projector"),
        ("servo-motor", "stepper-motor"),
    ),
}


def write_json(path, data):
    encoded = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    path.write_text(encoded, encoding="utf-8", newline="\n")


rows_by_category = defaultdict(dict)
for name in SOURCES:
    path = Path(f".wordwork-{name}.tsv")
    for lineno, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        cells = [cell.strip() for cell in line.split("\t")]
        assert 11 <= len(cells) <= 13 and all(cells[:11]), (path, lineno)
        row = dict(zip(FIELDS, cells + [""] * (13 - len(cells)), strict=True))
        slug, subcategory, level = (row[key] for key in FIELDS[:3])
        if slug in {"plugin", "plant-pot"}:
            continue
        assert re.fullmatch("[a-z0-9]+(?:-[a-z0-9]+)*", slug), (path, lineno, slug)
        assert level in {"familiar", "intermediate", "expert"}, (path, lineno, level)
        row.update(FIXES.get(slug, {}))
        category = subcategory.split("-", 1)[0]
        identifier = f"{category}-{slug}"
        assert identifier not in rows_by_category[category], (path, lineno, identifier)
        languages = {}
        for lang in ("sv", "en"):
            aliases = [alias.strip() for alias in row[f"{lang}_aliases"].split("|") if alias.strip()]
            languages[lang] = {
                "word": row[f"{lang}_word"],
                "aliases": aliases,
                "hints": {key: row[f"{lang}_{key}"] for key in ("easy", "normal", "hard")},
            }
        rows_by_category[category][identifier] = {
            "id": identifier,
            "category": category,
            "subcategory": subcategory,
            "tags": [TAGS[subcategory]],
            "level": level,
            "review": "editorial",
            "languages": languages,
        }

all_pairs = []
for category, pairs in PAIRS.items():
    by_id = rows_by_category[category]
    for first, second in pairs:
        left, right = f"{category}-{first}", f"{category}-{second}"
        first_word, second_word = by_id[left], by_id[right]
        if first_word["level"] == second_word["level"]:
            all_pairs.append(sorted((left, right)))
        else:
            print(f"Skipped pair with unequal levels: {left} / {right}")

assert len(all_pairs) >= 18 and len(set(map(tuple, all_pairs))) == len(all_pairs)
assert sum(map(len, rows_by_category.values())) >= 335
for category, by_id in rows_by_category.items():
    words = sorted(by_id.values(), key=lambda word: (word["subcategory"], word["id"]))
    write_json(Path("data/words") / f"{category}.json", words)
    print(category, len(words), dict(Counter(word["subcategory"] for word in words)))
write_json(Path("data/pairs/everyday.json"), sorted(all_pairs))
print("pairs", dict(Counter(left.split("-", 1)[0] for left, right in all_pairs)))
