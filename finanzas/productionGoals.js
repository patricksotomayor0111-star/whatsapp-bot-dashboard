const fs = require("fs");
const { dataPath } = require("./dataDir");
const cashbox = require("./cashbox");

const DATA_PATH = dataPath("production-goals-data.json");

// Meta de producción diaria por mes: un mínimo diario base más una
// cantidad aproximada de días de producción del mes (puede incluir
// descansos; es solo referencia para calcular la meta mensual total).
// Semilla: agosto 2026, S/200 mínimo por día, ~27 días de producción
// (S/5,400 de referencia mensual).
const SEED = { "2026-08": { metaDiariaBase: 200, diasProduccion: 27 } };

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { metas: parsed.metas && typeof parsed.metas === "object" ? parsed.metas : { ...SEED } };
  } catch (err) {
    return { metas: { ...SEED } };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar production-goals-data.json:", err.message);
  }
}

function getMeta(mesLabel) {
  return data.metas[mesLabel] || null;
}

function getAllMetas() {
  return Object.keys(data.metas)
    .sort()
    .map((mes) => ({ mes, ...data.metas[mes] }));
}

function setMeta(mesLabel, metaDiariaBase, diasProduccion) {
  if (!/^\d{4}-\d{2}$/.test(String(mesLabel || ""))) throw new Error("Mes inválido (usar YYYY-MM): " + mesLabel);
  data.metas[mesLabel] = {
    metaDiariaBase: Number(metaDiariaBase) || 0,
    diasProduccion: Math.max(Number(diasProduccion) || 1, 1),
  };
  save();
  return { mes: mesLabel, ...data.metas[mesLabel] };
}

function removeMeta(mesLabel) {
  const existia = Object.prototype.hasOwnProperty.call(data.metas, mesLabel);
  delete data.metas[mesLabel];
  if (existia) save();
  return existia;
}

// Progreso de la meta de producción de un mes: redistribuye el
// faltante/excedente acumulado (contra lo que se debería llevar generado
// a este punto) entre los días de producción que quedan, en vez de
// volcarlo todo de golpe al día siguiente. "Generado" solo cuenta días ya
// CERRADOS (cierres de cashbox), así la meta de hoy queda fija durante
// todo el día y no se recalcula sola conforme entran ganancias de hoy.
function getProgresoMes(mesLabel) {
  const config = getMeta(mesLabel);
  if (!config) return null;

  const cierresDelMes = cashbox.getCierres().filter((c) => c.fecha.slice(0, 7) === mesLabel);
  const diasTranscurridos = cierresDelMes.length;
  const generadoAcumulado = cierresDelMes.reduce((sum, c) => sum + c.ganancias, 0);
  // Una vez pasados los días de producción planeados, lo que quede del mes
  // se trata como el último tramo (piso de 1 día) en vez de dividir entre
  // cero o un número negativo.
  const diasProduccionRestantes = Math.max(config.diasProduccion - diasTranscurridos, 1);
  const metaEsperadaAcumulada = config.metaDiariaBase * diasTranscurridos;
  const deficitAcumulado = metaEsperadaAcumulada - generadoAcumulado;
  const metaHoy = Math.max(config.metaDiariaBase + deficitAcumulado / diasProduccionRestantes, 0);

  return {
    mes: mesLabel,
    metaDiariaBase: config.metaDiariaBase,
    diasProduccion: config.diasProduccion,
    metaMensualReferencia: config.metaDiariaBase * config.diasProduccion,
    diasTranscurridos,
    diasProduccionRestantes,
    generadoAcumulado,
    metaEsperadaAcumulada,
    deficitAcumulado: Math.round(deficitAcumulado * 100) / 100,
    metaHoy: Math.round(metaHoy * 100) / 100,
  };
}

// Progreso de HOY (mes en curso): agrega lo que ya se lleva generado hoy
// mismo (todavía sin cerrar) contra la meta de hoy ya calculada.
function getProgresoHoy() {
  const mesActual = cashbox.getMesActualLabel();
  const progreso = getProgresoMes(mesActual);
  if (!progreso) return null;
  const generadoHoy = cashbox.getToday().ganancias;
  const faltaHoy = Math.max(progreso.metaHoy - generadoHoy, 0);
  const excedenteHoy = Math.max(generadoHoy - progreso.metaHoy, 0);
  return {
    ...progreso,
    generadoHoy,
    faltaHoy: Math.round(faltaHoy * 100) / 100,
    excedenteHoy: Math.round(excedenteHoy * 100) / 100,
    cumplido: generadoHoy >= progreso.metaHoy,
  };
}

module.exports = { getMeta, getAllMetas, setMeta, removeMeta, getProgresoMes, getProgresoHoy };
