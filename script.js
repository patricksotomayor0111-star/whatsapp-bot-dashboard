/* =========================================
   WhatsApp Bot Dashboard — Lógica principal
   ========================================= */

// ---------- Referencias del DOM ----------
const qrCard = document.getElementById("qrCard");
const qrCanvas = document.getElementById("qrCanvas");
const qrHint = document.getElementById("qrHint");

const groupListEl = document.getElementById("groupList");
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
let isConnected = false;
let isActive = true;
let lastRenderedQr = null;
let qrInstance = null;

// ---------- Render de grupos reales ----------
function renderGroups(filtro = "") {
  groupListEl.innerHTML = "";
  const term = filtro.trim().toLowerCase();
  const gruposFiltrados = term
    ? groupsData.filter((g) => g.name.toLowerCase().includes(term))
    : groupsData;

  gruposFiltrados.forEach((grupo) => {
    const groupNode = groupTemplate.content.cloneNode(true);
    const nameEl = groupNode.querySelector(".group-name");
    const participantsEl = groupNode.querySelector(".group-participants");
    const copyBtn = groupNode.querySelector(".copy-id-btn");

    nameEl.textContent = grupo.name;
    participantsEl.textContent = `${grupo.participants} participante${grupo.participants === 1 ? "" : "s"}`;

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

    groupListEl.appendChild(groupNode);
  });

  groupCount.textContent = `(${groupsData.length})`;

  if (!isConnected) {
    groupListEl.classList.add("hidden");
    emptyState.classList.add("hidden");
    notConnectedState.classList.remove("hidden");
    visibleCount.textContent = "Sin conexión";
  } else if (term && gruposFiltrados.length === 0) {
    groupListEl.classList.add("hidden");
    notConnectedState.classList.add("hidden");
    emptyState.classList.remove("hidden");
    visibleCount.textContent = "Sin resultados";
  } else {
    groupListEl.classList.remove("hidden");
    notConnectedState.classList.add("hidden");
    emptyState.classList.add("hidden");
    visibleCount.textContent = term ? `Mostrando ${gruposFiltrados.length} grupo(s)` : "Mostrando todos";
  }
}

async function fetchGroups() {
  try {
    const res = await fetch("/api/groups");
    const data = await res.json();
    groupsData = data.groups || [];
  } catch (err) {
    console.error("No se pudo obtener la lista de grupos:", err);
  }
  renderGroups(searchInput.value);
}

// ---------- Búsqueda ----------
searchInput.addEventListener("input", (e) => {
  renderGroups(e.target.value);
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
      fetchGroups();
    } else if (isConnected) {
      renderGroups(searchInput.value);
    } else {
      groupsData = [];
      renderGroups(searchInput.value);
    }
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
document.addEventListener("DOMContentLoaded", () => {
  updateBotUI();
  renderGroups();
  pollStatus();
  setInterval(pollStatus, 3000);
});
