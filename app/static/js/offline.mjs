const changeEvent = "imposter:offline-change";
const requestPrefix = "imposter-offline:";
let registrationPromise;
let installPrompt;

function notify() {
    window.dispatchEvent(new Event(changeEvent));
}

function canUseOffline() {
    return window.isSecureContext && "serviceWorker" in navigator && "caches" in window;
}

if (typeof window !== "undefined") {
    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        installPrompt = event;
        notify();
    });
    window.addEventListener("appinstalled", () => {
        installPrompt = undefined;
        notify();
    });
    window.addEventListener("online", () => {
        notify();
        registrationPromise?.then((registration) => registration.update()).catch(() => {});
    });
    window.addEventListener("offline", notify);
}

function watchRegistration(registration) {
    const observe = () => {
        registration.installing?.addEventListener("statechange", notify);
        notify();
    };
    registration.addEventListener("updatefound", observe);
    observe();
    return registration;
}

export function startOffline() {
    if (!canUseOffline()) return Promise.resolve(null);
    registrationPromise ??= navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
    }).then(watchRegistration).catch((error) => {
        registrationPromise = undefined;
        throw error;
    });
    return registrationPromise;
}

function waitForActivation(worker) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => finish(new Error("unavailable")), 30000);
        const changed = () => {
            if (worker.state === "activated") finish();
            if (worker.state === "redundant") finish(new Error("unavailable"));
        };

        function finish(error) {
            clearTimeout(timeout);
            worker.removeEventListener("statechange", changed);
            if (error) reject(error);
            else resolve(worker);
        }

        worker.addEventListener("statechange", changed);
        changed();
    });
}

function askWorker(worker, type, options) {
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => finish(new Error("unavailable")), 60000);

        function finish(error, response) {
            clearTimeout(timeout);
            channel.port1.close();
            if (error) reject(error);
            else resolve(response);
        }

        channel.port1.onmessage = (event) => finish(null, event.data);
        channel.port1.onmessageerror = () => finish(new Error("unavailable"));
        try {
            worker.postMessage({ type: requestPrefix + type, options }, [channel.port2]);
        } catch (error) {
            finish(error);
        }
    });
}

async function requestStatus(type, { categoryIds = [], language = "sv" } = {}) {
    let update = false;
    const failed = (key) => ({ ready: false, missing: categoryIds, update, error: "offline." + key });
    if (!canUseOffline()) return failed("unsupported");

    try {
        const registration = await startOffline();
        update = Boolean(registration.waiting);
        const worker = registration.active ?? registration.installing ?? registration.waiting;
        if (!worker) return failed("unavailable");
        if (worker.state !== "activated") await waitForActivation(worker);
        const { ready, missing, error } = await askWorker(worker, type, { categoryIds, language });
        return { ready, missing, update: Boolean(registration.waiting), error: error ? "offline." + error : "" };
    } catch (error) {
        return failed(error?.name === "QuotaExceededError" || error?.name === "SecurityError"
            ? "storage"
            : "unavailable");
    }
}

export function offlineStatus(options) {
    return requestStatus("status", options);
}

export async function downloadOffline(options) {
    const status = await requestStatus("download", options);
    notify();
    return status;
}

export async function applyOfflineUpdate() {
    const registration = await startOffline();
    const pending = registration?.waiting;
    if (!pending) return false;
    pending.postMessage({ type: requestPrefix + "activate" });
    await waitForActivation(pending);
    return true;
}

function mountOfflinePanel(container, options) {
    const { t, isRoundActive = () => false } = options;
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const buttons = document.createElement("div");
    const download = document.createElement("button");
    const install = document.createElement("button");
    const refresh = document.createElement("button");

    buttons.className = "cluster";
    for (const button of [download, install, refresh]) {
        button.type = "button";
        button.className = "button button--secondary";
        button.hidden = true;
        buttons.append(button);
    }
    download.textContent = t("offline.download");
    install.textContent = t("offline.install");
    refresh.textContent = t("offline.update");
    container.replaceChildren(status, buttons);

    let busy = false;
    let disposed = false;
    let rendered = 0;
    let last;

    function render(result, message) {
        if (disposed) return;
        last = result;
        const active = isRoundActive();
        status.textContent = t(message || result.error || (result.ready ? "offline.ready" : "offline.notReady"));
        download.hidden = Boolean(result.ready || result.error === "offline.unsupported"
            || result.error === "offline.invalidSelection");
        download.disabled = busy || !navigator.onLine;
        install.hidden = !installPrompt;
        install.disabled = busy;
        refresh.hidden = !result.update || active;
        refresh.disabled = busy;
    }

    async function showStatus() {
        if (busy || disposed) return;
        if (!container.isConnected) {
            removeListeners();
            return;
        }
        const attempt = ++rendered;
        const result = await offlineStatus(options);
        if (!busy && attempt === rendered) render(result);
    }

    async function perform(operation, pendingMessage) {
        if (busy || disposed) return;
        busy = true;
        rendered++;
        const previous = last ?? { ready: false, update: false };
        render(previous, pendingMessage);
        const result = await operation().catch(() => ({ ...previous, error: "offline.unavailable" }));
        busy = false;
        render(result);
    }

    download.addEventListener("click", () => {
        void perform(() => downloadOffline(options), "offline.downloading");
    });
    install.addEventListener("click", async () => {
        const prompt = installPrompt;
        installPrompt = undefined;
        if (prompt) await prompt.prompt().catch(() => {});
        notify();
    });
    refresh.addEventListener("click", () => {
        if (isRoundActive()) return;
        void perform(async () => {
            if (await applyOfflineUpdate()) window.location.reload();
            return offlineStatus(options);
        }, "offline.updating");
    });

    function removeListeners() {
        disposed = true;
        window.removeEventListener(changeEvent, showStatus);
    }

    status.textContent = t("offline.checking");
    window.addEventListener(changeEvent, showStatus);
    void showStatus();
    return removeListeners;
}

export function mountOffline(ctx) {
    const panel = ctx.root;
    const menu = panel.closest("details");
    panel.classList.add("stack");

    let disposePanel;
    let manifestPromise;
    let renderId = 0;

    function manifest() {
        manifestPromise ??= fetch("/api/content/manifest", { credentials: "omit" })
            .then((response) => {
                if (!response.ok) throw new Error("missingCatalog");
                return response.json();
            })
            .catch((error) => {
                manifestPromise = undefined;
                throw error;
            });
        return manifestPromise;
    }

    async function render() {
        const current = ++renderId;
        const active = ctx.isRoundActive();
        if (menu) {
            menu.hidden = active;
            if (menu.hidden) menu.open = false;
        }
        if (active || menu && !menu.open) {
            disposePanel?.();
            return;
        }

        const settings = ctx.storage.get("localSettings", {});
        const selection = settings?.categories;
        const customIds = new Set((ctx.storage.get("customPack", null)?.categories ?? []).map(({ id }) => id));
        let categoryIds = Array.isArray(selection)
            ? selection.filter((id) => typeof id === "string" && !customIds.has(id))
            : [];
        if (!Array.isArray(selection) || !selection.length) {
            try {
                categoryIds = (await manifest()).categories.map(({ id }) => id);
            } catch {
                if (current === renderId) panel.textContent = ctx.t("offline.missingCatalog");
                return;
            }
        }
        if (current !== renderId) return;
        disposePanel?.();
        disposePanel = mountOfflinePanel(panel, {
            categoryIds,
            language: ctx.lang,
            t: ctx.t,
            isRoundActive: ctx.isRoundActive,
        });
    }

    const events = ["imposter:language", "imposter:round-state", "imposter:local-settings"];
    menu?.addEventListener("toggle", render);
    for (const event of events) window.addEventListener(event, render);
    void startOffline().catch(() => {});
    void render();

    return () => {
        renderId++;
        disposePanel?.();
        menu?.removeEventListener("toggle", render);
        for (const event of events) window.removeEventListener(event, render);
    };
}
