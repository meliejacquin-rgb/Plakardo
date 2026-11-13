// Service worker : l'app s'ouvre même sans réseau.
// Changer VERSION à chaque mise à jour publiée.
const VERSION = "plakardo-v2-2-4";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "data.js",
  "engine.js",
  "scan.js",
  "codes.js",
  "firebase-config.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin || url.host === "www.gstatic.com" || url.host.endsWith("jsdelivr.net") || url.host.endsWith("fonts.googleapis.com") || url.host.endsWith("fonts.gstatic.com");
  if (!cacheable) return; // Firestore, connexion… : jamais intercepté

  // Réseau d'abord pour l'app (mises à jour immédiates), cache si hors ligne.
  e.respondWith(
    fetch(sameOrigin ? new Request(req, { cache: "no-cache" }) : req)
      .then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: sameOrigin }).then((hit) => hit || caches.match("index.html")))
  );
});
