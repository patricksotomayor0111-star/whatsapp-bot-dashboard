const { crearAlmacen } = require("./almacenPorUsuario");
const users = require("./users");
const { usuarioActual } = require("./contexto");

// Las semillas son la configuración con la que arrancó el dueño. Una
// cuenta nueva debe empezar vacía: si no, vería los pagos y las
// categorías (con sus montos) de otra persona.
function sembrarSoloAlDueno(semilla) {
  return usuarioActual() === users.DUENO_ID ? semilla : [];
}


const businessDay = require("./businessDay");

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


const almacen = crearAlmacen("scheduled-expenses-data.json", function (parsed) {
  try {
    return { gastos: Array.isArray(parsed.gastos) ? parsed.gastos : sembrarSoloAlDueno(SEED.map((g) => ({ ...g, activo: true }))) };
  } catch (err) {
    return { gastos: sembrarSoloAlDueno(SEED.map((g) => ({ ...g, activo: true }))) };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;


function getAll() {
  return datos().gastos;
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
  datos().gastos.push(nuevo);
  save();
  return nuevo;
}

function editGasto(id, cambios) {
  const g = datos().gastos.find((x) => x.id === id);
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
  const antes = datos().gastos.length;
  datos().gastos = datos().gastos.filter((g) => g.id !== id);
  if (datos().gastos.length !== antes) save();
  return datos().gastos.length !== antes;
}

function setActivo(id, activo) {
  const g = datos().gastos.find((x) => x.id === id);
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
const COMBINING_MARKS = new RegExp("[̀-ͯ]", "g");
function normalizar(texto) {
  return String(texto || "").normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

// Cuanto ya se gasto DE VERDAD en ese concepto dentro de la ventana.
// Se reconoce por las palabras del nombre del gasto programado, por
// palabra completa: "Almuerzo" calza con "menos 20 almuerzo" pero no
// con "almuercero".
function yaGastadoEn(label, movimientos, desde, hasta) {
  const claves = normalizar(label).split(/[^a-z0-9]+/).filter((p) => p.length >= 3);
  if (!claves.length) return 0;
  return (movimientos || []).reduce((suma, m) => {
    if (m.tipo !== "gasto") return suma;
    if (!m.fecha || m.fecha < desde || m.fecha > hasta) return suma;
    const palabras = normalizar(m.descripcion).split(/[^a-z0-9]+/).filter(Boolean);
    return claves.some((k) => palabras.includes(k)) ? suma + (m.monto || 0) : suma;
  }, 0);
}

// movimientos (opcional): si se pasan, a cada gasto programado se le
// descuenta lo que ya se gasto en ese concepto dentro de la ventana. Sin
// eso, anotar "menos 20 almuerzo" bajaba la caja Y la proyeccion seguia
// pidiendo el almuerzo completo: el mismo gasto contado dos veces.
function getProyeccion(fechaInicioLabel, fechaFinLabel, movimientos) {
  const detalle = [];

  datos().gastos.forEach((g) => {
    if (g.activo === false) return;

    if (g.tipo === "rango") {
      const desde = maxLabel(fechaInicioLabel, g.fechaInicio);
      const hasta = minLabel(fechaFinLabel, g.fechaFin);
      if (desde > hasta) return;
      const dias = diasEnRangoInclusive(desde, hasta);
      const subtotal = dias * g.monto;
      const yaGastado = yaGastadoEn(g.label, movimientos, desde, hasta);
      const restante = Math.max(subtotal - yaGastado, 0);
      if (subtotal > 0) detalle.push({ id: g.id, label: g.label, dias, subtotal, yaGastado, restante });
    } else if (g.tipo === "semanal") {
      const desde = maxLabel(fechaInicioLabel, g.fechaInicio || fechaInicioLabel);
      const hasta = g.fechaFin ? minLabel(fechaFinLabel, g.fechaFin) : fechaFinLabel;
      if (desde > hasta) return;
      const veces = ocurrenciasDiaSemanaEnRango(desde, hasta, g.dia);
      const subtotal = veces * g.monto;
      const yaGastado = yaGastadoEn(g.label, movimientos, desde, hasta);
      const restante = Math.max(subtotal - yaGastado, 0);
      if (subtotal > 0) detalle.push({ id: g.id, label: g.label, veces, subtotal, yaGastado, restante });
    }
  });

  // El total es lo que FALTA gastar, no lo planeado entero.
  const total = detalle.reduce((sum, d) => sum + d.restante, 0);
  const planeado = detalle.reduce((sum, d) => sum + d.subtotal, 0);
  const yaGastado = detalle.reduce((sum, d) => sum + d.yaGastado, 0);
  return { total, planeado, yaGastado, detalle };
}

// Proyección de lo que queda del mes en curso (desde hoy hasta fin de mes),
// para alimentar cálculos de "cuánto voy a necesitar".
function getProyeccionRestoDeMes(movimientos) {
  const hoy = businessDayLabel();
  const mesActual = hoy.slice(0, 7);
  const [y, mo] = mesActual.split("-").map(Number);
  const finMes = `${mesActual}-${String(diasEnMes(y, mo)).padStart(2, "0")}`;
  return getProyeccion(hoy, finMes, movimientos);
}

module.exports = {
  SEED_ORIGINAL: SEED,
  getAll,
  addGasto,
  editGasto,
  removeGasto,
  setActivo,
  getProyeccion,
  getProyeccionRestoDeMes,
};
