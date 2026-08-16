const { crearAlmacen } = require("./almacenPorUsuario");
const users = require("./users");
const { usuarioActual } = require("./contexto");

// La meta de producción sembrada es la del dueño; una cuenta nueva la
// configura ella misma desde el panel.
function metasIniciales() {
  return usuarioActual() === users.DUENO_ID ? { ...SEED } : {};
}

const cashbox = require("./cashbox");


// Meta de producción diaria por mes: un mínimo diario base más una
// cantidad aproximada de días de producción del mes (puede incluir
// descansos; es solo referencia para calcular la meta mensual total).
// Semilla: agosto 2026, S/200 mínimo por día, ~27 días de producción
// (S/5,400 de referencia mensual).
const SEED = { "2026-08": { metaDiariaBase: 200, diasProduccion: 27 } };


const almacen = crearAlmacen("production-goals-data.json", function (parsed) {
  try {
    return { metas: parsed.metas && typeof parsed.metas === "object" ? parsed.metas : metasIniciales() };
  } catch (err) {
    return { metas: metasIniciales() };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;


function getMeta(mesLabel) {
  return datos().metas[mesLabel] || null;
}

function getAllMetas() {
  return Object.keys(datos().metas)
    .sort()
    .map((mes) => ({ mes, ...datos().metas[mes] }));
}

function setMeta(mesLabel, metaDiariaBase, diasProduccion) {
  if (!/^\d{4}-\d{2}$/.test(String(mesLabel || ""))) throw new Error("Mes inválido (usar YYYY-MM): " + mesLabel);
  datos().metas[mesLabel] = {
    metaDiariaBase: Number(metaDiariaBase) || 0,
    diasProduccion: Math.max(Number(diasProduccion) || 1, 1),
  };
  save();
  return { mes: mesLabel, ...datos().metas[mesLabel] };
}

function removeMeta(mesLabel) {
  const existia = Object.prototype.hasOwnProperty.call(datos().metas, mesLabel);
  delete datos().metas[mesLabel];
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
