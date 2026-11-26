import { createRound } from "./engine.mjs";
import { DEFAULT_SETTINGS, getRoundSettings, mountSettings } from "./settings.mjs";

const usedWords = [];
const maxPlayers = 20;
const maxNameLength = 32;

function playerId() {
    const parts = crypto.getRandomValues(new Uint32Array(4));
    return Array.from(parts, (part) => part.toString(16).padStart(8, "0")).join("");
}

function rememberWords(result) {
    for (const id of [result.wordId, result.pairedWordId]) {
        if (!id) continue;
        const previous = usedWords.indexOf(id);
        if (previous >= 0) usedWords.splice(previous, 1);
        usedWords.push(id);
    }
}

export function mountLocal(ctx) {
    const { root, el, t, button, signal, storage } = ctx;

    let players = ctx.preferences().rememberNames ? storage.get("localPlayers", []) : [];
    if (!Array.isArray(players)) players = [];
    players = players.filter((player) => typeof player?.id === "string" && typeof player?.name === "string").slice(0, maxPlayers);
    let settings = { ...DEFAULT_SETTINGS, ...storage.get("localSettings", {}), language: ctx.lang, freePlay: true };
    let editor;
    let round;
    let roundSelection;
    let starting = false;
    let privateOpen = false;

    const test = (name) => ({ "data-testid": `local-${name}` });
    const paragraph = (text, style = "muted") => el("p", { class: style }, text);
    function heading(title, description) {
        return el("header", { class: "page-header" }, el("h1", { tabindex: "-1" }, title),
            description ? paragraph(description) : "");
    }

    function savePlayers() {
        if (ctx.preferences().rememberNames) storage.set("localPlayers", players);
        else storage.remove("localPlayers");
    }

    function saveSettings() {
        storage.set("localSettings", settings);
    }

    function renderSetup() {
        const nameDraft = root.querySelector("#local-name")?.value ?? "";
        editor?.destroy();
        editor = null;
        round = null;
        roundSelection = null;
        ctx.setRoundActive(false);
        root.dataset.localPhase = "setup";
        root.dataset.testid = "local-setup";

        const playersList = el("ul", { class: "local-player-list stack" });
        const count = el("p", { class: "local-player-count", "aria-live": "polite" });
        const nameInput = el("input", {
            id: "local-name",
            type: "text",
            maxlength: maxNameLength,
            autocomplete: "off",
            required: true,
            value: nameDraft,
            placeholder: t("local.players.placeholder"),
            ...test("player-name"),
        });
        const add = button(t("local.players.add"), null, { class: "local-player-add", variant: "secondary", type: "submit", ...test("add-player") });
        const clear = button(t("local.players.clear"), () => {
            players = [];
            savePlayers();
            updatePlayers();
            nameInput.focus();
        }, { variant: "ghost", class: "local-player-clear" });
        const rosterError = el("p", { class: "error", "aria-live": "polite" });
        const roster = el("form", { class: "stack local-roster-form", onSubmit: (event) => {
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
            playersList.replaceChildren(...players.map((player) => el("li", { class: "local-player-row" },
                el("span", { class: "local-player-avatar", "aria-hidden": "true" }, Array.from(player.name)[0]?.toLocaleUpperCase(ctx.lang)),
                el("span", { class: "local-player-name" }, player.name),
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

        const configRoot = el("div", { class: "stack setup-config" });
        const start = button(t("local.setup.start"), () => {
            const selection = editor.getSelection();
            if (!canStart(selection)) return;
            settings = { ...editor.getSettings(), freePlay: true };
            beginRound(selection, setupError, start);
        }, { ...test("start"), class: "local-start-button" });
        const setupError = el("p", { class: "error", "aria-live": "polite" });
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

        const hero = el("header", { class: "setup-hero" },
            el("div", { class: "setup-hero__copy" },
                el("h1", { tabindex: "-1" }, t("local.setup.title")), paragraph(t("local.setup.intro"))),
            el("div", { class: "setup-hero__art", "aria-hidden": "true" },
                el("span", { class: "setup-hero__orbit" }),
                el("span", { class: "setup-hero__spark setup-hero__spark--near" }, "✦"),
                el("span", { class: "setup-hero__spark setup-hero__spark--far" }, "✧"),
                el("span", { class: "setup-hero__card setup-hero__card--back" }),
                el("span", { class: "setup-hero__card setup-hero__card--front" }, "?")));
        root.replaceChildren(hero,
            el("section", { class: "panel stack setup-roster", "aria-labelledby": "local-players-title" },
                el("div", { class: "split" },
                    el("h2", { id: "local-players-title" }, t("local.players.title")), count),
                roster, playersList, clear), configRoot,
            el("div", { class: "panel stack local-start-actions" }, setupError, startHelp, start));

        updatePlayers();
        editor = mountSettings(ctx, {
            root: configRoot,
            settings,
            playerCount: players.length,
            onChange: (value) => {
                settings = { ...value, freePlay: true };
                saveSettings();
                setupError.textContent = "";
            },
            onSelection: adjustStart,
        });
        adjustStart();
    }

    async function beginRound(selection, sourceError, trigger) {
        if (starting) return;
        const selected = { ...settings, freePlay: true };
        const roster = players;
        starting = true;
        trigger.disabled = true;
        sourceError.textContent = t("local.setup.loading");
        try {
            const rules = await ctx.rules();
            if (signal.aborted) return;
            round = createRound(roster, getRoundSettings(selected), selection.words, selection.pairs, rules, { used: usedWords, flow: "table" });
        } catch {
            if (!signal.aborted) sourceError.textContent = t("local.error.start");
            return;
        } finally {
            starting = false;
            trigger.disabled = false;
        }

        roundSelection = selection;
        players = roster;
        settings = selected;
        saveSettings();
        savePlayers();
        editor?.destroy();
        editor = null;
        privateOpen = false;
        ctx.setRoundActive(true);
        renderRound();
    }

    function renderRound({ focus = true, error = "" } = {}) {
        const state = round.publicState();
        const stage = el("section", { class: "stack local-stage" });
        root.dataset.localPhase = state.phase;
        delete root.dataset.testid;

        let focusControl;
        if (state.phase === "roles") focusControl = renderPrivate(stage, state);
        else if (state.phase === "playing") renderPlaying(stage, state);
        else renderResult(stage, state);

        if (error) stage.append(paragraph(error, "error"));
        root.replaceChildren(stage);
        if (focus && !document.hidden && document.hasFocus()) {
            window.scrollTo(0, 0);
            (focusControl ?? stage.querySelector("h1"))?.focus({ preventScroll: true });
        }
    }

    function renderPrivate(stage, state) {
        const { id, name } = state.players[state.completed];
        const progress = el("div", { class: "local-handoff-progress" },
            paragraph(t("local.private.step", { step: state.completed + 1, count: state.players.length }), "local-phase-label"),
            el("div", { class: "local-handoff-track", "aria-hidden": "true" }, state.players.map((_, index) =>
                el("span", { "data-step": index < state.completed ? "done" : index === state.completed ? "current" : "upcoming" }))));
        const content = el("div", { class: "hand-off panel stack", ...test("handoff") }, progress);
        const title = el("h1", { tabindex: "-1" }, t("local.private.pass", { name }));
        stage.append(content);

        if (!privateOpen) {
            const open = button(t("local.private.show"), () => {
                if (document.hidden || !document.hasFocus()) return;
                privateOpen = true;
                renderRound();
                ctx.feedback("reveal");
            }, test("show-private"));
            content.append(el("div", { class: "local-handoff-body" },
                el("div", { class: "local-handoff-art", "aria-hidden": "true" }, el("span", {}, "?")),
                el("div", { class: "stack local-handoff-copy" }, title, paragraph(t("local.private.ready")), open)));
            return open;
        }

        const card = round.privateState(id).card;
        const role = el("h2", { tabindex: "-1" }, card.role ? ctx.roleName(card.role) : t("local.card.word"));
        const field = card.word ? "word" : card.hint ? "hint" : "note";
        const value = card.word ?? card.hint ?? t("local.card.empty");
        const fields = el("dl", { class: "local-card-data" },
            el("dt", { class: card.role ? null : "sr-only" }, t("local.card." + field)),
            el("dd", { class: "local-card-value", lang: ctx.lang }, value));

        if (card.partners.length) {
            const partners = state.players.filter((player) => card.partners.includes(player.id));
            fields.append(el("dt", {}, t("local.card.partners")), el("dd", {}, partners.map((player) => player.name).join(", ")));
        }
        content.append(el("div", { class: "local-handoff-open stack" }, title,
            el("div", { class: "local-private-content stack", ...test("private-content") }, role, fields,
                button(t("local.card.hide"), () => advance(id, "ack_role"), test("hide-card")))));
        return role;
    }

    function renderPlaying(stage, state) {
        const starter = state.players.find(({ id }) => id === state.firstClueGiverId);
        const showRoles = button(t("local.playing.show"), () => {
            showRoles.focus();
            confirmation.showModal();
        }, { "aria-haspopup": "dialog", ...test("show-roles") });
        const confirmation = el("dialog", {
            class: "panel local-reveal-dialog",
            "aria-labelledby": "local-reveal-question",
            ...test("reveal-confirmation"),
        }, el("div", { class: "stack" },
            el("h2", { id: "local-reveal-question" }, t("local.playing.revealQuestion")),
            el("div", { class: "cluster local-dialog-actions" },
                button(t("local.playing.continue"), () => confirmation.close(), {
                    variant: "secondary", autofocus: true, ...test("continue-playing"),
                }),
                button(t("local.playing.confirmReveal"), () => {
                    if (!confirmation.open) return;
                    confirmation.close();
                    advance(state.players[0].id, "reveal_roles");
                }, test("confirm-reveal")))));
        stage.append(el("section", { class: "panel local-playing-card" },
            el("div", { class: "local-playing-art", "aria-hidden": "true" }, el("span", {})),
            el("div", { class: "stack local-playing-copy" },
                el("header", { class: "page-header" },
                    el("h1", { tabindex: "-1", ...test("first-clue-giver") }, t("local.playing.starter", { name: starter.name })),
                    paragraph(t("local.playing.prompt"))),
                showRoles), confirmation));
    }

    function renderResult(stage, state) {
        const { result } = state;
        const category = roundSelection.categories?.find(({ id }) => id === result.category);
        const categoryText = category?.names?.[ctx.lang] ?? result.category;
        const wordGroup = el("div", { class: "local-result-words" },
            el("dt", {}, t(result.pairedWord ? "local.result.words" : "local.card.word")),
            el("dd", { class: "local-card-value", lang: settings.language }, result.word));
        if (result.pairedWord) {
            wordGroup.append(el("dd", { class: "local-card-value", lang: settings.language }, result.pairedWord));
        }
        const words = el("dl", { class: "local-result-data" }, wordGroup,
            categoryText ? el("div", { class: "local-result-detail" },
                el("dt", {}, t("local.result.category")), el("dd", {}, categoryText)) : null,
            el("div", { class: "local-result-detail" },
                el("dt", {}, t("local.result.mode")), el("dd", {}, ctx.modeName(result.mode))));

        const rows = state.players.map(({ id, name }) => {
            const { word, hint } = result.cardContents[id];
            const value = word ?? (hint ? t("local.result.hint", { hint }) : t("local.result.empty"));
            const role = result.roles[id];
            return el("tr", {}, el("th", { scope: "row" }, name),
                el("td", {}, el("span", { class: "local-result-role", "data-role": role }, ctx.roleName(role))),
                el("td", { lang: settings.language }, value));
        });
        const roles = el("table", { class: "local-result-table" },
            el("thead", {}, el("tr", {},
                el("th", { scope: "col" }, t("local.result.column.participant")),
                el("th", { scope: "col" }, t("local.result.column.role")),
                el("th", { scope: "col" }, t("local.result.column.card")))),
            el("tbody", {}, rows));

        const replayError = el("p", { class: "error", "aria-live": "polite" });
        const next = button(t("local.result.next"), () => beginRound(roundSelection, replayError, next), test("next-round"));
        stage.setAttribute("data-testid", "local-result");
        stage.append(heading(t("local.result.title")),
            el("section", { class: "panel stack local-result-reveal" }, words,
                result.reused ? paragraph(t("local.result.reused")) : ""),
            el("div", { class: "stack local-result-actions" },
                el("div", { class: "cluster" }, next,
                    button(t("local.result.settings"), returnToSetup, { variant: "secondary" })), replayError),
            el("section", { class: "panel stack local-result-roles" }, el("h2", {}, t("local.result.roles")), roles));
    }

    function concealPrivate() {
        if (!privateOpen || !round) return;
        privateOpen = false;
        renderRound({ focus: false });
    }

    function advance(id, action) {
        if (signal.aborted || (action === "ack_role" && !privateOpen)) return;
        if (privateOpen) {
            privateOpen = false;
            root.querySelector(".local-private-content")?.remove();
        }

        try {
            round.act(id, action);
        } catch {
            renderRound({ error: t("local.error.action") });
            return;
        }
        if (round.phase === "reveal") {
            rememberWords(round.publicState().result);
            ctx.setRoundActive(false);
            ctx.feedback("finish");
        } else ctx.feedback("advance");
        renderRound();
    }

    function returnToSetup() {
        renderSetup();
        window.scrollTo(0, 0);
        root.querySelector("h1")?.focus({ preventScroll: true });
    }

    const concealOnHidden = () => {
        if (document.hidden) concealPrivate();
    };
    const concealOnRestore = (event) => {
        if (event.persisted) concealPrivate();
    };
    function refreshSetup() {
        if (root.dataset.localPhase === "setup" && !starting) renderSetup();
    }

    window.addEventListener("blur", concealPrivate, { signal });
    window.addEventListener("pagehide", concealPrivate, { signal });
    window.addEventListener("pageshow", concealOnRestore, { signal });
    window.addEventListener("popstate", concealPrivate, { signal, capture: true });
    window.addEventListener("imposter:custom-content", refreshSetup, { signal });
    document.addEventListener("visibilitychange", concealOnHidden, { signal });
    document.addEventListener("freeze", concealPrivate, { signal });
    ctx.setNavigationGuard(() => {
        concealPrivate();
        root.querySelector(".local-reveal-dialog[open]")?.close();
    });

    renderSetup();
    return () => {
        editor?.destroy();
        if (round && round.phase !== "reveal") ctx.setRoundActive(false);
        round = null;
    };
}

