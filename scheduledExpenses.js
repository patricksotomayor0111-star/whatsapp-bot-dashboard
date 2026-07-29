const fs = require("fs");
const { dataPath } = require("./dataDir");
const businessDay = require("./businessDay");

const DATA_PATH = dataPath("scheduled-expenses-data.json");
const { ymdToUtc, addDays, diasEnMes, businessDayLabel } = businessDay;

// Gastos programados: SOLO sirven para proyectar cuánto se va a necesitar
// (no tocan la caja real). El gasto de verdad se sigue reportando por
// WhatsApp como siempre ("menos X gasolina"); esto es nada más el
// presupuesto planeado para calcular "cuánto puedo gastar"/"cuánto me
// falta" sin sorpresas.
//
// tipo:
//   "rango"   -> ocurre TODOS los días entre fechaInicio y fechaFin
//                (inclusive), monto por día.
//   "semanal" -> ocurre un día fijo de la semana (0=domingo..6=sábado),
//                opcionalmente acotado por fechaInicio/fechaFin (sin
//                fechaFin = indefinido, "y así cada semana").
const SEED = [
  { id: "almuerzos_jul29", label: "Almuerzos", monto: 20, tipo: "rango", fechaInicio: "2026-07-29", fechaFin: "2026-07-31" },
  { id: "desayunos_jul29", label: "Desayunos", monto: 10, tipo: "rango", fechaInicio: "2026-07-29", fechaFin: "2026-07-31" },
  { id: "gasolina_agosto", label: "Gasolina", monto: 20, tipo: "rango", fechaInicio: "2026-08-01", fechaFin: "2026-08-31" },
  { id: "almuerzos_agosto", label: "Almuerzos diarios", monto: 20, tipo: "rango", fechaInicio: "2026-08-01", fechaFin: "2026-08-31" },
  { id: "almuerzo_especial_sabado", label: "Almuerzo especial (sábado)", monto: 80, tipo: "semanal", dia: 6, fechaInicio: "2026-08-01", fechaFin: null },
  { id: "salida_familiar", label: "Salida familiar", monto: 100, tipo: "semanal", dia: 6, fechaInicio: "2026-08-01", fechaFin: null },
];

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { gastos: Array.isArray(parsed.gastos) ? parsed.gastos : SEED.map((g) => ({ ...g, activo: true })) };
  } catch (err) {
    return { gastos: SEED.map((g) => ({ ...g, activo: true })) };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar scheduled-expenses-data.json:", err.message);
  }
}

function getAll() {
  return data.gastos;
}

const tiposValidos = ["rango", "semanal"];

function addGasto({ label, monto, tipo, fechaInicio, fechaFin, dia }) {
  if (!label || !tiposValidos.includes(tipo)) throw new Error("Datos de gasto programado inválidos");
  const nuevo = {
    id: "gasto_prog_" + Date.now(),
    label: String(label).trim(),
    monto: Number(monto) || 0,
    tipo,
    activo: true,
  };
  if (tipo === "rango") {
    if (!fechaInicio || !fechaFin) throw new Error("Un gasto de tipo 'rango' necesita fechaInicio y fechaFin.");
    nuevo.fechaInicio = fechaInicio;
    nuevo.fechaFin = fechaFin;
  } else {
    nuevo.dia = Number(dia);
    nuevo.fechaInicio = fechaInicio || businessDayLabel();
    nuevo.fechaFin = fechaFin || null;
  }
  data.gastos.push(nuevo);
  save();
  return nuevo;
}

function editGasto(id, cambios) {
  const g = data.gastos.find((x) => x.id === id);
  if (!g) return null;
  if (cambios.label !== undefined && String(cambios.label).trim()) g.label = String(cambios.label).trim();
  if (cambios.monto !== undefined) g.monto = Number(cambios.monto) || 0;
  if (cambios.tipo !== undefined) {
    if (!tiposValidos.includes(cambios.tipo)) throw new Error("Tipo de gasto programado inválido: " + cambios.tipo);
    g.tipo = cambios.tipo;
  }
  if (cambios.dia !== undefined) g.dia = Number(cambios.dia);
  if (cambios.fechaInicio !== undefined) g.fechaInicio = cambios.fechaInicio;
  if (cambios.fechaFin !== undefined) g.fechaFin = cambios.fechaFin;
  save();
  return g;
}

function removeGasto(id) {
  const antes = data.gastos.length;
  data.gastos = data.gastos.filter((g) => g.id !== id);
  if (data.gastos.length !== antes) save();
  return data.gastos.length !== antes;
}

function setActivo(id, activo) {
  const g = data.gastos.find((x) => x.id === id);
  if (!g) throw new Error("Gasto programado inexistente: " + id);
  g.activo = !!activo;
  save();
}

function maxLabel(a, b) {
  return a > b ? a : b;
}

function minLabel(a, b) {
  return a < b ? a : b;
}

function diasEnRangoInclusive(desde, hasta) {
  return Math.round((ymdToUtc(hasta).getTime() - ymdToUtc(desde).getTime()) / 86400000) + 1;
}

function ocurrenciasDiaSemanaEnRango(desde, hasta, diaSemana) {
  let veces = 0;
  let cursor = desde;
  while (cursor <= hasta) {
    if (ymdToUtc(cursor).getUTCDay() === diaSemana) veces++;
    cursor = addDays(cursor, 1);
  }
  return veces;
}

// Proyecta cuánto suman los gastos programados ACTIVOS dentro de un rango
// de fechas [fechaInicioLabel, fechaFinLabel] (inclusive). Es solo un
// presupuesto planeado: no descuenta nada de la caja real.
function getProyeccion(fechaInicioLabel, fechaFinLabel) {
  const detalle = [];

  data.gastos.forEach((g) => {
    if (g.activo === false) return;

    if (g.tipo === "rango") {
      const desde = maxLabel(fechaInicioLabel, g.fechaInicio);
      const hasta = minLabel(fechaFinLabel, g.fechaFin);
      if (desde > hasta) return;
      const dias = diasEnRangoInclusive(desde, hasta);
      const subtotal = dias * g.monto;
      if (subtotal > 0) detalle.push({ id: g.id, label: g.label, dias, subtotal });
    } else if (g.tipo === "semanal") {
      const desde = maxLabel(fechaInicioLabel, g.fechaInicio || fechaInicioLabel);
      const hasta = g.fechaFin ? minLabel(fechaFinLabel, g.fechaFin) : fechaFinLabel;
      if (desde > hasta) return;
      const veces = ocurrenciasDiaSemanaEnRango(desde, hasta, g.dia);
      const subtotal = veces * g.monto;
      if (subtotal > 0) detalle.push({ id: g.id, label: g.label, veces, subtotal });
    }
  });

  const total = detalle.reduce((sum, d) => sum + d.subtotal, 0);
  return { total, detalle };
}

// Proyección de lo que queda del mes en curso (desde hoy hasta fin de mes),
// para alimentar cálculos de "cuánto voy a necesitar".
function getProyeccionRestoDeMes() {
  const hoy = businessDayLabel();
  const mesActual = hoy.slice(0, 7);
  const [y, mo] = mesActual.split("-").map(Number);
  const finMes = `${mesActual}-${String(diasEnMes(y, mo)).padStart(2, "0")}`;
  return getProyeccion(hoy, finMes);
}

module.exports = {
  getAll,
  addGasto,
  editGasto,
  removeGasto,
  setActivo,
  getProyeccion,
  getProyeccionRestoDeMes,
};
