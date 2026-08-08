const fs = require("fs");
const { dataPath } = require("./dataDir");
const businessDay = require("./businessDay");

const DATA_PATH = dataPath("tasks-data.json");

// Tareas sueltas sin monto (ej. "botar la basura"), distintas de los
// recordatorios de pago (reminders.js): mientras no estén confirmadas,
// avisan cada AVISO_CADA_MS (no una vez al día).
const AVISO_CADA_MS = 30 * 60 * 1000;

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch (err) {
    return { tasks: [] };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar tasks-data.json:", err.message);
  }
}

function getAll() {
  return data.tasks;
}

function addTask(texto) {
  const limpio = String(texto || "").trim();
  if (!limpio) throw new Error("El texto de la tarea no puede estar vacío.");
  const nueva = {
    id: "task_" + Date.now(),
    texto: limpio,
    creado: businessDay.fechaLabel(businessDay.peruAhora()),
    confirmado: false,
    ultimoAviso: null,
  };
  data.tasks.push(nueva);
  save();
  return nueva;
}

function editTask(id, texto) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t) return null;
  const limpio = String(texto || "").trim();
  if (limpio) t.texto = limpio;
  save();
  return t;
}

// Marca/desmarca como hecha. Al reabrirla (confirmado=false) se reinicia
// el aviso para que vuelva a avisar cada 30 minutos desde ese momento.
function setConfirmado(id, confirmado) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t) return null;
  t.confirmado = !!confirmado;
  if (!t.confirmado) t.ultimoAviso = null;
  save();
  return t;
}

function removeTask(id) {
  const antes = data.tasks.length;
  data.tasks = data.tasks.filter((t) => t.id !== id);
  if (data.tasks.length !== antes) save();
}

// Tareas sin confirmar que no se avisaron en los últimos 30 minutos (o
// nunca), para el chequeo periódico del bot.
function necesitanAviso() {
  const ahora = Date.now();
  return data.tasks.filter((t) => !t.confirmado && (!t.ultimoAviso || ahora - t.ultimoAviso >= AVISO_CADA_MS));
}

function registrarAviso(ids) {
  const set = new Set(ids);
  const ahora = Date.now();
  data.tasks.forEach((t) => {
    if (set.has(t.id)) t.ultimoAviso = ahora;
  });
  save();
}

module.exports = { getAll, addTask, editTask, setConfirmado, removeTask, necesitanAviso, registrarAviso };
