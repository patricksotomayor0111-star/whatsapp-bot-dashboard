// Pedidos que llegan SIN palabra clave: el local reenvía los datos del
// cliente (dirección, una nota) y enseguida manda el número del cliente.
//
// Es lo que hace a veces MISTER JUGO. Lo normal ahí es palabra clave → datos
// → número, pero cuando se saltan la palabra clave el bot no veía nada: los
// datos vienen REENVIADOS (y los reenviados no cuentan para las palabras
// clave) y el número suelto no es una palabra clave.
//
// La regla, tal como la pidió Patrick:
//   1. Llega un mensaje reenviado → se guarda (el bot no responde).
//   2. Llega el número del cliente → eso confirma que es pedido → "Voy"
//      citando el PRIMER reenviado (la dirección), no el número.
//   3. Si en ese mismo minuto hubo palabra clave, no se hace nada: ya se
//      marcó con esa.
//
// Todo pasa en menos de un minuto ("ellos envían al instante"), así que la
// memoria vive en RAM: si el bot se reinicia justo entre la dirección y el
// número, ese pedido no sale por acá. No vale la pena escribirlo a disco.
//
// Solo corre en los grupos prendidos en el panel (Pedidos sin texto → Datos
// del cliente), y se lleva por separado para cada persona que escribe: si un
// motorizado reenvía algo al mismo tiempo, no pisa los datos del local.

const VENTANA_MS = 60 * 1000;

// Palabras que pueden acompañar al número sin que deje de ser "solo el
// número": "cel 987 050 639", "Número del cliente: 987050639".
const PALABRAS_JUNTO_AL_NUMERO = new Set([
  "cel", "celular", "numero", "nro", "num", "tel", "telf", "telefono",
  "cliente", "del", "de", "contacto", "whatsapp", "wsp", "wasap", "whats",
]);

// WhatsApp mete caracteres invisibles alrededor de los números que
// formatea o que se copian de un contacto (marcas de dirección de texto).
const INVISIBLES = /[​-‏‪-‮⁠-⁩﻿]/g;

const datos = new Map(); // "chat|remitente" -> { ms, rawText, quotedStub }
const claves = new Map(); // "chat|remitente" -> ms de la última palabra clave

function llave(chatId, senderNumber) {
  return `${chatId}|${senderNumber || ""}`;
}

// ¿El mensaje es el número de un cliente (celular peruano) y nada más?
// Estricto a propósito: si trae otra cosa, no cuenta. Un "ya llegó, el
// cliente es el 987050639" no debe disparar un "Voy".
function esNumeroDeCliente(rawText) {
  const t = String(rawText || "")
    .replace(INVISIBLES, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  const sinPalabras = t.replace(/[a-z]+/g, (p) => (PALABRAS_JUNTO_AL_NUMERO.has(p) ? " " : p));
  if (/[a-z]/.test(sinPalabras)) return false; // quedó alguna otra palabra

  const digitos = sinPalabras.replace(/[\s\-.()+:#]/g, "");
  if (!/^\d+$/.test(digitos)) return false; // quedó otro símbolo

  // 9 dígitos que empiezan con 9, con o sin el 51 de Perú adelante.
  return /^(51)?9\d{8}$/.test(digitos);
}

// Guarda un reenviado. Se queda con el PRIMERO del paquete: si ya hay uno
// reciente de esa persona, el segundo reenviado ("puede decirle que me
// escriba…") no lo reemplaza — se cita la dirección, que es lo que llega
// primero.
function guardarDatos(chatId, senderNumber, { ms, rawText, quotedStub }) {
  const k = llave(chatId, senderNumber);
  const previo = datos.get(k);
  if (previo) {
    const pasaron = ms - previo.ms;
    if (pasaron >= 0 && pasaron <= VENTANA_MS) return false;
  }
  datos.set(k, { ms, rawText, quotedStub });
  podar(ms);
  return true;
}

// Anota que esa persona mandó una palabra clave en ese grupo.
function registrarClave(chatId, senderNumber, ms) {
  claves.set(llave(chatId, senderNumber), ms);
  podar(ms);
}

// Llegó el número: devuelve los datos reenviados que confirma (y los saca,
// para que no se usen dos veces), o null si no corresponde marcar.
function tomarDatos(chatId, senderNumber, ms) {
  const k = llave(chatId, senderNumber);
  const d = datos.get(k);
  if (!d) return null;

  const pasaron = ms - d.ms;
  if (pasaron < 0) return null; // el reenviado es posterior: no es este caso
  if (pasaron > VENTANA_MS) {
    datos.delete(k); // quedó viejo
    return null;
  }

  // Palabra clave en ese mismo minuto (antes de los datos o entre los datos
  // y el número): ese pedido ya se marcó con la palabra clave.
  const clave = claves.get(k);
  if (clave !== undefined && clave >= d.ms - VENTANA_MS) {
    datos.delete(k);
    return null;
  }

  datos.delete(k);
  return d;
}

// Limpieza liviana: la memoria no crece sin límite aunque el bot pase días
// prendido.
function podar(ahoraMs) {
  if (datos.size > 300) {
    for (const [k, d] of datos) if (ahoraMs - d.ms > VENTANA_MS) datos.delete(k);
  }
  if (claves.size > 300) {
    for (const [k, ms] of claves) if (ahoraMs - ms > VENTANA_MS) claves.delete(k);
  }
}

// Solo para las pruebas.
function _reiniciar() {
  datos.clear();
  claves.clear();
}

module.exports = { esNumeroDeCliente, guardarDatos, registrarClave, tomarDatos, VENTANA_MS, _reiniciar };
