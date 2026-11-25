import { clearHistory, readHistory, recordRound } from "./extras-history.mjs";

const routes = new Set(["home", "local", "online", "custom", "history", "rules"]);
const modes = ["classic", "random", "all", "none", "reverse", "joker", "undercover", "alliance", "blind", "chaos"];
const roles = ["civil", "imposter", "joker", "detective", "guardian", "spy", "accomplice", "double_agent", "undercover"];
const mounts = {
  local: () => import("./local.mjs").then(module => module.mountLocal),
  online: () => import("./online.mjs").then(module => module.mountOnline),
  history: () => import("./extras.mjs").then(module => module.mountExtras),
  custom: () => import("./extras.mjs").then(module => module.mountExtras),
};

const main = document.querySelector("#app-view");
const notice = document.querySelector("#app-notice");
const languageInput = document.querySelector("#app-language");
const themeInput = document.querySelector("#app-theme");
const soundInput = document.querySelector("#app-sound");
const vibrationInput = document.querySelector("#app-vibration");
const rememberInput = document.querySelector("#app-remember-names");
const resetPreferences = document.querySelector("#app-reset-preferences");
const preferencesMenu = document.querySelector("#preferences-menu");
const offlineMenu = document.querySelector("#offline-menu");
const offlineTools = document.querySelector("#offline-tools");
const themeColor = document.querySelector('meta[name="theme-color"]');
const defaultPreferences = { language: "sv", theme: "dark", sound: false, vibration: false, rememberNames: true };
const appName = document.body.dataset.appName;

const unsaved = new Map();
const translations = new Map();
let prefs = { ...defaultPreferences };
let messages = {};
let current = null;
let activeRound = false;
let storageUnavailable = false;
let nextReset = false;
let rulesPromise;
let audio;
let languageChange = 0;

const storage = {
  get(key, fallback = null) {
    if (unsaved.has(key)) return unsaved.get(key) ?? fallback;
    try {
      const value = localStorage.getItem("imposter:" + key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      showStorageWarning();
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("imposter:" + key, JSON.stringify(value));
      unsaved.delete(key);
      return true;
    } catch {
      unsaved.set(key, value);
      showStorageWarning();
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem("imposter:" + key);
      unsaved.delete(key);
      return true;
    } catch {
      unsaved.set(key, null);
      showStorageWarning();
      return false;
    }
  },
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (key === "style" && typeof value === "object") {
      Object.assign(node.style, value);
    } else {
      const attribute = { className: "class", htmlFor: "for", tabIndex: "tabindex" }[key] ?? key;
      node.setAttribute(attribute, value === true ? "" : String(value));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }
  if (tag === "select" && Object.hasOwn(attrs ?? {}, "value")) node.value = attrs.value;
  return node;
}

function button(text, handler, { variant = "primary", class: classes = "", ...attrs } = {}) {
  return el("button", {
    type: "button",
    class: ["button", "button--" + variant, classes].filter(Boolean).join(" "),
    onClick: handler,
    ...attrs,
  }, text);
}

function t(key, values = {}) {
  const text = messages[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match);
}

function notify(message, { error = false } = {}) {
  if (!message) {
    notice.hidden = true;
    notice.textContent = "";
    return;
  }
  notice.dataset.error = String(error);
  notice.hidden = false;
  notice.textContent = message;
}

function showStorageWarning() {
  storageUnavailable = true;
  if (Object.hasOwn(messages, "ui.storageWarning")) {
    notify(t("ui.storageWarning"), { error: true });
  }
}

function saveResult(result, source, options = {}) {
  const { players = result.players, sessionId, completedAt = result.finishedAt } = options;
  const saved = recordRound({
    roundId: result.id,
    result,
    source,
    players,
    sessionId,
    completedAt,
  });
  if (!saved.ok) notify(t("ui.historyError"), { error: true });
  else if (!saved.persisted) showStorageWarning();
  return saved;
}

function readResults() {
  return readHistory().map(entry => ({
    ...entry.result, source: entry.source, players: entry.players,
    finishedAt: entry.completedAt, sessionId: entry.sessionId,
  }));
}

function clearResults() {
  const cleared = clearHistory();
  if (!cleared.persisted) showStorageWarning();
  return cleared;
}

function rules() {
  if (!rulesPromise) {
    rulesPromise = fetch("/api/content/rules").then(response => {
      if (!response.ok) throw new Error("Rules unavailable");
      return response.json();
    }).catch(error => {
      rulesPromise = undefined;
      throw error;
    });
  }
  return rulesPromise;
}

function setRoundActive(active) {
  const next = Boolean(active);
  if (next === activeRound) return;
  activeRound = next;
  languageInput.disabled = next;
  resetPreferences.disabled = next;
  window.dispatchEvent(new CustomEvent("imposter:round-state", { detail: { active: next } }));
}

function feedback(kind) {
  if (prefs.vibration && "vibrate" in navigator) {
    navigator.vibrate(kind === "finish" ? [65, 55, 85] : 38);
  }
  if (!prefs.sound) return;
  const Audio = window.AudioContext ?? window.webkitAudioContext;
  if (!Audio) return;
  try {
    audio ??= new Audio();
    const start = audio.currentTime;
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    const silent = 0.0001;
    tone.frequency.value = { reveal: 475, advance: 330, finish: 580 }[kind] ?? 370;
    tone.type = "sine";
    gain.gain.setValueAtTime(silent, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(silent, start + 0.17);
    tone.connect(gain);
    gain.connect(audio.destination);
    tone.start(start);
    tone.stop(start + 0.18);
    audio.resume().catch(() => {});
  } catch {
    // Playback is optional on devices with a restricted audio context.
  }
}

function modeName(id) {
  return t("ui.mode." + id);
}

function roleName(id) {
  return t("rules.roleName." + id);
}

function rulesView(target, { mode, profiles } = {}) {
  const visibleModes = mode === "chaos" && profiles?.length
    ? [...new Set(profiles.map(profile => profile.mode))].filter(id => modes.includes(id))
    : mode ? [mode] : modes;
  const ruleCards = (items, heading, title, description) =>
    el("section", { class: "stack" },
      el("h2", {}, t(heading)),
      el("div", { class: "rule-grid" }, items.map(id =>
        el("article", { class: "panel panel--subtle rule-card" },
          el("h3", {}, title(id)), el("p", { class: "muted" }, t(description + id))))));
  const basics = el("div", { class: "rule-grid" }, [
    ["rules.flowTitle", "rules.flow"],
    ["rules.voteTitle", "rules.vote"],
    ["rules.guessTitle", "rules.guess"],
    ["rules.abilitiesTitle", "rules.abilities"],
  ].map(([heading, text]) =>
    el("article", { class: "panel rule-card" }, el("h3", {}, t(heading)), el("p", {}, t(text)))));
  target.replaceChildren(el("div", { class: "game-rules" },
    (!mode || mode === "chaos") && el("p", { class: "notice" }, t("rules.chaosPrivacy")),
    ruleCards(visibleModes, "rules.modesTitle", modeName, "rules.mode."),
    basics,
    !mode && ruleCards(roles, "rules.rolesTitle", roleName, "rules.role."),
  ));
}

function context(root, route, view, joinCode = null) {
  return {
    root, route, joinCode, signal: view?.abort.signal,
    get lang() { return prefs.language; },
    navigate, t, el, button, notify, storage, rules, modeName, roleName, rulesView,
    saveResult, readResults, clearResults, feedback,
    preferences: () => ({ ...prefs }),
    isRoundActive: () => activeRound,
    setRoundActive(active) {
      if (!view || current === view) setRoundActive(active);
    },
    setNavigationGuard(handler) {
      if (view && current === view) view.guard = handler;
    },
  };
}

function renderHome(root) {
  const art = el("div", { class: "hero-art", "aria-hidden": "true" },
    el("span", { class: "hero-orbit" }),
    el("span", { class: "hero-card hero-card--back" }),
    el("span", { class: "hero-card hero-card--middle" }),
    el("span", { class: "hero-card hero-card--front" },
      el("span", { class: "hero-card__corner" }, "✦"),
      el("span", { class: "hero-card__symbol" }, "?"),
      el("span", { class: "hero-card__corner hero-card__corner--end" }, "✦")));
  const option = (route, icon, primary = false) =>
    el("a", {
      href: "/#" + route,
      class: "play-option" + (primary ? " play-option--primary" : ""),
      "data-route": route,
      "data-testid": "play-" + route,
    },
    el("span", { class: "play-option__icon", "aria-hidden": "true" }, icon),
    el("span", { class: "play-option__text" },
      el("strong", {}, t("ui." + route)), el("small", {}, t("ui." + route + "Description"))),
    el("span", { class: "play-option__arrow", "aria-hidden": "true" }, "↗"));
  const slogan = prefs.language === "en" ? document.body.dataset.sloganEn : document.body.dataset.sloganSv;
  root.replaceChildren(
    el("section", { class: "home-hero", "aria-labelledby": "home-title" },
      el("div", { class: "home-hero__copy" },
        el("p", { class: "home-slogan" }, slogan),
        el("h1", { id: "home-title" }, appName),
        el("p", { class: "home-hero__description" }, t("ui.homeDescription"))),
      art),
    el("section", { class: "play-options", "aria-label": t("ui.playOptions") },
      option("local", "▣", true), option("online", "⌁")));
}

function renderRules(root) {
  const content = el("div");
  root.replaceChildren(
    el("header", { class: "page-header" },
      el("h1", {}, t("rules.title")), el("p", { class: "muted" }, t("rules.intro"))),
    content);
  rulesView(content);
}

function routeFromLocation() {
  const fragment = location.hash.slice(1);
  const invite = location.pathname.match(/^\/join\/([A-Z0-9]{4,10})\/?$/i);
  if (routes.has(fragment)) return { route: fragment, joinCode: fragment === "online" ? invite?.[1].toUpperCase() ?? null : null };
  return invite
    ? { route: "online", joinCode: invite[1].toUpperCase() }
    : { route: "home", joinCode: null };
}

function viewURL(route, joinCode) {
  return joinCode && route === "online" ? "/join/" + joinCode : "/#" + route;
}

function closeMenus() {
  preferencesMenu.open = false;
  offlineMenu.open = false;
}

function navigate(route) {
  if (!routes.has(route)) return false;
  return activate({ route, joinCode: null }, { push: true, focus: true });
}

function activate({ route, joinCode }, { force = false, push = false, focus = false } = {}) {
  if (!force && current?.route === route && current.joinCode === joinCode) return true;
  if (!force && current?.guard?.() === false) {
    if (!push) history.pushState(null, "", viewURL(current.route, current.joinCode));
    return false;
  }
  if (push) history.pushState(null, "", viewURL(route, joinCode));
  if (focus) closeMenus();
  const old = current;
  const view = { route, joinCode, abort: new AbortController(), cleanup: null, guard: null };
  current = view;
  old?.abort.abort();
  old?.cleanup?.();
  setRoundActive(false);
  const root = el("div", { class: "app-view", "data-view": route });
  main.replaceChildren(root);
  document.querySelectorAll(".site-header [data-route]").forEach(link => {
    if (link.dataset.route === route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (focus) {
    main.focus();
    window.scrollTo(0, 0);
  }
  if (route === "home") renderHome(root);
  else if (route === "rules") renderRules(root);
  else {
    root.append(el("p", { class: "notice", role: "status" }, t("ui.loading")));
    mounts[route]().then(mount => {
      if (current !== view) return undefined;
      if (typeof mount !== "function") throw new TypeError("Missing view mount");
      root.replaceChildren();
      return mount(context(root, route, view, joinCode));
    }).then(cleanup => {
      if (typeof cleanup !== "function") return;
      if (current === view) view.cleanup = cleanup;
      else cleanup();
    }).catch(() => {
      if (view.abort.signal.aborted) return;
      root.replaceChildren(el("section", { class: "panel stack" },
        el("h1", {}, t("ui.viewErrorTitle")),
        el("p", {}, t("ui.viewError")),
        el("div", { class: "cluster" },
          button(t("ui.retry"), () => activate({ route, joinCode }, { force: true })),
          button(t("ui.home"), () => navigate("home"), { variant: "secondary" }))));
    });
  }
  return true;
}

async function getMessages(language) {
  if (translations.has(language)) return translations.get(language);
  const response = await fetch("/api/i18n/" + language + ".json");
  if (!response.ok) throw new Error("Translation unavailable");
  const dictionary = await response.json();
  translations.set(language, dictionary);
  return dictionary;
}

function useMessages(dictionary) {
  messages = dictionary;
  document.documentElement.lang = prefs.language;
  const slogan = prefs.language === "en" ? document.body.dataset.sloganEn : document.body.dataset.sloganSv;
  document.title = appName + " · " + slogan;
  document.querySelectorAll("[data-i18n]").forEach(node => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-label]").forEach(node => {
    node.setAttribute("aria-label", t(node.dataset.i18nLabel));
  });
  if (storageUnavailable) showStorageWarning();
}

function updateTheme() {
  document.documentElement.dataset.theme = prefs.theme;
  themeColor.content = prefs.theme === "light" ? "#f6f2fb" : "#111016";
  themeInput.value = prefs.theme;
}

function updateInputs() {
  updateTheme();
  languageInput.value = prefs.language;
  soundInput.checked = prefs.sound;
  vibrationInput.checked = prefs.vibration;
  rememberInput.checked = prefs.rememberNames;
}

async function changeLanguage(language) {
  const request = ++languageChange;
  if (activeRound || language === prefs.language) return;
  try {
    const dictionary = await getMessages(language);
    if (request !== languageChange || activeRound) return;
    prefs.language = language;
    storage.set("preferences", prefs);
    useMessages(dictionary);
    window.dispatchEvent(new CustomEvent("imposter:language", { detail: { language } }));
    activate(routeFromLocation(), { force: true });
  } catch {
    if (request !== languageChange) return;
    notify(t("ui.languageError"), { error: true });
  } finally {
    if (request === languageChange) languageInput.value = prefs.language;
  }
}

function wireControls() {
  document.addEventListener("click", event => {
    const link = event.target.closest("a[data-route]");
    if (link && event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      navigate(link.dataset.route);
    }
    if (!event.target.closest(".site-tool")) closeMenus();
  });
  document.querySelector(".skip-link").addEventListener("click", event => {
    event.preventDefault();
    main.focus();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const openMenu = document.querySelector(".site-tool[open]");
    if (openMenu) {
      closeMenus();
      openMenu.querySelector("summary").focus();
    }
  });
  preferencesMenu.addEventListener("toggle", () => {
    if (preferencesMenu.open) offlineMenu.open = false;
  });
  offlineMenu.addEventListener("toggle", () => {
    if (offlineMenu.open) preferencesMenu.open = false;
  });
  const syncURL = () => activate(routeFromLocation(), { focus: true });
  window.addEventListener("popstate", syncURL);
  window.addEventListener("hashchange", syncURL);
  languageInput.addEventListener("change", () => changeLanguage(languageInput.value));
  themeInput.addEventListener("change", () => {
    prefs.theme = themeInput.value;
    storage.set("preferences", prefs);
    updateTheme();
  });
  Object.entries({ sound: soundInput, vibration: vibrationInput, rememberNames: rememberInput }).forEach(([key, input]) => {
    input.addEventListener("change", () => {
      prefs[key] = input.checked;
      storage.set("preferences", prefs);
      if (key === "rememberNames" && !input.checked) storage.remove("localPlayers");
      else if (key !== "rememberNames" && input.checked) feedback("advance");
    });
  });
  resetPreferences.addEventListener("click", async () => {
    if (nextReset || !window.confirm(t("ui.confirmReset"))) return;
    nextReset = true;
    if (prefs.language !== defaultPreferences.language) await changeLanguage(defaultPreferences.language);
    prefs = { ...defaultPreferences, language: prefs.language };
    storage.remove("localSettings");
    storage.remove("localPlayers");
    storage.set("preferences", prefs);
    window.dispatchEvent(new Event("imposter:local-settings"));
    updateInputs();
    activate(routeFromLocation(), { force: true });
    if (!storageUnavailable) notify(t("ui.resetDone"));
    nextReset = false;
  });
}

async function boot() {
  const saved = storage.get("preferences", {});
  prefs = {
    language: saved?.language === "en" ? "en" : "sv",
    theme: saved?.theme === "light" ? "light" : "dark",
    sound: saved?.sound === true,
    vibration: saved?.vibration === true,
    rememberNames: saved?.rememberNames !== false,
  };
  updateInputs();
  try {
    let dictionary;
    try {
      dictionary = await getMessages(prefs.language);
    } catch (error) {
      if (prefs.language === "sv") throw error;
      dictionary = await getMessages("sv");
      prefs.language = "sv";
      updateInputs();
    }
    useMessages(dictionary);
  } catch {
    main.replaceChildren(el("section", { class: "panel stack" },
      el("h1", {}, appName),
      el("p", {}, prefs.language === "en"
        ? "The interface could not load. Reconnect and try again."
        : "Gränssnittet kunde inte laddas. Anslut och försök igen."),
      button(prefs.language === "en" ? "Try again" : "Försök igen", () => location.reload())));
    return;
  }
  wireControls();
  activate(routeFromLocation());
  import("./offline.mjs").then(module => module.mountOffline(context(offlineTools, "home", null)))
    .catch(() => {
      offlineTools.replaceChildren(el("p", { class: "error" }, t("ui.offlineError")));
    });
}

boot();
