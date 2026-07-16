/* =========================================
   WhatsApp Bot Dashboard — Lógica principal
   ========================================= */

// ---------- Datos de ejemplo (fácil de ampliar / conectar a una API) ----------
const sectoresData = [
  {
    id: "norte",
    nombre: "📍 Sector Norte",
    activo: true,
    grupos: [
      { id: "n1", nombre: "Almacén 3 - Ventas", activo: true },
      { id: "n2", nombre: "Distribuidores Norte", activo: true },
      { id: "n3", nombre: "Soporte Clientes N", activo: false },
    ],
  },
  {
    id: "centro",
    nombre: "📍 Sector Centro",
    activo: true,
    grupos: [
      { id: "c1", nombre: "Tienda Central", activo: true },
      { id: "c2", nombre: "Logística Centro", activo: true },
    ],
  },
  {
    id: "sur",
    nombre: "📍 Sector Sur",
    activo: false,
    grupos: [
      { id: "s1", nombre: "Sucursal Sur A", activo: false },
      { id: "s2", nombre: "Sucursal Sur B", activo: true },
      { id: "s3", nombre: "Repartidores Sur", activo: true },
    ],
  },
];

// ---------- Referencias del DOM ----------
const sectorListEl = document.getElementById("sectorList");
const sectorTemplate = document.getElementById("sectorTemplate");
const groupTemplate = document.getElementById("groupTemplate");
const searchInput = document.getElementById("searchInput");
const emptyState = document.getElementById("emptyState");
const visibleCount = document.getElementById("visibleCount");
const focusGroupName = document.getElementById("focusGroupName");
const restoreBtn = document.getElementById("restoreBtn");

const botToggleBtn = document.getElementById("botToggleBtn");
const botToggleLabel = document.getElementById("botToggleLabel");
const botStatusText = document.getElementById("botStatusText");
const botStatusDot = document.getElementById("botStatusDot");

const menuBtn = document.getElementById("menuBtn");
const closeDrawer = document.getElementById("closeDrawer");
const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");

let botActive = false;
let currentFocusGroup = "Sector Norte · Almacén 3";

// ---------- Render de sectores y grupos ----------
function renderSectores(filtro = "") {
  sectorListEl.innerHTML = "";
  const term = filtro.trim().toLowerCase();
  let totalVisibles = 0;

  sectoresData.forEach((sector) => {
    const gruposFiltrados = term
      ? sector.grupos.filter((g) => g.nombre.toLowerCase().includes(term))
      : sector.grupos;

    // Si hay búsqueda y el sector no tiene coincidencias, se omite
    if (term && gruposFiltrados.length === 0) return;

    totalVisibles += gruposFiltrados.length;

    const sectorNode = sectorTemplate.content.cloneNode(true);
    const article = sectorNode.querySelector(".sector-card");
    const nameEl = sectorNode.querySelector(".sector-name");
    const chevron = sectorNode.querySelector(".sector-chevron");
    const header = sectorNode.querySelector(".sector-header");
    const badge = sectorNode.querySelector(".sector-toggle-badge");
    const groupsContainer = sectorNode.querySelector(".sector-groups");

    nameEl.textContent = sector.nombre;
    updateSectorBadge(badge, sector.activo);

    // Construir filas de grupos
    gruposFiltrados.forEach((grupo) => {
      const groupNode = groupTemplate.content.cloneNode(true);
      const nameSpan = groupNode.querySelector(".group-name");
      const badgeSpan = groupNode.querySelector(".badge-active");
      const targetBtn = groupNode.querySelector(".target-btn");

      nameSpan.textContent = grupo.nombre;

      if (grupo.activo) {
        badgeSpan.textContent = "Activo";
        badgeSpan.className = "badge-active shrink-0";
      } else {
        badgeSpan.textContent = "Inactivo";
        badgeSpan.className = "badge-inactive shrink-0";
      }

      targetBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        setFocusGroup(`${sector.nombre.replace("📍 ", "")} · ${grupo.nombre}`);
        pulseButton(targetBtn);
      });

      groupsContainer.appendChild(groupNode);
    });

    // Abrir automáticamente el sector si hay término de búsqueda
    const shouldOpen = Boolean(term);
    if (shouldOpen) {
      groupsContainer.classList.add("open");
      groupsContainer.style.maxHeight = groupsContainer.scrollHeight + "px";
      chevron.classList.add("open");
    }

    // Expandir / colapsar sector
    header.addEventListener("click", () => {
      const isOpen = groupsContainer.classList.toggle("open");
      chevron.classList.toggle("open");
      groupsContainer.style.maxHeight = isOpen ? groupsContainer.scrollHeight + "px" : "0px";
    });

    // Activar / desactivar sector completo
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      sector.activo = !sector.activo;
      updateSectorBadge(badge, sector.activo);
    });

    sectorListEl.appendChild(sectorNode);
  });

  // Estado vacío
  if (term && totalVisibles === 0) {
    emptyState.classList.remove("hidden");
    visibleCount.textContent = "Sin resultados";
  } else {
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

function pulseButton(btn) {
  btn.classList.add("selected");
  setTimeout(() => btn.classList.remove("selected"), 600);
}

function setFocusGroup(nombre) {
  currentFocusGroup = nombre;
  focusGroupName.textContent = nombre;
  focusGroupName.classList.add("fade-in");
  setTimeout(() => focusGroupName.classList.remove("fade-in"), 500);
}

// ---------- Búsqueda ----------
searchInput.addEventListener("input", (e) => {
  renderSectores(e.target.value);
});

// ---------- Restaurar modo enfoque ----------
restoreBtn.addEventListener("click", () => {
  setFocusGroup("Sector Norte · Almacén 3");
});

// ---------- Estado del bot ----------
function updateBotUI() {
  if (botActive) {
    botStatusText.textContent = "Bot Activo";
    botToggleLabel.textContent = "Desactivar";
    botToggleBtn.classList.remove("bg-brand-red");
    botToggleBtn.classList.add("bg-brand-green");
    botStatusDot.classList.remove("bg-brand-red");
    botStatusDot.classList.add("bg-brand-green", "pulse-active");
    botStatusDot.style.boxShadow = "0 0 0 4px rgba(34,197,94,0.15)";
  } else {
    botStatusText.textContent = "Bot Inactivo";
    botToggleLabel.textContent = "Activar";
    botToggleBtn.classList.remove("bg-brand-green");
    botToggleBtn.classList.add("bg-brand-red");
    botStatusDot.classList.remove("bg-brand-green", "pulse-active");
    botStatusDot.classList.add("bg-brand-red");
    botStatusDot.style.boxShadow = "0 0 0 4px rgba(239,68,68,0.15)";
  }
}

botToggleBtn.addEventListener("click", () => {
  botActive = !botActive;
  updateBotUI();
});

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
  renderSectores();
  updateBotUI();
});
