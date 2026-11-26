import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const storedValues = new Map();
let writeFailure = null;
let readFailure = null;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem(key) {
      if (readFailure) throw readFailure;
      return storedValues.get(key) ?? null;
    },
    setItem(key, value) {
      if (writeFailure) throw writeFailure;
      storedValues.set(key, String(value));
    },
    removeItem(key) {
      if (writeFailure) throw writeFailure;
      storedValues.delete(key);
    },
  },
});

const extras = await import('../app/static/js/extras.mjs');

test('Swedish extras messages are nonempty', () => {
  const swedish = JSON.parse(readFileSync(new URL('../data/i18n/extras.sv.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(swedish).length > 0);
  for (const [key, value] of Object.entries(swedish)) {
    assert.ok(value.trim(), key);
  }
});

function glassPackage(suffix = '') {
  const category = `custom-glass${suffix}`;
  const subcategory = `${category}-general`;
  return {
    version: 1,
    id: `${category}-package`,
    names: { sv: 'Glaspaketet' },
    categories: [{
      id: category,
      names: { sv: 'Glas, "bräckligt"' },
      icon: '🥛',
      subcategories: [{ id: subcategory, names: { sv: 'Köket' } }],
    }],
    words: [{
      id: `${category}-tumbler`,
      category,
      subcategory,
      tags: ['dryck', 'glas, bord'],
      level: 'familiar',
      review: 'needs_review',
      languages: {
        sv: {
          word: 'Dricksglas',
          aliases: ['Tumblerglas', 'Glas, "lågt"'],
          hints: { easy: 'Vatten på bordet', normal: 'Häll upp', hard: 'Klang i diskhon' },
        },
      },
    }, {
      id: `${category}-mug`,
      category,
      subcategory,
      tags: ['fika', 'drinkware'],
      level: 'familiar',
      review: 'needs_review',
      languages: {
        sv: {
          word: 'Mugg',
          aliases: [],
          hints: { easy: 'Tar kaffe', normal: 'Öra på sidan', hard: 'Värmer händerna' },
        },
      },
    }],
    pairs: [[`${category}-tumbler`, `${category}-mug`]],
  };
}

function assertPackageIssues(result) {
  assert.equal(result.ok, false);
  assert.ok(result.issues.length > 0);
  assert.ok(result.issues.every(issue => typeof issue.code === 'string'));
}

test('validates Swedish hints, unique IDs and pair references', () => {
  assert.equal(extras.validateCustomPackage(glassPackage()).ok, true);

  const missingHint = glassPackage();
  delete missingHint.words[0].languages.sv.hints.hard;
  const missingHintResult = extras.validateCustomPackage(missingHint);
  assertPackageIssues(missingHintResult);
  assert.ok(missingHintResult.issues.some(issue => issue.path.endsWith('.languages.sv.hints.hard')));

  const duplicateWord = glassPackage();
  duplicateWord.words[1].id = duplicateWord.words[0].id;
  assertPackageIssues(extras.validateCustomPackage(duplicateWord));

  const wrongSubcategory = glassPackage();
  wrongSubcategory.words[1].subcategory = 'custom-missing';
  assertPackageIssues(extras.validateCustomPackage(wrongSubcategory));

  const danglingPair = glassPackage();
  danglingPair.pairs = [[danglingPair.words[0].id, 'custom-glass-missing']];
  assertPackageIssues(extras.validateCustomPackage(danglingPair));
});

for (const format of ['json', 'csv']) {
  test(`${format.toUpperCase()} round-trips Swedish text, quotes, aliases and pairs`, () => {
    const validated = extras.validateCustomPackage(glassPackage());
    assert.equal(validated.ok, true);

    const exported = extras.serializeCustomPackage(validated.package, format);
    const imported = extras.parseCustomPackage(exported, format);
    assert.equal(imported.ok, true);
    for (const field of ['categories', 'words', 'pairs']) {
      assert.deepEqual(imported.package[field], validated.package[field]);
    }
    if (format === 'json') {
      assert.deepEqual(imported.package.names, validated.package.names);
      assert.equal(imported.package.id, validated.package.id);
    } else {
      const [firstLine, ...rows] = exported.trimEnd().split('\r\n');
      const header = firstLine.split(',');
      assert.ok(header.includes('sv_word'));
      assert.ok(header.every(column => !column.startsWith('en_')));

      const legacy = [
        `en_name,en_word,en_aliases,en_easy,en_normal,en_hard,${firstLine}`,
        ...rows.map((row, index) => `English name,English word ${index},[],Easy,Normal,Hard,${row}`),
      ].join('\r\n');
      const converted = extras.parseCustomPackage(legacy, format);
      assert.equal(converted.ok, true);
      for (const field of ['categories', 'words', 'pairs']) {
        assert.deepEqual(converted.package[field], imported.package[field]);
      }
    }
  });
}

test('reports syntax errors in JSON, the CSV header and a quoted CSV row', () => {
  assertPackageIssues(extras.parseCustomPackage('{"categories":', 'json'));
  assertPackageIssues(extras.parseCustomPackage('made,up,columns\n1,2,3', 'csv'));

  const validCsv = extras.serializeCustomPackage(glassPackage(), 'csv');
  assertPackageIssues(extras.parseCustomPackage(`${validCsv.trimEnd()}\n"unterminated`, 'csv'));
});

test('saves, edits and deletes a local package and selects its playable content', () => {
  const custom = glassPackage('-lifecycle');
  const [tumbler] = custom.words;
  const separate = { ...glassPackage('-other-pack'), words: [], pairs: [] };
  const normalized = extras.validateCustomPackage(custom).package;
  try {
    const legacy = glassPackage('-lifecycle');
    legacy.names.en = 'The glass pack';
    legacy.categories[0].names.en = 'Glass';
    legacy.categories[0].subcategories[0].names.en = 'Kitchen';
    legacy.words[0].languages.en = {
      word: 'Tumbler',
      aliases: ['Drinking glass'],
      hints: { easy: 'Water at dinner', normal: 'Pour a drink', hard: 'Clink in the sink' },
    };
    storedValues.set('imposter:customPackages.v1', JSON.stringify([legacy]));
    assert.deepEqual(extras.listCustomPackages(), [normalized]);
    assert.deepEqual(extras.parseCustomPackage(JSON.stringify(legacy)).package, normalized);

    const saved = extras.saveCustomPackage(custom);
    assert.equal(saved.ok, true);
    assert.equal(saved.persisted, true);
    assert.equal(extras.saveCustomPackage(separate).persisted, true);
    assert.equal(extras.getCustomContent().categories.length, 2);
    assert.equal(extras.listCustomPackages().find(item => item.id === custom.id)?.words.length, 2);

    const content = extras.getCustomContent([custom.id]);
    assert.deepEqual(Object.keys(content).sort(), ['categories', 'pairs', 'words']);
    assert.deepEqual(content.pairs, normalized.pairs);
    content.words.pop();
    assert.equal(extras.getCustomContent([custom.id]).words.length, 2);

    const edited = glassPackage('-lifecycle');
    edited.words[0].languages.sv.hints.normal = 'Till måltiden';
    assert.equal(extras.saveCustomPackage(edited).persisted, true);
    assert.equal(extras.listCustomPackages().filter(item => item.id === custom.id).length, 1);
    const editedWord = extras.getCustomContent([custom.id]).words.find(word => word.id === tumbler.id);
    assert.equal(editedWord.languages.sv.hints.normal, 'Till måltiden');

    const conflict = { ...edited, id: `${custom.id}-conflict` };
    assertPackageIssues(extras.saveCustomPackage(conflict));
    assert.equal(extras.listCustomPackages().some(pack => pack.id === conflict.id), false);

    assert.equal(extras.deleteCustomPackage(custom.id).persisted, true);
    assert.equal(extras.listCustomPackages().some(pack => pack.id === custom.id), false);
  } finally {
    extras.deleteCustomPackage(custom.id);
    extras.deleteCustomPackage(separate.id);
  }
});

test('keeps a package usable in memory when browser storage is full or blocked', () => {
  const custom = glassPackage('-storage');
  writeFailure = new DOMException('Storage full', 'QuotaExceededError');
  try {
    const before = new Map(storedValues);
    const saved = extras.saveCustomPackage(custom);
    assert.equal(saved.ok, true);
    assert.equal(saved.persisted, false);
    assert.deepEqual(storedValues, before);
    assert.equal(extras.getCustomContent([custom.id]).words.length, 2);

    readFailure = new DOMException('Storage blocked', 'SecurityError');
    assert.ok(extras.getCustomContent([custom.id]).words.some(word => word.languages.sv.word === 'Dricksglas'));
  } finally {
    writeFailure = null;
    readFailure = null;
    extras.deleteCustomPackage(custom.id);
  }
});

test('flags Swedish clues once per word, level and reason and exports them locally', () => {
  extras.clearHintFlags();
  const clue = {
    wordId: 'custom-glass-tumbler',
    language: 'sv',
    level: 'normal',
    reason: 'För tydlig',
    word: 'Dricksglas',
    hint: 'Häll upp',
  };
  try {
    const flagged = extras.flagHint(clue);
    assert.equal(flagged.ok, true);
    assert.equal(flagged.added, true);
    assert.equal(flagged.persisted, true);
    assert.equal(extras.flagHint({ ...clue, reason: '  För tydlig  ' }).added, false);
    assert.equal(extras.flagHint({ ...clue, language: 'en', word: 'Tumbler', hint: 'Pour a drink' }).ok, false);
    assert.equal(extras.flagHint({ ...clue, level: 'easy', hint: 'Vatten på bordet' }).added, true);

    const savedFlags = extras.listHintFlags();
    assert.equal(savedFlags.length, 2);
    const original = savedFlags.find(flag => flag.level === 'normal');
    const flags = [...savedFlags].reverse();
    storedValues.set('imposter:hintFlags.v1', JSON.stringify([
      ...flags,
      { ...original, id: 'hint-legacy', language: 'en', word: 'Tumbler', hint: 'Pour a drink' },
    ]));
    assert.deepEqual(extras.listHintFlags(), flags);
    assert.deepEqual(JSON.parse(extras.serializeHintFlags()), { version: 1, flags });
    for (const [field, value] of Object.entries(clue)) {
      assert.equal(original[field], value);
    }
    assert.equal(extras.removeHintFlag(original.id).persisted, true);
    assert.deepEqual(extras.listHintFlags().map(flag => flag.level), ['easy']);
  } finally {
    extras.clearHintFlags();
  }
});
