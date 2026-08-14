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

const timeWindowBySectorList = document.getElementById("timeWindowBySectorList");
const antiguedadInput = document.getElementById("antiguedadInput");
const saveAntiguedadBtn = document.getElementById("saveAntiguedadBtn");
const antiguedadStatus = document.getElementById("antiguedadStatus");

const statusCard = document.getElementById("statusCard");
const esperaAutomaticaToggle = document.getElementById("esperaAutomaticaToggle");
const esperaAutomaticaLabel = document.getElementById("esperaAutomaticaLabel");
const pendingTimeCount = document.getElementById("pendingTimeCount");
const pendingTimeList = document.getElementById("pendingTimeList");
const pendingTimeToggleBtn = document.getElementById("pendingTimeToggleBtn");
const pendingTimeChevron = document.getElementById("pendingTimeChevron");

const moveGroupSelect = document.getElementById("moveGroupSelect");
const moveSectorSelect = document.getElementById("moveSectorSelect");
const moveGroupBtn = document.getElementById("moveGroupBtn");

const noRemarcarGroupSelect = document.getElementById("noRemarcarGroupSelect");
const remarcarOverrideSelect = document.getElementById("remarcarOverrideSelect");
const saveRemarcarOverrideBtn = document.getElementById("saveRemarcarOverrideBtn");

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
    const sectorFocusBtn = sectorNode.querySelector(".sector-focus-btn");
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
      rowEl.classList.toggle("group-inactive", grupo.active === false);
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
          rowEl.classList.toggle("group-inactive", !nuevoEstado);
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

    // Enfoca de una todos los grupos de este sector. Para sacar uno puntual
    // después, se usa el mismo 🎯 de ese grupo (toggle individual de siempre).
    sectorFocusBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const res = await fetch(`/api/focus/sector/${encodeURIComponent(sector.id)}`, { method: "POST" });
        const data = await res.json();
        focusedGroups = data.focusedGroups || [];
        updateFocusUI();
        renderSectors(searchInput.value);
      } catch (err) {
        console.error("No se pudo enfocar el sector:", err);
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

  // Si todo lo enfocado es del mismo sector (completo o parcial, por si se
  // sacó algún grupo puntual), se muestra el nombre del sector en vez de
  // listar cada grupo: ya se ve en la lista cuál quedó sin enfocar.
  const sectorIdsEnfocados = new Set(
    focusedGroups.map((id) => groupsData.find((g) => g.id === id)?.sectorId || "otros")
  );
  const sectorUnico =
    sectorIdsEnfocados.size === 1 ? sectorDefs.find((s) => s.id === [...sectorIdsEnfocados][0]) : null;

  if (sectorUnico) {
    focusGroupName.textContent = `Sector ${sectorUnico.label}`;
  } else {
    const nombres = focusedGroups
      .map((id) => groupsData.find((g) => g.id === id)?.name || id)
      .join(", ");
    focusGroupName.textContent = nombres;
  }
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
// La tarjeta ahora es una sola (bot + espera + conexión), así que también
// se le cambia el color de fondo: verde cuando el bot está activo, rojo
// cuando no, para saberlo de un vistazo sin leer.
function pintarStatusCard(activo) {
  statusCard.classList.toggle("bg-emerald-50", activo);
  statusCard.classList.toggle("border-emerald-100", activo);
  statusCard.classList.toggle("bg-rose-50", !activo);
  statusCard.classList.toggle("border-rose-100", !activo);
  statusCard.querySelectorAll(".border-t").forEach((sep) => {
    sep.classList.toggle("border-emerald-100", activo);
    sep.classList.toggle("border-rose-100", !activo);
  });
}

function updateBotUI() {
  if (!isConnected) {
    botStatusText.textContent = "Bot ⛔ Desconectado";
    botToggleLabel.textContent = "Activar";
    botToggleBtn.disabled = true;
    botToggleBtn.classList.remove("bg-brand-green");
    botToggleBtn.classList.add("bg-brand-red", "opacity-50");
    qrCard.classList.remove("hidden");
    pintarStatusCard(false);
  } else if (isActive) {
    botStatusText.textContent = "Bot ✅ Activo";
    botToggleLabel.textContent = "Desactivar";
    botToggleBtn.disabled = false;
    botToggleBtn.classList.remove("bg-brand-red", "opacity-50");
    botToggleBtn.classList.add("bg-brand-green");
    qrCard.classList.add("hidden");
    pintarStatusCard(true);
  } else {
    botStatusText.textContent = "Bot ⛔ Inactivo";
    botToggleLabel.textContent = "Activar";
    botToggleBtn.disabled = false;
    botToggleBtn.classList.remove("bg-brand-green", "opacity-50");
    botToggleBtn.classList.add("bg-brand-red");
    qrCard.classList.add("hidden");
    pintarStatusCard(false);
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
logoutBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  closeDrawerFn();
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
  refreshHistoryCount();
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
  closeDrawerFn();
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

// ---------- Ventana de tiempo por sector (0 a 60 minutos) ----------
let timeWindowPorSector = {};

function renderTimeWindowBySector() {
  timeWindowBySectorList.innerHTML = "";
  sectorDefs.forEach((sector) => {
    const fila = document.createElement("div");
    fila.className = "flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-slate-200";

    const label = document.createElement("span");
    label.className = "flex-1 min-w-0 text-sm text-slate-600 truncate";
    label.textContent = sector.label;

    const input = document.createElement("input");
    input.type = "number";
    input.min = 0;
    input.max = 60;
    input.value = timeWindowPorSector[sector.id] ?? 15;
    input.className = "w-16 shrink-0 bg-slate-50 rounded-lg px-2 py-1 text-sm border border-slate-200 text-center";

    const guardar = document.createElement("button");
    guardar.textContent = "Guardar";
    guardar.className = "shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold bg-blue-500 text-white active:scale-95 transition-all";
    guardar.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/config/timewindow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sectorId: sector.id, minutes: parseInt(input.value, 10) }),
        });
        const data = await res.json();
        if (res.ok) {
          timeWindowPorSector = data.porSector;
          input.value = timeWindowPorSector[sector.id];
        } else {
          alert(data.error || "No se pudo guardar");
        }
      } catch (err) {
        console.error("No se pudo cambiar la ventana de tiempo:", err);
      }
    });

    fila.appendChild(label);
    fila.appendChild(input);
    fila.appendChild(guardar);
    timeWindowBySectorList.appendChild(fila);
  });
}

async function fetchTimeWindow() {
  try {
    const res = await fetch("/api/config/timewindow");
    const data = await res.json();
    timeWindowPorSector = data.porSector || {};
    if (data.antiguedadMaximaMin !== undefined) antiguedadInput.value = data.antiguedadMaximaMin;
  } catch (err) {
    console.error("No se pudo obtener la ventana de tiempo:", err);
  }
  renderTimeWindowBySector();
}

saveAntiguedadBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/config/antiguedad", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minutos: parseInt(antiguedadInput.value, 10) }),
    });
    const data = await res.json();
    if (res.ok) {
      antiguedadInput.value = data.antiguedadMaximaMin;
      antiguedadStatus.textContent = `Guardado ✓ Se descartan los mensajes de más de ${data.antiguedadMaximaMin} min.`;
      antiguedadStatus.className = "text-xs mt-2 text-brand-green";
    } else {
      antiguedadStatus.textContent = data.error || "No se pudo guardar";
      antiguedadStatus.className = "text-xs mt-2 text-brand-red";
    }
  } catch (err) {
    antiguedadStatus.textContent = "No se pudo guardar";
    antiguedadStatus.className = "text-xs mt-2 text-brand-red";
  }
  setTimeout(() => {
    antiguedadStatus.textContent = "";
  }, 3000);
});

// ---------- Espera automática + pedidos en espera (tarjeta principal) ----------
let esperaAutomaticaActiva = true;

function updateEsperaAutomaticaUI() {
  if (esperaAutomaticaActiva) {
    esperaAutomaticaLabel.textContent = "Activada";
    esperaAutomaticaToggle.classList.remove("bg-slate-300");
    esperaAutomaticaToggle.classList.add("bg-brand-green");
  } else {
    esperaAutomaticaLabel.textContent = "Desactivada";
    esperaAutomaticaToggle.classList.remove("bg-brand-green");
    esperaAutomaticaToggle.classList.add("bg-slate-300");
  }
}

async function fetchEsperaAutomatica() {
  try {
    const res = await fetch("/api/config/timewindow");
    const data = await res.json();
    esperaAutomaticaActiva = Boolean(data.esperaAutomaticaActiva);
  } catch (err) {
    console.error("No se pudo obtener el estado de espera automática:", err);
  }
  updateEsperaAutomaticaUI();
}

esperaAutomaticaToggle.addEventListener("click", async () => {
  const nuevoEstado = !esperaAutomaticaActiva;
  try {
    const res = await fetch("/api/config/espera-automatica", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: nuevoEstado }),
    });
    const data = await res.json();
    esperaAutomaticaActiva = Boolean(data.active);
  } catch (err) {
    console.error("No se pudo cambiar la espera automática:", err);
  }
  updateEsperaAutomaticaUI();
});

// La lista de pedidos en espera arranca plegada (la tarjeta es compacta a
// propósito): se despliega tocando "⏳ Espera automática".
let pendingTimeAbierto = false;

function aplicarVisibilidadPendientes(hayPendientes) {
  pendingTimeChevron.classList.toggle("hidden", !hayPendientes);
  pendingTimeChevron.classList.toggle("fa-chevron-up", pendingTimeAbierto);
  pendingTimeChevron.classList.toggle("fa-chevron-down", !pendingTimeAbierto);
  pendingTimeList.classList.toggle("hidden", !hayPendientes || !pendingTimeAbierto);
}

pendingTimeToggleBtn.addEventListener("click", () => {
  pendingTimeAbierto = !pendingTimeAbierto;
  aplicarVisibilidadPendientes(pendingTimeList.children.length > 0);
});

function renderPendingTimeMatches(pendientes) {
  pendingTimeCount.textContent = pendientes.length;
  // Resalta el contador solo cuando hay algo esperando, para que se note
  // sin ocupar más espacio.
  pendingTimeCount.className = `shrink-0 text-xs font-bold ${
    pendientes.length > 0 ? "text-brand-orange" : "text-slate-400"
  }`;
  pendingTimeList.innerHTML = "";
  if (pendientes.length === 0) {
    pendingTimeAbierto = false;
    aplicarVisibilidadPendientes(false);
    return;
  }

  pendientes.forEach((p) => {
    const hora = new Date(p.targetFireMs);
    const horaTexto = `${String(hora.getHours()).padStart(2, "0")}:${String(hora.getMinutes()).padStart(2, "0")}`;

    const fila = document.createElement("div");
    fila.className = "flex items-center gap-2 text-xs";

    // El nombre del grupo se recorta si no entra, pero la hora NO: es el
    // dato que importa (a qué hora se va a marcar ese pedido).
    const texto = document.createElement("span");
    texto.className = "flex-1 min-w-0 truncate text-slate-500";
    texto.textContent = p.groupName;

    const horaMarca = document.createElement("span");
    horaMarca.className = "shrink-0 font-semibold text-slate-600";
    horaMarca.textContent = horaTexto;

    const cancelar = document.createElement("button");
    cancelar.textContent = "Cancelar";
    cancelar.className = "shrink-0 text-brand-red font-semibold";
    cancelar.addEventListener("click", async () => {
      await fetch(`/api/pending-time-matches/${p.id}/cancel`, { method: "POST" });
      fetchPendingTimeMatches();
    });

    fila.appendChild(texto);
    fila.appendChild(horaMarca);
    fila.appendChild(cancelar);
    pendingTimeList.appendChild(fila);
  });

  aplicarVisibilidadPendientes(true);
}

async function fetchPendingTimeMatches() {
  try {
    const res = await fetch("/api/pending-time-matches");
    const data = await res.json();
    renderPendingTimeMatches(data.pendientes || []);
  } catch (err) {
    console.error("No se pudo obtener los pedidos en espera:", err);
  }
}

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

// ---------- Números ignorados (editable desde el panel) ----------
const excludedNumberInput = document.getElementById("excludedNumberInput");
const addExcludedNumberBtn = document.getElementById("addExcludedNumberBtn");
const excludedNumberList = document.getElementById("excludedNumberList");
const excludedNumberCount = document.getElementById("excludedNumberCount");
const excludedNumberStatus = document.getElementById("excludedNumberStatus");

// Muestra "930 475 931" en vez de "930475931" (más fácil de leer y de
// comparar contra el número que te llegó por WhatsApp).
function formatearNumero(n) {
  const d = String(n).replace(/\D/g, "");
  if (d.length === 9) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("51")) {
    const local = d.slice(2);
    return `+51 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  return d;
}

function mostrarEstadoNumero(texto, esError) {
  excludedNumberStatus.textContent = texto;
  excludedNumberStatus.className = `text-xs mb-2 ${esError ? "text-brand-red" : "text-brand-green"}`;
  setTimeout(() => {
    excludedNumberStatus.textContent = "";
  }, 3000);
}

function renderExcludedNumbers(numeros) {
  excludedNumberList.innerHTML = "";
  excludedNumberCount.textContent = numeros.length;

  numeros.forEach((n) => {
    const fila = document.createElement("div");
    fila.className = "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm bg-rose-50 text-rose-700";

    const label = document.createElement("span");
    label.className = "truncate font-mono";
    label.textContent = formatearNumero(n);

    const quitar = document.createElement("button");
    quitar.innerHTML = '<i class="fa-solid fa-xmark text-xs"></i>';
    quitar.className = "shrink-0 opacity-60 hover:opacity-100";
    quitar.title = "Quitar de la lista";
    quitar.addEventListener("click", async () => {
      if (!confirm(`¿Quitar ${formatearNumero(n)} de los ignorados? El bot volverá a responderle.`)) return;
      const res = await fetch("/api/excluded-numbers/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero: n }),
      });
      const data = await res.json();
      if (res.ok) {
        renderExcludedNumbers(data.numeros);
        mostrarEstadoNumero("Número quitado ✓", false);
      } else {
        mostrarEstadoNumero(data.error || "No se pudo quitar", true);
      }
    });

    fila.appendChild(label);
    fila.appendChild(quitar);
    excludedNumberList.appendChild(fila);
  });
}

async function fetchExcludedNumbers() {
  try {
    const res = await fetch("/api/excluded-numbers");
    const data = await res.json();
    renderExcludedNumbers(data.numeros || []);
  } catch (err) {
    console.error("No se pudo cargar los números ignorados:", err);
  }
}

addExcludedNumberBtn.addEventListener("click", async () => {
  const numero = excludedNumberInput.value.trim();
  if (!numero) return;
  const res = await fetch("/api/excluded-numbers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ numero }),
  });
  const data = await res.json();
  if (res.ok) {
    excludedNumberInput.value = "";
    renderExcludedNumbers(data.numeros);
    mostrarEstadoNumero("Número agregado ✓ El bot ya no le responde.", false);
  } else {
    mostrarEstadoNumero(data.error || "No se pudo agregar", true);
  }
});

excludedNumberInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addExcludedNumberBtn.click();
});

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

// ---------- Cotizaciones de delivery (zona no mapeada) ----------
const quoteGroupList = document.getElementById("quoteGroupList");
const quoteGroupSelect = document.getElementById("quoteGroupSelect");
const addQuoteGroupBtn = document.getElementById("addQuoteGroupBtn");
const quoteAnyoneCheck = document.getElementById("quoteAnyoneCheck");
const quoteNumbersBlock = document.getElementById("quoteNumbersBlock");
const quoteNumberList = document.getElementById("quoteNumberList");
const quoteNumberInput = document.getElementById("quoteNumberInput");
const addQuoteNumberBtn = document.getElementById("addQuoteNumberBtn");
const quoteMessageInput = document.getElementById("quoteMessageInput");
const saveQuoteMessageBtn = document.getElementById("saveQuoteMessageBtn");
const quoteConfigStatus = document.getElementById("quoteConfigStatus");

let quoteConfigData = { groupNames: [], anyoneCanQuote: false, authorizedNumbers: [], message: "" };

function mostrarEstadoCotizacion(texto, esError) {
  quoteConfigStatus.textContent = texto;
  quoteConfigStatus.className = `text-xs mt-2 ${esError ? "text-brand-red" : "text-brand-green"}`;
  setTimeout(() => {
    quoteConfigStatus.textContent = "";
  }, 3000);
}

function renderQuoteConfig() {
  // Grupos configurados. Se avisa si un grupo guardado ya no existe en
  // WhatsApp (nombre cambiado o el bot salió), porque si no la cotización
  // se mandaría a la nada sin que se note.
  quoteGroupList.innerHTML = "";
  if (quoteConfigData.groupNames.length === 0) {
    const p = document.createElement("p");
    p.className = "text-xs text-brand-red";
    p.textContent = "⚠ Sin grupos: las cotizaciones no se van a enviar a ninguna parte.";
    quoteGroupList.appendChild(p);
  } else {
    quoteConfigData.groupNames.forEach((name) => {
      const existe = groupsData.some((g) => g.name.trim().toUpperCase() === name.trim().toUpperCase());
      const chip = document.createElement("div");
      chip.className = `flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
        existe ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"
      }`;
      const label = document.createElement("span");
      label.className = "truncate";
      label.textContent = existe ? name : `${name} (no encontrado)`;
      const removeBtn = document.createElement("button");
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark text-xs"></i>';
      removeBtn.className = "shrink-0 opacity-60 hover:opacity-100";
      removeBtn.addEventListener("click", async () => {
        await fetch("/api/quote-config/groups/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        await fetchQuoteConfig();
        mostrarEstadoCotizacion("Grupo quitado ✓", false);
      });
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      quoteGroupList.appendChild(chip);
    });
  }

  // Dropdown para agregar: solo los grupos que todavía no están puestos.
  const seleccionActual = quoteGroupSelect.value;
  quoteGroupSelect.innerHTML = '<option value="">— Agregar un grupo —</option>';
  groupsData
    .filter((g) => !quoteConfigData.groupNames.some((n) => n.trim().toUpperCase() === g.name.trim().toUpperCase()))
    .forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.name;
      opt.textContent = g.name;
      quoteGroupSelect.appendChild(opt);
    });
  if (seleccionActual) quoteGroupSelect.value = seleccionActual;

  // Quién puede cotizar
  quoteAnyoneCheck.checked = quoteConfigData.anyoneCanQuote;
  quoteNumbersBlock.classList.toggle("hidden", quoteConfigData.anyoneCanQuote);

  quoteNumberList.innerHTML = "";
  if (quoteConfigData.authorizedNumbers.length === 0) {
    const p = document.createElement("p");
    p.className = "text-xs text-brand-red";
    p.textContent = "⚠ Sin números: nadie va a poder responder la tarifa.";
    quoteNumberList.appendChild(p);
  } else {
    quoteConfigData.authorizedNumbers.forEach((number) => {
      const chip = document.createElement("div");
      chip.className = "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm bg-slate-100 text-slate-700";
      const label = document.createElement("span");
      label.className = "truncate";
      label.textContent = number;
      const removeBtn = document.createElement("button");
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark text-xs"></i>';
      removeBtn.className = "shrink-0 opacity-60 hover:opacity-100";
      removeBtn.addEventListener("click", async () => {
        await fetch("/api/quote-config/numbers/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ number }),
        });
        await fetchQuoteConfig();
        mostrarEstadoCotizacion("Número quitado ✓", false);
      });
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      quoteNumberList.appendChild(chip);
    });
  }

  // El textarea no se pisa mientras lo estás editando.
  if (document.activeElement !== quoteMessageInput) {
    quoteMessageInput.value = quoteConfigData.message;
  }
}

async function fetchQuoteConfig() {
  try {
    const res = await fetch("/api/quote-config");
    quoteConfigData = await res.json();
    renderQuoteConfig();
  } catch (err) {
    console.error("No se pudo cargar la config de cotizaciones:", err);
  }
}

addQuoteGroupBtn.addEventListener("click", async () => {
  const name = quoteGroupSelect.value;
  if (!name) return;
  const res = await fetch("/api/quote-config/groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  quoteGroupSelect.value = "";
  await fetchQuoteConfig();
  mostrarEstadoCotizacion(res.ok ? "Grupo agregado ✓" : "No se pudo agregar", !res.ok);
});

quoteAnyoneCheck.addEventListener("change", async () => {
  const res = await fetch("/api/quote-config/anyone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anyoneCanQuote: quoteAnyoneCheck.checked }),
  });
  await fetchQuoteConfig();
  mostrarEstadoCotizacion(res.ok ? "Guardado ✓" : "No se pudo guardar", !res.ok);
});

addQuoteNumberBtn.addEventListener("click", async () => {
  const number = quoteNumberInput.value.trim();
  if (!number) return;
  const res = await fetch("/api/quote-config/numbers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ number }),
  });
  quoteNumberInput.value = "";
  await fetchQuoteConfig();
  mostrarEstadoCotizacion(res.ok ? "Número agregado ✓" : "No se pudo agregar", !res.ok);
});

quoteNumberInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addQuoteNumberBtn.click();
});

saveQuoteMessageBtn.addEventListener("click", async () => {
  const message = quoteMessageInput.value.trim();
  if (!message) {
    mostrarEstadoCotizacion("El mensaje no puede estar vacío", true);
    return;
  }
  const res = await fetch("/api/quote-config/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  await fetchQuoteConfig();
  mostrarEstadoCotizacion(res.ok ? "Mensaje guardado ✓" : "No se pudo guardar", !res.ok);
});

// ---------- Pedidos sin texto: foto / contacto / nota de voz ----------
// Las tres listas funcionan igual, así que se manejan con el mismo código:
// cada bloque del panel lleva data-media-tipo="imagen|contacto|audio".
const MEDIA_LISTAS = {
  imagen: document.getElementById("imagenTriggerList"),
  contacto: document.getElementById("contactoTriggerList"),
  audio: document.getElementById("audioTriggerList"),
};
const MEDIA_COLORES = {
  imagen: "bg-orange-50 text-orange-700",
  contacto: "bg-indigo-50 text-indigo-700",
  audio: "bg-green-50 text-green-700",
};
const audioSecondsInput = document.getElementById("audioSecondsInput");
const saveAudioSecondsBtn = document.getElementById("saveAudioSecondsBtn");
const audioSecondsStatus = document.getElementById("audioSecondsStatus");
const mediaTriggerStatus = document.getElementById("mediaTriggerStatus");

let mediaTriggerData = { imagen: [], contacto: [], audio: [], audioMaxSegundos: 15 };

function mostrarEstadoMedia(el, texto, esError) {
  el.textContent = texto;
  el.className = `text-xs mb-2 ${esError ? "text-brand-red" : "text-brand-green"}`;
  setTimeout(() => {
    el.textContent = "";
  }, 3000);
}

function renderMediaTriggers() {
  Object.keys(MEDIA_LISTAS).forEach((tipo) => {
    const cont = MEDIA_LISTAS[tipo];
    const nombres = mediaTriggerData[tipo] || [];
    cont.innerHTML = "";

    if (nombres.length === 0) {
      const p = document.createElement("p");
      p.className = "text-xs text-slate-400";
      p.textContent = "Ningún grupo configurado.";
      cont.appendChild(p);
      return;
    }

    nombres.forEach((name) => {
      // Avisa si el grupo guardado ya no existe en WhatsApp (le cambiaron el
      // nombre o el bot salió): si no, quedaría configurado y sin efecto.
      const existe = groupsData.some((g) => g.name.trim().toUpperCase() === name.trim().toUpperCase());
      const chip = document.createElement("div");
      chip.className = `flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
        existe ? MEDIA_COLORES[tipo] : "bg-amber-50 text-amber-700"
      }`;

      const label = document.createElement("span");
      label.className = "truncate";
      label.textContent = existe ? name : `${name} (no encontrado)`;

      const quitar = document.createElement("button");
      quitar.innerHTML = '<i class="fa-solid fa-xmark text-xs"></i>';
      quitar.className = "shrink-0 opacity-60 hover:opacity-100";
      quitar.addEventListener("click", async () => {
        const res = await fetch("/api/media-triggers/groups/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo, name }),
        });
        const data = await res.json();
        if (res.ok) {
          mediaTriggerData = data;
          renderMediaTriggers();
          mostrarEstadoMedia(mediaTriggerStatus, "Grupo quitado ✓", false);
        } else {
          mostrarEstadoMedia(mediaTriggerStatus, data.error || "No se pudo quitar", true);
        }
      });

      chip.appendChild(label);
      chip.appendChild(quitar);
      cont.appendChild(chip);
    });
  });

  // Cada desplegable ofrece solo los grupos que todavía no están en ESA lista.
  document.querySelectorAll(".media-group-select").forEach((select) => {
    const tipo = select.dataset.mediaTipo;
    const seleccionActual = select.value;
    select.innerHTML = '<option value="">— Agregar un grupo —</option>';
    groupsData
      .filter((g) => !(mediaTriggerData[tipo] || []).some((n) => n.trim().toUpperCase() === g.name.trim().toUpperCase()))
      .forEach((g) => {
        const opt = document.createElement("option");
        opt.value = g.name;
        opt.textContent = g.name;
        select.appendChild(opt);
      });
    if (seleccionActual) select.value = seleccionActual;
  });

  if (document.activeElement !== audioSecondsInput) {
    audioSecondsInput.value = mediaTriggerData.audioMaxSegundos;
  }
}

async function fetchMediaTriggers() {
  try {
    const res = await fetch("/api/media-triggers");
    mediaTriggerData = await res.json();
    renderMediaTriggers();
  } catch (err) {
    console.error("No se pudo cargar los pedidos sin texto:", err);
  }
}

document.querySelectorAll(".media-add-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const tipo = btn.dataset.mediaTipo;
    const select = document.querySelector(`.media-group-select[data-media-tipo="${tipo}"]`);
    const name = select.value;
    if (!name) return;
    const res = await fetch("/api/media-triggers/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, name }),
    });
    const data = await res.json();
    if (res.ok) {
      mediaTriggerData = data;
      select.value = "";
      renderMediaTriggers();
      mostrarEstadoMedia(mediaTriggerStatus, "Grupo agregado ✓", false);
    } else {
      mostrarEstadoMedia(mediaTriggerStatus, data.error || "No se pudo agregar", true);
    }
  });
});

saveAudioSecondsBtn.addEventListener("click", async () => {
  const res = await fetch("/api/media-triggers/audio-seconds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segundos: audioSecondsInput.value }),
  });
  const data = await res.json();
  if (res.ok) {
    mediaTriggerData.audioMaxSegundos = data.audioMaxSegundos;
    mostrarEstadoMedia(audioSecondsStatus, `Guardado ✓ Responde a notas de voz de hasta ${data.audioMaxSegundos} seg.`, false);
  } else {
    mostrarEstadoMedia(audioSecondsStatus, data.error || "No se pudo guardar", true);
    audioSecondsInput.value = mediaTriggerData.audioMaxSegundos;
  }
});

// ---------- Delays personalizados por grupo ----------
const groupDelayList = document.getElementById("groupDelayList");
const groupDelayGroupSelect = document.getElementById("groupDelayGroupSelect");
const groupDelayValueSelect = document.getElementById("groupDelayValueSelect");
const addGroupDelayBtn = document.getElementById("addGroupDelayBtn");
let groupDelayData = [];

function renderGroupDelayValueOptions() {
  groupDelayValueSelect.innerHTML = "";
  for (let ms = 100; ms <= 1000; ms += 100) {
    const opt = document.createElement("option");
    opt.value = ms;
    opt.textContent = `${ms} ms`;
    groupDelayValueSelect.appendChild(opt);
  }
}

function renderGroupDelays() {
  groupDelayList.innerHTML = "";
  if (groupDelayData.length === 0) {
    const p = document.createElement("p");
    p.className = "text-xs text-slate-400";
    p.textContent = "Ningún grupo con delay personalizado todavía.";
    groupDelayList.appendChild(p);
  } else {
    groupDelayData.forEach(({ name, delayMs }) => {
      const chip = document.createElement("div");
      chip.className = "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm bg-fuchsia-50 text-fuchsia-700";
      const label = document.createElement("span");
      label.className = "truncate";
      label.textContent = `${name} — ${delayMs} ms`;
      const removeBtn = document.createElement("button");
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark text-xs"></i>';
      removeBtn.className = "shrink-0 opacity-60 hover:opacity-100";
      removeBtn.addEventListener("click", async () => {
        await fetch("/api/group-delays/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        await fetchGroupDelays();
      });
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      groupDelayList.appendChild(chip);
    });
  }

  const seleccionActual = groupDelayGroupSelect.value;
  groupDelayGroupSelect.innerHTML = '<option value="">— Selecciona un grupo —</option>';
  groupsData.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.name;
    opt.textContent = g.name;
    groupDelayGroupSelect.appendChild(opt);
  });
  if (seleccionActual) groupDelayGroupSelect.value = seleccionActual;
}

async function fetchGroupDelays() {
  try {
    const res = await fetch("/api/group-delays");
    const data = await res.json();
    groupDelayData = data.delays || [];
    renderGroupDelays();
  } catch (err) {
    console.error("No se pudo cargar los delays por grupo:", err);
  }
}

addGroupDelayBtn.addEventListener("click", async () => {
  const name = groupDelayGroupSelect.value;
  if (!name) return;
  const delayMs = parseInt(groupDelayValueSelect.value, 10);
  await fetch("/api/group-delays", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, delayMs }),
  });
  await fetchGroupDelays();
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

// ---------- Mensajes programados (texto + foto opcional, a horas fijas) ----------
const broadcastsList = document.getElementById("broadcastsList");
const newBroadcastNombre = document.getElementById("newBroadcastNombre");
const newBroadcastTexto = document.getElementById("newBroadcastTexto");
const newBroadcastImagen = document.getElementById("newBroadcastImagen");
const newBroadcastImagenPreview = document.getElementById("newBroadcastImagenPreview");
const removeBroadcastImagenBtn = document.getElementById("removeBroadcastImagenBtn");
const newBroadcastGroups = document.getElementById("newBroadcastGroups");
const broadcastGroupSearch = document.getElementById("broadcastGroupSearch");
const broadcastGroupsSelected = document.getElementById("broadcastGroupsSelected");
const broadcastGroupsClearBtn = document.getElementById("broadcastGroupsClearBtn");
const newBroadcastHorariosList = document.getElementById("newBroadcastHorariosList");
const newBroadcastHorarioInput = document.getElementById("newBroadcastHorarioInput");
const addBroadcastHorarioBtn = document.getElementById("addBroadcastHorarioBtn");
const addBroadcastBtn = document.getElementById("addBroadcastBtn");
const cancelBroadcastEditBtn = document.getElementById("cancelBroadcastEditBtn");
const broadcastFormTitle = document.getElementById("broadcastFormTitle");

let broadcastHorarios = [];
let editingBroadcastId = null;
let quitarImagenExistente = false;

// Los grupos elegidos viven acá y NO en los checkboxes del DOM: con el
// buscador, un grupo ya marcado puede quedar fuera del filtro y su
// checkbox deja de existir. Si se leyera del DOM al guardar (como antes),
// esos grupos se perderían sin aviso.
let broadcastGruposElegidos = new Set();

function renderBroadcastGroupsResumen() {
  const total = broadcastGruposElegidos.size;
  broadcastGroupsClearBtn.classList.toggle("hidden", total === 0);
  if (total === 0) {
    broadcastGroupsSelected.textContent = "Ninguno seleccionado";
    broadcastGroupsSelected.className = "text-[11px] text-slate-400 mb-1";
    return;
  }
  // Se listan por nombre para poder confirmar la selección aunque el
  // buscador los tenga ocultos en ese momento.
  const nombres = groupsData
    .filter((g) => broadcastGruposElegidos.has(g.id))
    .map((g) => g.name);
  broadcastGroupsSelected.textContent = `${total} seleccionado${total === 1 ? "" : "s"}: ${nombres.join(", ")}`;
  broadcastGroupsSelected.className = "text-[11px] text-brand-green font-semibold mb-1";
}

function renderBroadcastGroupsChecklist(seleccionados) {
  if (seleccionados !== undefined) {
    broadcastGruposElegidos = new Set(seleccionados || []);
    broadcastGroupSearch.value = "";
  }
  renderBroadcastGroupsResumen();

  newBroadcastGroups.innerHTML = "";
  if (groupsData.length === 0) {
    const p = document.createElement("p");
    p.className = "text-xs text-slate-400";
    p.textContent = "No hay grupos disponibles (conecta el bot primero).";
    newBroadcastGroups.appendChild(p);
    return;
  }

  const filtro = broadcastGroupSearch.value.trim().toLowerCase();
  const visibles = filtro
    ? groupsData.filter((g) => g.name.toLowerCase().includes(filtro))
    : groupsData;

  if (visibles.length === 0) {
    const p = document.createElement("p");
    p.className = "text-xs text-slate-400";
    p.textContent = `Ningún grupo con "${broadcastGroupSearch.value.trim()}".`;
    newBroadcastGroups.appendChild(p);
    return;
  }

  visibles.forEach((g) => {
    const label = document.createElement("label");
    label.className = "flex items-center gap-2 text-sm text-slate-700 py-0.5";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = g.id;
    checkbox.checked = broadcastGruposElegidos.has(g.id);
    checkbox.className = "shrink-0";
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) broadcastGruposElegidos.add(g.id);
      else broadcastGruposElegidos.delete(g.id);
      renderBroadcastGroupsResumen();
    });
    const span = document.createElement("span");
    span.className = "truncate";
    span.textContent = g.name;
    label.appendChild(checkbox);
    label.appendChild(span);
    newBroadcastGroups.appendChild(label);
  });
}

// Al escribir se repinta la lista filtrada, sin tocar lo ya elegido
// (por eso se llama sin argumento).
broadcastGroupSearch.addEventListener("input", () => renderBroadcastGroupsChecklist());

broadcastGroupsClearBtn.addEventListener("click", () => {
  broadcastGruposElegidos.clear();
  renderBroadcastGroupsChecklist();
});

function renderBroadcastHorariosChips() {
  newBroadcastHorariosList.innerHTML = "";
  broadcastHorarios.forEach((h) => {
    const chip = document.createElement("span");
    chip.className = "inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded-full pl-2.5 pr-1.5 py-1 text-xs";
    chip.textContent = h;
    const del = document.createElement("button");
    del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    del.className = "w-4 h-4 flex items-center justify-center text-slate-400 hover:text-rose-600";
    del.addEventListener("click", () => {
      broadcastHorarios = broadcastHorarios.filter((x) => x !== h);
      renderBroadcastHorariosChips();
    });
    chip.appendChild(del);
    newBroadcastHorariosList.appendChild(chip);
  });
}

addBroadcastHorarioBtn.addEventListener("click", () => {
  const valor = newBroadcastHorarioInput.value;
  if (!valor) return;
  if (!broadcastHorarios.includes(valor)) {
    broadcastHorarios.push(valor);
    broadcastHorarios.sort();
    renderBroadcastHorariosChips();
  }
  newBroadcastHorarioInput.value = "";
});

function resetBroadcastForm() {
  editingBroadcastId = null;
  quitarImagenExistente = false;
  newBroadcastNombre.value = "";
  newBroadcastTexto.value = "";
  newBroadcastImagen.value = "";
  newBroadcastImagenPreview.classList.add("hidden");
  newBroadcastImagenPreview.src = "";
  removeBroadcastImagenBtn.classList.add("hidden");
  broadcastHorarios = [];
  renderBroadcastHorariosChips();
  renderBroadcastGroupsChecklist([]);
  addBroadcastBtn.textContent = "Guardar mensaje programado";
  broadcastFormTitle.innerHTML = '<i class="fa-solid fa-plus"></i> AGREGAR MENSAJE PROGRAMADO';
  cancelBroadcastEditBtn.classList.add("hidden");
}

removeBroadcastImagenBtn.addEventListener("click", () => {
  quitarImagenExistente = true;
  newBroadcastImagenPreview.classList.add("hidden");
  removeBroadcastImagenBtn.classList.add("hidden");
});

cancelBroadcastEditBtn.addEventListener("click", () => {
  resetBroadcastForm();
});

function iniciarEdicionBroadcast(b) {
  editingBroadcastId = b.id;
  quitarImagenExistente = false;
  newBroadcastNombre.value = b.nombre;
  newBroadcastTexto.value = b.texto || "";
  newBroadcastImagen.value = "";
  broadcastHorarios = (b.horarios || []).slice();
  renderBroadcastHorariosChips();
  renderBroadcastGroupsChecklist(b.groupIds || []);
  if (b.imagenArchivo) {
    newBroadcastImagenPreview.src = `/api/broadcasts/${encodeURIComponent(b.id)}/image?t=${Date.now()}`;
    newBroadcastImagenPreview.classList.remove("hidden");
    removeBroadcastImagenBtn.classList.remove("hidden");
  } else {
    newBroadcastImagenPreview.classList.add("hidden");
    removeBroadcastImagenBtn.classList.add("hidden");
  }
  addBroadcastBtn.textContent = "Guardar cambios";
  broadcastFormTitle.innerHTML = `<i class="fa-solid fa-pen"></i> EDITANDO "${b.nombre}"`;
  cancelBroadcastEditBtn.classList.remove("hidden");
}

function textoHorarios(horarios) {
  return (horarios || []).join(", ");
}

function renderBroadcastsList(lista) {
  broadcastsList.innerHTML = "";
  if (lista.length === 0) {
    const p = document.createElement("p");
    p.className = "text-sm text-slate-400";
    p.textContent = "No hay mensajes programados todavía.";
    broadcastsList.appendChild(p);
    return;
  }
  lista.forEach((b) => {
    const card = document.createElement("div");
    card.className = "rounded-xl border p-3 " + (b.activo ? "bg-white border-slate-200" : "bg-slate-50 border-slate-200 opacity-70");

    const top = document.createElement("div");
    top.className = "flex items-start justify-between gap-2";
    const info = document.createElement("div");
    info.className = "min-w-0";
    const nombre = document.createElement("p");
    nombre.className = "text-sm font-semibold text-slate-800 truncate";
    nombre.textContent = b.nombre + (b.imagenArchivo ? " 📷" : "");
    const meta = document.createElement("p");
    meta.className = "text-xs text-slate-400 mt-0.5";
    meta.textContent = `${textoHorarios(b.horarios)} · ${b.groupIds.length} grupo${b.groupIds.length === 1 ? "" : "s"} · ${b.activo ? "activo" : "desactivado"}`;
    info.appendChild(nombre);
    info.appendChild(meta);
    top.appendChild(info);

    const acciones = document.createElement("div");
    acciones.className = "flex items-center gap-1 shrink-0";

    const btnToggle = document.createElement("button");
    btnToggle.className = "w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 active:scale-90 transition-all";
    btnToggle.title = b.activo ? "Desactivar" : "Activar";
    btnToggle.innerHTML = b.activo ? '<i class="fa-solid fa-toggle-on text-brand-green"></i>' : '<i class="fa-solid fa-toggle-off"></i>';
    btnToggle.addEventListener("click", async () => {
      await fetch(`/api/broadcasts/${encodeURIComponent(b.id)}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !b.activo }),
      });
      fetchBroadcasts();
    });
    acciones.appendChild(btnToggle);

    const btnEdit = document.createElement("button");
    btnEdit.className = "w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 active:scale-90 transition-all";
    btnEdit.title = "Editar";
    btnEdit.innerHTML = '<i class="fa-solid fa-pen"></i>';
    btnEdit.addEventListener("click", () => iniciarEdicionBroadcast(b));
    acciones.appendChild(btnEdit);

    const btnDel = document.createElement("button");
    btnDel.className = "w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-brand-red active:scale-90 transition-all";
    btnDel.title = "Eliminar";
    btnDel.innerHTML = '<i class="fa-solid fa-trash"></i>';
    btnDel.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar el mensaje programado "${b.nombre}"?`)) return;
      await fetch(`/api/broadcasts/${encodeURIComponent(b.id)}`, { method: "DELETE" });
      if (editingBroadcastId === b.id) resetBroadcastForm();
      fetchBroadcasts();
    });
    acciones.appendChild(btnDel);

    top.appendChild(acciones);
    card.appendChild(top);
    if (b.texto) {
      const texto = document.createElement("p");
      texto.className = "text-xs text-slate-500 mt-1.5 break-words";
      texto.textContent = b.texto;
      card.appendChild(texto);
    }
    broadcastsList.appendChild(card);
  });
}

async function fetchBroadcasts() {
  try {
    const res = await fetch("/api/broadcasts");
    const data = await res.json();
    renderBroadcastsList(data.broadcasts || []);
  } catch (err) {
    console.error("No se pudo obtener los mensajes programados:", err);
  }
}

addBroadcastBtn.addEventListener("click", async () => {
  const nombre = newBroadcastNombre.value.trim();
  const texto = newBroadcastTexto.value.trim();
  // Se lee del Set y NO de los checkboxes: con el buscador puesto, los
  // grupos elegidos que no coinciden con el filtro no están en el DOM.
  const groupIds = Array.from(broadcastGruposElegidos);
  if (!nombre) {
    alert("Ponle un nombre al mensaje programado.");
    return;
  }
  if (groupIds.length === 0) {
    alert("Elige al menos un grupo.");
    return;
  }
  if (broadcastHorarios.length === 0) {
    alert("Agrega al menos un horario.");
    return;
  }
  const body = { nombre, texto, groupIds, horarios: broadcastHorarios };

  try {
    let broadcastId = editingBroadcastId;
    if (editingBroadcastId) {
      const res = await fetch(`/api/broadcasts/${encodeURIComponent(editingBroadcastId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || "No se pudo guardar los cambios.");
        return;
      }
      if (quitarImagenExistente) {
        await fetch(`/api/broadcasts/${encodeURIComponent(editingBroadcastId)}/image`, { method: "DELETE" });
      }
    } else {
      const res = await fetch("/api/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        alert(data.error || "No se pudo guardar.");
        return;
      }
      broadcastId = data.broadcast.id;
    }

    const archivo = newBroadcastImagen.files[0];
    if (archivo && broadcastId) {
      const formData = new FormData();
      formData.append("imagen", archivo);
      await fetch(`/api/broadcasts/${encodeURIComponent(broadcastId)}/image`, { method: "POST", body: formData });
    }

    resetBroadcastForm();
    await fetchBroadcasts();
  } catch (err) {
    console.error("No se pudo guardar el mensaje programado:", err);
  }
});

// ---------- Categorías de Opciones (ahora directas desde el menú ☰) ----------
// Cada categoría carga sus propios datos recién cuando se abre. Las funciones
// ya existen todas; esto solo cambia desde dónde y cuándo se llaman.
const categoryLoaders = {
  categoryKeywords: () => {
    exceptionNumberInput.value = "";
    exceptionKeywordInput.value = "";
    renderSpecialKeywords(); // repinta lo que ya tenías guardado (localStorage)
    fetchKeywords();
    populateExceptionGroupSelect();
    fetchExceptionsOverview();
  },
  categoryExcluded: () => {
    fetchExcludedNumbers();
  },
  categoryMedia: () => {
    fetchMediaTriggers();
  },
  categoryGroups: () => {
    populateMoveSelects();
    populateNoRemarcarSelect();
    fetchQuoteConfig();
  },
  categoryTiming: () => {
    fetchDelay();
    fetchTimeWindow();
    renderGroupDelayValueOptions();
    fetchGroupDelays();
  },
  categoryGeneral: () => {
    updatePushStatus();
  },
  categoryBroadcasts: () => {
    resetBroadcastForm();
    fetchBroadcasts();
  },
};

document.querySelectorAll("[id^='openCategory']").forEach((link) => {
  const targetId = link.id.replace("openCategory", "category");
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.getElementById(targetId);
    if (!target) return;
    closeDrawerFn();
    target.classList.remove("hidden");
    target.classList.add("flex");
    if (categoryLoaders[targetId]) categoryLoaders[targetId]();
  });
});

document.querySelectorAll(".category-close-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const overlay = btn.closest(".fixed");
    if (overlay) {
      overlay.classList.add("hidden");
      overlay.classList.remove("flex");
    }
  });
});

// ---------- Inicialización ----------
// ---------- Calidad de conexión ----------
// Mide 3 pings reales contra el propio servidor (no una simulación): promedio
// de latencia, variación entre ellos (inestabilidad) y cuántos se cayeron o
// tardaron demasiado (proxy de "pérdida de paquetes"). Si el navegador expone
// navigator.connection, se usa el tipo de red como techo adicional.
const connectionDot = document.getElementById("connectionDot");
const connectionScore = document.getElementById("connectionScore");
const CONNECTION_PING_COUNT = 3;
const CONNECTION_PING_TIMEOUT_MS = 3000;

async function pingUnaVez() {
  const inicio = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTION_PING_TIMEOUT_MS);
  try {
    await fetch("/api/ping", { cache: "no-store", signal: controller.signal });
    return performance.now() - inicio;
  } catch (err) {
    return null; // timeout o error de red: cuenta como caída
  } finally {
    clearTimeout(timer);
  }
}

function calcularPuntajeConexion(latencias, fallos, totalPings, effectiveType) {
  const exitosos = latencias.length;
  if (exitosos === 0) return 0;
  const avg = latencias.reduce((a, b) => a + b, 0) / exitosos;
  const variance = latencias.reduce((a, b) => a + (b - avg) ** 2, 0) / exitosos;
  const stdev = Math.sqrt(variance);
  let score = 10 - avg / 60;
  score -= Math.min(stdev / 100, 3);
  const lossRatio = fallos / totalPings;
  score = score * (1 - lossRatio);
  if (effectiveType === "slow-2g") score = Math.min(score, 2);
  else if (effectiveType === "2g") score = Math.min(score, 4);
  else if (effectiveType === "3g") score = Math.min(score, 7);
  return Math.max(0, Math.min(10, score));
}

function pintarConexion(score) {
  // Sin "/ 10": la tarjeta es compacta y el número solo ya se entiende.
  connectionScore.textContent = score.toFixed(1);
  let color;
  if (score >= 7) color = "#22C55E"; // verde: excelente/buena
  else if (score >= 5) color = "#EAB308"; // amarillo: regular
  else if (score >= 3) color = "#F97316"; // naranja: mala
  else color = "#EF4444"; // rojo: muy mala
  connectionDot.style.backgroundColor = color;
  connectionScore.style.color = color;
}

async function medirConexion() {
  const latencias = [];
  let fallos = 0;
  for (let i = 0; i < CONNECTION_PING_COUNT; i++) {
    const ms = await pingUnaVez();
    if (ms === null) fallos++;
    else latencias.push(ms);
  }
  const effectiveType = navigator.connection?.effectiveType;
  const score = calcularPuntajeConexion(latencias, fallos, CONNECTION_PING_COUNT, effectiveType);
  pintarConexion(score);
}

document.addEventListener("DOMContentLoaded", async () => {
  updateBotUI();
  await fetchSectors();
  renderSectors();
  pollStatus();
  setInterval(pollStatus, 3000);
  // Refresca la lista de grupos cada rato (solo redibuja si algo cambió).
  setInterval(() => {
    if (isConnected) fetchGroups();
  }, 20000);
  // Refresca qué grupos tienen candado (excepciones) cada rato.
  setInterval(() => {
    if (isConnected) fetchExceptionsForLocks();
  }, 30000);
  // Espera automática (tarjeta principal) + pedidos en espera.
  fetchEsperaAutomatica();
  fetchPendingTimeMatches();
  setInterval(() => {
    if (isConnected) fetchPendingTimeMatches();
  }, 20000);
  // Calidad de conexión (3 pings reales al servidor cada 12s).
  medirConexion();
  setInterval(medirConexion, 12000);
});
