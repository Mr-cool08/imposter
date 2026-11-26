const byId = (id) => document.getElementById(id);
const main = byId("app-view");
const localRoot = byId("local-view");
const wordTools = byId("word-tools");
const wordToolsRoot = byId("word-tools-view");
const guideView = byId("guide-view");
const guideRoot = byId("guide-content");
const guideLink = byId("guide-link");
const guideBack = byId("guide-back");
const gameLink = byId("game-link");
const openWords = byId("open-word-tools");
const closeWords = byId("close-word-tools");
const notice = byId("app-notice");
const preferencesMenu = byId("preferences-menu");
const themeColor = document.querySelector('meta[name="theme-color"]');
const themeInput = byId("app-theme");
const soundInput = byId("app-sound");
const vibrationInput = byId("app-vibration");
const rememberInput = byId("app-remember-names");
const resetPreferences = byId("app-reset-preferences");
const slogan = byId("app-slogan");
const appName = document.body.dataset.appName;
const defaultPreferences = { theme: "dark", sound: false, vibration: false, rememberNames: true };
const guideHash = "#regler";

const unsaved = new Map();
let prefs = { ...defaultPreferences };
let messages = {};
let storageUnavailable = false;
let activeRound = false;
let localView;
let wordsView;
let guideMounted = false;
let rulesPromise;
let audio;

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
    if (value === null || value === undefined || (value === false && !key.startsWith("aria-"))) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else {
      const attribute = { className: "class", htmlFor: "for", tabIndex: "tabindex" }[key] ?? key;
      node.setAttribute(attribute, value === true && !key.startsWith("aria-") ? "" : String(value));
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
  notice.hidden = !message;
  notice.dataset.error = String(error);
  notice.textContent = message ?? "";
}

function showStorageWarning() {
  storageUnavailable = true;
  if (Object.hasOwn(messages, "ui.storageWarning")) notify(t("ui.storageWarning"), { error: true });
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
  if (next) preferencesMenu.open = false;
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
    // Sound is optional on devices that restrict an audio context.
  }
}

function context(root, view) {
  return {
    root, signal: view?.abort.signal,
    lang: "sv",
    t, el, button, notify, storage, rules, feedback,
    modeName: id => t("ui.mode." + id),
    roleName: id => t("rules.roleName." + id),
    preferences: () => ({ ...prefs }),
    setRoundActive(active) {
      if (localView === view) setRoundActive(active);
    },
    setNavigationGuard(handler) {
      if (view) view.guard = handler;
    },
  };
}

function loadError(root, retry) {
  root.replaceChildren(el("div", { class: "panel stack" },
    el("p", { class: "error", role: "alert" }, t("ui.loadError")), button(t("ui.retry"), retry)));
}

async function mountLocalView() {
  if (localView) {
    localView.abort.abort();
    localView.cleanup?.();
  }
  const view = { abort: new AbortController() };
  localView = view;
  try {
    const { mountLocal } = await import("./local.mjs");
    if (localView === view) view.cleanup = mountLocal(context(localRoot, view));
  } catch {
    if (localView === view) loadError(localRoot, mountLocalView);
  }
}

async function mountGuideView() {
  if (guideMounted) return;
  guideRoot.replaceChildren(el("p", { class: "muted", role: "status" }, t("ui.loading")));
  try {
    const { mountGuide } = await import("./guide.mjs");
    if (guideView.hidden || guideMounted) return;
    guideRoot.replaceChildren();
    mountGuide(context(guideRoot));
    guideMounted = true;
  } catch {
    if (!guideView.hidden) loadError(guideRoot, mountGuideView);
  }
}

function updatePageTitle() {
  document.title = guideView.hidden
    ? appName + " · " + slogan.textContent
    : t("guide.navigation") + " · " + appName;
}

function showCurrentPage({ focus = false } = {}) {
  const guide = location.hash === guideHash;
  const changed = guide !== !guideView.hidden;
  if (guide && changed) localView?.guard?.();
  guideView.hidden = !guide;
  localRoot.hidden = guide || Boolean(wordsView);
  wordTools.hidden = guide || !wordsView;
  preferencesMenu.hidden = Boolean(wordsView);
  openWords.hidden = guide;
  resetPreferences.hidden = guide;
  if (guide) guideLink.setAttribute("aria-current", "page");
  else guideLink.removeAttribute("aria-current");
  if (guide && changed) void mountGuideView();
  if (!guide && !localView) void mountLocalView();
  updatePageTitle();
  if (focus && changed) {
    preferencesMenu.open = false;
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function followPageLink(event) {
  if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  event.preventDefault();
  const next = event.currentTarget.getAttribute("href");
  if (location.pathname + location.search + location.hash !== next) history.pushState(null, "", next);
  showCurrentPage({ focus: true });
}

async function showWordTools() {
  if (activeRound || wordsView || !guideView.hidden) return;
  preferencesMenu.open = false;
  const view = { abort: new AbortController() };
  wordsView = view;
  showCurrentPage();
  closeWords.focus();
  wordToolsRoot.replaceChildren(el("p", { class: "muted", role: "status" }, t("ui.loading")));
  try {
    const { mountExtras } = await import("./extras.mjs");
    if (wordsView === view) view.cleanup = mountExtras(context(wordToolsRoot, view));
  } catch {
    if (wordsView === view) loadError(wordToolsRoot, () => {
      closeWordTools();
      void showWordTools();
    });
  }
}

function closeWordTools() {
  if (!wordsView || wordsView.guard?.() === false) return;
  wordsView.abort.abort();
  wordsView.cleanup?.();
  wordsView = null;
  wordToolsRoot.replaceChildren();
  showCurrentPage();
  window.dispatchEvent(new Event("imposter:custom-content"));
  main.focus();
}

async function getMessages() {
  const response = await fetch("/api/i18n/sv.json");
  if (!response.ok) throw new Error("Translation unavailable");
  return response.json();
}

function useMessages(dictionary) {
  messages = dictionary;
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
  soundInput.checked = prefs.sound;
  vibrationInput.checked = prefs.vibration;
  rememberInput.checked = prefs.rememberNames;
}

function wireControls() {
  for (const link of [gameLink, guideLink, guideBack]) link.addEventListener("click", followPageLink);
  const onNavigation = () => showCurrentPage({ focus: true });
  window.addEventListener("popstate", onNavigation);
  window.addEventListener("hashchange", onNavigation);
  document.addEventListener("click", event => {
    if (!event.target.closest("#preferences-menu")) preferencesMenu.open = false;
  });
  document.querySelector(".skip-link").addEventListener("click", event => {
    event.preventDefault();
    main.focus();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && preferencesMenu.open) {
      preferencesMenu.open = false;
      preferencesMenu.querySelector("summary").focus();
    }
  });
  openWords.addEventListener("click", showWordTools);
  closeWords.addEventListener("click", closeWordTools);
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
    if (activeRound || !window.confirm(t("ui.confirmReset"))) return;
    resetPreferences.disabled = true;
    try {
      prefs = { ...defaultPreferences };
      storage.remove("localSettings");
      storage.remove("localPlayers");
      storage.set("preferences", prefs);
      updateInputs();
      await mountLocalView();
      if (!storageUnavailable) notify(t("ui.resetDone"));
    } finally {
      resetPreferences.disabled = false;
    }
  });
}

async function boot() {
  const saved = storage.get("preferences", {});
  prefs = {
    theme: saved?.theme === "light" ? "light" : "dark",
    sound: saved?.sound === true,
    vibration: saved?.vibration === true,
    rememberNames: saved?.rememberNames !== false,
  };
  updateInputs();
  try {
    useMessages(await getMessages());
  } catch {
    localRoot.replaceChildren(el("section", { class: "panel stack" },
      el("p", { class: "error", role: "alert" }, "Spelet kunde inte laddas. Anslut och försök igen."),
      button("Försök igen", () => location.reload())));
    return;
  }
  wireControls();
  showCurrentPage();
}

boot();
