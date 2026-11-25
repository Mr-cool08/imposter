import { loadContent, loadManifest } from "./content.mjs";
import { profileIssues } from "./engine.mjs";
import { getCustomContent } from "./extras.mjs";

const modes = ["classic", "random", "joker", "undercover", "alliance", "blind", "chaos"];
const retiredRandomModes = ["none", "reverse", "all"];
const extraRoles = ["spy", "accomplice", "double_agent"];
const levels = ["familiar", "intermediate", "expert"];
const extraModes = ["classic", "random", "blind", "alliance"];
const categoryIcons = {
    minecraft: "⬢", "clash-royale": "♜", games: "✦", everyday: "▦", technology: "⌘",
    food: "◒", animals: "❉", nature: "✿", sports: "◉", vehicles: "➤", "film-tv": "▣",
    music: "♫", travel: "✧", occupations: "⚒", "home-school-clothes": "⌂",
};

export const DEFAULT_SETTINGS = Object.freeze({
    freePlay: true,
    mode: "classic",
    joker: false,
    extraRole: null,
    randomMin: null,
    randomMax: null,
    language: "sv",
    hint: "normal",
    subcategories: Object.freeze([]),
    levels: Object.freeze(["familiar"]),
    chaos: Object.freeze([]),
});

const profileDefaults = { joker: false, extraRole: null, randomMin: null, randomMax: null };

function newProfile(mode) {
    return { mode, ...profileDefaults, weight: 1 };
}

function choose(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

function chosenIds(value, fallback) {
    return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === "string"))] : fallback;
}

function resolveRandomPreset(settings, count) {
    if (!settings.randomPreset) return settings;
    const offset = settings.randomPreset === "reverse" ? 1 : 0;
    const fixed = settings.randomPreset === "none" ? 0 : Math.max(0, count - offset);
    return { ...settings, randomMin: fixed, randomMax: fixed };
}

function readMode(mode) {
    return retiredRandomModes.includes(mode) ? "random" : mode;
}

function readModifiers(settings, count, fallback = profileDefaults) {
    const { joker = fallback.joker, extraRole = fallback.extraRole, randomMin = fallback.randomMin, randomMax = fallback.randomMax } = settings;
    if (retiredRandomModes.includes(settings.mode)) {
        return resolveRandomPreset({ ...profileDefaults, randomPreset: settings.mode }, count);
    }
    const modifiers = { joker, extraRole: choose(extraRole, extraRoles, null), randomMin, randomMax };
    if (settings.mode === "random" && retiredRandomModes.includes(settings.randomPreset)) {
        return resolveRandomPreset({ ...modifiers, randomPreset: settings.randomPreset }, count);
    }
    return modifiers;
}

function readSettings(settings, language, count) {
    const modifiers = readModifiers(settings, count);
    const mode = choose(readMode(settings.mode), modes, DEFAULT_SETTINGS.mode);
    const profiles = Array.isArray(settings.chaos)
        ? settings.chaos.filter((profile) => profile && typeof profile === "object")
        : [];
    const value = {
        freePlay: true,
        mode,
        ...modifiers,
        language: choose(settings.language, ["sv", "en"], language),
        hint: choose(settings.hint, ["easy", "normal", "hard"], DEFAULT_SETTINGS.hint),
        subcategories: chosenIds(settings.subcategories, []),
        levels: chosenIds(settings.levels, DEFAULT_SETTINGS.levels).filter((level) => levels.includes(level)),
        chaos: profiles.map((profile) => ({
            mode: readMode(profile.mode),
            ...readModifiers(profile, count, mode === "chaos" ? modifiers : profileDefaults),
            weight: profile.weight,
        })),
    };
    if (Array.isArray(settings.categories)) {
        value.categories = chosenIds(settings.categories);
    }
    return cleanMode(value);
}

function cleanMode(value) {
    const result = { ...value };
    if (!extraModes.includes(value.mode)) result.joker = false;
    if (!extraModes.includes(value.mode) || (value.extraRole === "spy" && !["classic", "random"].includes(value.mode))) {
        result.extraRole = null;
    }
    if (value.mode !== "random") {
        Object.assign(result, { randomMin: null, randomMax: null });
        delete result.randomPreset;
    }
    return result;
}

function editSettings(settings, patch) {
    const next = { ...settings, ...patch };
    if ("randomMin" in patch || "randomMax" in patch) delete next.randomPreset;
    if ("mode" in patch && patch.mode !== "random" && next.randomPreset) {
        delete next.randomPreset;
        Object.assign(next, { randomMin: null, randomMax: null });
    }
    return next;
}

export function mountSettings(ctx, {
    root = ctx.root, settings = DEFAULT_SETTINGS, playerCount = 0, onChange = () => {}, onSelection = () => {},
} = {}) {
    const { el, button, t, modeName, roleName } = ctx;
    const controller = new AbortController();
    const fetchContent = (input, init) => fetch(input, { ...init, signal: controller.signal });
    const scope = new Intl.NumberFormat(ctx.lang);
    const editor = el("div", { class: "settings-editor stack" });
    const catalog = el("section", { class: "settings-catalog stack", "aria-label": t("settings.categories") });
    const choices = el("div", { class: "category-grid" });
    const counts = el("p", { class: "settings-counts muted", role: "status" });
    const issuesList = el("ul", { class: "settings-issues error", "aria-live": "polite" });
    const modeDescription = el("p", { class: "settings-mode__description muted" });
    const modeRange = el("div", { class: "stack" });
    const modeAdvanced = el("div", { class: "settings-mode-advanced stack" });
    const pool = el("section", { class: "chaos-pool stack", "aria-label": t("settings.chaos_pool") });
    const buttonAttrs = { variant: "ghost" };
    let value = readSettings(settings === DEFAULT_SETTINGS ? {} : settings, ctx.lang, playerCount);
    let chaosInitialized = value.mode === "chaos" || value.chaos.length > 0;
    let selection = { words: [], pairs: [], categories: [], issues: [], loading: true, error: null };
    let revision = 0;
    let manifest;
    let rules;
    let manifestTask;
    let rulesTask;
    let categories = [];
    const categoryDetails = new Map();
    const profileErrorLists = [];
    const selectedCustom = getCustomContent();

    function label(text, input) {
        return el("label", { class: "field" }, el("span", {}, text), input);
    }

    function select(key, selected, options, change) {
        const input = el("select", { name: key }, ...options.map(([id, title]) => el("option", { value: id }, title)));
        input.value = selected === null ? "" : String(selected);
        input.addEventListener("change", () => change(input.value));
        return label(t(`settings.${key}`), input);
    }

    function checkbox(text, checked, change, className = "settings-check") {
        const input = el("input", { type: "checkbox" });
        input.checked = checked;
        input.addEventListener("change", () => change(input.checked));
        return el("label", { class: className }, input, text);
    }

    function modeOptions(allowed = modes) {
        return allowed.map((id) => {
            const min = rules?.modes[id]?.min ?? (["joker", "alliance"].includes(id) ? 5 : 3);
            const name = min <= 3 || playerCount >= min ? modeName(id) : t("settings.mode_min", { mode: modeName(id), min });
            return [id, name];
        });
    }

    function updateModeOptions() {
        for (const input of root.querySelectorAll('select[name="mode"], select[name="profile_mode"]')) {
            const selected = input.value;
            const options = modeOptions(input.name === "mode" ? modes : modes.slice(0, -1));
            for (const [index, option] of Array.from(input.options).entries()) option.textContent = options[index][1];
            input.value = selected;
        }
    }

    function getSettings() {
        return structuredClone(value);
    }

    function handleChange(next, { filtering = false, modeChanged = false, poolChanged = false } = {}) {
        value = next;
        if (modeChanged) renderMode();
        else if (poolChanged) renderPool();
        updateRandomRanges();
        onChange(getSettings());
        if (filtering) void refreshSelection();
        else validateSelection();
    }

    function changeField(key, next, options) {
        handleChange(editSettings(value, { [key]: next }), options);
    }

    function validProfile(profile) {
        return profile && modes.includes(profile.mode) && profile.mode !== "chaos";
    }

    function selectMode(mode) {
        const next = cleanMode({ ...value, mode });
        if (mode === "chaos" && !chaosInitialized) {
            chaosInitialized = true;
            next.chaos = [newProfile("classic"), newProfile("random")];
        }
        handleChange(next, { modeChanged: true });
    }

    function numberField(key, number, update, { min = 1, max, step = 1 } = {}) {
        const attributes = { name: key, type: "number", min, step };
        if (max !== undefined) attributes.max = max;
        const input = el("input", attributes);
        if (Number.isFinite(number)) input.value = String(number);
        input.addEventListener("input", () => update(Number.isNaN(input.valueAsNumber) ? null : input.valueAsNumber));
        return label(t(`settings.${key}`), input);
    }

    function updateRandomRange(group, settings) {
        const automaticUsesFullRange = !settings.joker && !settings.extraRole;
        for (const field of group.querySelectorAll("input")) {
            field.max = String(playerCount);
            const count = field.name === "randomMin" ? 0 : playerCount;
            field.placeholder = automaticUsesFullRange ? t("settings.auto_count", { count }) : t("settings.auto");
            if (settings.randomPreset) field.value = String(settings[field.name]);
        }
        group.querySelector("[data-range-help]").textContent = t("settings.random_help", { max: playerCount });
        const specials = group.querySelector("[data-range-specials]");
        specials.hidden = playerCount < (rules?.modes.random?.min ?? 3);
        specials.textContent = t("settings.random_specials", {
            max: playerCount, reverse: playerCount - 1,
            noneMode: modeName("none"), reverseMode: modeName("reverse"), allMode: modeName("all"),
        });
        const preset = group.querySelector("[data-range-preset]");
        preset.hidden = !settings.randomPreset;
        preset.textContent = settings.randomPreset ? t("settings.random_saved_preset", { mode: modeName(settings.randomPreset) }) : "";
    }

    function randomRange(settings, change, owner) {
        const bounds = ["randomMin", "randomMax"].map((key) => numberField(key, settings[key], (number) => change(key, number),
            { min: 0, max: playerCount }));
        const group = el("div", { class: "stack", "data-random-range": owner },
            el("div", { class: "settings-grid" }, ...bounds),
            el("p", { class: "muted", "data-range-help": "" }),
            el("p", { class: "muted", "data-range-specials": "" }),
            el("p", { class: "notice", "data-range-preset": "" }));
        updateRandomRange(group, settings);
        return group;
    }

    function updateRandomRanges() {
        for (const group of editor.querySelectorAll("[data-random-range]")) {
            const owner = group.dataset.randomRange;
            updateRandomRange(group, owner === "main" ? value : value.chaos[Number(owner)]);
        }
    }

    function modifiers(modifier, mode, change) {
        const controls = el("div", { class: "stack" });
        const supportsJoker = extraModes.includes(mode);
        const availableExtraRoles = extraRoles.filter((role) => rules
            ? rules.extras[role]?.modes.includes(mode)
            : extraModes.includes(mode) && (role !== "spy" || ["classic", "random"].includes(mode)));
        if (!supportsJoker && !modifier.joker && availableExtraRoles.length === 0 && !modifier.extraRole) return null;
        if (supportsJoker || (modifier.joker && mode !== "joker")) {
            controls.append(checkbox(t("settings.joker"), Boolean(modifier.joker), (checked) => change("joker", checked)));
        }
        if (supportsJoker) {
            controls.append(el("p", { class: "muted" }, t("settings.joker_help")));
        } else if (mode === "joker") {
            controls.append(el("p", { class: "muted" }, t("settings.joker_included")));
        } else {
            controls.append(el("p", { class: "muted" }, t("settings.joker_disabled")));
        }
        if (availableExtraRoles.length || modifier.extraRole) {
            const listed = new Set(availableExtraRoles);
            if (modifier.extraRole) listed.add(modifier.extraRole);
            const options = [["", t("settings.no_extra")], ...Array.from(listed, (id) => [id, roleName(id)])];
            controls.append(select("extraRole", modifier.extraRole, options, (id) => change("extraRole", id || null)));
        }
        if (availableExtraRoles.length) {
            controls.append(el("p", { class: "muted" }, t("settings.extra_help")));
            if (!availableExtraRoles.includes("spy")) controls.append(el("p", { class: "muted" }, t("settings.spy_modes")));
        } else {
            controls.append(el("p", { class: "muted" }, t("settings.extra_disabled")));
        }
        return controls;
    }

    function patchProfile(index, patch, rerender = false) {
        const chaos = value.chaos.map((profile, i) => i === index ? editSettings(profile, patch) : profile);
        handleChange({ ...value, chaos }, { poolChanged: rerender });
        if (rerender) pool.querySelectorAll('select[name="profile_mode"]')[index]?.focus();
    }

    function renderPool() {
        pool.replaceChildren();
        profileErrorLists.length = 0;
        pool.hidden = value.mode !== "chaos";
        if (pool.hidden) return;
        pool.append(el("h3", {}, t("settings.chaos_pool")), el("p", { class: "muted" }, t("settings.chaos_help")));
        const allowed = modes.slice(0, -1);
        value.chaos.forEach((profile, index) => {
            const identity = t("settings.profile", { count: index + 1 });
            const labelText = `${identity} · ${modeName(profile.mode)}`;
            const remove = button(t("settings.remove_profile"), () => {
                changeField("chaos", value.chaos.filter((_, i) => i !== index), { poolChanged: true });
                pool.querySelectorAll('select[name="profile_mode"]')[Math.min(index, value.chaos.length - 1)]?.focus();
                if (!value.chaos.length) pool.querySelector('[data-action="add-profile"]').focus();
            }, { ...buttonAttrs, "aria-label": t("settings.remove_named_profile", { name: labelText }) });
            const heading = el("legend", {}, identity);
            const form = el("fieldset", { class: "chaos-profile panel panel--subtle stack" }, heading,
                el("div", { class: "settings-grid" },
                    select("profile_mode", profile.mode, modeOptions(allowed), (mode) => patchProfile(index, { mode }, true)),
                    numberField("weight", profile.weight, (weight) => patchProfile(index, { weight }), { min: 0, step: "any" })),
                el("p", { class: "muted" }, t(`settings.mode_description.${profile.mode}`)),
            );
            if (profile.mode === "random") {
                form.append(randomRange(profile, (key, number) => patchProfile(index, { [key]: number }), index));
            }
            if (validProfile(profile)) {
                const controls = modifiers(profile, profile.mode, (key, item) => patchProfile(index, { [key]: item }));
                if (controls) {
                    form.append(el("details", { class: "settings-advanced" }, el("summary", {}, t("settings.profile_options")), controls));
                }
            }
            const profileIssuesList = el("ul", { class: "settings-issues error", "aria-live": "polite" });
            profileErrorLists.push(profileIssuesList);
            form.append(profileIssuesList, remove);
            pool.append(form);
        });
        pool.append(button(t("settings.add_profile"), () => {
            const mode = allowed.find((id) => !value.chaos.some((profile) => profile.mode === id)) ?? "classic";
            changeField("chaos", [...value.chaos, newProfile(mode)], { poolChanged: true });
            pool.querySelector('fieldset:last-of-type select')?.focus();
        }, { variant: "secondary", "data-action": "add-profile" }));
    }

    function renderMode() {
        modeDescription.textContent = t(`settings.mode_description.${value.mode}`);
        const range = value.mode === "random" ? randomRange(value, changeField, "main") : null;
        modeRange.replaceChildren(...(range ? [range] : []));
        modeRange.hidden = !range;
        const controls = modifiers(value, value.mode, (key, item) => changeField(key, item));
        modeAdvanced.replaceChildren(...(controls ? [controls] : []));
        modeAdvanced.hidden = !controls;
        renderPool();
    }

    function updateCategory(category, checked) {
        const active = value.categories ?? categories.map(({ id }) => id);
        const selected = new Set(active);
        if (checked) selected.add(category.id);
        else selected.delete(category.id);
        const subcategoryIds = new Set(category.subcategories.map(({ id }) => id));
        const subcategories = checked ? value.subcategories : value.subcategories.filter((id) => !subcategoryIds.has(id));
        handleChange({ ...value, categories: [...selected], subcategories }, { filtering: true });
        const details = categoryDetails.get(category.id);
        if (details) {
            details.hidden = !checked;
            if (!checked) for (const input of details.querySelectorAll('input[type="checkbox"]')) input.checked = false;
        }
    }

    function toggleMembership(key, id, checked) {
        const ids = new Set(value[key]);
        if (checked) ids.add(id);
        else ids.delete(id);
        changeField(key, [...ids], { filtering: true });
    }

    function renderCategories() {
        categoryDetails.clear();
        choices.replaceChildren();
        const categorySelection = new Set(value.categories ?? categories.map(({ id }) => id));
        for (const category of categories) {
            const isActive = categorySelection.has(category.id);
            const name = category.names[ctx.lang] ?? category.names.sv ?? category.id;
            const icon = categoryIcons[category.id] ?? "◇";
            const choice = checkbox(el("span", {}, el("span", { class: "category-card__icon", "aria-hidden": "true" }, icon), name),
                isActive, (checked) => updateCategory(category, checked), "category-card__select");
            const card = el("div", { class: "category-card", "data-category": category.id }, choice);
            if (category.subcategories.length) {
                const details = el("details", { class: "category-card__details" },
                    el("summary", {}, t("settings.subcategories")),
                    el("div", { class: "stack" }, ...category.subcategories.map((item) => checkbox(
                        item.names[ctx.lang] ?? item.names.sv ?? item.id, value.subcategories.includes(item.id),
                        (checked) => toggleMembership("subcategories", item.id, checked),
                    ))));
                details.hidden = !isActive;
                categoryDetails.set(category.id, details);
                card.append(details);
            }
            choices.append(card);
        }
    }

    function setCategories(all) {
        const next = { ...value, subcategories: [] };
        if (all) delete next.categories;
        else next.categories = [];
        handleChange(next, { filtering: true });
        renderCategories();
    }

    function formatIssue(issue) {
        const mode = issue.mode;
        const min = Math.max(3, rules?.modes[mode]?.min ?? 0);
        const max = rules?.playerMax ?? 20;
        const key = `settings.issue.${issue.code}`;
        const translated = t(key, { min, max });
        return translated === key ? t("settings.issue.invalid_settings") : translated;
    }

    function renderIssues(list, issues) {
        list.replaceChildren(...issues.map((issue) => el("li", {}, formatIssue(issue))));
        list.hidden = issues.length === 0;
    }

    function renderStatus() {
        counts.replaceChildren();
        if (selection.loading) counts.append(t("settings.loading"));
        else if (selection.error) counts.append(selection.error, button(t("settings.retry"), () => void refreshSelection(), buttonAttrs));
        else counts.append(t("settings.counts", { words: scope.format(selection.words.length), pairs: scope.format(selection.pairs.length) }));
        renderIssues(issuesList, value.mode === "chaos"
            ? selection.issues.filter(({ mode }) => mode === "chaos" || mode === null)
            : selection.issues);
        for (const [index, list] of profileErrorLists.entries()) {
            const issues = selection.loading || selection.error || !rules ? [] : profileIssues(
                { ...value, chaos: [value.chaos[index]] }, playerCount, selection.words, selection.pairs, rules,
            ).filter(({ mode }) => mode !== "chaos" && mode !== null);
            renderIssues(list, issues);
        }
    }

    function publish(next) {
        selection = next;
        renderStatus();
        onSelection(selection);
    }

    function validateSelection() {
        if (!selection.loading && !selection.error && rules) {
            publish({ ...selection, issues: profileIssues(value, playerCount, selection.words, selection.pairs, rules) });
        }
    }

    async function getManifest() {
        if (manifest) return manifest;
        manifestTask ??= loadManifest({ fetch: fetchContent }).then((loaded) => {
            manifest = loaded;
            return manifest;
        }).finally(() => { manifestTask = undefined; });
        return manifestTask;
    }

    async function getRules() {
        if (rules) return rules;
        rulesTask ??= Promise.resolve().then(() => ctx.rules()).then((loaded) => {
            rules = loaded;
            updateModeOptions();
            return rules;
        }).finally(() => { rulesTask = undefined; });
        return rulesTask;
    }

    async function refreshSelection() {
        if (controller.signal.aborted) return;
        const request = ++revision;
        const snapshot = getSettings();
        publish({ words: [], pairs: [], categories, issues: [], loading: true, error: null });
        try {
            const currentManifest = await getManifest();
            if (request !== revision || controller.signal.aborted) return;
            if (!categories.length) {
                categories = [...currentManifest.categories, ...(selectedCustom?.categories ?? [])];
                renderCategories();
            }
            const [content, ruleData] = await Promise.all([
                loadContent(snapshot, { manifest: currentManifest, custom: selectedCustom, fetch: fetchContent }),
                getRules(),
            ]);
            if (request !== revision || controller.signal.aborted) return;
            const validation = profileIssues(value, playerCount, content.words, content.pairs, ruleData);
            publish({ ...content, categories, loading: false, error: null, issues: validation });
        } catch {
            if (request !== revision || controller.signal.aborted) return;
            publish({ words: [], pairs: [], categories, issues: [], loading: false, error: t(manifest ? "settings.content_error" : "settings.catalog_error") });
        }
    }

    function refreshAfterOffline() {
        if (selection.error) void refreshSelection();
    }

    const modeInput = select("mode", value.mode, modeOptions(), selectMode);
    const basic = el("div", { class: "settings-grid settings-modes" },
        el("div", { class: "settings-mode stack" }, modeInput, modeDescription),
        select("hint", value.hint, ["easy", "normal", "hard"].map((id) => [id, t(`settings.hint.${id}`)]),
            (id) => changeField("hint", id, { filtering: true })));
    catalog.append(el("h3", {}, t("settings.categories")),
        el("div", { class: "cluster" }, button(t("settings.all_categories"), () => setCategories(true), buttonAttrs),
            button(t("settings.clear_categories"), () => setCategories(false), buttonAttrs)),
        choices, el("p", { class: "muted" }, t("settings.subcategories_help")),
        el("fieldset", { class: "stack" }, el("legend", {}, t("settings.levels")),
            el("div", { class: "cluster" }, ...levels.map((level) => checkbox(t(`settings.level.${level}`), value.levels.includes(level),
                (checked) => toggleMembership("levels", level, checked))))), counts);
    const wordLanguage = select("language", value.language, [["sv", "Svenska"], ["en", "English"]],
        (item) => changeField("language", item, { filtering: true }));
    const advanced = el("details", { class: "settings-advanced" },
        el("summary", {}, t("settings.advanced")), el("div", { class: "stack" }, wordLanguage, modeAdvanced));
    editor.append(basic, modeRange, catalog, advanced, pool, issuesList);
    root.replaceChildren(editor);
    renderMode();
    window.addEventListener("imposter:offline-change", refreshAfterOffline, { signal: controller.signal });
    ctx.signal?.addEventListener("abort", destroy, { once: true, signal: controller.signal });
    queueMicrotask(() => void refreshSelection());

    function destroy() {
        controller.abort();
        editor.remove();
    }

    return {
        getSettings,
        getSelection: () => selection,
        setPlayerCount(count) {
            if (playerCount === count) return;
            playerCount = count;
            if (value.randomPreset || value.chaos.some((profile) => profile.randomPreset)) {
                value = {
                    ...resolveRandomPreset(value, count),
                    chaos: value.chaos.map((profile) => resolveRandomPreset(profile, count)),
                };
                onChange(getSettings());
            }
            updateModeOptions();
            updateRandomRanges();
            validateSelection();
        },
        destroy,
    };
}
