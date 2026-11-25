from collections import Counter
import json
from pathlib import Path
import re

source = Path('tmp-minecraft-world-entries.txt')
output = Path('tmp-minecraft-world-entries.json')
levels = ('easy', 'normal', 'hard')
words = []
category = 'minecraft'
edits = {
    'Uttorkad zombie~Husk': 'Uttorkad zombie~Husk',
    'En ledig arbetsstation ändrar yrket': 'En arbetsstation kan ändra yrket',
    'An available job block changes its profession': 'A job block can change its profession',
    'En osynlig kundkontakt nattetid': 'Vid mörkrets inbrott kan säljaren bli osynlig',
    'Håll utkik efter den stora taggiga siluetten': 'Mjölk ger bara en tillfällig respit',
    'Look out for the large spiky silhouette': 'Milk only buys you time',
    'Vindicator~Försvarare~Hämnare': 'Vindicator~Försvarare',
    'En sax gör den brun och vanlig': 'En sax kan ta bort påväxten permanent',
    'Shears leave an ordinary brown cow': 'Shears can remove the growth for good',
    'Saltvattensbiom med stora isberg': 'Vidsträckt vatten med stora isberg',
    'Saltwater biome with large icebergs': 'Expansive water dotted with large icebergs',
    'Flera av rankorna växer uppåt': 'Rankorna slingrar uppåt',
    'Some of the vines climb upward': 'The vines twist upward',
    'En jämn röd vy bryts av vita kvartsådror': 'Vita kvartsfläckar bryter av allt det röda',
    'White quartz veins break up the sea of red': 'White patches of quartz break up the sea of red',
    'Titta efter en tunn tråd i ögonhöjd': 'Titta efter en tunn tråd lågt över gången',
    'Ett eko leder till kompassen som hittar dödsplatsen': 'En skärva hjälper dig att hitta en gammal dödsplats',
    'An echo leads to the compass that finds where you died': 'A shard helps you find where you died',
}

def language(label, hints):
    word, *aliases = label.split('~')
    result = {'word': word, 'aliases': aliases, 'hints': dict(zip(levels, hints, strict=True))}
    assert all(isinstance(value, str) and value.strip() == value and value for value in [word, *aliases, *hints]), result
    assert len(set(map(str.casefold, [word, *aliases]))) == 1 + len(aliases), result
    assert len(set(map(str.casefold, hints))) == len(levels), result
    assert not any(re.search(r'(?<!\w)' + re.escape(name.casefold()) + r'(?!\w)', hint.casefold()) for hint in hints for name in [word, *aliases]), result
    return result

for line in source.read_text(encoding='utf-8-sig').splitlines():
    if line.startswith('# '):
        subcategory = line[2:]
        continue
    fields = line.split('|')
    fields = [edits.get(value, value) for value in fields]
    slug, level, sv, en, sv_easy, sv_normal, sv_hard, en_easy, en_normal, en_hard, tag = fields
    assert re.fullmatch(r'[a-z]+(?:-[a-z]+)*', slug), slug
    assert level in {'familiar', 'intermediate', 'expert'}, level
    words.append({
        'id': f'{category}-{slug}',
        'category': category,
        'subcategory': f'{category}-{subcategory}',
        'tags': [tag],
        'level': level,
        'review': 'editorial',
        'languages': {
            'sv': language(sv, [sv_easy, sv_normal, sv_hard]),
            'en': language(en, [en_easy, en_normal, en_hard]),
        },
    })

counts = Counter(word['subcategory'] for word in words)
assert counts == {'minecraft-mobs': 39, 'minecraft-biomes': 26, 'minecraft-structures': 20}, counts
assert len({word['id'] for word in words}) == len(words)
for code in ('sv', 'en'):
    labels = [label.casefold() for word in words for label in (word['languages'][code]['word'], *word['languages'][code]['aliases'])]
    assert len(set(labels)) == len(labels), [x for x, count in Counter(labels).items() if count > 1]
    hints = [hint.casefold() for word in words for hint in word['languages'][code]['hints'].values()]
    assert len(set(hints)) == len(hints) == 255, len(hints)
    assert max(map(len, hints)) <= 90, max(map(len, hints))
output.write_text(json.dumps(words, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
assert json.loads(output.read_text(encoding='utf-8')) == words
print(counts, Counter(word['level'] for word in words), output.resolve(), sep='\n')
