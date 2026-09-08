const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const { dataPath } = require("./dataDir");

// Segunda opinión sobre los pedidos: las palabras clave ya dijeron que sí,
// y acá se revisa si de verdad están pidiendo un motorizado. Sirve para los
// casos donde la lista de palabras excluidas no alcanza y el bot responde
// donde no debía (que además delata que hay una app detrás).
//
// TRES REGLAS QUE NO SE TOCAN:
//   1. Si no hay ANTHROPIC_API_KEY, esto no existe: el bot se comporta
//      exactamente como antes. Nunca puede romper lo que ya funciona.
//   2. Si la IA falla, tarda de más o contesta algo raro, se marca IGUAL.
//      Perder un pedido es peor que una respuesta de más.
//   3. Cada frase se consulta UNA sola vez y la respuesta queda guardada.
//      Los locales repiten las mismas frases, así que a los pocos días casi
//      todo sale de memoria: instantáneo y sin costo.
const DATA_PATH = dataPath("ai-decisions-data.json");

const MODELO = "claude-haiku-4-5";
const TIMEOUT_MS = 1000; // tope duro: pasado esto, el bot marca sin esperar

const INSTRUCCIONES = `Eres el filtro de un bot de WhatsApp de una empresa de delivery en Ica, Perú.

La empresa tiene grupos con restaurantes y tiendas. Cuando un local necesita
que un motorizado vaya a recoger un pedido, lo escribe en su grupo, y el bot
responde "Voy" para tomar el encargo.

Ya se detectó una palabra clave en el mensaje. Tu única tarea es decidir si
el local REALMENTE está pidiendo un motorizado ahora o para una hora
concreta.

Responde SI cuando piden que vaya un motorizado. Ejemplos:
- "moto"
- "ya pueden venir por el pedido"
- "pedido listo para recoger"
- "necesito un motorizado para las 6"
- "un delivery porfa"

Responde NO cuando NO están pidiendo motorizado. Ejemplos:
- Preguntan precio o tarifa: "cuánto cobran hasta la unidad vecinal"
- Hablan de un pedido ya atendido: "ya se fue la moto", "gracias, llegó bien"
- Avisan que NO hace falta: "ya no, el cliente lo recoge", "cancelado"
- Dicen que lo mandan por otro lado: "lo enviamos con otro delivery"
- Conversación suelta, saludos, coordinación interna, cosas de otro tema

Ante la duda, responde SI: es peor perder un pedido que responder de más.

Responde ÚNICAMENTE con la palabra SI o la palabra NO, sin nada más.`;

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    return { decisiones: parsed.decisiones && typeof parsed.decisiones === "object" ? parsed.decisiones : {} };
  } catch (err) {
    return { decisiones: {} };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar ai-decisions-data.json:", err.message);
  }
}

// La clave de memoria: sin tildes, sin mayúsculas y sin espacios de más, para
// que "Ya Puede  Venir" y "ya puede venir" cuenten como la misma frase.
const COMBINING = new RegExp("[̀-ͯ]", "g");
function claveDe(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(COMBINING, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function estaConfigurado() {
  return Boolean((process.env.ANTHROPIC_API_KEY || "").trim());
}

let cliente = null;
function getCliente() {
  if (!cliente) cliente = new Anthropic();
  return cliente;
}

function getDecision(texto) {
  const clave = claveDe(texto);
  if (!clave) return null;
  return data.decisiones[clave] || null;
}

function guardarDecision(texto, esPedido, manual) {
  const clave = claveDe(texto);
  if (!clave) return;
  data.decisiones[clave] = {
    esPedido: Boolean(esPedido),
    manual: Boolean(manual), // corregida a mano: la IA ya no la vuelve a mirar
    texto: String(texto || "").slice(0, 200),
    fecha: new Date().toISOString(),
  };
  save();
}

function getAll() {
  return Object.entries(data.decisiones)
    .map(([clave, d]) => ({ clave, ...d }))
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

function removeDecision(clave) {
  if (!data.decisiones[clave]) return false;
  delete data.decisiones[clave];
  save();
  return true;
}

// Devuelve true si hay que marcar y false si hay que callarse.
// SIEMPRE devuelve true ante cualquier problema (ver regla 2).
async function esPedidoDeVerdad(texto) {
  const clave = claveDe(texto);
  if (!clave) return true;

  const recordada = data.decisiones[clave];
  if (recordada) return recordada.esPedido; // instantáneo y sin costo

  if (!estaConfigurado()) return true; // sin llave configurada, no aplica

  try {
    const respuesta = await getCliente().messages.create(
      {
        model: MODELO,
        max_tokens: 5,
        system: [{ type: "text", text: INSTRUCCIONES, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: texto }],
      },
      { timeout: TIMEOUT_MS, maxRetries: 0 } // sin reintentos: el tope es el tope
    );

    const dijo = respuesta.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim()
      .toUpperCase();

    // Solo un "NO" claro frena al bot. Cualquier otra cosa (respuesta rara,
    // vacía o inesperada) se toma como que sí es pedido.
    const esPedido = !/^NO\b/.test(dijo);
    guardarDecision(texto, esPedido, false);
    return esPedido;
  } catch (err) {
    console.error("Filtro de IA no disponible, se marca igual:", err.message);
    return true;
  }
}

module.exports = {
  esPedidoDeVerdad,
  estaConfigurado,
  getDecision,
  guardarDecision,
  getAll,
  removeDecision,
  MODELO,
};
