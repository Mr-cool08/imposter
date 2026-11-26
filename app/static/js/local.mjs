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
        privateOpen = false;
        ctx.setRoundActive(false);
        root.dataset.localPhase = "setup";
        root.dataset.testid = "local-setup";

        const playersList = el("ul", { class: "local-player-list stack" });
        const count = el("p", { class: "local-player-count", "aria-live": "polite" });
        let editingId = null;
        let pendingUndo = null;
        const nameAttributes = {
            type: "text",
            maxlength: maxNameLength,
            autocomplete: "off",
            required: true,
        };
        const nameInput = el("input", {
            ...nameAttributes,
            id: "local-name",
            value: nameDraft,
            placeholder: t("local.players.placeholder"),
            "aria-describedby": "local-roster-error",
            ...test("player-name"),
        });
        const add = button(t("local.players.add"), null, { class: "local-player-add", variant: "secondary", type: "submit", ...test("add-player") });
        const clear = button(t("local.players.clear"), () => {
            removePlayers([], players[0].id);
        }, { variant: "ghost", class: "local-player-clear" });
        const undoButton = button(t("local.players.undo"), () => {
            const { roster: previousPlayers, focusId } = pendingUndo;
            changePlayers(previousPlayers, { focusId });
        }, { variant: "secondary", hidden: true });
        const rosterActions = el("div", { class: "cluster local-roster-actions" }, clear, undoButton);
        const rosterError = el("p", { id: "local-roster-error", class: "error", "aria-live": "polite" });
        const roster = el("form", { class: "stack local-roster-form", onSubmit: (event) => {
            event.preventDefault();
            if (players.length >= maxPlayers) return;
            const name = validateName(nameInput, rosterError);
            if (!name) return;
            nameInput.value = "";
            changePlayers([...players, { id: playerId(), name }]);
            nameInput.focus();
        } }, el("label", { for: "local-name" }, t("local.players.name")),
        el("div", { class: "cluster local-name-entry" }, nameInput, add), rosterError);

        function validateName(input, error, editing = null) {
            const name = input.value.trim().replace(/\s+/gu, " ");
            let message = "";
            if (!name) message = t("local.players.required");
            else if (players.some((player) => player.id !== editing && player.name.localeCompare(name, ctx.lang, { sensitivity: "accent" }) === 0)) {
                message = t("local.players.duplicate");
            }
            error.textContent = message;
            if (message) {
                input.setAttribute("aria-invalid", "true");
                input.focus();
                return null;
            }
            input.removeAttribute("aria-invalid");
            return name;
        }

        function changePlayers(next, { undo = null, focusId = null } = {}) {
            players = next;
            editingId = null;
            pendingUndo = undo;
            savePlayers();
            updatePlayers(focusId);
        }

        function removePlayers(next, focusId) {
            changePlayers(next, { undo: { roster: players, focusId } });
            undoButton.focus();
        }

        function renderPlayerList(focusId = null) {
            let focusControl;
            playersList.replaceChildren(...players.map((player) => {
                const { id, name } = player;
                const avatar = el("span", { class: "local-player-avatar", "aria-hidden": "true" }, Array.from(name)[0]?.toLocaleUpperCase(ctx.lang));
                const row = el("li", { class: "local-player-row" }, avatar);
                if (id === editingId) {
                    const input = el("input", {
                        ...nameAttributes,
                        value: name,
                        "aria-label": t("local.players.name"),
                        "aria-describedby": "local-player-edit-error",
                    });
                    const error = el("p", { id: "local-player-edit-error", class: "error", "aria-live": "polite" });
                    const save = button(t("local.players.saveEdit"), null, { variant: "secondary", type: "submit" });
                    const cancel = button(t("local.players.cancelEdit"), () => {
                        editingId = null;
                        renderPlayerList(id);
                    }, { variant: "ghost" });
                    row.append(el("form", { class: "stack local-player-edit", onSubmit: (event) => {
                        event.preventDefault();
                        const editedName = validateName(input, error, id);
                        if (!editedName) return;
                        if (editedName === name) {
                            editingId = null;
                            renderPlayerList(id);
                            return;
                        }
                        changePlayers(players.map((entry) => entry.id === id ? { ...entry, name: editedName } : entry), { focusId: id });
                    } }, input, error, el("div", { class: "cluster local-player-actions" }, save, cancel)));
                    if (id === focusId) focusControl = input;
                } else {
                    const edit = button(t("local.players.edit"), () => {
                        editingId = id;
                        renderPlayerList(id);
                    }, { variant: "ghost", "aria-label": t("local.players.editNamed", { name }) });
                    const remove = button(t("local.players.remove"), () => {
                        removePlayers(players.filter((entry) => entry.id !== id), id);
                    }, { variant: "ghost", "aria-label": t("local.players.removeNamed", { name }) });
                    row.append(el("span", { class: "local-player-name" }, name),
                        el("div", { class: "cluster local-player-actions" }, edit, remove));
                    if (id === focusId) focusControl = edit;
                }
                return row;
            }));
            focusControl?.focus();
        }

        function updatePlayers(focusId) {
            renderPlayerList(focusId);
            count.textContent = t("local.players.count", { count: players.length });
            clear.hidden = players.length === 0;
            undoButton.hidden = pendingUndo === null;
            rosterActions.hidden = clear.hidden && undoButton.hidden;
            add.disabled = players.length >= maxPlayers;
            nameInput.disabled = add.disabled;
            rosterError.textContent = "";
            nameInput.removeAttribute("aria-invalid");
            editor?.setPlayerCount(players.length);
            adjustStart();
        }

        const configRoot = el("div", { class: "stack setup-config" });
        const start = button(t("local.setup.start"), () => {
            const selection = editor.getSelection();
            if (startBlocker(selection)) return;
            settings = { ...editor.getSettings(), freePlay: true };
            void beginRound(selection, setupError, adjustStart);
        }, { ...test("start"), class: "local-start-button", "aria-describedby": "local-start-help" });
        const setupError = el("p", { class: "error", "aria-live": "polite" });
        const startHelp = el("p", {
            id: "local-start-help", class: "muted", role: "status", "aria-live": "polite", "aria-atomic": "true",
        });

        function startBlocker(selection) {
            if (players.length < 3) return t("local.players.minimum");
            if (starting) return t("local.setup.loading");
            if (!selection || selection.loading) return t("settings.loading");
            if (selection.error) return selection.error;
            if (selection.issues.length) return editor.formatIssue(selection.issues[0], settings.mode === "chaos");
            if (!selection.words.length) return t("settings.issue.no_words");
            return "";
        }

        function adjustStart(selection = editor?.getSelection()) {
            const message = startBlocker(selection);
            start.disabled = Boolean(message);
            if (startHelp.textContent !== message) startHelp.textContent = message;
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
                roster, playersList, rosterActions), configRoot,
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

    async function beginRound(selection, sourceError, updatePending) {
        if (starting) return;
        const selected = { ...settings, freePlay: true };
        const roster = players;
        starting = true;
        sourceError.textContent = "";
        updatePending();
        try {
            const rules = await ctx.rules();
            if (signal.aborted) return;
            round = createRound(roster, getRoundSettings(selected), selection.words, selection.pairs, rules, { used: usedWords, flow: "table" });
        } catch {
            if (!signal.aborted) sourceError.textContent = t("local.error.start");
            return;
        } finally {
            starting = false;
            updatePending();
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

    const cancelRound = button(t("local.cancel.action"), () => {
        concealPrivate();
        cancelRound.focus();
        cancelConfirmation.showModal();
    }, { variant: "ghost", class: "local-cancel-round", "aria-haspopup": "dialog", ...test("cancel-round") });
    const cancelConfirmation = el("dialog", {
        class: "panel local-round-dialog",
        "aria-labelledby": "local-cancel-question",
        ...test("cancel-confirmation"),
    }, el("div", { class: "stack" },
        el("h2", { id: "local-cancel-question" }, t("local.cancel.question")),
        el("div", { class: "cluster local-dialog-actions" },
            button(t("local.cancel.continue"), () => cancelConfirmation.close(), {
                variant: "secondary", autofocus: true, ...test("continue-round"),
            }),
            button(t("local.cancel.action"), () => {
                if (!cancelConfirmation.open) return;
                cancelConfirmation.close();
                advance(players[0].id, "abort");
            }, { variant: "danger", ...test("confirm-cancel") }))));

    function renderRound({ focus = true, error = "" } = {}) {
        const state = round.publicState();
        const stage = el("section", { class: "stack local-stage" });
        root.dataset.localPhase = state.phase;
        delete root.dataset.testid;

        let focusControl;
        if (state.phase === "roles") focusControl = renderPrivate(stage, state);
        else if (state.phase === "playing") renderPlaying(stage, state);
        else renderResult(stage, state);

        if (state.phase === "roles" || state.phase === "playing") stage.append(cancelRound, cancelConfirmation);
        if (error) stage.append(paragraph(error, "error"));
        root.replaceChildren(stage);
        if (focus && !document.hidden && document.hasFocus()) {
            window.scrollTo(0, 0);
            (focusControl ?? stage.querySelector("h1"))?.focus({ preventScroll: true });
        }
    }

    function renderPrivate(stage, state) {
        const { id, name } = state.players[state.completed];
        const position = { step: state.completed + 1, count: state.players.length };
        const progress = el("div", { class: "local-handoff-progress" },
            paragraph(t("local.private.step", position), "local-phase-label"),
            el("div", { class: "local-handoff-track", "aria-hidden": "true" }, state.players.map((_, index) =>
                el("span", { "data-step": index < state.completed ? "done" : index === state.completed ? "current" : "upcoming" }))));
        const content = el("div", { class: "hand-off panel stack", ...test("handoff") }, progress);
        const title = el("h1", { tabindex: "-1" }, t("local.private.pass", { name }));
        stage.append(content);

        if (!privateOpen) {
            const description = el("span", { id: "local-handoff-description", hidden: true },
                t("local.private.description", { name, ...position }));
            const open = button(t("local.private.show"), () => {
                if (document.hidden || !document.hasFocus()) return;
                privateOpen = true;
                renderRound();
                ctx.feedback("reveal");
            }, { "aria-describedby": description.id, ...test("show-private") });
            content.append(el("div", { class: "local-handoff-body" },
                el("div", { class: "local-handoff-art", "aria-hidden": "true" }, el("span", {}, "?")),
                el("div", { class: "stack local-handoff-copy" }, title, paragraph(t("local.private.ready")), open, description)));
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
            class: "panel local-round-dialog",
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
        const next = button(t("local.result.next"), () => void beginRound(roundSelection, replayError, () => {
            next.disabled = starting;
            if (starting) replayError.textContent = t("local.setup.loading");
        }), test("next-round"));
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
        if (round.phase === "aborted") {
            returnToSetup();
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
        root.querySelector(".local-round-dialog[open]")?.close();
    });

    renderSetup();
    return () => {
        editor?.destroy();
        if (round && round.phase !== "reveal") ctx.setRoundActive(false);
        round = null;
    };
}

