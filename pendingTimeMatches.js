const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("pending-time-matches-data.json");

// Pedidos que mencionaron una hora fuera de la ventana del sector ("en 20
// minutos" con ventana de 15) y quedaron en espera para marcarse solos
// cuando el tiempo restante entre en la ventana. Persistido en disco para
// no perder un pedido en espera si el bot se reinicia (redeploy, caída).
//
// Cuánto tiempo pasada su hora se puede "recuperar" un pedido que no se
// llegó a marcar a tiempo (bot caído, reconectando). Pasado ese rato se
// descarta sin marcar: un "Voy" muy tarde para un pedido viejo confunde más
// de lo que ayuda. Mismo criterio que scheduledBroadcasts.js.
const VENTANA_RECUPERACION_MS = 30 * 60000;

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { pendientes: Array.isArray(parsed.pendientes) ? parsed.pendientes : [] };
  } catch (err) {
    return { pendientes: [] };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar pending-time-matches-data.json:", err.message);
  }
}

let siguienteId = 1;
data.pendientes.forEach((p) => {
  if (p.id >= siguienteId) siguienteId = p.id + 1;
});

// entry: { chatId, groupName, senderNumber, rawText, keyword, matchIndex,
//          matchLength, quotedStub, targetFireMs }
function add(entry) {
  const id = siguienteId++;
  data.pendientes.push({ id, ...entry });
  save();
  return id;
}

function remove(id) {
  const antes = data.pendientes.length;
  data.pendientes = data.pendientes.filter((p) => p.id !== id);
  if (data.pendientes.length !== antes) save();
}

// Los que ya llegaron a su hora (o pasaron, dentro de la ventana de
// recuperación). Los que quedaron muy atrasados se descartan sin marcar,
// de una vez, para que no se acumulen en el archivo.
function getDue(nowMs) {
  const vencidos = data.pendientes.filter((p) => p.targetFireMs <= nowMs);
  const utilizables = [];
  vencidos.forEach((p) => {
    if (nowMs - p.targetFireMs > VENTANA_RECUPERACION_MS) {
      remove(p.id);
    } else {
      utilizables.push(p);
    }
  });
  return utilizables;
}

function getAll() {
  return data.pendientes.slice().sort((a, b) => a.targetFireMs - b.targetFireMs);
}

module.exports = { add, remove, getDue, getAll };
