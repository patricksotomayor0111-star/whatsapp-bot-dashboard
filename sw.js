const CACHE_NAME = "bot-panel-v2";
const CORE_ASSETS = ["/", "/styles.css", "/script.js", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// La API (/api/*) siempre va a la red: es información en vivo del bot,
// nunca debe servirse desde caché.
//
// El resto (HTML/CSS/JS) usa "red primero": el panel se actualiza seguido,
// así que siempre se pide la versión más nueva al servidor. Solo se cae al
// caché si no hay conexión (modo offline).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Notificaciones push: el servidor manda esto cuando el bot responde un
// mensaje, para avisarte aunque tengas el celular bloqueado o estés en
// otra app.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = {};
  }
  const title = data.title || "🤖 Bot Panel";
  const options = {
    body: data.body || "El bot respondió un mensaje.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/"));
});
