self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
    event.waitUntil(retire());
});

async function retire() {
    try {
        const names = await caches.keys();
        await Promise.all(names
            .filter((name) => name.startsWith("imposter-shell-") || name.startsWith("imposter-content-"))
            .map((name) => caches.delete(name)));
    } finally {
        await self.registration.unregister();
    }
}
