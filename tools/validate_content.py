"""Validate bundled game content and write a reproducible Markdown report."""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from collections.abc import Iterator
from dataclasses import dataclass
import json
from pathlib import Path
import re
import sys
from typing import TYPE_CHECKING
import unicodedata

if TYPE_CHECKING:
    from app.content import ContentAudit


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = ("sv", "en")
HINT_LEVELS = ("easy", "normal", "hard")
HINT_WORD = re.compile(r"[^\W_]+(?:['’-][^\W_]+)*")
REQUIRED_CATEGORIES = (
    "minecraft", "clash-royale", "games", "everyday", "technology", "food",
    "animals", "nature", "sports", "vehicles", "film-tv", "music", "travel",
    "occupations", "home-school-clothes",
)
MIN_WORDS = 2_000
MIN_PAIRS = 100
REUSED_HINT_THRESHOLD = 3
GENERIC_HINTS = {
    "sv": {"sak", "en sak", "populär", "användbar", "finns i spelet"},
    "en": {"thing", "a thing", "popular", "useful", "found in the game", "in the game"},
}
DUPLICATE_CODES = {
    "duplicate_id", "duplicate_word", "duplicate_pair", "duplicate_value",
    "duplicate_word_reference", "alias_overlap",
}


@dataclass(frozen=True, slots=True)
class LanguageCounts:
    words: Counter[str]
    hints: Counter[str]
    pairs: Counter[str]
    cross_category_pairs: int
    familiar_words: int
    familiar_pairs: int


def _text_key(value: str) -> str:
    return " ".join(
        re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", value).casefold())
    )


def _cell(value: object) -> str:
    return (
        str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace("\\", "\\\\").replace("|", "\\|").replace("`", "&#96;")
        .replace("\r", " ").replace("\n", " ")
    )


def _invalid_hint_paths(words: list[dict]) -> Iterator[str]:
    for word in words:
        for language, translation in word["languages"].items():
            for level, hint in translation["hints"].items():
                if not HINT_WORD.fullmatch(unicodedata.normalize("NFC", hint)) or not any(char.isalpha() for char in hint):
                    yield f"{word['id']}.languages.{language}.hints.{level}"


def _hint_findings(words: list[dict]) -> tuple[
    list[tuple[str, str, str, str, list[str]]],
    list[tuple[str, str, str, str]],
    list[tuple[str, str, str, str]],
]:
    uses = defaultdict(set)
    generic = []
    reveals_answer = []
    for word in words:
        answers = {
            _text_key(answer)
            for translation in word["languages"].values()
            for answer in [translation["word"], *translation["aliases"]]
        } - {""}
        for lang in LANGUAGES:
            if lang not in word["languages"]:
                continue
            translation = word["languages"][lang]
            for level in HINT_LEVELS:
                hint = translation["hints"][level]
                key = _text_key(hint)
                uses[lang, word["category"], level, key].add(word["id"])
                if key in GENERIC_HINTS[lang]:
                    generic.append((lang, word["id"], level, hint))
                if key in answers or any(
                    len(answer) >= 4 and f" {answer} " in f" {key} "
                    for answer in answers
                ):
                    reveals_answer.append((lang, word["id"], level, hint))

    repeated = [
        (lang, category, level, key, sorted(ids)) for (lang, category, level, key), ids in uses.items()
        if key and len(ids) >= REUSED_HINT_THRESHOLD
    ]
    repeated.sort(key=lambda entry: (-len(entry[-1]), *entry[:-1]))
    return repeated, sorted(generic), sorted(reveals_answer)


def _language_counts(audit: ContentAudit, lang: str) -> LanguageCounts:
    words = {word["id"]: word for word in audit.words if lang in word["languages"]}
    word_counts = Counter(word["category"] for word in words.values())
    hint_counts = Counter()
    category_pairs = Counter()
    between_categories = 0
    familiar_words = 0
    familiar_pairs = 0

    for word in words.values():
        hint_counts[word["category"]] += len(word["languages"][lang]["hints"])
        familiar_words += word["level"] == "familiar"
    for left, right in audit.pairs:
        if left not in words or right not in words:
            continue
        first, second = words[left], words[right]
        if first["category"] == second["category"]:
            category_pairs[first["category"]] += 1
        else:
            between_categories += 1
        if first["level"] == second["level"] == "familiar":
            familiar_pairs += 1

    return LanguageCounts(word_counts, hint_counts, category_pairs, between_categories, familiar_words, familiar_pairs)


def build_report(audit: ContentAudit) -> tuple[str, bool]:
    counts = {lang: _language_counts(audit, lang) for lang in LANGUAGES}
    errors = sum(issue.severity == "error" for issue in audit.issues)
    duplicate_count = sum(issue.code in DUPLICATE_CODES for issue in audit.issues)
    missing_fields = sum(issue.code == "missing_field" for issue in audit.issues)
    category_rows = {entry["id"]: entry for entry in audit.categories}
    category_ids = dict.fromkeys((*REQUIRED_CATEGORIES, *category_rows))
    missing_categories = [
        key for key in category_ids if not all(coverage.words[key] for coverage in counts.values())
    ]
    word_totals = {lang: coverage.words.total() for lang, coverage in counts.items()}
    pair_totals = {
        lang: coverage.pairs.total() + coverage.cross_category_pairs for lang, coverage in counts.items()
    }
    volume_met = min(word_totals.values()) >= MIN_WORDS and min(pair_totals.values()) >= MIN_PAIRS
    ready = errors == 0 and volume_met and not missing_categories
    repeated, generic, revealing = _hint_findings(audit.words)
    review = Counter(word["review"] for word in audit.words)
    levels = Counter(word["level"] for word in audit.words)

    lines = [
        "# Innehållsrapport", "",
        f"Innehållsversion `{audit.version}`.", "",
        f"**{'Uppfyller' if ready else 'Uppfyller ännu inte'} innehållsgränserna.** "
        f"Gränserna är {MIN_WORDS} spelbara begrepp och {MIN_PAIRS} användbara ordpar per språk, "
        "spelbart innehåll i obligatoriska och övriga listade kategorier och inga strukturella fel.", "",
        f"Katalogen innehåller **{len(audit.words)} unika begrepp** och **{len(audit.pairs)} unika ordpar** "
        "efter automatisk avdubblering. Svenska och engelska räknas tillsammans som ett begrepp per ord-ID.", "",
        "## Spelbart innehåll", "",
        "Tabellen räknar alla kunskapsnivåer. Ett par räknas i en kategori när båda orden ingår där. "
        "Par mellan kategorier ingår i totalen och kan användas när båda kategorierna är valda.", "",
        "| Kategori | Ord SV | Ledtrådar SV | Par SV | Ord EN | Ledtrådar EN | Par EN |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for key in category_ids:
        category = category_rows.get(key)
        title = f"`{key}`"
        if category:
            title = f"{_cell(category['names']['sv'])} ({title})"
        row = [
            str(number) for coverage in counts.values()
            for number in (coverage.words[key], coverage.hints[key], coverage.pairs[key])
        ]
        lines.append(f"| {title} | {' | '.join(row)} |")
    swedish, english = counts['sv'], counts['en']
    lines.append(
        f"| Mellan kategorier | — | — | {swedish.cross_category_pairs} "
        f"| — | — | {english.cross_category_pairs} |"
    )
    totals = [
        str(number) for lang, coverage in counts.items()
        for number in (word_totals[lang], coverage.hints.total(), pair_totals[lang])
    ]
    lines.extend([f"| **Totalt** | {' | '.join(totals)} |", ""])

    lines.extend([
        f"På nivån Välkända finns **{levels['familiar']}** begrepp, på Mellannivå "
        f"**{levels['intermediate']}** och på Expert **{levels['expert']}**.", "",
        f"Med standardnivån `familiar` och alla kategorier valda finns {swedish.familiar_words} svenska "
        f"begrepp och {swedish.familiar_pairs} svenska par samt {english.familiar_words} engelska begrepp och "
        f"{english.familiar_pairs} engelska par.", "",
    ])
    if missing_categories:
        listed = ", ".join(f"`{key}`" for key in missing_categories)
        lines.extend([f"Kategorier utan spelbara begrepp på båda språken är {listed}.", ""])

    lines.extend([
        "## Automatisk validering", "",
        "Valideringen kontrollerar JSON, obligatoriska fält, språkversioner, unika identifierare, "
        "namn, parreferenser och att varje ledtråd består av ett ord. Övriga kontroller av ledtrådstext "
        "hittar mönster att gå igenom manuellt.", "",
        f"- Strukturella fel **{errors}**",
        f"- Dublett- och aliashändelser **{duplicate_count}**",
        f"- Saknade obligatoriska fält **{missing_fields}**",
        f"- Ledtrådar som återkommer för minst {REUSED_HINT_THRESHOLD} begrepp i samma kategori, "
        f"språk och ledtrådsnivå **{len(repeated)}**",
        f"- Träffar på generiska ledtrådar **{len(generic)}**",
        f"- Ledtrådar med ordet, en direkt översättning eller ett angivet alias **{len(revealing)}**", "",
    ])
    if audit.issues:
        lines.extend([
            "### Katalogens anmärkningar", "",
            "| Grad | Kod | Position | Meddelande |", "| --- | --- | --- | --- |",
        ])
        for issue in audit.issues:
            cells = (issue.severity, issue.code, issue.path, issue.message)
            lines.append("| " + " | ".join(map(_cell, cells)) + " |")
        lines.append("")
    if repeated:
        lines.extend([
            "### Återanvända ledtrådar", "",
            "| Språk | Kategori | Ledtrådsnivå | Normaliserad ledtråd | Antal begrepp | Ord-ID |",
            "| --- | --- | --- | --- | ---: | --- |",
        ])
        for lang, category, level, clue, ids in repeated:
            cells = (lang, category, level, clue, len(ids), ", ".join(ids))
            lines.append("| " + " | ".join(map(_cell, cells)) + " |")
        lines.append("")
    for heading, findings in (("Generiska ledtrådar", generic), ("Ledtrådar som kan avslöja ordet", revealing)):
        if findings:
            lines.extend([
                f"### {heading}", "",
                "| Språk | Ord-ID | Nivå | Ledtråd |", "| --- | --- | --- | --- |",
            ])
            for finding in findings:
                lines.append("| " + " | ".join(map(_cell, finding)) + " |")
            lines.append("")

    lines.extend([
        "## Redaktionell granskning", "",
        f"Källfilerna markerar **{review['editorial']}** begrepp som redaktionellt genomgångna och "
        f"**{review['needs_review']}** som osäkra.", "",
        "Redaktören bedömer om ord och ledtrådar är naturliga på båda språken, om närliggande ord "
        "representerar samma begrepp och om paren är jämförbara och går att skilja åt. "
        "Bedöm även ledtrådens styrka i små underkategorier.", "",
    ])
    uncertain = sorted(word["id"] for word in audit.words if word["review"] == "needs_review")
    if uncertain:
        lines.append("Poster som behöver redaktionell granskning omfattar följande ID:n.")
        lines.extend(["", *(f"- `{key}`" for key in uncertain), ""])
    return "\n".join(lines), ready


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=PROJECT_ROOT / "data")
    parser.add_argument("--write-report", type=Path, metavar="PATH", help="Write the Markdown report to PATH.")
    parser.add_argument("--write-categories", type=Path, metavar="PATH", help="Write the combined category JSON to PATH.")
    parser.add_argument("--allow-incomplete", action="store_true", help="Allow partial category and volume coverage.")
    args = parser.parse_args(argv)

    # Import the standard-library content module without loading the Flask app factory.
    sys.path.insert(0, str(PROJECT_ROOT / "app"))
    try:
        from content import ContentIssue, audit_content
    finally:
        sys.path.pop(0)

    audit = audit_content(args.data_dir)
    audit.issues.extend(
        ContentIssue("error", "hint_not_one_word", path, "Ange ett enda ord.")
        for path in _invalid_hint_paths(audit.words)
    )
    report, ready = build_report(audit)
    errors = any(issue.severity == "error" for issue in audit.issues)
    print(report, end="")
    if args.write_report:
        args.write_report.write_text(report, encoding="utf-8", newline="\n")
    if args.write_categories:
        if errors:
            print("Strukturella fel stoppade skrivningen av kategorifilen.", file=sys.stderr)
        else:
            categories = json.dumps(audit.categories, ensure_ascii=False, indent=2)
            args.write_categories.write_text(categories + "\n", encoding="utf-8", newline="\n")
    return int(errors or (not ready and not args.allow_incomplete))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
