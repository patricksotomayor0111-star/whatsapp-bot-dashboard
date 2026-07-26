const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("group-delays.json");
const MIN_MS = 100;
const MAX_MS = 1000;

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { delays: parsed.delays && typeof parsed.delays === "object" ? parsed.delays : {} };
  } catch (err) {
    return { delays: {} };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar group-delays.json:", err.message);
  }
}

function keyOf(nombreGrupo) {
  return (nombreGrupo || "").trim().toUpperCase();
}

// Delay personalizado de un grupo, o null si usa el global.
function getDelay(nombreGrupo) {
  const v = data.delays[keyOf(nombreGrupo)];
  return typeof v === "number" ? v : null;
}

function getAll() {
  return data.delays;
}

function setDelay(nombreGrupo, delayMs) {
  if (!nombreGrupo || !nombreGrupo.trim()) throw new Error("Falta el nombre del grupo");
  const ms = Number(delayMs);
  if (!Number.isInteger(ms) || ms < MIN_MS || ms > MAX_MS || ms % 100 !== 0) {
    throw new Error(`El delay debe ser un múltiplo de 100 entre ${MIN_MS} y ${MAX_MS}`);
  }
  data.delays[keyOf(nombreGrupo)] = ms;
  // Se guarda también el nombre "lindo" (tal cual se escribió) para mostrarlo en el panel.
  data.names = data.names || {};
  data.names[keyOf(nombreGrupo)] = nombreGrupo.trim();
  save();
}

function removeDelay(nombreGrupo) {
  const k = keyOf(nombreGrupo);
  delete data.delays[k];
  if (data.names) delete data.names[k];
  save();
}

// Lista para el panel: [{ name, delayMs }]
function getList() {
  data.names = data.names || {};
  return Object.keys(data.delays).map((k) => ({
    name: data.names[k] || k,
    delayMs: data.delays[k],
  }));
}

module.exports = { getDelay, getAll, setDelay, removeDelay, getList };
