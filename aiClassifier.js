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

LA EMPRESA SE LLAMA "BOX DELIVERY". Los locales le dicen "Box", "el box",
"boxito" o cosas así. **Cuando un local escribe el nombre de la empresa, casi
siempre es para llamar a un motorizado**, aunque no diga nada más: un "box"
suelto en el grupo es un pedido, igual que gritar el nombre de alguien para
que venga.

La empresa tiene grupos con restaurantes y tiendas. Cuando un local necesita
que un motorizado vaya a recoger un pedido, lo escribe en su grupo, y el bot
responde "Voy" para tomar el encargo.

Te va a llegar el mensaje junto con LA PALABRA CLAVE que activó al bot. Esa
palabra no la eligió una máquina: la configuró el dueño a propósito, porque en
sus grupos significa que están pidiendo un motorizado. **Tómala como una señal
fuerte a favor del SI.**

TU TAREA NO ES ADIVINAR SI ES UN PEDIDO. El bot ya decidió que lo parece.
Tu tarea es frenarlo SOLO si el mensaje encaja CLARAMENTE en uno de estos
cinco casos, que son los únicos que no son pedido:

  1. PRECIO: preguntan cuánto cobras, una tarifa, o piden una cotización.
  2. YA PASÓ: hablan de un pedido ya atendido, agradecen, confirman que
     llegó, comentan algo que ya se hizo.
  3. CANCELAN: avisan que ya no hace falta, que el cliente lo recoge, que se
     anuló.
  4. OTRO MEDIO: dicen que lo mandan con otra empresa o por su cuenta.
  5. OTRO TEMA: saludos, chiste, coordinación interna, conversación suelta
     que no tiene que ver con recoger un pedido.

Si encaja claramente en uno de esos cinco, responde NO.
En CUALQUIER otro caso, responde SI.

Y si dudas de si encaja o no, entonces NO encaja: responde SI. Que se te
escape un mensaje de más no cuesta casi nada; frenar un pedido de verdad le
cuesta el trabajo, porque compite contra otros delivery que responden en dos
segundos y no hay forma de arreglarlo a tiempo.

Además de eso, dices para cuándo es el pedido. Todo en una sola línea.

Formatos de respuesta, sin nada más:
- "NO"          → no están pidiendo un motorizado
- "SI"          → piden un motorizado para ahora mismo
- "SI +MINUTOS" → piden para dentro de un rato (ejemplo: "SI +30")
- "SI @HH:MM"   → piden para una hora concreta, en formato de 24 horas
                  (ejemplo: "SI @18:00")

Estos ejemplos son MENSAJES REALES de los grupos de esta empresa. Fíjate en
cómo escriben de verdad: corto, informal, muchas veces sin decir "moto" ni
"pedido".

SÍ pasan (no encajan en ninguno de los cinco casos):
- "box" → SI (están llamando a la empresa)
- "boxito porfa" → SI
- "moto" → SI
- "Buenas tardes un motorizado" → SI
- "Chicos, alguien puede acercarse a la cafetería" → SI
  (así es como llama la mayoría: sin nombrar moto ni pedido)
- "Hola chicos, alguien puede acercarse a la cafetería☕" → SI
- "Ya está listo el pedido, alguien cerca?" → SI
- "Listo chicos..!!!" → SI (avisan que el pedido ya está)
- "Me envía" → SI (después de haberles pasado la tarifa, esto es el pedido)
- "ya pueden venir por el pedido" → SI
- "Una móvil", "1 móvil", "La móvil por favor" → SI
  (a la moto también le dicen "móvil"; es lo mismo)
- "Una movil porfis", "Buenas noches una movil porfis" → SI
- "Otra moto" → SI (piden un segundo motorizado, es otro pedido)
- "Buenas tarde, una móvil q se dirija. A tienda, ocupo enviar documentos a
  mi contador" → SI (mandar documentos también es un encargo)
- "numero para pagar el delivery, ya esta listo pueden recoger" → SI
  (mezcla dos cosas, pero adentro hay un pedido de verdad)
- "manden moto en media hora" → SI +30
- "el pedido sale apenas termine de freír, como 20 minutitos" → SI +20
- "necesito un motorizado para las 6 de la tarde" → SI @18:00
- "vienen a recoger cuando cierre el colegio, 1 y media" → SI @13:30

Se frenan (sí encajan en uno de los cinco):
- "cotizar", "Cotización", "Cotización ?", "buenas cotizar" → NO (caso 1)
  Es lo que más escriben para pedir precio, muchas veces una palabra sola.
  Después de que les pasan la tarifa recién viene el pedido de verdad.
- "Costo" → NO (caso 1, una palabra: están preguntando cuánto)
- "cto esta cobrnado por movilidad?" → NO (caso 1, aunque diga "movilidad")
- "CLIENTE CANCELO TODO YO LE YAPEO EN BREVE" → NO (caso 3, cancelan)
- "Podrian traerme monedas porfavor" → NO (caso 5, no es un encargo del bot)
- "Chicos, cuanto es hasta esa dirección?😊" → NO (caso 1, precio)
- "Hola de calle Bolívar a esta dirección?" → NO (caso 1, precio)
- "la urbanización sol de Huacachina G2" → NO (caso 1: mandan la dirección
  suelta para que les cotices; el pedido recién viene después)
- "número para el pago del delivery" → NO (caso 1, están por pagarte)
- "Gracias llego", "ya se fue la moto" → NO (caso 2, ya pasó)
- "Entregado gracias" → NO (caso 2)
- "ya no, el cliente lo recoge", "cancelado" → NO (caso 3, cancelan)
- "lo enviamos con otro delivery" → NO (caso 4, otro medio)

ESCRIBEN MAL, Y A VECES A PROPÓSITO. Van apurados, en el celular, con una
mano. También hay locales que deforman las palabras aposta para que un bot no
los detecte. Un mensaje mal escrito sigue siendo un pedido:
- "v3nir", "venie", "ven8r", "ve nir" (separado) → SI, están diciendo "venir"
- "una movil porfis", "porfia" → SI
- "Recojode client", "Pendient" → SI
No frenes nada por estar mal escrito.

OJO CON ESTO: en los grupos también escriben los motorizados de la propia
empresa (sus nombres suelen llevar "Box"). Lo que ellos escriben es
coordinación interna, caso 5, y nunca es un pedido:
- "Voy", "Aquí", "Ingreso", "Se dirigen" → NO
- "8 soles" (le están pasando la tarifa al local) → NO
- "Buenas tardes por si sale algún pedido" → NO (el motorizado ofreciéndose)
- "Libre centro" → NO

Reglas sobre la hora:
- Si el mensaje NO dice cuándo, responde solo "SI". No inventes una hora.
- No uses la hora actual para nada: responde solo con lo que dice el mensaje.
  "en media hora" siempre es "+30", pase lo que pase.
- Si dicen una hora sin aclarar mañana o tarde, elige la que tenga sentido
  para un restaurante: "a las 6" es "@18:00", no las 6 de la mañana.

Ante la duda de la hora, no pongas hora.`;

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

// La hora que entendió la IA, en una forma que NO depende de cuándo se
// preguntó — si no, no se podría guardar. Dos formas posibles:
//   { minutos: 30 }        "en media hora"  → siempre 30 minutos después
//   { hour: 18, minute: 0 } "a las 6 de la tarde" → siempre las 18:00
function parsearHora(dijo) {
  const abs = dijo.match(/@\s*(\d{1,2})\s*:\s*(\d{2})/);
  if (abs) {
    const hour = Number(abs[1]);
    const minute = Number(abs[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
    return null;
  }
  const rel = dijo.match(/\+\s*(\d{1,4})/);
  if (rel) {
    const minutos = Number(rel[1]);
    // Más de un día no tiene sentido para un pedido de comida: si sale eso,
    // es que entendió cualquier cosa y mejor tratarlo como sin hora.
    if (minutos > 0 && minutos <= 1440) return { minutos };
  }
  return null;
}

function guardarDecision(texto, esPedido, manual, hora) {
  const clave = claveDe(texto);
  if (!clave) return;
  // Si no se pasa hora (la corrección desde el panel solo cambia el
  // veredicto), se conserva la que ya se había aprendido en vez de borrarla.
  const anterior = data.decisiones[clave];
  data.decisiones[clave] = {
    esPedido: Boolean(esPedido),
    manual: Boolean(manual), // corregida a mano: la IA ya no la vuelve a mirar
    hora: hora === undefined ? anterior?.hora || null : hora || null,
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

// Las dos respuestas de una: si hay que marcar, y para cuándo es el pedido.
// SIEMPRE devuelve esPedido:true ante cualquier problema (ver regla 2), y
// hora:null, que significa "no sé" — ahí mandan las reglas de siempre.
async function analizar(texto, keyword) {
  const clave = claveDe(texto);
  if (!clave) return { esPedido: true, hora: null, consultada: false };

  const recordada = data.decisiones[clave];
  // Instantáneo y sin costo. `consultada: false` importa: quien avisa de un
  // mensaje frenado solo debe avisar la PRIMERA vez, no cada repetición.
  if (recordada) return { esPedido: recordada.esPedido, hora: recordada.hora || null, consultada: false };

  if (!estaConfigurado()) return { esPedido: true, hora: null, consultada: false }; // sin llave configurada, no aplica

  try {
    const respuesta = await getCliente().messages.create(
      {
        model: MODELO,
        max_tokens: 12,
        system: [{ type: "text", text: INSTRUCCIONES, cache_control: { type: "ephemeral" } }],
        // La palabra clave va junto al mensaje: sin ella la IA no tiene forma
        // de saber por qué saltó el bot. Un "box" suelto le parecía una
        // palabra cualquiera y frenaba un pedido de verdad.
        messages: [
          {
            role: "user",
            content: keyword ? `Palabra clave que activó al bot: "${keyword}"\n\nMensaje: ${texto}` : texto,
          },
        ],
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
    const hora = esPedido ? parsearHora(dijo) : null;
    guardarDecision(texto, esPedido, false, hora);
    return { esPedido, hora, consultada: true };
  } catch (err) {
    console.error("Filtro de IA no disponible, se marca igual:", err.message);
    return { esPedido: true, hora: null, consultada: false };
  }
}

// Devuelve true si hay que marcar y false si hay que callarse.
async function esPedidoDeVerdad(texto) {
  return (await analizar(texto)).esPedido;
}

module.exports = {
  analizar,
  esPedidoDeVerdad,
  estaConfigurado,
  getDecision,
  guardarDecision,
  getAll,
  removeDecision,
  MODELO,
};
