const CACHE_NAME = "bot-panel-v5";
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
    data: {
      pendienteId: data.pendienteId || null,
      frenadoId: data.frenadoId || null,
      groupName: data.groupName || "",
    },
  };

  // Si el aviso es por un pedido esperando decisión, la notificación trae
  // el botón para marcarlo sin abrir la app: con el celular bloqueado, un
  // toque y sale el "Voy". Ese es todo el punto — el cuello de botella no
  // es el bot, es el rato hasta que uno llega al panel.
  //
  // Va UN SOLO botón a propósito. Antes había también "Ignorar", que
  // borraba el pedido de una: Patrick le dio a "Marcar" dos veces y las
  // dos salió "Pedido descartado", o sea que el pedido se perdía por un
  // toque en la pantalla de bloqueo. Con un solo botón, errarle no puede
  // borrar nada — lo peor que pasa es que no ocurra nada. Descartar sigue
  // estando en el panel, con la ✕, donde se ve bien qué se está borrando.
  if (data.pendienteId) {
    options.actions = [{ action: "marcar", title: "✅ Marcar" }];
    options.requireInteraction = true; // que no se vaya sola antes de decidir
  }

  // Aviso de que el filtro de IA frenó un mensaje. Mismo criterio: UN solo
  // botón y que no pueda borrar nada. Tocarlo corrige la memoria para
  // siempre y, si todavía está a tiempo, manda el "Voy".
  if (data.frenadoId) {
    options.actions = [{ action: "era-pedido", title: "✅ Sí era pedido" }];
    options.requireInteraction = true;
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

// Solo marca. No hay ninguna acción que borre desde la notificación: si
// el botón se toca por error, o el celular reporta otra cosa, lo peor que
// puede pasar es que se mande el "Voy" — nunca que se pierda un pedido.
async function marcarDesdeNotificacion(pendienteId, groupName) {
  const detalle = groupName || "Revisa el panel.";
  try {
    // credentials: "include" para que viaje la cookie de sesión del panel
    // (es HttpOnly y SameSite=Lax, así que en una petición al mismo sitio
    // el navegador la manda solo).
    const res = await fetch(`/api/pending-time-matches/${pendienteId}/marcar`, {
      method: "POST",
      credentials: "include",
    });
    if (res.status === 401) {
      return avisar("Sesión vencida", "Abre el panel y vuelve a entrar para poder marcar desde aquí.");
    }
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) return avisar("No se pudo marcar", datos.error || "Intenta desde el panel.");
    // Se dice de QUÉ pedido fue: antes solo decía "Pedido marcado" y no se
    // sabía cuál, así que no había forma de notar si se toco el que no era.
    return avisar("✅ Pedido marcado", detalle);
  } catch (err) {
    return avisar("No se pudo marcar", "Sin conexión. Intenta desde el panel.");
  }
}

// "Sí era pedido": el filtro se equivocó. Corrige la memoria y, si todavía
// está a tiempo, sale el "Voy". Tampoco puede borrar nada.
async function corregirFrenado(frenadoId, groupName) {
  try {
    const res = await fetch(`/api/ai-blocked/${frenadoId}/marcar`, {
      method: "POST",
      credentials: "include",
    });
    if (res.status === 401) {
      return avisar("Sesión vencida", "Abre el panel y vuelve a entrar para poder corregir desde aquí.");
    }
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) return avisar("No se pudo corregir", datos.error || "Intenta desde el panel.");
    // Se distingue a propósito: corregir la memoria siempre funciona, pero
    // mandar el "Voy" puede llegar tarde. Sin esta diferencia uno cree que
    // salió el mensaje cuando en realidad solo se aprendió la lección.
    return datos.marcado
      ? avisar("✅ Marcado", `${groupName || "Pedido"} — y el filtro ya no se equivoca con esa frase.`)
      : avisar("Corregido, pero sin marcar", `${datos.motivo || "Ya no se pudo marcar."} El filtro ya aprendió que sí es pedido.`);
  } catch (err) {
    return avisar("No se pudo corregir", "Sin conexión. Intenta desde el panel.");
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { pendienteId, frenadoId, groupName } = event.notification.data || {};

  if (frenadoId && event.action) {
    event.waitUntil(corregirFrenado(frenadoId, groupName));
    return;
  }

  // Cualquier botón de un aviso de pedido marca. Hoy solo existe "marcar",
  // pero se acepta cualquier acción a propósito: si el celular reportara
  // otro nombre, el resultado sigue siendo el correcto y no destructivo.
  if (pendienteId && event.action) {
    event.waitUntil(marcarDesdeNotificacion(pendienteId, groupName));
    return;
  }

  // Tocar el cuerpo de la notificación (no un botón) abre el panel.
  event.waitUntil(self.clients.openWindow("/"));
});
