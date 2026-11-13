const fs = require("fs");
const { dataPath } = require("./dataDir");

// Modo alerta: el local avisa sin querer que viene un pedido.
//
// Lo que pasó en ARTIA PASTELERIA (13/11): el local reenvió la ubicación, la
// referencia ("Centro de salud la palma") y el contacto del cliente ("Fer
// +51 977…"), y recién después escribió "pedido listo". Otro motorizado ya
// tenía el "voy" listo y le ganó al bot, que esperó sus 700 ms.
//
// Ahora, apenas llega una de esas señales, ese grupo queda "en alerta" unos
// minutos: si en ese tiempo llega el pedido, el bot responde con la espera
// corta (300 ms por defecto) en vez de la del grupo, y no se queda esperando
// al filtro inteligente (las señales ya dicen que es pedido). Cuando marca,
// o se acaba el tiempo, el grupo vuelve a su espera de siempre.
//
// Las señales NO hacen que el bot responda: solo lo dejan listo para cuando
// llegue la palabra clave.
//
// Solo en los locales elegidos en el panel (arranca con ARTIA): en los demás
// todo sigue igual que siempre.

const DATA_PATH = dataPath("alerta-pedidos.json");
const POR_DEFECTO = { activo: true, esperaMs: 300, minutos: 3, grupos: ["ARTIA PASTELERIA (dribox)"] };
const ESPERA_MIN_MS = 100;
const ESPERA_MAX_MS = 1000;
const MINUTOS_MAX = 15;

function cargar() {
  try {
    const guardado = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    const config = { ...POR_DEFECTO, ...guardado };
    if (!Array.isArray(config.grupos)) config.grupos = [...POR_DEFECTO.grupos];
    return config;
  } catch {
    return { ...POR_DEFECTO, grupos: [...POR_DEFECTO.grupos] };
  }
}

// Los grupos se guardan por nombre (como los delays por grupo), sin
// importar mayúsculas ni espacios de más.
function keyOf(nombreGrupo) {
  return String(nombreGrupo || "").trim().toUpperCase();
}

function grupoPrendido(nombreGrupo) {
  const clave = keyOf(nombreGrupo);
  return Boolean(clave) && config.grupos.some((g) => keyOf(g) === clave);
}

let config = cargar();

function guardar() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("No se pudo guardar alerta-pedidos.json:", err.message);
  }
}

function getConfig() {
  return {
    ...config,
    grupos: [...config.grupos],
    esperaMinMs: ESPERA_MIN_MS,
    esperaMaxMs: ESPERA_MAX_MS,
    minutosMax: MINUTOS_MAX,
  };
}

// Valida y guarda. Lanza un Error con el mensaje para el panel.
function setConfig({ activo, esperaMs, minutos } = {}) {
  if (typeof activo !== "boolean") throw new Error("Falta prender o apagar el modo alerta.");
  const espera = Number(esperaMs);
  if (!Number.isInteger(espera) || espera < ESPERA_MIN_MS || espera > ESPERA_MAX_MS) {
    throw new Error(`La espera en alerta tiene que ser entre ${ESPERA_MIN_MS} y ${ESPERA_MAX_MS} ms.`);
  }
  const min = Number(minutos);
  if (!Number.isInteger(min) || min < 1 || min > MINUTOS_MAX) {
    throw new Error(`La alerta tiene que durar entre 1 y ${MINUTOS_MAX} minutos.`);
  }
  config = { ...config, activo, esperaMs: espera, minutos: min };
  guardar();
  if (!activo) alertas.clear();
  return getConfig();
}

function agregarGrupo(nombreGrupo) {
  const nombre = String(nombreGrupo || "").trim();
  if (!nombre) throw new Error("Elige un grupo.");
  if (!grupoPrendido(nombre)) {
    config.grupos.push(nombre);
    guardar();
  }
  return getConfig();
}

function quitarGrupo(nombreGrupo) {
  const clave = keyOf(nombreGrupo);
  config.grupos = config.grupos.filter((g) => keyOf(g) !== clave);
  guardar();
  for (const [chatId, a] of alertas) if (keyOf(a.grupo) === clave) alertas.delete(chatId);
  return getConfig();
}

// ---------- Las señales ----------
// WhatsApp mete caracteres invisibles alrededor de los números que formatea.
const INVISIBLES = /[​-‏‪-‮⁠-⁩﻿]/g;
// Celular peruano: 9 dígitos que empiezan con 9, con o sin el 51 adelante.
const CELULAR = /(?:\+?\s*51[\s.-]*)?9\d{2}[\s.-]*\d{3}[\s.-]*\d{3}(?!\d)/;
const LINK_DE_UBICACION = /(maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google\.|waze\.com\/ul)/i;

// El contacto del cliente escrito a mano: el número y, como mucho, un nombre
// o unas pocas palabras ("Fer +51 977 366 264", "Cel cliente: 987050639").
// Una frase larga con un número adentro no cuenta.
function pareceContactoDeCliente(rawText) {
  const texto = String(rawText || "").replace(INVISIBLES, "");
  const m = texto.match(CELULAR);
  if (!m) return false;
  const resto = (texto.slice(0, m.index) + " " + texto.slice(m.index + m[0].length))
    .replace(/[^\p{L}\s]/gu, " ")
    .trim();
  const palabras = resto ? resto.split(/\s+/) : [];
  return palabras.length <= 4 && resto.length <= 40;
}

// Devuelve el nombre de la señal (para el panel) o null.
function detectarSenal({ esUbicacion = false, esContacto = false, esReenviado = false, rawText = "" } = {}) {
  if (esUbicacion) return "ubicación";
  if (esContacto) return "contacto del cliente";
  if (LINK_DE_UBICACION.test(rawText)) return "link de ubicación";
  if (pareceContactoDeCliente(rawText)) return "número del cliente";
  if (esReenviado && String(rawText).trim()) return "datos reenviados";
  return null;
}

// ---------- Las alertas activas (en memoria: duran minutos) ----------
const alertas = new Map(); // chatId -> { grupo, senal, desdeMs, hastaMs }

function activar(chatId, senal, nombreGrupo, ahora = Date.now()) {
  if (!config.activo || !chatId || !senal || !grupoPrendido(nombreGrupo)) return null;
  const anterior = alertas.get(chatId);
  const alerta = {
    grupo: nombreGrupo || anterior?.grupo || chatId,
    senal,
    desdeMs: anterior && anterior.hastaMs > ahora ? anterior.desdeMs : ahora,
    hastaMs: ahora + config.minutos * 60 * 1000,
  };
  alertas.set(chatId, alerta);
  return alerta;
}

function enAlerta(chatId, ahora = Date.now()) {
  if (!config.activo) return null;
  const alerta = alertas.get(chatId);
  if (!alerta) return null;
  if (alerta.hastaMs <= ahora) {
    alertas.delete(chatId);
    return null;
  }
  return alerta;
}

// La espera para responder en ese grupo: la corta si está en alerta (nunca
// más larga que la que ya tenía el grupo), si no la de siempre.
function esperaPara(chatId, esperaNormalMs, ahora = Date.now()) {
  return enAlerta(chatId, ahora) ? Math.min(config.esperaMs, esperaNormalMs) : esperaNormalMs;
}

function terminar(chatId) {
  alertas.delete(chatId);
}

function activas(ahora = Date.now()) {
  const lista = [];
  for (const [chatId, a] of alertas) {
    if (a.hastaMs <= ahora) alertas.delete(chatId);
    else lista.push({ chatId, grupo: a.grupo, senal: a.senal, quedanSeg: Math.ceil((a.hastaMs - ahora) / 1000) });
  }
  return lista;
}

module.exports = {
  getConfig,
  setConfig,
  agregarGrupo,
  quitarGrupo,
  grupoPrendido,
  detectarSenal,
  pareceContactoDeCliente,
  activar,
  enAlerta,
  esperaPara,
  terminar,
  activas,
};
