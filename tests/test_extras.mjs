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

test('both translations provide the same extras keys and interpolation variables', () => {
  const translations = language => JSON.parse(readFileSync(new URL(`../data/i18n/extras.${language}.json`, import.meta.url), 'utf8'));
  const swedish = translations('sv');
  const english = translations('en');
  const keys = Object.keys(swedish).sort();
  const variables = text => [...new Set(Array.from(text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g), match => match[1]))].sort();

  assert.ok(keys.length > 0);
  assert.deepEqual(Object.keys(english).sort(), keys);
  for (const key of keys) {
    assert.ok(swedish[key].trim(), key);
    assert.ok(english[key].trim(), key);
    assert.deepEqual(variables(english[key]), variables(swedish[key]), key);
  }
});

function glassPackage(suffix = '') {
  const category = `custom-glass${suffix}`;
  const subcategory = `${category}-general`;
  return {
    version: 1,
    id: `${category}-package`,
    names: { sv: 'Glaspaketet', en: 'The glass pack' },
    categories: [{
      id: category,
      names: { sv: 'Glas, "bräckligt"', en: 'Glass, "fragile"' },
      icon: '🥛',
      subcategories: [{ id: subcategory, names: { sv: 'Köket', en: 'Kitchen' } }],
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
        en: {
          word: 'Tumbler',
          aliases: ['Drinking glass'],
          hints: { easy: 'Water at dinner', normal: 'Pour a drink', hard: 'Clink in the sink' },
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
        en: {
          word: 'Mug',
          aliases: [],
          hints: { easy: 'Holds coffee', normal: 'Grip on the side', hard: 'Warms your palms' },
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

test('validates both languages, unique IDs and pair references', () => {
  assert.equal(extras.validateCustomPackage(glassPackage()).ok, true);

  const missingHint = glassPackage();
  delete missingHint.words[0].languages.en.hints.hard;
  const missingHintResult = extras.validateCustomPackage(missingHint);
  assertPackageIssues(missingHintResult);
  assert.ok(missingHintResult.issues.some(issue => issue.path.endsWith('.languages.en.hints.hard')));

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
    }
  });
}

test('reports syntax errors in JSON, the CSV header and a quoted CSV row', () => {
  assertPackageIssues(extras.parseCustomPackage('{"categories":', 'json'));
  assertPackageIssues(extras.parseCustomPackage('made,up,columns\n1,2,3', 'csv'));

  const validCsv = extras.serializeCustomPackage(glassPackage(), 'csv');
  assertPackageIssues(extras.parseCustomPackage(`${validCsv.trimEnd()}\n"unterminated`, 'csv'));
});

test('saves, edits and deletes a local package and exposes only the room content fields', () => {
  const custom = glassPackage('-lifecycle');
  const [tumbler] = custom.words;
  const separate = { ...glassPackage('-other-pack'), words: [], pairs: [] };
  const normalized = extras.validateCustomPackage(custom).package;
  try {
    const saved = extras.saveCustomPackage(custom);
    assert.equal(saved.ok, true);
    assert.equal(saved.persisted, true);
    assert.equal(extras.saveCustomPackage(separate).persisted, true);
    assert.equal(extras.getCustomContent().categories.length, 2);
    assert.equal(extras.listCustomPackages().find(item => item.id === custom.id)?.words.length, 2);

    const room = extras.getCustomPackage(custom.id);
    assert.deepEqual(Object.keys(room).sort(), ['categories', 'pairs', 'words']);
    assert.deepEqual(room, extras.getCustomContent([custom.id]));
    assert.deepEqual(room.pairs, normalized.pairs);
    room.words.pop();
    assert.equal(extras.getCustomPackage(custom.id).words.length, 2);

    const edited = glassPackage('-lifecycle');
    edited.words[0].languages.sv.hints.normal = 'Till måltiden';
    assert.equal(extras.saveCustomPackage(edited).persisted, true);
    assert.equal(extras.listCustomPackages().filter(item => item.id === custom.id).length, 1);
    const editedWord = extras.getCustomPackage(custom.id).words.find(word => word.id === tumbler.id);
    assert.equal(editedWord.languages.sv.hints.normal, 'Till måltiden');

    const conflict = { ...edited, id: `${custom.id}-conflict` };
    assertPackageIssues(extras.saveCustomPackage(conflict));
    assert.equal(extras.getCustomPackage(conflict.id), null);

    assert.equal(extras.deleteCustomPackage(custom.id).persisted, true);
    assert.equal(extras.getCustomPackage(custom.id), null);
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
    assert.equal(extras.getCustomPackage(custom.id).words.length, 2);

    readFailure = new DOMException('Storage blocked', 'SecurityError');
    assert.ok(extras.getCustomPackage(custom.id).words.some(word => word.languages.sv.word === 'Dricksglas'));
  } finally {
    writeFailure = null;
    readFailure = null;
    extras.deleteCustomPackage(custom.id);
  }
});

test('flags a clue once per word, language, level and reason and exports it locally', () => {
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
    assert.equal(extras.flagHint({ ...clue, language: 'en', word: 'Tumbler', hint: 'Pour a drink' }).added, true);

    const flags = extras.listHintFlags();
    assert.equal(flags.length, 2);
    assert.deepEqual(JSON.parse(extras.serializeHintFlags()), { version: 1, flags });
    const original = flags.find(flag => flag.language === 'sv');
    for (const [field, value] of Object.entries(clue)) {
      assert.equal(original[field], value);
    }
    assert.equal(extras.removeHintFlag(original.id).persisted, true);
    assert.deepEqual(extras.listHintFlags().map(flag => flag.language), ['en']);
  } finally {
    extras.clearHintFlags();
  }
});

function completedRound(suffix, { source = 'local', civilWin = false } = {}) {
  const id = `round-${suffix}`;
  const mode = civilWin ? 'blind' : 'classic';
  return {
    roundId: id,
    sessionId: `session-${source}-test`,
    source,
    completedAt: civilWin ? '2026-11-25T12:10:00.000Z' : '2026-11-25T12:00:00.000Z',
    players: [{ id: 'a', name: 'Åsa' }, { id: 'b', name: 'Bo' }, { id: 'c', name: 'Cleo' }],
    result: {
      id,
      mode,
      selectedMode: mode,
      wordId: 'custom-glass-tumbler',
      word: 'Dricksglas',
      pairedWordId: null,
      pairedWord: null,
      category: 'custom-glass',
      reused: civilWin,
      roles: civilWin ? { a: 'civil', b: 'imposter', c: 'civil' } : { a: 'imposter', b: 'civil', c: 'civil' },
      votes: { a: 'b', b: 'c', c: 'b' },
      voteWinner: 'b',
      eliminated: 'b',
      protected: null,
      winners: civilWin ? ['a', 'c'] : ['a'],
      winnerTeam: civilWin ? 'civils' : 'impostors',
      reason: civilWin ? 'imposter_eliminated' : 'imposter_survived',
      guess: null,
      points: civilWin ? { a: 2, b: 0, c: 2 } : { a: 2, b: 0, c: 0 },
    },
  };
}

test('records completed results once each and reports points, roles and games played by mode', () => {
  extras.clearHistory();
  const classic = completedRound('classic');
  const blind = completedRound('blind', { civilWin: true });
  try {
    const first = extras.recordRound(classic);
    assert.equal(first.ok, true);
    assert.equal(first.added, true);
    assert.equal(first.persisted, true);
    assert.equal(extras.recordRound(classic).added, false);
    assert.equal(extras.recordRound(blind).added, true);
    assert.equal(extras.recordRound({ ...blind, roundId: 'round-aborted', result: null }).ok, false);

    const history = extras.readHistory();
    assert.equal(history.length, 2);
    const stored = history.find(round => round.roundId === classic.roundId);
    assert.deepEqual(stored.result, classic.result);

    const stats = extras.summarizeHistory();
    assert.equal(stats.roundCount, 2);
    assert.deepEqual(stats.byMode, { classic: 1, blind: 1 });
    const player = stats.players.find(item => item.name === 'Åsa');
    assert.equal(player.points, 4);
    assert.equal(player.played, 2);
    assert.equal(player.wins, 2);
    assert.equal(player.imposterGames, 1);
    assert.equal(player.imposterWins, 1);
    assert.deepEqual(player.byRole, { imposter: { played: 1, wins: 1 }, civil: { played: 1, wins: 1 } });
    assert.deepEqual(player.byMode, { classic: { played: 1, wins: 1 }, blind: { played: 1, wins: 1 } });
  } finally {
    extras.clearHistory();
  }
});

test('history JSON round-trips finished online and local rounds and rejects partial imports', () => {
  extras.clearHistory();
  try {
    assert.equal(extras.recordRound(completedRound('local-archive')).added, true);
    assert.equal(extras.recordRound(completedRound('online-archive', { source: 'online', civilWin: true })).added, true);
    const exported = extras.serializeHistory();
    const before = extras.readHistory();
    assert.deepEqual(JSON.parse(exported), { version: 1, rounds: before });
    assert.equal(extras.clearHistory().persisted, true);
    assert.deepEqual(extras.readHistory(), []);

    const imported = extras.importHistory(exported);
    assert.equal(imported.ok, true);
    assert.equal(imported.added, 2);
    assert.equal(imported.persisted, true);
    assert.deepEqual(extras.readHistory(), before);
    assert.equal(extras.importHistory(exported).added, 0);

    const incomplete = completedRound('missing-votes');
    delete incomplete.result.votes;
    const mixed = JSON.stringify({ version: 1, rounds: [completedRound('valid'), incomplete] });
    assert.equal(extras.importHistory(mixed).ok, false);
    assert.deepEqual(extras.readHistory(), before);
  } finally {
    extras.clearHistory();
  }
});

test('holds completed results in memory when history cannot be saved', () => {
  extras.clearHistory();
  writeFailure = new DOMException('Storage full', 'QuotaExceededError');
  try {
    const before = new Map(storedValues);
    const result = extras.recordRound(completedRound('offline-save'));
    assert.equal(result.ok, true);
    assert.equal(result.added, true);
    assert.equal(result.persisted, false);
    assert.deepEqual(storedValues, before);

    readFailure = new DOMException('Storage blocked', 'SecurityError');
    assert.equal(extras.readHistory().length, 1);
    assert.equal(extras.recordRound(completedRound('offline-save')).added, false);
    assert.equal(extras.summarizeHistory().roundCount, 1);
  } finally {
    writeFailure = null;
    readFailure = null;
    extras.clearHistory();
  }
});
