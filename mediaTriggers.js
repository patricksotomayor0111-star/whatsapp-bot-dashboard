const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("media-triggers-data.json");
// Archivo del sistema anterior, cuando solo existía lo de contacto compartido.
// Se lee una única vez para no perder los grupos que ya estaban configurados.
const CONTACTO_LEGACY_PATH = dataPath("contact-trigger-groups.json");

// Grupos donde el pedido no siempre llega como texto con palabra clave:
//   imagen   -> mandan una foto (nota escrita a mano, boleta)
//   contacto -> mandan una tarjeta de contacto
//   audio    -> mandan una nota de voz ("mándame un motorizado")
//
// En los tres casos el bot responde igual que con una palabra clave, y
// respeta TODAS las demás reglas (números ignorados, sector/grupo activos,
// ventana de tiempo, y apagarse solo después de responder).
const TIPOS = ["imagen", "contacto", "audio"];

const SEED = {
  imagen: ["CANTONES - BOX DELIVERY", "CHIFA LIU BOX DELIVERY", "CARTAS RESTAURANTES"],
  contacto: ["AYABACA - BUMANGUESA II"],
  audio: ["LAS NIEVES BOX DELIVERY"],
};

// Una nota de voz pidiendo un motorizado dura 2-5 segundos; una conversación
// dura bastante más. Como el bot NO puede escuchar el audio, este tope es lo
// que evita que conteste a cualquier nota de voz larga que no era un pedido.
const AUDIO_SEGUNDOS_DEFAULT = 15;

function leerContactoLegacy() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONTACTO_LEGACY_PATH, "utf8"));
    if (Array.isArray(parsed.groupNames) && parsed.groupNames.length) return parsed.groupNames;
  } catch (err) {
    // no existía: se usa la semilla normal
  }
  return null;
}

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    const out = { audioMaxSegundos: Number(parsed.audioMaxSegundos) || AUDIO_SEGUNDOS_DEFAULT };
    TIPOS.forEach((t) => {
      out[t] = Array.isArray(parsed[t]) ? parsed[t] : [];
    });
    return out;
  } catch (err) {
    // Primera vez: semilla, respetando los grupos de contacto que ya existían.
    return {
      imagen: SEED.imagen.slice(),
      contacto: leerContactoLegacy() || SEED.contacto.slice(),
      audio: SEED.audio.slice(),
      audioMaxSegundos: AUDIO_SEGUNDOS_DEFAULT,
    };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar media-triggers-data.json:", err.message);
  }
}
if (!fs.existsSync(DATA_PATH)) save();

function validarTipo(tipo) {
  if (!TIPOS.includes(tipo)) throw new Error("Tipo inválido: " + tipo);
  return tipo;
}

function normalizar(nombre) {
  return String(nombre || "").trim().toUpperCase();
}

function getConfig() {
  return {
    imagen: data.imagen.slice(),
    contacto: data.contacto.slice(),
    audio: data.audio.slice(),
    audioMaxSegundos: data.audioMaxSegundos,
  };
}

function isEnabled(tipo, nombreGrupo) {
  if (!TIPOS.includes(tipo)) return false;
  const n = normalizar(nombreGrupo);
  if (!n) return false;
  return data[tipo].some((g) => normalizar(g) === n);
}

function addGroup(tipo, nombreGrupo) {
  validarTipo(tipo);
  const nombre = String(nombreGrupo || "").trim();
  if (!nombre) throw new Error("Falta el nombre del grupo.");
  if (isEnabled(tipo, nombre)) throw new Error("Ese grupo ya estaba en la lista.");
  data[tipo].push(nombre);
  save();
}

function removeGroup(tipo, nombreGrupo) {
  validarTipo(tipo);
  const n = normalizar(nombreGrupo);
  const antes = data[tipo].length;
  data[tipo] = data[tipo].filter((g) => normalizar(g) !== n);
  if (data[tipo].length === antes) return false;
  save();
  return true;
}

function getAudioMaxSegundos() {
  return data.audioMaxSegundos;
}

function setAudioMaxSegundos(segundos) {
  const n = Number(segundos);
  if (!Number.isFinite(n) || n < 1 || n > 300) {
    throw new Error("El tope debe estar entre 1 y 300 segundos.");
  }
  data.audioMaxSegundos = Math.round(n);
  save();
  return data.audioMaxSegundos;
}

module.exports = {
  TIPOS,
  getConfig,
  isEnabled,
  addGroup,
  removeGroup,
  getAudioMaxSegundos,
  setAudioMaxSegundos,
};
