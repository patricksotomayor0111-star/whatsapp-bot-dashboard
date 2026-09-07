const CACHE_NAME = "bot-panel-v3";
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
    // Lo que hay que saber para actuar desde la propia notificación.
    data: { pendienteId: data.pendienteId || null },
  };

  // Si el aviso es por un pedido esperando decisión, la notificación trae
  // los botones para resolverlo sin abrir la app: con el celular
  // bloqueado, un toque y sale el "Voy". Ese es todo el punto — el cuello
  // de botella no es el bot, es el rato hasta que uno llega al panel.
  if (data.pendienteId) {
    options.actions = [
      { action: "marcar", title: "Marcar" },
      { action: "ignorar", title: "Ignorar" },
    ];
    options.requireInteraction = true; // que no se vaya sola antes de decidir
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

// Avisa el resultado de la acción. Sin esto uno toca "Marcar" y se queda
// sin saber si salió o no, que es peor que no tener el botón.
function avisar(titulo, cuerpo) {
  return self.registration.showNotification(titulo, {
    body: cuerpo,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "resultado-accion", // reemplaza el aviso anterior en vez de apilar
  });
}

async function resolverPendiente(accion, pendienteId) {
  const ruta =
    accion === "marcar"
      ? `/api/pending-time-matches/${pendienteId}/marcar`
      : `/api/pending-time-matches/${pendienteId}/cancel`;
  try {
    // credentials: "include" para que viaje la cookie de sesión del panel
    // (es HttpOnly y SameSite=Lax, así que en una petición al mismo sitio
    // el navegador la manda solo).
    const res = await fetch(ruta, { method: "POST", credentials: "include" });
    if (res.status === 401) {
      return avisar("Sesión vencida", "Abre el panel y vuelve a entrar para poder marcar desde aquí.");
    }
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) return avisar("No se pudo", datos.error || "Intenta desde el panel.");
    return avisar(
      accion === "marcar" ? "✅ Pedido marcado" : "Pedido descartado",
      accion === "marcar" ? "Se mandó el mensaje al grupo." : "No se va a marcar."
    );
  } catch (err) {
    return avisar("No se pudo", "Sin conexión. Intenta desde el panel.");
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const pendienteId = event.notification.data?.pendienteId;

  if (pendienteId && (event.action === "marcar" || event.action === "ignorar")) {
    event.waitUntil(resolverPendiente(event.action, pendienteId));
    return;
  }

  // Tocar el cuerpo de la notificación (no un botón) abre el panel.
  event.waitUntil(self.clients.openWindow("/"));
});
