/* =========================================
   WhatsApp Bot Dashboard — Lógica principal
   ========================================= */

// ---------- Referencias del DOM ----------
const qrCard = document.getElementById("qrCard");
const qrCanvas = document.getElementById("qrCanvas");
const qrHint = document.getElementById("qrHint");

const sectorListEl = document.getElementById("sectorList");
const sectorTemplate = document.getElementById("sectorTemplate");
const groupTemplate = document.getElementById("groupTemplate");
const searchInput = document.getElementById("searchInput");
const emptyState = document.getElementById("emptyState");
const notConnectedState = document.getElementById("notConnectedState");
const visibleCount = document.getElementById("visibleCount");
const groupCount = document.getElementById("groupCount");
const focusCard = document.getElementById("focusCard");
const focusGroupName = document.getElementById("focusGroupName");
const restoreBtn = document.getElementById("restoreBtn");

const statGanancias = document.getElementById("statGanancias");
const statGastos = document.getElementById("statGastos");
const statTotal = document.getElementById("statTotal");

const botToggleBtn = document.getElementById("botToggleBtn");
const botToggleLabel = document.getElementById("botToggleLabel");
const botStatusText = document.getElementById("botStatusText");

const logoutBtn = document.getElementById("logoutBtn");

const togglePushBtn = document.getElementById("togglePushBtn");
const pushStatus = document.getElementById("pushStatus");

const menuBtn = document.getElementById("menuBtn");
const closeDrawer = document.getElementById("closeDrawer");
const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");

const historyLink = document.getElementById("historyLink");
const historyOverlay = document.getElementById("historyOverlay");
const closeHistory = document.getElementById("closeHistory");
const historyList = document.getElementById("historyList");
const historyEmpty = document.getElementById("historyEmpty");
const historyCount = document.getElementById("historyCount");

const delaySelect = document.getElementById("delaySelect");
const saveDelayBtn = document.getElementById("saveDelayBtn");

const timeWindowSelect = document.getElementById("timeWindowSelect");
const saveTimeWindowBtn = document.getElementById("saveTimeWindowBtn");

const moveGroupSelect = document.getElementById("moveGroupSelect");
const moveSectorSelect = document.getElementById("moveSectorSelect");
const moveGroupBtn = document.getElementById("moveGroupBtn");

const noRemarcarGroupSelect = document.getElementById("noRemarcarGroupSelect");
const remarcarOverrideSelect = document.getElementById("remarcarOverrideSelect");
const saveRemarcarOverrideBtn = document.getElementById("saveRemarcarOverrideBtn");

const keywordsLink = document.getElementById("keywordsLink");
const keywordsOverlay = document.getElementById("keywordsOverlay");
const closeKeywords = document.getElementById("closeKeywords");
const positiveKeywordList = document.getElementById("positiveKeywordList");
const positiveKeywordInput = document.getElementById("positiveKeywordInput");
const addPositiveKeywordBtn = document.getElementById("addPositiveKeywordBtn");
const excludedKeywordList = document.getElementById("excludedKeywordList");
const excludedKeywordInput = document.getElementById("excludedKeywordInput");
const addExcludedKeywordBtn = document.getElementById("addExcludedKeywordBtn");
const specialGroupSelect = document.getElementById("specialGroupSelect");
const specialKeywordList = document.getElementById("specialKeywordList");
const specialKeywordInput = document.getElementById("specialKeywordInput");
const addSpecialKeywordBtn = document.getElementById("addSpecialKeywordBtn");

const exceptionsOverview = document.getElementById("exceptionsOverview");
const exceptionsOverviewEmpty = document.getElementById("exceptionsOverviewEmpty");
const exceptionGroupSelect = document.getElementById("exceptionGroupSelect");
const exceptionNumberInput = document.getElementById("exceptionNumberInput");
const exceptionKeywordInput = document.getElementById("exceptionKeywordInput");
const addExceptionKeywordBtn = document.getElementById("addExceptionKeywordBtn");

let groupsData = [];
let focusedGroups = [];
let sectorDefs = [];
let sectorActiveMap = {};
let sectorSinRemarcarActiveMap = {};
let isConnected = false;
let isActive = true;
let lastRenderedQr = null;
let qrInstance = null;
let groupsWithExceptions = new Set();
let sectorsWithExceptions = new Set();

// Calcula qué grupos (y en qué sectores caen) tienen excepciones de número
// configuradas, para poder mostrarles el candado 🔒 en la lista.
async function fetchExceptionsForLocks() {
  try {
    const res = await fetch("/api/exceptions");
    const data = await res.json();
    const nuevosGrupos = new Set();
    Object.entries(data.exceptions || {}).forEach(([key, list]) => {
      if (!list || list.length === 0) return;
      const [groupId] = key.split("::");
      nuevosGrupos.add(groupId);
    });
    const nuevosSectores = new Set(
      groupsData.filter((g) => nuevosGrupos.has(g.id)).map((g) => g.sectorId || "otros")
    );

    // Solo se redibuja la lista si los candados realmente cambiaron.
    // Antes se redibujaba SIEMPRE (cada 30s), y ese redibujo hacía que la
    // página "saltara" sola hacia arriba mientras estabas leyendo abajo.
    const sinCambios =
      nuevosGrupos.size === groupsWithExceptions.size &&
      [...nuevosGrupos].every((id) => groupsWithExceptions.has(id)) &&
      nuevosSectores.size === sectorsWithExceptions.size &&
      [...nuevosSectores].every((id) => sectorsWithExceptions.has(id));

    groupsWithExceptions = nuevosGrupos;
    sectorsWithExceptions = nuevosSectores;
    if (!sinCambios) renderSectors(searchInput.value);
  } catch (err) {
    console.error("No se pudo obtener las excepciones para los candados:", err);
  }
}

// ---------- Render de sectores y sus grupos ----------
function renderSectors(filtro = "") {
  // Se guarda dónde estaba el usuario para devolverlo ahí después de
  // redibujar: si no, cada redibujo lo mandaba arriba de la página.
  const scrollAntes = window.scrollY;

  sectorListEl.innerHTML = "";
  const term = filtro.trim().toLowerCase();
  let totalVisibles = 0;

  sectorDefs.forEach((sector) => {
    const gruposDelSector = groupsData.filter((g) => (g.sectorId || "otros") === sector.id);
    const gruposFiltrados = term
      ? gruposDelSector.filter((g) => g.name.toLowerCase().includes(term))
      : gruposDelSector;

    // Si hay búsqueda y este sector no tiene coincidencias, se omite
    if (term && gruposFiltrados.length === 0) return;

    totalVisibles += gruposFiltrados.length;

    const sectorNode = sectorTemplate.content.cloneNode(true);
    const nameEl = sectorNode.querySelector(".sector-name");
    const sectorLockIcon = sectorNode.querySelector(".sector-lock-icon");
    const header = sectorNode.querySelector(".sector-header");
    const badge = sectorNode.querySelector(".sector-toggle-badge");
    const sinRemarcarBadge = sectorNode.querySelector(".sector-sinremarcar-badge");
    const groupsContainer = sectorNode.querySelector(".sector-groups");

    nameEl.textContent = sector.label;
    if (sectorsWithExceptions.has(sector.id)) sectorLockIcon.classList.remove("hidden");
    updateSectorBadge(badge, sectorActiveMap[sector.id] !== false);
    updateSinRemarcarBadge(sinRemarcarBadge, sectorSinRemarcarActiveMap[sector.id] !== false);

    gruposFiltrados.forEach((grupo) => {
      const groupNode = groupTemplate.content.cloneNode(true);
      const rowEl = groupNode.querySelector(".group-row");
      const nameSpan = groupNode.querySelector(".group-name");
      const groupLockIcon = groupNode.querySelector(".group-lock-icon");
      const noRemarcarIcon = groupNode.querySelector(".group-noremarcar-icon");
      const activeBadge = groupNode.querySelector(".group-active-badge");
      const focusBtn = groupNode.querySelector(".focus-btn");

      nameSpan.textContent = grupo.name;
      if (groupsWithExceptions.has(grupo.id)) groupLockIcon.classList.remove("hidden");
      if (grupo.sinRemarcarEfectivo) noRemarcarIcon.classList.remove("hidden");

      const estaEnfocado = focusedGroups.includes(grupo.id);
      if (estaEnfocado) {
        rowEl.classList.add("bg-orange-50");
        focusBtn.classList.add("selected");
      }

      updateActiveBadge(activeBadge, grupo.active !== false);
      activeBadge.addEventListener("click", async (e) => {
        e.stopPropagation();
        const nuevoEstado = !(grupo.active !== false);
        try {
          await fetch(`/api/groups/${encodeURIComponent(grupo.id)}/active`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: nuevoEstado }),
          });
          grupo.active = nuevoEstado;
          updateActiveBadge(activeBadge, nuevoEstado);
        } catch (err) {
          console.error("No se pudo cambiar el estado del grupo:", err);
        }
      });

      focusBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          const res = await fetch(`/api/focus/${encodeURIComponent(grupo.id)}`, { method: "POST" });
          const data = await res.json();
          focusedGroups = data.focusedGroups || [];
          updateFocusUI();
          renderSectors(searchInput.value);
        } catch (err) {
          console.error("No se pudo enfocar el grupo:", err);
        }
      });

      groupsContainer.appendChild(groupNode);
    });

    // Todos los sectores empiezan desplegados, menos "Otros" (se abre solo si hay búsqueda).
    const shouldOpen = term ? true : sector.id !== "otros";
    if (shouldOpen) groupsContainer.classList.add("open");

    header.addEventListener("click", () => {
      const isOpen = groupsContainer.classList.toggle("open");
      groupsContainer.style.maxHeight = isOpen ? groupsContainer.scrollHeight + "px" : "0px";
    });

    // Enciende/apaga el sector: los grupos siguen mostrándose "Activo",
    // pero el bot deja de responder en ellos mientras esté OFF. Este
    // interruptor solo controla a los grupos que remarcan normal.
    badge.addEventListener("click", async (e) => {
      e.stopPropagation();
      const nuevoEstado = !(sectorActiveMap[sector.id] !== false);
      try {
        await fetch(`/api/sectors/${sector.id}/active`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: nuevoEstado }),
        });
        sectorActiveMap[sector.id] = nuevoEstado;
        updateSectorBadge(badge, nuevoEstado);
      } catch (err) {
        console.error("No se pudo cambiar el estado del sector:", err);
      }
    });

    // Segundo interruptor: independiente del de arriba, solo controla a
    // los grupos "sin remarcar" de este sector (por Comodín o por override).
    sinRemarcarBadge.addEventListener("click", async (e) => {
      e.stopPropagation();
      const nuevoEstado = !(sectorSinRemarcarActiveMap[sector.id] !== false);
      try {
        await fetch(`/api/sectors/${sector.id}/sinremarcaractive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: nuevoEstado }),
        });
        sectorSinRemarcarActiveMap[sector.id] = nuevoEstado;
        updateSinRemarcarBadge(sinRemarcarBadge, nuevoEstado);
      } catch (err) {
        console.error("No se pudo cambiar el estado 'sin remarcar' del sector:", err);
      }
    });

    sectorListEl.appendChild(sectorNode);

    // Recién ahora el sector está insertado en la página, así que scrollHeight
    // ya da la altura real (antes de insertarlo siempre daba 0, y eso hacía
    // que a veces el sector apareciera colapsado por error al recargar).
    if (shouldOpen) groupsContainer.style.maxHeight = groupsContainer.scrollHeight + "px";
  });

  groupCount.textContent = `(${groupsData.length})`;

  if (!isConnected) {
    sectorListEl.classList.add("hidden");
    emptyState.classList.add("hidden");
    notConnectedState.classList.remove("hidden");
    visibleCount.textContent = "Sin conexión";
  } else if (term && totalVisibles === 0) {
    sectorListEl.classList.add("hidden");
    notConnectedState.classList.add("hidden");
    emptyState.classList.remove("hidden");
    visibleCount.textContent = "Sin resultados";
  } else {
    sectorListEl.classList.remove("hidden");
    notConnectedState.classList.add("hidden");
    emptyState.classList.add("hidden");
    visibleCount.textContent = term ? `Mostrando ${totalVisibles} grupo(s)` : "Mostrando todos";
  }

  // Devuelve al usuario a donde estaba antes del redibujo.
  window.scrollTo(0, scrollAntes);
}

function updateSectorBadge(badge, activo) {
  if (activo) {
    badge.textContent = "Sector ON";
    badge.classList.add("on");
    badge.classList.remove("off");
  } else {
    badge.textContent = "Sector OFF";
    badge.classList.add("off");
    badge.classList.remove("on");
  }
}

function updateSinRemarcarBadge(badge, activo) {
  if (activo) {
    badge.textContent = "🔇 ON";
    badge.classList.add("on");
    badge.classList.remove("off");
  } else {
    badge.textContent = "🔇 OFF";
    badge.classList.add("off");
    badge.classList.remove("on");
  }
}

function updateActiveBadge(badge, activo) {
  if (activo) {
    badge.textContent = "Activo";
    badge.className = "group-active-badge badge-active shrink-0 cursor-pointer";
  } else {
    badge.textContent = "Inactivo";
    badge.className = "group-active-badge badge-inactive shrink-0 cursor-pointer";
  }
}

async function fetchSectors() {
  try {
    const res = await fetch("/api/sectors");
    const data = await res.json();
    sectorDefs = data.sectors || [];
    sectorActiveMap = data.sectorActive || {};
    sectorSinRemarcarActiveMap = data.sectorSinRemarcarActive || {};
  } catch (err) {
    console.error("No se pudo obtener la lista de sectores:", err);
  }
}

async function fetchGroups(force = false) {
  try {
    const res = await fetch("/api/groups");
    const data = await res.json();
    const nuevosGrupos = data.groups || [];
    const cambio = JSON.stringify(nuevosGrupos) !== JSON.stringify(groupsData);
    groupsData = nuevosGrupos;
    focusedGroups = data.focusedGroups || [];
    updateFocusUI();
    if (sectorDefs.length === 0) await fetchSectors();
    if (cambio || force) renderSectors(searchInput.value);
  } catch (err) {
    console.error("No se pudo obtener la lista de grupos:", err);
  }
}

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
  } catch (err) {
    console.error("No se pudo obtener la caja chica del día:", err);
  }
}

// ---------- Búsqueda ----------
searchInput.addEventListener("input", (e) => {
  renderSectors(e.target.value);
});

// ---------- Modo enfoque ----------
function updateFocusUI() {
  if (focusedGroups.length === 0) {
    focusCard.classList.add("hidden");
    return;
  }
  focusCard.classList.remove("hidden");
  const nombres = focusedGroups
    .map((id) => groupsData.find((g) => g.id === id)?.name || id)
    .join(", ");
  focusGroupName.textContent = nombres;
}

// Restaura el modo enfoque: todos los grupos vuelven a depender de su
// sector y su estado individual, como antes de enfocar nada.
restoreBtn.addEventListener("click", async () => {
  try {
    await fetch("/api/focus/clear", { method: "POST" });
    focusedGroups = [];
    updateFocusUI();
    renderSectors(searchInput.value);
  } catch (err) {
    console.error("No se pudo restaurar el modo enfoque:", err);
  }
});

// ---------- Estado real del bot ----------
function updateBotUI() {
  if (!isConnected) {
    botStatusText.textContent = "Bot ⛔ Desconectado";
    botToggleLabel.textContent = "Activar";
    botToggleBtn.disabled = true;
    botToggleBtn.classList.remove("bg-brand-green");
    botToggleBtn.classList.add("bg-brand-red", "opacity-50");
    qrCard.classList.remove("hidden");
  } else if (isActive) {
    botStatusText.textContent = "Bot ✅ Activo";
    botToggleLabel.textContent = "Desactivar";
    botToggleBtn.disabled = false;
    botToggleBtn.classList.remove("bg-brand-red", "opacity-50");
    botToggleBtn.classList.add("bg-brand-green");
    qrCard.classList.add("hidden");
  } else {
    botStatusText.textContent = "Bot ⛔ Inactivo";
    botToggleLabel.textContent = "Activar";
    botToggleBtn.disabled = false;
    botToggleBtn.classList.remove("bg-brand-green", "opacity-50");
    botToggleBtn.classList.add("bg-brand-red");
    qrCard.classList.add("hidden");
  }
}

// Activa o desactiva las respuestas automáticas SIN desconectar WhatsApp
botToggleBtn.addEventListener("click", async () => {
  if (!isConnected) return;
  const nuevoEstado = !isActive;
  botToggleBtn.disabled = true;
  try {
    const res = await fetch("/api/bot/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: nuevoEstado }),
    });
    const data = await res.json();
    isActive = Boolean(data.active);
  } catch (err) {
    console.error("No se pudo cambiar el estado del bot:", err);
  }
  updateBotUI();
});

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

// ---------- Polling de estado (conexión + QR) ----------
async function pollStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    const wasConnected = isConnected;
    isConnected = Boolean(data.connected);
    isActive = Boolean(data.active);

    if (isConnected) {
      qrHint.textContent = "";
      lastRenderedQr = null;
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
      qrHint.textContent = "Esperando código QR del servidor…";
    }

    updateBotUI();

    if (isConnected && !wasConnected) {
      // Recién se conectó: carga los grupos y dibuja la lista una vez (forzado,
      // por si todavía no hay grupos y groupsData sigue vacío como antes).
      fetchGroups(true).then(() => fetchExceptionsForLocks());
    } else if (!isConnected && groupsData.length > 0) {
      // Se desconectó: limpia la lista una vez, no en cada poll.
      groupsData = [];
      renderSectors(searchInput.value);
    }
    // Si sigue conectado sin cambios, no se vuelve a dibujar la lista entera
    // en cada poll (eso es lo que causaba el salto de scroll).
  } catch (err) {
    console.error("No se pudo consultar el estado del bot:", err);
  }
}

// ---------- Drawer (menú lateral) ----------
function openDrawer() {
  drawer.classList.add("drawer-open");
  drawerOverlay.classList.add("drawer-overlay-visible");
}

function closeDrawerFn() {
  drawer.classList.remove("drawer-open");
  drawerOverlay.classList.remove("drawer-overlay-visible");
}

menuBtn.addEventListener("click", openDrawer);
closeDrawer.addEventListener("click", closeDrawerFn);
drawerOverlay.addEventListener("click", closeDrawerFn);

// ---------- Historial ----------
function buildHighlightedText(text, matchIndex, matchLength) {
  const p = document.createElement("p");
  p.className = "text-sm text-slate-700 leading-relaxed";
  if (typeof matchIndex !== "number" || matchIndex < 0) {
    p.textContent = text;
    return p;
  }
  const before = text.slice(0, matchIndex);
  const matched = text.slice(matchIndex, matchIndex + matchLength);
  const after = text.slice(matchIndex + matchLength);
  p.appendChild(document.createTextNode(before));
  const mark = document.createElement("span");
  mark.className = "text-green-600 font-bold bg-green-50 rounded px-0.5";
  mark.textContent = matched;
  p.appendChild(mark);
  p.appendChild(document.createTextNode(after));
  return p;
}

function renderHistory(entries) {
  historyList.innerHTML = "";
  historyCount.textContent = `(${entries.length})`;
  if (entries.length === 0) {
    historyEmpty.classList.remove("hidden");
    return;
  }
  historyEmpty.classList.add("hidden");

  entries.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "card bg-white";

    const header = document.createElement("div");
    header.className = "flex items-center justify-between gap-2 mb-2";

    const groupNameEl = document.createElement("span");
    groupNameEl.className = "text-xs font-bold text-slate-800 truncate";
    groupNameEl.textContent = entry.groupName;

    const timeEl = document.createElement("span");
    timeEl.className = "text-[10px] text-slate-400 shrink-0";
    timeEl.textContent = new Date(entry.time).toLocaleString("es-PE");

    header.appendChild(groupNameEl);
    header.appendChild(timeEl);
    card.appendChild(header);
    card.appendChild(buildHighlightedText(entry.text, entry.matchIndex, entry.matchLength));

    historyList.appendChild(card);
  });
}

async function fetchHistory() {
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    renderHistory(data.history || []);
  } catch (err) {
    console.error("No se pudo obtener el historial:", err);
  }
}

historyLink.addEventListener("click", (e) => {
  e.preventDefault();
  historyOverlay.classList.remove("hidden");
  historyOverlay.classList.add("flex");
  fetchHistory();
});

// Actualiza el contador "(N)" del historial apenas se abre Opciones,
// sin necesidad de entrar al historial completo.
async function refreshHistoryCount() {
  try {
    const res = await fetch("/api/history");
    const data = await res.json();
    historyCount.textContent = `(${(data.history || []).length})`;
  } catch (err) {
    console.error("No se pudo obtener el contador del historial:", err);
  }
}

closeHistory.addEventListener("click", () => {
  historyOverlay.classList.add("hidden");
  historyOverlay.classList.remove("flex");
});

// ---------- Delay de respuesta ----------
let currentDelayMs = 300;

function renderDelayOptions() {
  delaySelect.innerHTML = "";
  for (let ms = 100; ms <= 1000; ms += 100) {
    const opt = document.createElement("option");
    opt.value = ms;
    opt.textContent = `${ms} ms`;
    if (ms === currentDelayMs) opt.selected = true;
    delaySelect.appendChild(opt);
  }
}

async function fetchDelay() {
  try {
    const res = await fetch("/api/config/delay");
    const data = await res.json();
    currentDelayMs = data.delayMs;
  } catch (err) {
    console.error("No se pudo obtener el delay:", err);
  }
  renderDelayOptions();
}

saveDelayBtn.addEventListener("click", async () => {
  const ms = parseInt(delaySelect.value, 10);
  try {
    const res = await fetch("/api/config/delay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delayMs: ms }),
    });
    const data = await res.json();
    currentDelayMs = data.delayMs;
    renderDelayOptions();
  } catch (err) {
    console.error("No se pudo cambiar el delay:", err);
  }
});

// ---------- Ventana de tiempo (0 a N minutos) ----------
let currentTimeWindowMinutes = 15;

function renderTimeWindowOptions() {
  timeWindowSelect.innerHTML = "";
  for (let min = 0; min <= 15; min++) {
    const opt = document.createElement("option");
    opt.value = min;
    opt.textContent = min === 1 ? "1 minuto" : `${min} minutos`;
    if (min === currentTimeWindowMinutes) opt.selected = true;
    timeWindowSelect.appendChild(opt);
  }
}

async function fetchTimeWindow() {
  try {
    const res = await fetch("/api/config/timewindow");
    const data = await res.json();
    currentTimeWindowMinutes = data.minutes;
  } catch (err) {
    console.error("No se pudo obtener la ventana de tiempo:", err);
  }
  renderTimeWindowOptions();
}

saveTimeWindowBtn.addEventListener("click", async () => {
  const minutes = parseInt(timeWindowSelect.value, 10);
  try {
    const res = await fetch("/api/config/timewindow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutes }),
    });
    const data = await res.json();
    currentTimeWindowMinutes = data.minutes;
    renderTimeWindowOptions();
  } catch (err) {
    console.error("No se pudo cambiar la ventana de tiempo:", err);
  }
});

// ---------- Palabras clave ----------
let keywordsData = { positive: [], excluded: [], specialByGroup: {} };

function renderKeywordChips(container, items, colorClasses, onRemove) {
  container.innerHTML = "";
  if (items.length === 0) {
    const p = document.createElement("p");
    p.className = "text-xs text-slate-400";
    p.textContent = "Sin keywords extras.";
    container.appendChild(p);
    return;
  }
  items.forEach((phrase) => {
    const chip = document.createElement("div");
    chip.className = `flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${colorClasses}`;
    const label = document.createElement("span");
    label.className = "truncate";
    label.textContent = phrase;
    const removeBtn = document.createElement("button");
    removeBtn.innerHTML = '<i class="fa-solid fa-xmark text-xs"></i>';
    removeBtn.className = "shrink-0 opacity-60 hover:opacity-100";
    removeBtn.addEventListener("click", () => onRemove(phrase));
    chip.appendChild(label);
    chip.appendChild(removeBtn);
    container.appendChild(chip);
  });
}

function renderPositiveKeywords() {
  renderKeywordChips(positiveKeywordList, keywordsData.positive, "bg-green-50 text-green-700", async (phrase) => {
    await fetch("/api/keywords/positive/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrase }),
    });
    await fetchKeywords();
  });
}

function renderExcludedKeywords() {
  renderKeywordChips(excludedKeywordList, keywordsData.excluded, "bg-red-50 text-red-700", async (phrase) => {
    await fetch("/api/keywords/excluded/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrase }),
    });
    await fetchKeywords();
  });
}

// Keywords especiales agregadas desde el panel (no depende de qué grupo esté
// elegido en el dropdown). Se guarda en localStorage para que sobreviva un
// refresco de página — la keyword en sí ya vive en el servidor de todas
// formas, esto es solo para que la sigas viendo acá sin tener que buscarla.
const RECENT_SPECIAL_KEY = "recentSpecialAdds";

function loadRecentSpecialAdds() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SPECIAL_KEY) || "[]");
  } catch (err) {
    return [];
  }
}

function saveRecentSpecialAdds() {
  localStorage.setItem(RECENT_SPECIAL_KEY, JSON.stringify(recentSpecialAdds));
}

let recentSpecialAdds = loadRecentSpecialAdds();

function renderSpecialKeywords() {
  specialKeywordList.innerHTML = "";

  if (recentSpecialAdds.length === 0) return;

  recentSpecialAdds.forEach(({ groupId, groupName, phrase }) => {
    const wrapper = document.createElement("div");
    wrapper.className = "mb-2";

    const label = document.createElement("p");
    label.className = "text-[10px] text-slate-400 mb-1 truncate";
    label.textContent = `Grupo: ${groupName}`;
    wrapper.appendChild(label);

    const chip = document.createElement("div");
    chip.className = "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm bg-orange-50 text-orange-700";

    const text = document.createElement("span");
    text.className = "truncate";
    text.textContent = phrase;

    const removeBtn = document.createElement("button");
    removeBtn.innerHTML = '<i class="fa-solid fa-xmark text-xs"></i>';
    removeBtn.className = "shrink-0 opacity-60 hover:opacity-100";
    removeBtn.addEventListener("click", async () => {
      await fetch(`/api/keywords/special/${encodeURIComponent(groupId)}/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase }),
      });
      recentSpecialAdds = recentSpecialAdds.filter((it) => !(it.groupId === groupId && it.phrase === phrase));
      saveRecentSpecialAdds();
      renderSpecialKeywords();
    });

    chip.appendChild(text);
    chip.appendChild(removeBtn);
    wrapper.appendChild(chip);
    specialKeywordList.appendChild(wrapper);
  });
}

function populateSpecialGroupSelect() {
  const seleccionActual = specialGroupSelect.value;
  specialGroupSelect.innerHTML = '<option value="">— Selecciona un grupo —</option>';
  groupsData.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    specialGroupSelect.appendChild(opt);
  });
  if (seleccionActual) specialGroupSelect.value = seleccionActual;
}

async function fetchKeywords() {
  try {
    const res = await fetch("/api/keywords");
    keywordsData = await res.json();
  } catch (err) {
    console.error("No se pudo obtener las keywords:", err);
  }
  renderPositiveKeywords();
  renderExcludedKeywords();
  populateSpecialGroupSelect();
  // La lista de especiales (recentSpecialAdds) no se toca acá: no depende
  // de esta actualización ni de qué grupo esté elegido en el dropdown.
}

addPositiveKeywordBtn.addEventListener("click", async () => {
  const phrase = positiveKeywordInput.value.trim();
  if (!phrase) return;
  try {
    await fetch("/api/keywords/positive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrase }),
    });
    positiveKeywordInput.value = "";
    await fetchKeywords();
  } catch (err) {
    console.error("No se pudo agregar la keyword:", err);
  }
});

addExcludedKeywordBtn.addEventListener("click", async () => {
  const phrase = excludedKeywordInput.value.trim();
  if (!phrase) return;
  try {
    await fetch("/api/keywords/excluded", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrase }),
    });
    excludedKeywordInput.value = "";
    await fetchKeywords();
  } catch (err) {
    console.error("No se pudo agregar la keyword excluida:", err);
  }
});

// Cambiar de grupo en el dropdown ya NO afecta la lista de keywords
// especiales agregadas (queda fija hasta que cierres el panel o la borres).

addSpecialKeywordBtn.addEventListener("click", async () => {
  const groupId = specialGroupSelect.value;
  const groupName = specialGroupSelect.options[specialGroupSelect.selectedIndex]?.textContent || groupId;
  const phrase = specialKeywordInput.value.trim();
  if (!groupId) {
    alert("Primero elige un grupo.");
    return;
  }
  if (!phrase) return;
  try {
    await fetch(`/api/keywords/special/${encodeURIComponent(groupId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrase }),
    });
    specialKeywordInput.value = "";
    if (!recentSpecialAdds.some((it) => it.groupId === groupId && it.phrase === phrase)) {
      recentSpecialAdds.push({ groupId, groupName, phrase });
      saveRecentSpecialAdds();
    }
    renderSpecialKeywords();
    await fetchKeywords();
  } catch (err) {
    console.error("No se pudo agregar la keyword especial:", err);
  }
});

// ---------- Frases por sector (excepciones número+grupo+frase) ----------
function populateExceptionGroupSelect() {
  const seleccionActual = exceptionGroupSelect.value;
  exceptionGroupSelect.innerHTML = '<option value="">— Selecciona un grupo —</option>';
  groupsData.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    exceptionGroupSelect.appendChild(opt);
  });
  if (seleccionActual) exceptionGroupSelect.value = seleccionActual;
}

async function fetchExceptionsOverview() {
  try {
    const [groupsRes, sectorsRes, exceptionsRes] = await Promise.all([
      fetch("/api/groups").then((r) => r.json()),
      fetch("/api/sectors").then((r) => r.json()),
      fetch("/api/exceptions").then((r) => r.json()),
    ]);
    renderExceptionsOverview(groupsRes.groups, sectorsRes.sectors, exceptionsRes.exceptions);
    fetchExceptionsForLocks();
  } catch (err) {
    console.error("No se pudo obtener las excepciones:", err);
  }
}

function renderExceptionsOverview(groups, sectorDefsList, exceptionsMap) {
  exceptionsOverview.innerHTML = "";

  const groupsById = {};
  groups.forEach((g) => {
    groupsById[g.id] = g;
  });

  // sectorId -> groupId -> { groupName, entries: [{ number, phrase, active }] }
  const bySector = {};
  Object.entries(exceptionsMap).forEach(([key, list]) => {
    if (!list || list.length === 0) return;
    const [groupId, number] = key.split("::");
    const group = groupsById[groupId];
    const sectorId = group ? group.sectorId || "otros" : "otros";
    const groupName = group ? group.name : groupId;
    if (!bySector[sectorId]) bySector[sectorId] = {};
    if (!bySector[sectorId][groupId]) bySector[sectorId][groupId] = { groupName, entries: [] };
    list.forEach((item) => bySector[sectorId][groupId].entries.push({ number, ...item }));
  });

  const sectoresConDatos = sectorDefsList.filter((s) => bySector[s.id]);

  if (sectoresConDatos.length === 0) {
    exceptionsOverviewEmpty.classList.remove("hidden");
    return;
  }
  exceptionsOverviewEmpty.classList.add("hidden");

  sectoresConDatos.forEach((sector) => {
    const sectionEl = document.createElement("div");

    const titleEl = document.createElement("p");
    titleEl.className = "text-xs font-bold text-slate-800 mb-2";
    titleEl.innerHTML = `<i class="fa-solid fa-lock text-rose-500"></i> Frases ${sector.label}`;
    sectionEl.appendChild(titleEl);

    Object.entries(bySector[sector.id]).forEach(([groupId, { groupName, entries }]) => {
      const groupCard = document.createElement("div");
      groupCard.className = "card bg-white mb-2";

      const groupTitle = document.createElement("p");
      groupTitle.className = "text-xs font-bold text-slate-700 mb-2";
      groupTitle.innerHTML = `<i class="fa-solid fa-lock text-slate-400"></i> ${groupName}`;
      groupCard.appendChild(groupTitle);

      entries.forEach(({ number, phrase, active }) => {
        const row = document.createElement("div");
        row.className = "flex items-center justify-between gap-2 py-1.5";

        const label = document.createElement("span");
        label.className = "text-sm text-slate-600 whitespace-pre-line";
        label.textContent = phrase;

        const toggleBtn = document.createElement("button");
        toggleBtn.textContent = active ? "ON" : "OFF";
        toggleBtn.className = `shrink-0 text-[10px] font-bold px-3 py-1 rounded-full ${
          active ? "bg-brand-green text-white" : "bg-slate-300 text-slate-600"
        }`;
        toggleBtn.addEventListener("click", async () => {
          await fetch(`/api/exceptions/${encodeURIComponent(groupId)}/${encodeURIComponent(number)}/toggle`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phrase, active: !active }),
          });
          fetchExceptionsOverview();
        });

        row.appendChild(label);
        row.appendChild(toggleBtn);
        groupCard.appendChild(row);
      });

      sectionEl.appendChild(groupCard);
    });

    exceptionsOverview.appendChild(sectionEl);
  });
}

addExceptionKeywordBtn.addEventListener("click", async () => {
  const groupId = exceptionGroupSelect.value;
  const number = exceptionNumberInput.value.trim();
  const phrase = exceptionKeywordInput.value.trim();
  if (!groupId) {
    alert("Primero elige un grupo.");
    return;
  }
  if (!number) {
    alert("Escribe el número.");
    return;
  }
  if (!phrase) return;
  try {
    await fetch(`/api/exceptions/${encodeURIComponent(groupId)}/${encodeURIComponent(number)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrase }),
    });
    exceptionNumberInput.value = "";
    exceptionKeywordInput.value = "";
    await fetchExceptionsOverview();
  } catch (err) {
    console.error("No se pudo agregar la excepción:", err);
  }
});

// ---------- Mover grupo de sector ----------
function populateMoveSelects() {
  const grupoActual = moveGroupSelect.value;
  moveGroupSelect.innerHTML = '<option value="">— Selecciona un grupo —</option>';
  groupsData.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    moveGroupSelect.appendChild(opt);
  });
  if (grupoActual) moveGroupSelect.value = grupoActual;

  const sectorActual = moveSectorSelect.value;
  moveSectorSelect.innerHTML = '<option value="">— Mover a sector —</option>';
  sectorDefs.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label;
    moveSectorSelect.appendChild(opt);
  });
  if (sectorActual) moveSectorSelect.value = sectorActual;
}

moveGroupBtn.addEventListener("click", async () => {
  const groupId = moveGroupSelect.value;
  const sectorId = moveSectorSelect.value;
  if (!groupId) {
    alert("Primero elige un grupo.");
    return;
  }
  if (!sectorId) {
    alert("Elige a qué sector moverlo.");
    return;
  }
  try {
    await fetch(`/api/groups/${encodeURIComponent(groupId)}/sector`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectorId }),
    });
    const grupo = groupsData.find((g) => g.id === groupId);
    if (grupo) grupo.sectorId = sectorId;
    renderSectors(searchInput.value);
    moveGroupSelect.value = "";
    moveSectorSelect.value = "";
  } catch (err) {
    console.error("No se pudo mover el grupo de sector:", err);
  }
});

// ---------- Grupo: remarcar / sin remarcar (override en cualquier sentido) ----------
function populateNoRemarcarSelect() {
  const seleccionActual = noRemarcarGroupSelect.value;
  noRemarcarGroupSelect.innerHTML = '<option value="">— Selecciona un grupo —</option>';
  groupsData.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.name;
    noRemarcarGroupSelect.appendChild(opt);
  });
  if (seleccionActual) noRemarcarGroupSelect.value = seleccionActual;
  updateRemarcarOverrideUI();
}

function updateRemarcarOverrideUI() {
  const groupId = noRemarcarGroupSelect.value;
  if (!groupId) {
    remarcarOverrideSelect.disabled = true;
    remarcarOverrideSelect.innerHTML = '<option value="">— Elige un grupo primero —</option>';
    saveRemarcarOverrideBtn.disabled = true;
    saveRemarcarOverrideBtn.className =
      "w-full rounded-xl px-4 py-2.5 text-sm font-semibold bg-slate-300 text-slate-500 active:scale-95 transition-all";
    return;
  }
  const grupo = groupsData.find((g) => g.id === groupId);
  remarcarOverrideSelect.disabled = false;
  remarcarOverrideSelect.innerHTML = `
    <option value="">— Usar el del sector —</option>
    <option value="no_remarcar">🔇 Forzar sin remarcar</option>
    <option value="remarcar">💬 Forzar remarcar</option>
  `;
  remarcarOverrideSelect.value = grupo?.remarcarOverride || "";
  saveRemarcarOverrideBtn.disabled = false;
  saveRemarcarOverrideBtn.className =
    "w-full rounded-xl px-4 py-2.5 text-sm font-semibold bg-cyan-600 text-white active:scale-95 transition-all";
}

noRemarcarGroupSelect.addEventListener("change", updateRemarcarOverrideUI);

saveRemarcarOverrideBtn.addEventListener("click", async () => {
  const groupId = noRemarcarGroupSelect.value;
  if (!groupId) return;
  const override = remarcarOverrideSelect.value || null;
  try {
    await fetch(`/api/groups/${encodeURIComponent(groupId)}/remarcar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ override }),
    });
    const grupo = groupsData.find((g) => g.id === groupId);
    if (grupo) grupo.remarcarOverride = override;
    renderSectors(searchInput.value);
  } catch (err) {
    console.error("No se pudo cambiar el override de remarcar del grupo:", err);
  }
});

keywordsLink.addEventListener("click", (e) => {
  e.preventDefault();
  closeDrawerFn();
  keywordsOverlay.classList.remove("hidden");
  keywordsOverlay.classList.add("flex");
  exceptionNumberInput.value = "";
  exceptionKeywordInput.value = "";
  renderSpecialKeywords(); // repinta lo que ya tenías guardado (localStorage)
  fetchKeywords();
  populateExceptionGroupSelect();
  fetchExceptionsOverview();
  populateMoveSelects();
  populateNoRemarcarSelect();
  fetchDelay();
  fetchTimeWindow();
  refreshHistoryCount();
  updatePushStatus();
});

closeKeywords.addEventListener("click", () => {
  keywordsOverlay.classList.add("hidden");
  keywordsOverlay.classList.remove("flex");
});

// ---------- Inicialización ----------
document.addEventListener("DOMContentLoaded", async () => {
  updateBotUI();
  await fetchSectors();
  renderSectors();
  pollStatus();
  setInterval(pollStatus, 3000);
  fetchCashboxToday();
  setInterval(fetchCashboxToday, 15000);
  // Refresca la lista de grupos cada rato (solo redibuja si algo cambió).
  setInterval(() => {
    if (isConnected) fetchGroups();
  }, 20000);
  // Refresca qué grupos tienen candado (excepciones) cada rato.
  setInterval(() => {
    if (isConnected) fetchExceptionsForLocks();
  }, 30000);
});
