const fs = require("fs");
const { dataPath } = require("./dataDir");

// Frases que el dueño le enseña al filtro inteligente: "esto SÍ es pedido" o
// "esto NO es pedido", para todos los locales o solo para uno.
//
// Sirven de dos maneras:
//   1. Si llega EXACTAMENTE esa frase, decide la frase enseñada y no se le
//      pregunta nada a la IA (instantáneo y sin costo).
//   2. Van como ejemplos en lo que lee la IA, así también entiende las
//      frases PARECIDAS ("está bien, nos avisa con tiempo" enseña también
//      "ok, nos avisan con tiempo porfa").
//
// Las de un local solo cuentan para los mensajes de ese local: lo que en un
// grupo es un pedido, en otro puede ser conversación.
const DATA_PATH = dataPath("ai-examples-data.json");

// Topes para que lo que lee la IA no crezca sin límite: cada ejemplo se
// manda en cada consulta, y una consulta lenta es un pedido perdido.
const MAX_GLOBALES = 60;
const MAX_POR_LOCAL = 30;
const MAX_LARGO = 200;

// La misma clave que usa la memoria del filtro: sin tildes, sin mayúsculas
// y sin espacios de más, para que "Ya Puede  Venir" y "ya puede venir"
// cuenten como la misma frase.
const COMBINING = new RegExp("[̀-ͯ]", "g");
function claveDe(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(COMBINING, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    const ejemplos = Array.isArray(parsed.ejemplos) ? parsed.ejemplos : [];
    return { ejemplos: ejemplos.filter((e) => e && e.id && e.clave) };
  } catch (err) {
    return { ejemplos: [] };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar ai-examples-data.json:", err.message);
  }
}

function getAll() {
  return [...data.ejemplos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

function getById(id) {
  return data.ejemplos.find((e) => e.id === id) || null;
}

function getGlobales() {
  return data.ejemplos.filter((e) => !e.groupId);
}

function getLocales(groupId) {
  if (!groupId) return [];
  return data.ejemplos.filter((e) => e.groupId === groupId);
}

function tieneLocales(groupId) {
  return Boolean(groupId) && data.ejemplos.some((e) => e.groupId === groupId);
}

// La frase enseñada que corresponde EXACTAMENTE a este mensaje. La del local
// gana a la general: es lo más específico que dijo el dueño.
function buscarExacto(texto, groupId) {
  const clave = claveDe(texto);
  if (!clave) return null;
  if (groupId) {
    const local = data.ejemplos.find((e) => e.groupId === groupId && e.clave === clave);
    if (local) return local;
  }
  return data.ejemplos.find((e) => !e.groupId && e.clave === clave) || null;
}

function nuevoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Agrega una frase enseñada. Si ya estaba (misma frase y mismo alcance), se
// actualiza en vez de duplicarla: así cambiar de opinión es volver a
// enseñarla con el otro veredicto.
function add({ texto, esPedido, groupId, grupoNombre }) {
  const limpio = String(texto || "").replace(/\s+/g, " ").trim();
  if (!limpio) throw new Error("Escribe la frase que quieres enseñarle.");
  if (limpio.length > MAX_LARGO) throw new Error(`La frase es muy larga (máximo ${MAX_LARGO} letras).`);
  if (typeof esPedido !== "boolean") throw new Error("Falta decir si es pedido o no.");

  const clave = claveDe(limpio);
  const alcance = groupId ? String(groupId) : null;
  const existente = data.ejemplos.find((e) => e.clave === clave && (e.groupId || null) === alcance);

  if (existente) {
    existente.texto = limpio;
    existente.esPedido = esPedido;
    if (alcance) existente.grupoNombre = String(grupoNombre || existente.grupoNombre || alcance).slice(0, 100);
    existente.fecha = new Date().toISOString();
    save();
    return { ejemplo: existente, nuevo: false };
  }

  const cuantos = alcance ? getLocales(alcance).length : getGlobales().length;
  const tope = alcance ? MAX_POR_LOCAL : MAX_GLOBALES;
  if (cuantos >= tope) {
    throw new Error(
      alcance
        ? `Este local ya tiene ${tope} frases enseñadas. Borra alguna que ya no haga falta.`
        : `Ya hay ${tope} frases para todos los locales. Borra alguna que ya no haga falta.`
    );
  }

  const ejemplo = {
    id: nuevoId(),
    texto: limpio,
    clave,
    esPedido,
    groupId: alcance,
    grupoNombre: alcance ? String(grupoNombre || alcance).slice(0, 100) : null,
    fecha: new Date().toISOString(),
  };
  data.ejemplos.push(ejemplo);
  save();
  return { ejemplo, nuevo: true };
}

function remove(id) {
  const i = data.ejemplos.findIndex((e) => e.id === id);
  if (i === -1) return null;
  const [quitado] = data.ejemplos.splice(i, 1);
  save();
  return quitado;
}

module.exports = {
  claveDe,
  getAll,
  getById,
  getGlobales,
  getLocales,
  tieneLocales,
  buscarExacto,
  add,
  remove,
  MAX_GLOBALES,
  MAX_POR_LOCAL,
  MAX_LARGO,
};
