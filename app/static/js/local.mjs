import { createRound } from "./engine.mjs";
import { DEFAULT_SETTINGS, mountSettings } from "./settings.mjs";

const session = new Map();
const privatePhases = new Set(["roles", "abilities", "voting", "last_guess"]);
const maxPlayers = 20;
const maxNameLength = 32;

function playerId() {
    const parts = crypto.getRandomValues(new Uint32Array(4));
    return Array.from(parts, (part) => part.toString(16).padStart(8, "0")).join("");
}

function addUsedWords(used, result) {
    for (const id of [result.wordId, result.pairedWordId]) {
        if (!id) continue;
        const previous = used.indexOf(id);
        if (previous >= 0) used.splice(previous, 1);
        used.push(id);
    }
}

function secondsLeft(state) {
    if (state.paused) return state.remainingMs === null ? null : Math.ceil(state.remainingMs / 1000);
    return state.deadline === null ? null : Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
}

export function mountLocal(ctx) {
    const { root, el, t, button, signal, storage } = ctx;
    const history = ctx.readResults().filter((result) => result.source === "local").reverse();
    const completedIds = new Set(history.map((result) => result.id));
    const used = [];
    history.forEach((result) => addUsedWords(used, result));
    for (const result of session.values()) {
        if (!completedIds.has(result.id)) addUsedWords(used, result);
    }

    let players = ctx.preferences().rememberNames ? storage.get("localPlayers", []) : [];
    if (!Array.isArray(players)) players = [];
    players = players.filter((player) => typeof player?.id === "string" && typeof player?.name === "string").slice(0, maxPlayers);
    let settings = { ...DEFAULT_SETTINGS, ...storage.get("localSettings", {}), language: ctx.lang };
    let editor;
    let round;
    let roundSelection;
    let starting = false;
    let privateOpen = false;
    let report = null;
    let state;
    let stage;
    let timer;
    let message;
    let focusControl;
    let formingSetup = false;
    let startMessage;

    const test = (name) => ({ "data-testid": `local-${name}` });
    const paragraph = (text, style = "muted") => el("p", { class: style }, text);
    const label = (target) => {
        if (target === "@all") return t("local.group.all");
        if (target === "@none") return t("local.group.none");
        return state.players.find((player) => player.id === target)?.name ?? "";
    };
    function heading(title, description) {
        return el("header", { class: "page-header" }, el("h1", { tabindex: "-1" }, title),
            description ? paragraph(description) : "");
    }

    function setMessage(text) {
        if (message) message.textContent = text;
    }

    function savePlayers() {
        if (ctx.preferences().rememberNames) storage.set("localPlayers", players);
        else storage.remove("localPlayers");
    }

    function renderSetup(initialError = "") {
        editor?.destroy();
        editor = null;
        round = null;
        roundSelection = null;
        ctx.setRoundActive(false);
        root.dataset.localPhase = "setup";
        formingSetup = true;

        const playersList = el("ul", { class: "local-player-list stack" });
        const count = el("p", { class: "muted", "aria-live": "polite" });
        const nameInput = el("input", {
            id: "local-name",
            type: "text",
            maxlength: maxNameLength,
            autocomplete: "off",
            required: true,
            placeholder: t("local.players.placeholder"),
            ...test("player-name"),
        });
        const add = button(t("local.players.add"), null, { type: "submit", ...test("add-player") });
        const clear = button(t("local.players.clear"), () => {
            players = [];
            savePlayers();
            updatePlayers();
            nameInput.focus();
        }, { variant: "ghost" });
        const rosterError = el("p", { class: "error", "aria-live": "polite" });
        const roster = el("form", { class: "stack", onSubmit: (event) => {
            event.preventDefault();
            const name = nameInput.value.trim().replace(/\s+/gu, " ");
            if (!name || players.length >= maxPlayers) return;
            if (players.some((player) => player.name.localeCompare(name, ctx.lang, { sensitivity: "accent" }) === 0)) {
                rosterError.textContent = t("local.players.duplicate");
                return;
            }
            players = [...players, { id: playerId(), name }];
            nameInput.value = "";
            savePlayers();
            updatePlayers();
            nameInput.focus();
        } }, el("label", { for: "local-name" }, t("local.players.name")),
        el("div", { class: "cluster local-name-entry" }, nameInput, add), rosterError);

        function updatePlayers() {
            playersList.replaceChildren(...players.map((player) => el("li", { class: "split local-player-row" },
                el("span", {}, player.name),
                button(t("local.players.remove"), () => {
                    players = players.filter(({ id }) => id !== player.id);
                    savePlayers();
                    updatePlayers();
                    nameInput.focus();
                }, { variant: "ghost", "aria-label": t("local.players.removeNamed", { name: player.name }) }))));
            count.textContent = t("local.players.count", { count: players.length });
            clear.hidden = players.length === 0;
            add.disabled = players.length >= maxPlayers;
            nameInput.disabled = add.disabled;
            rosterError.textContent = "";
            editor?.setPlayerCount(players.length);
            adjustStart();
        }

        const configRoot = el("div", { class: "stack" });
        const rules = el("details", { class: "panel panel--subtle" });
        const rulesBody = el("div", { class: "stack" });
        rules.append(el("summary", {}, t("local.setup.rules")), rulesBody);
        const start = button(t("local.setup.start"), () => {
            const selection = editor.getSelection();
            if (!canStart(selection)) return;
            beginRound(selection, setupError);
        }, test("start"));
        const setupError = el("p", { class: "error", "aria-live": "polite" }, initialError);
        startMessage = initialError;
        const startHelp = el("p", { id: "local-start-help", class: "muted", "aria-live": "polite" });
        start.setAttribute("aria-describedby", startHelp.id);

        function canStart(selection) {
            return players.length >= 3 && !starting && selection && !selection.loading && !selection.error &&
                !selection.issues.length && selection.words.length > 0;
        }

        function adjustStart(selection = editor?.getSelection()) {
            start.disabled = !canStart(selection);
            if (players.length < 3) startHelp.textContent = t("local.players.minimum");
            else if (selection?.loading || !selection || starting) startHelp.textContent = t("local.setup.loading");
            else if (selection.error || selection.issues.length || !selection.words.length) startHelp.textContent = t("local.setup.fix");
            else startHelp.textContent = "";
        }

        function showRules() {
            if (rules.open) ctx.rulesView(rulesBody, { mode: settings.mode, profiles: settings.chaos });
        }
        rules.addEventListener("toggle", showRules);
        root.replaceChildren(heading(t("local.setup.title"), t("local.setup.intro")),
            el("section", { class: "panel stack", "aria-labelledby": "local-players-title" },
                el("h2", { id: "local-players-title" }, t("local.players.title")),
                count, roster, playersList, clear), configRoot, rules,
            el("div", { class: "stack local-start-actions" }, setupError, startHelp, start));

        updatePlayers();
        editor = mountSettings(ctx, {
            root: configRoot,
            settings,
            playerCount: players.length,
            onChange: (value) => {
                settings = { ...value, clueStyle: "oral", language: ctx.lang };
                storage.set("localSettings", settings);
                if (startMessage) {
                    startMessage = "";
                    setupError.textContent = "";
                }
                showRules();
            },
            onSelection: adjustStart,
            includeClueStyle: false,
        });
        adjustStart();
        formingSetup = false;
    }

    async function beginRound(selection, sourceError) {
        if (starting) return;
        const selected = { ...settings, clueStyle: "oral", language: ctx.lang };
        const roster = players;
        starting = true;
        sourceError.textContent = t("local.setup.loading");
        try {
            const rules = await ctx.rules();
            if (signal.aborted) return;
            round = createRound(roster, selected, selection.words, selection.pairs, rules, { used });
            roundSelection = selection;
            players = roster;
            settings = selected;
            storage.set("localSettings", selected);
            savePlayers();
            editor?.destroy();
            editor = null;
            privateOpen = false;
            report = null;
            ctx.setRoundActive(true);
            renderRound();
        } catch {
            if (!signal.aborted) {
                startMessage = t("local.error.start");
                sourceError.textContent = startMessage;
            }
        } finally {
            starting = false;
        }
    }

    function focusStage() {
        if (!document.hidden && document.hasFocus()) focusControl?.focus({ preventScroll: true });
    }

    function renderRound({ focus = true } = {}) {
        state = round.publicState();
        root.dataset.localPhase = report ? "abilities" : state.phase;
        timer = null;
        const activePhase = report ? "abilities" : state.phase;
        message = el("p", { class: "error", "aria-live": "polite" });
        stage = el("section", { class: "stack local-stage" });
        focusControl = null;
        if (privatePhases.has(activePhase)) renderPrivate(activePhase);
        else if (activePhase === "clues") renderClues();
        else if (activePhase === "discussion") renderDiscussion();
        else if (activePhase === "reveal") renderResult(state.result);
        else renderAborted();

        stage.append(message);
        if (activePhase !== "reveal" && activePhase !== "aborted") {
            stage.append(button(t("local.round.abort"), abortRound, { variant: "ghost", class: "local-abort" }));
        }
        root.replaceChildren(stage);
        focusControl ??= stage.querySelector("h1");
        updateTimer();
        if (focus) focusStage();
    }

    function currentPrivatePlayer(phase) {
        if (report) return report.id;
        if (phase === "last_guess") {
            return state.players.find(({ id }) => round.privateState(id).canGuess)?.id;
        }
        return state.players[state.completed]?.id;
    }

    function renderPrivate(phase) {
        const id = currentPrivatePlayer(phase);
        const content = el("div", { class: "hand-off panel stack", ...test("handoff") });
        const named = t("local.private.pass", { name: label(id) });
        if (phase === "last_guess") timer = el("p", { class: "local-countdown" });
        const completed = report?.completed ?? state.completed;
        const step = phase === "last_guess"
            ? paragraph(t("local.phase.last_guess"), "local-phase-label")
            : paragraph(t("local.private.step", { step: completed + 1, count: state.players.length }), "local-phase-label");
        const concealed = () => {
            const show = button(t("local.private.show"), () => {
                if (document.hidden || !document.hasFocus()) return;
                privateOpen = true;
                renderRound();
                ctx.feedback("reveal");
            }, test("show-private"));
            content.append(paragraph(t("local.private.ready")), show);
            focusControl = show;
        };

        content.append(step, el("h1", { tabindex: "-1" }, named));
        if (timer) content.append(timer);
        if (!privateOpen || !id) concealed();
        else {
            const secret = el("div", { class: "local-private-content stack", ...test("private-content") });
            const data = round.privateState(id);
            if (phase === "roles") renderCard(secret, id, data.card);
            else if (phase === "abilities") renderAbility(secret, id, data);
            else if (phase === "voting") renderVote(secret, id);
            else renderGuess(secret, id);
            content.append(secret);
            focusControl = secret.querySelector("h2");
        }
        stage.append(content);
    }

    function secretHeading(text) {
        return el("h2", { tabindex: "-1" }, text);
    }

    function renderCard(secret, id, card) {
        const shownRole = card.role ? ctx.roleName(card.role) : t("local.card.word");
        const value = card.word ?? card.hint ?? t("local.card.empty");
        const field = card.word ? "word" : card.hint ? "hint" : "note";
        secret.append(secretHeading(shownRole),
            el("dl", { class: "local-card-data" },
                el("dt", {}, t(`local.card.${field}`)), el("dd", { class: "local-card-value" }, value),
                card.partners.length
                    ? el("div", {}, el("dt", {}, t("local.card.partners")),
                        el("dd", {}, card.partners.map(label).join(", ")))
                    : ""),
            button(t("local.card.hide"), () => submit(id, "ack_role"), test("hide-card")));
    }

    function privateChoice(secret, id, { formId, title, description, targets, submitLabel, action, allowSkip }) {
        const inputName = `local-${formId}-target`;
        const lock = button(submitLabel, null, { type: "submit", disabled: true, ...test(`lock-${formId}`) });
        const fieldset = el("fieldset", { class: "local-choice-list stack" },
            el("legend", { class: "sr-only" }, title));
        const options = targets.filter((target) => target !== id);
        for (const target of options) {
            fieldset.append(el("label", { class: "local-choice" },
                el("input", { type: "radio", name: inputName, value: target, required: true, ...test(`${formId}-target`) }),
                el("span", {}, label(target))));
        }
        const form = el("form", {
            class: "stack",
            onChange: () => { lock.disabled = !form.elements.namedItem(inputName)?.value; },
            onSubmit: (event) => {
                event.preventDefault();
                const target = new FormData(form).get(inputName);
                if (target) action(target);
            },
        }, fieldset, lock, allowSkip
            ? button(t("local.ability.skip"), () => action(null), { variant: "secondary" })
            : "");
        secret.append(secretHeading(title), paragraph(description), form);
    }

    function renderAbility(secret, id, data) {
        if (report) {
            const { investigation } = report;
            secret.append(secretHeading(t("local.ability.report")),
                paragraph(t(investigation.impostorTeam ? "local.ability.onTeam" : "local.ability.offTeam",
                    { name: label(investigation.playerId) })),
                button(t("local.ability.confirm"), closeReport));
            return;
        }
        if (!data.ability) {
            secret.append(secretHeading(t("local.ability.title")), paragraph(t("local.ability.neutral")),
                button(t("local.ability.confirm"), () => submit(id, "ability", { targetId: null })));
            return;
        }
        privateChoice(secret, id, {
            formId: "ability",
            title: ctx.roleName(data.ability),
            description: t(`local.ability.${data.ability}`),
            targets: state.players.map((player) => player.id),
            submitLabel: t("local.ability.use"),
            allowSkip: true,
            action: (targetId) => submit(id, "ability", { targetId },
                data.ability === "detective" && targetId ? state.completed : null),
        });
    }

    function renderVote(secret, id) {
        privateChoice(secret, id, {
            formId: "vote",
            title: t("local.phase.voting"),
            description: t("local.vote.prompt"),
            targets: state.options,
            submitLabel: t("local.vote.lock"),
            action: (targetId) => submit(id, "vote", { targetId }),
        });
    }

    function renderGuess(secret, id) {
        const guess = el("input", { id: "local-guess", required: true, type: "text", autocomplete: "off", spellcheck: "false" });
        const form = el("form", { class: "stack", onSubmit: (event) => {
            event.preventDefault();
            const text = guess.value.trim();
            if (text) submit(id, "guess", { text });
        } }, el("label", { for: "local-guess" }, t("local.guess.label")), guess,
        button(t("local.guess.submit"), null, { type: "submit" }),
        button(t("local.guess.skip"), () => submit(id, "guess", { text: null }), { variant: "secondary" }));
        secret.append(secretHeading(t("local.phase.last_guess")), paragraph(t("local.guess.prompt")), form);
    }

    function renderClues() {
        stage.append(heading(t("local.phase.clues"),
            t("local.clue.round", { current: state.clueRound, count: state.clueRounds })));
        const current = state.currentPlayerId;
        const order = el("ol", { class: "local-order" }, ...state.order.map((id) => el("li",
            id === current ? { "aria-current": "step" } : {}, label(id))));
        stage.append(el("section", { class: "panel stack" },
            el("h2", {}, t("local.clue.turn", { name: label(current) })),
            paragraph(t("local.clue.prompt")),
            order, button(t("local.clue.next"), () => submit(current, "clue"), test("clue-next"))));
    }

    function renderDiscussion() {
        stage.append(heading(t("local.phase.discussion"), t("local.discussion.prompt")));
        timer = el("p", { class: "local-countdown" });
        const toggled = state.paused;
        stage.append(el("section", { class: "panel stack" }, timer,
            toggled ? paragraph(t("local.discussion.paused")) : "",
            el("div", { class: "cluster" },
                button(t("local.discussion.vote"), () => submit(state.players[0].id, "end_discussion"),
                    { disabled: toggled, ...test("end-discussion") }),
                button(t(toggled ? "local.discussion.resume" : "local.discussion.pause"), toggleDiscussion,
                    { variant: "secondary" }))));
    }

    function renderAborted() {
        ctx.setRoundActive(false);
        stage.append(heading(t("local.round.aborted"), t("local.round.abortBody")),
            button(t("local.result.settings"), returnToSetup, { variant: "secondary" }));
    }

    function renderResult(result) {
        const record = { ...result, players: state.players, finishedAt: Date.now() };
        if (!session.has(result.id)) {
            session.set(result.id, record);
            addUsedWords(used, result);
            ctx.saveResult(record, "local");
            ctx.feedback("finish");
        }
        ctx.setRoundActive(false);
        stage.setAttribute("data-testid", "local-result");
        stage.append(heading(t("local.result.title"), t(`local.result.reason.${result.reason}`)));

        const matchingCategory = roundSelection.words.find((word) => word.id === result.wordId)?.category;
        const categoryText = roundSelection.categories?.find(({ id }) => id === matchingCategory)?.names?.[ctx.lang] ??
            storage.get("customPack", null)?.categories?.find(({ id }) => id === matchingCategory)?.names?.[ctx.lang] ??
            (matchingCategory ? t(`local.category.${matchingCategory}`) : "");
        const words = el("div", { class: "panel stack local-result-reveal" },
            el("h2", {}, t(`local.result.team.${result.winnerTeam}`)),
            result.winners.length ? paragraph(result.winners.map(label).join(", ")) : "",
            el("dl", { class: "local-result-data" },
                el("dt", {}, t(result.pairedWord ? "local.result.words" : "local.card.word")),
                el("dd", { class: "local-card-value" }, result.pairedWord ? `${result.word} / ${result.pairedWord}` : result.word),
                categoryText ? el("dt", {}, t("local.result.category")) : "", categoryText ? el("dd", {}, categoryText) : "",
                el("dt", {}, t("local.result.mode")), el("dd", {}, ctx.modeName(result.mode))),
            result.reused ? paragraph(t("local.result.reused")) : "");

        const playerRows = state.players.map(({ id, name }) => el("tr", {},
            el("th", { scope: "row" }, name),
            el("td", {}, ctx.roleName(result.roles[id])),
            el("td", {}, label(result.votes[id])),
            el("td", {}, result.points[id])));
        const details = el("section", { class: "panel stack" },
            el("h2", {}, t("local.result.detail")),
            result.voteWinner === null ? paragraph(t("local.result.tie")) :
                paragraph(t("local.result.voteWinner", { target: label(result.voteWinner) })),
            result.protected ? paragraph(t("local.result.protected", { name: label(result.protected) })) : "",
            result.eliminated ? paragraph(t("local.result.eliminated", { name: label(result.eliminated) })) : "",
            result.guess?.text ? paragraph(t("local.result.guess", { text: result.guess.text })) : "",
            resultTable(["participant", "role", "vote", "points"], playerRows));
        const scoreContainer = el("section", { class: "panel stack" });
        renderSessionScores(scoreContainer);
        const replayError = el("p", { class: "error", "aria-live": "polite" });
        const actions = el("div", { class: "cluster" },
            button(t("local.result.next"), () => beginRound(roundSelection, replayError), test("next-round")),
            button(t("local.result.settings"), returnToSetup, { variant: "secondary" }),
            button(t("local.result.history"), () => ctx.navigate("history"), { variant: "ghost" }));
        stage.append(words, details, scoreContainer, actions, replayError);
    }

    function resultTable(columns, rows) {
        return el("table", { class: "local-result-table" },
            el("thead", {}, el("tr", {}, ...columns.map((key) =>
                el("th", { scope: "col" }, t(`local.result.column.${key}`))))),
            el("tbody", {}, ...rows));
    }

    function renderSessionScores(container) {
        const scores = new Map(players.map(({ id, name }) => [id, { id, name, points: 0, wins: 0 }]));
        for (const result of session.values()) {
            for (const { id, name } of result.players) {
                if (!scores.has(id)) scores.set(id, { id, name, points: 0, wins: 0 });
                const score = scores.get(id);
                score.points += result.points[id] ?? 0;
                if (result.winners.includes(id)) score.wins += 1;
            }
        }
        const ranked = [...scores.values()].sort((a, b) => b.points - a.points || b.wins - a.wins ||
            a.name.localeCompare(b.name, ctx.lang));
        const rows = ranked.map(({ name, points, wins }) => el("tr", {},
            el("th", { scope: "row" }, name), el("td", {}, points), el("td", {}, wins)));
        container.replaceChildren(el("h2", {}, t("local.result.scoreboard")),
            resultTable(["participant", "points", "wins"], rows),
            button(t("local.result.reset"), () => {
                if (!window.confirm(t("local.result.confirmReset"))) return;
                session.clear();
                renderSessionScores(container);
                container.querySelector("h2")?.setAttribute("tabindex", "-1");
                container.querySelector("h2")?.focus();
            }, { variant: "ghost", disabled: session.size === 0 }));
    }

    function concealPrivate() {
        if (!privateOpen || !round) return;
        privateOpen = false;
        renderRound({ focus: false });
    }

    function submit(id, action, data = {}, detectiveStep = null) {
        if (signal.aborted) return;
        const phase = state.phase;
        if (privatePhases.has(phase) && !privateOpen) return;
        if (privateOpen) {
            privateOpen = false;
            stage.querySelector(".local-private-content")?.remove();
        }
        try {
            round.act(id, action, data);
            if (detectiveStep !== null) {
                const { investigation } = round.privateState(id);
                if (investigation) {
                    const pausedDiscussion = round.phase === "discussion" && round.pause();
                    report = { id, completed: detectiveStep, investigation, pausedDiscussion };
                    privateOpen = document.hasFocus() && !document.hidden;
                }
            }
            ctx.feedback("advance");
            renderRound();
        } catch (error) {
            renderRound();
            setMessage(t(error?.code === "invalid_text" ? "local.error.guess" : "local.error.action"));
        }
    }

    function closeReport() {
        if (!privateOpen || !report) return;
        if (report.pausedDiscussion) round.resume();
        report = null;
        privateOpen = false;
        renderRound();
    }

    function returnToSetup() {
        renderSetup();
        root.querySelector("h1")?.focus();
    }

    function abortRound() {
        concealPrivate();
        if (!window.confirm(t("local.round.confirmAbort"))) return;
        submit(state.players[0].id, "abort");
    }

    function toggleDiscussion() {
        if (state.paused) round.resume();
        else round.pause();
        renderRound();
    }

    function updateTimer() {
        if (!timer) return;
        const seconds = secondsLeft(state);
        const display = seconds === null ? t("local.discussion.unlimited")
            : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
        if (timer.textContent !== display) timer.textContent = display;
    }

    function tick() {
        if (!round || report || !timer) return;
        if (round.tick()) {
            privateOpen = false;
            renderRound();
        } else updateTimer();
    }

    const concealOnHidden = () => {
        if (document.hidden) concealPrivate();
    };
    const concealOnRestore = (event) => {
        if (event.persisted) concealPrivate();
        tick();
    };

    window.addEventListener("blur", concealPrivate, { signal });
    window.addEventListener("pagehide", concealPrivate, { signal });
    window.addEventListener("pageshow", concealOnRestore, { signal });
    window.addEventListener("popstate", concealPrivate, { signal, capture: true });
    document.addEventListener("visibilitychange", concealOnHidden, { signal });
    document.addEventListener("freeze", concealPrivate, { signal });
    ctx.setNavigationGuard(() => {
        concealPrivate();
        return !ctx.isRoundActive() || window.confirm(t("local.round.confirmLeave"));
    });
    const clock = window.setInterval(tick, 200);
    renderSetup();
    return () => {
        window.clearInterval(clock);
        editor?.destroy();
        if (!formingSetup && root.dataset.localPhase !== "setup") ctx.setRoundActive(false);
        round = null;
        stage = null;
        timer = null;
    };
}
