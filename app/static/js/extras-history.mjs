const HISTORY_KEY = 'imposter:history.v1';
const HISTORY_VERSION = 1;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const SOURCES = new Set(['local', 'online']);
const MODES = new Set(['classic', 'random', 'all', 'none', 'reverse', 'joker', 'undercover', 'alliance', 'blind', 'chaos']);
const ROLES = new Set(['civil', 'imposter', 'joker', 'detective', 'guardian', 'spy', 'accomplice', 'double_agent', 'undercover']);
const IMPOSTERS = new Set(['imposter', 'spy']);
const VOTE_GROUPS = new Set(['@all', '@none']);
const WINNER_TEAMS = new Set(['civils', 'impostors', 'joker', 'all', 'none']);
const REASONS = new Set([
  'joker_eliminated', 'all_correct', 'all_missed', 'none_correct', 'none_missed',
  'reverse_civil_eliminated', 'reverse_civil_survived', 'undercover_eliminated',
  'undercover_survived', 'imposter_eliminated', 'imposter_survived', 'guess_correct',
  'guess_wrong', 'guess_timeout',
]);

let saved = [];
let savedJSON;
let readable = true;
let clearedInMemory = false;
const pending = new Map();

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function meaningful(value, limit = 256) {
  return typeof value === 'string' && value.length <= limit && value.trim().length > 0;
}

function normalizeRound(entry, { live = false } = {}) {
  if (!object(entry) || !object(entry.result)) return null;
  const { result, source } = entry;
  const roundId = entry.roundId ?? result.id;
  const sessionId = entry.sessionId ?? null;
  const category = entry.category ?? result.category;
  const timestamp = entry.completedAt ?? (live ? Date.now() : null);
  const time = typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp;
  if (!SOURCES.has(source) || !meaningful(roundId) || roundId !== result.id
      || (sessionId !== null && !meaningful(sessionId)) || !meaningful(category)
      || !Number.isFinite(time) || Math.abs(time) > 8.64e15) return null;

  const { mode, wordId, word, roles, votes, winners, reason, points } = result;
  if (!MODES.has(mode) || mode === 'chaos' || !meaningful(wordId) || !meaningful(word)
      || !meaningful(result.category) || !REASONS.has(reason)
      || !object(roles) || !object(votes) || !object(points) || !Array.isArray(winners)) return null;

  const roleEntries = Object.entries(roles);
  const playerIds = new Set(Object.keys(roles));
  const votedTarget = id => playerIds.has(id) || VOTE_GROUPS.has(id);
  const playerOrEmpty = id => id == null || playerIds.has(id);
  if (playerIds.size < 3 || playerIds.size > 20
      || roleEntries.some(([id, role]) => !meaningful(id) || VOTE_GROUPS.has(id) || !ROLES.has(role))
      || Object.keys(votes).length !== playerIds.size || Object.keys(points).length !== playerIds.size
      || [...playerIds].some(id => !Object.hasOwn(votes, id) || !votedTarget(votes[id]) || votes[id] === id
        || !Object.hasOwn(points, id) || !Number.isSafeInteger(points[id]) || points[id] < 0 || points[id] > 3)
      || new Set(winners).size !== winners.length || winners.some(id => !playerIds.has(id))
      || (result.selectedMode != null && !MODES.has(result.selectedMode))
      || (result.winnerTeam != null && !WINNER_TEAMS.has(result.winnerTeam))
      || (result.voteWinner != null && !votedTarget(result.voteWinner))
      || !playerOrEmpty(result.eliminated) || !playerOrEmpty(result.protected)
      || (result.pairedWordId != null && !meaningful(result.pairedWordId))
      || (result.pairedWord != null && !meaningful(result.pairedWord))
      || (result.reused != null && typeof result.reused !== 'boolean')) return null;

  const providedPlayers = entry.players ?? [];
  if (!Array.isArray(providedPlayers) || providedPlayers.length > playerIds.size
      || providedPlayers.some(player => !object(player) || !playerIds.has(player.id) || !meaningful(player.name))
      || new Set(providedPlayers.map(player => player.id)).size !== providedPlayers.length) return null;
  const names = new Map(providedPlayers.map(({ id, name }) => [id, name]));
  const players = [...playerIds].map(id => ({ id, name: names.get(id) ?? id }));

  const guess = result.guess ?? null;
  if (guess !== null && (!object(guess) || !playerIds.has(guess.playerId)
      || typeof guess.correct !== 'boolean' || (guess.text != null && !meaningful(guess.text)))) return null;

  return {
    roundId,
    sessionId,
    source,
    completedAt: new Date(time).toISOString(),
    category,
    players,
    result: {
      id: roundId,
      mode,
      selectedMode: result.selectedMode ?? mode,
      wordId,
      word,
      pairedWordId: result.pairedWordId ?? null,
      pairedWord: result.pairedWord ?? null,
      category: result.category,
      reused: result.reused ?? false,
      roles: Object.fromEntries(roleEntries),
      votes: Object.fromEntries([...playerIds].map(id => [id, votes[id]])),
      voteWinner: result.voteWinner ?? null,
      eliminated: result.eliminated ?? null,
      protected: result.protected ?? null,
      winners: [...winners],
      winnerTeam: result.winnerTeam ?? null,
      reason,
      guess: guess === null ? null : { playerId: guess.playerId, text: guess.text ?? null, correct: guess.correct },
      points: Object.fromEntries([...playerIds].map(id => [id, points[id]])),
    },
  };
}

function unpack(contents) {
  if (!object(contents) || contents.version !== HISTORY_VERSION || !Array.isArray(contents.rounds)) {
    return { issues: [{ code: 'invalid_file' }] };
  }
  const issues = [];
  const rounds = [];
  contents.rounds.forEach((entry, index) => {
    const round = normalizeRound(entry);
    if (round) rounds.push(round);
    else issues.push({ code: 'invalid_round', row: index + 1 });
  });
  return { rounds, issues };
}

function refresh() {
  try {
    const value = globalThis.localStorage.getItem(HISTORY_KEY);
    if (value !== savedJSON) {
      const parsed = value === null ? { rounds: [], issues: [] } : unpack(JSON.parse(value));
      if (parsed.issues.length) throw new Error('Invalid history document');
      saved = parsed.rounds;
      savedJSON = value;
    }
    readable = true;
  } catch {
    readable = false;
  }
}

function byNewest(first, second) {
  return Date.parse(second.completedAt) - Date.parse(first.completedAt);
}

function combined() {
  const entries = new Map();
  if (!clearedInMemory) {
    for (const round of saved) {
      if (!entries.has(round.roundId)) entries.set(round.roundId, round);
    }
  }
  for (const [id, round] of pending) {
    if (!entries.has(id)) entries.set(id, round);
  }
  return [...entries.values()].sort(byNewest);
}

function documentFor(rounds) {
  return { version: HISTORY_VERSION, rounds };
}

function write() {
  if (!readable && !clearedInMemory) return false;
  try {
    const rounds = combined();
    const value = JSON.stringify(documentFor(rounds));
    globalThis.localStorage.setItem(HISTORY_KEY, value);
    saved = rounds;
    savedJSON = value;
    readable = true;
    pending.clear();
    clearedInMemory = false;
    return true;
  } catch {
    return false;
  }
}

function persisted() {
  return readable && !clearedInMemory && pending.size === 0;
}

export function readHistory() {
  refresh();
  return structuredClone(combined());
}

export function recordRound(entry) {
  const round = normalizeRound(entry, { live: true });
  refresh();
  if (!round) return { ok: false, added: false, persisted: persisted(), issues: [{ code: 'invalid_round' }] };
  if (combined().some(item => item.roundId === round.roundId)) {
    return { ok: true, added: false, persisted: persisted() || write() };
  }
  pending.set(round.roundId, round);
  return { ok: true, added: true, persisted: write() };
}

export function serializeHistory(entries = readHistory()) {
  return `${JSON.stringify(documentFor(entries), null, 2)}\n`;
}

export function importHistory(contents) {
  refresh();
  const problem = code => ({ ok: false, added: 0, persisted: persisted(), issues: [{ code }] });
  if (typeof contents !== 'string') return problem('invalid_file');
  if (contents.length > MAX_FILE_BYTES || new TextEncoder().encode(contents).byteLength > MAX_FILE_BYTES) {
    return problem('file_size');
  }
  let parsed;
  try {
    parsed = JSON.parse(contents.replace(/^\uFEFF/u, ''));
  } catch {
    return problem('invalid_json');
  }
  const { rounds, issues } = unpack(parsed);
  if (issues.length) return { ok: false, added: 0, persisted: persisted(), issues };

  const existing = new Set(combined().map(round => round.roundId));
  let added = 0;
  for (const round of rounds) {
    if (existing.has(round.roundId)) continue;
    existing.add(round.roundId);
    pending.set(round.roundId, round);
    added += 1;
  }
  return { ok: true, added, persisted: persisted() || write() };
}

export function clearHistory() {
  pending.clear();
  clearedInMemory = true;
  return { ok: true, persisted: write() };
}

function addCounter(counters, key, won) {
  const counter = counters[key] ??= { played: 0, wins: 0 };
  counter.played += 1;
  counter.wins += Number(won);
}

export function summarizeHistory(entries = readHistory()) {
  const seen = new Set();
  const players = new Map();
  const byMode = {};
  const byRole = {};
  for (const round of [...entries].sort(byNewest)) {
    if (seen.has(round.roundId)) continue;
    seen.add(round.roundId);
    const { mode, roles, winners, points } = round.result;
    byMode[mode] = (byMode[mode] ?? 0) + 1;
    for (const { id, name } of round.players) {
      const key = `${round.source}:${id}`;
      if (!players.has(key)) {
        players.set(key, { id, name, source: round.source, points: 0, played: 0, wins: 0,
          imposterGames: 0, imposterWins: 0, byRole: {}, byMode: {} });
      }
      const role = roles[id];
      const won = winners.includes(id);
      const player = players.get(key);
      byRole[role] = (byRole[role] ?? 0) + 1;
      player.points += points[id];
      player.played += 1;
      player.wins += Number(won);
      if (IMPOSTERS.has(role)) {
        player.imposterGames += 1;
        player.imposterWins += Number(won);
      }
      addCounter(player.byRole, role, won);
      addCounter(player.byMode, mode, won);
    }
  }
  const ranked = [...players.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
  return { roundCount: seen.size, players: ranked, byMode, byRole };
}

export function mountHistory(root, context = {}) {
  const { lang = 'sv', t, modeName, roleName, signal } = context;
  const document = root.ownerDocument;
  const browser = document.defaultView;
  const translate = (key, values) => t(`extras.history.${key}`, values);
  const dates = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  const months = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'long' });
  const percent = new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 1 });
  let entries = [];

  function element(tag, content, className) {
    const node = document.createElement(tag);
    if (content != null) node.textContent = content;
    if (className) node.className = className;
    return node;
  }

  function button(label, handler, variant = 'secondary') {
    if (context.button) return context.button(translate(label), handler, { variant });
    const control = element('button', translate(label), `button button--${variant}`);
    control.type = 'button';
    control.addEventListener('click', handler);
    return control;
  }

  function filter(label) {
    const wrapper = element('label', null, 'field');
    const select = element('select');
    wrapper.append(element('span', translate(label)), select);
    select.addEventListener('change', renderData);
    return { wrapper, select };
  }

  function options({ select }, values) {
    const formerValue = select.value;
    select.replaceChildren();
    for (const [value, name] of values) {
      const option = element('option', name);
      option.value = value;
      select.append(option);
    }
    if (values.some(([value]) => value === formerValue)) select.value = formerValue;
  }

  function details(title) {
    const section = element('details', null, 'extras-history__details panel panel--subtle');
    section.append(element('summary', title));
    return section;
  }

  function metrics(items) {
    const list = element('dl', null, 'extras-history__metrics');
    for (const [label, value] of items) {
      const metric = element('div');
      const definition = element('dd');
      definition.append(value);
      metric.append(element('dt', label, 'muted'), definition);
      list.append(metric);
    }
    return list;
  }

  function bulletList(items) {
    const list = element('ul', null, 'extras-history__list');
    for (const item of items) list.append(element('li', item));
    return list;
  }

  const source = filter('bySource');
  const session = filter('bySession');
  const mode = filter('byMode');
  const sessionKey = round => JSON.stringify([round.source, round.sessionId]);
  const modeLabel = id => modeName?.(id) ?? id;
  const roleLabel = id => roleName?.(id) ?? id;
  const sourceLabel = id => translate(`source.${id}`);
  const categoryNames = new Map();
  const categories = element('div', null, 'stack extras-history__output');
  const status = element('p');
  status.setAttribute('role', 'status');
  const issues = element('div', null, 'extras-history__issues');
  const storage = element('p', null, 'muted');
  const confirmation = element('div');
  confirmation.hidden = true;
  const importInput = element('input');
  importInput.type = 'file';
  importInput.accept = '.json,application/json';
  importInput.hidden = true;
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    let parsed;
    try {
      if (file.size > MAX_FILE_BYTES) parsed = { ok: false, issues: [{ code: 'file_size' }] };
      else {
        const text = await file.text();
        if (signal?.aborted) return;
        parsed = importHistory(text);
      }
    } catch {
      if (!signal?.aborted) report(translate('filesUnsupported'), true);
      return;
    }
    if (parsed.ok) {
      reload();
      report(parsed.added ? translate('imported', { count: parsed.added }) : translate('importEmpty'));
      return;
    }
    report(translate('importInvalid'), true);
    const messages = parsed.issues.slice(0, 25).map(issue => {
      const message = translate(`issue.${issue.code}`);
      return issue.row ? translate('issue.line', { line: issue.row, message }) : message;
    });
    if (parsed.issues.length > messages.length) {
      messages.push(translate('issue.more', { count: parsed.issues.length - messages.length }));
    }
    issues.append(element('h2', translate('issues')), bulletList(messages));
  });

  function report(message = '', error = false) {
    status.textContent = message;
    status.className = error ? 'error' : 'muted';
    if (error) status.setAttribute('role', 'alert');
    else status.setAttribute('role', 'status');
    issues.replaceChildren();
  }

  const exportButton = button('export', () => {
    try {
      const data = new Blob([serializeHistory()], { type: 'application/json;charset=utf-8' });
      const url = browser.URL.createObjectURL(data);
      const link = element('a');
      link.href = url;
      link.download = `imposter-history-${new Date().toISOString().slice(0, 10)}.json`;
      link.hidden = true;
      root.append(link);
      link.click();
      link.remove();
      browser.setTimeout(() => browser.URL.revokeObjectURL(url), 1000);
    } catch {
      report(translate('filesUnsupported'), true);
    }
  });
  const clearButton = button('clear', () => {
    confirmation.hidden = false;
    cancelButton.focus();
  }, 'danger');
  const cancelButton = button('cancel', () => {
    confirmation.hidden = true;
    clearButton.focus();
  });
  const clearActions = element('div', null, 'cluster');
  clearActions.append(cancelButton, button('clearApply', () => {
    clearHistory();
    confirmation.hidden = true;
    reload();
    report(translate('cleared'));
    exportButton.focus();
  }, 'danger'));
  confirmation.append(element('p', translate('clearConfirm')), clearActions);

  function renderStats(filtered) {
    const { roundCount, players, byMode } = summarizeHistory(filtered);
    const section = element('section', null, 'panel stack');
    section.append(element('h2', translate('statistics')),
      element('p', translate('summary', { rounds: roundCount, players: players.length }), 'muted'));
    section.append(metrics(Object.entries(byMode).map(([id, count]) => [modeLabel(id), count])));

    const byMonth = new Map();
    for (const round of filtered) {
      const month = months.format(Date.parse(round.completedAt));
      if (!byMonth.has(month)) byMonth.set(month, {});
      const counts = byMonth.get(month);
      for (const role of Object.values(round.result.roles)) counts[role] = (counts[role] ?? 0) + 1;
    }
    const distribution = details(translate('periodRoles'));
    for (const [month, counts] of byMonth) {
      distribution.append(element('h3', month), metrics(Object.entries(counts).map(([id, count]) => [roleLabel(id), count])));
    }
    section.append(distribution);

    const rankings = element('ol', null, 'extras-history__rankings');
    for (const player of players) {
      const { imposterWins, imposterGames } = player;
      const rate = imposterGames ? translate('rate', {
        wins: imposterWins,
        played: imposterGames,
        rate: percent.format(imposterWins / imposterGames),
      }) : '0 / 0';
      const rank = element('li', null, 'panel panel--subtle');
      const heading = element('h3', player.name);
      rank.append(heading, metrics([
        [translate('points'), player.points],
        [translate('wins'), player.wins],
        [translate('played'), player.played],
        [translate('imposterSuccess'), rate],
      ]));
      const roles = details(translate('roles'));
      roles.append(metrics(Object.entries(player.byRole).map(([id, record]) => [roleLabel(id), record.played])));
      const modes = details(translate('byMode'));
      modes.append(metrics(Object.entries(player.byMode).map(([id, record]) => [modeLabel(id), translate('rate', {
        wins: record.wins,
        played: record.played,
        rate: percent.format(record.wins / record.played),
      })])));
      rank.append(roles, modes);
      rankings.append(rank);
    }
    section.append(rankings);
    return section;
  }

  function renderRound(round) {
    const { result, players } = round;
    const names = new Map(players.map(({ id, name }) => [id, name]));
    const playerName = id => names.get(id) ?? translate('unknown');
    const targetName = id => {
      if (id === '@all') return translate('groupAll');
      if (id === '@none') return translate('groupNone');
      return playerName(id);
    };
    const section = details(translate('roundLabel', {
      date: dates.format(Date.parse(round.completedAt)),
      mode: modeLabel(result.mode),
    }));
    const displayMode = result.mode === result.selectedMode
      ? modeLabel(result.mode) : `${modeLabel(result.mode)} (${modeLabel(result.selectedMode)})`;
    const category = element('span', categoryNames.get(round.category)?.[lang] ?? round.category);
    category.dataset.categoryLabel = round.category;
    const words = result.pairedWord ? `${result.word} / ${result.pairedWord}` : result.word;
    section.append(metrics([
      [translate('bySource'), sourceLabel(round.source)],
      [translate('mode'), displayMode],
      [translate('category'), category],
      [translate(result.pairedWord ? 'words' : 'word'), words],
      [translate('reason'), translate(`reason.${result.reason}`)],
    ]));
    section.append(element('h3', translate('winners')), result.winners.length
      ? bulletList(result.winners.map(playerName)) : element('p', translate('noWinners')));
    section.append(element('h3', translate('participants')), bulletList(players.map(({ id, name }) =>
      translate('roundPlayer', { player: name, role: roleLabel(result.roles[id]) }))));
    section.append(element('h3', translate('ballots')), bulletList(players.map(({ id, name }) =>
      translate('roundVote', { player: name, target: targetName(result.votes[id]) }))));
    return section;
  }

  function renderData() {
    const filtered = entries.filter(round => (!source.select.value || round.source === source.select.value)
      && (!session.select.value || sessionKey(round) === session.select.value)
      && (!mode.select.value || round.result.mode === mode.select.value));
    categories.replaceChildren();
    if (!filtered.length) {
      categories.append(element('p', translate('empty'), 'panel panel--subtle'));
      return;
    }
    const rounds = element('section', null, 'stack');
    rounds.append(element('h2', translate('rounds')));
    for (const round of filtered) rounds.append(renderRound(round));
    categories.append(renderStats(filtered), rounds);
  }

  function reload() {
    entries = readHistory();
    storage.textContent = translate(persisted() ? 'stored' : 'memoryOnly');
    options(source, [['', translate('allSources')], ...[...SOURCES].map(id => [id, sourceLabel(id)])]);
    const sessions = new Map();
    for (const round of [...entries].reverse()) {
      if (round.sessionId === null) continue;
      const key = sessionKey(round);
      if (!sessions.has(key)) sessions.set(key, round);
    }
    options(session, [['', translate('allSessions')], ...[...sessions].map(([key, round], index) => [
      key, `${sourceLabel(round.source)} · ${translate('sessionLabel', {
        number: index + 1,
        date: dates.format(Date.parse(round.completedAt)),
      })}`,
    ])]);
    session.select.disabled = sessions.size === 0;
    const playedModes = new Set(entries.map(round => round.result.mode));
    options(mode, [['', translate('allModes')], ...[...playedModes].map(id => [id, modeLabel(id)])]);
    clearButton.disabled = !entries.length && persisted();
    renderData();
  }

  const header = element('header', null, 'page-header');
  header.append(element('h1', translate('title')), element('p', translate('intro'), 'muted'));
  const controls = element('div', null, 'cluster');
  controls.append(exportButton, button('import', () => importInput.click()), clearButton, importInput);
  const filters = element('fieldset', null, 'panel');
  const filterFields = element('div', null, 'extras-history__filters');
  filterFields.append(source.wrapper, session.wrapper, mode.wrapper);
  filters.append(element('legend', translate('filters')), filterFields);
  const page = element('div', null, 'stack extras-history');
  page.append(header, storage, controls, confirmation, status, issues, filters, categories);
  root.replaceChildren(page);
  const rememberCategories = items => {
    for (const item of items ?? []) categoryNames.set(item.id, item.names);
  };
  rememberCategories(context.customCategories);
  reload();
  if (browser?.fetch) {
    browser.fetch('/api/content/manifest', { signal }).then(response => response.ok ? response.json() : null)
      .then(manifest => {
        if (!manifest || signal?.aborted) return;
        rememberCategories(manifest.categories);
        for (const label of categories.querySelectorAll('[data-category-label]')) {
          const id = label.dataset.categoryLabel;
          label.textContent = categoryNames.get(id)?.[lang] ?? id;
        }
      }).catch(() => {});
  }
  const updatedElsewhere = event => {
    if (event.key === HISTORY_KEY || event.key === null) reload();
  };
  browser?.addEventListener('storage', updatedElsewhere);
  return () => browser?.removeEventListener('storage', updatedElsewhere);
}
