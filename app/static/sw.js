"use strict";

const { version, assets } = self.IMPOSTER_SHELL;
const shellPrefix = "imposter-shell-";
const contentPrefix = "imposter-content-";
const shellCache = shellPrefix + version;
const catalogPath = "/api/content/manifest";
const packPrefix = "/api/content/packs/";
const messagePrefix = "imposter-offline:";
const categoryPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const languagePaths = {
    sv: "/api/i18n/sv.json",
    en: "/api/i18n/en.json",
};
const shellPaths = new Set([
    "/",
    "/manifest.webmanifest",
    catalogPath,
    "/api/content/rules",
    ...Object.values(languagePaths),
    ...assets.filter((asset) => /^\/static\/(?:css|js|icons|vendor)\/[A-Za-z0-9._/-]+$/.test(asset)),
]);

function publicRequest(path) {
    return new Request(new URL(path, self.location.origin), {
        cache: "reload",
        credentials: "omit",
        redirect: "error",
    });
}

function cacheName(catalog) {
    return contentPrefix + encodeURIComponent(catalog.version);
}

function packPath(category) {
    return packPrefix + category + ".json";
}

function categoryFromPath(path) {
    if (!path.startsWith(packPrefix) || !path.endsWith(".json")) return null;
    const category = path.slice(packPrefix.length, -5);
    return categoryPattern.test(category) ? category : null;
}

async function catalogForShell() {
    const response = await (await caches.open(shellCache)).match(publicRequest(catalogPath));
    if (!response) throw new Error("missingCatalog");
    const catalog = await response.json();
    if (typeof catalog.version !== "string" || !catalog.version || !Array.isArray(catalog.categories)) {
        throw new Error("missingCatalog");
    }
    return catalog;
}

async function downloadPack(category, catalog, cache) {
    const request = publicRequest(packPath(category));
    if (await cache.match(request)) return;

    const response = await fetch(request);
    if (!response.ok) throw new Error("packageUnavailable");
    const body = await response.clone().json();
    const bodyCategory = typeof body.category === "string" ? body.category : body.category?.id;
    if (body.version !== catalog.version || bodyCategory !== category
        || !Array.isArray(body.words) || !Array.isArray(body.pairs)) {
        throw new Error("packageUnavailable");
    }
    await cache.put(request, response);
}

async function refreshDownloadedPacks(catalog) {
    const name = cacheName(catalog);
    const previous = (await caches.keys()).filter((key) => key.startsWith(contentPrefix) && key !== name);
    if (!previous.length) return;

    const requested = new Set();
    for (const key of previous) {
        const oldCache = await caches.open(key);
        for (const request of await oldCache.keys()) {
            const category = categoryFromPath(new URL(request.url).pathname);
            if (category) requested.add(category);
        }
    }

    const cache = await caches.open(name);
    for (const category of catalog.categories) {
        if (requested.has(category.id)) await downloadPack(category.id, catalog, cache);
    }
}

async function installShell() {
    const cache = await caches.open(shellCache);
    await cache.addAll([...shellPaths].map(publicRequest));
    await refreshDownloadedPacks(await catalogForShell());
}

async function activateShell() {
    const activeContent = cacheName(await catalogForShell());
    await Promise.all((await caches.keys())
        .filter((key) => (key.startsWith(shellPrefix) && key !== shellCache)
            || (key.startsWith(contentPrefix) && key !== activeContent))
        .map((key) => caches.delete(key)));
    await self.clients.claim();
}

self.addEventListener("install", (event) => {
    event.waitUntil(installShell());
});

self.addEventListener("activate", (event) => {
    event.waitUntil(activateShell());
});

async function serveShellPath(path) {
    try {
        const fromCache = await (await caches.open(shellCache)).match(publicRequest(path));
        if (fromCache) return fromCache;
    } catch {
        // Continue over the network if browser storage was disabled or cleared.
    }
    return fetch(publicRequest(path));
}

async function servePublicPack(category) {
    const request = publicRequest(packPath(category));
    try {
        const catalog = await catalogForShell();
        if (catalog.categories.some(({ id }) => id === category)) {
            const fromCache = await (await caches.open(cacheName(catalog))).match(request);
            if (fromCache) return fromCache;
        }
    } catch {
        // Cached content is optional when the server is reachable.
    }
    try {
        return await fetch(request);
    } catch {
        return Response.json(
            { error: "offline.packageUnavailable", category },
            { status: 503, headers: { "Cache-Control": "no-store" } },
        );
    }
}

self.addEventListener("fetch", (event) => {
    const request = event.request;
    const { origin, pathname, search } = new URL(request.url);
    if (request.method !== "GET" || origin !== self.location.origin
        || request.headers.has("Authorization")) return;

    if (request.mode === "navigate" && (pathname === "/" || /^\/join\/[a-z0-9]{4,12}\/?$/i.test(pathname))) {
        event.respondWith(serveShellPath("/"));
    } else if (!search && shellPaths.has(pathname)) {
        event.respondWith(serveShellPath(pathname));
    } else if (!search) {
        const category = categoryFromPath(pathname);
        if (category) event.respondWith(servePublicPack(category));
    }
});

function requestedResources(options, catalog) {
    const categoryIds = options?.categoryIds;
    const language = options?.language;
    const listed = new Set(catalog.categories.map(({ id }) => id));
    if (!Object.hasOwn(languagePaths, language) || !Array.isArray(categoryIds)
        || categoryIds.some((id) => typeof id !== "string" || !listed.has(id))) {
        throw new Error("invalidSelection");
    }
    return { categoryIds: [...new Set(categoryIds)], language };
}

async function offlineStatus(options, download) {
    const catalog = await catalogForShell();
    const selection = requestedResources(options, catalog);
    const appCache = await caches.open(shellCache);
    const content = await caches.open(cacheName(catalog));
    let error = "";

    if (download) {
        for (const category of selection.categoryIds) {
            try {
                await downloadPack(category, catalog, content);
            } catch (failure) {
                error = failure?.name === "QuotaExceededError" || failure?.name === "SecurityError"
                    ? "storage"
                    : "packageUnavailable";
            }
        }
    }

    const missing = [];
    for (const category of selection.categoryIds) {
        if (!await content.match(publicRequest(packPath(category)))) missing.push(category);
    }
    const shellAvailable = (await Promise.all([...shellPaths].map(
        (path) => appCache.match(publicRequest(path)),
    ))).every(Boolean);
    return { ready: shellAvailable && !missing.length, missing, error };
}

self.addEventListener("message", (event) => {
    const { type, options } = event.data ?? {};
    if (type === messagePrefix + "activate") {
        event.waitUntil(self.skipWaiting());
        return;
    }
    const download = type === messagePrefix + "download";
    if (!download && type !== messagePrefix + "status") return;
    const port = event.ports[0];
    if (!port) return;
    event.waitUntil(offlineStatus(options, download)
        .then((status) => port.postMessage(status))
        .catch((failure) => {
            const error = ["invalidSelection", "missingCatalog"].includes(failure?.message)
                ? failure.message
                : "storage";
            port.postMessage({ ready: false, missing: [], error });
        }));
});
