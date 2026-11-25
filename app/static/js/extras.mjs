import { CUSTOM_LIMITS, exportCustomCSV, loadManifest, loadPack, parseCustomCSV, validateCustom } from "./content.mjs";
import { mountHistory } from "./extras-history.mjs";

export { clearHistory, importHistory, mountHistory, readHistory, recordRound, serializeHistory, summarizeHistory } from "./extras-history.mjs";

const LANGUAGES = ["sv", "en"];
const HINT_LEVELS = ["easy", "normal", "hard"];
const WORD_LEVELS = ["familiar", "intermediate", "expert"];
const REVIEWS = ["needs_review", "editorial"];
const MAX_FILE_BYTES = 1024 * 1024;
const IDENTIFIER = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const textEncoder = new TextEncoder();

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function localList(key) {
  let memory = [];
  let transient = false;
  let readable = true;
  return {
    read() {
      if (!transient) {
        try {
          const value = JSON.parse(globalThis.localStorage.getItem(key) ?? "[]");
          if (!Array.isArray(value)) throw new TypeError("Expected stored list");
          memory = value;
          readable = true;
        } catch {
          readable = false;
        }
      }
      return memory;
    },
    write(value) {
      memory = value;
      try {
        globalThis.localStorage.setItem(key, JSON.stringify(value));
        transient = false;
        readable = true;
      } catch {
        transient = true;
      }
      return !transient;
    },
    get readable() { return readable; },
    get persisted() { return !transient; },
  };
}

const packages = localList("imposter:customPackages.v1");
const flags = localList("imposter:hintFlags.v1");

function makeId(prefix) {
  const suffix = globalThis.crypto.randomUUID?.() ?? Array.from(
    globalThis.crypto.getRandomValues(new Uint8Array(16)),
    value => value.toString(16).padStart(2, "0"),
  ).join("");
  return `${prefix}-${suffix}`;
}

function isId(value, limit = 100) {
  return typeof value === "string" && value.length <= limit && IDENTIFIER.test(value);
}

function isText(value, length, permitEmpty = false) {
  return typeof value === "string" && (permitEmpty || !!value.trim())
    && !/[\p{Cc}]/u.test(value) && [...value.trim()].length <= length;
}

function problem(code, path = "$", details = {}) {
  return { ok: false, issues: [{ code, path, ...details }] };
}

function contentPart(value) {
  const { categories, words, pairs } = value;
  return { categories, words, pairs };
}

export function validateCustomPackage(input, base = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return problem("invalid_package");
  if (Object.hasOwn(input, "version") && input.version !== 1) return problem("invalid_version", "version");
  if (Object.hasOwn(input, "id") && !isId(input.id)) return problem("invalid_id", "id");
  try {
    const content = validateCustom(contentPart(input), base);
    const id = input.id ?? makeId("pack");
    const names = input.names ?? content.categories[0]?.names ?? { sv: "Eget paket", en: "Custom pack" };
    if (!names || typeof names !== "object" || Array.isArray(names)) return problem("invalid_object", "names");
    const issue = LANGUAGES.find(language => !isText(names[language], 100));
    if (issue) return problem("invalid_text", `names.${issue}`);
    const translated = Object.fromEntries(LANGUAGES.map(language => [language, names[language].trim()]));
    return { ok: true, package: { id, names: translated, ...content }, issues: [] };
  } catch (error) {
    return { ok: false, issues: error.issues?.length ? error.issues : [{ code: "invalid_package", path: "$" }] };
  }
}

export function parseCustomPackage(text, format = "json", base = null) {
  if (typeof text !== "string") return problem("invalid_file");
  if (textEncoder.encode(text).length > MAX_FILE_BYTES) return problem("file_size");
  if (format !== "csv" && format !== "json") return problem("invalid_file");
  const value = text.replace(/^\uFEFF/, "");
  try {
    return validateCustomPackage(format === "csv" ? parseCustomCSV(value) : JSON.parse(value), base);
  } catch (error) {
    return { ok: false, issues: error.issues?.length ? error.issues : [{ code: `invalid_${format}`, path: "$" }] };
  }
}

export function serializeCustomPackage(value, format = "json") {
  const validated = validateCustomPackage(value);
  if (!validated.ok) throw Object.assign(new Error("Invalid custom package"), { issues: validated.issues });
  if (format === "csv") return exportCustomCSV(contentPart(validated.package));
  if (format === "json") return JSON.stringify({ version: 1, ...validated.package }, null, 2);
  throw new TypeError("Unsupported package format");
}

export function listCustomPackages() {
  return copy(packages.read());
}

export function getCustomPackage(id) {
  const selected = packages.read().find(packed => packed.id === id);
  return selected ? copy(contentPart(selected)) : null;
}

function combinePackages(selected) {
  return {
    categories: selected.flatMap(packed => packed.categories),
    words: selected.flatMap(packed => packed.words),
    pairs: selected.flatMap(packed => packed.pairs),
  };
}

export function getCustomContent(ids) {
  const selected = packages.read().filter(packed => ids === undefined || ids.includes(packed.id));
  return copy(combinePackages(selected));
}

export function saveCustomPackage(input, base = null) {
  const checked = validateCustomPackage(input, base);
  if (!checked.ok) return checked;
  const current = packages.read();
  const others = current.filter(packed => packed.id !== checked.package.id);
  if (others.length) {
    try {
      validateCustom(combinePackages([checked.package, ...others]));
    } catch (error) {
      return problem("conflict", "$", { related: error.issues ?? [] });
    }
  }
  const next = current.map(packed => packed.id === checked.package.id ? checked.package : packed);
  if (next.length === others.length) next.push(checked.package);
  return { ...checked, package: copy(checked.package), persisted: packages.write(next) };
}

export function deleteCustomPackage(id) {
  const current = packages.read();
  const remaining = current.filter(packed => packed.id !== id);
  return { ok: true, persisted: current.length === remaining.length ? packages.persisted : packages.write(remaining) };
}

export function flagHint({ wordId, language, level, reason = "", word = "", hint = "" } = {}) {
  if (!isId(wordId) || !LANGUAGES.includes(language) || !HINT_LEVELS.includes(level)
      || !isText(reason, 300, true) || !isText(word, 100, true) || !isText(hint, 160, true)) {
    return problem("invalid_hint");
  }
  const trimmed = reason.trim();
  const current = flags.read();
  const same = current.some(flag => flag.wordId === wordId && flag.language === language
    && flag.level === level && flag.reason === trimmed);
  if (same) return { ok: true, added: false, persisted: flags.persisted };
  const flag = { id: makeId("hint"), wordId, language, level, word: word.trim(), hint: hint.trim(),
    reason: trimmed, createdAt: new Date().toISOString() };
  return { ok: true, added: true, persisted: flags.write([...current, flag]) };
}

export function listHintFlags() {
  return copy(flags.read());
}

export function clearHintFlags() {
  return { ok: true, persisted: flags.write([]) };
}

export function removeHintFlag(id) {
  return { ok: true, persisted: flags.write(flags.read().filter(flag => flag.id !== id)) };
}

export function serializeHintFlags() {
  return JSON.stringify({ version: 1, flags: listHintFlags() }, null, 2);
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const emptyNames = () => ({ sv: "", en: "" });

function blankPackage() {
  return { id: makeId("pack"), names: emptyNames(), categories: [], words: [], pairs: [] };
}

function blankWord(category) {
  return {
    id: makeId(category.id.length <= 63 ? category.id : "word"),
    category: category.id, subcategory: category.subcategories[0].id,
    tags: [], level: "familiar", review: "needs_review",
    languages: Object.fromEntries(LANGUAGES.map(language => [language, {
      word: "", aliases: [], hints: { easy: "", normal: "", hard: "" },
    }])),
  };
}

export function mountExtras(ctx) {
  if (ctx.route === "history") return mountHistory(ctx.root, ctx);
  const { root, el: e, lang, signal } = ctx;
  const t = (key, values) => ctx.t(`extras.${key}`, values);
  const button = (key, action, attrs = {}) => ctx.button(t(key), action, attrs);
  const secondary = { variant: "secondary" };
  let draft = null;
  let dirty = false;
  let replacingImport = false;
  let categoryId = "";
  let wordId = "";
  let pendingImport = null;
  let importRequest = 0;
  let notice = "";
  let issues = [];
  let manifest = null;
  let manifestPending = null;
  const preview = { source: "custom", lang, level: "normal", category: "", word: "", pack: null, loading: false, error: false };
  let previewRequest = 0;
  let previewBox;

  const label = value => value?.[lang]?.trim() || value?.sv?.trim() || value?.en?.trim() || t("unnamedPackage");
  const wordLabel = word => word?.languages[lang].word.trim() || word?.languages[lang === "sv" ? "en" : "sv"].word.trim()
    || t("word");
  const ask = (key, values) => window.confirm(t(key, values));
  const mayLeaveDraft = () => !dirty || ask("leaveConfirm");
  const active = () => !signal?.aborted;
  ctx.setNavigationGuard?.(mayLeaveDraft);

  function textField(caption, value, onChange, attrs = {}) {
    const input = e("input", { type: "text", ...attrs, onInput: event => onChange(event.target.value) });
    input.value = value;
    return e("label", { class: "field" }, caption, input);
  }

  function listField(caption, values, onChange) {
    const input = e("textarea", { rows: 3, onInput: event => {
      onChange(event.target.value.split(/\r?\n/u).map(part => part.trim()).filter(Boolean));
    } });
    input.value = values.join("\n");
    return e("label", { class: "field" }, caption, input, e("small", { class: "muted" }, t("separatorHint")));
  }

  function selectField(caption, value, items, onChange, placeholder) {
    const options = items.map(([key, name]) => e("option", { value: key }, name));
    if (placeholder) options.unshift(e("option", { value: "", disabled: true }, placeholder));
    const select = e("select", { onChange: event => onChange(event.target.value) }, ...options);
    select.value = value;
    return e("label", { class: "field" }, caption, select);
  }

  function nameFields(value, caption, prefix = "") {
    return e("div", { class: "extras-grid" }, ...LANGUAGES.map(language => textField(
      `${t(caption)} · ${t(language)}`, value[language], name => { value[language] = name; dirty = true; },
      { maxlength: CUSTOM_LIMITS.nameLength, lang: language, ...(prefix ? { id: `${prefix}-${language}` } : {}) },
    )));
  }

  function note(key, persisted = true, values) {
    notice = t(persisted ? key : "storageError", values);
  }

  function openDraft(value, imported = false) {
    draft = value;
    dirty = imported;
    replacingImport = imported && listCustomPackages().some(packed => packed.id === value.id);
    categoryId = draft?.categories[0]?.id ?? "";
    wordId = draft?.words.find(word => word.category === categoryId)?.id ?? "";
    issues = [];
  }

  function packagePicker() {
    const stored = listCustomPackages();
    const current = stored.some(packed => packed.id === draft?.id) ? draft.id : "";
    return e("section", { class: "panel stack" }, e("h2", {}, t("package")),
      stored.length ? selectField(t("loadPackage"), current, stored.map(packed => [packed.id, label(packed.names)]), id => {
        if (mayLeaveDraft()) openDraft(stored.find(packed => packed.id === id));
        render();
      }, t("choosePackage")) : e("p", { class: "muted" }, t("noPackages")),
      e("div", { class: "cluster" }, button("newPackage", () => {
        if (!mayLeaveDraft()) return;
        openDraft(blankPackage());
        render(`extras-pack-${lang}`);
      }, secondary), current ? button("removePackage", () => {
        if (!ask("removePackageConfirm", { name: label(draft.names) })) return;
        note("removed", deleteCustomPackage(draft.id).persisted);
        openDraft(null);
        render();
      }, { variant: "danger" }) : null),
    );
  }

  async function getManifest() {
    if (manifest) return manifest;
    manifestPending ??= loadManifest().then(value => {
      manifest = value;
      return value;
    }).catch(() => null).finally(() => { manifestPending = null; });
    return manifestPending;
  }

  function importPanel() {
    const input = e("input", { type: "file", accept: ".json,.csv,application/json,text/csv", onChange: async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      const request = ++importRequest;
      const extension = file.name.split(".").at(-1).toLowerCase();
      let parsed = problem("file_size");
      let readError = false;
      if (file.size <= MAX_FILE_BYTES) {
        try {
          parsed = parseCustomPackage(await file.text(), extension, manifest);
        } catch {
          readError = true;
        }
      }
      if (!active() || request !== importRequest) return;
      pendingImport = parsed.ok ? parsed.package : null;
      issues = readError ? [] : parsed.issues;
      notice = readError ? t("readFailed") : parsed.ok ? t("importReady") : "";
      render();
    } });
    return e("section", { class: "panel stack" }, e("h2", {}, t("importPackage")),
      e("label", { class: "field" }, t("importNote"), input),
      pendingImport ? button("useImported", () => {
        if (!mayLeaveDraft()) return;
        openDraft(pendingImport, true);
        pendingImport = null;
        note("imported");
        render(`extras-pack-${lang}`);
      }, secondary) : null,
    );
  }

  function removeWords(predicate) {
    const removed = new Set(draft.words.filter(predicate).map(word => word.id));
    draft.words = draft.words.filter(word => !removed.has(word.id));
    draft.pairs = draft.pairs.filter(pair => pair.every(id => !removed.has(id)));
    if (removed.has(wordId)) wordId = "";
  }

  function categoryPanel() {
    const current = draft.categories.find(category => category.id === categoryId);
    const create = () => {
      const id = makeId("custom");
      draft.categories.push({ id, names: emptyNames(), icon: "📝", subcategories: [{
        id: `${id}-general`, names: Object.fromEntries(LANGUAGES.map(language => [language,
          ctx.translate?.(language, "extras.genericSubcategory") ?? (language === "sv" ? "Allmänt" : "General"),
        ])),
      }] });
      categoryId = id;
      wordId = "";
      dirty = true;
      render(`extras-category-${lang}`);
    };
    return e("section", { class: "panel stack" }, e("h2", {}, t("categories")),
      current ? selectField(t("category"), categoryId, draft.categories.map(category => [category.id, label(category.names)]), id => {
        categoryId = id;
        wordId = draft.words.find(word => word.category === categoryId)?.id ?? "";
        render();
      }) : e("p", { class: "muted" }, t("editorEmpty")),
      current ? nameFields(current.names, "categoryName", "extras-category") : null,
      current ? e("div", { class: "stack" }, e("h3", {}, t("subcategories")),
        ...current.subcategories.map(subcategory => e("div", { class: "extras-entry", "data-subcategory": subcategory.id },
          nameFields(subcategory.names, "subcategoryName", subcategory.id),
          button("removeSubcategory", () => {
            if (!ask("removeSubcategoryConfirm", { name: label(subcategory.names) })) return;
            current.subcategories = current.subcategories.filter(entry => entry.id !== subcategory.id);
            removeWords(word => word.subcategory === subcategory.id);
            dirty = true;
            render();
          }, { variant: "danger" }),
        )),
        button("addSubcategory", () => {
          const id = makeId("custom-sub");
          current.subcategories.push({ id, names: emptyNames() });
          dirty = true;
          render(`${id}-${lang}`);
        }, secondary),
      ) : null,
      e("div", { class: "cluster" }, button("addCategory", create, secondary), current ? button("removeCategory", () => {
        if (!ask("removeCategoryConfirm", { name: label(current.names) })) return;
        draft.categories = draft.categories.filter(category => category.id !== current.id);
        removeWords(word => word.category === current.id);
        categoryId = draft.categories[0]?.id ?? "";
        wordId = "";
        dirty = true;
        render();
      }, { variant: "danger" }) : null),
    );
  }

  function wordPanel() {
    const currentCategory = draft.categories.find(category => category.id === categoryId);
    const eligible = draft.words.filter(word => word.category === categoryId);
    const currentWord = eligible.find(word => word.id === wordId);
    const items = eligible.map(word => [word.id, wordLabel(word)]);
    const set = (object, key, value) => {
      object[key] = value;
      dirty = true;
      renderPreview();
    };
    return e("section", { class: "panel stack" }, e("h2", {}, t("wordCount", { count: eligible.length })),
      items.length ? selectField(t("selectWord"), currentWord?.id ?? "", items, id => { wordId = id; render(); }, t("selectWord")) : null,
      currentWord ? e("div", { class: "stack" },
        selectField(t("subcategory"), currentWord.subcategory,
          currentCategory.subcategories.map(entry => [entry.id, label(entry.names)]), value => set(currentWord, "subcategory", value)),
        e("div", { class: "extras-grid" },
          selectField(t("level"), currentWord.level, WORD_LEVELS.map(level => [level, t(level)]), value => set(currentWord, "level", value)),
          selectField(t("review"), currentWord.review, REVIEWS.map(review => [review, t(review)]), value => set(currentWord, "review", value)),
        ),
        listField(t("tagList"), currentWord.tags, value => set(currentWord, "tags", value)),
        e("div", { class: "extras-grid" }, ...LANGUAGES.map(language => {
          const entry = currentWord.languages[language];
          return e("fieldset", { class: "extras-language stack" }, e("legend", {}, t(language)),
            textField(t("word"), entry.word, value => set(entry, "word", value),
              { lang: language, maxlength: CUSTOM_LIMITS.wordLength, id: `extras-word-${language}` }),
            listField(t("aliases"), entry.aliases, value => set(entry, "aliases", value)),
            ...HINT_LEVELS.map(level => textField(t(level), entry.hints[level], value => set(entry.hints, level, value),
              { lang: language, maxlength: CUSTOM_LIMITS.hintLength })),
          );
        })),
      ) : null,
      currentCategory && !currentCategory.subcategories.length ? e("p", { class: "muted" }, t("addWordFirstCategory")) : null,
      e("div", { class: "cluster" }, button("addWord", () => {
        const word = blankWord(currentCategory);
        draft.words.push(word);
        wordId = word.id;
        preview.source = "custom";
        preview.word = word.id;
        dirty = true;
        render(`extras-word-${lang}`);
      }, { ...secondary, disabled: !currentCategory?.subcategories.length }), currentWord ? button("removeWord", () => {
        if (!ask("removeWordConfirm", { name: wordLabel(currentWord) })) return;
        removeWords(word => word.id === currentWord.id);
        dirty = true;
        render();
      }, { variant: "danger" }) : null),
    );
  }

  function pairsPanel() {
    const labels = new Map(draft.words.map(word => [word.id, wordLabel(word)]));
    const options = [...labels];
    const pairs = draft.pairs;
    const existing = (left, right) => pairs.some(pair => pair.includes(left) && pair.includes(right));
    return e("details", { class: "panel stack", open: pairs.length > 0 },
      e("summary", {}, t("pairCount", { count: pairs.length })),
      pairs.length ? e("ul", { class: "extras-list" }, ...pairs.map(([left, right], index) => e("li", { class: "extras-entry" },
        e("span", {}, `${labels.get(left)} / ${labels.get(right)}`), button("removePair", () => {
          pairs.splice(index, 1);
          dirty = true;
          render();
        }, { variant: "ghost" }),
      ))) : null,
      options.length < 2 ? e("p", { class: "muted" }, t("pairNeedsWords")) : (() => {
        let left = options[0][0];
        let right = options[1][0];
        const add = button("addPair", () => {
          if (left === right || existing(left, right)) return;
          pairs.push([left, right]);
          dirty = true;
          render();
        }, secondary);
        const update = () => { add.disabled = left === right || existing(left, right); };
        update();
        return e("div", { class: "stack" }, e("div", { class: "extras-grid" },
          selectField(t("firstWord"), left, options, value => { left = value; update(); }),
          selectField(t("secondWord"), right, options, value => { right = value; update(); }),
        ), add);
      })(),
    );
  }

  function saveDraft() {
    if (replacingImport && !ask("packageReplaceConfirm", { name: label(draft.names) })) return;
    const result = saveCustomPackage(draft, manifest);
    if (result.ok) {
      draft = result.package;
      dirty = false;
      replacingImport = false;
      note("saved", result.persisted);
    } else {
      notice = "";
    }
    issues = result.issues;
    render();
  }

  function exportDraft(format) {
    try {
      const mime = format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
      download(`${draft.id}.${format}`, serializeCustomPackage(draft, format), mime);
    } catch (error) {
      issues = error.issues ?? [];
      notice = issues.length ? "" : t("failed");
      render();
    }
  }
