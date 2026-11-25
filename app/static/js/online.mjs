import { DEFAULT_SETTINGS, mountSettings } from "./settings.mjs";

const VENDOR_URL = "/static/vendor/socket.io.min.js";
const SESSION_ROOM = "imposter:online:room";
const SESSION_TOKEN = "imposter:online:token:";
const CODE = /^[A-Z0-9]{5}$/;
const ACK_MS = 5000;
const errorAliases = {
  bad_payload: "invalid_payload",
  bad_name: "invalid_name",
  bad_code: "invalid_code",
  server_full: "room_limit",
  already_bound: "already_in_room",
  not_host: "host_only",
  not_playing: "no_round",
  wrong_phase: "invalid_phase",
  paused: "round_paused",
  wrong_round: "round_changed",
  players_not_ready: "not_ready",
  players_offline: "players_disconnected",
  bad_text: "invalid_text",
  chat_rate: "rate_limited",
  invalid_action: "not_allowed",
  request_conflict: "not_allowed",
  waiting: "not_allowed",
};

let socket, socketLoad, context, redraw, identity, state, pendingState;
let bound = false;
let sessionChecked = false;
let storageUnavailable = false;
let suspended = false;
let status = "";
let starting = false;
let busy = false;
let problem = null;
let serverClock = { server: 0, local: 0 };
const savedResults = new Set();

function sessionIdentity(code) {
  try {
    const storedCode = code || sessionStorage.getItem(SESSION_ROOM);
    if (!CODE.test(storedCode ?? "")) return null;
    const token = sessionStorage.getItem(SESSION_TOKEN + storedCode);
    return token ? { code: storedCode, token } : null;
  } catch {
    return null;
  }
}

function writeIdentity(previousCode) {
  try {
    if (previousCode) sessionStorage.removeItem(SESSION_TOKEN + previousCode);
    if (identity) {
      sessionStorage.setItem(SESSION_TOKEN + identity.code, identity.token);
      sessionStorage.setItem(SESSION_ROOM, identity.code);
    } else if (sessionStorage.getItem(SESSION_ROOM) === previousCode) {
      sessionStorage.removeItem(SESSION_ROOM);
    }
  } catch {
    storageUnavailable = Boolean(identity);
  }
}

function clearRoom(reason) {
  const previousCode = identity?.code;
  identity = state = pendingState = null;
  bound = false;
  suspended = false;
  status = reason;
  writeIdentity(previousCode);
  context?.setRoundActive(false);
  redraw?.();
}

function loadSocketClient() {
  if (typeof globalThis.io === "function") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = VENDOR_URL;
    script.onload = () => typeof globalThis.io === "function" ? resolve() : reject(new Error(VENDOR_URL));
    script.onerror = () => {
      script.remove();
      reject(new Error(VENDOR_URL));
    };
    document.head.append(script);
  });
}

function receiveState(next) {
  if (!bound) {
    if (starting) pendingState = next;
    return;
  }
  if (next.code !== identity?.code || next.playerId !== identity?.playerId) return;
  if (state?.revision > next.revision) return;
  const previous = state;
  state = next;
  serverClock = { server: next.serverNow, local: performance.now() };
  context?.setRoundActive(next.stage === "playing");
  const revealed = next.round?.result;
  if (revealed && !savedResults.has(revealed.id)) {
    context?.saveResult({ ...revealed, players: next.round.players }, "online");
    savedResults.add(revealed.id);
  }
  if (previous?.round?.id === next.round?.id && previous?.round?.phase !== next.round?.phase) {
    context?.feedback(next.stage === "result" ? "finish" : "advance");
  }
  redraw?.();
}

function getSocket() {
  if (socket) return Promise.resolve(socket);
  socketLoad ??= loadSocketClient().then(() => {
    socket = globalThis.io({ autoConnect: false });
    socket.on("room:state", receiveState);
    socket.on("room:replaced", ({ code }) => {
      if (code !== identity?.code) return;
      bound = false;
      suspended = true;
      status = "replaced";
      redraw?.();
    });
    socket.on("room:expired", ({ code }) => {
      if (code === identity?.code) clearRoom("retired");
    });
    socket.on("disconnect", () => {
      bound = false;
      if (!suspended) status = identity ? "reconnect" : "";
      redraw?.();
    });
    socket.on("connect_error", () => {
      status = identity ? "reconnect" : "";
      redraw?.();
    });
    socket.on("connect", () => {
      if (identity && !suspended) void restore();
    });
    return socket;
  }).catch((error) => {
    socketLoad = undefined;
    throw error;
  });
  return socketLoad;
}

async function connect() {
  const client = await getSocket();
  if (client.connected) return client;
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      client.off("connect", success);
      client.off("connect_error", fail);
    };
    const success = () => {
      cancel();
      resolve(client);
    };
    const fail = () => {
      cancel();
      reject(new Error("connection"));
    };
    const timer = setTimeout(fail, ACK_MS);
    client.once("connect", success);
    client.once("connect_error", fail);
    client.connect();
  });
}

function send(event, payload) {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, error: { code: "connection" } });
      return;
    }
    socket.timeout(ACK_MS).emit(event, payload, (error, reply) => {
      resolve(error ? { ok: false, error: { code: "timeout" } } : reply);
    });
  });
}

async function bind(event, data) {
  if (starting) return;
  starting = true;
  pendingState = null;
  problem = null;
  status = event === "room:reconnect" ? "reconnect" : "connect";
  redraw?.();
  try {
    await connect();
    const reply = await send(event, data);
    if (reply?.ok) {
      identity = { code: reply.code, token: reply.token, playerId: reply.playerId };
      bound = Boolean(socket.connected);
      suspended = false;
      status = bound ? "" : "reconnect";
      writeIdentity();
      if (pendingState) receiveState(pendingState);
    } else if (event === "room:reconnect" && ["room_not_found", "invalid_token"].includes(reply?.error?.code)) {
      clearRoom(reply.error.code === "room_not_found" ? "retired" : "");
      if (reply.error.code === "invalid_token") problem = reply.error;
    } else {
      problem = reply?.error ?? { code: "unknown" };
      status = identity ? "reconnect" : "";
    }
  } catch {
    problem = { code: "connection" };
    status = identity ? "reconnect" : "";
  } finally {
    pendingState = null;
    starting = false;
    redraw?.();
  }
}

function restore() {
  if (!identity || bound) return;
  suspended = false;
  return bind("room:reconnect", { code: identity.code, token: identity.token });
}

function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function command(event, data = {}, forRound = false) {
  if (!bound || busy) return false;
  busy = true;
  problem = null;
  redraw?.();
  const message = forRound ? { roundId: state.round?.id ?? null, requestId: requestId(), ...data } : data;
  try {
    let reply = await send(event, message);
    if (reply?.error?.code === "timeout" && forRound && bound) reply = await send(event, message);
    if (reply?.ok) return true;
    if (reply?.error?.code === "not_in_room" && identity) {
      bound = false;
      void restore();
    }
    problem = reply?.error ?? { code: "unknown" };
    return false;
  } finally {
    busy = false;
    redraw?.();
  }
}

export function mountOnline(ctx) {
  const { root, el, button } = ctx;
  const t = (key, values) => ctx.t("online." + key, values);
  const invitedCode = String(ctx.joinCode ?? "").toUpperCase();
  let name = ctx.preferences().rememberNames ? ctx.storage.get("onlineName", "") : "";
  let codeDraft = CODE.test(invitedCode) ? invitedCode : "";
  let roleShown = false;
  let roleKey = "";
  let renderedPhase = "";
  let showSettings = false;
  let settingsMount, settingsDraft, packageChoice;
  let timer;
  const drafts = {};
  const openDetails = new Set();

  context = ctx;
  const action = (actionName, data) => command("room:action", { action: actionName, data: data ?? {} }, true);
  const chooseButton = (text, handler, options = {}) => button(t(text), handler, options);
  const control = (text, handler, options = {}) => chooseButton(text, handler, { disabled: busy || !bound, ...options });
  const statusLine = (text, className = "notice", values) => text ? el("p", { class: className, role: className === "error" ? "alert" : "status" }, t(text, values)) : null;
  const playerName = (id, roster) => roster?.find((player) => player.id === id)?.name ?? id;
  const selectName = (id, roster) => id === "@all" ? t("all") : id === "@none" ? t("none") : playerName(id, roster);
  const roundName = (id) => playerName(id, state?.round?.players);

  function details(id, title, ...children) {
    return el("details", {
      open: openDetails.has(id),
      onToggle: (event) => {
        if (event.currentTarget.open) openDetails.add(id);
        else openDetails.delete(id);
      },
    }, el("summary", {}, t(title)), ...children);
  }

  function issueList(issues) {
    if (!issues?.length) return null;
    return el("ul", { class: "error" }, ...issues.map(({ code, mode }) => el("li", {},
      mode ? ctx.modeName(mode) + " · " : "", t("issues." + code))));
  }

  function complaint() {
    if (!problem) return null;
    const key = "errors." + (errorAliases[problem.code] ?? problem.code);
    const message = t(key);
    return el("div", {}, el("p", { class: "error", role: "alert" }, message === "online." + key ? t("errors.unknown") : message),
      issueList(problem.issues));
  }

  function field(key, value, update, attributes = {}) {
    return el("label", { class: "field" }, el("span", {}, t(key)), el("input", {
      value, "data-online-focus": key, onInput: (event) => update(event.currentTarget.value), ...attributes,
    }));
  }

  function section(title, ...children) {
    return el("section", { class: "panel stack" }, el("h2", {}, t(title)), ...children);
  }

  function enter() {
    const direct = CODE.test(invitedCode);
    const nameField = () => field("name", name, (value) => { name = value; }, { required: true, maxlength: "32", autocomplete: "nickname" });
    const submit = (event, join) => {
      event.preventDefault();
      const cleanName = name.trim();
      if (ctx.preferences().rememberNames) ctx.storage.set("onlineName", cleanName);
      else ctx.storage.remove("onlineName");
      if (join) {
        void bind("room:join", { code: codeDraft.trim().toUpperCase(), name: cleanName });
      } else {
        void bind("room:create", { name: cleanName, settings: { ...DEFAULT_SETTINGS, language: ctx.lang } });
      }
    };
    return el("div", { class: "stack" },
      el("p", { class: "muted" }, t("intro")),
      el("form", { class: "panel stack", onSubmit: (event) => submit(event, true) },
        el("h2", {}, direct ? t("joinTitle", { code: invitedCode }) : t("join")),
        nameField(),
        field("roomCode", codeDraft, (value) => { codeDraft = value; }, { required: true, maxlength: "5", minlength: "5", autocapitalize: "characters", spellcheck: "false" }),
        button(t("join"), null, { type: "submit", disabled: starting })),
      el("form", { class: "panel stack", onSubmit: (event) => submit(event, false) },
        el("h2", {}, t("create")), nameField(), button(t("create"), null, { type: "submit", disabled: starting })));
  }

  function invite() {
    const code = state.code;
    const url = new URL("/join/" + code, window.location.origin).href;
    const link = el("input", { value: url, readonly: true, onFocus: (event) => event.currentTarget.select() });
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(url);
        ctx.notify(t("copied"));
      } catch {
        link.focus();
        link.select();
        ctx.notify(t("copyManual"));
      }
    };
    return section("share",
      el("p", {}, t("roomCode"), " ", el("strong", {}, code)),
      el("label", { class: "field" }, el("span", {}, t("link")), link),
      chooseButton("copy", copy, { variant: "secondary" }),
      details("qr", "showQr", el("img", { src: "/api/qr/" + code + ".svg", width: 180, height: 180, loading: "lazy", alt: t("qr", { code }) })));
  }

  function roster() {
    return section("players", el("ul", { class: "stack" }, ...state.players.map((player) => {
      const badges = [
        player.id === state.playerId && "you",
        player.id === state.hostId && "host",
        !player.connected ? "offline" : player.waiting ? "waiting" : player.ready ? "ready" : "notReady",
      ].filter(Boolean);
      return el("li", { class: "cluster" }, el("strong", {}, player.name), ...badges.map((key) => el("span", { class: "pill" }, t(key))));
    })));
  }

  function showRules() {
    const target = el("div", { class: "stack" });
    void ctx.rulesView(target, { mode: state.settings.mode, profiles: state.settings.chaos });
    return details("rules", "rules", target);
  }

  function settingsPanel(connectedCount) {
    const root = el("div", { class: "stack" });
    const pack = ctx.storage.get("customPack", null);
    const serverCategories = state.customCategories ?? [];
    const localCategories = pack?.categories ?? [];
    const packageOptions = [["keep", t("customPackKeep")], ["none", t("customPackNone")]];
    if (localCategories.length) packageOptions.push(["local", t("customPackLocal")]);
    const categoryFilters = el("div", { class: "stack" });
    const note = el("p", { class: "muted" }, t("customPackHelp"));
    const selection = () => packageChoice === "local" ? localCategories : packageChoice === "none" ? [] : serverCategories;
    const replaceCategories = () => {
      categoryFilters.replaceChildren();
      for (const category of selection()) {
        const choose = (key, entry) => el("label", { class: "cluster" }, el("input", {
          type: "checkbox",
          checked: (settingsDraft[key] ?? []).includes(entry.id),
          onChange: (event) => {
            const chosen = new Set(settingsDraft[key] ?? []);
            if (event.currentTarget.checked) chosen.add(entry.id);
            else chosen.delete(entry.id);
            settingsDraft = { ...settingsDraft, [key]: [...chosen] };
          },
        }), entry.names?.[ctx.lang] ?? entry.id);
        categoryFilters.append(el("div", { class: "stack" }, choose("categories", category),
          ...(category.subcategories ?? []).map((subcategory) => choose("subcategories", subcategory))));
      }
    };
    const packageSelect = el("select", {
      onChange: (event) => {
        packageChoice = event.currentTarget.value;
        const allowed = new Set(selection().flatMap((category) => [category.id, ...(category.subcategories ?? []).map((entry) => entry.id)]));
        const customIds = new Set([...serverCategories, ...localCategories].flatMap((category) => [category.id, ...(category.subcategories ?? []).map((entry) => entry.id)]));
        for (const key of ["categories", "subcategories"]) {
          settingsDraft[key] = (settingsDraft[key] ?? []).filter((id) => !customIds.has(id) || allowed.has(id));
        }
        replaceCategories();
      },
    }, ...packageOptions.map(([value, label]) => el("option", { value, selected: value === packageChoice }, label)));
    const availableCustom = new Set([...localCategories, ...serverCategories].flatMap((category) => [category.id, ...(category.subcategories ?? []).map((subcategory) => subcategory.id)]));
    settingsMount = mountSettings(ctx, {
      root,
      settings: settingsDraft,
      playerCount: connectedCount,
      onChange: (next) => {
        const merged = { ...next };
        for (const key of ["categories", "subcategories"]) {
          const filtered = (next[key] ?? []).filter((id) => !availableCustom.has(id));
          merged[key] = [...new Set([...filtered, ...(settingsDraft[key] ?? []).filter((id) => availableCustom.has(id))])];
        }
        settingsDraft = merged;
      },
      includeClueStyle: true,
    });
    replaceCategories();
    const save = async () => {
      const payload = { settings: { ...settingsDraft } };
      if (packageChoice === "local") payload.custom = pack;
      if (packageChoice === "none") payload.custom = null;
      if (await command("room:settings", payload)) {
        showSettings = false;
        ctx.notify(t("savedSettings"));
        render();
      }
    };
    return section("settings", root, el("label", { class: "field" }, el("span", {}, t("customPack")), packageSelect),
      note, categoryFilters, control("saveSettings", save));
  }

  function preparation(replaying = false) {
    const isHost = state.playerId === state.hostId;
    const connected = state.players.filter((player) => player.connected);
    const me = connected.find((player) => player.id === state.playerId);
    const enoughPlayers = connected.length >= 3;
    const everyoneReady = connected.every((player) => player.id === state.hostId || player.ready);
    const toggleSettings = () => {
      showSettings = !showSettings;
      settingsDraft = { ...state.settings };
      packageChoice = "keep";
      render();
    };
    return el("div", { class: "stack" }, state.aborted ? statusLine("aborted") : null,
      invite(), roster(),
      section("settings", el("p", {}, ctx.modeName(state.settings.mode)),
        el("div", { class: "cluster" },
          el("span", { class: "pill" }, t("numWords", { count: state.selection.words })),
          el("span", { class: "pill" }, t("numPairs", { count: state.selection.pairs }))),
        showRules(), issueList(state.issues),
        isHost ? control("changeSettings", toggleSettings, { variant: "secondary", "aria-expanded": showSettings ? "true" : "false" }) : null),
      isHost && showSettings ? settingsPanel(connected.length) : null,
      isHost
        ? el("div", { class: "stack" },
          !enoughPlayers ? statusLine("needPlayers", "muted") : null,
          enoughPlayers && !everyoneReady ? statusLine("needReady", "muted") : null,
          control(replaying ? "next" : "start", () => command("room:start", {}, true), {
            disabled: busy || !bound || showSettings || !enoughPlayers || !everyoneReady || Boolean(state.issues?.length),
          }))
        : control(me?.ready ? "markNotReady" : "markReady", () => command("room:ready", { ready: !me?.ready })),
      !replaying && state.scores?.length ? scoreboard() : null);
  }

  function roleCard() {
    const card = state.private?.card;
    if (!card || !bound) return null;
    const show = () => {
      roleShown = true;
      ctx.feedback("reveal");
      render();
    };
    if (!roleShown) return control("showRole", show, { variant: "secondary" });
    return el("section", { class: "panel hand-off stack" },
      el("h2", {}, t("role")),
      card.role ? el("p", {}, ctx.roleName(card.role)) : null,
      card.word ? el("p", { class: "stack" }, t("word"), el("strong", {}, card.word)) : null,
      card.hint ? el("p", { class: "stack" }, t("hint"), el("strong", {}, card.hint)) : null,
      !card.word && !card.hint ? el("p", {}, t("noHint")) : null,
      card.partners?.length ? el("p", {}, t("allies"), " · ", card.partners.map(roundName).join(", ")) : null,
      control("hideRole", () => { roleShown = false; render(); }, { variant: "secondary" }));
  }

  function roles() {
    if (state.private?.roleReady) return statusLine("roleWaiting");
    return el("div", { class: "stack" }, roleCard(),
      roleShown ? control("roleReady", () => {
        roleShown = false;
        return action("ack_role");
      }) : null);
  }

  function turnOrder() {
    return details("order", "turnOrder", el("ol", {}, ...state.round.order.map((id) => el("li", {}, roundName(id)))));
  }

  function clueList() {
    const clues = state.round.clues;
    return clues.length ? section("clues", el("ol", { class: "stack" }, ...clues.map((entry) =>
      el("li", {}, el("strong", {}, roundName(entry.playerId)), " · ", entry.text)))) : null;
  }

  function textForm(key, submitLabel, length, sendText) {
    const onSubmit = async (event) => {
      event.preventDefault();
      const text = (drafts[key] ?? "").trim();
      if (text && await sendText(text)) {
        delete drafts[key];
        render();
      }
    };
    return el("form", { class: "stack", onSubmit },
      field(key, drafts[key] ?? "", (text) => { drafts[key] = text; }, { required: true, maxlength: length, autocomplete: "off", disabled: busy || !bound }),
      button(t(submitLabel), null, { type: "submit", disabled: busy || !bound }));
  }

  function clues() {
    const round = state.round;
    const activePlayer = state.playerId === round.currentPlayerId;
    return el("div", { class: "stack" },
      el("p", { class: "muted" }, t("clueRound", { round: round.clueRound, total: round.clueRounds })),
      statusLine(activePlayer ? "yourTurn" : "turn", "notice", { name: roundName(round.currentPlayerId) }),
      activePlayer
        ? round.clueStyle === "text"
          ? textForm("clueInput", "sendClue", 120, (text) => action("clue", { text }))
          : el("div", { class: "stack" }, statusLine("oralClue", "muted"), control("finishTurn", () => action("clue")))
        : null,
      turnOrder(), clueList(), roleCard());
  }

  function choiceForm(key, heading, options, submitLabel, sendChoice) {
    const onSubmit = (event) => {
      event.preventDefault();
      if (drafts[key] !== undefined) void sendChoice(drafts[key]);
    };
    return el("form", { class: "stack", onSubmit }, el("fieldset", { class: "stack", disabled: busy || !bound },
      el("legend", {}, t(heading)), ...options.map(([value, label]) => el("label", { class: "cluster" },
        el("input", {
          type: "radio", name: key, value, required: true, checked: drafts[key] === value,
          "data-online-focus": key + "-" + value, onChange: () => { drafts[key] = value; },
        }), label)),
      button(t(submitLabel), null, { type: "submit", disabled: busy || !bound })));
  }

  function investigation() {
    const investigation = state.private?.investigation;
    if (!investigation) return null;
    return statusLine(investigation.impostorTeam ? "checkImposterTeam" : "checkOtherTeam", "notice", { name: roundName(investigation.playerId) });
  }

  function abilities() {
    const own = state.private;
    if (!own || own.abilityReady) return el("div", { class: "stack" }, investigation(), statusLine("abilityWait"));
    if (!own.ability) return el("div", { class: "stack" }, statusLine("abilityNeutral", "muted"),
      control("confirm", () => action("ability", { targetId: null })));
    const options = state.round.players.filter((player) => player.id !== state.playerId).map(({ id, name }) => [id, name]);
    options.push(["pass", t("passAbility")]);
    return choiceForm("ability", own.ability === "detective" ? "abilityDetective" : "abilityGuardian",
      options, "confirm", (targetId) => action("ability", { targetId: targetId === "pass" ? null : targetId }));
  }

  function timeLabel() {
    const round = state?.round;
    if (!round || (round.remainingMs === null && round.deadline === null)) return t("unlimited");
    const now = serverClock.server + performance.now() - serverClock.local;
    const seconds = Math.max(0, Math.ceil((round.paused ? round.remainingMs : round.deadline - now) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function phaseTimer() {
    return el("p", { class: "cluster" }, t("timer"), " ", el("strong", { role: "timer", "data-online-timer": "" }, timeLabel()));
  }

  function discussion() {
    const isText = state.round.clueStyle === "text";
    return el("div", { class: "stack" }, phaseTimer(),
      statusLine(isText ? "discussionText" : "discussionOral", "muted"), investigation(), clueList(),
      isText ? section("chat", state.chat.length
        ? el("ol", { class: "stack" }, ...state.chat.map(({ name, text }) => el("li", {}, el("strong", {}, name), " · ", text))) : null,
      textForm("message", "send", 280, (text) => command("room:chat", { text }, true))) : null,
      state.playerId === state.hostId ? control("startVoting", () => action("end_discussion")) : null,
      roleCard());
  }

  function voting() {
    return el("div", { class: "stack" },
      statusLine("votesIn", "notice", { count: state.round.completed, total: state.round.players.length }),
      investigation(), state.private?.voted
        ? statusLine("voteSent")
        : choiceForm("vote", "votePrompt", state.round.options.filter((id) => id !== state.playerId).map((id) => [id, selectName(id, state.round.players)]),
          "confirmVote", (targetId) => action("vote", { targetId })),
      clueList());
  }

  function lastGuess() {
    return el("div", { class: "stack" }, phaseTimer(),
      statusLine(state.private?.canGuess ? "guessPrompt" : "guessWaiting", "muted"),
      state.private?.canGuess ? textForm("guessInput", "sendGuess", 100, (text) => action("guess", { text })) : null,
      state.private?.canGuess ? control("passAbility", () => action("guess", { text: null }), { variant: "secondary" }) : null);
  }

  function roundView() {
    const stageViews = { roles, clues, abilities, discussion, voting, last_guess: lastGuess };
    const round = state.round;
    const waiting = !state.private;
    const isHost = state.playerId === state.hostId;
    const canResume = state.pauseReason !== "connection" || round.players.every(({ id }) =>
      state.players.some((player) => player.id === id && player.connected));
    const controls = isHost ? el("div", { class: "cluster" },
      round.paused
        ? control("resume", () => command("room:resume", {}, true), { disabled: busy || !bound || !canResume, variant: "secondary" })
        : control("pause", () => command("room:pause", {}, true), { variant: "secondary" }),
      control("abort", () => {
        if (window.confirm(t("abortConfirm"))) void command("room:abort", {}, true);
      }, { variant: "danger" })) : null;
    if (waiting) return el("div", { class: "stack" }, section("waitingTitle", statusLine("waitingText", "muted")), roster(), controls);
    if (round.paused) return el("div", { class: "stack" },
      section("paused", statusLine(state.pauseReason === "connection" && !canResume ? "pausedNetwork" : "pausedHost"),
        round.deadline !== null || round.remainingMs !== null ? phaseTimer() : null), roster(), controls);
    return el("div", { class: "stack" }, stageViews[round.phase]?.(), controls, roster());
  }

  function resultView(result, players) {
    const name = (id) => selectName(id, players);
    const category = state.customCategories?.find(({ id }) => id === result.category);
    const categoryName = category?.names?.[ctx.lang] ?? ctx.t("category." + result.category);
    const fields = [
      ["mode", ctx.modeName(result.mode)], ["secretWord", result.word],
      ...(result.pairedWord ? [["otherWord", result.pairedWord]] : []),
      ...(categoryName !== "category." + result.category ? [["category", categoryName]] : []),
    ];
    return el("div", { class: "stack" },
      el("dl", {}, ...fields.flatMap(([key, value]) => [el("dt", {}, t(key)), el("dd", {}, value)])),
      el("p", {}, result.winners.length ? t("winner") + " · " + result.winners.map(name).join(", ") : t("noWinner")),
      el("p", {}, t("reasons." + result.reason)),
      result.voteWinner === null ? statusLine("tie", "muted") : statusLine("voteWinner", "muted", { name: name(result.voteWinner) }),
      result.protected ? statusLine("protected", "muted", { name: name(result.protected) }) : null,
      result.reused ? statusLine("reused", "muted") : null,
      result.guess?.text ? statusLine("guessed", "muted", { name: name(result.guess.playerId), text: result.guess.text }) : null,
      el("h3", {}, t("roles")),
      el("ul", {}, ...Object.entries(result.roles).map(([id, role]) => el("li", {}, name(id), " · ", ctx.roleName(role), " · ", t("scoreGain", { points: result.points[id] ?? 0 })))),
      el("h3", {}, t("votes")),
      el("ul", {}, ...Object.entries(result.votes).map(([id, target]) => el("li", {}, t("votedFor", { name: name(id), target: name(target) })))));
  }

  function scoreboard() {
    const scores = [...state.scores].sort((left, right) => right.points - left.points || right.wins - left.wins || left.name.localeCompare(right.name, ctx.lang));
    const stats = (data, label) => Object.keys(data ?? {}).length
      ? el("ul", {}, ...Object.entries(data).map(([id, entry]) => el("li", {}, label(id), " · ", t("winRatio", { wins: entry.wins, played: entry.played }))))
      : null;
    return section("scoreboard", el("ol", { class: "stack" }, ...scores.map((score) => el("li", {},
      el("strong", {}, score.name), " · ", t("score", { points: score.points, wins: score.wins, played: score.played }),
      score.played ? details("score-" + score.id, "stats",
        el("p", {}, t("imposterStats", {
          percent: score.imposterGames ? Math.round(score.imposterWins * 100 / score.imposterGames) : 0,
          wins: score.imposterWins, played: score.imposterGames,
        })), stats(score.byRole, ctx.roleName), stats(score.byMode, ctx.modeName)) : null))));
  }

  function roomHistory() {
    const history = state.history.filter((result) => result.id !== state.round?.result?.id);
    return history.length ? section("history", ...history.slice().reverse().map((result) =>
      el("details", {}, el("summary", {}, result.word, " · ", ctx.modeName(result.mode)), resultView(result, result.players ?? state.players)))) : null;
  }

  function houseControls() {
    if (state.playerId !== state.hostId || state.stage === "playing") return null;
    return el("div", { class: "cluster" }, control("resetScores", () => {
      if (window.confirm(t("resetConfirm"))) void command("room:reset_scores");
    }, { variant: "secondary" }), control("clearHistory", () => {
      if (window.confirm(t("clearConfirm"))) void command("room:clear_history");
    }, { variant: "secondary" }));
  }

  function view() {
    if (!bound || !state) {
      if (identity) return el("div", { class: "stack" }, statusLine(status || "reconnect"),
        chooseButton("retry", restore, { variant: "secondary", disabled: starting }),
        chooseButton("leave", () => clearRoom(""), { variant: "ghost", disabled: starting }));
      return enter();
    }
    const leave = async () => {
      if (!window.confirm(t("leaveConfirm", { code: state.code }))) return;
      if (await command("room:leave")) clearRoom("");
    };
    const content = state.stage === "lobby" ? preparation()
      : state.stage === "playing" ? roundView()
      : el("div", { class: "stack" }, section("result", resultView(state.round.result, state.round.players)),
        scoreboard(), preparation(true));
    return el("div", { class: "stack" },
      invitedCode && invitedCode !== state.code ? statusLine("otherRoom", "notice", { code: state.code }) : null,
      content, state.stage !== "playing" ? roomHistory() : null, houseControls(), control("leave", leave, { variant: "ghost" }));
  }

  function render() {
    settingsMount?.destroy();
    settingsMount = null;
    const focus = document.activeElement;
    const focusKey = root.contains(focus) ? focus.dataset.onlineFocus : null;
    const selection = focusKey && focus.selectionStart != null ? [focus.selectionStart, focus.selectionEnd] : null;
    const phases = { roles: "role", clues: "clues", abilities: "ability", discussion: "discussion", voting: "vote", last_guess: "guess" };
    const phase = state?.stage === "playing" && state.private ? state.round.phase : state?.stage;
    const currentRoleKey = !bound || state?.round?.paused ? "" : (state?.round?.id ?? "") + ":" + (phase ?? "");
    if (roleKey !== currentRoleKey) {
      roleKey = currentRoleKey;
      roleShown = false;
      for (const key of Object.keys(drafts)) delete drafts[key];
    }
    if (renderedPhase !== phase && phase === "playing") showSettings = false;
    const headingKey = bound && state ? phases[phase] ?? (phase === "playing" ? "waitingTitle" : phase) : "title";
    const heading = el("h1", { tabindex: "-1" }, t(headingKey));
    root.replaceChildren(el("div", { class: "stack" }, el("header", { class: "page-header" }, heading),
      !identity && status ? statusLine(status) : null,
      storageUnavailable && identity ? statusLine("storageUnavailable") : null,
      complaint(), view()));
    if (focusKey) {
      const replacement = [...root.querySelectorAll("[data-online-focus]")].find((element) => element.dataset.onlineFocus === focusKey && !element.disabled);
      replacement?.focus({ preventScroll: true });
      if (selection && replacement?.setSelectionRange) replacement.setSelectionRange(...selection);
    } else if (phase && renderedPhase && renderedPhase !== phase && root.contains(document.activeElement)) {
      heading.focus();
    }
    renderedPhase = phase;
  }

  redraw = render;
  if ((!sessionChecked || invitedCode) && !identity && !starting) {
    sessionChecked = true;
    identity = sessionIdentity(invitedCode);
    if (identity) void restore();
  }
  ctx.setRoundActive(state?.stage === "playing");
  const hideCard = () => {
    if (roleShown) {
      roleShown = false;
      render();
    }
  };
  ctx.setNavigationGuard(() => { hideCard(); return true; });
  window.addEventListener("blur", hideCard);
  document.addEventListener("visibilitychange", hideCard);
  timer = window.setInterval(() => {
    const target = root.querySelector("[data-online-timer]");
    const label = timeLabel();
    if (target && target.textContent !== label) target.textContent = label;
  }, 250);
  render();
  return () => {
    if (redraw === render) redraw = null;
    window.clearInterval(timer);
    window.removeEventListener("blur", hideCard);
    document.removeEventListener("visibilitychange", hideCard);
    settingsMount?.destroy();
  };
}
