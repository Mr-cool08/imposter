"""Read and validate the public JSON catalog and private custom packages."""

from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass, field
import hashlib
import json
from pathlib import Path
import re
import unicodedata


LANGUAGES = ("sv",)
LEVELS = ("familiar", "intermediate", "expert")
HINTS = ("easy", "normal", "hard")
REVIEWS = ("editorial", "needs_review")
CUSTOM_LIMITS = {
    "bytes": 256 * 1024,
    "categories": 50,
    "subcategories": 200,
    "words": 500,
    "pairs": 1000,
    "tags": 16,
    "aliases": 16,
}
_ID_PATTERN = re.compile(r"[a-z0-9]+(?:[-_][a-z0-9]+)*")
_CONTROL_PATTERN = re.compile(r"[\x00-\x1f\x7f\ud800-\udfff]")


@dataclass(frozen=True)
class ContentIssue:
    severity: str
    code: str
    path: str
    message: str


class ContentValidationError(ValueError):
    def __init__(self, issues):
        self.issues = list(issues)
        first = self.issues[0]
        remaining = len(self.issues) - 1
        suffix = f" (+{remaining})" if remaining else ""
        super().__init__(f"{first.path}: {first.message}{suffix}")


@dataclass
class ContentAudit:
    categories: list = field(default_factory=list)
    words: list = field(default_factory=list)
    pairs: list = field(default_factory=list)
    issues: list[ContentIssue] = field(default_factory=list)
    version: str = ""


def _dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _term(value):
    normalized = unicodedata.normalize("NFC", value).lower()
    return " ".join(normalized.split())


class _Terms:
    def __init__(self):
        self.primary = {}
        self.aliases = {}

    def overlap(self, word):
        for lang, details in word["languages"].items():
            key = lang, _term(details["word"])
            match = self.primary.get(key) or self.aliases.get(key)
            if match:
                return match
            for alias in details["aliases"]:
                match = self.primary.get((lang, _term(alias)))
                if match:
                    return match
        return None

    def add(self, word):
        for lang, details in word["languages"].items():
            self.primary[lang, _term(details["word"])] = word["id"]
            for alias in details["aliases"]:
                self.aliases[lang, _term(alias)] = word["id"]


class _Validator:
    def __init__(self, issues, *, custom=False):
        self.issues = issues
        self.custom = custom

    def issue(self, code, path, message, severity="error"):
        self.issues.append(ContentIssue(severity, code, path, message))

    def sequence(self, value, path, *, limit=None):
        if not isinstance(value, list):
            self.issue("invalid_type", path, "Expected a JSON array.")
            return []
        if limit is not None and len(value) > limit:
            self.issue("limit", path, f"Use at most {limit} entries.")
            return value[:limit]
        return value

    def object(self, value, fields, path):
        if not isinstance(value, dict):
            self.issue("invalid_type", path, "Expected a JSON object.")
            return None
        present = True
        for name in fields:
            if name not in value:
                self.issue("missing_field", f"{path}.{name}", "Required field.")
                present = False
        return value if present else None

    def identifier(self, value, path):
        if not isinstance(value, str) or len(value) > 100 or not _ID_PATTERN.fullmatch(value):
            self.issue("invalid_id", path, "Use a lowercase ASCII identifier of up to 100 characters.")
            return ""
        return value

    def string(self, value, path, maximum):
        if not isinstance(value, str) or _CONTROL_PATTERN.search(value):
            self.issue("invalid_text", path, "Expected text without control characters.")
            return ""
        clean = value.strip()
        if not clean or len(clean) > maximum:
            self.issue("invalid_text", path, f"Use 1 to {maximum} characters.")
        return clean

    def strings(self, value, path, maximum, *, limit=None):
        entries = self.sequence(value, path, limit=limit)
        values = []
        prior = set()
        for index, entry in enumerate(entries):
            item_path = f"{path}[{index}]"
            item = self.string(entry, item_path, maximum)
            key = _term(item)
            if key in prior:
                self.issue("duplicate_value", item_path, "Repeated value.")
            prior.add(key)
            values.append(item)
        return values

    def choice(self, value, options, path):
        if not isinstance(value, str) or value not in options:
            self.issue("invalid_choice", path, f"Use one of {', '.join(options)}.")
        return value

    def names(self, value, path):
        value = self.object(value, LANGUAGES, path)
        if value is None:
            return {}
        return {lang: self.string(value[lang], f"{path}.{lang}", 100) for lang in LANGUAGES}

    def category(self, value, path):
        first = len(self.issues)
        value = self.object(value, ("id", "names", "icon", "subcategories"), path)
        if value is None:
            return None
        subcategories = []
        sub_entries = self.sequence(
            value["subcategories"], f"{path}.subcategories",
            limit=CUSTOM_LIMITS["subcategories"] if self.custom else None,
        )
        for index, sub in enumerate(sub_entries):
            sub_path = f"{path}.subcategories[{index}]"
            sub = self.object(sub, ("id", "names"), sub_path)
            if sub is not None:
                subcategories.append({
                    "id": self.identifier(sub["id"], f"{sub_path}.id"),
                    "names": self.names(sub["names"], f"{sub_path}.names"),
                })
        category = {
            "id": self.identifier(value["id"], f"{path}.id"),
            "names": self.names(value["names"], f"{path}.names"),
            "icon": self.string(value["icon"], f"{path}.icon", 64),
            "subcategories": subcategories,
        }
        return category if len(self.issues) == first else None

    def word_language(self, value, path):
        value = self.object(value, ("word", "aliases", "hints"), path)
        if value is None:
            return None
        raw_hints = self.object(value["hints"], HINTS, f"{path}.hints")
        hints = {}
        if raw_hints is not None:
            hints = {
                hint: self.string(raw_hints[hint], f"{path}.hints.{hint}", 160)
                for hint in HINTS
            }
            if all(hints.values()) and len({_term(hint) for hint in hints.values()}) != len(HINTS):
                self.issue("repeated_word_hint", f"{path}.hints", "Provide three distinct hints.")
        return {
            "word": self.string(value["word"], f"{path}.word", 100),
            "aliases": self.strings(
                value["aliases"], f"{path}.aliases", 100,
                limit=CUSTOM_LIMITS["aliases"] if self.custom else None,
            ),
            "hints": hints,
        }

    def word(self, value, path):
        first = len(self.issues)
        fields = ("id", "category", "subcategory", "tags", "level", "review", "languages")
        value = self.object(value, fields, path)
        if value is None:
            return None
        raw_languages = self.object(value["languages"], LANGUAGES, f"{path}.languages")
        word = {
            "id": self.identifier(value["id"], f"{path}.id"),
            "category": self.identifier(value["category"], f"{path}.category"),
            "subcategory": self.identifier(value["subcategory"], f"{path}.subcategory"),
            "tags": self.strings(
                value["tags"], f"{path}.tags", 40,
                limit=CUSTOM_LIMITS["tags"] if self.custom else None,
            ),
            "level": self.choice(value["level"], LEVELS, f"{path}.level"),
            "review": self.choice(value["review"], REVIEWS, f"{path}.review"),
            "languages": {
                lang: self.word_language(raw_languages[lang], f"{path}.languages.{lang}")
                for lang in LANGUAGES
            } if raw_languages is not None else {},
        }
        return word if len(self.issues) == first else None

    def pair(self, value, path):
        if not isinstance(value, list) or len(value) != 2:
            self.issue("invalid_pair", path, "Expected exactly two word IDs.")
            return None
        first = len(self.issues)
        left, right = (self.identifier(word_id, f"{path}[{i}]") for i, word_id in enumerate(value))
        if len(self.issues) != first:
            return None
        if left == right:
            self.issue("invalid_pair", path, "Pair members must be different words.")
            return None
        return tuple(sorted((left, right)))


def _read(path, validator, display_path):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, ValueError, RecursionError) as error:
        validator.issue("invalid_json", display_path, f"Unable to read JSON: {error}")
        return []


def _entries(root, files, validator, *, allow_object=False):
    for file in files:
        label = file.relative_to(root).as_posix()
        data = _read(file, validator, label)
        if allow_object and isinstance(data, dict):
            yield data, label
        else:
            for index, entry in enumerate(validator.sequence(data, label)):
                yield entry, f"{label}[{index}]"


def _custom_entries(data, key, validator):
    path = f"custom.{key}"
    entries = validator.sequence(data[key], path, limit=CUSTOM_LIMITS[key])
    return ((entry, f"{path}[{index}]") for index, entry in enumerate(entries))


def _categories(entries, validator):
    categories = {}
    for raw, path in entries:
        category = validator.category(raw, path)
        if category is None:
            continue
        category_id = category["id"]
        if category_id in categories:
            validator.issue("duplicate_id", path, f"Repeated category ID {category_id!r}.")
            continue
        categories[category_id] = category, path
    return categories


def _subcategory_index(categories, validator):
    owners = {}
    for category, path in categories.values():
        for index, subcategory in enumerate(category["subcategories"]):
            sub_id = subcategory["id"]
            if sub_id in owners:
                validator.issue(
                    "duplicate_id", f"{path}.subcategories[{index}]",
                    f"Repeated subcategory ID {sub_id!r}.",
                )
                continue
            owners[sub_id] = category["id"]
    return owners


def _words(entries, categories, subcategories, validator):
    by_id = {}
    for raw, path in entries:
        word = validator.word(raw, path)
        if word is None:
            continue
        word_id = word["id"]
        category = word["category"]
        if word_id in by_id:
            validator.issue("duplicate_id", path, f"Repeated word ID {word_id!r}.")
            continue
        if category not in categories:
            validator.issue("unknown_category", f"{path}.category", f"Unknown category {category!r}.")
            continue
        if not validator.custom and not word_id.startswith(f"{category}-"):
            validator.issue("invalid_id", f"{path}.id", f"Word ID must start with {category + '-'!r}.")
            continue
        subcategory = word["subcategory"]
        if subcategories.get(subcategory) != category:
            validator.issue(
                "unknown_subcategory", f"{path}.subcategory",
                f"Subcategory {subcategory!r} does not belong to {category!r}.",
            )
            continue
        by_id[word_id] = word, path

    unique = []
    terms = _Terms()
    severity = "error" if validator.custom else "warning"
    for word_id in sorted(by_id):
        word, path = by_id[word_id]
        overlap = terms.overlap(word)
        if overlap:
            validator.issue("duplicate_word", path, f"{word_id!r} overlaps with {overlap!r}.", severity)
            continue
        terms.add(word)
        unique.append(word)
    return unique, set(by_id)


def _pairs(entries, all_word_ids, words, validator):
    canonical = {word["id"] for word in words}
    pairs = set()
    severity = "error" if validator.custom else "warning"
    for raw, path in entries:
        pair = validator.pair(raw, path)
        if pair is None:
            continue
        missing = set(pair) - all_word_ids
        if missing:
            validator.issue("unknown_word", path, f"Unknown pair member(s): {', '.join(sorted(missing))}.")
            continue
        if not canonical.issuperset(pair):
            validator.issue(
                "duplicate_word_reference", path,
                f"Pair refers to an excluded duplicate: {', '.join(pair)}.", severity,
            )
            continue
        if pair in pairs:
            validator.issue("duplicate_pair", path, f"Repeated pair: {', '.join(pair)}.", severity)
            continue
        pairs.add(pair)
    return [list(pair) for pair in sorted(pairs)]


def audit_content(data_dir):
    """Return structurally valid canonical records together with diagnostics."""
    root = Path(data_dir)
    audit = ContentAudit()
    validator = _Validator(audit.issues)
    master = root / "categories.json"
    fragments = sorted((root / "category_parts").glob("*.json"))
    if not master.is_file() and not fragments:
        validator.issue("missing_file", "categories.json", "Category metadata was not found.")
    categories = _categories(_entries(root, [master] if master.is_file() else [], validator), validator)
    fragment_categories = _categories(_entries(root, fragments, validator, allow_object=True), validator)
    categories.update(fragment_categories)

    subcategories = _subcategory_index(categories, validator)
    audit.categories = [category for category, _ in categories.values()]
    word_files = sorted((root / "words").glob("*.json"))
    audit.words, all_word_ids = _words(_entries(root, word_files, validator), categories, subcategories, validator)
    pair_files = sorted((root / "pairs").glob("*.json"))
    audit.pairs = _pairs(_entries(root, pair_files, validator), all_word_ids, audit.words, validator)
    payload = _dump([audit.categories, audit.words, audit.pairs])
    audit.version = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return audit


class ContentCatalog:
    """Versioned public packs and matching selections for server-side games."""

    def __init__(self, audit):
        errors = [issue for issue in audit.issues if issue.severity == "error"]
        if errors:
            raise ContentValidationError(errors)
        self.version = audit.version
        self._categories = {category["id"]: category for category in audit.categories}
        self._subcategories = {
            subcategory["id"]
            for category in audit.categories
            for subcategory in category["subcategories"]
        }
        self._words = audit.words
        self._pairs = audit.pairs
        self._words_by_category = defaultdict(list)
        self._pairs_by_category = defaultdict(list)
        self._word_categories = {}
        for word in self._words:
            word_id, category_id = word["id"], word["category"]
            self._words_by_category[category_id].append(word)
            self._word_categories[word_id] = category_id
        for pair in self._pairs:
            for category_id in {self._word_categories[word_id] for word_id in pair}:
                self._pairs_by_category[category_id].append(pair)

    @classmethod
    def load(cls, data_dir):
        return cls(audit_content(data_dir))

    @property
    def categories(self):
        return deepcopy(list(self._categories.values()))

    def pack(self, category):
        return deepcopy({
            "version": self.version,
            "category": self._categories[category],
            "words": self._words_by_category.get(category, []),
            "pairs": self._pairs_by_category.get(category, []),
        })

    def validate_custom(self, custom):
        issues = []
        validator = _Validator(issues, custom=True)
        try:
            size = len(_dump(custom).encode("utf-8"))
        except (TypeError, ValueError, UnicodeError, RecursionError):
            validator.issue("invalid_json", "custom", "Expected a serializable JSON package.")
            raise ContentValidationError(issues) from None
        if size > CUSTOM_LIMITS["bytes"]:
            validator.issue("limit", "custom", "Package is larger than 256 KiB.")
            raise ContentValidationError(issues)
        custom = validator.object(custom, ("categories", "words", "pairs"), "custom")
        if custom is None:
            raise ContentValidationError(issues)

        categories = _categories(_custom_entries(custom, "categories", validator), validator)
        subcategories = _subcategory_index(categories, validator)
        if len(subcategories) > CUSTOM_LIMITS["subcategories"]:
            validator.issue("limit", "custom.categories", "Use at most 200 subcategories in total.")
        words, word_ids = _words(_custom_entries(custom, "words", validator), categories, subcategories, validator)
        pairs = _pairs(_custom_entries(custom, "pairs", validator), word_ids, words, validator)
        for field_name, conflicts in (
            ("categories", set(categories).intersection(self._categories)),
            ("categories", self._subcategories.intersection(subcategories)),
            ("words", word_ids.intersection(self._word_categories)),
        ):
            for identifier in sorted(conflicts):
                validator.issue("id_conflict", f"custom.{field_name}", f"Public content uses ID {identifier!r}.")
        if issues:
            raise ContentValidationError(issues)
        return {"categories": [category for category, _ in categories.values()], "words": words, "pairs": pairs}

    def select(self, settings, custom=None):
        own = self.validate_custom(custom) if custom is not None else {"words": [], "pairs": []}
        categories = settings.get("categories")
        subcategories = settings.get("subcategories")
        levels = settings.get("levels", ("familiar",))
        matches = []
        terms = _Terms()
        for word in (*self._words, *own["words"]):
            if categories is not None and word["category"] not in categories:
                continue
            if subcategories and word["subcategory"] not in subcategories:
                continue
            if word["level"] not in levels:
                continue
            if terms.overlap(word):
                continue
            terms.add(word)
            matches.append(word)
        word_ids = {word["id"] for word in matches}
        pairs = [pair for pair in (*self._pairs, *own["pairs"]) if word_ids.issuperset(pair)]
        return deepcopy({"words": sorted(matches, key=lambda word: word["id"]), "pairs": sorted(pairs)})
