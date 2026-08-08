const fs = require("fs");
const path = require("path");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("scheduled-broadcasts-data.json");
const IMAGES_DIR = dataPath("broadcast-images");

// Mensajes (con foto opcional) que se mandan solos a ciertos grupos, a
// ciertas horas del día (hora Perú), todos los días mientras estén
// activos. "ultimoEnvio" guarda, por horario, la última fecha (YYYY-MM-DD)
// en que ya se mandó, para no reenviar dos veces si el scheduler del bot
// vuelve a caer en el mismo minuto.
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { broadcasts: Array.isArray(parsed.broadcasts) ? parsed.broadcasts : [] };
  } catch (err) {
    return { broadcasts: [] };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar scheduled-broadcasts-data.json:", err.message);
  }
}

function getAll() {
  return data.broadcasts;
}

function getById(id) {
  return data.broadcasts.find((b) => b.id === id) || null;
}

function normalizarHorarios(horarios) {
  if (!Array.isArray(horarios)) return [];
  const validos = horarios.filter((h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h));
  return Array.from(new Set(validos)).sort();
}

function addBroadcast({ nombre, texto, groupIds, horarios }) {
  const nombreLimpio = String(nombre || "").trim();
  if (!nombreLimpio) throw new Error("Ponle un nombre al mensaje programado.");
  const horariosValidos = normalizarHorarios(horarios);
  if (horariosValidos.length === 0) throw new Error("Agrega al menos un horario válido (HH:MM).");
  if (!Array.isArray(groupIds) || groupIds.length === 0) throw new Error("Elige al menos un grupo.");

  const nuevo = {
    id: "bc_" + Date.now(),
    nombre: nombreLimpio,
    texto: String(texto || "").trim(),
    imagenArchivo: null,
    groupIds: groupIds.slice(),
    horarios: horariosValidos,
    activo: true,
    ultimoEnvio: {},
  };
  data.broadcasts.push(nuevo);
  save();
  return nuevo;
}

function editBroadcast(id, cambios) {
  const b = data.broadcasts.find((x) => x.id === id);
  if (!b) return null;
  if (cambios.nombre !== undefined && String(cambios.nombre).trim()) b.nombre = String(cambios.nombre).trim();
  if (cambios.texto !== undefined) b.texto = String(cambios.texto).trim();
  if (cambios.groupIds !== undefined) {
    if (!Array.isArray(cambios.groupIds) || cambios.groupIds.length === 0) throw new Error("Elige al menos un grupo.");
    b.groupIds = cambios.groupIds.slice();
  }
  if (cambios.horarios !== undefined) {
    const horariosValidos = normalizarHorarios(cambios.horarios);
    if (horariosValidos.length === 0) throw new Error("Agrega al menos un horario válido (HH:MM).");
    b.horarios = horariosValidos;
  }
  save();
  return b;
}

function setActivo(id, activo) {
  const b = data.broadcasts.find((x) => x.id === id);
  if (!b) return null;
  b.activo = !!activo;
  save();
  return b;
}

function borrarImagenDeDisco(b) {
  if (!b?.imagenArchivo) return;
  try {
    fs.unlinkSync(path.join(IMAGES_DIR, b.imagenArchivo));
  } catch (err) {
    // ya no estaba o no se pudo borrar: no es crítico
  }
}

function removeBroadcast(id) {
  const b = data.broadcasts.find((x) => x.id === id);
  if (b) borrarImagenDeDisco(b);
  const antes = data.broadcasts.length;
  data.broadcasts = data.broadcasts.filter((x) => x.id !== id);
  if (data.broadcasts.length !== antes) save();
}

// Guarda la imagen subida (reemplaza la anterior si había una).
function setImagen(id, buffer, extension) {
  const b = data.broadcasts.find((x) => x.id === id);
  if (!b) return null;
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  borrarImagenDeDisco(b);
  const archivo = `${id}${extension}`;
  fs.writeFileSync(path.join(IMAGES_DIR, archivo), buffer);
  b.imagenArchivo = archivo;
  save();
  return b;
}

function quitarImagen(id) {
  const b = data.broadcasts.find((x) => x.id === id);
  if (!b) return null;
  borrarImagenDeDisco(b);
  b.imagenArchivo = null;
  save();
  return b;
}

function getImagenPath(id) {
  const b = data.broadcasts.find((x) => x.id === id);
  if (!b?.imagenArchivo) return null;
  return path.join(IMAGES_DIR, b.imagenArchivo);
}

// Mensajes activos que tocan mandarse AHORA: su horario coincide con
// "horarioActual" (HH:MM, hora Perú) y todavía no se mandaron hoy para
// ese horario. Lo llama el scheduler del bot cada ~30s.
function getPendientesParaHorario(horarioActual, fechaHoy) {
  return data.broadcasts.filter((b) => {
    if (!b.activo) return false;
    if (!b.horarios.includes(horarioActual)) return false;
    return b.ultimoEnvio[horarioActual] !== fechaHoy;
  });
}

function registrarEnvio(id, horario, fechaHoy) {
  const b = data.broadcasts.find((x) => x.id === id);
  if (!b) return;
  b.ultimoEnvio[horario] = fechaHoy;
  save();
}

module.exports = {
  getAll,
  getById,
  addBroadcast,
  editBroadcast,
  setActivo,
  removeBroadcast,
  setImagen,
  quitarImagen,
  getImagenPath,
  getPendientesParaHorario,
  registrarEnvio,
};
