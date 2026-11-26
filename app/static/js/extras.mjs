import { CUSTOM_LIMITS, exportCustomCSV, loadManifest, loadPack, parseCustomCSV, validateCustom } from "./content.mjs";

const HINT_LEVELS = ["easy", "normal", "hard"];
const WORD_LEVELS = ["familiar", "intermediate", "expert"];
const REVIEWS = ["needs_review", "editorial"];
const MAX_FILE_BYTES = 1024 * 1024;
const IDENTIFIER = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const textEncoder = new TextEncoder();

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function localList(key, normalize) {
  let memory = [];
  let transient = false;
  let readable = true;
  let previous;
  return {
    read() {
      if (!transient) {
        try {
          const raw = globalThis.localStorage.getItem(key);
          if (raw !== previous) {
            const value = JSON.parse(raw ?? "[]");
            if (!Array.isArray(value)) throw new TypeError("Invalid stored list");
            memory = normalize(value);
            previous = raw;
          }
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
        const raw = JSON.stringify(value);
        globalThis.localStorage.setItem(key, raw);
        previous = raw;
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

const packages = localList("imposter:customPackages.v1", entries => entries.map(entry => {
  const packed = entry?.id && validateCustomPackage(entry).package;
  if (!packed) throw new TypeError("Invalid stored package");
  return packed;
}));
const flags = localList("imposter:hintFlags.v1", entries => entries.filter(flag => {
  if (!isId(flag?.id) || !isId(flag.wordId) || !HINT_LEVELS.includes(flag.level)
      || ![flag.language, flag.word, flag.hint, flag.reason, flag.createdAt].every(value => typeof value === "string")) {
    throw new TypeError("Invalid stored flag");
  }
  return flag.language === "sv";
}));

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
    const names = input.names ?? content.categories[0]?.names ?? { sv: "Eget paket" };
    if (!names || typeof names !== "object" || Array.isArray(names)) return problem("invalid_object", "names");
    if (!isText(names.sv, 100)) return problem("invalid_text", "names.sv");
    return { ok: true, package: { id, names: { sv: names.sv.trim() }, ...content }, issues: [] };
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

export function flagHint({ wordId, language = "sv", level, reason = "", word = "", hint = "" } = {}) {
  if (!isId(wordId) || language !== "sv" || !HINT_LEVELS.includes(level)
      || !isText(reason, 300, true) || !isText(word, 100, true) || !isText(hint, 160, true)) {
    return problem("invalid_hint");
  }
  const trimmed = reason.trim();
  const current = flags.read();
  const same = current.some(flag => flag.wordId === wordId && flag.level === level && flag.reason === trimmed);
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

const emptyNames = () => ({ sv: "" });

function blankPackage() {
  return { id: makeId("pack"), names: emptyNames(), categories: [], words: [], pairs: [] };
}

function blankWord(category) {
  return {
    id: makeId(category.id.length <= 63 ? category.id : "word"),
    category: category.id, subcategory: category.subcategories[0].id,
    tags: [], level: "familiar", review: "needs_review",
    languages: { sv: {
      word: "", aliases: [], hints: { easy: "", normal: "", hard: "" },
    } },
  };
}

export function mountExtras(ctx) {
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
  const preview = { source: "custom", level: "normal", category: "", word: "", pack: null, loading: false, error: false };
  let previewRequest = 0;
  let previewBox;

  const label = value => value?.sv?.trim() || t("unnamedPackage");
  const wordLabel = word => word?.languages.sv?.word.trim() || t("word");
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
    return e("div", { class: "extras-grid" }, textField(
      `${t(caption)} · ${t("sv")}`, value.sv, name => { value.sv = name; dirty = true; },
      { maxlength: CUSTOM_LIMITS.nameLength, lang, ...(prefix ? { id: `${prefix}-${lang}` } : {}) },
    ));
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
    return e("section", { class: "panel stack extras-package-picker" }, e("h2", {}, t("package")),
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
    return e("section", { class: "panel stack extras-import" }, e("h2", {}, t("importPackage")),
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
        id: `${id}-general`, names: { sv: "Allmänt" },
      }] });
      categoryId = id;
      wordId = "";
      dirty = true;
      render(`extras-category-${lang}`);
    };
    return e("section", { class: "panel stack extras-category-editor" }, e("h2", {}, t("categories")),
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
    const entry = currentWord?.languages.sv;
    const items = eligible.map(word => [word.id, wordLabel(word)]);
    const set = (object, key, value) => {
      object[key] = value;
      dirty = true;
      renderPreview();
    };
    return e("section", { class: "panel stack extras-word-editor" }, e("h2", {}, t("wordCount", { count: eligible.length })),
      items.length ? selectField(t("selectWord"), currentWord?.id ?? "", items, id => { wordId = id; render(); }, t("selectWord")) : null,
      currentWord ? e("div", { class: "stack" },
        selectField(t("subcategory"), currentWord.subcategory,
          currentCategory.subcategories.map(entry => [entry.id, label(entry.names)]), value => set(currentWord, "subcategory", value)),
        e("div", { class: "extras-grid" },
          selectField(t("level"), currentWord.level, WORD_LEVELS.map(level => [level, t(level)]), value => set(currentWord, "level", value)),
          selectField(t("review"), currentWord.review, REVIEWS.map(review => [review, t(review)]), value => set(currentWord, "review", value)),
        ),
        listField(t("tagList"), currentWord.tags, value => set(currentWord, "tags", value)),
        e("fieldset", { class: "extras-language stack" }, e("legend", {}, t("sv")),
          textField(t("word"), entry.word, value => set(entry, "word", value),
            { lang, maxlength: CUSTOM_LIMITS.wordLength, id: `extras-word-${lang}` }),
          listField(t("aliases"), entry.aliases, value => set(entry, "aliases", value)),
          ...HINT_LEVELS.map(level => textField(t(level), entry.hints[level], value => set(entry.hints, level, value),
            { lang, maxlength: CUSTOM_LIMITS.hintLength })),
        ),
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
    return e("details", { class: "panel stack extras-pairs", open: pairs.length > 0 },
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
    render("extras-feedback");
  }

  function exportDraft(format) {
    try {
      const mime = format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
      download(`${draft.id}.${format}`, serializeCustomPackage(draft, format), mime);
    } catch (error) {
      issues = error.issues ?? [];
      notice = issues.length ? "" : t("failed");
      render("extras-feedback");
    }
  }

  async function loadPublicPreview(category = preview.category) {
    const request = ++previewRequest;
    preview.loading = true;
    preview.error = false;
    preview.category = category;
    preview.pack = null;
    preview.word = "";
    renderPreview();
    try {
      const data = await getManifest();
      if (!data) throw new Error("No content manifest");
      if (category) {
        const pack = await loadPack(category, { version: data.version });
        if (request === previewRequest && active()) preview.pack = pack;
      }
    } catch {
      if (request === previewRequest) preview.error = true;
    } finally {
      if (request === previewRequest && active()) {
        preview.loading = false;
        renderPreview();
      }
    }
  }

  function previewCard(role, content, type) {
    return e("article", { class: "panel panel--subtle extras-preview-card", "data-preview-role": role },
      e("h3", {}, t(role)), e("p", { class: "muted" }, t(type)),
      e("p", { class: "extras-preview-value", lang }, content),
    );
  }

  function renderPreview() {
    if (!previewBox || !active()) return;
    const custom = preview.source === "custom";
    const customWords = draft?.words ?? listCustomPackages().flatMap(packed => packed.words);
    const words = custom ? customWords : preview.pack?.words ?? [];
    const word = words.find(word => word.id === preview.word);
    const translation = word?.languages.sv;
    const hint = translation?.hints[preview.level]?.trim();
    const reason = e("input", { type: "text", maxlength: 300, placeholder: t("flagPlaceholder") });
    const changePreview = (key, value, eventTarget) => {
      preview[key] = value;
      const field = eventTarget?.querySelector("select");
      const restoreFocus = field === document.activeElement;
      renderPreview();
      if (restoreFocus) previewBox.querySelector(`[data-preview-field="${key}"] select`)?.focus();
    };
    const previewField = (key, caption, selected, choices, placeholder, update) => {
      const field = selectField(t(caption), selected, choices, value => {
        if (update) update(value);
        else changePreview(key, value, field);
      }, placeholder ? t(placeholder) : undefined);
      field.dataset.previewField = key;
      return field;
    };
    const wordChoices = words.map(entry => [entry.id, wordLabel(entry)]);
    const children = [e("h2", {}, t("previewTitle")), e("p", {}, t("previewIntro")),
      e("div", { class: "extras-grid" },
        previewField("source", "previewSource", preview.source,
          [["custom", t("previewCustom")], ["public", t("previewBuiltIn")]], null, source => {
            preview.source = source;
            preview.word = "";
            if (source === "public") void loadPublicPreview();
            else {
              previewRequest++;
              preview.loading = false;
              preview.error = false;
              renderPreview();
            }
            previewBox.querySelector('[data-preview-field="source"] select')?.focus();
          }),
        !custom && manifest ? previewField("category", "category", preview.category,
          manifest.categories.map(category => [category.id, label(category.names)]), "previewSelectCategory", id => {
            void loadPublicPreview(id);
            previewBox.querySelector('[data-preview-field="category"] select')?.focus();
          }) : null,
        words.length ? previewField("word", "selectWord", word?.id ?? "", wordChoices, "selectWord") : null,
        previewField("level", "previewHintLevel", preview.level, HINT_LEVELS.map(level => [level, t(level)])),
      ),
      !custom && preview.loading ? e("p", { role: "status", class: "muted" }, t("previewLoading")) : null,
      !custom && preview.error ? e("div", { class: "stack" },
        e("p", { role: "status", class: "error" }, t("previewLoadError")),
        button("previewRetry", () => void loadPublicPreview(), secondary),
      ) : null,
      translation?.word.trim() ? e("div", { class: "extras-grid extras-preview-cards" },
        previewCard("previewCivil", translation.word, "previewWord"),
        previewCard("previewImposter", hint || t("previewNoHint"), "previewHint"),
        previewCard("previewJoker", translation.word, "previewWord"),
        previewCard("previewBlind", t("previewNoHint"), "previewHint"),
      ) : e("p", { class: "muted" }, t(words.length ? "previewNoWord" : "noWords")),
      hint && translation.word.trim() ? e("div", { class: "extras-flag-form stack" },
        e("label", { class: "field" }, t("flagReason"), reason),
        button("flagHint", () => {
          const result = flagHint({ wordId: word.id, level: preview.level,
            reason: reason.value, word: translation.word, hint });
          issues = result.issues ?? [];
          if (result.ok) note(result.added ? "flagAdded" : "flagDuplicate", result.persisted);
          render("extras-feedback");
        }, secondary),
      ) : null,
    ];
    previewBox.replaceChildren(...children.filter(child => child !== null));
  }

  function flagsPanel() {
    const marked = listHintFlags();
    return e("section", { class: "panel stack", "aria-labelledby": "extras-flags" },
      e("h2", { id: "extras-flags" }, t("flagCount", { count: marked.length })),
      marked.length ? e("ul", { class: "extras-list" }, ...marked.map(flag => e("li", { class: "extras-entry" },
        e("div", { lang: flag.language }, e("strong", {}, flag.word || flag.wordId), e("p", {}, flag.hint)),
        e("p", { class: "muted" }, `${t(flag.language)} · ${t(flag.level)}`),
        flag.reason ? e("p", {}, flag.reason) : null,
        button("flagRemove", () => {
          if (!ask("removeFlagConfirm")) return;
          notice = removeHintFlag(flag.id).persisted ? "" : t("storageError");
          render();
        }, { variant: "ghost" }),
      ))) : e("p", { class: "muted" }, t("flagsEmpty")),
      marked.length ? e("div", { class: "cluster" }, button("flagExport", () => {
        download("imposter-hint-flags.json", serializeHintFlags(), "application/json;charset=utf-8");
      }, secondary), button("flagClear", () => {
        if (!ask("flagClearConfirm")) return;
        notice = clearHintFlags().persisted ? "" : t("storageError");
        render();
      }, { variant: "danger" })) : null,
    );
  }

  function issueText(issue) {
    let key = issue.code;
    if (key === "invalid_file") return t("invalidFile");
    if (key === "invalid_csv" && issue.path === "csv[1]") key = "csv_header";
    else if (key === "invalid_csv" && /Expected \d+ columns/u.test(issue.message ?? "")) key = "csv_columns";
    else if (key === "invalid_csv" && issue.path.endsWith(".type")) key = "csv_record";
    const lookup = `extras.issue.${key}`;
    const translated = ctx.t(lookup);
    return translated === lookup ? t("failed") : translated;
  }

  function issueLine(issue) {
    return e("li", {}, issue.path && issue.path !== "$" ? e("code", {}, `${issue.path} `) : null,
      issueText(issue), issue.related?.length ? e("ul", {}, ...issue.related.map(issueLine)) : null);
  }

  function render(focusId) {
    if (!active()) return;
    previewBox = e("section", { class: "panel stack extras-preview" });
    const editors = draft ? [
      e("section", { class: "panel stack" }, e("h2", {}, t("packageName")), nameFields(draft.names, "name", "extras-pack"),
        e("div", { class: "cluster" }, button("savePackage", saveDraft),
          button("exportJson", () => exportDraft("json"), secondary), button("exportCsv", () => exportDraft("csv"), secondary))),
      categoryPanel(), wordPanel(), pairsPanel(),
    ] : [];
    const operations = e("div", { class: "extras-grid extras-operations" }, packagePicker(), importPanel());
    const marked = flagsPanel();
    const readWarning = !packages.readable || !flags.readable;
    const storageWarning = !packages.persisted || !flags.persisted;
    const message = notice || (storageWarning ? t("storageError") : readWarning ? t("storageReadError") : "");
    root.replaceChildren(e("div", { class: "extras-view stack" },
      e("header", { class: "page-header" }, e("h1", {}, t("editorTitle")), e("p", {}, t("editorIntro"))),
      e("div", { id: "extras-feedback", class: "stack", tabindex: -1, "aria-live": "polite" },
        message ? e("p", { class: "notice" }, message) : null,
        issues.length ? e("div", { class: "panel stack" }, e("h2", {}, t("issueCount", { count: issues.length })),
          e("ul", { class: "extras-list" }, ...issues.map(issueLine))) : null,
      ),
      operations, ...editors, previewBox, marked,
    ));
    renderPreview();
    if (focusId) root.querySelector(`#${focusId}`)?.focus();
  }

  const saved = listCustomPackages();
  if (saved.length === 1) openDraft(saved[0]);
  render();
  void getManifest();
}
