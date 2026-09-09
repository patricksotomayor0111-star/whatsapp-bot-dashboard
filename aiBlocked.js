const fs = require("fs");
const crypto = require("crypto");
const { dataPath } = require("./dataDir");

// Los mensajes que el filtro de IA frenó.
//
// Existe por un pedido perdido: un local escribió "box" (el nombre de la
// empresa, y una palabra clave configurada a propósito), la IA no supo que eso
// era un llamado y se calló. Patrick no se enteró — el bot callado se ve igual
// que el bot que no vio nada — y se enteró al día siguiente, perdiendo el
// pedido.
//
// Ahora cada vez que la IA frena una frase NUEVA se guarda acá y se avisa al
// celular. Como cada frase se consulta una sola vez, no hay forma de que esto
// llene de notificaciones: es como mucho un aviso por frase nueva.
const DATA_PATH = dataPath("ai-blocked-data.json");

// Cuánto tiempo tiene sentido mandar el "Voy" de un pedido frenado. Pasado
// eso el aviso sirve para corregir la memoria, pero ya no para salir.
const VENTANA_MARCAR_MS = 30 * 60000;

// Solo interesa lo reciente: esto es una bandeja de avisos, no un historial.
const MAX_GUARDADOS = 50;

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    return { frenados: Array.isArray(parsed.frenados) ? parsed.frenados : [] };
  } catch (err) {
    return { frenados: [] };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar ai-blocked-data.json:", err.message);
  }
}

function add(entry) {
  const registro = { id: crypto.randomUUID(), fecha: Date.now(), ...entry };
  data.frenados.unshift(registro);
  if (data.frenados.length > MAX_GUARDADOS) data.frenados.length = MAX_GUARDADOS;
  save();
  return registro;
}

function getById(id) {
  return data.frenados.find((f) => f.id === id) || null;
}

function remove(id) {
  const antes = data.frenados.length;
  data.frenados = data.frenados.filter((f) => f.id !== id);
  if (data.frenados.length === antes) return false;
  save();
  return true;
}

function getAll() {
  return data.frenados.map((f) => ({ ...f, sePuedeMarcar: Date.now() - f.fecha <= VENTANA_MARCAR_MS }));
}

function sePuedeMarcar(registro) {
  return Boolean(registro) && Date.now() - registro.fecha <= VENTANA_MARCAR_MS;
}

module.exports = { add, getById, remove, getAll, sePuedeMarcar, VENTANA_MARCAR_MS };
