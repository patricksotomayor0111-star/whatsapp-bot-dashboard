const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("group-time-windows.json");
const MIN_MIN = 0;
const MAX_MIN = 180;

// Ventana de tiempo propia de un grupo puntual, que le gana a la de su
// sector. Hay locales donde "salen en 50 min" es lo normal y marcar a esa
// hora es válido, aunque el resto del sector trabaje con 15.
//
// Mismo patrón que groupDelays.js: se guarda por NOMBRE de grupo (no por
// id) para que siga valiendo si el bot se revincula y los ids cambian.
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      windows: parsed.windows && typeof parsed.windows === "object" ? parsed.windows : {},
      names: parsed.names && typeof parsed.names === "object" ? parsed.names : {},
    };
  } catch (err) {
    return { windows: {}, names: {} };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar group-time-windows.json:", err.message);
  }
}

function keyOf(nombreGrupo) {
  return (nombreGrupo || "").trim().toUpperCase();
}

// Minutos propios del grupo, o null si usa los de su sector.
function getWindow(nombreGrupo) {
  const v = data.windows[keyOf(nombreGrupo)];
  return typeof v === "number" ? v : null;
}

function setWindow(nombreGrupo, minutos) {
  if (!nombreGrupo || !nombreGrupo.trim()) throw new Error("Falta el nombre del grupo");
  const min = Number(minutos);
  if (!Number.isInteger(min) || min < MIN_MIN || min > MAX_MIN) {
    throw new Error(`La ventana del grupo debe ser un número entero entre ${MIN_MIN} y ${MAX_MIN} minutos`);
  }
  const k = keyOf(nombreGrupo);
  data.windows[k] = min;
  data.names[k] = nombreGrupo.trim();
  save();
}

function removeWindow(nombreGrupo) {
  const k = keyOf(nombreGrupo);
  delete data.windows[k];
  delete data.names[k];
  save();
}

// Lista para el panel: [{ name, minutos }]
function getList() {
  return Object.keys(data.windows).map((k) => ({
    name: data.names[k] || k,
    minutos: data.windows[k],
  }));
}

module.exports = { getWindow, setWindow, removeWindow, getList };
