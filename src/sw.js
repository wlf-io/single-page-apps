const CACHE = "spas-dev";

// CACHE_START
const PRECACHE = [];
// CACHE_END

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
        const index = await cache.match("/index.html");
        if (index) await cache.put("/", index.clone());
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(fromCache(event));
});

async function fromCache(event) {
    const request = event.request;
    const navigate = request.mode === "navigate";
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: navigate });
    if (cached) return cached;
    try {
        const response = await fetch(request);
        if (response.status === 200 && response.type === "basic") {
            event.waitUntil(cache.put(request, response.clone()));
        }
        return response;
    } catch (err) {
        const fallback = navigate && await cache.match("/");
        if (fallback) return fallback;
        throw err;
    }
}
