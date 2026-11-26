const PROFILE_SETTINGS = ["joker", "extraRole", "randomMin", "randomMax", "lastGuess"];
const COMMON_SETTINGS = [
  "clueRounds", "discussionSeconds", "clueStyle", "language", "hint",
  "categories", "subcategories", "levels", "freePlay",
];
const PHASE_ACTIONS = new Map([
  ["ack_role", "roles"], ["clue", "clues"], ["ability", "abilities"],
  ["end_discussion", "discussion"], ["vote", "voting"], ["guess", "last_guess"],
  ["reveal_roles", "playing"],
]);
const FINISHED_PHASES = new Set(["reveal", "aborted"]);

export class EngineError extends Error {
  constructor(code, issues = []) {
    super(code);
    this.name = "EngineError";
    this.code = code;
    this.issues = issues;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function trim(text) {
  return text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
}

function nonempty(value) {
  return typeof value === "string" && trim(value).length > 0;
}

function normalizeGuess(text) {
  return trim(text).normalize("NFC").toLowerCase().replace(/\p{White_Space}+/gu, " ");
}

function sameSetting(first, second) {
  if (Array.isArray(first) && Array.isArray(second)) {
    return first.length === second.length && first.every((value, index) => value === second[index]);
  }
  return first === second;
}

function stringList(value) {
  return Array.isArray(value) && value.every(nonempty);
}

function commonSettingsValid(settings, rules) {
  return typeof settings.freePlay === "boolean"
    && rules.clueRounds.includes(settings.clueRounds)
    && rules.discussionSeconds.includes(settings.discussionSeconds)
    && rules.clueStyles.includes(settings.clueStyle)
    && rules.languages.includes(settings.language)
    && rules.hints.includes(settings.hint)
    && stringList(settings.categories)
    && stringList(settings.subcategories)
    && stringList(settings.levels)
    && settings.levels.length > 0
    && settings.levels.every(level => rules.levels.includes(level));
}

function profileSettingsValid(settings, rules) {
  return typeof settings.joker === "boolean"
    && typeof settings.lastGuess === "boolean"
    && (settings.extraRole === null || (
      typeof settings.extraRole === "string" && Object.hasOwn(rules.extras, settings.extraRole)
    ))
    && (settings.randomMin === null || Number.isInteger(settings.randomMin))
    && (settings.randomMax === null || Number.isInteger(settings.randomMax));
}

function selectContent(words, pairs, settings) {
  const categories = new Set(settings.categories);
  const subcategories = new Set(settings.subcategories);
  const levels = new Set(settings.levels);
  const byId = new Map();
  for (const entry of Array.isArray(words) ? words : []) {
    if (!isRecord(entry) || !nonempty(entry.id) || !nonempty(entry.category) || byId.has(entry.id)) continue;
    if (categories.size && !categories.has(entry.category)) continue;
    if (subcategories.size && !subcategories.has(entry.subcategory)) continue;
    if (!levels.has(entry.level)) continue;
    const language = isRecord(entry.languages) ? entry.languages[settings.language] : null;
    if (!isRecord(language) || !nonempty(language.word) || !isRecord(language.hints)) continue;
    const hint = language.hints[settings.hint];
    if (!nonempty(hint)) continue;
    byId.set(entry.id, {
      id: entry.id, category: entry.category, word: language.word, hint,
      aliases: Array.isArray(language.aliases)
        ? language.aliases.filter(alias => typeof alias === "string") : [],
    });
  }

  const uniquePairs = [];
  const pairKeys = new Set();
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    if (!stringList(pair) || pair.length !== 2) continue;
    const [first, second] = pair;
    if (first === second || !byId.has(first) || !byId.has(second)) continue;
    const key = JSON.stringify(first < second ? [first, second] : [second, first]);
    if (pairKeys.has(key)) continue;
    pairKeys.add(key);
    uniquePairs.push([byId.get(first), byId.get(second)]);
  }
  return { words: [...byId.values()], pairs: uniquePairs };
}

function validateProfile(settings, playerCount, content, rules, addIssue) {
  const { mode, extraRole, randomMin, randomMax, lastGuess } = settings;
  const rule = rules.modes[mode];
  const joker = Boolean(rule.forcedJoker || settings.joker);
  const extra = extraRole === null ? null : rules.extras[extraRole];
  const freePlayRandom = rule.imposters === "random" && settings.freePlay && !joker && !extra
    ? rules.freePlayRandom : null;
  const wholeCount = Number.isInteger(playerCount);
  const countOk = wholeCount && playerCount >= rule.min && playerCount <= rules.playerMax;
  if (!countOk) addIssue("player_count", mode);
  if (joker && !rule.joker) addIssue("joker_incompatible", mode);
  if (joker && wholeCount && playerCount < rules.jokerMin) addIssue("joker_players", mode);
  if (extra && !extra.modes.includes(mode)) addIssue("extra_incompatible", mode);
  if (extra && wholeCount && playerCount < extra.min) addIssue("extra_players", mode);

  let counts = [];
  if (countOk && rule.imposters === "all") {
    counts = [playerCount];
  } else if (countOk && rule.imposters === "reverse") {
    counts = [playerCount - 1];
  } else if (countOk && rule.imposters === 0) {
    counts = [0];
  } else if (countOk) {
    const numberOfAllies = extra?.team === "impostors" && !extra.replacesImposter ? 1 : 0;
    const validDistribution = count => {
      const impostorTeam = count + numberOfAllies;
      const civils = playerCount - impostorTeam - Number(joker);
      return count >= 1 && civils > impostorTeam && (!joker || civils >= rules.jokerCivilMin);
    };
    if (rule.imposters === "random") {
      const lower = freePlayRandom?.min ?? 1;
      const upper = freePlayRandom?.max === "players" ? playerCount : Math.floor((playerCount - 1) / 2);
      for (let count = lower; count <= upper; count += 1) {
        if (freePlayRandom || validDistribution(count)) counts.push(count);
      }
      if (counts.length === 0) {
        addIssue("invalid_distribution", mode);
      } else {
        const min = randomMin ?? counts[0];
        const max = randomMax ?? counts.at(-1);
        if (!counts.includes(min) || !counts.includes(max) || min > max) {
          addIssue("invalid_random_range", mode);
        }
        counts = counts.filter(count => count >= min && count <= max);
      }
    } else {
      counts = [rule.imposters];
      if (!validDistribution(rule.imposters)) addIssue("invalid_distribution", mode);
    }
  }

  if (lastGuess && !rule.lastGuess) addIssue("last_guess_incompatible", mode);
  const requiresPair = Boolean(rule.requiresPair || extra?.requiresPair);
  if (!content.words.length) addIssue("no_words", mode);
  if (requiresPair && !content.pairs.length) addIssue("no_pairs", mode);
  return { settings: { ...settings, joker }, rule, extra, requiresPair, counts };
}

function prepare(settings, playerCount, words, pairs, rules) {
  const issues = [];
  const addIssue = (code, mode) => issues.push({ code, mode });
  if (!isRecord(settings)) {
    addIssue("invalid_settings", null);
    return { issues };
  }
  const selected = { ...rules.defaults, ...settings };
  const { mode } = selected;
  const modeId = typeof mode === "string" ? mode : null;
  if (modeId === null || !Object.hasOwn(rules.modes, modeId)) {
    addIssue("invalid_mode", modeId);
    return { issues };
  }
  if (!commonSettingsValid(selected, rules) || !profileSettingsValid(selected, rules)) {
    addIssue("invalid_settings", mode);
    return { issues };
  }
  const content = selectContent(words, pairs, selected);
  if (mode !== "chaos") {
    const profiles = [validateProfile(selected, playerCount, content, rules, addIssue)];
    return { selected, profiles, content, issues };
  }

  if (!Number.isInteger(playerCount) || playerCount < rules.modes.chaos.min || playerCount > rules.playerMax) {
    addIssue("player_count", mode);
  }
  const profiles = [];
  if (!Array.isArray(selected.chaos) || selected.chaos.length === 0) {
    addIssue("chaos_empty", mode);
  } else {
    for (const profile of selected.chaos) {
      if (!isRecord(profile)) {
        addIssue("invalid_settings", null);
        continue;
      }
      const profileMode = typeof profile.mode === "string" ? profile.mode : null;
      if (!Number.isFinite(profile.weight) || profile.weight <= 0) {
        addIssue("chaos_weight", profileMode);
      }
      if (profileMode === null || profileMode === "chaos" || !Object.hasOwn(rules.modes, profileMode)) {
        addIssue("invalid_mode", profileMode);
        continue;
      }
      if (COMMON_SETTINGS.some(key => (
        Object.hasOwn(profile, key) && !sameSetting(profile[key], selected[key])
      ))) {
        addIssue("invalid_settings", profileMode);
        continue;
      }
      const effective = { ...selected, mode: profileMode, weight: profile.weight };
      for (const key of PROFILE_SETTINGS) {
        if (Object.hasOwn(profile, key)) effective[key] = profile[key];
      }
      if (!Object.hasOwn(profile, "lastGuess") && !rules.modes[profileMode].lastGuess) {
        effective.lastGuess = false;
      }
      if (!profileSettingsValid(effective, rules)) {
        addIssue("invalid_settings", profileMode);
        continue;
      }
      profiles.push(validateProfile(effective, playerCount, content, rules, addIssue));
    }
  }
  return { selected, profiles, content, issues };
}

export function profileIssues(settings, playerCount, words, pairs, rules) {
  return prepare(settings, playerCount, words, pairs, rules).issues;
}

function randomValue() {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
}

function choose(values, rng) {
  return values[Math.floor(rng() * values.length)];
}

function shuffled(values, rng) {
  const result = [...values];
  for (let last = result.length - 1; last > 0; last -= 1) {
    const index = Math.floor(rng() * (last + 1));
    [result[index], result[last]] = [result[last], result[index]];
  }
  return result;
}

function chooseProfile(profiles, rng) {
  let maxWeight = 0;
  for (const { settings } of profiles) maxWeight = Math.max(maxWeight, settings.weight);
  const weights = profiles.map(({ settings }) => settings.weight / maxWeight);
  const draw = rng() * weights.reduce((sum, weight) => sum + weight, 0);
  let cumulative = 0;
  for (let index = 0; index < profiles.length; index += 1) {
    cumulative += weights[index];
    if (draw < cumulative) return profiles[index];
  }
  return profiles.at(-1);
}

function effectiveMode(mode, count, playerCount, rules) {
  if (mode !== "random") return mode;
  const specials = rules.freePlayRandom.specialCounts;
  if (count === 0) return specials.zero;
  if (count === playerCount - 1) return specials.allButOne;
  if (count === playerCount) return specials.all;
  return mode;
}

function selectWords(content, requiresPair, used, rng) {
  const recent = new Map(used.map((id, index) => [id, index]));
  const candidates = requiresPair ? content.pairs : content.words.map(word => [word]);
  let bestRank = [Infinity, Infinity, Infinity];
  let best = [];
  for (const candidate of candidates) {
    const first = recent.get(candidate[0].id) ?? -1;
    const second = requiresPair ? recent.get(candidate[1].id) ?? -1 : -1;
    const rank = [Number(first >= 0) + Number(second >= 0), Math.max(first, second), Math.min(first, second)];
    const difference = rank[0] - bestRank[0] || rank[1] - bestRank[1] || rank[2] - bestRank[2];
    if (difference < 0) {
      bestRank = rank;
      best = [candidate];
    } else if (difference === 0) {
      best.push(candidate);
    }
  }
  const chosen = choose(best, rng);
  const [word, pairedWord = null] = requiresPair && rng() >= 0.5 ? [...chosen].reverse() : chosen;
  return { word, pairedWord, reused: bestRank[0] > 0 };
}

function assignRoles(ids, profile, count, rng) {
  const { mode, joker, extraRole } = profile.settings;
  const assignments = new Map(ids.map(id => [id, "civil"]));
  const dealt = shuffled(ids, rng);
  let actual = [];
  if (mode === "undercover") {
    assignments.set(dealt[0], "undercover");
  } else {
    actual = mode === "reverse" ? dealt.slice(1) : dealt.slice(0, count);
    for (const id of actual) assignments.set(id, "imposter");
    if (profile.extra?.replacesImposter) assignments.set(actual[0], extraRole);
    if (joker) assignments.set(dealt[count], "joker");
    if (profile.extra && !profile.extra.replacesImposter) {
      assignments.set(dealt[count + Number(joker)], extraRole);
    }
  }
  const accomplicePartner = extraRole === "accomplice" ? choose(actual, rng) : null;
  return { assignments, actual: new Set(actual), accomplicePartner };
}

function newId(rng) {
  const parts = Array.from({ length: 4 }, () => Math.floor(rng() * 0x100000000).toString(16).padStart(8, "0"));
  return `round-${parts.join("")}`;
}

function checkedPlayers(players, rules) {
  if (!Array.isArray(players)) throw new EngineError("invalid_players");
  const ids = new Set();
  return players.map(player => {
    if (!isRecord(player) || !nonempty(player.id) || ids.has(player.id)
        || rules.groupOptions.includes(player.id) || !nonempty(player.name)) {
      throw new EngineError("invalid_players");
    }
    ids.add(player.id);
    return { id: player.id, name: player.name };
  });
}

export function createRound(players, settings, words, pairs, rules, { rng, used, now, flow } = {}) {
  const roster = checkedPlayers(players, rules);
  const { selected, profiles, content, issues } = prepare(settings, roster.length, words, pairs, rules);
  if (issues.length) throw new EngineError(issues[0].code, issues);
  instant(now);
  if (flow !== undefined && flow !== "table") throw new EngineError("invalid_data");
  const random = rng ?? randomValue;
  const chaos = selected.mode === "chaos";
  const drawn = chaos ? chooseProfile(profiles, random) : profiles[0];
  const count = drawn.rule.imposters === "random" ? choose(drawn.counts, random) : drawn.counts[0];
  const mode = effectiveMode(drawn.settings.mode, count, roster.length, rules);
  const effectiveRule = rules.modes[mode];
  const profile = {
    ...drawn, rule: effectiveRule,
    settings: { ...drawn.settings, mode, lastGuess: drawn.settings.lastGuess && Boolean(effectiveRule.lastGuess) },
  };
  const chosen = selectWords(content, profile.requiresPair, used ?? [], random);
  const ids = roster.map(({ id }) => id);
  const roles = assignRoles(ids, profile, count, random);
  const order = shuffled(ids, random);
  const id = newId(random);
  let groupOptions = effectiveRule.groupOption ? [effectiveRule.groupOption] : [];
  let neutralGuess = false;
  if (chaos || (selected.mode === "random" && selected.freePlay)) {
    const possible = profiles.flatMap(({ settings, counts }) => counts.map(count => ({
      rule: rules.modes[effectiveMode(settings.mode, count, roster.length, rules)],
      lastGuess: settings.lastGuess,
    })));
    groupOptions = possible.some(({ rule }) => rule.groupOption) ? rules.groupOptions : [];
    neutralGuess = possible.some(({ rule, lastGuess }) => lastGuess && rule.lastGuess);
  }
  return new Round({
    id, roster, ids, selected, profile, chosen, roles, order, rules, groupOptions, neutralGuess,
    table: flow === "table",
  });
}

function instant(now) {
  if (now == null) return Date.now();
  if (!Number.isInteger(now)) throw new EngineError("invalid_data");
  return now;
}

function actionText(value, limit) {
  if (typeof value !== "string") throw new EngineError("invalid_text");
  const text = trim(value);
  if (!text || [...text].length > limit) throw new EngineError("invalid_text");
  return text;
}

class Round {
  #round;
  #phase = "roles";
  #roleReady = new Set();
  #abilityReady = new Set();
  #votes = new Map();
  #investigations = new Map();
  #protection = null;
  #clueIndex = 0;
  #clues = [];
  #paused = false;
  #deadline = null;
  #remainingMs = null;
  #verdict = null;
  #guessPlayer = null;
  #guess = null;
  #result = null;

  constructor(round) {
    this.#round = round;
  }

  get phase() {
    return this.#phase;
  }

  localGuessNominee() {
    if (this.#phase !== "last_guess") return null;
    const { voteWinner } = this.#verdict;
    const { roles, order } = this.#round;
    return roles.assignments.has(voteWinner) ? voteWinner : order[0];
  }

  publicState() {
    const { id, selected, roster, ids, order, groupOptions } = this.#round;
    const { mode, clueStyle, clueRounds, discussionSeconds } = selected;
    const phase = this.#phase;
    const completed = { roles: this.#roleReady.size, abilities: this.#abilityReady.size, voting: this.#votes.size };
    return {
      id, mode, phase, players: roster.map(player => ({ ...player })), order: [...order],
      clueStyle, clueRounds, discussionSeconds,
      clueRound: phase === "clues" ? Math.floor(this.#clueIndex / order.length) + 1 : null,
      currentPlayerId: phase === "clues" ? order[this.#clueIndex % order.length] : null,
      clues: this.#clues.map(clue => ({ ...clue })), completed: completed[phase] ?? 0,
      options: phase === "voting" ? [...ids, ...groupOptions] : [],
      paused: this.#paused, deadline: this.#deadline, remainingMs: this.#remainingMs,
      result: this.#result === null ? null : structuredClone(this.#result),
    };
  }

  privateState(playerId) {
    const role = this.#role(playerId);
    const active = !FINISHED_PHASES.has(this.#phase);
    const cardAvailable = this.#round.table ? this.#phase === "roles" : active;
    const result = active ? this.#investigations.get(playerId) : null;
    return {
      playerId, card: cardAvailable ? this.#card(playerId, role) : null,
      roleReady: this.#roleReady.has(playerId), abilityReady: this.#abilityReady.has(playerId),
      voted: this.#votes.has(playerId),
      ability: this.#phase === "abilities" && (role === "guardian" || role === "detective") ? role : null,
      investigation: result ? { ...result } : null,
      canGuess: this.#phase === "last_guess" && this.#guessPlayer === playerId && this.#guess === null,
    };
  }

  #role(playerId) {
    const role = this.#round.roles.assignments.get(playerId);
    if (role === undefined) throw new EngineError("unknown_player");
    return role;
  }

  #card(playerId, role) {
    const { selected, profile, chosen, roles } = this.#round;
    const mode = profile.settings.mode;
    const card = { role, word: null, hint: null, partners: [] };
    if (mode === "undercover" || (selected.mode === "chaos" && role === "civil")) card.role = null;
    if (role === "imposter" || role === "accomplice") {
      if (mode !== "blind") card.hint = chosen.word.hint;
      if (role === "imposter" && mode === "alliance") {
        card.partners = [...roles.actual].filter(id => id !== playerId);
      } else if (role === "accomplice") {
        card.partners = [roles.accomplicePartner];
      }
    } else {
      card.word = (role === "undercover" || role === "spy" ? chosen.pairedWord : chosen.word).word;
    }
    return card;
  }

  act(playerId, action, data, now) {
    const role = this.#role(playerId);
    if (action !== "abort" && !PHASE_ACTIONS.has(action)) throw new EngineError("unknown_action");
    if (data != null && !isRecord(data)) throw new EngineError("invalid_data");
    data ??= {};
    now = instant(now);
    this.tick(now);
    if (FINISHED_PHASES.has(this.#phase)) throw new EngineError("wrong_phase");
    if (action === "abort") {
      this.#finish("aborted");
      return true;
    }
    if (this.#paused) throw new EngineError("paused");
    if (PHASE_ACTIONS.get(action) !== this.#phase) throw new EngineError("wrong_phase");

    switch (action) {
      case "ack_role":
        if (this.#roleReady.has(playerId)) throw new EngineError("already_done");
        this.#roleReady.add(playerId);
        if (this.#roleReady.size === this.#round.ids.length) {
          this.#phase = this.#round.table ? "playing" : "clues";
        }
        break;
      case "clue":
        this.#clue(playerId, data.text, now);
        break;
      case "ability":
        this.#ability(playerId, role, data.targetId ?? null, now);
        break;
      case "end_discussion":
        this.#startVoting();
        break;
      case "vote":
        this.#vote(playerId, data.targetId, now);
        break;
      case "guess":
        this.#submitGuess(playerId, data.text ?? null);
        break;
      case "reveal_roles":
        this.#revealTable();
        break;
    }
    return true;
  }

  tick(now) {
    now = instant(now);
    if (this.#paused || this.#deadline === null || now < this.#deadline) return false;
    if (this.#phase === "discussion") {
      this.#startVoting();
    } else if (this.#phase === "last_guess") {
      if (this.#guessPlayer !== null && this.#guess === null) {
        this.#guess = { playerId: this.#guessPlayer, text: null, correct: false };
      }
      this.#reveal();
    }
    return true;
  }

  pause(now) {
    now = instant(now);
    if (this.#paused || FINISHED_PHASES.has(this.#phase)) return false;
    const changed = this.tick(now);
    if (FINISHED_PHASES.has(this.#phase)) return changed;
    this.#paused = true;
    this.#remainingMs = this.#deadline === null ? null : this.#deadline - now;
    this.#deadline = null;
    return true;
  }

  resume(now) {
    now = instant(now);
    if (!this.#paused) return false;
    this.#paused = false;
    this.#deadline = this.#remainingMs === null ? null : now + this.#remainingMs;
    this.#remainingMs = null;
    return true;
  }

  #clue(playerId, text, now) {
    const { order, selected, profile, rules } = this.#round;
    if (order[this.#clueIndex % order.length] !== playerId) throw new EngineError("not_your_turn");
    if (selected.clueStyle === "text") {
      this.#clues.push({
        playerId, round: Math.floor(this.#clueIndex / order.length) + 1,
        text: actionText(text, rules.clueMaxLength),
      });
    }
    this.#clueIndex += 1;
    if (this.#clueIndex === order.length * selected.clueRounds) {
      if (selected.mode === "chaos" || profile.extra?.ability) this.#phase = "abilities";
      else this.#startDiscussion(now);
    }
  }

  #ability(playerId, role, target, now) {
    if (this.#abilityReady.has(playerId)) throw new EngineError("already_done");
    if (target !== null) {
      const targetRole = this.#round.roles.assignments.get(target);
      if (target === playerId || !targetRole || (role !== "detective" && role !== "guardian")) {
        throw new EngineError("invalid_target");
      }
      if (role === "guardian") this.#protection = target;
      else this.#investigations.set(playerId, { playerId: target, impostorTeam: this.#isImpostor(targetRole) });
    }
    this.#abilityReady.add(playerId);
    if (this.#abilityReady.size === this.#round.ids.length) this.#startDiscussion(now);
  }

  #isImpostor(role) {
    return role === "imposter" || this.#round.rules.extras[role]?.team === "impostors";
  }

  #startDiscussion(now) {
    this.#phase = "discussion";
    const seconds = this.#round.selected.discussionSeconds;
    this.#deadline = seconds === 0 ? null : now + seconds * 1000;
  }

  #startVoting() {
    this.#phase = "voting";
    this.#deadline = null;
  }

  #vote(playerId, target, now) {
    const { ids, groupOptions } = this.#round;
    if (this.#votes.has(playerId)) throw new EngineError("already_done");
    if (target === playerId || (!ids.includes(target) && !groupOptions.includes(target))) {
      throw new EngineError("invalid_target");
    }
    this.#votes.set(playerId, target);
    if (this.#votes.size === ids.length) this.#closeVoting(now);
  }

  #closeVoting(now) {
    const totals = new Map();
    for (const target of this.#votes.values()) totals.set(target, (totals.get(target) ?? 0) + 1);
    const maxVotes = Math.max(...totals.values());
    const leaders = [...totals].filter(([, total]) => total === maxVotes);
    const voteWinner = leaders.length === 1 ? leaders[0][0] : null;
    const { profile, roles, rules, neutralGuess } = this.#round;
    const protectedPlayer = voteWinner === this.#protection ? this.#protection : null;
    const eliminated = roles.assignments.has(voteWinner) && protectedPlayer === null ? voteWinner : null;
    const [winnerTeam, reason] = this.#voteOutcome(voteWinner, eliminated, profile.settings.mode);
    this.#verdict = { voteWinner, eliminated, protected: protectedPlayer, winnerTeam, reason };
    if (profile.settings.lastGuess && roles.actual.has(eliminated)) this.#guessPlayer = eliminated;
    if (this.#guessPlayer !== null || neutralGuess) {
      this.#phase = "last_guess";
      this.#deadline = now + rules.guessSeconds * 1000;
    } else {
      this.#reveal();
    }
  }

  #voteOutcome(voteWinner, eliminated, mode) {
    const { roles } = this.#round;
    const role = roles.assignments.get(eliminated);
    if (role === "joker") return ["joker", "joker_eliminated"];
    switch (mode) {
      case "all":
      case "none":
        return voteWinner === this.#round.rules.modes[mode].groupOption
          ? ["all", `${mode}_correct`]
          : ["none", `${mode}_missed`];
      case "reverse":
        return role === "civil" ? ["impostors", "reverse_civil_eliminated"] : ["civils", "reverse_civil_survived"];
      case "undercover":
        return role === "undercover" ? ["civils", "undercover_eliminated"] : ["impostors", "undercover_survived"];
      default:
        return roles.actual.has(eliminated) ? ["civils", "imposter_eliminated"] : ["impostors", "imposter_survived"];
    }
  }

  #submitGuess(playerId, input) {
    if (playerId !== this.#guessPlayer) throw new EngineError("not_your_turn");
    if (this.#guess !== null) throw new EngineError("already_done");
    const { chosen, rules, neutralGuess } = this.#round;
    const text = input === null ? null : actionText(input, rules.guessMaxLength);
    const possible = [chosen.word.word, ...chosen.word.aliases];
    const key = text === null ? null : normalizeGuess(text);
    const correct = key !== null && possible.some(alias => normalizeGuess(alias) === key);
    this.#guess = { playerId, text, correct };
    if (!neutralGuess) this.#reveal();
  }

  #finish(phase) {
    this.#phase = phase;
    this.#paused = false;
    this.#deadline = null;
    this.#remainingMs = null;
  }

  #revealDetails() {
    const { id, selected, profile, chosen, roles } = this.#round;
    return {
      id, mode: profile.settings.mode, selectedMode: selected.mode, wordId: chosen.word.id,
      word: chosen.word.word, pairedWordId: chosen.pairedWord?.id ?? null,
      pairedWord: chosen.pairedWord?.word ?? null, category: chosen.word.category,
      reused: chosen.reused, roles: Object.fromEntries(roles.assignments),
    };
  }

  #revealTable() {
    const cardContents = Object.fromEntries(Array.from(this.#round.roles.assignments, ([playerId, role]) => {
      const { word, hint } = this.#card(playerId, role);
      return [playerId, { word, hint }];
    }));
    this.#result = {
      ...this.#revealDetails(), cardContents, votes: {}, voteWinner: null, eliminated: null, protected: null,
      winners: [], winnerTeam: null, reason: "roles_revealed", guess: null, points: {},
    };
    this.#finish("reveal");
  }

  #reveal() {
    const { ids, roles, rules } = this.#round;
    const { voteWinner, eliminated, protected: protectedPlayer } = this.#verdict;
    let { winnerTeam, reason } = this.#verdict;
    if (this.#guess !== null) {
      if (this.#guess.correct) {
        winnerTeam = "impostors";
        reason = "guess_correct";
      } else {
        reason = this.#guess.text === null ? "guess_timeout" : "guess_wrong";
      }
    }

    const winners = ids.filter(playerId => {
      const role = roles.assignments.get(playerId);
      const isImpostor = this.#isImpostor(role) || role === "undercover";
      switch (winnerTeam) {
        case "all": return true;
        case "joker": return role === "joker";
        case "impostors": return isImpostor;
        case "civils": return !isImpostor && role !== "joker";
        default: return false;
      }
    });
    const winnersSet = new Set(winners);
    const winnerPoints = winnerTeam === "joker" ? rules.jokerPoints : rules.teamPoints;
    this.#result = {
      ...this.#revealDetails(),
      votes: Object.fromEntries(ids.map(playerId => [playerId, this.#votes.get(playerId)])),
      voteWinner, eliminated, protected: protectedPlayer, winners, winnerTeam, reason, guess: this.#guess,
      points: Object.fromEntries(ids.map(playerId => [playerId, winnersSet.has(playerId) ? winnerPoints : 0])),
    };
    this.#finish("reveal");
  }
}
