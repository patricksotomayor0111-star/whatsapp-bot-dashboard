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
const statCaja = document.getElementById("statCaja");
const statEsperado = document.getElementById("statEsperado");
const statAnaGuardado = document.getElementById("statAnaGuardado");
const statAnaGastado = document.getElementById("statAnaGastado");
const statAnaSaldo = document.getElementById("statAnaSaldo");

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
    if (data.ana) {
      statAnaGuardado.textContent = formatSoles(data.ana.guardado);
      statAnaGastado.textContent = "-" + formatSoles(data.ana.gastado);
      statAnaSaldo.textContent = formatSoles(data.ana.saldo);
    }
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

// ---------- Responder a contacto compartido (por grupo) ----------
const contactTriggerList = document.getElementById("contactTriggerList");
const contactTriggerGroupSelect = document.getElementById("contactTriggerGroupSelect");
const addContactTriggerBtn = document.getElementById("addContactTriggerBtn");
let contactTriggerGroupNames = [];

function renderContactTriggerGroups() {
  contactTriggerList.innerHTML = "";
  if (contactTriggerGroupNames.length === 0) {
    const p = document.createElement("p");
    p.className = "text-xs text-slate-400";
    p.textContent = "Ningún grupo configurado todavía.";
    contactTriggerList.appendChild(p);
  } else {
    contactTriggerGroupNames.forEach((name) => {
      const chip = document.createElement("div");
      chip.className = "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm bg-indigo-50 text-indigo-700";
      const label = document.createElement("span");
      label.className = "truncate";
      label.textContent = name;
      const removeBtn = document.createElement("button");
      removeBtn.innerHTML = '<i class="fa-solid fa-xmark text-xs"></i>';
      removeBtn.className = "shrink-0 opacity-60 hover:opacity-100";
      removeBtn.addEventListener("click", async () => {
        await fetch("/api/contact-trigger-groups/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        await fetchContactTriggerGroups();
      });
      chip.appendChild(label);
      chip.appendChild(removeBtn);
      contactTriggerList.appendChild(chip);
    });
  }

  const seleccionActual = contactTriggerGroupSelect.value;
  contactTriggerGroupSelect.innerHTML = '<option value="">— Agregar un grupo —</option>';
  groupsData
    .filter((g) => !contactTriggerGroupNames.some((n) => n.trim().toUpperCase() === g.name.trim().toUpperCase()))
    .forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.name;
      opt.textContent = g.name;
      contactTriggerGroupSelect.appendChild(opt);
    });
  if (seleccionActual) contactTriggerGroupSelect.value = seleccionActual;
}

async function fetchContactTriggerGroups() {
  try {
    const res = await fetch("/api/contact-trigger-groups");
    const data = await res.json();
    contactTriggerGroupNames = data.groupNames || [];
    renderContactTriggerGroups();
  } catch (err) {
    console.error("No se pudo cargar los grupos de contacto:", err);
  }
}

addContactTriggerBtn.addEventListener("click", async () => {
  const name = contactTriggerGroupSelect.value;
  if (!name) return;
  await fetch("/api/contact-trigger-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  contactTriggerGroupSelect.value = "";
  await fetchContactTriggerGroups();
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

const budgetCategorySelect = document.getElementById("budgetCategorySelect");
const budgetLimiteFields = document.getElementById("budgetLimiteFields");
const budgetMetaFields = document.getElementById("budgetMetaFields");
const budgetLimiteInput = document.getElementById("budgetLimiteInput");
const budgetMetaInput = document.getElementById("budgetMetaInput");
const budgetSaldoInicialInput = document.getElementById("budgetSaldoInicialInput");
const saveBudgetBtn = document.getElementById("saveBudgetBtn");

let budgetCategoriasData = [];

async function populateBudgetCategories() {
  try {
    const res = await fetch("/api/budget/categories");
    const data = await res.json();
    budgetCategoriasData = data.categorias || [];
  } catch (err) {
    console.error("No se pudo obtener las categorías de presupuesto:", err);
    budgetCategoriasData = [];
  }
  const seleccionActual = budgetCategorySelect.value;
  budgetCategorySelect.innerHTML = '<option value="">— Selecciona una categoría —</option>';
  budgetCategoriasData.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.label;
    budgetCategorySelect.appendChild(opt);
  });
  if (seleccionActual) budgetCategorySelect.value = seleccionActual;
  updateBudgetFields();
}

function updateBudgetFields() {
  const catId = budgetCategorySelect.value;
  const cat = budgetCategoriasData.find((c) => c.id === catId);
  if (!cat) {
    budgetLimiteFields.classList.add("hidden");
    budgetMetaFields.classList.add("hidden");
    saveBudgetBtn.disabled = true;
    saveBudgetBtn.textContent = "Elige una categoría primero";
    saveBudgetBtn.className = "w-full rounded-xl px-4 py-2.5 text-sm font-semibold bg-slate-300 text-slate-500 active:scale-95 transition-all";
    return;
  }
  saveBudgetBtn.disabled = false;
  saveBudgetBtn.textContent = "Guardar";
  saveBudgetBtn.className = "w-full rounded-xl px-4 py-2.5 text-sm font-semibold bg-emerald-600 text-white active:scale-95 transition-all";
  if (cat.tipo === "meta") {
    budgetMetaFields.classList.remove("hidden");
    budgetLimiteFields.classList.add("hidden");
    budgetMetaInput.value = cat.meta;
    budgetSaldoInicialInput.value = cat.saldoInicial;
  } else {
    budgetLimiteFields.classList.remove("hidden");
    budgetMetaFields.classList.add("hidden");
    budgetLimiteInput.value = cat.limite ?? "";
  }
}

budgetCategorySelect.addEventListener("change", updateBudgetFields);

saveBudgetBtn.addEventListener("click", async () => {
  const catId = budgetCategorySelect.value;
  const cat = budgetCategoriasData.find((c) => c.id === catId);
  if (!cat) return;
  try {
    if (cat.tipo === "meta") {
      await fetch(`/api/budget/categories/${encodeURIComponent(catId)}/meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta: budgetMetaInput.value, saldoInicial: budgetSaldoInicialInput.value }),
      });
    } else {
      await fetch(`/api/budget/categories/${encodeURIComponent(catId)}/limit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limite: budgetLimiteInput.value === "" ? null : budgetLimiteInput.value }),
      });
    }
    await populateBudgetCategories();
  } catch (err) {
    console.error("No se pudo guardar el presupuesto:", err);
  }
});

// ---------- Pendientes (recordatorios de pago) ----------
const remindersLink = document.getElementById("remindersLink");
const remindersOverlay = document.getElementById("remindersOverlay");
const closeReminders = document.getElementById("closeReminders");
const remindersList = document.getElementById("remindersList");
const menuBadge = document.getElementById("menuBadge");
const drawerReminderBadge = document.getElementById("drawerReminderBadge");
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
  [menuBadge, drawerReminderBadge].forEach((b) => {
    if (!b) return;
    if (cantidad > 0) {
      b.textContent = cantidad;
      b.classList.remove("hidden");
    } else {
      b.classList.add("hidden");
    }
  });
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
        await fetch(`/api/reminders/${encodeURIComponent(r.id)}/pagado`, { method: "POST" });
        renderReminders();
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

const financeLink = document.getElementById("financeLink");
const financeOverlay = document.getElementById("financeOverlay");
const closeFinance = document.getElementById("closeFinance");
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
  } else if (tabId === "financeTabCuentas") {
    fetchAccountNames();
    fetchAccountEntries();
  } else if (tabId === "financeTabGraficos") {
    fetchGraficos();
  }
}

financeTabButtons.forEach((btn) => {
  btn.addEventListener("click", () => showFinanceTab(btn.dataset.financeTab));
});

financeLink.addEventListener("click", (e) => {
  e.preventDefault();
  closeDrawerFn();
  financeOverlay.classList.remove("hidden");
  financeOverlay.classList.add("flex");
  showFinanceTab("financeTabResumen");
});

closeFinance.addEventListener("click", () => {
  financeOverlay.classList.add("hidden");
  financeOverlay.classList.remove("flex");
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

function renderDailyHistory(cierres, hoy) {
  dailyHistoryList.innerHTML = "";

  const dias = cierres.slice().reverse().map((c) => ({ ...c, cerrado: true }));
  if (hoy && hoy.fecha) dias.unshift({ ...hoy, cerrado: false });

  dias.forEach((d) => {
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

    dailyHistoryList.appendChild(row);
  });
}

async function fetchDailyHistory() {
  try {
    const res = await fetch("/api/finance/history");
    const data = await res.json();
    renderDailyHistory(data.cierres || [], data.hoy);
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
      row.className = "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs bg-white border border-slate-100";

      const info = document.createElement("div");
      info.className = "min-w-0";
      const linea1 = document.createElement("p");
      linea1.className = "font-semibold text-slate-800 truncate";
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
      row.appendChild(info);
      row.appendChild(acciones);
      movimientosList.appendChild(row);
    });
}

async function fetchMovimientos() {
  try {
    const res = await fetch("/api/finance/movements");
    const data = await res.json();
    movimientosData = data.movimientos || [];
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
    acciones.appendChild(clearBtn);
    acciones.appendChild(delBtn);

    card.appendChild(header);
    card.appendChild(acciones);
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
let chartEfectivoInstance = null;

const CHART_PALETTE = ["#22C55E", "#3B82F6", "#F59E0B", "#EF4444", "#8B5CF6", "#14B8A6", "#EC4899", "#84CC16", "#6366F1", "#F97316"];

async function fetchGraficos() {
  try {
    const [historyRes, categoriesRes] = await Promise.all([
      fetch("/api/finance/history"),
      fetch("/api/budget/categories"),
    ]);
    const historyData = await historyRes.json();
    const categoriesData = await categoriesRes.json();
    renderChartCategorias(categoriesData.categorias || []);
    renderChartHistoria(historyData.cierres || [], historyData.hoy);
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

// ---------- Finanzas: Metas ----------
const goalDiariaInput = document.getElementById("goalDiariaInput");
const goalSemanalInput = document.getElementById("goalSemanalInput");
const goalMensualInput = document.getElementById("goalMensualInput");
const goalAhorroInput = document.getElementById("goalAhorroInput");
const goalSavedMsg = document.getElementById("goalSavedMsg");
const goalProgressList = document.getElementById("goalProgressList");
const ahorroMetaTxt = document.getElementById("ahorroMetaTxt");
const ahorroActualTxt = document.getElementById("ahorroActualTxt");
const ahorroFaltaTxt = document.getElementById("ahorroFaltaTxt");
const ahorroRecomendadoTxt = document.getElementById("ahorroRecomendadoTxt");
const proyeccionTxt = document.getElementById("proyeccionTxt");
const comparativaTxt = document.getElementById("comparativaTxt");

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
  goalDiariaInput.value = goals.diaria || "";
  goalSemanalInput.value = goals.semanal || "";
  goalMensualInput.value = goals.mensual || "";
  goalAhorroInput.value = goals.ahorroMensual || "";
}

function renderGoalProgress(data) {
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
}

document.querySelectorAll(".goal-save-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const tipo = btn.dataset.goalSave;
    const inputMap = {
      diaria: goalDiariaInput,
      semanal: goalSemanalInput,
      mensual: goalMensualInput,
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

remindersLink.addEventListener("click", (e) => {
  e.preventDefault();
  closeDrawerFn();
  remindersOverlay.classList.remove("hidden");
  remindersOverlay.classList.add("flex");
  updateNewReminderFields();
  renderReminders();
});

closeReminders.addEventListener("click", () => {
  remindersOverlay.classList.add("hidden");
  remindersOverlay.classList.remove("flex");
  fetchReminderBadge();
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
    fetchContactTriggerGroups();
  },
  categoryGroups: () => {
    populateMoveSelects();
    populateNoRemarcarSelect();
  },
  categoryTiming: () => {
    fetchDelay();
    fetchTimeWindow();
    renderGroupDelayValueOptions();
    fetchGroupDelays();
  },
  categoryBudget: () => {
    populateBudgetCategories();
  },
  categoryGeneral: () => {
    updatePushStatus();
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
  connectionScore.textContent = `${score.toFixed(1)} / 10`;
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
  // Globo rojo de pagos pendientes en el menú (revisa cada minuto).
  fetchReminderBadge();
  setInterval(fetchReminderBadge, 60000);
  // Calidad de conexión (3 pings reales al servidor cada 12s).
  medirConexion();
  setInterval(medirConexion, 12000);
});
