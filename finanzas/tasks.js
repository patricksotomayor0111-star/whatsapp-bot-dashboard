const { crearAlmacen } = require("./almacenPorUsuario");
const businessDay = require("./businessDay");

// Tareas sueltas sin monto (ej. "botar la basura"), distintas de los
// recordatorios de pago (reminders.js): mientras no estén confirmadas,
// avisan cada AVISO_CADA_MS (no una vez al día).
const AVISO_CADA_MS = 30 * 60 * 1000;

const almacen = crearAlmacen("tasks-data.json", (parsed) => ({
  tasks: Array.isArray(parsed && parsed.tasks) ? parsed.tasks : [],
}));
const datos = almacen.datos;
const save = almacen.guardar;

function getAll() {
  return datos().tasks;
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
  datos().tasks.push(nueva);
  save();
  return nueva;
}

function editTask(id, texto) {
  const t = datos().tasks.find((x) => x.id === id);
  if (!t) return null;
  const limpio = String(texto || "").trim();
  if (limpio) t.texto = limpio;
  save();
  return t;
}

// Marca/desmarca como hecha. Al reabrirla (confirmado=false) se reinicia
// el aviso para que vuelva a avisar cada 30 minutos desde ese momento.
function setConfirmado(id, confirmado) {
  const t = datos().tasks.find((x) => x.id === id);
  if (!t) return null;
  t.confirmado = !!confirmado;
  if (!t.confirmado) t.ultimoAviso = null;
  save();
  return t;
}

function removeTask(id) {
  const antes = datos().tasks.length;
  datos().tasks = datos().tasks.filter((t) => t.id !== id);
  if (datos().tasks.length !== antes) save();
}

// Tareas sin confirmar que no se avisaron en los últimos 30 minutos (o
// nunca), para el chequeo periódico del bot.
function necesitanAviso() {
  const ahora = Date.now();
  return datos().tasks.filter((t) => !t.confirmado && (!t.ultimoAviso || ahora - t.ultimoAviso >= AVISO_CADA_MS));
}

function registrarAviso(ids) {
  const set = new Set(ids);
  const ahora = Date.now();
  datos().tasks.forEach((t) => {
    if (set.has(t.id)) t.ultimoAviso = ahora;
  });
  save();
}

module.exports = { getAll, addTask, editTask, setConfirmado, removeTask, necesitanAviso, registrarAviso };
