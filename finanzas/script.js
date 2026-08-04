/* =========================================
   Finanzas — Panel independiente (WhatsApp secundario)
   ========================================= */

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
    if (data.ana) {
      statAnaGuardado.textContent = formatSoles(data.ana.guardado);
      statAnaGastado.textContent = "-" + formatSoles(data.ana.gastado);
      statAnaSaldo.textContent = formatSoles(data.ana.saldo);
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
  } else if (tabId === "financeTabMetas") {
    fetchGoalsAndProgress();
    fetchProductionGoals();
  } else if (tabId === "financeTabPresupuesto") {
    fetchBudgetCategories();
    fetchScheduledExpenses();
  } else if (tabId === "financeTabAna") {
    fetchAna();
  } else if (tabId === "financeTabConsultas") {
    fetchQueryIntents();
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

async function fetchGraficos() {
  try {
    const [historyRes, categoriesRes, productionRes] = await Promise.all([
      fetch("/api/finance/history"),
      fetch("/api/budget/categories"),
      fetch("/api/finance/production-goals"),
    ]);
    const historyData = await historyRes.json();
    const categoriesData = await categoriesRes.json();
    const productionData = await productionRes.json();
    renderChartCategorias(categoriesData.categorias || []);
    renderChartHistoria(historyData.cierres || [], historyData.hoy);
    renderChartMensual(historyData.cierres || [], historyData.hoy);
    renderChartProduccion(productionData.hoy);
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
const compromisosList = document.getElementById("compromisosList");
const compromisosTotalTxt = document.getElementById("compromisosTotalTxt");
const compromisosAhorroTxt = document.getElementById("compromisosAhorroTxt");
const compromisosNecesidadTxt = document.getElementById("compromisosNecesidadTxt");
const compromisosGeneradoTxt = document.getElementById("compromisosGeneradoTxt");
const metaDiariaRealTxt = document.getElementById("metaDiariaRealTxt");

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

  if (data.compromisos) {
    const c = data.compromisos;
    compromisosList.innerHTML = "";
    if (c.detalle.length === 0) {
      const p = document.createElement("p");
      p.className = "text-xs text-slate-400";
      p.textContent = "No hay pagos fijos activos este mes.";
      compromisosList.appendChild(p);
    } else {
      c.detalle.forEach((d) => {
        const row = document.createElement("div");
        row.className = "flex items-center justify-between text-xs";
        const nombre = document.createElement("span");
        nombre.className = "text-slate-600";
        nombre.textContent = d.veces > 1 ? `${d.label} (x${d.veces})` : d.label;
        const monto = document.createElement("span");
        monto.className = "font-semibold text-slate-700";
        monto.textContent = formatSoles(d.subtotal);
        row.appendChild(nombre);
        row.appendChild(monto);
        compromisosList.appendChild(row);
      });
    }
    compromisosTotalTxt.textContent = formatSoles(c.total);
    compromisosAhorroTxt.textContent = formatSoles(data.goals.ahorroMensual);
    compromisosNecesidadTxt.textContent = formatSoles(c.necesidadTotal);
    compromisosGeneradoTxt.textContent = formatSoles(data.ahorro.actual);
    metaDiariaRealTxt.textContent = formatSoles(c.metaDiariaReal);
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

      const editBtn = document.createElement("button");
      editBtn.className = "btn-capsule bg-slate-100 text-slate-600 text-xs py-1.5 px-3";
      editBtn.textContent = "Editar";
      editBtn.addEventListener("click", async () => {
        const nuevoLabel = prompt("Nombre:", cat.label);
        if (nuevoLabel === null) return;
        const nuevasKeywords = prompt("Palabras clave (separadas por coma):", (cat.keywords || []).join(", "));
        if (nuevasKeywords === null) return;
        await fetch(`/api/budget/categories/${encodeURIComponent(cat.id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: nuevoLabel,
            keywords: nuevasKeywords.split(",").map((k) => k.trim()).filter(Boolean),
          }),
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

async function fetchBudgetCategories() {
  try {
    const res = await fetch("/api/budget/categories");
    const data = await res.json();
    renderBudgetCategories(data.categorias || []);
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

// ---------- Finanzas: Ana (custodia, editable) ----------
const anaGuardadoTxt = document.getElementById("anaGuardadoTxt");
const anaGastadoTxt = document.getElementById("anaGastadoTxt");
const anaSaldoTxt = document.getElementById("anaSaldoTxt");
const anaMovimientosList = document.getElementById("anaMovimientosList");
const anaMovimientosEmpty = document.getElementById("anaMovimientosEmpty");

function renderAna(ana, movimientos) {
  anaGuardadoTxt.textContent = formatSoles(ana.guardado);
  anaGastadoTxt.textContent = formatSoles(ana.gastado);
  anaSaldoTxt.textContent = formatSoles(ana.saldo);

  anaMovimientosList.innerHTML = "";
  if (movimientos.length === 0) {
    anaMovimientosEmpty.classList.remove("hidden");
    return;
  }
  anaMovimientosEmpty.classList.add("hidden");

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
      const signo = m.tipo === "gasto" ? "-" : "+";
      linea1.textContent = `${signo}${formatSoles(m.monto)} · ${m.tipo === "guardo" ? "guardó" : "gastó/retiró"}`;
      const linea2 = document.createElement("p");
      linea2.className = "text-slate-400";
      linea2.textContent = `${m.fecha} ${m.hora}${m.descripcion ? " · " + m.descripcion : ""}`;
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
        await fetch(`/api/finance/ana/movements/${m.index}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ monto: nuevoMonto }),
        });
        await fetchAna();
      });

      const delBtn = document.createElement("button");
      delBtn.innerHTML = '<i class="fa-solid fa-trash text-rose-400"></i>';
      delBtn.className = "w-7 h-7 flex items-center justify-center";
      delBtn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este movimiento de Ana?")) return;
        await fetch(`/api/finance/ana/movements/${m.index}`, { method: "DELETE" });
        await fetchAna();
      });

      acciones.appendChild(editBtn);
      acciones.appendChild(delBtn);
      row.appendChild(info);
      row.appendChild(acciones);
      anaMovimientosList.appendChild(row);
    });
}

async function fetchAna() {
  try {
    const [todayRes, movRes] = await Promise.all([
      fetch("/api/cashbox/today"),
      fetch("/api/finance/ana/movements"),
    ]);
    const todayData = await todayRes.json();
    const movData = await movRes.json();
    renderAna(todayData.ana || { guardado: 0, gastado: 0, saldo: 0 }, movData.movimientos || []);
  } catch (err) {
    console.error("No se pudo obtener la info de Ana:", err);
  }
}

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
});

closeReminders.addEventListener("click", () => {
  remindersOverlay.classList.add("hidden");
  remindersOverlay.classList.remove("flex");
  fetchReminderBadge();
});

// ---------- Inicialización ----------
document.addEventListener("DOMContentLoaded", () => {
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
