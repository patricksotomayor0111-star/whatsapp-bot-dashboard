const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("reminders-data.json");

// Recordatorios de pagos que se repiten. Cada uno se vuelve "pendiente"
// 1 día antes de su fecha (a partir de las 8am manda notificación) y sigue
// mostrándose todos los días hasta que el usuario toca "Ya pagué". Marcarlo
// pagado NO registra el gasto (eso lo escribe él en el grupo GANANCIAS);
// solo apaga el aviso hasta el próximo ciclo.
//
// tipo:
//   "semanal"        -> dia = día de la semana (0=domingo, 1=lunes ... 6=sábado)
//   "mensual_dia"    -> dia = día del mes (5, 13, 15...)
//   "mensual_finmes" -> el último día de cada mes
//   "unica"          -> fecha = "YYYY-MM-DD" (una sola vez, no se repite)
const SEED = [
  { id: "junta", label: "Junta", monto: 100, tipo: "semanal", dia: 1 },
  { id: "arce", label: "Cuota ARCE", monto: 27, tipo: "semanal", dia: 2 },
  { id: "movistar", label: "Movistar internet", monto: 45.9, tipo: "mensual_dia", dia: 5 },
  { id: "cuzco", label: "Caja Cuzco", monto: 996, tipo: "mensual_dia", dia: 13 },
  { id: "luz", label: "Luz", monto: 80, tipo: "mensual_dia", dia: 15 },
  { id: "terreno", label: "Terreno", monto: 500, tipo: "mensual_finmes" },
  { id: "universidad", label: "Universidad", monto: 2500, tipo: "unica", fecha: "2026-08-20" },
];

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
      lastNotifiedLabel: parsed.lastNotifiedLabel || null,
    };
  } catch (err) {
    // Primera vez (sin archivo): se siembran los pagos que ya conocemos.
    return {
      reminders: SEED.map((r) => ({ ...r, activo: true, lastPaidCycle: null })),
      lastNotifiedLabel: null,
    };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar reminders-data.json:", err.message);
  }
}
// Si es la primera vez (se sembró en memoria), lo dejamos escrito ya.
if (!fs.existsSync(DATA_PATH)) save();

// ---------- Utilidades de fecha (solo calendario, sin zona horaria) ----------
// Se trabaja con etiquetas "YYYY-MM-DD" y fechas UTC a medianoche para que la
// aritmética de días/meses no dependa de la zona del servidor.
function peruAhora() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs - 5 * 3600000);
}

function fechaLabelPeru() {
  const d = peruAhora();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dia}`;
}

function horaPeru() {
  return peruAhora().getHours();
}

function ymdToUtc(label) {
  const [y, mo, d] = label.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

function utcToLabel(dt) {
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function addDays(label, n) {
  const dt = ymdToUtc(label);
  dt.setUTCDate(dt.getUTCDate() + n);
  return utcToLabel(dt);
}

function diasEntre(labelA, labelB) {
  return Math.round((ymdToUtc(labelB).getTime() - ymdToUtc(labelA).getTime()) / 86400000);
}

function diasEnMes(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate(); // día 0 del mes siguiente = último de este
}

// La fecha de vencimiento del ciclo cuyo aviso YA se abrió (1 día antes),
// es decir el mayor vencimiento <= hoy+1. Devuelve etiqueta o null si aún no
// hay ninguna ventana abierta (caso de pagos únicos futuros).
function ultimaVentanaAbierta(r, hoyLabel) {
  const limite = addDays(hoyLabel, 1); // hoy + 1: la ventana abre 1 día antes

  if (r.tipo === "semanal") {
    const w = ymdToUtc(limite).getUTCDay();
    const diff = (w - r.dia + 7) % 7;
    return addDays(limite, -diff);
  }

  if (r.tipo === "mensual_dia") {
    const [y, mo] = limite.split("-").map(Number);
    const dayLimite = Number(limite.split("-")[2]);
    const diaEsteMes = Math.min(r.dia, diasEnMes(y, mo));
    if (dayLimite >= diaEsteMes) {
      return utcToLabel(new Date(Date.UTC(y, mo - 1, diaEsteMes)));
    }
    // mes anterior
    const prevMo = mo === 1 ? 12 : mo - 1;
    const prevY = mo === 1 ? y - 1 : y;
    const diaPrev = Math.min(r.dia, diasEnMes(prevY, prevMo));
    return utcToLabel(new Date(Date.UTC(prevY, prevMo - 1, diaPrev)));
  }

  if (r.tipo === "mensual_finmes") {
    const [y, mo] = limite.split("-").map(Number);
    const ultimoEste = diasEnMes(y, mo);
    if (Number(limite.split("-")[2]) >= ultimoEste) {
      return utcToLabel(new Date(Date.UTC(y, mo - 1, ultimoEste)));
    }
    const prevMo = mo === 1 ? 12 : mo - 1;
    const prevY = mo === 1 ? y - 1 : y;
    return utcToLabel(new Date(Date.UTC(prevY, prevMo - 1, diasEnMes(prevY, prevMo))));
  }

  if (r.tipo === "unica") {
    if (!r.fecha) return null;
    return r.fecha <= limite ? r.fecha : null; // solo si su ventana ya abrió
  }

  return null;
}

// La próxima fecha de vencimiento >= hoy (para mostrar "próximo pago" aunque
// no esté pendiente todavía).
function proximaFecha(r, hoyLabel) {
  if (r.tipo === "semanal") {
    const w = ymdToUtc(hoyLabel).getUTCDay();
    const diff = (r.dia - w + 7) % 7;
    return addDays(hoyLabel, diff);
  }
  if (r.tipo === "mensual_dia") {
    const [y, mo] = hoyLabel.split("-").map(Number);
    const dayHoy = Number(hoyLabel.split("-")[2]);
    const diaEste = Math.min(r.dia, diasEnMes(y, mo));
    if (dayHoy <= diaEste) return utcToLabel(new Date(Date.UTC(y, mo - 1, diaEste)));
    const nextMo = mo === 12 ? 1 : mo + 1;
    const nextY = mo === 12 ? y + 1 : y;
    return utcToLabel(new Date(Date.UTC(nextY, nextMo - 1, Math.min(r.dia, diasEnMes(nextY, nextMo)))));
  }
  if (r.tipo === "mensual_finmes") {
    const [y, mo] = hoyLabel.split("-").map(Number);
    return utcToLabel(new Date(Date.UTC(y, mo - 1, diasEnMes(y, mo))));
  }
  if (r.tipo === "unica") return r.fecha || null;
  return null;
}

// ¿Este recordatorio está pendiente hoy? Lo está si su ventana ya abrió y esa
// fecha de vencimiento todavía no fue marcada como pagada.
function estaPendiente(r, hoyLabel) {
  if (!r.activo) return null;
  const due = ultimaVentanaAbierta(r, hoyLabel);
  if (!due) return null;
  if (r.lastPaidCycle && r.lastPaidCycle >= due) return null;
  return due;
}

function getPendientes() {
  const hoy = fechaLabelPeru();
  const lista = [];
  data.reminders.forEach((r) => {
    const due = estaPendiente(r, hoy);
    if (due) lista.push({ id: r.id, label: r.label, monto: r.monto, vence: due, dias: diasEntre(hoy, due) });
  });
  // Los más urgentes (vencidos / de hoy) primero.
  lista.sort((a, b) => a.vence.localeCompare(b.vence));
  return lista;
}

// Lista completa para el panel de gestión (incluye estado y próxima fecha).
function getAll() {
  const hoy = fechaLabelPeru();
  return data.reminders.map((r) => {
    const due = estaPendiente(r, hoy);
    return {
      id: r.id,
      label: r.label,
      monto: r.monto,
      tipo: r.tipo,
      dia: r.dia ?? null,
      fecha: r.fecha ?? null,
      activo: r.activo !== false,
      pendiente: !!due,
      vence: due || null,
      proxima: proximaFecha(r, hoy),
    };
  });
}

function marcarPagado(id) {
  const r = data.reminders.find((x) => x.id === id);
  if (!r) throw new Error("Recordatorio inexistente: " + id);
  const hoy = fechaLabelPeru();
  const due = ultimaVentanaAbierta(r, hoy);
  if (r.tipo === "unica") {
    r.activo = false; // pago único: no vuelve a aparecer
  } else if (due) {
    r.lastPaidCycle = due; // recurrente: se apaga hasta el próximo ciclo
  }
  save();
}

function setActivo(id, activo) {
  const r = data.reminders.find((x) => x.id === id);
  if (!r) throw new Error("Recordatorio inexistente: " + id);
  r.activo = !!activo;
  save();
}

function addReminder({ label, monto, tipo, dia, fecha }) {
  const tiposValidos = ["semanal", "mensual_dia", "mensual_finmes", "unica"];
  if (!label || !tiposValidos.includes(tipo)) throw new Error("Datos de recordatorio inválidos");
  const nuevo = {
    id: "custom_" + Date.now(),
    label: String(label).trim(),
    monto: Number(monto) || 0,
    tipo,
    activo: true,
    lastPaidCycle: null,
  };
  if (tipo === "semanal" || tipo === "mensual_dia") nuevo.dia = Number(dia);
  if (tipo === "unica") nuevo.fecha = fecha;
  data.reminders.push(nuevo);
  save();
  return nuevo.id;
}

function removeReminder(id) {
  const antes = data.reminders.length;
  data.reminders = data.reminders.filter((r) => r.id !== id);
  if (data.reminders.length !== antes) save();
}

// ---------- Notificación diaria de las 8am ----------
// El scheduler (bot.js) pregunta si toca avisar: solo una vez por día, a
// partir de las 8am hora Perú, y solo si hay algo pendiente.
function necesitaNotificar() {
  if (horaPeru() < 8) return null;
  const hoy = fechaLabelPeru();
  if (data.lastNotifiedLabel === hoy) return null;
  const pendientes = getPendientes();
  if (pendientes.length === 0) return null;
  return pendientes;
}

function registrarNotificacion() {
  data.lastNotifiedLabel = fechaLabelPeru();
  save();
}

module.exports = {
  getPendientes,
  getAll,
  marcarPagado,
  setActivo,
  addReminder,
  removeReminder,
  necesitaNotificar,
  registrarNotificacion,
};
