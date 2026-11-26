const LANGUAGES = ["sv", "en"];
const LEVELS = ["familiar", "intermediate", "expert"];
const HINT_LEVELS = ["easy", "normal", "hard"];
const REVIEW_STATUSES = ["editorial", "needs_review"];
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$(?![\s\S])/u;
const INVALID_TEXT = /[\u0000-\u001f\u007f]|\p{Cs}/u;
const WORD_SPACES = /\p{White_Space}+/gu;
const EDGE_SPACES = /^\p{White_Space}+|\p{White_Space}+$/gu;
const MAX_IMPORT_BYTES = 1024 * 1024;

export const CUSTOM_LIMITS = Object.freeze({
  bytes: 256 * 1024,
  categories: 50,
  subcategories: 200,
  words: 500,
  pairs: 1000,
  tags: 16,
  aliases: 16,
  idLength: 100,
  iconLength: 64,
  nameLength: 100,
  wordLength: 100,
  aliasLength: 100,
  hintLength: 160,
  tagLength: 40,
});

export class ContentValidationError extends Error {
  constructor(issues) {
    super(issues.map(({ path, message }) => `${path}: ${message}`).join("\n"));
    this.name = "ContentValidationError";
    this.issues = issues;
  }
}

class ContentRequestError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "ContentRequestError";
    this.code = code;
  }
}

function issue(code, path, message) {
  return { severity: "error", code, path, message };
}

function fail(code, path, message) {
  throw new ContentValidationError([issue(code, path, message)]);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value) {
  return typeof value === "string" && value.length <= CUSTOM_LIMITS.idLength && ID_PATTERN.test(value);
}

function isText(value) {
  return typeof value === "string" && Boolean(trimmed(value));
}

function trimmed(value) {
  return value.replace(EDGE_SPACES, "");
}

function normalizedTerm(value) {
  return trimmed(value.normalize("NFC")).toLowerCase().replace(WORD_SPACES, " ");
}

function compareIds(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortedWords(words) {
  return [...words].sort((left, right) => compareIds(left.id, right.id));
}

function orderedPair(left, right) {
  return left < right ? [left, right] : [right, left];
}

function pairKey([left, right]) {
  return `${left}:${right}`;
}

function sortedPairs(pairs) {
  return [...pairs].sort(([a, b], [c, d]) => compareIds(a, c) || compareIds(b, d));
}

function termIndexes() {
  return Object.fromEntries(LANGUAGES.map((language) => [language, { primary: new Map(), aliases: new Map() }]));
}

function spellings(word, language) {
  const translation = word.languages?.[language];
  if (!isText(translation?.word) || !Array.isArray(translation.aliases)) return null;
  return { primary: normalizedTerm(translation.word), aliases: translation.aliases.filter(isText).map(normalizedTerm) };
}

function duplicateWord(word, indexes) {
  for (const language of LANGUAGES) {
    const terms = spellings(word, language);
    if (!terms) continue;
    const index = indexes[language];
    const duplicate = index.primary.get(terms.primary) ?? index.aliases.get(terms.primary);
    if (duplicate !== undefined) return duplicate;
    for (const alias of terms.aliases) {
      const included = index.primary.get(alias);
      if (included !== undefined) return included;
    }
  }
  return undefined;
}

function indexWord(word, indexes) {
  for (const language of LANGUAGES) {
    const terms = spellings(word, language);
    if (!terms) continue;
    const index = indexes[language];
    index.primary.set(terms.primary, word.id);
    for (const alias of terms.aliases) index.aliases.set(alias, word.id);
  }
}

function packageSize(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    fail("invalid_json", "$", "The package must contain only JSON data.");
  }
}

/** Return a canonical package or throw ContentValidationError with field-level issues. */
export function validateCustom(value, base = null) {
  return normalizeCustom(value, base, false);
}

function normalizeCustom(value, base, aggregate) {
  if (!isObject(value)) fail("invalid_type", "custom", "Expected a package object.");
  if (!aggregate && packageSize(value) > CUSTOM_LIMITS.bytes) {
    fail("limit", "custom", `The package may contain at most ${CUSTOM_LIMITS.bytes} UTF-8 bytes of JSON.`);
  }

  const issues = [];
  const add = (code, path, message) => issues.push(issue(code, path, message));
  const baseCategories = base?.categories ?? [];
  const knownCategoryIds = new Set(baseCategories.map(({ id }) => id));
  const knownSubcategoryIds = new Set(baseCategories.flatMap(({ subcategories }) =>
    (subcategories ?? []).map(({ id }) => id)));
  const knownWordIds = new Set((base?.words ?? []).map(({ id }) => id));
  const categoryIds = new Map();
  const wordIds = new Map();
  const subcategoryIds = new Set();
  const pairsById = new Map();
  let subcategoryCount = 0;

  function packageLimit(key) {
    return aggregate ? Infinity : CUSTOM_LIMITS[key];
  }

  function object(entry, path) {
    if (isObject(entry)) return entry;
    add(entry === undefined ? "missing_field" : "invalid_type", path, "Expected an object.");
    return null;
  }

  function list(entries, path, max) {
    if (!Array.isArray(entries)) {
      add(entries === undefined ? "missing_field" : "invalid_type", path, "Expected a list.");
      return [];
    }
    if (entries.length <= max) return entries;
    add("limit", path, `Use at most ${max} entries.`);
    return entries.slice(0, max);
  }

  function text(entry, path, max) {
    if (typeof entry !== "string" || INVALID_TEXT.test(entry)) {
      add(entry === undefined ? "missing_field" : "invalid_text", path, "Expected text without control characters.");
      return null;
    }
    const clean = trimmed(entry);
    if (clean && [...clean].length <= max) return clean;
    add("invalid_text", path, `Enter 1 to ${max} characters.`);
    return null;
  }

  function identifier(entry, path) {
    if (isId(entry)) return entry;
    add(entry === undefined ? "missing_field" : "invalid_id", path, "Use a lowercase ID with letters a–z, digits, hyphens, or underscores.");
    return null;
  }

  function uniqueId(id, path, localIds, baseIds) {
    if (id && localIds.has(id)) add("duplicate_id", path, `ID ${id} already exists.`);
    if (id && baseIds.has(id)) add("id_conflict", path, `Public content uses ID ${id}.`);
  }

  function choice(entry, choices, path) {
    if (!choices.includes(entry)) {
      add(entry === undefined ? "missing_field" : "invalid_choice", path, `Choose one of ${choices.join(", ")}.`);
    }
    return entry;
  }

  function textList(entries, path, maxEntries, maxLength) {
    const keys = new Set();
    return list(entries, path, maxEntries).map((entry, index) => {
      const itemPath = `${path}[${index}]`;
      const clean = text(entry, itemPath, maxLength);
      if (clean) {
        const key = normalizedTerm(clean);
        if (keys.has(key)) add("duplicate_value", itemPath, "Repeated value.");
        keys.add(key);
      }
      return clean;
    });
  }

  function names(entry, path) {
    const name = object(entry, path);
    return name && Object.fromEntries(LANGUAGES.map((language) => [
      language, text(name[language], `${path}.${language}`, CUSTOM_LIMITS.nameLength),
    ]));
  }

  const categories = list(value.categories, "custom.categories", packageLimit("categories")).map((entry, index) => {
    const path = `custom.categories[${index}]`;
    const category = object(entry, path);
    if (!category) return null;
    const id = identifier(category.id, `${path}.id`);
    uniqueId(id, `${path}.id`, categoryIds, knownCategoryIds);
    const categorySubcategories = new Set();
    if (id) categoryIds.set(id, categorySubcategories);
    const subcategories = list(category.subcategories, `${path}.subcategories`, CUSTOM_LIMITS.subcategories);
    subcategoryCount += subcategories.length;
    return {
      id,
      names: names(category.names, `${path}.names`),
      icon: text(category.icon, `${path}.icon`, CUSTOM_LIMITS.iconLength),
      subcategories: subcategories.map((sub, subIndex) => {
        const subPath = `${path}.subcategories[${subIndex}]`;
        const subcategory = object(sub, subPath);
        if (!subcategory) return null;
        const subId = identifier(subcategory.id, `${subPath}.id`);
        uniqueId(subId, `${subPath}.id`, subcategoryIds, knownSubcategoryIds);
        if (subId) {
          subcategoryIds.add(subId);
          categorySubcategories.add(subId);
        }
        return { id: subId, names: names(subcategory.names, `${subPath}.names`) };
      }),
    };
  });
  if (subcategoryCount > packageLimit("subcategories")) {
    add("limit", "custom.categories", `Use at most ${CUSTOM_LIMITS.subcategories} subcategories in total.`);
  }

  function translation(entry, path) {
    const record = object(entry, path);
    if (!record) return null;
    const word = text(record.word, `${path}.word`, CUSTOM_LIMITS.wordLength);
    const aliases = textList(record.aliases, `${path}.aliases`, CUSTOM_LIMITS.aliases, CUSTOM_LIMITS.aliasLength);
    const hints = object(record.hints, `${path}.hints`);
    const cleanHints = hints && Object.fromEntries(HINT_LEVELS.map((level) => [
      level, text(hints[level], `${path}.hints.${level}`, CUSTOM_LIMITS.hintLength),
    ]));
    const hintValues = Object.values(cleanHints ?? {});
    if (hintValues.length && hintValues.every(Boolean) && new Set(hintValues.map(normalizedTerm)).size !== HINT_LEVELS.length) {
      add("repeated_word_hint", `${path}.hints`, "The three hints must be different.");
    }
    return { word, aliases, hints: cleanHints };
  }

  const words = list(value.words, "custom.words", packageLimit("words")).map((entry, index) => {
    const path = `custom.words[${index}]`;
    const word = object(entry, path);
    if (!word) return null;
    const id = identifier(word.id, `${path}.id`);
    uniqueId(id, `${path}.id`, wordIds, knownWordIds);
    if (id) wordIds.set(id, path);
    const category = identifier(word.category, `${path}.category`);
    const subcategory = identifier(word.subcategory, `${path}.subcategory`);
    if (category && !categoryIds.has(category)) {
      add("unknown_category", `${path}.category`, `Category ${category} is missing from this package.`);
    }
    if (subcategory && categoryIds.has(category) && !categoryIds.get(category).has(subcategory)) {
      add("unknown_subcategory", `${path}.subcategory`, `Subcategory ${subcategory} does not belong to ${category}.`);
    }
    const languages = object(word.languages, `${path}.languages`);
    return {
      id,
      category,
      subcategory,
      tags: textList(word.tags, `${path}.tags`, CUSTOM_LIMITS.tags, CUSTOM_LIMITS.tagLength),
      level: choice(word.level, LEVELS, `${path}.level`),
      review: choice(word.review, REVIEW_STATUSES, `${path}.review`),
      languages: languages && Object.fromEntries(LANGUAGES.map((language) => [
        language, translation(languages[language], `${path}.languages.${language}`),
      ])),
    };
  });

  const orderedWords = sortedWords(words.filter((word) => word?.id));
  if (!aggregate) {
    const indexes = termIndexes();
    for (const word of orderedWords) {
      const duplicate = duplicateWord(word, indexes);
      if (duplicate === undefined) indexWord(word, indexes);
      else add("duplicate_word", wordIds.get(word.id), `${word.id} overlaps with ${duplicate}.`);
    }
  }

  list(value.pairs, "custom.pairs", packageLimit("pairs")).forEach((entry, index) => {
    const path = `custom.pairs[${index}]`;
    if (!Array.isArray(entry) || entry.length !== 2) {
      add("invalid_pair", path, "Use a pair of two word IDs.");
      return;
    }
    const [left, right] = entry.map((id, itemIndex) => identifier(id, `${path}[${itemIndex}]`));
    if (!left || !right) return;
    if (left === right) {
      add("invalid_pair", path, "A pair must use two different word IDs.");
      return;
    }
    if (!wordIds.has(left) || !wordIds.has(right)) {
      add("unknown_word", path, "Both words of a pair must exist in this package.");
      return;
    }
    const pair = orderedPair(left, right);
    const key = pairKey(pair);
    if (pairsById.has(key)) add("duplicate_pair", path, "This pair already exists.");
    pairsById.set(key, pair);
  });

  if (issues.length) throw new ContentValidationError(issues);
  return { categories, words: orderedWords, pairs: sortedPairs(pairsById.values()) };
}

function select(settings, packs, custom, categories) {
  const builtInWords = packs.flatMap((pack) => pack.words);
  const own = custom === null ? null : normalizeCustom(custom, { categories, words: builtInWords }, true);
  const language = settings.language ?? "sv";
  const selectedCategories = Array.isArray(settings.categories) ? new Set(settings.categories) : null;
  const selectedSubcategories = settings.subcategories?.length ? new Set(settings.subcategories) : null;
  const selectedLevels = new Set(settings.levels ?? ["familiar"]);
  const wordsById = new Map();
  const terms = termIndexes();

  for (const word of [...sortedWords(builtInWords), ...sortedWords(own?.words ?? [])]) {
    if (selectedCategories && !selectedCategories.has(word.category)) continue;
    if (selectedSubcategories && !selectedSubcategories.has(word.subcategory)) continue;
    if (!selectedLevels.has(word.level) || wordsById.has(word.id)) continue;
    const translation = word.languages?.[language];
    if (!isText(translation?.word) || !Array.isArray(translation.aliases)) continue;
    if (!HINT_LEVELS.every((level) => isText(translation.hints?.[level]))) continue;
    if (duplicateWord(word, terms) !== undefined) continue;
    wordsById.set(word.id, word);
    indexWord(word, terms);
  }

  const pairsById = new Map();
  for (const [left, right] of [...packs.flatMap((pack) => pack.pairs), ...(own?.pairs ?? [])]) {
    if (left === right || !wordsById.has(left) || !wordsById.has(right)) continue;
    const pair = orderedPair(left, right);
    pairsById.set(pairKey(pair), pair);
  }

  return { words: sortedWords(wordsById.values()), pairs: sortedPairs(pairsById.values()) };
}

/** Filter already-loaded public packs and an optional private package. */
export function selectContent(settings = {}, packs = [], custom = null) {
  return select(settings, packs, custom, packs.map((pack) => pack.category).filter(isObject));
}

async function requestContent(url, fetcher) {
  let response;
  try {
    response = await fetcher(url);
  } catch (cause) {
    throw new ContentRequestError("content_unavailable", `Could not load ${url}.`, { cause });
  }
  if (!response.ok) throw new ContentRequestError("content_unavailable", `Could not load ${url} (HTTP ${response.status}).`);
  try {
    return await response.json();
  } catch (cause) {
    throw new ContentRequestError("invalid_content", `Invalid JSON at ${url}.`, { cause });
  }
}

function checkManifest(manifest) {
  if (!isText(manifest?.version) || !Array.isArray(manifest.categories) ||
      !manifest.categories.every((category) => isId(category?.id))) {
    throw new ContentRequestError("invalid_content", "Invalid content manifest.");
  }
  return manifest;
}

/** Load the public category catalog. */
export async function loadManifest({ fetch: fetcher = globalThis.fetch } = {}) {
  return checkManifest(await requestContent("/api/content/manifest", fetcher));
}

/** Optionally pin the request to the caller's loaded manifest version. */
export async function loadPack(category, { fetch: fetcher = globalThis.fetch, version } = {}) {
  if (!isId(category)) throw new ContentRequestError("invalid_content", "Invalid category ID.");
  const pack = await requestContent(`/api/content/packs/${category}.json`, fetcher);
  if (!isText(pack?.version) || pack.category?.id !== category || !Array.isArray(pack.words) || !Array.isArray(pack.pairs)) {
    throw new ContentRequestError("invalid_content", `Invalid content pack for ${category}.`);
  }
  if (version !== undefined && pack.version !== version) {
    throw new ContentRequestError("content_version_mismatch", `The content pack for ${category} is from another version.`);
  }
  return pack;
}

/** Fetch the chosen public packs and apply the same filter as selectContent. */
export async function loadContent(settings = {}, { manifest, custom = null, fetch: fetcher = globalThis.fetch } = {}) {
  const { version, categories } = manifest ? checkManifest(manifest) : await loadManifest({ fetch: fetcher });
  const selected = Array.isArray(settings.categories) ? new Set(settings.categories) : null;
  const selectedCategories = selected ? categories.filter(({ id }) => selected.has(id)) : categories;
  const packs = await Promise.all(selectedCategories.map(({ id }) => loadPack(id, { fetch: fetcher, version })));
  return select(settings, packs, custom, categories);
}

function importText(value) {
  if (typeof value !== "string") fail("invalid_type", "$", "Expected text from a file.");
  if (value.length > MAX_IMPORT_BYTES || new TextEncoder().encode(value).length > MAX_IMPORT_BYTES) {
    fail("limit", "$", `Import files may be at most ${MAX_IMPORT_BYTES} UTF-8 bytes.`);
  }
  return value.replace(/^\uFEFF/u, "");
}

export function parseCustomJSON(value) {
  const text = importText(value);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail("invalid_json", "$", error.message);
  }
  return validateCustom(parsed);
}

export function exportCustomJSON(value) {
  return `${JSON.stringify(validateCustom(value), null, 2)}\n`;
}

const CSV_COLUMNS = [
  "type", "id", "category", "subcategory", "sv_name", "en_name", "icon", "tags", "level", "review",
  "sv_word", "sv_aliases", "sv_easy", "sv_normal", "sv_hard", "en_word", "en_aliases", "en_easy", "en_normal",
  "en_hard", "left", "right",
];

function csvRows(text) {
  const rows = [];
  const header = text.split(/[\r\n]/u, 1)[0];
  const delimiter = header.includes(";") && !header.includes(",") ? ";" : ",";
  let row = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  const finishField = () => {
    row.push(field);
    field = "";
    closedQuote = false;
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character !== '"') {
        field += character;
      } else if (text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
        closedQuote = true;
      }
    } else if (character === delimiter) {
      finishField();
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
    } else if (character === '"' && !field && !closedQuote) {
      quoted = true;
    } else if (closedQuote || character === '"') {
      fail("invalid_csv", `csv[${rows.length + 1}]`, "Invalid quoting in a CSV field.");
    } else {
      field += character;
    }
  }
  if (quoted) fail("invalid_csv", `csv[${rows.length + 1}]`, "A quoted CSV field has no closing quote.");
  if (row.length || field || closedQuote) finishRow();
  return rows;
}

function csvList(value, path) {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    fail("invalid_csv", path, 'Enter a JSON list, for example ["first", "second"].');
  }
}

// Spreadsheet programs interpret formula-like cells even when the CSV quotes them.
const FORMULA_PREFIX = /^[\p{White_Space}]*[=+@-]/u;

function escapeSpreadsheetValue(value) {
  return value.startsWith("'") || FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

function unescapeSpreadsheetValue(value) {
  const unquoted = value.slice(1);
  return value.startsWith("'") && (unquoted.startsWith("'") || FORMULA_PREFIX.test(unquoted)) ? unquoted : value;
}

export function parseCustomCSV(value) {
  const [header = [], ...rows] = csvRows(importText(value));
  const columns = header.map(trimmed);
  const positions = new Map(columns.map((name, index) => [name, index]));
  if (positions.size !== columns.length || CSV_COLUMNS.some((name) => !positions.has(name))) {
    fail("invalid_csv", "csv[1]", "Expected all package CSV columns without duplicate column names. Export a package for the header.");
  }

  const result = { categories: [], words: [], pairs: [] };
  const categories = new Map();
  const subcategories = [];
  rows.forEach((row, index) => {
    if (row.every((value) => !trimmed(value))) return;
    const path = `csv[${index + 2}]`;
    if (row.length !== columns.length) fail("invalid_csv", path, `Expected ${columns.length} columns.`);
    const cell = (name) => unescapeSpreadsheetValue(row[positions.get(name)]);
    const type = cell("type");

    if (type === "category" || type === "subcategory") {
      const entry = { id: cell("id"), names: { sv: cell("sv_name"), en: cell("en_name") } };
      if (type === "category") {
        const category = { ...entry, icon: cell("icon"), subcategories: [] };
        result.categories.push(category);
        categories.set(category.id, category);
      } else {
        subcategories.push({ parent: cell("category"), entry, path });
      }
    } else if (type === "word") {
      result.words.push({
        id: cell("id"), category: cell("category"), subcategory: cell("subcategory"),
        tags: csvList(cell("tags"), `${path}.tags`), level: cell("level"), review: cell("review"),
        languages: Object.fromEntries(LANGUAGES.map((language) => [language, {
          word: cell(`${language}_word`),
          aliases: csvList(cell(`${language}_aliases`), `${path}.${language}_aliases`),
          hints: Object.fromEntries(HINT_LEVELS.map((level) => [level, cell(`${language}_${level}`)])),
        }])),
      });
    } else if (type === "pair") {
      result.pairs.push([cell("left"), cell("right")]);
    } else {
      fail("invalid_csv", `${path}.type`, "Use a category, subcategory, word, or pair row.");
    }
  });
  for (const { parent, entry, path } of subcategories) {
    if (!categories.has(parent)) fail("unknown_category", `${path}.category`, `Category ${parent} is missing from the CSV.`);
    categories.get(parent).subcategories.push(entry);
  }
  return validateCustom(result);
}

function quoteCsv(value) {
  const safe = escapeSpreadsheetValue(value);
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function exportCustomCSV(value) {
  const pack = validateCustom(value);
  const rows = [CSV_COLUMNS.join(",")];
  const add = (entry) => rows.push(CSV_COLUMNS.map((column) => quoteCsv(entry[column] ?? "")).join(","));

  for (const category of pack.categories) {
    add({ type: "category", id: category.id, sv_name: category.names.sv, en_name: category.names.en, icon: category.icon });
    for (const subcategory of category.subcategories) {
      add({ type: "subcategory", id: subcategory.id, category: category.id, sv_name: subcategory.names.sv, en_name: subcategory.names.en });
    }
  }
  for (const word of pack.words) {
    const entry = {
      type: "word", id: word.id, category: word.category, subcategory: word.subcategory,
      tags: JSON.stringify(word.tags), level: word.level, review: word.review,
    };
    for (const [language, translation] of Object.entries(word.languages)) {
      entry[`${language}_word`] = translation.word;
      entry[`${language}_aliases`] = JSON.stringify(translation.aliases);
      for (const [level, hint] of Object.entries(translation.hints)) entry[`${language}_${level}`] = hint;
    }
    add(entry);
  }
  for (const [left, right] of pack.pairs) add({ type: "pair", left, right });
  return `${rows.join("\r\n")}\r\n`;
}
