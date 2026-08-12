const CACHE = "hex-studio-v2";
const CORE = [
  "/",
  "/index.html",
  "/css/hex.css",
  "/js/app.js",
  "/js/state.js",
  "/js/ui.js",
  "/js/farm.js",
  "/js/views.js",
  "/js/scanner.js",
  "/js/scan-worker.js",
  "/js/apk.js",
  "/js/bridge.js",
  "/lib/scanner.js",
  "/manifest.webmanifest",
  "/assets/logo-hex.png",
  "/assets/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname === "/bridge") return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit || caches.match("/index.html"));
      return hit || net;
    })
  );
});
