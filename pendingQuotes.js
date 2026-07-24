const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("pending-quotes-data.json");

// Cotizaciones de delivery de bumanguesa-web esperando respuesta en el
// grupo "CARTAS RESTAURANTES": se guarda por messageId (el id del mensaje
// que el bot mandó con el link de ubicación) -> { codigo, createdAt }, para
// poder validar después que una respuesta cita justo ese mensaje.
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  } catch (err) {
    return {};
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar pending-quotes-data.json:", err.message);
  }
}

// Una pendiente muy vieja (más de 1 hora) se descarta, por si quedó
// colgada de un reinicio del proceso o nunca se respondió.
const MAX_EDAD_MS = 60 * 60 * 1000;

function add(messageId, codigo) {
  data[messageId] = { codigo, createdAt: Date.now() };
  save();
}

function get(messageId) {
  const entry = data[messageId];
  if (!entry) return null;
  if (Date.now() - entry.createdAt > MAX_EDAD_MS) {
    delete data[messageId];
    save();
    return null;
  }
  return entry;
}

function remove(messageId) {
  delete data[messageId];
  save();
}

module.exports = { add, get, remove };
