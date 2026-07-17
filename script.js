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
const focusGroupName = document.getElementById("focusGroupName");
const restoreBtn = document.getElementById("restoreBtn");

const botToggleBtn = document.getElementById("botToggleBtn");
const botToggleLabel = document.getElementById("botToggleLabel");
const botStatusText = document.getElementById("botStatusText");
const botStatusDot = document.getElementById("botStatusDot");

const logoutBtn = document.getElementById("logoutBtn");

const menuBtn = document.getElementById("menuBtn");
const closeDrawer = document.getElementById("closeDrawer");
const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");

let currentFocusGroup = "Ninguno";
let groupsData = [];
let sectorDefs = [];
let sectorActiveMap = {};
let isConnected = false;
let isActive = true;
let lastRenderedQr = null;
let qrInstance = null;

// ---------- Render de sectores y sus grupos ----------
function renderSectors(filtro = "") {
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
    const countEl = sectorNode.querySelector(".sector-count");
    const chevron = sectorNode.querySelector(".sector-chevron");
    const header = sectorNode.querySelector(".sector-header");
    const badge = sectorNode.querySelector(".sector-toggle-badge");
    const groupsContainer = sectorNode.querySelector(".sector-groups");

    nameEl.textContent = sector.label;
    countEl.textContent = `(${gruposDelSector.length})`;
    updateSectorBadge(badge, sectorActiveMap[sector.id] !== false);

    gruposFiltrados.forEach((grupo) => {
      const groupNode = groupTemplate.content.cloneNode(true);
      const nameSpan = groupNode.querySelector(".group-name");
      const participantsEl = groupNode.querySelector(".group-participants");
      const sectorSelect = groupNode.querySelector(".sector-select");
      const copyBtn = groupNode.querySelector(".copy-id-btn");

      nameSpan.textContent = grupo.name;
      participantsEl.textContent = `${grupo.participants} participante${grupo.participants === 1 ? "" : "s"}`;

      sectorDefs.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.label;
        if (s.id === sector.id) opt.selected = true;
        sectorSelect.appendChild(opt);
      });

      sectorSelect.addEventListener("click", (e) => e.stopPropagation());
      sectorSelect.addEventListener("change", async () => {
        const nuevoSectorId = sectorSelect.value;
        try {
          await fetch(`/api/groups/${encodeURIComponent(grupo.id)}/sector`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sectorId: nuevoSectorId }),
          });
          grupo.sectorId = nuevoSectorId;
          renderSectors(searchInput.value);
        } catch (err) {
          console.error("No se pudo cambiar el sector del grupo:", err);
        }
      });

      copyBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(grupo.id);
          copyBtn.innerHTML = '<i class="fa-solid fa-check text-xs"></i>';
          setTimeout(() => {
            copyBtn.innerHTML = '<i class="fa-regular fa-copy text-xs"></i>';
          }, 1200);
        } catch (err) {
          console.error("No se pudo copiar el ID:", err);
        }
      });

      groupsContainer.appendChild(groupNode);
    });

    const shouldOpen = Boolean(term);
    if (shouldOpen) {
      groupsContainer.classList.add("open");
      groupsContainer.style.maxHeight = groupsContainer.scrollHeight + "px";
      chevron.classList.add("open");
    }

    header.addEventListener("click", () => {
      const isOpen = groupsContainer.classList.toggle("open");
      chevron.classList.toggle("open");
      groupsContainer.style.maxHeight = isOpen ? groupsContainer.scrollHeight + "px" : "0px";
    });

    // Enciende/apaga el sector: los grupos siguen mostrándose "Activo",
    // pero el bot deja de responder en ellos mientras esté OFF.
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

    sectorListEl.appendChild(sectorNode);
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

async function fetchSectors() {
  try {
    const res = await fetch("/api/sectors");
    const data = await res.json();
    sectorDefs = data.sectors || [];
    sectorActiveMap = data.sectorActive || {};
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
restoreBtn.addEventListener("click", () => {
  setFocusGroup("Ninguno");
});

function setFocusGroup(nombre) {
  currentFocusGroup = nombre;
  focusGroupName.textContent = nombre;
  focusGroupName.classList.add("fade-in");
  setTimeout(() => focusGroupName.classList.remove("fade-in"), 500);
}

// ---------- Estado real del bot ----------
function updateBotUI() {
  if (!isConnected) {
    botStatusText.textContent = "Bot Desconectado";
    botToggleLabel.textContent = "Activar";
    botToggleBtn.disabled = true;
    botToggleBtn.classList.remove("bg-brand-green");
    botToggleBtn.classList.add("bg-brand-red", "opacity-50");
    botStatusDot.classList.remove("bg-brand-green", "pulse-active");
    botStatusDot.classList.add("bg-brand-red");
    botStatusDot.style.boxShadow = "0 0 0 4px rgba(239,68,68,0.15)";
    qrCard.classList.remove("hidden");
  } else if (isActive) {
    botStatusText.textContent = "Bot Activo";
    botToggleLabel.textContent = "Desactivar";
    botToggleBtn.disabled = false;
    botToggleBtn.classList.remove("bg-brand-red", "opacity-50");
    botToggleBtn.classList.add("bg-brand-green");
    botStatusDot.classList.remove("bg-brand-red");
    botStatusDot.classList.add("bg-brand-green", "pulse-active");
    botStatusDot.style.boxShadow = "0 0 0 4px rgba(34,197,94,0.15)";
    qrCard.classList.add("hidden");
  } else {
    botStatusText.textContent = "Bot Desconectado";
    botToggleLabel.textContent = "Activar";
    botToggleBtn.disabled = false;
    botToggleBtn.classList.remove("bg-brand-green", "opacity-50");
    botToggleBtn.classList.add("bg-brand-red");
    botStatusDot.classList.remove("bg-brand-green", "pulse-active");
    botStatusDot.classList.add("bg-brand-red");
    botStatusDot.style.boxShadow = "0 0 0 4px rgba(239,68,68,0.15)";
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
      fetchGroups(true);
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

// ---------- Inicialización ----------
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
});
