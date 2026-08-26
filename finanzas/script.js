/* =========================================
   Finanzas — Panel independiente (WhatsApp secundario)
   ========================================= */

// Cuando la sesión vence, el servidor responde 401 a todo. Sin esto el
// panel se quedaría mostrando datos viejos y fallando en silencio, así que
// se vuelve a la pantalla de entrada apenas pasa.
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (...args) => {
  const respuesta = await fetchOriginal(...args);
  if (respuesta.status === 401) window.location.href = "/login";
  return respuesta;
};

// ---------- Referencias del DOM ----------
const qrCard = document.getElementById("qrCard");
const qrCanvas = document.getElementById("qrCanvas");
const qrHint = document.getElementById("qrHint");

const statGanancias = document.getElementById("statGanancias");
const statGastos = document.getElementById("statGastos");
const statTotal = document.getElementById("statTotal");
const statCaja = document.getElementById("statCaja");
const statEsperado = document.getElementById("statEsperado");
const statAnaGuardado = document.getElementById("statAnaGuardado");
const statAnaGastado = document.getElementById("statAnaGastado");
const statAnaSaldo = document.getElementById("statAnaSaldo");

const botStatusText = document.getElementById("botStatusText");
const logoutBtn = document.getElementById("logoutBtn");
const openReminders = document.getElementById("openReminders");

const togglePushBtn = document.getElementById("togglePushBtn");
const pushStatus = document.getElementById("pushStatus");

let isConnected = false;
let lastRenderedQr = null;
// Para no pedir arrancar el bot en cada vuelta del polling.
let vinculacionPedida = false;
let qrInstance = null;

// ---------- Caja chica (Ganancias/Gastos del grupo "GANANCIAS") ----------
function formatSoles(n) {
  return "S/ " + Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

async function fetchCashboxToday() {
  try {
    const res = await fetch("/api/cashbox/today");
    const data = await res.json();
    statGanancias.textContent = formatSoles(data.ganancias);
    statGastos.textContent = "-" + formatSoles(data.gastos);
    statTotal.textContent = formatSoles(data.total);
    statCaja.textContent = formatSoles(data.caja);
    statEsperado.textContent = formatSoles(data.esperado);
    if (data.custodia) {
      statAnaGuardado.textContent = formatSoles(data.custodia.guardado);
      statAnaGastado.textContent = "-" + formatSoles(data.custodia.gastado);
      statAnaSaldo.textContent = formatSoles(data.custodia.saldo);
    }
  } catch (err) {
    console.error("No se pudo obtener la caja chica del día:", err);
  }
}


// ---------- Estado real del bot ----------
function updateBotUI() {
  if (!isConnected) {
    botStatusText.textContent = "Bot ⛔ Desconectado";
    qrCard.classList.remove("hidden");
  } else {
    botStatusText.textContent = "Bot ✅ Conectado";
    qrCard.classList.add("hidden");
  }
}

// Desvincula WhatsApp por completo (hay que volver a escanear el QR)
logoutBtn.addEventListener("click", async () => {
  const confirmado = confirm("¿Desvincular WhatsApp? Tendrás que escanear el QR de nuevo.");
  if (!confirmado) return;
  try {
    await fetch("/api/bot/logout", { method: "POST" });
  } catch (err) {
    console.error("No se pudo desvincular:", err);
  }
});

// ---------- Polling de estado (conexión + QR) ----------
async function pollStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    isConnected = Boolean(data.connected);

    if (isConnected) {
      qrHint.textContent = "";
      lastRenderedQr = null;
      if (vinculacionPedida) fetchChatConfig(); // acaba de conectar: ya hay grupos
      vinculacionPedida = false;
    } else if (data.qr && data.qr !== lastRenderedQr) {
      lastRenderedQr = data.qr;
      qrHint.textContent = "Escanea antes de que expire (se renueva solo).";
      try {
        if (!qrInstance) {
          qrCanvas.innerHTML = "";
          qrInstance = new QRCode(qrCanvas, {
            text: data.qr,
            width: 220,
            height: 220,
            correctLevel: QRCode.CorrectLevel.M,
          });
        } else {
          qrInstance.makeCode(data.qr);
        }
      } catch (err) {
        console.error("No se pudo generar el QR (¿falló el CDN?):", err);
      }
    } else if (!data.qr) {
      // Una cuenta que todavía no vinculó su WhatsApp no tiene bot
      // levantado, así que nunca llegaría un QR sola. Se pide arrancarlo
      // una vez y a partir de ahí el QR aparece por el polling normal.
      if (!vinculacionPedida) {
        vinculacionPedida = true;
        fetch("/api/bot/vincular", { method: "POST" }).catch(() => {});
      }
      qrHint.textContent = "Esperando código QR del servidor…";
    }

    updateBotUI();
  } catch (err) {
    console.error("No se pudo consultar el estado del bot:", err);
  }
}

// ---------- Notificaciones push ----------
// Convierte la clave pública VAPID (base64 url-safe) al formato que
// necesita pushManager.subscribe().
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function updatePushStatus() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    pushStatus.textContent = "Tu navegador no soporta notificaciones push.";
    togglePushBtn.disabled = true;
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub && Notification.permission === "granted") {
      togglePushBtn.textContent = "🔕 Desactivar notificaciones";
      pushStatus.textContent = "Notificaciones activadas en este dispositivo.";
    } else {
      togglePushBtn.textContent = "🔔 Activar notificaciones";
      pushStatus.textContent = "Notificaciones desactivadas en este dispositivo.";
    }
  } catch (err) {
    console.error("No se pudo consultar el estado de las notificaciones:", err);
  }
}

togglePushBtn.addEventListener("click", async () => {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const reg = await navigator.serviceWorker.ready;
  const existingSub = await reg.pushManager.getSubscription();

  if (existingSub) {
    try {
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: existingSub.endpoint }),
      });
      await existingSub.unsubscribe();
    } catch (err) {
      console.error("No se pudo desactivar las notificaciones:", err);
    }
    await updatePushStatus();
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    pushStatus.textContent = "No diste permiso de notificaciones en el navegador.";
    return;
  }

  try {
    const keyRes = await fetch("/api/push/vapid-public-key");
    const { publicKey } = await keyRes.json();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub }),
    });
    await updatePushStatus();
  } catch (err) {
    console.error("No se pudo activar las notificaciones:", err);
    pushStatus.textContent = "No se pudo activar. Probá de nuevo.";
  }
});

// ---------- Tutorial de bienvenida ----------
// Sin esto, alguien que abre la app por primera vez ve pantallas vacías y
// no tiene forma de adivinar que todo se registra escribiendo por
// WhatsApp. Los pasos 2 y 3 muestran el estado real (si ya vinculó, si ya
// eligió su chat), así sirve también de lista de pendientes.
const tutorialOverlay = document.getElementById("tutorialOverlay");
const tutorialIcono = document.getElementById("tutorialIcono");
const tutorialTitulo = document.getElementById("tutorialTitulo");
const tutorialCuerpo = document.getElementById("tutorialCuerpo");
const tutorialPuntos = document.getElementById("tutorialPuntos");
const tutorialAtras = document.getElementById("tutorialAtras");
const tutorialSiguiente = document.getElementById("tutorialSiguiente");
const tutorialSaltar = document.getElementById("tutorialSaltar");

let pasoTutorial = 0;

const PASOS_TUTORIAL = [
  {
    icono: "👋",
    titulo: "Anota tu plata escribiendo",
    cuerpo: () => [
      "No tienes que llenar formularios. Escribes en WhatsApp como siempre y acá se registra solo.",
      "Después ves cuánto ganaste, cuánto gastaste y cuánto te queda limpio.",
    ],
  },
  {
    icono: "🔗",
    titulo: "Vincula tu WhatsApp",
    cuerpo: () =>
      isConnected
        ? ["✅ Ya está vinculado. Puedes seguir."]
        : [
            "Arriba de esta pantalla te aparece un código QR.",
            "Ábrelo desde tu WhatsApp: Ajustes → Dispositivos vinculados → Vincular un dispositivo.",
            "Si todavía no aparece, espera unos segundos.",
          ],
  },
  {
    icono: "💬",
    titulo: "Elige dónde vas a anotar",
    cuerpo: () => [
      "En la tarjeta «Dónde anotas tus repartos» eliges el chat donde vas a escribir.",
      "Si trabajas solo, lo más cómodo es usar tus propios mensajes de WhatsApp: no tienes que crear ningún grupo.",
      "El bot solo lee ese chat, nada más.",
    ],
  },
  {
    icono: "✍️",
    titulo: "Cómo se anota",
    cuerpo: () => [
      "<b>Un ingreso:</b> escribe el monto y de dónde vino.<br><span class='text-slate-800 font-mono text-xs'>7 bumanguesa</span>",
      "<b>Un gasto:</b> igual, pero empezando con «menos».<br><span class='text-slate-800 font-mono text-xs'>menos 20 gasolina</span>",
      "Puedes poner varios en un mismo mensaje, uno por línea.",
    ],
  },
  {
    icono: "🎯",
    titulo: "Dos cosas para después",
    cuerpo: () => [
      "En <b>Presupuesto</b>, marca cada gasto como 🛵 negocio o 🏠 personal. Recién ahí sabrás tu ganancia real.",
      "En <b>Locales</b>, arma la lista de quiénes te dan trabajo para ver cuál te conviene más.",
      "Listo, ya puedes empezar.",
    ],
  },
];

function pintarTutorial() {
  const paso = PASOS_TUTORIAL[pasoTutorial];
  tutorialIcono.textContent = paso.icono;
  tutorialTitulo.textContent = paso.titulo;
  tutorialCuerpo.innerHTML = paso.cuerpo().map((p) => `<p>${p}</p>`).join("");

  tutorialPuntos.innerHTML = "";
  PASOS_TUTORIAL.forEach((_, i) => {
    const punto = document.createElement("span");
    punto.className = "w-1.5 h-1.5 rounded-full " + (i === pasoTutorial ? "bg-brand-green" : "bg-slate-200");
    tutorialPuntos.appendChild(punto);
  });

  tutorialAtras.classList.toggle("hidden", pasoTutorial === 0);
  tutorialSiguiente.textContent = pasoTutorial === PASOS_TUTORIAL.length - 1 ? "Empezar" : "Siguiente";
}

async function cerrarTutorial() {
  tutorialOverlay.classList.add("hidden");
  tutorialOverlay.classList.remove("flex");
  try {
    await fetch("/api/tutorial-visto", { method: "POST" });
  } catch (err) {
    // si falla, en la próxima entrada se vuelve a mostrar: no es grave
  }
}

function abrirTutorial() {
  pasoTutorial = 0;
  pintarTutorial();
  tutorialOverlay.classList.remove("hidden");
  tutorialOverlay.classList.add("flex");
}

tutorialSiguiente.addEventListener("click", () => {
  if (pasoTutorial === PASOS_TUTORIAL.length - 1) return cerrarTutorial();
  pasoTutorial++;
  pintarTutorial();
});
tutorialAtras.addEventListener("click", () => {
  if (pasoTutorial > 0) pasoTutorial--;
  pintarTutorial();
});
tutorialSaltar.addEventListener("click", cerrarTutorial);

// ---------- Dónde escucha el bot de esta cuenta ----------
const chatConfigCard = document.getElementById("chatConfigCard");
const chatCajaSelect = document.getElementById("chatCajaSelect");
const chatConfigHint = document.getElementById("chatConfigHint");

async function fetchChatConfig() {
  let data;
  try {
    data = await (await fetch("/api/bot/chats")).json();
  } catch (err) {
    return;
  }

  const chats = data.chats || [];
  // Sin WhatsApp vinculado todavía no hay chats que ofrecer: no tiene
  // sentido mostrar un desplegable vacío.
  chatConfigCard.classList.toggle("hidden", chats.length === 0);
  if (chats.length === 0) return;

  chatCajaSelect.innerHTML = "";
  const sinElegir = document.createElement("option");
  sinElegir.value = "";
  sinElegir.textContent = "— Grupo llamado GANANCIAS (por defecto) —";
  chatCajaSelect.appendChild(sinElegir);

  chats.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.nombre;
    chatCajaSelect.appendChild(opt);
  });
  chatCajaSelect.value = data.chatCaja || "";

  const elegido = chats.find((c) => c.id === data.chatCaja);
  chatConfigHint.textContent = elegido
    ? `Escribe en "${elegido.nombre}" y se registra solo.`
    : "Ahora mismo el bot busca un grupo llamado GANANCIAS. Puedes elegir otro chat acá.";
}

chatCajaSelect.addEventListener("change", async () => {
  await fetch("/api/bot/chats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatCaja: chatCajaSelect.value || null }),
  });
  fetchChatConfig();
});

// ---------- Marca de la app (nombre y logo, iguales para todos) ----------
const marcaIconoPreview = document.getElementById("marcaIconoPreview");
const marcaIconoInput = document.getElementById("marcaIconoInput");
const quitarMarcaIconoBtn = document.getElementById("quitarMarcaIconoBtn");
const marcaNombre = document.getElementById("marcaNombre");
const marcaDescripcion = document.getElementById("marcaDescripcion");
const guardarMarcaBtn = document.getElementById("guardarMarcaBtn");

function aplicarMarca(m) {
  // El nombre se pinta en la cabecera y en la pestaña del navegador, para
  // que el cambio se vea sin tener que reinstalar nada.
  const titulo = document.querySelector("header h1");
  if (titulo) titulo.textContent = m.nombre;
  document.title = m.nombre;
  marcaNombre.value = m.nombre;
  marcaDescripcion.value = m.descripcion;
  quitarMarcaIconoBtn.classList.toggle("hidden", !m.tieneIcono);
  // El "?t" obliga al navegador a volver a pedir el logo en vez de usar
  // el que tenía guardado.
  marcaIconoPreview.src = `/icon-192.png?t=${Date.now()}`;
}

async function fetchMarca() {
  try {
    aplicarMarca(await (await fetch("/api/marca")).json());
  } catch (err) {
    console.error("No se pudo obtener la marca:", err);
  }
}

guardarMarcaBtn.addEventListener("click", async () => {
  const res = await fetch("/api/marca", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre: marcaNombre.value, descripcion: marcaDescripcion.value }),
  });
  const data = await res.json();
  if (!data.ok) {
    alert(data.error || "No se pudo guardar.");
    return;
  }
  aplicarMarca(data.marca);
  alert("Marca actualizada.");
});

marcaIconoInput.addEventListener("change", async () => {
  const archivo = marcaIconoInput.files[0];
  if (!archivo) return;
  const lector = new FileReader();
  lector.onload = async () => {
    const res = await fetch("/api/marca/icono", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icono: lector.result }),
    });
    const data = await res.json();
    if (!data.ok) {
      alert(data.error || "No se pudo subir el logo.");
      return;
    }
    marcaIconoInput.value = "";
    aplicarMarca(data.marca);
  };
  lector.readAsDataURL(archivo);
});

quitarMarcaIconoBtn.addEventListener("click", async () => {
  const data = await (await fetch("/api/marca/icono", { method: "DELETE" })).json();
  aplicarMarca(data.marca);
});

// ---------- Cuentas de usuario (solo el dueño) ----------
const openCuentas = document.getElementById("openCuentas");
const cuentasOverlay = document.getElementById("cuentasOverlay");
const closeCuentas = document.getElementById("closeCuentas");
const cuentasList = document.getElementById("cuentasList");
const cuentaNuevoNombre = document.getElementById("cuentaNuevoNombre");
const cuentaNuevoUsuario = document.getElementById("cuentaNuevoUsuario");
const cuentaNuevoPassword = document.getElementById("cuentaNuevoPassword");
const addCuentaBtn = document.getElementById("addCuentaBtn");
const sesionActual = document.getElementById("sesionActual");
const salirPanelBtn = document.getElementById("salirPanelBtn");

let sesion = null;

async function fetchSesion() {
  try {
    sesion = await (await fetch("/api/sesion")).json();
    // El botón de cuentas solo existe para el dueño: un cliente no tiene
    // por qué ver ni administrar las demás cuentas.
    document.getElementById("seccionDueno").classList.toggle("hidden", !sesion.esDueno);
    if (!sesion.tutorialVisto) abrirTutorial();
    sesionActual.textContent = `Estás dentro como ${sesion.nombre} (${sesion.usuario}).`;
  } catch (err) {
    console.error("No se pudo obtener la sesión:", err);
  }
}

async function renderCuentas() {
  let lista;
  try {
    lista = (await (await fetch("/api/usuarios")).json()).usuarios || [];
  } catch (err) {
    cuentasList.innerHTML = '<p class="text-sm text-slate-400">No se pudo cargar.</p>';
    return;
  }

  cuentasList.innerHTML = "";
  lista.forEach((u) => {
    const card = document.createElement("div");
    card.className = "rounded-xl border p-3 " + (u.activo ? "bg-white border-slate-200" : "bg-slate-50 border-slate-200 opacity-70");

    const top = document.createElement("div");
    top.className = "flex items-start justify-between gap-2";
    const info = document.createElement("div");
    info.className = "min-w-0";
    const nombre = document.createElement("p");
    nombre.className = "text-sm font-semibold text-slate-800 break-words";
    nombre.textContent = u.nombre + (u.esDueno ? " 👑" : "");
    const detalle = document.createElement("p");
    detalle.className = "text-xs text-slate-400 mt-0.5";
    detalle.textContent = `entra como "${u.usuario}"${u.activo ? "" : " · desactivada"}`;
    info.appendChild(nombre);
    info.appendChild(detalle);
    top.appendChild(info);

    const acciones = document.createElement("div");
    acciones.className = "flex items-center gap-1 shrink-0";

    const btnClave = document.createElement("button");
    btnClave.className = "w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 active:scale-90 transition-all";
    btnClave.title = "Cambiar contraseña";
    btnClave.innerHTML = '<i class="fa-solid fa-key"></i>';
    btnClave.addEventListener("click", async () => {
      const nueva = prompt(`Nueva contraseña para ${u.nombre} (mínimo 6 caracteres):`);
      if (nueva === null) return;
      const res = await fetch(`/api/usuarios/${encodeURIComponent(u.id)}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: nueva }),
      });
      const data = await res.json();
      alert(data.ok ? "Contraseña cambiada." : data.error || "No se pudo cambiar.");
      // Al dueño le cambia SU propia clave de entrada: conviene avisarlo.
      if (data.ok && u.esDueno) alert("Ojo: esa es tu propia contraseña. Úsala la próxima vez que entres.");
    });
    acciones.appendChild(btnClave);

    if (!u.esDueno) {
      const btnActivo = document.createElement("button");
      btnActivo.className = "w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 active:scale-90 transition-all";
      btnActivo.title = u.activo ? "Desactivar" : "Activar";
      btnActivo.innerHTML = u.activo ? '<i class="fa-solid fa-toggle-on text-brand-green"></i>' : '<i class="fa-solid fa-toggle-off"></i>';
      btnActivo.addEventListener("click", async () => {
        await fetch(`/api/usuarios/${encodeURIComponent(u.id)}/activo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activo: !u.activo }),
        });
        renderCuentas();
      });
      acciones.appendChild(btnActivo);

      const btnDel = document.createElement("button");
      btnDel.className = "w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-brand-red active:scale-90 transition-all";
      btnDel.title = "Eliminar";
      btnDel.innerHTML = '<i class="fa-solid fa-trash"></i>';
      btnDel.addEventListener("click", async () => {
        if (!confirm(`¿Eliminar la cuenta de ${u.nombre}?\n\nSus datos NO se borran: quedan guardados por si la quieres recuperar.`)) return;
        await fetch(`/api/usuarios/${encodeURIComponent(u.id)}`, { method: "DELETE" });
        renderCuentas();
      });
      acciones.appendChild(btnDel);
    }

    top.appendChild(acciones);
    card.appendChild(top);
    cuentasList.appendChild(card);
  });
}

addCuentaBtn.addEventListener("click", async () => {
  const nombre = cuentaNuevoNombre.value.trim();
  const usuario = cuentaNuevoUsuario.value.trim();
  const password = cuentaNuevoPassword.value;
  if (!usuario || !password) {
    alert("Completa el usuario y la contraseña.");
    return;
  }
  const res = await fetch("/api/usuarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre, usuario, password }),
  });
  const data = await res.json();
  if (!data.ok) {
    alert(data.error || "No se pudo crear la cuenta.");
    return;
  }
  alert(`Cuenta creada. ${nombre || usuario} entra con el usuario "${data.usuario.usuario}" y la contraseña que pusiste.`);
  cuentaNuevoNombre.value = "";
  cuentaNuevoUsuario.value = "";
  cuentaNuevoPassword.value = "";
  renderCuentas();
});

document.getElementById("verTutorialBtn").addEventListener("click", () => {
  cuentasOverlay.classList.add("hidden");
  cuentasOverlay.classList.remove("flex");
  abrirTutorial();
});

salirPanelBtn.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login";
});

openCuentas.addEventListener("click", () => {
  cuentasOverlay.classList.remove("hidden");
  cuentasOverlay.classList.add("flex");
  if (sesion && sesion.esDueno) renderCuentas();
});

closeCuentas.addEventListener("click", () => {
  cuentasOverlay.classList.add("hidden");
  cuentasOverlay.classList.remove("flex");
});

// ---------- Pendientes (recordatorios de pago) ----------
const remindersOverlay = document.getElementById("remindersOverlay");
const closeReminders = document.getElementById("closeReminders");
const remindersList = document.getElementById("remindersList");
const reminderBadge = document.getElementById("reminderBadge");
const newReminderLabel = document.getElementById("newReminderLabel");
const newReminderMonto = document.getElementById("newReminderMonto");
const newReminderTipo = document.getElementById("newReminderTipo");
const newReminderWeekday = document.getElementById("newReminderWeekday");
const newReminderDay = document.getElementById("newReminderDay");
const newReminderDate = document.getElementById("newReminderDate");
const addReminderBtn = document.getElementById("addReminderBtn");

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function fmtFecha(label) {
  if (!label) return "";
  const [y, mo, d] = label.split("-");
  return `${d}/${mo}`;
}

function textoCuando(r) {
  if (r.tipo === "semanal") return "Cada " + (DIAS_SEMANA[r.dia] || "?");
  if (r.tipo === "mensual_dia") return "Día " + r.dia + " de cada mes";
  if (r.tipo === "mensual_finmes") return "Fin de cada mes";
  if (r.tipo === "unica") return "Una vez: " + fmtFecha(r.fecha);
  return "";
}

function actualizarBadges(cantidad) {
  if (!reminderBadge) return;
  if (cantidad > 0) {
    reminderBadge.textContent = cantidad;
    reminderBadge.classList.remove("hidden");
  } else {
    reminderBadge.classList.add("hidden");
  }
}

async function fetchReminderBadge() {
  try {
    const res = await fetch("/api/reminders");
    const data = await res.json();
    actualizarBadges((data.pendientes || []).length);
  } catch (err) {
    // silencioso: si falla, simplemente no toca el badge
  }
}

async function renderReminders() {
  let data;
  try {
    const res = await fetch("/api/reminders");
    data = await res.json();
  } catch (err) {
    remindersList.innerHTML = '<p class="text-sm text-slate-400">No se pudo cargar.</p>';
    return;
  }
  const lista = data.reminders || [];
  actualizarBadges((data.pendientes || []).length);
  remindersList.innerHTML = "";

  lista.forEach((r) => {
    const card = document.createElement("div");
    const pendiente = r.activo && r.pendiente;
    card.className =
      "rounded-xl border p-3 " +
      (!r.activo
        ? "bg-slate-50 border-slate-200 opacity-70"
        : pendiente
        ? "bg-red-50 border-red-200"
        : "bg-white border-slate-200");

    let estado;
    if (!r.activo) estado = "Desactivado";
    else if (pendiente) estado = `⚠️ Pendiente · vence ${fmtFecha(r.vence)}`;
    else estado = `Al día · próximo ${fmtFecha(r.proxima)}`;

    const top = document.createElement("div");
    top.className = "flex items-start justify-between gap-2";
    top.innerHTML = `
      <div class="min-w-0">
        <p class="text-sm font-semibold text-slate-800 truncate">${r.label} <span class="text-slate-500 font-normal">S/ ${r.monto}</span></p>
        <p class="text-xs ${pendiente ? "text-brand-red font-medium" : "text-slate-400"} mt-0.5">${textoCuando(r)} · ${estado}</p>
      </div>`;

    const acciones = document.createElement("div");
    acciones.className = "flex items-center gap-1 shrink-0";

    if (pendiente) {
      const btnPay = document.createElement("button");
      btnPay.className = "rounded-lg px-2.5 py-1.5 text-xs font-semibold bg-brand-green text-white active:scale-95 transition-all whitespace-nowrap";
      btnPay.textContent = "✓ Ya pagué";
      btnPay.addEventListener("click", async () => {
        // Se pregunta el monto real porque algunos pagos varían mes a mes
        // (luz, agua): el configurado va como valor por defecto.
        const montoStr = prompt(`¿Cuánto pagaste de ${r.label}?`, r.monto);
        if (montoStr === null) return;
        const monto = parseFloat(montoStr);
        if (!Number.isFinite(monto) || monto <= 0) return;
        const res = await fetch(`/api/reminders/${encodeURIComponent(r.id)}/pagado`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ monto }),
        });
        const data = await res.json();
        if (data.registrado) {
          alert(`Registré el gasto de ${r.label} por S/ ${monto} en la caja.`);
        } else if (data.gastoExistente) {
          alert(`Ese gasto ya estaba registrado ("${data.gastoExistente.descripcion || "sin descripción"}"), no lo dupliqué.`);
        }
        renderReminders();
        renderHistorialPagos();
        fetchCashboxToday();
      });
      acciones.appendChild(btnPay);
    }

    const btnToggle = document.createElement("button");
    btnToggle.className = "w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 active:scale-90 transition-all";
    btnToggle.title = r.activo ? "Desactivar" : "Activar";
    btnToggle.innerHTML = r.activo ? '<i class="fa-solid fa-bell-slash"></i>' : '<i class="fa-solid fa-bell"></i>';
    btnToggle.addEventListener("click", async () => {
      await fetch(`/api/reminders/${encodeURIComponent(r.id)}/activo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !r.activo }),
      });
      renderReminders();
    });
    acciones.appendChild(btnToggle);

    // Si ya está pagado este ciclo, se puede deshacer (por si se marcó por
    // error, o el bot lo marcó solo desde el grupo y no correspondía).
    if (r.activo && !pendiente) {
      const btnUndo = document.createElement("button");
      btnUndo.className = "w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 active:scale-90 transition-all";
      btnUndo.title = "Marcar como NO pagado";
      btnUndo.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
      btnUndo.addEventListener("click", async () => {
        if (!confirm(`¿Volver a marcar "${r.label}" como pendiente?\n\nEl gasto que haya quedado en la caja no se borra: eso se corrige desde Movimientos.`)) return;
        await fetch(`/api/reminders/${encodeURIComponent(r.id)}/desmarcar`, { method: "POST" });
        renderReminders();
      });
      acciones.appendChild(btnUndo);
    }

    const historialContainer = document.createElement("div");
    historialContainer.className = "hidden space-y-1.5 mt-3 pt-3 border-t border-slate-100";

    const btnHistorial = document.createElement("button");
    btnHistorial.className = "w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 active:scale-90 transition-all";
    btnHistorial.title = "Ver historial de pagos";
    btnHistorial.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i>';
    let historialCargado = false;
    btnHistorial.addEventListener("click", async () => {
      const estabaOculto = historialContainer.classList.contains("hidden");
      if (estabaOculto) {
        historialContainer.classList.remove("hidden");
        if (!historialCargado) {
          await renderHistorialDePago(historialContainer, r.id);
          historialCargado = true;
        }
      } else {
        historialContainer.classList.add("hidden");
      }
    });
    acciones.appendChild(btnHistorial);

    const btnDel = document.createElement("button");
    btnDel.className = "w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-brand-red active:scale-90 transition-all";
    btnDel.title = "Eliminar";
    btnDel.innerHTML = '<i class="fa-solid fa-trash"></i>';
    btnDel.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar "${r.label}" de la lista?`)) return;
      await fetch(`/api/reminders/${encodeURIComponent(r.id)}`, { method: "DELETE" });
      renderReminders();
    });
    acciones.appendChild(btnDel);

    card.appendChild(top);
    top.appendChild(acciones);
    card.appendChild(historialContainer);
    remindersList.appendChild(card);
  });

  if (lista.length === 0) {
    remindersList.innerHTML = '<p class="text-sm text-slate-400">No hay pagos cargados.</p>';
  }
}

function updateNewReminderFields() {
  const tipo = newReminderTipo.value;
  newReminderWeekday.classList.toggle("hidden", tipo !== "semanal");
  newReminderDay.classList.toggle("hidden", tipo !== "mensual_dia");
  newReminderDate.classList.toggle("hidden", tipo !== "unica");
}

newReminderTipo.addEventListener("change", updateNewReminderFields);

addReminderBtn.addEventListener("click", async () => {
  const label = newReminderLabel.value.trim();
  const monto = newReminderMonto.value;
  const tipo = newReminderTipo.value;
  if (!label) {
    alert("Ponle un nombre al pago.");
    return;
  }
  const body = { label, monto, tipo };
  if (tipo === "semanal") body.dia = Number(newReminderWeekday.value);
  if (tipo === "mensual_dia") {
    const d = Number(newReminderDay.value);
    if (!d || d < 1 || d > 31) {
      alert("Indica un día del mes válido (1 a 31).");
      return;
    }
    body.dia = d;
  }
  if (tipo === "unica") {
    if (!newReminderDate.value) {
      alert("Elige la fecha del pago.");
      return;
    }
    body.fecha = newReminderDate.value;
  }
  try {
    await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    newReminderLabel.value = "";
    newReminderMonto.value = "";
    newReminderDay.value = "";
    newReminderDate.value = "";
    renderReminders();
  } catch (err) {
    console.error("No se pudo agregar el recordatorio:", err);
  }
});

// ---------- Historial de pagos marcados (¿quedaron registrados?) ----------
const historialPagosList = document.getElementById("historialPagosList");
const historialPagosEmpty = document.getElementById("historialPagosEmpty");

// Qué pasó con el gasto de ese pago, según por dónde se marcó.
function textoDetallePago(p) {
  if (p.origen === "grupo") return "lo escribiste en el grupo y marqué el pendiente solo";
  if (p.registrado) return "se registró en la caja (te lo habías olvidado)";
  return `ya estaba registrado${p.gastoExistente ? ` como "${p.gastoExistente}"` : ""}`;
}

async function renderHistorialPagos() {
  let data;
  try {
    const res = await fetch("/api/reminders/historial");
    data = await res.json();
  } catch (err) {
    historialPagosList.innerHTML = '<p class="text-sm text-slate-400">No se pudo cargar.</p>';
    return;
  }
  const lista = data.historial || [];
  historialPagosList.innerHTML = "";
  historialPagosEmpty.classList.toggle("hidden", lista.length > 0);

  lista.forEach((p) => {
    const card = document.createElement("div");
    card.className = "rounded-xl border p-3 " + (p.registrado ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200");

    const titulo = document.createElement("p");
    titulo.className = "text-sm font-semibold text-slate-800 break-words";
    titulo.textContent = `${p.label} · ${formatSoles(p.monto)}`;

    const detalle = document.createElement("p");
    detalle.className = "text-xs mt-0.5 " + (p.registrado ? "text-emerald-700" : "text-slate-400");
    detalle.textContent = `${fmtFecha(p.fecha)} ${p.hora} · ${textoDetallePago(p)}`;

    card.appendChild(titulo);
    card.appendChild(detalle);
    historialPagosList.appendChild(card);
  });
}

// Historial de UN pago (se despliega dentro de su propia tarjeta): cada vez
// que se pagó, con fecha, hora y monto.
async function renderHistorialDePago(container, id) {
  let lista;
  try {
    const res = await fetch(`/api/reminders/historial?id=${encodeURIComponent(id)}`);
    const data = await res.json();
    lista = data.historial || [];
  } catch (err) {
    container.innerHTML = '<p class="text-xs text-slate-400">No se pudo cargar el historial.</p>';
    return;
  }

  container.innerHTML = "";
  if (lista.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "text-xs text-slate-400 text-center py-2";
    vacio.textContent = "Todavía no hay pagos registrados de este pendiente.";
    container.appendChild(vacio);
    return;
  }

  lista.forEach((p) => {
    const row = document.createElement("div");
    row.className = "rounded-lg px-3 py-2 text-xs bg-slate-50 border border-slate-100";

    const linea1 = document.createElement("p");
    linea1.className = "font-semibold text-slate-800";
    linea1.textContent = `${formatSoles(p.monto)} · ${fmtFecha(p.fecha)} ${p.hora}`;

    const linea2 = document.createElement("p");
    linea2.className = "text-slate-400 break-words";
    linea2.textContent = textoDetallePago(p);

    row.appendChild(linea1);
    row.appendChild(linea2);
    container.appendChild(row);
  });
}

// ---------- Tareas (pendientes sueltos sin monto, avisan cada 30 min) ----------
const tasksList = document.getElementById("tasksList");
const tasksEmpty = document.getElementById("tasksEmpty");
const newTaskTexto = document.getElementById("newTaskTexto");
const addTaskBtn = document.getElementById("addTaskBtn");

async function renderTasks() {
  let data;
  try {
    const res = await fetch("/api/tasks");
    data = await res.json();
  } catch (err) {
    tasksList.innerHTML = '<p class="text-sm text-slate-400">No se pudo cargar.</p>';
    return;
  }
  const lista = data.tasks || [];
  tasksList.innerHTML = "";
  tasksEmpty.classList.toggle("hidden", lista.length > 0);

  lista.forEach((t) => {
    const card = document.createElement("div");
    card.className = "rounded-xl border p-3 flex items-start justify-between gap-2 " + (t.confirmado ? "bg-slate-50 border-slate-200 opacity-70" : "bg-red-50 border-red-200");

    const info = document.createElement("div");
    info.className = "min-w-0";
    const texto = document.createElement("p");
    texto.className = "text-sm font-semibold text-slate-800 break-words" + (t.confirmado ? " line-through" : "");
    texto.textContent = t.texto;
    const meta = document.createElement("p");
    meta.className = "text-xs text-slate-400 mt-0.5";
    meta.textContent = t.confirmado ? "Hecha" : `Pendiente desde ${fmtFecha(t.creado)} · avisa cada 30 min`;
    info.appendChild(texto);
    info.appendChild(meta);

    const acciones = document.createElement("div");
    acciones.className = "flex items-center gap-1 shrink-0";

    const btnToggle = document.createElement("button");
    btnToggle.className = "rounded-lg px-2.5 py-1.5 text-xs font-semibold active:scale-95 transition-all whitespace-nowrap " + (t.confirmado ? "bg-slate-100 text-slate-500" : "bg-brand-green text-white");
    btnToggle.textContent = t.confirmado ? "↺ Reabrir" : "✓ Hecha";
    btnToggle.addEventListener("click", async () => {
      await fetch(`/api/tasks/${encodeURIComponent(t.id)}/${t.confirmado ? "reabrir" : "confirmar"}`, { method: "POST" });
      renderTasks();
    });
    acciones.appendChild(btnToggle);

    const btnEdit = document.createElement("button");
    btnEdit.className = "w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 active:scale-90 transition-all";
    btnEdit.title = "Editar";
    btnEdit.innerHTML = '<i class="fa-solid fa-pen"></i>';
    btnEdit.addEventListener("click", async () => {
      const nuevoTexto = prompt("Editar tarea:", t.texto);
      if (nuevoTexto === null || !nuevoTexto.trim()) return;
      await fetch(`/api/tasks/${encodeURIComponent(t.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: nuevoTexto }),
      });
      renderTasks();
    });
    acciones.appendChild(btnEdit);

    const btnDel = document.createElement("button");
    btnDel.className = "w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-brand-red active:scale-90 transition-all";
    btnDel.title = "Eliminar";
    btnDel.innerHTML = '<i class="fa-solid fa-trash"></i>';
    btnDel.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar "${t.texto}"?`)) return;
      await fetch(`/api/tasks/${encodeURIComponent(t.id)}`, { method: "DELETE" });
      renderTasks();
    });
    acciones.appendChild(btnDel);

    card.appendChild(info);
    card.appendChild(acciones);
    tasksList.appendChild(card);
  });
}

addTaskBtn.addEventListener("click", async () => {
  const texto = newTaskTexto.value.trim();
  if (!texto) return;
  try {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });
    newTaskTexto.value = "";
    renderTasks();
  } catch (err) {
    console.error("No se pudo agregar la tarea:", err);
  }
});

const statDeudasTotal = document.getElementById("statDeudasTotal");
const statFaltanteTotal = document.getElementById("statFaltanteTotal");

const financeTabButtons = document.querySelectorAll(".finance-tab-btn");
const financeTabPanels = document.querySelectorAll(".finance-tab-panel");

function showFinanceTab(tabId) {
  financeTabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.financeTab === tabId);
  });
  financeTabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== tabId);
  });
  if (tabId === "financeTabResumen") {
    fetchCashboxToday();
    fetchFinanceSummaryExtras();
  } else if (tabId === "financeTabMovimientos") {
    fetchDailyHistory();
    fetchMovimientos();
  } else if (tabId === "financeTabDeudas") {
    fetchDebts();
  } else if (tabId === "financeTabFaltantes") {
    fetchShortfalls();
  } else if (tabId === "financeTabLocales") {
    fetchLocales();
  } else if (tabId === "financeTabCuentas") {
    fetchAccountNames();
    fetchAccountEntries();
  } else if (tabId === "financeTabGraficos") {
    fetchGraficos();
  } else if (tabId === "financeTabMetas") {
    fetchGoalsAndProgress();
    fetchProductionGoals();
  } else if (tabId === "financeTabPresupuesto") {
    fetchBudgetCategories();
    fetchScheduledExpenses();
  } else if (tabId === "financeTabAna") {
    fetchCustodias();
  } else if (tabId === "financeTabConsultas") {
    fetchQueryIntents();
  } else if (tabId === "financeTabPrecios") {
    fetchPrices();
  }
}

financeTabButtons.forEach((btn) => {
  btn.addEventListener("click", () => showFinanceTab(btn.dataset.financeTab));
});

async function fetchFinanceSummaryExtras() {
  try {
    const [debtsRes, shortfallsRes] = await Promise.all([
      fetch("/api/finance/debts"),
      fetch("/api/finance/shortfalls"),
    ]);
    const debtsData = await debtsRes.json();
    const shortfallsData = await shortfallsRes.json();
    const totalDeudas = (debtsData.deudas || []).reduce((sum, d) => sum + Math.max(d.saldo, 0), 0);
    statDeudasTotal.textContent = formatSoles(totalDeudas);
    statFaltanteTotal.textContent = formatSoles(shortfallsData.total || 0);
  } catch (err) {
    console.error("No se pudo obtener el resumen de deudas/faltantes:", err);
  }
}

// ---------- Finanzas: Historial diario (un resumen por día, editable) ----------
const dailyHistoryList = document.getElementById("dailyHistoryList");
const dailyHistoryMoreBtn = document.getElementById("dailyHistoryMoreBtn");
const DAILY_HISTORY_PAGE = 5;

let dailyHistoryDias = [];
let dailyHistoryMostrarTodos = false;

function buildDailyHistoryRow(d) {
  const row = document.createElement("div");
  row.className = "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs bg-white border border-slate-100";

  const info = document.createElement("div");
  info.className = "min-w-0";
  const linea1 = document.createElement("p");
  linea1.className = "font-semibold text-slate-800";
  linea1.textContent = d.cerrado ? d.fecha : `${d.fecha} (hoy, en curso)`;
  const linea2 = document.createElement("p");
  linea2.className = "text-slate-500";
  linea2.textContent = `✅ ${formatSoles(d.ganancias)}  📉 ${formatSoles(d.gastos)}  🧮 ${formatSoles(d.caja)}  💵 ${formatSoles(d.esperado)}`;
  info.appendChild(linea1);
  info.appendChild(linea2);
  row.appendChild(info);

  if (d.cerrado) {
    const editBtn = document.createElement("button");
    editBtn.innerHTML = '<i class="fa-solid fa-pen text-slate-400"></i>';
    editBtn.className = "w-7 h-7 shrink-0 flex items-center justify-center";
    editBtn.addEventListener("click", async () => {
      const nuevaGananciaStr = prompt(`Ganancias del ${d.fecha}:`, d.ganancias);
      if (nuevaGananciaStr === null) return;
      const nuevoGastoStr = prompt(`Gastos del ${d.fecha}:`, d.gastos);
      if (nuevoGastoStr === null) return;
      const nuevaCajaStr = prompt(`Caja inicial del ${d.fecha}:`, d.caja);
      if (nuevaCajaStr === null) return;
      await fetch(`/api/finance/cierres/${d.fecha}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ganancias: parseFloat(nuevaGananciaStr) || 0,
          gastos: parseFloat(nuevoGastoStr) || 0,
          caja: parseFloat(nuevaCajaStr) || 0,
        }),
      });
      await fetchDailyHistory();
      fetchCashboxToday();
    });
    row.appendChild(editBtn);
  }

  return row;
}

function renderDiasList() {
  dailyHistoryList.innerHTML = "";
  const visibles = dailyHistoryMostrarTodos ? dailyHistoryDias : dailyHistoryDias.slice(0, DAILY_HISTORY_PAGE);
  visibles.forEach((d) => dailyHistoryList.appendChild(buildDailyHistoryRow(d)));

  const hayMas = dailyHistoryDias.length > DAILY_HISTORY_PAGE;
  dailyHistoryMoreBtn.classList.toggle("hidden", !hayMas || dailyHistoryMostrarTodos);
}

dailyHistoryMoreBtn.addEventListener("click", () => {
  dailyHistoryMostrarTodos = true;
  renderDiasList();
});

async function fetchDailyHistory() {
  try {
    const res = await fetch("/api/finance/history");
    const data = await res.json();
    const dias = (data.cierres || []).slice().reverse().map((c) => ({ ...c, cerrado: true }));
    if (data.hoy && data.hoy.fecha) dias.unshift({ ...data.hoy, cerrado: false });
    dailyHistoryDias = dias;
    dailyHistoryMostrarTodos = false;
    renderDiasList();
  } catch (err) {
    console.error("No se pudo obtener el historial diario:", err);
  }
}

// ---------- Finanzas: Movimientos (editar/eliminar/agregar, con filtros) ----------
const movFiltroDesde = document.getElementById("movFiltroDesde");
const movFiltroHasta = document.getElementById("movFiltroHasta");
const movFiltroTipo = document.getElementById("movFiltroTipo");
const movFiltroTexto = document.getElementById("movFiltroTexto");
const movimientosList = document.getElementById("movimientosList");
const movimientosEmpty = document.getElementById("movimientosEmpty");
const movNuevoTipo = document.getElementById("movNuevoTipo");
const movNuevoMonto = document.getElementById("movNuevoMonto");
const movNuevoDescripcion = document.getElementById("movNuevoDescripcion");
const movNuevoFecha = document.getElementById("movNuevoFecha");
const addMovimientoBtn = document.getElementById("addMovimientoBtn");

let movimientosData = [];
let categoriasParaSelector = [];

// Crea un <select> para asignar/mover la categoría de un gasto puntual.
// Se usa tanto en Movimientos como en Presupuesto > Ver gastos.
function crearSelectorCategoria(categoriaActualId, movIndex, categorias, onCambiado) {
  const select = document.createElement("select");
  select.className = "w-full bg-white rounded-lg px-2 py-1.5 text-xs border border-slate-200";
  categorias.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.label;
    if (c.id === categoriaActualId) opt.selected = true;
    select.appendChild(opt);
  });
  const optNueva = document.createElement("option");
  optNueva.value = "__nueva__";
  optNueva.textContent = "+ Categoría nueva...";
  select.appendChild(optNueva);

  select.addEventListener("change", async () => {
    let destino = select.value;
    if (destino === "__nueva__") {
      const nombre = prompt("Nombre de la categoría nueva:");
      if (!nombre || !nombre.trim()) {
        select.value = categoriaActualId;
        return;
      }
      const creada = await fetch("/api/budget/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: nombre.trim(), keywords: [], tipo: "limite" }),
      }).then((r) => r.json());
      if (!creada.categoria) {
        select.value = categoriaActualId;
        return;
      }
      destino = creada.categoria.id;
    }
    await fetch(`/api/finance/movements/${movIndex}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoriaId: destino }),
    });
    if (onCambiado) await onCambiado();
  });

  return select;
}

function tipoLabel(tipo) {
  if (tipo === "ganancia") return "Ganancia";
  if (tipo === "gasto") return "Gasto";
  if (tipo === "caja") return "Conteo de caja";
  return tipo;
}

function renderMovimientos() {
  const desde = movFiltroDesde.value;
  const hasta = movFiltroHasta.value;
  const tipo = movFiltroTipo.value;
  const texto = movFiltroTexto.value.trim().toLowerCase();

  const filtrados = movimientosData.filter((m) => {
    if (desde && m.fecha < desde) return false;
    if (hasta && m.fecha > hasta) return false;
    if (tipo && m.tipo !== tipo) return false;
    if (texto && !(m.descripcion || "").toLowerCase().includes(texto)) return false;
    return true;
  });

  movimientosList.innerHTML = "";
  if (filtrados.length === 0) {
    movimientosEmpty.classList.remove("hidden");
    return;
  }
  movimientosEmpty.classList.add("hidden");

  filtrados
    .slice()
    .reverse()
    .forEach((m) => {
      const row = document.createElement("div");
      row.className = "rounded-lg px-3 py-2 text-xs bg-white border border-slate-100";

      const top = document.createElement("div");
      top.className = "flex items-center justify-between gap-2";

      const info = document.createElement("div");
      info.className = "min-w-0";
      const linea1 = document.createElement("p");
      linea1.className = "font-semibold text-slate-800 break-words";
      const signo = m.tipo === "gasto" ? "-" : m.tipo === "ganancia" ? "+" : "";
      linea1.textContent = `${signo}${formatSoles(m.monto)} · ${m.descripcion || tipoLabel(m.tipo)}`;
      const linea2 = document.createElement("p");
      linea2.className = "text-slate-400";
      linea2.textContent = `${m.fecha} ${m.hora} · ${tipoLabel(m.tipo)}`;
      info.appendChild(linea1);
      info.appendChild(linea2);

      const acciones = document.createElement("div");
      acciones.className = "flex items-center gap-1 shrink-0";

      const editBtn = document.createElement("button");
      editBtn.innerHTML = '<i class="fa-solid fa-pen text-slate-400"></i>';
      editBtn.className = "w-7 h-7 flex items-center justify-center";
      editBtn.addEventListener("click", async () => {
        const nuevoMontoStr = prompt("Nuevo monto:", m.monto);
        if (nuevoMontoStr === null) return;
        const nuevoMonto = parseFloat(nuevoMontoStr);
        if (!Number.isFinite(nuevoMonto) || nuevoMonto <= 0) return;
        const nuevaDescripcion = prompt("Nueva descripción:", m.descripcion || "");
        if (nuevaDescripcion === null) return;
        await fetch(`/api/finance/movements/${m.index}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ monto: nuevoMonto, descripcion: nuevaDescripcion }),
        });
        await fetchMovimientos();
        fetchCashboxToday();
      });

      const delBtn = document.createElement("button");
      delBtn.innerHTML = '<i class="fa-solid fa-trash text-rose-400"></i>';
      delBtn.className = "w-7 h-7 flex items-center justify-center";
      delBtn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este movimiento?")) return;
        await fetch(`/api/finance/movements/${m.index}`, { method: "DELETE" });
        await fetchMovimientos();
        fetchCashboxToday();
      });

      acciones.appendChild(editBtn);
      acciones.appendChild(delBtn);
      top.appendChild(info);
      top.appendChild(acciones);
      row.appendChild(top);

      if (m.tipo === "gasto") {
        const selectCategoria = crearSelectorCategoria(
          m.categoriaEfectiva || "otros",
          m.index,
          categoriasParaSelector,
          fetchMovimientos
        );
        selectCategoria.classList.add("mt-1.5");
        row.appendChild(selectCategoria);
      }

      movimientosList.appendChild(row);
    });
}

async function fetchMovimientos() {
  try {
    const [movRes, catRes] = await Promise.all([fetch("/api/finance/movements"), fetch("/api/budget/categories")]);
    const data = await movRes.json();
    const catData = await catRes.json();
    movimientosData = data.movimientos || [];
    categoriasParaSelector = catData.categorias || [];
    renderMovimientos();
  } catch (err) {
    console.error("No se pudo obtener los movimientos:", err);
  }
}

[movFiltroDesde, movFiltroHasta, movFiltroTipo, movFiltroTexto].forEach((el) => {
  el.addEventListener("input", renderMovimientos);
});

addMovimientoBtn.addEventListener("click", async () => {
  const tipo = movNuevoTipo.value;
  const monto = parseFloat(movNuevoMonto.value);
  if (!Number.isFinite(monto) || monto <= 0) return;
  await fetch("/api/finance/movements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tipo,
      monto,
      descripcion: movNuevoDescripcion.value.trim(),
      fecha: movNuevoFecha.value || undefined,
    }),
  });
  movNuevoMonto.value = "";
  movNuevoDescripcion.value = "";
  movNuevoFecha.value = "";
  await fetchMovimientos();
  fetchCashboxToday();
});

// ---------- Finanzas: Deudas (por persona, no tocan caja) ----------
const debtsList = document.getElementById("debtsList");
const debtsEmpty = document.getElementById("debtsEmpty");
const debtNuevaPersona = document.getElementById("debtNuevaPersona");
const debtNuevoMonto = document.getElementById("debtNuevoMonto");
const debtNuevaDescripcion = document.getElementById("debtNuevaDescripcion");
const addDebtBtn = document.getElementById("addDebtBtn");

function debtTipoLabel(tipo) {
  return tipo === "debe" ? "Debe" : "Pago";
}

function renderDebtMovimientos(container, persona) {
  return async () => {
    let movimientos;
    try {
      const res = await fetch(`/api/finance/debts/${encodeURIComponent(persona)}/movements`);
      const data = await res.json();
      movimientos = data.movimientos || [];
    } catch (err) {
      console.error("No se pudo obtener el historial de la deuda:", err);
      return;
    }

    container.innerHTML = "";
    if (movimientos.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "text-xs text-slate-400 text-center py-2";
      vacio.textContent = "Sin movimientos todavía.";
      container.appendChild(vacio);
      return;
    }

    movimientos
      .slice()
      .reverse()
      .forEach((m) => {
        const row = document.createElement("div");
        row.className = "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs bg-slate-50 border border-slate-100";

        const info = document.createElement("div");
        info.className = "min-w-0";
        const linea1 = document.createElement("p");
        linea1.className = `font-semibold truncate ${m.tipo === "debe" ? "text-blue-700" : "text-emerald-700"}`;
        linea1.textContent = `${formatSoles(m.monto)} · ${debtTipoLabel(m.tipo)}${m.descripcion ? " · " + m.descripcion : ""}`;
        const linea2 = document.createElement("p");
        linea2.className = "text-slate-400";
        linea2.textContent = `${m.fecha} ${m.hora}`;
        info.appendChild(linea1);
        info.appendChild(linea2);

        const acciones = document.createElement("div");
        acciones.className = "flex items-center gap-1 shrink-0";

        const editBtn = document.createElement("button");
        editBtn.innerHTML = '<i class="fa-solid fa-pen text-slate-400"></i>';
        editBtn.className = "w-7 h-7 flex items-center justify-center";
        editBtn.addEventListener("click", async () => {
          const nuevoMontoStr = prompt("Nuevo monto:", m.monto);
          if (nuevoMontoStr === null) return;
          const nuevoMonto = parseFloat(nuevoMontoStr);
          if (!Number.isFinite(nuevoMonto) || nuevoMonto <= 0) return;
          const nuevaDescripcion = prompt("Nueva descripción:", m.descripcion || "");
          if (nuevaDescripcion === null) return;
          await fetch(`/api/finance/debts/${encodeURIComponent(persona)}/movements/${m.index}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ monto: nuevoMonto, descripcion: nuevaDescripcion }),
          });
          await renderDebtMovimientos(container, persona)();
          await fetchDebts();
        });

        const delBtn = document.createElement("button");
        delBtn.innerHTML = '<i class="fa-solid fa-trash text-rose-400"></i>';
        delBtn.className = "w-7 h-7 flex items-center justify-center";
        delBtn.addEventListener("click", async () => {
          if (!confirm("¿Eliminar este movimiento?")) return;
          await fetch(`/api/finance/debts/${encodeURIComponent(persona)}/movements/${m.index}`, { method: "DELETE" });
          await renderDebtMovimientos(container, persona)();
          await fetchDebts();
        });

        acciones.appendChild(editBtn);
        acciones.appendChild(delBtn);
        row.appendChild(info);
        row.appendChild(acciones);
        container.appendChild(row);
      });
  };
}

function renderDebts(deudas) {
  debtsList.innerHTML = "";
  const conSaldo = deudas.filter((d) => d.saldo !== 0);
  if (conSaldo.length === 0) {
    debtsEmpty.classList.remove("hidden");
    return;
  }
  debtsEmpty.classList.add("hidden");

  conSaldo.forEach((d) => {
    const card = document.createElement("div");
    card.className = "card bg-white py-3";

    const header = document.createElement("div");
    header.className = "flex items-center justify-between gap-2";
    const nombre = document.createElement("span");
    nombre.className = "font-semibold text-slate-800 text-sm";
    nombre.textContent = d.label;
    const saldo = document.createElement("span");
    saldo.className = d.saldo > 0 ? "font-bold text-blue-700" : "font-bold text-emerald-700";
    saldo.textContent = formatSoles(d.saldo);
    header.appendChild(nombre);
    header.appendChild(saldo);

    const acciones = document.createElement("div");
    acciones.className = "flex items-center gap-2 mt-2 flex-wrap";

    const payBtn = document.createElement("button");
    payBtn.className = "btn-capsule bg-emerald-100 text-emerald-700 text-xs py-1.5 px-3";
    payBtn.textContent = "Registrar pago";
    payBtn.addEventListener("click", async () => {
      const montoStr = prompt(`¿Cuánto pagó ${d.label}?`, "");
      if (montoStr === null) return;
      const monto = parseFloat(montoStr);
      if (!Number.isFinite(monto) || monto <= 0) return;
      await fetch("/api/finance/debts/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: d.label, monto }),
      });
      await fetchDebts();
      if (!historyContainer.classList.contains("hidden")) {
        await renderDebtMovimientos(historyContainer, d.label)();
      }
    });

    const historyContainer = document.createElement("div");
    historyContainer.className = "hidden space-y-1.5 mt-3 pt-3 border-t border-slate-100";

    const historyBtn = document.createElement("button");
    historyBtn.className = "btn-capsule bg-blue-50 text-blue-600 text-xs py-1.5 px-3";
    historyBtn.textContent = "Ver historial";
    let historyLoaded = false;
    historyBtn.addEventListener("click", async () => {
      const estabaOculto = historyContainer.classList.contains("hidden");
      if (estabaOculto) {
        historyContainer.classList.remove("hidden");
        historyBtn.textContent = "Ocultar historial";
        if (!historyLoaded) {
          await renderDebtMovimientos(historyContainer, d.label)();
          historyLoaded = true;
        }
      } else {
        historyContainer.classList.add("hidden");
        historyBtn.textContent = "Ver historial";
      }
    });

    const clearBtn = document.createElement("button");
    clearBtn.className = "btn-capsule bg-slate-100 text-slate-600 text-xs py-1.5 px-3";
    clearBtn.textContent = "Marcar saldada";
    clearBtn.addEventListener("click", async () => {
      if (!confirm(`¿Marcar como saldada la deuda de ${d.label}?`)) return;
      await fetch(`/api/finance/debts/${encodeURIComponent(d.label)}/clear`, { method: "POST" });
      await fetchDebts();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn-capsule bg-rose-100 text-rose-700 text-xs py-1.5 px-3";
    delBtn.textContent = "Eliminar";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar por completo el registro de ${d.label}?`)) return;
      await fetch(`/api/finance/debts/${encodeURIComponent(d.label)}`, { method: "DELETE" });
      await fetchDebts();
    });

    acciones.appendChild(payBtn);
    acciones.appendChild(historyBtn);
    acciones.appendChild(clearBtn);
    acciones.appendChild(delBtn);

    card.appendChild(header);
    card.appendChild(acciones);
    card.appendChild(historyContainer);
    debtsList.appendChild(card);
  });
}

async function fetchDebts() {
  try {
    const res = await fetch("/api/finance/debts");
    const data = await res.json();
    renderDebts(data.deudas || []);
  } catch (err) {
    console.error("No se pudo obtener las deudas:", err);
  }
}

addDebtBtn.addEventListener("click", async () => {
  const persona = debtNuevaPersona.value.trim();
  const monto = parseFloat(debtNuevoMonto.value);
  if (!persona || !Number.isFinite(monto) || monto <= 0) return;
  await fetch("/api/finance/debts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ persona, monto, descripcion: debtNuevaDescripcion.value.trim() }),
  });
  debtNuevaPersona.value = "";
  debtNuevoMonto.value = "";
  debtNuevaDescripcion.value = "";
  await fetchDebts();
});

// ---------- Finanzas: Locales que dan pedidos (ranking de repartos) ----------
const localesMes = document.getElementById("localesMes");
const localesResumen = document.getElementById("localesResumen");
const localesList = document.getElementById("localesList");
const localesEmpty = document.getElementById("localesEmpty");
const localesSinAsignar = document.getElementById("localesSinAsignar");
const localesSinAsignarEmpty = document.getElementById("localesSinAsignarEmpty");
const localNuevoNombre = document.getElementById("localNuevoNombre");
const localNuevoAliases = document.getElementById("localNuevoAliases");
const addLocalBtn = document.getElementById("addLocalBtn");

let mesLocalesSeleccionado = null;
let costoPorRepartoActual = 0;
let netoPromedioActual = 0;

function tarjetaResumen(valor, etiqueta) {
  const card = document.createElement("div");
  card.className = "card bg-white py-2 text-center";
  const v = document.createElement("p");
  v.className = "text-sm font-bold text-slate-800";
  v.textContent = valor;
  const e = document.createElement("p");
  e.className = "text-[10px] text-slate-400 mt-0.5";
  e.textContent = etiqueta;
  card.appendChild(v);
  card.appendChild(e);
  return card;
}

function renderLocales(data) {
  const ranking = data.ranking || [];
  const conPedidos = ranking.filter((l) => l.pedidos > 0);
  costoPorRepartoActual = data.costoPorReparto || 0;

  // Resumen de arriba: lo que dejaron los repartos del mes elegido.
  const totalMes = conPedidos.reduce((s, l) => s + l.total, 0);
  const pedidosMes = conPedidos.reduce((s, l) => s + l.pedidos, 0);
  localesResumen.innerHTML = "";
  localesResumen.appendChild(tarjetaResumen(formatSoles(totalMes), "cobrado"));
  localesResumen.appendChild(tarjetaResumen(String(pedidosMes), "repartos"));
  localesResumen.appendChild(tarjetaResumen(pedidosMes ? formatSoles(totalMes / pedidosMes) : formatSoles(0), "por reparto"));
  netoPromedioActual = pedidosMes ? totalMes / pedidosMes - costoPorRepartoActual : 0;

  localesList.innerHTML = "";
  localesEmpty.classList.toggle("hidden", ranking.length > 0);

  ranking.forEach((l, i) => {
    const card = document.createElement("div");
    card.className = "card bg-white py-3";

    const top = document.createElement("div");
    top.className = "flex items-start justify-between gap-2";

    const info = document.createElement("div");
    info.className = "min-w-0";
    const nombre = document.createElement("p");
    nombre.className = "font-semibold text-slate-800 text-sm break-words";
    nombre.textContent = `${i + 1}. ${l.nombre}`;
    const detalle = document.createElement("p");
    detalle.className = "text-xs text-slate-500 mt-0.5";
    detalle.textContent = l.pedidos
      ? `${l.pedidos} reparto${l.pedidos === 1 ? "" : "s"} · ${formatSoles(l.promedio)} por reparto`
      : "sin repartos en este mes";
    info.appendChild(nombre);
    info.appendChild(detalle);

    const total = document.createElement("span");
    total.className = "font-bold text-brand-green shrink-0";
    total.textContent = formatSoles(l.total);

    top.appendChild(info);
    top.appendChild(total);
    card.appendChild(top);

    // Lo que queda después de descontar lo que cuesta hacer el reparto.
    // Solo tiene sentido mostrarlo si hay un costo calculado (es decir, si
    // hay gastos marcados como del negocio).
    if (l.pedidos > 0 && costoPorRepartoActual > 0) {
      const limpio = document.createElement("p");
      // Rojo si el reparto sale perdiendo, ámbar si deja menos que tu
      // promedio, verde si está por encima.
      const color =
        l.netoPorReparto <= 0 ? "text-rose-600" : l.netoPorReparto < netoPromedioActual ? "text-amber-600" : "text-emerald-700";
      limpio.className = "text-xs font-semibold mt-1 " + color;
      limpio.textContent =
        l.netoPorReparto <= 0
          ? `⚠️ Pierdes ${formatSoles(Math.abs(l.netoPorReparto))} en cada reparto de este local`
          : `Te deja ${formatSoles(l.netoPorReparto)} limpio por reparto (${formatSoles(l.netoTotal)} en total)`;
      card.appendChild(limpio);
    }

    // Aviso de local que dejó de dar trabajo (mira todo el historial, no
    // solo el mes elegido).
    if (l.diasSinPedir !== null && l.diasSinPedir >= 14) {
      const alerta = document.createElement("p");
      alerta.className = "text-xs text-rose-600 font-medium mt-1.5";
      alerta.textContent = `⚠️ Hace ${l.diasSinPedir} días que no te da un reparto (último: ${fmtFecha(l.ultimaFecha)})`;
      card.appendChild(alerta);
    }

    const aliases = document.createElement("p");
    aliases.className = "text-[10px] text-slate-400 mt-1.5";
    aliases.textContent = `se registra como: ${l.aliases.join(", ")}`;
    card.appendChild(aliases);

    const acciones = document.createElement("div");
    acciones.className = "flex items-center gap-2 mt-2";

    const editBtn = document.createElement("button");
    editBtn.className = "btn-capsule bg-slate-100 text-slate-600 text-xs py-1.5 px-3";
    editBtn.textContent = "Editar";
    editBtn.addEventListener("click", async () => {
      const nuevoNombre = prompt("Nombre del local:", l.nombre);
      if (nuevoNombre === null) return;
      const nuevasAbrev = prompt("Abreviaturas separadas por coma:", l.aliases.join(", "));
      if (nuevasAbrev === null) return;
      await fetch(`/api/finance/locales/${encodeURIComponent(l.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nuevoNombre,
          aliases: nuevasAbrev.split(",").map((a) => a.trim()).filter(Boolean),
        }),
      });
      await fetchLocales();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn-capsule bg-rose-100 text-rose-700 text-xs py-1.5 px-3";
    delBtn.textContent = "Eliminar";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar el local "${l.nombre}"?\n\nLos repartos no se borran: solo dejan de estar agrupados bajo ese nombre.`)) return;
      await fetch(`/api/finance/locales/${encodeURIComponent(l.id)}`, { method: "DELETE" });
      await fetchLocales();
    });

    acciones.appendChild(editBtn);
    acciones.appendChild(delBtn);
    card.appendChild(acciones);
    localesList.appendChild(card);
  });

  // Nombres todavía sin local, con un atajo para darlos de alta.
  const sueltos = data.sinAsignar || [];
  localesSinAsignar.innerHTML = "";
  localesSinAsignarEmpty.classList.toggle("hidden", sueltos.length > 0);

  sueltos.forEach((s) => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs bg-amber-50 border border-amber-100";

    const info = document.createElement("div");
    info.className = "min-w-0";
    const nombre = document.createElement("p");
    nombre.className = "font-semibold text-slate-800 break-words";
    nombre.textContent = s.nombre;
    const detalle = document.createElement("p");
    detalle.className = "text-slate-400";
    detalle.textContent = `${s.pedidos} reparto${s.pedidos === 1 ? "" : "s"} · ${formatSoles(s.total)}`;
    info.appendChild(nombre);
    info.appendChild(detalle);

    const crearBtn = document.createElement("button");
    crearBtn.className = "btn-capsule bg-brand-green text-white text-xs py-1.5 px-3 shrink-0";
    crearBtn.textContent = "+ Crear local";
    crearBtn.addEventListener("click", async () => {
      const nombreReal = prompt(`¿Cómo se llama el local que registras como "${s.nombre}"?`, s.nombre);
      if (nombreReal === null || !nombreReal.trim()) return;
      await fetch("/api/finance/locales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombreReal.trim(), aliases: [s.nombre] }),
      });
      await fetchLocales();
    });

    row.appendChild(info);
    row.appendChild(crearBtn);
    localesSinAsignar.appendChild(row);
  });
}

function poblarSelectorMesLocales(meses) {
  const previo = mesLocalesSeleccionado && meses.includes(mesLocalesSeleccionado) ? mesLocalesSeleccionado : "";
  localesMes.innerHTML = "";
  const todos = document.createElement("option");
  todos.value = "";
  todos.textContent = "Todo el historial";
  localesMes.appendChild(todos);
  meses.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    const [anio, mes] = m.split("-");
    opt.textContent = `${MESES_CORTO[Number(mes) - 1]} ${anio}`;
    localesMes.appendChild(opt);
  });
  localesMes.value = previo;
  mesLocalesSeleccionado = previo;
}

async function fetchLocales() {
  try {
    const res = await fetch(`/api/finance/locales?mes=${encodeURIComponent(mesLocalesSeleccionado || "")}`);
    const data = await res.json();
    poblarSelectorMesLocales(data.meses || []);
    renderLocales(data);
  } catch (err) {
    console.error("No se pudo obtener los locales:", err);
  }
}

localesMes.addEventListener("change", () => {
  mesLocalesSeleccionado = localesMes.value;
  fetchLocales();
});

addLocalBtn.addEventListener("click", async () => {
  const nombre = localNuevoNombre.value.trim();
  if (!nombre) return;
  const aliases = localNuevoAliases.value.split(",").map((a) => a.trim()).filter(Boolean);
  const res = await fetch("/api/finance/locales", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre, aliases }),
  });
  const data = await res.json();
  if (!data.ok) {
    alert(data.error || "No se pudo agregar el local.");
    return;
  }
  localNuevoNombre.value = "";
  localNuevoAliases.value = "";
  await fetchLocales();
});

// ---------- Finanzas: Faltantes (sí tocan caja, y llevan total aparte) ----------
const shortfallsTotal = document.getElementById("shortfallsTotal");
const shortfallsList = document.getElementById("shortfallsList");
const shortfallsEmpty = document.getElementById("shortfallsEmpty");
const shortfallNuevoMonto = document.getElementById("shortfallNuevoMonto");
const shortfallNuevaDescripcion = document.getElementById("shortfallNuevaDescripcion");
const addShortfallBtn = document.getElementById("addShortfallBtn");

function renderShortfalls(total, movimientos) {
  shortfallsTotal.textContent = formatSoles(total);
  shortfallsList.innerHTML = "";
  if (movimientos.length === 0) {
    shortfallsEmpty.classList.remove("hidden");
    return;
  }
  shortfallsEmpty.classList.add("hidden");

  movimientos
    .slice()
    .reverse()
    .forEach((m) => {
      const row = document.createElement("div");
      row.className = "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs bg-white border border-slate-100";

      const info = document.createElement("div");
      info.className = "min-w-0";
      const linea1 = document.createElement("p");
      linea1.className = "font-semibold text-slate-800 truncate";
      linea1.textContent = `${formatSoles(m.monto)} · ${m.descripcion || "falto"}`;
      const linea2 = document.createElement("p");
      linea2.className = "text-slate-400";
      linea2.textContent = `${m.fecha} ${m.hora}`;
      info.appendChild(linea1);
      info.appendChild(linea2);

      const acciones = document.createElement("div");
      acciones.className = "flex items-center gap-1 shrink-0";

      const editBtn = document.createElement("button");
      editBtn.innerHTML = '<i class="fa-solid fa-pen text-slate-400"></i>';
      editBtn.className = "w-7 h-7 flex items-center justify-center";
      editBtn.addEventListener("click", async () => {
        const nuevoMontoStr = prompt("Nuevo monto:", m.monto);
        if (nuevoMontoStr === null) return;
        const nuevoMonto = parseFloat(nuevoMontoStr);
        if (!Number.isFinite(nuevoMonto) || nuevoMonto <= 0) return;
        await fetch(`/api/finance/shortfalls/${m.index}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ monto: nuevoMonto }),
        });
        await fetchShortfalls();
      });

      const delBtn = document.createElement("button");
      delBtn.innerHTML = '<i class="fa-solid fa-trash text-rose-400"></i>';
      delBtn.className = "w-7 h-7 flex items-center justify-center";
      delBtn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este faltante?")) return;
        await fetch(`/api/finance/shortfalls/${m.index}`, { method: "DELETE" });
        await fetchShortfalls();
      });

      acciones.appendChild(editBtn);
      acciones.appendChild(delBtn);
      row.appendChild(info);
      row.appendChild(acciones);
      shortfallsList.appendChild(row);
    });
}

async function fetchShortfalls() {
  try {
    const res = await fetch("/api/finance/shortfalls");
    const data = await res.json();
    renderShortfalls(data.total || 0, data.movimientos || []);
  } catch (err) {
    console.error("No se pudo obtener los faltantes:", err);
  }
}

addShortfallBtn.addEventListener("click", async () => {
  const monto = parseFloat(shortfallNuevoMonto.value);
  if (!Number.isFinite(monto) || monto <= 0) return;
  await fetch("/api/finance/shortfalls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ monto, descripcion: shortfallNuevaDescripcion.value.trim() }),
  });
  shortfallNuevoMonto.value = "";
  shortfallNuevaDescripcion.value = "";
  await fetchShortfalls();
});

// ---------- Finanzas: Cuentas de referencia (Yape/Plin/Sip/Efectivo) ----------
const accountNamesList = document.getElementById("accountNamesList");
const accountNameInput = document.getElementById("accountNameInput");
const addAccountNameBtn = document.getElementById("addAccountNameBtn");
const accountEntriesList = document.getElementById("accountEntriesList");
const accountEntriesEmpty = document.getElementById("accountEntriesEmpty");

function renderAccountNames(nombres) {
  accountNamesList.innerHTML = "";
  nombres.forEach((nombre) => {
    const chip = document.createElement("div");
    chip.className = "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs bg-orange-50 text-orange-700";
    const label = document.createElement("span");
    label.textContent = nombre;
    const removeBtn = document.createElement("button");
    removeBtn.innerHTML = '<i class="fa-solid fa-xmark text-[10px]"></i>';
    removeBtn.className = "opacity-60 hover:opacity-100";
    removeBtn.addEventListener("click", async () => {
      await fetch(`/api/finance/accounts/${encodeURIComponent(nombre)}`, { method: "DELETE" });
      await fetchAccountNames();
    });
    chip.appendChild(label);
    chip.appendChild(removeBtn);
    accountNamesList.appendChild(chip);
  });
}

async function fetchAccountNames() {
  try {
    const res = await fetch("/api/finance/accounts");
    const data = await res.json();
    renderAccountNames(data.nombres || []);
  } catch (err) {
    console.error("No se pudo obtener las cuentas de referencia:", err);
  }
}

addAccountNameBtn.addEventListener("click", async () => {
  const nombre = accountNameInput.value.trim();
  if (!nombre) return;
  await fetch("/api/finance/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre }),
  });
  accountNameInput.value = "";
  await fetchAccountNames();
});

function renderAccountEntries(entradas) {
  accountEntriesList.innerHTML = "";
  if (entradas.length === 0) {
    accountEntriesEmpty.classList.remove("hidden");
    return;
  }
  accountEntriesEmpty.classList.add("hidden");

  entradas
    .slice()
    .reverse()
    .forEach((e) => {
      const row = document.createElement("div");
      row.className = "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs bg-white border border-slate-100";

      const info = document.createElement("div");
      info.className = "min-w-0";
      const linea1 = document.createElement("p");
      linea1.className = "font-semibold text-slate-800 truncate";
      linea1.textContent = `${formatSoles(e.monto)} · ${e.cuenta}`;
      const linea2 = document.createElement("p");
      linea2.className = "text-slate-400";
      linea2.textContent = `${e.fecha} ${e.hora}`;
      info.appendChild(linea1);
      info.appendChild(linea2);

      const acciones = document.createElement("div");
      acciones.className = "flex items-center gap-1 shrink-0";

      const editBtn = document.createElement("button");
      editBtn.innerHTML = '<i class="fa-solid fa-pen text-slate-400"></i>';
      editBtn.className = "w-7 h-7 flex items-center justify-center";
      editBtn.addEventListener("click", async () => {
        const nuevoMontoStr = prompt("Nuevo monto:", e.monto);
        if (nuevoMontoStr === null) return;
        const nuevoMonto = parseFloat(nuevoMontoStr);
        if (!Number.isFinite(nuevoMonto) || nuevoMonto <= 0) return;
        await fetch(`/api/finance/accounts/entries/${e.index}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ monto: nuevoMonto }),
        });
        await fetchAccountEntries();
      });

      const delBtn = document.createElement("button");
      delBtn.innerHTML = '<i class="fa-solid fa-trash text-rose-400"></i>';
      delBtn.className = "w-7 h-7 flex items-center justify-center";
      delBtn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar esta nota?")) return;
        await fetch(`/api/finance/accounts/entries/${e.index}`, { method: "DELETE" });
        await fetchAccountEntries();
      });

      acciones.appendChild(editBtn);
      acciones.appendChild(delBtn);
      row.appendChild(info);
      row.appendChild(acciones);
      accountEntriesList.appendChild(row);
    });
}

async function fetchAccountEntries() {
  try {
    const res = await fetch("/api/finance/accounts/entries");
    const data = await res.json();
    renderAccountEntries(data.entradas || []);
  } catch (err) {
    console.error("No se pudo obtener las notas de cuentas:", err);
  }
}

// ---------- Finanzas: Gráficos ----------
let chartCategoriasInstance = null;
let chartGananciasGastosInstance = null;
let chartMensualInstance = null;
let chartEfectivoInstance = null;
let chartProduccionInstance = null;

const CHART_PALETTE = ["#22C55E", "#3B82F6", "#F59E0B", "#EF4444", "#8B5CF6", "#14B8A6", "#EC4899", "#84CC16", "#6366F1", "#F97316"];

// Mes que se está mostrando en el gráfico de categorías (se conserva
// mientras el usuario siga en la pestaña, aunque se refresquen los datos).
let mesCategoriasSeleccionado = null;
const chartCategoriasMesSelect = document.getElementById("chartCategoriasMes");

async function fetchChartCategorias(mes) {
  mesCategoriasSeleccionado = mes;
  try {
    const res = await fetch(`/api/budget/categories?mes=${encodeURIComponent(mes)}`);
    const data = await res.json();
    renderChartCategorias(data.categorias || []);
  } catch (err) {
    console.error("No se pudo obtener las categorías del mes:", err);
  }
}

chartCategoriasMesSelect.addEventListener("change", () => {
  fetchChartCategorias(chartCategoriasMesSelect.value);
});

// Arma la lista de meses disponibles (los del historial de cierres + el
// actual) para que el usuario pueda elegir cuál ver en "Gasto por
// categoría", que si no queda fijo en el mes en curso.
function poblarSelectorMesCategorias(meses, mesActual) {
  const valorPrevio = mesCategoriasSeleccionado && meses.includes(mesCategoriasSeleccionado) ? mesCategoriasSeleccionado : mesActual;
  chartCategoriasMesSelect.innerHTML = "";
  meses.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    const [anio, mes] = m.split("-");
    opt.textContent = `${MESES_CORTO[Number(mes) - 1]} ${anio}${m === mesActual ? " (actual)" : ""}`;
    if (m === valorPrevio) opt.selected = true;
    chartCategoriasMesSelect.appendChild(opt);
  });
  mesCategoriasSeleccionado = valorPrevio;
}

async function fetchGraficos() {
  try {
    const [historyRes, productionRes] = await Promise.all([
      fetch("/api/finance/history"),
      fetch("/api/finance/production-goals"),
    ]);
    const historyData = await historyRes.json();
    const productionData = await productionRes.json();

    const mesActual = historyData.hoy && historyData.hoy.fecha ? historyData.hoy.fecha.slice(0, 7) : new Date().toISOString().slice(0, 7);
    const mesesDisponibles = Array.from(new Set([...(historyData.meses || []), mesActual])).sort().reverse();
    poblarSelectorMesCategorias(mesesDisponibles, mesActual);
    await fetchChartCategorias(mesCategoriasSeleccionado);

    renderChartHistoria(historyData.cierres || [], historyData.hoy);
    renderChartMensual(historyData.cierres || [], historyData.hoy);
    renderChartProduccion(productionData.hoy);
    renderMapaActividad();
  } catch (err) {
    console.error("No se pudo obtener los datos para los gráficos:", err);
  }
}

function renderChartCategorias(categorias) {
  // Solo categorías de límite mensual (gasto real de este mes); las de
  // tipo "meta" (Junta, Cuzco, Universidad) son ahorro de largo plazo, no
  // gasto del mes, así que no van en este gráfico.
  const gastos = categorias
    .filter((c) => c.tipo === "limite" && c.gastado > 0)
    .sort((a, b) => b.gastado - a.gastado);

  const canvas = document.getElementById("chartCategorias");
  const empty = document.getElementById("chartCategoriasEmpty");

  if (gastos.length === 0) {
    canvas.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  canvas.classList.remove("hidden");
  empty.classList.add("hidden");

  if (chartCategoriasInstance) chartCategoriasInstance.destroy();
  chartCategoriasInstance = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: gastos.map((c) => c.label),
      datasets: [
        {
          data: gastos.map((c) => c.gastado),
          backgroundColor: gastos.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 10 } } } },
    },
  });
}

function renderChartHistoria(cierres, hoy) {
  // Últimos 13 días ya cerrados + el día de hoy en curso, para que el
  // gráfico llegue hasta el momento actual.
  const dias = cierres.slice(-13).map((c) => ({
    fecha: c.fecha,
    ganancias: c.ganancias,
    gastos: c.gastos,
    esperado: c.esperado,
  }));
  if (hoy && hoy.fecha) {
    dias.push({ fecha: hoy.fecha, ganancias: hoy.ganancias, gastos: hoy.gastos, esperado: hoy.esperado });
  }

  const labels = dias.map((d) => d.fecha.slice(5)); // "MM-DD"

  const canvasBar = document.getElementById("chartGananciasGastos");
  if (chartGananciasGastosInstance) chartGananciasGastosInstance.destroy();
  chartGananciasGastosInstance = new Chart(canvasBar, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Ganancias", data: dias.map((d) => d.ganancias), backgroundColor: "#22C55E" },
        { label: "Gastos", data: dias.map((d) => d.gastos), backgroundColor: "#EF4444" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { ticks: { font: { size: 9 } } }, y: { beginAtZero: true } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 10 } } } },
    },
  });

  const canvasLine = document.getElementById("chartEfectivo");
  if (chartEfectivoInstance) chartEfectivoInstance.destroy();
  chartEfectivoInstance = new Chart(canvasLine, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Efectivo esperado",
          data: dias.map((d) => d.esperado),
          borderColor: "#3B82F6",
          backgroundColor: "rgba(59, 130, 246, 0.15)",
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { ticks: { font: { size: 9 } } } },
      plugins: { legend: { display: false } },
    },
  });
}

const MESES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const DIAS_CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// Mapa de calor de cuándo entran los repartos. Solo se dibujan las horas
// en las que realmente hubo actividad, para que en el celular no queden
// 24 columnas casi todas vacías.
async function renderMapaActividad() {
  const contenedor = document.getElementById("mapaActividad");
  const resumen = document.getElementById("mapaActividadResumen");
  let data;
  try {
    data = await (await fetch("/api/finance/actividad")).json();
  } catch (err) {
    console.error("No se pudo obtener la actividad:", err);
    return;
  }

  const horasConDatos = data.porHora.filter((h) => h.pedidos > 0).map((h) => h.hora);
  contenedor.innerHTML = "";
  resumen.innerHTML = "";
  if (horasConDatos.length === 0) {
    contenedor.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Todavía no hay repartos registrados.</p>';
    return;
  }

  const maximo = Math.max(...data.celdas.flat().map((c) => c.total));
  const tabla = document.createElement("table");
  tabla.className = "w-full text-[10px] border-separate";
  tabla.style.borderSpacing = "2px";

  const thead = document.createElement("thead");
  const filaCabecera = document.createElement("tr");
  filaCabecera.appendChild(document.createElement("th"));
  horasConDatos.forEach((h) => {
    const th = document.createElement("th");
    th.className = "text-slate-400 font-normal";
    th.textContent = String(h).padStart(2, "0");
    filaCabecera.appendChild(th);
  });
  thead.appendChild(filaCabecera);
  tabla.appendChild(thead);

  const tbody = document.createElement("tbody");
  // Lunes primero, domingo al final: es como se lee una semana.
  [1, 2, 3, 4, 5, 6, 0].forEach((dow) => {
    const fila = document.createElement("tr");
    const etiqueta = document.createElement("td");
    etiqueta.className = "text-slate-500 font-semibold pr-1 whitespace-nowrap";
    etiqueta.textContent = DIAS_CORTO[dow];
    fila.appendChild(etiqueta);

    horasConDatos.forEach((h) => {
      const celda = data.celdas[dow][h];
      const td = document.createElement("td");
      const intensidad = maximo > 0 ? celda.total / maximo : 0;
      td.className = "rounded text-center";
      td.style.height = "22px";
      td.style.backgroundColor = celda.total > 0 ? `rgba(34, 197, 94, ${0.15 + intensidad * 0.85})` : "#F1F5F9";
      td.style.color = intensidad > 0.5 ? "#fff" : "#475569";
      td.textContent = celda.pedidos > 0 ? celda.pedidos : "";
      td.title = `${DIAS_CORTO[dow]} ${String(h).padStart(2, "0")}:00 — ${celda.pedidos} repartos, ${formatSoles(celda.total)}`;
      fila.appendChild(td);
    });
    tbody.appendChild(fila);
  });
  tabla.appendChild(tbody);
  contenedor.appendChild(tabla);

  const pie = document.createElement("p");
  pie.className = "text-[10px] text-slate-400 mt-2 text-center";
  pie.textContent = "El número es la cantidad de repartos de esa hora.";
  contenedor.appendChild(pie);

  // Mejor y peor día, por promedio de lo cobrado en cada día trabajado.
  const conDatos = data.porDia.filter((d) => d.veces > 0).sort((a, b) => b.promedio - a.promedio);
  if (conDatos.length >= 2) {
    const mejor = conDatos[0];
    const peor = conDatos[conDatos.length - 1];
    resumen.appendChild(tarjetaResumen(`${DIAS_CORTO[mejor.dow]} · ${formatSoles(mejor.promedio)}`, "tu mejor día"));
    resumen.appendChild(tarjetaResumen(`${DIAS_CORTO[peor.dow]} · ${formatSoles(peor.promedio)}`, "tu día más flojo"));
  }
  const mejorHora = data.porHora.slice().sort((a, b) => b.total - a.total)[0];
  if (mejorHora && mejorHora.pedidos > 0) {
    resumen.appendChild(
      tarjetaResumen(`${String(mejorHora.hora).padStart(2, "0")}:00`, `tu hora pico · ${mejorHora.pedidos} repartos`)
    );
    const totalPedidos = data.porHora.reduce((s, h) => s + h.pedidos, 0);
    const nocturnos = data.porHora.filter((h) => h.hora >= 19 || h.hora <= 1).reduce((s, h) => s + h.pedidos, 0);
    resumen.appendChild(tarjetaResumen(`${Math.round((nocturnos / totalPedidos) * 100)}%`, "entra de 7pm a 1am"));
  }
}

// Agrupa los cierres diarios (hasta 90 días de historial) por mes, para ver
// cómo vino cada mes anterior en ganancias/gastos, no solo los últimos 14
// días. Incluye el mes en curso sumando lo que va del día de hoy.
function renderChartMensual(cierres, hoy) {
  const porMes = {};
  const sumarA = (mesLabel, ganancias, gastos) => {
    if (!porMes[mesLabel]) porMes[mesLabel] = { ganancias: 0, gastos: 0 };
    porMes[mesLabel].ganancias += ganancias;
    porMes[mesLabel].gastos += gastos;
  };
  cierres.forEach((c) => sumarA(c.fecha.slice(0, 7), c.ganancias, c.gastos));
  if (hoy && hoy.fecha) sumarA(hoy.fecha.slice(0, 7), hoy.ganancias, hoy.gastos);

  const meses = Object.keys(porMes).sort();

  const canvas = document.getElementById("chartMensual");
  const empty = document.getElementById("chartMensualEmpty");

  if (meses.length === 0) {
    canvas.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  canvas.classList.remove("hidden");
  empty.classList.add("hidden");

  const labels = meses.map((m) => {
    const [anio, mes] = m.split("-");
    return `${MESES_CORTO[Number(mes) - 1]} ${anio.slice(2)}`;
  });

  if (chartMensualInstance) chartMensualInstance.destroy();
  chartMensualInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Ganancias", data: meses.map((m) => porMes[m].ganancias), backgroundColor: "#22C55E" },
        { label: "Gastos", data: meses.map((m) => porMes[m].gastos), backgroundColor: "#EF4444" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 10 } } } },
    },
  });
}

// progreso viene de GET /api/finance/production-goals -> campo "hoy"
// (null si el mes en curso no tiene una meta de producción configurada).
function renderChartProduccion(progreso) {
  const canvas = document.getElementById("chartProduccion");
  const empty = document.getElementById("chartProduccionEmpty");

  if (!progreso) {
    canvas.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  canvas.classList.remove("hidden");
  empty.classList.add("hidden");

  const generadoTotal = progreso.generadoAcumulado + progreso.generadoHoy;

  if (chartProduccionInstance) chartProduccionInstance.destroy();
  chartProduccionInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels: ["Meta del mes", "Generado hasta hoy"],
      datasets: [
        {
          data: [progreso.metaMensualReferencia, generadoTotal],
          backgroundColor: [
            "#FDE68A",
            generadoTotal >= progreso.metaMensualReferencia ? "#22C55E" : "#F59E0B",
          ],
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { beginAtZero: true } },
      plugins: { legend: { display: false } },
    },
  });
}

// ---------- Finanzas: Metas ----------
const goalAhorroInput = document.getElementById("goalAhorroInput");
const metaAutoDiaria = document.getElementById("metaAutoDiaria");
const metaAutoSemanal = document.getElementById("metaAutoSemanal");
const metaAutoMensual = document.getElementById("metaAutoMensual");
const metaAutoCubierto = document.getElementById("metaAutoCubierto");
const metaAutoNecesito = document.getElementById("metaAutoNecesito");
const metaAutoTengo = document.getElementById("metaAutoTengo");
const metaAutoFalta = document.getElementById("metaAutoFalta");
const metaAutoDias = document.getElementById("metaAutoDias");
const metaAutoDesglose = document.getElementById("metaAutoDesglose");
const metaAutoAtrasados = document.getElementById("metaAutoAtrasados");
const metaAutoAtrasadosTxt = document.getElementById("metaAutoAtrasadosTxt");
const metaAutoDetalle = document.getElementById("metaAutoDetalle");
const metaAutoToggle = document.getElementById("metaAutoToggle");
const metaAutoToggleTxt = document.getElementById("metaAutoToggleTxt");
const goalSavedMsg = document.getElementById("goalSavedMsg");
const goalProgressList = document.getElementById("goalProgressList");
const ahorroMetaTxt = document.getElementById("ahorroMetaTxt");
const ahorroActualTxt = document.getElementById("ahorroActualTxt");
const ahorroFaltaTxt = document.getElementById("ahorroFaltaTxt");
const ahorroRecomendadoTxt = document.getElementById("ahorroRecomendadoTxt");
const proyeccionTxt = document.getElementById("proyeccionTxt");
const comparativaTxt = document.getElementById("comparativaTxt");
const compromisosList = document.getElementById("compromisosList");
const compromisosTotalTxt = document.getElementById("compromisosTotalTxt");

async function fetchGoalsAndProgress() {
  try {
    const [goalsRes, progressRes] = await Promise.all([
      fetch("/api/finance/goals"),
      fetch("/api/finance/goals/progress"),
    ]);
    const goalsData = await goalsRes.json();
    const progressData = await progressRes.json();
    renderGoalInputs(goalsData.goals || {});
    renderGoalProgress(progressData);
  } catch (err) {
    console.error("No se pudo obtener las metas:", err);
  }
}

function renderGoalInputs(goals) {
  // Diaria/semanal/mensual ya no se escriben: las calcula la app sola.
  goalAhorroInput.value = goals.ahorroMensual || "";
}

// Las tres metas y el desglose de donde sale el numero. Todo viene ya
// calculado del servidor para que el panel y el bot digan lo mismo.
function renderMetasAutomaticas(m) {
  if (!m) return;
  metaAutoDiaria.textContent = formatSoles(m.diaria);
  metaAutoSemanal.textContent = formatSoles(m.semanal);
  metaAutoMensual.textContent = formatSoles(m.mensual);
  metaAutoCubierto.classList.toggle("hidden", !m.cubierto);

  metaAutoNecesito.textContent = formatSoles(m.necesito);
  metaAutoTengo.textContent = formatSoles(m.tengo);
  metaAutoFalta.textContent = formatSoles(m.falta);
  metaAutoDias.textContent = m.diasRestantes;

  // Los vencidos sin marcar NO suman a la meta (su efectivo de hoy ya
  // refleja lo que pago). Pero se avisan para que no se le pasen.
  const atrasados = (m.detalle.atrasados && m.detalle.atrasados.items) || [];
  metaAutoAtrasados.classList.toggle("hidden", atrasados.length === 0);
  if (atrasados.length > 0) {
    const nombres = atrasados.map((p) => p.label).join(", ");
    const plural = atrasados.length > 1 ? "s" : "";
    metaAutoAtrasadosTxt.textContent =
      atrasados.length + " pago" + plural + " con fecha ya vencida sin marcar como pagado (" + nombres + ", " +
      formatSoles(m.detalle.atrasados.total) + "). No se cuentan en tu meta. Si de verdad no los pagaste, márcalos en Pendientes.";
  }

  metaAutoDesglose.innerHTML = "";
  [
    ["Pendientes por pagar", m.detalle.pendientes.total],
    ["Gastos programados", m.detalle.programados.total],
    ["Deudas que debes", m.detalle.deudas.total],
    ["Tu meta de ahorro", m.detalle.ahorro.total],
  ]
    .filter(([, monto]) => monto > 0)
    .forEach(([label, monto]) => {
      const row = document.createElement("div");
      row.className = "flex items-center justify-between gap-2";
      const nombre = document.createElement("span");
      nombre.className = "text-slate-500";
      nombre.textContent = label;
      const valor = document.createElement("span");
      valor.className = "font-semibold text-slate-600 shrink-0";
      valor.textContent = formatSoles(monto);
      row.appendChild(nombre);
      row.appendChild(valor);
      metaAutoDesglose.appendChild(row);
    });
}

if (metaAutoToggle) {
  metaAutoToggle.addEventListener("click", () => {
    const oculto = metaAutoDetalle.classList.toggle("hidden");
    metaAutoToggleTxt.textContent = oculto ? "Ver de dónde sale" : "Ocultar";
  });
}

function renderGoalProgress(data) {
  renderMetasAutomaticas(data.automaticas);
  goalProgressList.innerHTML = "";
  const filas = [
    { label: "Diaria", info: data.diaria },
    { label: "Semanal", info: data.semanal },
    { label: "Mensual", info: data.mensual },
  ];
  filas.forEach(({ label, info }) => {
    if (!info || info.meta <= 0) return;
    const pct = Math.min(info.actual / info.meta, 1);

    const row = document.createElement("div");
    row.className = "text-xs";

    const header = document.createElement("div");
    header.className = "flex items-center justify-between mb-1";
    const nombre = document.createElement("span");
    nombre.className = "font-semibold text-slate-700";
    nombre.textContent = label;
    const valores = document.createElement("span");
    valores.className = "text-slate-500";
    valores.textContent = `${formatSoles(info.actual)} / ${formatSoles(info.meta)}`;
    header.appendChild(nombre);
    header.appendChild(valores);

    const barBg = document.createElement("div");
    barBg.className = "w-full h-2 rounded-full bg-slate-100 overflow-hidden";
    const bar = document.createElement("div");
    bar.className = "h-full bg-brand-green";
    bar.style.width = `${Math.round(pct * 100)}%`;
    barBg.appendChild(bar);

    row.appendChild(header);
    row.appendChild(barBg);

    if (info.falta > 0) {
      const falta = document.createElement("p");
      falta.className = "text-slate-400 mt-1";
      falta.textContent = `Te faltan ${formatSoles(info.falta)}`;
      row.appendChild(falta);
    }

    goalProgressList.appendChild(row);
  });

  if (goalProgressList.children.length === 0) {
    const p = document.createElement("p");
    p.className = "text-xs text-slate-400 text-center py-4";
    p.textContent = "Configura al menos una meta arriba para ver el progreso.";
    goalProgressList.appendChild(p);
  }

  if (data.ahorro) {
    ahorroMetaTxt.textContent = formatSoles(data.ahorro.meta);
    ahorroActualTxt.textContent = formatSoles(data.ahorro.actual);
    ahorroFaltaTxt.textContent = formatSoles(data.ahorro.falta);
    ahorroRecomendadoTxt.textContent = formatSoles(data.ahorro.recomendadoDiario) + " / día";
  }

  if (data.proyeccion) {
    proyeccionTxt.textContent = formatSoles(data.proyeccion.finDeMes);
  }

  if (data.mesAnterior) {
    const actual = (data.mensual && data.mensual.actual) || 0;
    const anterior = data.mesAnterior.ganancias || 0;
    if (anterior > 0) {
      const diffPct = Math.round(((actual - anterior) / anterior) * 100);
      const signo = diffPct >= 0 ? "más" : "menos";
      comparativaTxt.textContent = `Este mes vas ${Math.abs(diffPct)}% ${signo} en ganancias que el mes pasado (${formatSoles(anterior)}).`;
    } else {
      comparativaTxt.textContent = "";
    }
  }

  if (data.compromisos) {
    const c = data.compromisos;
    compromisosList.innerHTML = "";
    if (c.detalle.length === 0) {
      const p = document.createElement("p");
      p.className = "text-xs text-slate-400";
      p.textContent = "No te falta pagar nada este mes.";
      compromisosList.appendChild(p);
    } else {
      c.detalle.forEach((d) => {
        const row = document.createElement("div");
        row.className = "flex items-center justify-between text-xs";
        const nombre = document.createElement("span");
        nombre.className = "text-slate-600";
        nombre.textContent = d.fecha ? `${d.label} · ${d.fecha.slice(8, 10)}/${d.fecha.slice(5, 7)}` : d.veces > 1 ? `${d.label} (x${d.veces})` : d.label;
        const monto = document.createElement("span");
        monto.className = "font-semibold text-slate-700";
        monto.textContent = formatSoles(d.subtotal);
        row.appendChild(nombre);
        row.appendChild(monto);
        compromisosList.appendChild(row);
      });
    }
    compromisosTotalTxt.textContent = formatSoles(c.total);
  }
}

document.querySelectorAll(".goal-save-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const tipo = btn.dataset.goalSave;
    const inputMap = {
      ahorroMensual: goalAhorroInput,
    };
    const input = inputMap[tipo];
    const monto = parseFloat(input.value) || 0;
    await fetch("/api/finance/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, monto }),
    });
    goalSavedMsg.classList.remove("hidden");
    setTimeout(() => goalSavedMsg.classList.add("hidden"), 2000);
    await fetchGoalsAndProgress();
  });
});

// ---------- Finanzas: Meta de producción ----------
const productionGoalHoy = document.getElementById("productionGoalHoy");
const productionGoalBar = document.getElementById("productionGoalBar");
const productionGoalsList = document.getElementById("productionGoalsList");
const productionGoalMes = document.getElementById("productionGoalMes");
const productionGoalBase = document.getElementById("productionGoalBase");
const productionGoalDias = document.getElementById("productionGoalDias");
const saveProductionGoalBtn = document.getElementById("saveProductionGoalBtn");

async function fetchProductionGoals() {
  try {
    const res = await fetch("/api/finance/production-goals");
    const data = await res.json();
    renderProductionGoalHoy(data.hoy);
    renderProductionGoalsList(data.metas || []);
  } catch (err) {
    console.error("No se pudo obtener la meta de producción:", err);
  }
}

function renderProductionGoalHoy(progreso) {
  productionGoalHoy.innerHTML = "";
  if (!progreso) {
    const p = document.createElement("p");
    p.className = "text-slate-500";
    p.textContent = "No tienes una meta de producción configurada para este mes.";
    productionGoalHoy.appendChild(p);
    productionGoalBar.style.width = "0%";
    return;
  }

  const generadoTotal = progreso.generadoAcumulado + progreso.generadoHoy;
  const pct = progreso.metaMensualReferencia > 0 ? Math.min(generadoTotal / progreso.metaMensualReferencia, 1) : 0;
  productionGoalBar.style.width = `${Math.round(pct * 100)}%`;

  const filas = [
    ["Meta de hoy", formatSoles(progreso.metaHoy)],
    ["Llevas hoy", formatSoles(progreso.generadoHoy)],
    [progreso.cumplido ? "¡Meta de hoy cumplida! 🎉" : "Te falta hoy", progreso.cumplido ? "" : formatSoles(progreso.faltaHoy)],
    ["Generado este mes", `${formatSoles(generadoTotal)} de ${formatSoles(progreso.metaMensualReferencia)}`],
    ["Días de producción restantes", String(progreso.diasProduccionRestantes)],
  ];
  filas.forEach(([label, valor]) => {
    const p = document.createElement("p");
    p.innerHTML = `${label}${valor ? ": " : ""}<span class="font-semibold">${valor}</span>`;
    productionGoalHoy.appendChild(p);
  });
}

function renderProductionGoalsList(metas) {
  productionGoalsList.innerHTML = "";
  if (metas.length === 0) {
    const p = document.createElement("p");
    p.className = "text-xs text-slate-400";
    p.textContent = "Todavía no configuraste ninguna meta mensual.";
    productionGoalsList.appendChild(p);
    return;
  }
  metas.forEach((m) => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between text-xs bg-white rounded-xl px-3 py-2 border border-amber-100";

    const info = document.createElement("span");
    info.className = "text-slate-600";
    info.textContent = `${m.mes}: ${formatSoles(m.metaDiariaBase)}/día × ${m.diasProduccion} días`;

    const del = document.createElement("button");
    del.className = "btn-capsule bg-rose-100 text-rose-700 text-xs px-3 py-1.5";
    del.textContent = "Eliminar";
    del.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar la meta de producción de ${m.mes}?`)) return;
      await fetch(`/api/finance/production-goals/${m.mes}`, { method: "DELETE" });
      await fetchProductionGoals();
    });

    row.appendChild(info);
    row.appendChild(del);
    productionGoalsList.appendChild(row);
  });
}

saveProductionGoalBtn.addEventListener("click", async () => {
  const mes = productionGoalMes.value;
  const metaDiariaBase = parseFloat(productionGoalBase.value) || 0;
  const diasProduccion = parseInt(productionGoalDias.value, 10) || 1;
  if (!mes) {
    alert("Elige el mes (arriba, formato mes/año).");
    return;
  }
  const res = await fetch(`/api/finance/production-goals/${mes}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ metaDiariaBase, diasProduccion }),
  });
  if (!res.ok) {
    const err = await res.json();
    alert(err.error || "No se pudo guardar la meta.");
    return;
  }
  productionGoalMes.value = "";
  productionGoalBase.value = "";
  productionGoalDias.value = "";
  await fetchProductionGoals();
});

// ---------- Finanzas: Presupuesto (categorías, límites y metas) ----------
const budgetList = document.getElementById("budgetList");
const budgetNuevoLabel = document.getElementById("budgetNuevoLabel");
const budgetNuevoKeywords = document.getElementById("budgetNuevoKeywords");
const budgetNuevoTipo = document.getElementById("budgetNuevoTipo");
const budgetNuevoLimite = document.getElementById("budgetNuevoLimite");
const budgetNuevoMeta = document.getElementById("budgetNuevoMeta");
const budgetNuevoSaldoInicial = document.getElementById("budgetNuevoSaldoInicial");
const addBudgetCategoryBtn = document.getElementById("addBudgetCategoryBtn");

function toggleBudgetNuevoFields() {
  const esMeta = budgetNuevoTipo.value === "meta";
  budgetNuevoLimite.classList.toggle("hidden", esMeta);
  budgetNuevoMeta.classList.toggle("hidden", !esMeta);
  budgetNuevoSaldoInicial.classList.toggle("hidden", !esMeta);
}
budgetNuevoTipo.addEventListener("change", toggleBudgetNuevoFields);
toggleBudgetNuevoFields();

// Trae y dibuja los gastos de una categoría, cada uno con un selector para
// moverlo a otra categoría (o crear una nueva) sin salir de la lista.
function renderCategoriaMovimientos(container, catId, todasCategorias) {
  return async () => {
    let movimientos;
    try {
      const res = await fetch(`/api/budget/categories/${encodeURIComponent(catId)}/movements`);
      const data = await res.json();
      movimientos = data.movimientos || [];
    } catch (err) {
      console.error("No se pudo obtener los gastos de la categoría:", err);
      return;
    }

    container.innerHTML = "";
    if (movimientos.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "text-xs text-slate-400 text-center py-2";
      vacio.textContent = "Sin gastos en esta categoría.";
      container.appendChild(vacio);
      return;
    }

    movimientos.forEach((m) => {
      const row = document.createElement("div");
      row.className = "flex flex-col gap-1.5 rounded-lg px-3 py-2 text-xs bg-slate-50 border border-slate-100";

      const linea1 = document.createElement("p");
      linea1.className = "font-semibold text-slate-800 break-words";
      linea1.textContent = `${formatSoles(m.monto)} · ${m.descripcion || "(sin descripción)"}`;
      const linea2 = document.createElement("p");
      linea2.className = "text-slate-400";
      linea2.textContent = `${m.fecha} ${m.hora}`;
      row.appendChild(linea1);
      row.appendChild(linea2);

      const select = crearSelectorCategoria(catId, m.index, todasCategorias, fetchBudgetCategories);
      row.appendChild(select);
      container.appendChild(row);
    });
  };
}

function renderBudgetCategories(categorias) {
  budgetList.innerHTML = "";
  categorias
    .forEach((cat) => {
      const card = document.createElement("div");
      card.className = "card bg-white py-3";

      const nombre = document.createElement("p");
      nombre.className = "font-semibold text-slate-800 text-sm";
      nombre.textContent = cat.label;
      card.appendChild(nombre);

      const info = document.createElement("p");
      info.className = "text-xs text-slate-500 mt-1";
      if (cat.tipo === "meta") {
        info.textContent = `${formatSoles(cat.pagado)} de ${formatSoles(cat.meta)} · falta ${formatSoles(cat.restante)}`;
      } else if (cat.limite === null) {
        info.textContent = `Gastado este mes: ${formatSoles(cat.gastado)} (sin límite)`;
      } else {
        info.textContent = `${formatSoles(cat.gastado)} de ${formatSoles(cat.limite)} · disponible ${formatSoles(cat.disponible)}`;
      }
      card.appendChild(info);

      if (cat.porcentaje !== null && cat.porcentaje !== undefined) {
        const barBg = document.createElement("div");
        barBg.className = "w-full h-1.5 rounded-full bg-slate-100 overflow-hidden mt-1.5";
        const bar = document.createElement("div");
        bar.className = `h-full ${cat.porcentaje >= 1 ? "bg-rose-500" : "bg-emerald-500"}`;
        bar.style.width = `${Math.round(Math.min(cat.porcentaje, 1) * 100)}%`;
        barBg.appendChild(bar);
        card.appendChild(barBg);
      }

      const acciones = document.createElement("div");
      acciones.className = "flex items-center gap-2 mt-2 flex-wrap";

      const movimientosContainer = document.createElement("div");
      movimientosContainer.className = "hidden space-y-1.5 mt-3 pt-3 border-t border-slate-100";

      const verBtn = document.createElement("button");
      verBtn.className = "btn-capsule bg-blue-50 text-blue-600 text-xs py-1.5 px-3";
      verBtn.textContent = "Ver gastos";
      let movimientosCargados = false;
      verBtn.addEventListener("click", async () => {
        const estabaOculto = movimientosContainer.classList.contains("hidden");
        if (estabaOculto) {
          movimientosContainer.classList.remove("hidden");
          verBtn.textContent = "Ocultar gastos";
          if (!movimientosCargados) {
            await renderCategoriaMovimientos(movimientosContainer, cat.id, categorias)();
            movimientosCargados = true;
          }
        } else {
          movimientosContainer.classList.add("hidden");
          verBtn.textContent = "Ver gastos";
        }
      });
      acciones.appendChild(verBtn);

      if (cat.id === "otros") {
        card.appendChild(acciones);
        card.appendChild(movimientosContainer);
        budgetList.appendChild(card);
        return;
      }

      // Palabras clave: se muestran como chips, cada una con su "x" para
      // borrarla, más un campo para agregar una nueva sola.
      async function guardarKeywords(nuevasKeywords) {
        await fetch(`/api/budget/categories/${encodeURIComponent(cat.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keywords: nuevasKeywords }),
        });
        await fetchBudgetCategories();
      }

      // Negocio o personal: define si este gasto cuenta como costo de
      // operar (y por lo tanto pesa en la rentabilidad) o no.
      const ambitoWrap = document.createElement("div");
      ambitoWrap.className = "flex items-center gap-1.5 mt-2";
      const esNegocio = cat.ambito === "negocio";

      const ambitoBtn = document.createElement("button");
      ambitoBtn.className =
        "btn-capsule text-xs py-1 px-2.5 " +
        (esNegocio ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500");
      ambitoBtn.textContent = esNegocio ? "🛵 Negocio" : "🏠 Personal";
      ambitoBtn.title = "Cambiar entre gasto del negocio y gasto personal";
      ambitoBtn.addEventListener("click", async () => {
        await fetch(`/api/budget/categories/${encodeURIComponent(cat.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ambito: esNegocio ? "personal" : "negocio" }),
        });
        await fetchBudgetCategories();
      });
      ambitoWrap.appendChild(ambitoBtn);
      card.appendChild(ambitoWrap);

      const keywordsWrap = document.createElement("div");
      keywordsWrap.className = "flex flex-wrap items-center gap-1.5 mt-2";
      (cat.keywords || []).forEach((kw) => {
        const chip = document.createElement("span");
        chip.className = "inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded-full pl-2.5 pr-1.5 py-1 text-xs";
        chip.textContent = kw;
        const chipDel = document.createElement("button");
        chipDel.className = "w-4 h-4 flex items-center justify-center text-slate-400 hover:text-rose-600";
        chipDel.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        chipDel.addEventListener("click", () => {
          guardarKeywords((cat.keywords || []).filter((k) => k !== kw));
        });
        chip.appendChild(chipDel);
        keywordsWrap.appendChild(chip);
      });

      const addKeywordInput = document.createElement("input");
      addKeywordInput.type = "text";
      addKeywordInput.placeholder = "+ palabra clave";
      addKeywordInput.className = "bg-white rounded-full px-2.5 py-1 text-xs border border-slate-200 w-28";
      addKeywordInput.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        const nueva = addKeywordInput.value.trim().toLowerCase();
        if (!nueva || (cat.keywords || []).includes(nueva)) return;
        guardarKeywords([...(cat.keywords || []), nueva]);
      });
      keywordsWrap.appendChild(addKeywordInput);
      card.appendChild(keywordsWrap);

      const editBtn = document.createElement("button");
      editBtn.className = "btn-capsule bg-slate-100 text-slate-600 text-xs py-1.5 px-3";
      editBtn.textContent = "Editar";
      editBtn.addEventListener("click", async () => {
        const nuevoLabel = prompt("Nombre:", cat.label);
        if (nuevoLabel === null) return;
        await fetch(`/api/budget/categories/${encodeURIComponent(cat.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: nuevoLabel }),
        });
        if (cat.tipo === "meta") {
          const nuevaMeta = prompt("Meta total (S/):", cat.meta);
          if (nuevaMeta === null) return fetchBudgetCategories();
          const nuevoSaldoInicial = prompt("Ya pagado antes de hoy (S/):", cat.saldoInicial);
          if (nuevoSaldoInicial === null) return fetchBudgetCategories();
          await fetch(`/api/budget/categories/${encodeURIComponent(cat.id)}/meta`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ meta: nuevaMeta, saldoInicial: nuevoSaldoInicial }),
          });
        } else {
          const nuevoLimite = prompt("Límite mensual (S/), vacío = sin límite:", cat.limite ?? "");
          if (nuevoLimite === null) return fetchBudgetCategories();
          await fetch(`/api/budget/categories/${encodeURIComponent(cat.id)}/limit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ limite: nuevoLimite === "" ? null : nuevoLimite }),
          });
        }
        await fetchBudgetCategories();
      });

      const delBtn = document.createElement("button");
      delBtn.className = "btn-capsule bg-rose-100 text-rose-700 text-xs py-1.5 px-3";
      delBtn.textContent = "Eliminar";
      delBtn.addEventListener("click", async () => {
        if (!confirm(`¿Eliminar la categoría "${cat.label}"?`)) return;
        await fetch(`/api/budget/categories/${encodeURIComponent(cat.id)}`, { method: "DELETE" });
        await fetchBudgetCategories();
      });

      acciones.appendChild(editBtn);
      acciones.appendChild(delBtn);
      card.appendChild(acciones);
      card.appendChild(movimientosContainer);

      budgetList.appendChild(card);
    });
}

function filaRentabilidad(etiqueta, valor, clase) {
  const fila = document.createElement("div");
  fila.className = "flex items-center justify-between gap-2";
  const l = document.createElement("span");
  l.className = "text-slate-500 text-xs";
  l.textContent = etiqueta;
  const v = document.createElement("span");
  v.className = "font-semibold " + (clase || "text-slate-800");
  v.textContent = valor;
  fila.appendChild(l);
  fila.appendChild(v);
  return fila;
}

function renderRentabilidad(r) {
  const detalle = document.getElementById("rentabilidadDetalle");
  const porReparto = document.getElementById("rentabilidadPorReparto");
  detalle.innerHTML = "";
  porReparto.innerHTML = "";
  if (!r) return;

  detalle.appendChild(filaRentabilidad("Cobrado por repartos", formatSoles(r.ingresos), "text-emerald-700"));
  detalle.appendChild(filaRentabilidad("🛵 Gastos del negocio", "-" + formatSoles(r.gastoNegocio), "text-rose-600"));
  detalle.appendChild(
    filaRentabilidad(
      "Ganancia real del negocio",
      `${formatSoles(r.gananciaNeta)} (${r.margen}%)`,
      r.gananciaNeta >= 0 ? "text-emerald-700" : "text-rose-600"
    )
  );
  detalle.appendChild(filaRentabilidad("🏠 Gastos personales (aparte)", formatSoles(r.gastoPersonal), "text-slate-400"));

  porReparto.appendChild(tarjetaResumen(formatSoles(r.cobradoPorReparto), "cobras"));
  porReparto.appendChild(tarjetaResumen("-" + formatSoles(r.costoPorReparto), "te cuesta"));
  porReparto.appendChild(tarjetaResumen(formatSoles(r.netoPorReparto), "limpio"));

  const pie = document.createElement("p");
  pie.className = "text-[10px] text-slate-400 mt-2 text-center col-span-3";
  pie.textContent = `por cada uno de tus ${r.repartos} repartos del mes`;
  porReparto.appendChild(pie);
}

async function fetchBudgetCategories() {
  try {
    const res = await fetch("/api/budget/categories");
    const data = await res.json();
    renderBudgetCategories(data.categorias || []);
    renderRentabilidad(data.rentabilidad);
  } catch (err) {
    console.error("No se pudo obtener el presupuesto:", err);
  }
}

addBudgetCategoryBtn.addEventListener("click", async () => {
  const label = budgetNuevoLabel.value.trim();
  if (!label) return;
  const keywords = budgetNuevoKeywords.value.split(",").map((k) => k.trim()).filter(Boolean);
  const tipo = budgetNuevoTipo.value;
  const body = { label, keywords, tipo };
  if (tipo === "meta") {
    body.metaDefault = budgetNuevoMeta.value;
    body.saldoInicialDefault = budgetNuevoSaldoInicial.value;
  } else {
    body.limiteDefault = budgetNuevoLimite.value === "" ? null : budgetNuevoLimite.value;
  }
  await fetch("/api/budget/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  budgetNuevoLabel.value = "";
  budgetNuevoKeywords.value = "";
  budgetNuevoLimite.value = "";
  budgetNuevoMeta.value = "";
  budgetNuevoSaldoInicial.value = "";
  await fetchBudgetCategories();
});

// ---------- Finanzas: Gastos programados (solo planificación) ----------
const scheduledExpensesList = document.getElementById("scheduledExpensesList");
const schedExpLabel = document.getElementById("schedExpLabel");
const schedExpMonto = document.getElementById("schedExpMonto");
const schedExpTipo = document.getElementById("schedExpTipo");
const schedExpRangoFields = document.getElementById("schedExpRangoFields");
const schedExpSemanalFields = document.getElementById("schedExpSemanalFields");
const schedExpFechaInicio = document.getElementById("schedExpFechaInicio");
const schedExpFechaFin = document.getElementById("schedExpFechaFin");
const schedExpDia = document.getElementById("schedExpDia");
const schedExpFechaInicioSemanal = document.getElementById("schedExpFechaInicioSemanal");
const schedExpFechaFinSemanal = document.getElementById("schedExpFechaFinSemanal");
const addSchedExpBtn = document.getElementById("addSchedExpBtn");

const DIAS_SEMANA_LABEL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function toggleSchedExpFields() {
  const esSemanal = schedExpTipo.value === "semanal";
  schedExpRangoFields.classList.toggle("hidden", esSemanal);
  schedExpSemanalFields.classList.toggle("hidden", !esSemanal);
}
schedExpTipo.addEventListener("change", toggleSchedExpFields);
toggleSchedExpFields();

async function fetchScheduledExpenses() {
  try {
    const res = await fetch("/api/finance/scheduled-expenses");
    const data = await res.json();
    renderScheduledExpenses(data.gastos || []);
  } catch (err) {
    console.error("No se pudo obtener los gastos programados:", err);
  }
}

function renderScheduledExpenses(gastos) {
  scheduledExpensesList.innerHTML = "";
  if (gastos.length === 0) {
    const p = document.createElement("p");
    p.className = "text-xs text-slate-400";
    p.textContent = "No tienes gastos programados todavía.";
    scheduledExpensesList.appendChild(p);
    return;
  }
  gastos.forEach((g) => {
    const row = document.createElement("div");
    row.className = "card bg-white py-3";

    const nombre = document.createElement("p");
    nombre.className = "font-semibold text-slate-800 text-sm";
    nombre.textContent = `${g.label} — ${formatSoles(g.monto)}${g.activo === false ? " (inactivo)" : ""}`;

    const detalle = document.createElement("p");
    detalle.className = "text-xs text-slate-500 mt-1";
    detalle.textContent =
      g.tipo === "rango"
        ? `Del ${g.fechaInicio} al ${g.fechaFin}`
        : `Cada ${DIAS_SEMANA_LABEL[g.dia]}${g.fechaFin ? ` (hasta ${g.fechaFin})` : " (indefinido)"}, desde ${g.fechaInicio}`;

    const acciones = document.createElement("div");
    acciones.className = "flex items-center gap-2 mt-2";

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "btn-capsule bg-slate-100 text-slate-600 text-xs px-3 py-1.5";
    toggleBtn.textContent = g.activo === false ? "Activar" : "Desactivar";
    toggleBtn.addEventListener("click", async () => {
      await fetch(`/api/finance/scheduled-expenses/${g.id}/activo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: g.activo === false }),
      });
      await fetchScheduledExpenses();
    });

    const editBtn = document.createElement("button");
    editBtn.className = "btn-capsule bg-slate-100 text-slate-600 text-xs px-3 py-1.5";
    editBtn.textContent = "Editar monto";
    editBtn.addEventListener("click", async () => {
      const nuevoMonto = prompt("Nuevo monto (S/):", g.monto);
      if (nuevoMonto === null) return;
      await fetch(`/api/finance/scheduled-expenses/${g.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto: nuevoMonto }),
      });
      await fetchScheduledExpenses();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn-capsule bg-rose-100 text-rose-700 text-xs px-3 py-1.5";
    delBtn.textContent = "Eliminar";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar "${g.label}"?`)) return;
      await fetch(`/api/finance/scheduled-expenses/${g.id}`, { method: "DELETE" });
      await fetchScheduledExpenses();
    });

    acciones.appendChild(toggleBtn);
    acciones.appendChild(editBtn);
    acciones.appendChild(delBtn);

    row.appendChild(nombre);
    row.appendChild(detalle);
    row.appendChild(acciones);
    scheduledExpensesList.appendChild(row);
  });
}

addSchedExpBtn.addEventListener("click", async () => {
  const label = schedExpLabel.value.trim();
  const monto = parseFloat(schedExpMonto.value) || 0;
  const tipo = schedExpTipo.value;
  if (!label) return;

  const body = { label, monto, tipo };
  if (tipo === "rango") {
    if (!schedExpFechaInicio.value || !schedExpFechaFin.value) {
      alert("Elige fecha de inicio y fecha de fin.");
      return;
    }
    body.fechaInicio = schedExpFechaInicio.value;
    body.fechaFin = schedExpFechaFin.value;
  } else {
    if (!schedExpFechaInicioSemanal.value) {
      alert("Elige desde qué fecha empieza a repetirse.");
      return;
    }
    body.dia = schedExpDia.value;
    body.fechaInicio = schedExpFechaInicioSemanal.value;
    body.fechaFin = schedExpFechaFinSemanal.value || null;
  }

  const res = await fetch("/api/finance/scheduled-expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    alert(err.error || "No se pudo agregar el gasto programado.");
    return;
  }

  schedExpLabel.value = "";
  schedExpMonto.value = "";
  schedExpFechaInicio.value = "";
  schedExpFechaFin.value = "";
  schedExpFechaInicioSemanal.value = "";
  schedExpFechaFinSemanal.value = "";
  await fetchScheduledExpenses();
});

// ---------- Finanzas: Custodia (plata de otras personas) ----------
// Antes esto era de una sola persona fija ("Ana") escrita en el código,
// así que cualquier cliente veía la pestaña con el nombre de una
// desconocida. Ahora cada cuenta arma su lista.
const custodiasList = document.getElementById("custodiasList");
const custodiasEmpty = document.getElementById("custodiasEmpty");
const custodiaNuevoNombre = document.getElementById("custodiaNuevoNombre");
const addCustodiaBtn = document.getElementById("addCustodiaBtn");

// Dibuja los movimientos de una persona, desplegables dentro de su tarjeta.
function renderMovimientosCustodia(container, clave) {
  return async () => {
    let movimientos;
    try {
      const res = await fetch(`/api/finance/custodias/${encodeURIComponent(clave)}/movements`);
      movimientos = (await res.json()).movimientos || [];
    } catch (err) {
      return;
    }

    container.innerHTML = "";
    if (movimientos.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "text-xs text-slate-400 text-center py-2";
      vacio.textContent = "Sin movimientos todavía.";
      container.appendChild(vacio);
      return;
    }

    movimientos
      .slice()
      .reverse()
      .forEach((m) => {
        const row = document.createElement("div");
        row.className = "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs bg-slate-50 border border-slate-100";

        const info = document.createElement("div");
        info.className = "min-w-0";
        const l1 = document.createElement("p");
        l1.className = `font-semibold break-words ${m.tipo === "guardo" ? "text-violet-700" : "text-amber-700"}`;
        l1.textContent = `${m.tipo === "guardo" ? "+" : "-"}${formatSoles(m.monto)} · ${m.tipo === "guardo" ? "te dejó" : "gastó"}`;
        const l2 = document.createElement("p");
        l2.className = "text-slate-400";
        l2.textContent = `${fmtFecha(m.fecha)} ${m.hora}${m.descripcion ? " · " + m.descripcion : ""}`;
        info.appendChild(l1);
        info.appendChild(l2);

        const acciones = document.createElement("div");
        acciones.className = "flex items-center gap-1 shrink-0";

        const editBtn = document.createElement("button");
        editBtn.innerHTML = '<i class="fa-solid fa-pen text-slate-400"></i>';
        editBtn.className = "w-7 h-7 flex items-center justify-center";
        editBtn.addEventListener("click", async () => {
          const nuevoMonto = prompt("Nuevo monto:", m.monto);
          if (nuevoMonto === null) return;
          const monto = parseFloat(nuevoMonto);
          if (!Number.isFinite(monto) || monto <= 0) return;
          await fetch(`/api/finance/custodias/${encodeURIComponent(clave)}/movements/${m.index}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ monto }),
          });
          await fetchCustodias();
        });

        const delBtn = document.createElement("button");
        delBtn.innerHTML = '<i class="fa-solid fa-trash text-rose-400"></i>';
        delBtn.className = "w-7 h-7 flex items-center justify-center";
        delBtn.addEventListener("click", async () => {
          if (!confirm("¿Eliminar este movimiento?")) return;
          await fetch(`/api/finance/custodias/${encodeURIComponent(clave)}/movements/${m.index}`, { method: "DELETE" });
          await fetchCustodias();
        });

        acciones.appendChild(editBtn);
        acciones.appendChild(delBtn);
        row.appendChild(info);
        row.appendChild(acciones);
        container.appendChild(row);
      });
  };
}

function renderCustodias(personas) {
  custodiasList.innerHTML = "";
  custodiasEmpty.classList.toggle("hidden", personas.length > 0);

  personas.forEach((p) => {
    const card = document.createElement("div");
    card.className = "card bg-white py-3";

    const top = document.createElement("div");
    top.className = "flex items-center justify-between gap-2";
    const nombre = document.createElement("span");
    nombre.className = "font-semibold text-slate-800 text-sm";
    nombre.textContent = p.label;
    const saldo = document.createElement("span");
    saldo.className = "font-bold text-violet-700";
    saldo.textContent = formatSoles(p.saldo);
    top.appendChild(nombre);
    top.appendChild(saldo);
    card.appendChild(top);

    const detalle = document.createElement("p");
    detalle.className = "text-xs text-slate-500 mt-0.5";
    detalle.textContent = `te dejó ${formatSoles(p.guardado)} · gastó ${formatSoles(p.gastado)} · en tu poder ahora`;
    card.appendChild(detalle);

    const historial = document.createElement("div");
    historial.className = "hidden space-y-1.5 mt-3 pt-3 border-t border-slate-100";

    const acciones = document.createElement("div");
    acciones.className = "flex items-center gap-2 mt-2 flex-wrap";

    const addMovBtn = document.createElement("button");
    addMovBtn.className = "btn-capsule bg-violet-100 text-violet-700 text-xs py-1.5 px-3";
    addMovBtn.textContent = "Anotar";
    addMovBtn.addEventListener("click", async () => {
      const montoStr = prompt(`¿Cuánto? (positivo = te deja plata, negativo = gastó)`, "");
      if (montoStr === null) return;
      const valor = parseFloat(montoStr);
      if (!Number.isFinite(valor) || valor === 0) return;
      await fetch(`/api/finance/custodias/${encodeURIComponent(p.clave)}/movements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: valor > 0 ? "guardo" : "gasto", monto: Math.abs(valor) }),
      });
      await fetchCustodias();
    });
    acciones.appendChild(addMovBtn);

    const verBtn = document.createElement("button");
    verBtn.className = "btn-capsule bg-blue-50 text-blue-600 text-xs py-1.5 px-3";
    verBtn.textContent = "Ver historial";
    let cargado = false;
    verBtn.addEventListener("click", async () => {
      const oculto = historial.classList.contains("hidden");
      if (oculto) {
        historial.classList.remove("hidden");
        verBtn.textContent = "Ocultar historial";
        if (!cargado) {
          await renderMovimientosCustodia(historial, p.clave)();
          cargado = true;
        }
      } else {
        historial.classList.add("hidden");
        verBtn.textContent = "Ver historial";
      }
    });
    acciones.appendChild(verBtn);

    const editBtn = document.createElement("button");
    editBtn.className = "btn-capsule bg-slate-100 text-slate-600 text-xs py-1.5 px-3";
    editBtn.textContent = "Renombrar";
    editBtn.addEventListener("click", async () => {
      const nuevo = prompt("Nombre de la persona:", p.label);
      if (nuevo === null || !nuevo.trim()) return;
      await fetch(`/api/finance/custodias/${encodeURIComponent(p.clave)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nuevo }),
      });
      await fetchCustodias();
    });
    acciones.appendChild(editBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "btn-capsule bg-rose-100 text-rose-700 text-xs py-1.5 px-3";
    delBtn.textContent = "Eliminar";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar a ${p.label} y todo su historial?`)) return;
      await fetch(`/api/finance/custodias/${encodeURIComponent(p.clave)}`, { method: "DELETE" });
      await fetchCustodias();
    });
    acciones.appendChild(delBtn);

    card.appendChild(acciones);
    card.appendChild(historial);
    custodiasList.appendChild(card);
  });
}

async function fetchCustodias() {
  try {
    const data = await (await fetch("/api/finance/custodias")).json();
    renderCustodias(data.personas || []);
  } catch (err) {
    console.error("No se pudo obtener las custodias:", err);
  }
}

addCustodiaBtn.addEventListener("click", async () => {
  const nombre = custodiaNuevoNombre.value.trim();
  if (!nombre) return;
  const res = await fetch("/api/finance/custodias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre }),
  });
  const data = await res.json();
  if (!data.ok) {
    alert(data.error || "No se pudo agregar.");
    return;
  }
  custodiaNuevoNombre.value = "";
  await fetchCustodias();
});


// ---------- Finanzas: Consultas (frases y respuestas editables) ----------
const queryIntentsList = document.getElementById("queryIntentsList");

const CAMPOS_RESPUESTA_LABELS = {
  respuesta: "Respuesta",
  respuestaVacia: "Respuesta cuando no hay nada que mostrar (ej. nadie debe)",
  respuestaCumplida: "Respuesta cuando ya se cumplió la meta",
  respuestaSinMeta: "Respuesta cuando no hay meta configurada",
  respuestaSinLimite: "Respuesta cuando la categoría no tiene límite",
  respuestaSinCategoria: "Respuesta cuando no existe esa categoría",
  respuestaFaltante: "Respuesta cuando todavía falta cubrir la necesidad",
};

function renderQueryIntents(intents) {
  queryIntentsList.innerHTML = "";
  intents.forEach((intent) => {
    const card = document.createElement("div");
    card.className = "card bg-white py-3";

    const titulo = document.createElement("p");
    titulo.className = "font-semibold text-slate-800 text-sm";
    titulo.textContent = intent.label;
    card.appendChild(titulo);

    const hint = document.createElement("p");
    hint.className = "text-[11px] text-slate-400 mt-0.5";
    hint.textContent =
      intent.tipo === "prefijo"
        ? "El mensaje debe EMPEZAR con una de estas frases"
        : "El mensaje puede contener cualquiera de estas frases";
    card.appendChild(hint);

    const frasesWrap = document.createElement("div");
    frasesWrap.className = "flex flex-wrap gap-1.5 mt-2";
    intent.frases.forEach((frase) => {
      const chip = document.createElement("div");
      chip.className = "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs bg-teal-50 text-teal-700";
      const label = document.createElement("span");
      label.textContent = frase;
      const removeBtn = document.createElement("button");
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark text-[10px]"></i>';
      removeBtn.className = "opacity-60 hover:opacity-100";
      removeBtn.addEventListener("click", async () => {
        await fetch(`/api/finance/query-intents/${intent.id}/phrases`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frase }),
        });
        await fetchQueryIntents();
      });
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      frasesWrap.appendChild(chip);
    });
    card.appendChild(frasesWrap);

    const addFraseWrap = document.createElement("div");
    addFraseWrap.className = "flex gap-2 mt-2";
    const fraseInput = document.createElement("input");
    fraseInput.type = "text";
    fraseInput.placeholder = "Nueva frase...";
    fraseInput.className = "flex-1 min-w-0 bg-white rounded-xl px-3 py-2 text-xs border border-slate-200";
    const addFraseBtn = document.createElement("button");
    addFraseBtn.className = "w-8 h-8 shrink-0 rounded-xl bg-teal-600 text-white flex items-center justify-center active:scale-90 transition-all";
    addFraseBtn.innerHTML = '<i class="fa-solid fa-plus text-xs"></i>';
    addFraseBtn.addEventListener("click", async () => {
      const frase = fraseInput.value.trim();
      if (!frase) return;
      await fetch(`/api/finance/query-intents/${intent.id}/phrases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frase }),
      });
      await fetchQueryIntents();
    });
    addFraseWrap.appendChild(fraseInput);
    addFraseWrap.appendChild(addFraseBtn);
    card.appendChild(addFraseWrap);

    Object.keys(CAMPOS_RESPUESTA_LABELS).forEach((campo) => {
      if (intent[campo] === undefined) return;
      const wrap = document.createElement("div");
      wrap.className = "mt-3";
      const label = document.createElement("p");
      label.className = "text-[11px] font-semibold text-slate-500 mb-1";
      label.textContent = CAMPOS_RESPUESTA_LABELS[campo];
      const textarea = document.createElement("textarea");
      textarea.rows = 2;
      textarea.value = intent[campo];
      textarea.className = "w-full bg-white rounded-xl px-3 py-2 text-xs border border-slate-200";
      const saveBtn = document.createElement("button");
      saveBtn.className = "mt-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-600 active:scale-95 transition-all";
      saveBtn.textContent = "Guardar";
      saveBtn.addEventListener("click", async () => {
        await fetch(`/api/finance/query-intents/${intent.id}/response`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campo, texto: textarea.value }),
        });
        saveBtn.textContent = "Guardado ✓";
        setTimeout(() => (saveBtn.textContent = "Guardar"), 1500);
      });
      wrap.appendChild(label);
      wrap.appendChild(textarea);
      wrap.appendChild(saveBtn);
      card.appendChild(wrap);
    });

    queryIntentsList.appendChild(card);
  });
}

async function fetchQueryIntents() {
  try {
    const res = await fetch("/api/finance/query-intents");
    const data = await res.json();
    renderQueryIntents(data.intents || []);
  } catch (err) {
    console.error("No se pudo obtener las consultas:", err);
  }
}

openReminders.addEventListener("click", () => {
  remindersOverlay.classList.remove("hidden");
  remindersOverlay.classList.add("flex");
  updateNewReminderFields();
  renderReminders();
  renderHistorialPagos();
  renderTasks();
});

closeReminders.addEventListener("click", () => {
  remindersOverlay.classList.add("hidden");
  remindersOverlay.classList.remove("flex");
  fetchReminderBadge();
});

// ---------- Precios de productos ----------
const priceImportInput = document.getElementById("priceImportInput");
const priceImportBtn = document.getElementById("priceImportBtn");
const priceImportStatus = document.getElementById("priceImportStatus");
const priceSearchInput = document.getElementById("priceSearchInput");
const priceList = document.getElementById("priceList");
const priceCount = document.getElementById("priceCount");

function formatearPrecioSoles(n) {
  return Number.isInteger(n) ? `S/ ${n}` : `S/ ${n.toFixed(2)}`;
}

function renderPrices(precios) {
  priceCount.textContent = precios.length;
  priceList.innerHTML = "";

  if (precios.length === 0) {
    const p = document.createElement("p");
    p.className = "text-xs text-slate-400";
    p.textContent = priceSearchInput.value.trim()
      ? "Ningún precio con esa búsqueda."
      : "Todavía no hay precios guardados.";
    priceList.appendChild(p);
    return;
  }

  precios.forEach((item) => {
    const fila = document.createElement("div");
    fila.className = "flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-slate-200 text-sm";

    const precio = document.createElement("span");
    precio.className = "shrink-0 font-bold text-brand-green";
    precio.textContent = formatearPrecioSoles(item.precio);

    const desc = document.createElement("span");
    desc.className = "flex-1 min-w-0 truncate text-slate-600";
    desc.textContent = item.descripcion;
    desc.title = item.descripcion;

    const borrar = document.createElement("button");
    borrar.innerHTML = '<i class="fa-solid fa-xmark text-xs"></i>';
    borrar.className = "shrink-0 text-slate-400 hover:text-brand-red";
    borrar.title = "Borrar este precio";
    borrar.addEventListener("click", async () => {
      if (!confirm(`¿Borrar "${formatearPrecioSoles(item.precio)} ${item.descripcion}"?`)) return;
      const res = await fetch(`/api/prices/${item.id}/remove`, { method: "POST" });
      if (res.ok) fetchPrices();
    });

    fila.appendChild(precio);
    fila.appendChild(desc);
    fila.appendChild(borrar);
    priceList.appendChild(fila);
  });
}

async function fetchPrices() {
  try {
    const q = priceSearchInput.value.trim();
    const res = await fetch(`/api/prices${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    const data = await res.json();
    renderPrices(data.precios || []);
  } catch (err) {
    console.error("No se pudo cargar los precios:", err);
  }
}

priceSearchInput.addEventListener("input", () => fetchPrices());

priceImportBtn.addEventListener("click", async () => {
  const texto = priceImportInput.value.trim();
  if (!texto) return;
  try {
    const res = await fetch("/api/prices/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });
    const data = await res.json();
    // Se avisa cuántas líneas no se entendieron (y cuáles), así se pueden
    // corregir en vez de darlas por cargadas.
    let msg = `Se cargaron ${data.agregados} precio${data.agregados === 1 ? "" : "s"} ✓`;
    if (data.ignoradas?.length) {
      msg += `\nNo se entendieron ${data.ignoradas.length}: ${data.ignoradas.slice(0, 3).join(" | ")}`;
    }
    priceImportStatus.textContent = msg;
    priceImportStatus.className = `text-xs mt-2 whitespace-pre-line ${
      data.ignoradas?.length ? "text-brand-orange" : "text-brand-green"
    }`;
    if (data.agregados > 0) priceImportInput.value = "";
    renderPrices(data.precios || []);
  } catch (err) {
    priceImportStatus.textContent = "No se pudieron cargar los precios.";
    priceImportStatus.className = "text-xs mt-2 text-brand-red";
  }
});

// ---------- Respaldo de los datos ----------
// La descarga es un <a href="/api/backup" download>, no hace falta JS.
// Acá va solo la restauración, que sí necesita confirmación: primero se
// lee el archivo y se muestra qué trae, y recién ahí se pisan los datos.
const backupFileInput = document.getElementById("backupFileInput");
const backupPreview = document.getElementById("backupPreview");
const backupPreviewText = document.getElementById("backupPreviewText");
const backupRestoreBtn = document.getElementById("backupRestoreBtn");
const backupStatus = document.getElementById("backupStatus");

let backupPendiente = null;

function mostrarEstadoBackup(texto, esError) {
  backupStatus.textContent = texto;
  backupStatus.className = `text-xs mt-2 whitespace-pre-line ${esError ? "text-brand-red" : "text-brand-green"}`;
}

backupFileInput.addEventListener("change", async () => {
  backupPreview.classList.add("hidden");
  backupPendiente = null;
  backupStatus.textContent = "";

  const archivo = backupFileInput.files?.[0];
  if (!archivo) return;

  try {
    const contenido = JSON.parse(await archivo.text());
    const res = await fetch("/api/backup/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backup: contenido }),
    });
    const data = await res.json();
    if (!res.ok) {
      mostrarEstadoBackup(data.error || "No se pudo leer el respaldo", true);
      return;
    }
    const r = data.resumen;
    const fecha = r.fecha ? new Date(r.fecha).toLocaleString("es-PE") : "sin fecha";
    backupPreviewText.textContent =
      `Respaldo del ${fecha}\n` +
      `· ${r.diasCerrados} días de caja cerrados\n` +
      `· ${r.movimientos} movimientos\n` +
      `· ${r.precios} precios de productos\n` +
      `· ${r.archivos} archivos de datos`;
    backupPendiente = contenido;
    backupPreview.classList.remove("hidden");
  } catch (err) {
    mostrarEstadoBackup("Ese archivo no es un respaldo válido.", true);
  }
});

backupRestoreBtn.addEventListener("click", async () => {
  if (!backupPendiente) return;
  if (!confirm("Esto REEMPLAZA tus datos actuales por los del respaldo. ¿Seguro?")) return;

  backupRestoreBtn.disabled = true;
  try {
    const res = await fetch("/api/backup/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backup: backupPendiente }),
    });
    const data = await res.json();
    if (res.ok) {
      backupPreview.classList.add("hidden");
      backupFileInput.value = "";
      backupPendiente = null;
      mostrarEstadoBackup(`Restaurado ✓ (${data.restaurados.length} archivos)\n⚠️ ${data.aviso}`, false);
    } else {
      mostrarEstadoBackup(data.error || "No se pudo restaurar", true);
    }
  } catch (err) {
    mostrarEstadoBackup("No se pudo restaurar", true);
  }
  backupRestoreBtn.disabled = false;
});

// ---------- Inicialización ----------
document.addEventListener("DOMContentLoaded", () => {
  fetchSesion();
  fetchMarca();
  fetchChatConfig();
  updateBotUI();
  pollStatus();
  setInterval(pollStatus, 3000);
  fetchCashboxToday();
  setInterval(fetchCashboxToday, 15000);
  fetchFinanceSummaryExtras();
  fetchReminderBadge();
  setInterval(fetchReminderBadge, 60000);
  showFinanceTab("financeTabResumen");
  updatePushStatus();
});
