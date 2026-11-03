const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");
const { dataPath } = require("./dataDir");
const aiEjemplos = require("./aiEjemplos");

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
//
// Lo que el dueño le enseña a mano (aiEjemplos.js) manda sobre todo: la frase
// exacta decide sin preguntar, y las demás van como ejemplos para que la IA
// entienda también las parecidas.
const DATA_PATH = dataPath("ai-decisions-data.json");

const MODELO = "claude-haiku-4-5";
const TIMEOUT_MS = 1000; // tope duro: pasado esto, el bot marca sin esperar
// Desde el panel ("Preguntar al filtro") no hay nadie compitiendo por el
// pedido: se le da más tiempo para que conteste aunque ande lenta.
const TIMEOUT_PRUEBA_MS = 15000;

// Por qué frenó, según el número de caso que contesta la IA ("NO 3").
const MOTIVOS = {
  1: "pregunta el precio o pide cotización",
  2: "habla de un pedido que ya pasó (agradece, confirma que llegó)",
  3: "cancela o avisa que ya no hace falta",
  4: "lo manda con otra empresa o por su cuenta",
  5: "es otro tema: saludo, conversación o coordinación",
  6: "se parece a una frase que le enseñaste",
};

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
- "NO 1" a "NO 5" → no están pidiendo un motorizado; el número es el caso
                  en el que encaja (ejemplo: "NO 1" si preguntan el precio).
                  En los ejemplos de abajo va entre paréntesis.
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
// que "Ya Puede  Venir" y "ya puede venir" cuenten como la misma frase. Es la
// misma que usan las frases enseñadas, así las dos se reconocen entre sí.
const { claveDe } = aiEjemplos;

function estaConfigurado() {
  return Boolean((process.env.ANTHROPIC_API_KEY || "").trim());
}

let cliente = null;
function getCliente() {
  if (!cliente) cliente = new Anthropic();
  return cliente;
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

// ---------- Memoria por local ----------
// Lo que la IA contesta depende de los ejemplos que leyó. Un local con frases
// enseñadas propias lee ejemplos que los demás no, así que su respuesta no
// sirve para otros (ni la de los otros para él): se guarda aparte, con el
// grupo delante de la frase. Los locales sin frases propias comparten la
// memoria de siempre.
function claveMemoria(clave, groupId) {
  return groupId ? `${groupId}::${clave}` : clave;
}

function usaMemoriaPropia(groupId) {
  return aiEjemplos.tieneLocales(groupId);
}

// ¿Esta entrada de la memoria es de esa frase? (en la memoria general o en la
// de algún local)
function esDeLaFrase(k, d, clave) {
  return k === clave || (Boolean(d.groupId) && k === claveMemoria(clave, d.groupId));
}

// ¿Esta entrada cae dentro de lo que cubre una frase enseñada? Las generales
// cubren todo; las de un local, solo lo aprendido para ese local.
function enAlcance(d, groupId) {
  return groupId ? d.groupId === groupId : true;
}

function olvidar(condicion) {
  let cuantas = 0;
  Object.keys(data.decisiones).forEach((k) => {
    if (condicion(data.decisiones[k], k)) {
      delete data.decisiones[k];
      cuantas++;
    }
  });
  return cuantas;
}

function desdeEjemplo(e) {
  return {
    esPedido: e.esPedido,
    hora: null, // la hora la leen las reglas de siempre
    caso: e.esPedido ? null : 6,
    manual: true,
    texto: e.texto,
    fuente: e.groupId ? "ejemplo-local" : "ejemplo-global",
    ejemploId: e.id,
  };
}

// Lo que ya se sabe de esta frase en este grupo, sin preguntarle a nadie. De
// lo más específico a lo más general:
//   1. una frase enseñada para ESE local
//   2. una corrección tuya hecha en lo aprendido de ESE local
//   3. una frase enseñada para todos
//   4. una corrección tuya general
//   5. lo que la IA ya contestó antes (del local si tiene memoria propia)
function decisionConocida(texto, groupId) {
  const clave = claveDe(texto);
  if (!clave) return null;

  const ejemplo = aiEjemplos.buscarExacto(texto, groupId);
  if (ejemplo && ejemplo.groupId) return desdeEjemplo(ejemplo);

  const propia = groupId ? data.decisiones[claveMemoria(clave, groupId)] : null;
  if (propia && propia.manual) return { ...propia, fuente: "correccion" };

  if (ejemplo) return desdeEjemplo(ejemplo);

  const general = data.decisiones[clave];
  if (general && general.manual) return { ...general, fuente: "correccion" };

  if (usaMemoriaPropia(groupId)) return propia ? { ...propia, fuente: "memoria" } : null;
  return general ? { ...general, fuente: "memoria" } : null;
}

function getDecision(texto, groupId) {
  return decisionConocida(texto, groupId);
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
  // Una corrección tuya vale para todos: lo que la IA había contestado para
  // un local en particular queda viejo.
  if (manual) olvidar((d, k) => !d.manual && Boolean(d.groupId) && esDeLaFrase(k, d, clave));
  save();
}

// Lo que la IA contestó, guardado para no volver a preguntar. Si el local
// tiene frases propias, va a su memoria aparte (ver claveMemoria).
function guardarAprendida(texto, groupId, { esPedido, hora, caso }) {
  const clave = claveDe(texto);
  if (!clave) return;
  const propio = usaMemoriaPropia(groupId);
  data.decisiones[claveMemoria(clave, propio ? groupId : null)] = {
    esPedido,
    manual: false,
    hora: hora || null,
    caso: caso || null,
    texto: String(texto || "").slice(0, 200),
    fecha: new Date().toISOString(),
    ...(propio ? { groupId } : {}),
  };
  save();
}

// "Cambiar" desde la lista de lo aprendido. Se corrige ESA entrada, así una
// frase aprendida para un local sigue valiendo solo para ese local.
function corregir(claveMapa, esPedido) {
  const d = data.decisiones[claveMapa];
  if (!d) return false;
  d.esPedido = Boolean(esPedido);
  d.manual = true;
  d.caso = null;
  d.fecha = new Date().toISOString();
  if (!d.groupId) olvidar((x, k) => !x.manual && Boolean(x.groupId) && esDeLaFrase(k, x, claveMapa));
  save();
  return true;
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

// ---------- Lo que lee la IA ----------
function lineaEjemplo(e) {
  return `- "${e.texto.replace(/"/g, "'")}" → ${e.esPedido ? "SI" : "NO 6"}`;
}

// Las frases enseñadas para todos van pegadas a las instrucciones (y entran
// en el mismo caché). Mandan sobre los ejemplos de fábrica: las revisó el
// dueño mirando sus propios grupos.
function bloqueGlobales() {
  const globales = aiEjemplos.getGlobales();
  if (!globales.length) return null;
  return `FRASES QUE TE ENSEÑÓ EL DUEÑO

El dueño revisó estas frases a mano mirando sus grupos. Mandan sobre todo lo
anterior y cuentan como un caso más, el 6:
- Si el mensaje dice LO MISMO que una frase marcada NO, aunque use otras
  palabras, responde "NO 6".
- Si dice lo mismo que una marcada SI, responde SI (con la hora si la dice).
- Si solo comparte algunas palabras pero dice otra cosa, no cuenta: sigue las
  reglas de arriba.

${globales.map(lineaEjemplo).join("\n")}`;
}

// Las de un local van en el mensaje: cambian de grupo a grupo, y meterlas en
// las instrucciones rompería el caché de todos los demás.
function bloqueLocales(groupId) {
  const locales = aiEjemplos.getLocales(groupId);
  if (!locales.length) return null;
  return `Este local tiene frases propias que te enseñó el dueño. Valen solo para este grupo y mandan sobre todas las demás. Si el mensaje dice LO MISMO que una marcada NO, aunque use otras palabras, responde "NO 6"; si dice lo mismo que una marcada SI, responde SI. Si solo comparte algunas palabras pero dice otra cosa, no cuenta.

${locales.map(lineaEjemplo).join("\n")}`;
}

// Lee la respuesta. Solo un "NO" claro frena al bot: cualquier otra cosa
// (respuesta rara, vacía o inesperada) se toma como que sí es pedido.
function interpretar(dijo) {
  const esPedido = !/^NO(?:\b|(?=\d))/.test(dijo);
  const numero = esPedido ? null : dijo.match(/^NO\D{0,8}?([1-6])/);
  return {
    esPedido,
    hora: esPedido ? parsearHora(dijo) : null,
    caso: numero ? Number(numero[1]) : null,
  };
}

async function consultarIA(texto, keyword, groupId, timeoutMs) {
  const system = [{ type: "text", text: INSTRUCCIONES }];
  const globales = bloqueGlobales();
  if (globales) system.push({ type: "text", text: globales });
  system[system.length - 1].cache_control = { type: "ephemeral" };

  // La palabra clave va junto al mensaje: sin ella la IA no tiene forma de
  // saber por qué saltó el bot. Un "box" suelto le parecía una palabra
  // cualquiera y frenaba un pedido de verdad.
  const locales = bloqueLocales(groupId);
  const partes = [];
  if (locales) partes.push(locales);
  if (keyword) partes.push(`Palabra clave que activó al bot: "${keyword}"`);
  partes.push(partes.length ? `Mensaje: ${texto}` : texto);

  const respuesta = await getCliente().messages.create(
    {
      model: MODELO,
      max_tokens: 12,
      system,
      messages: [{ role: "user", content: partes.join("\n\n") }],
    },
    { timeout: timeoutMs, maxRetries: 0 } // sin reintentos: el tope es el tope
  );

  const dijo = respuesta.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim()
    .toUpperCase();
  return interpretar(dijo);
}

// Las dos respuestas de una: si hay que marcar, y para cuándo es el pedido.
// SIEMPRE devuelve esPedido:true ante cualquier problema (ver regla 2), y
// hora:null, que significa "no sé" — ahí mandan las reglas de siempre.
async function analizar(texto, keyword, groupId) {
  const clave = claveDe(texto);
  if (!clave) return { esPedido: true, hora: null, consultada: false };

  const conocida = decisionConocida(texto, groupId);
  // Instantáneo y sin costo. `consultada: false` importa: quien avisa de un
  // mensaje frenado solo debe avisar la PRIMERA vez, no cada repetición.
  if (conocida) {
    return { esPedido: conocida.esPedido, hora: conocida.hora || null, consultada: false, fuente: conocida.fuente };
  }

  if (!estaConfigurado()) return { esPedido: true, hora: null, consultada: false }; // sin llave configurada, no aplica

  try {
    const r = await consultarIA(texto, keyword, groupId, TIMEOUT_MS);
    guardarAprendida(texto, groupId, r);
    return { ...r, consultada: true };
  } catch (err) {
    console.error("Filtro de IA no disponible, se marca igual:", err.message);
    return { esPedido: true, hora: null, consultada: false };
  }
}

// Devuelve true si hay que marcar y false si hay que callarse.
async function esPedidoDeVerdad(texto) {
  return (await analizar(texto)).esPedido;
}

// ---------- "Preguntar al filtro" desde el panel ----------
// Dice qué haría el filtro con esa frase en ese grupo, y por qué. Si ya la
// sabe, contesta de memoria; si no, le pregunta de verdad a la IA. NO guarda
// nada: probar no cambia lo que hace el bot.
//
// `fresco` vuelve a preguntarle a la IA aunque ya la tenga aprendida (sirve
// para ver si con las frases enseñadas ahora contestaría distinto). Lo que
// decidiste tú — frases enseñadas y correcciones — no se salta nunca.
async function probar(texto, keyword, groupId, { fresco = false } = {}) {
  if (!claveDe(texto)) throw new Error("Escribe la frase que quieres probar.");

  const conocida = decisionConocida(texto, groupId);
  if (conocida && !(fresco && conocida.fuente === "memoria")) {
    return {
      configurado: estaConfigurado(),
      fuente: conocida.fuente,
      esPedido: conocida.esPedido,
      hora: conocida.hora || null,
      caso: conocida.caso || null,
      motivo: MOTIVOS[conocida.caso] || null,
      ejemplo: conocida.ejemploId ? aiEjemplos.getById(conocida.ejemploId) : null,
    };
  }

  if (!estaConfigurado()) return { configurado: false, fuente: null };

  const inicio = Date.now();
  try {
    const r = await consultarIA(texto, keyword, groupId, TIMEOUT_PRUEBA_MS);
    return {
      configurado: true,
      fuente: "ia",
      ...r,
      motivo: MOTIVOS[r.caso] || null,
      ms: Date.now() - inicio,
      tope: TIMEOUT_MS,
      // Para avisar si lo aprendido antes ya no coincide con lo que diría hoy.
      recordada: conocida ? { esPedido: conocida.esPedido } : null,
    };
  } catch (err) {
    return { configurado: true, fuente: "error", error: err.message, ms: Date.now() - inicio };
  }
}

// ---------- Frases enseñadas ----------
// Al enseñar una frase, lo aprendido antes que podría cambiar se olvida para
// que se vuelva a preguntar (ya con la frase nueva como ejemplo):
//   - la frase exacta, porque desde ahora decide la frase enseñada;
//   - lo aprendido con el veredicto CONTRARIO, porque alguna de esas puede
//     ser parecida. Las que ya coincidían no pueden cambiar por esto.
// Solo dentro del alcance: una frase de un local no toca lo de los demás.
// Tus correcciones a mano no se tocan nunca (salvo la de la frase exacta).
function ensenar(datos) {
  const { ejemplo, nuevo } = aiEjemplos.add(datos);
  const g = ejemplo.groupId;
  const exactas = olvidar((d, k) => esDeLaFrase(k, d, ejemplo.clave) && (g ? d.groupId === g : true));
  const parecidas = olvidar((d) => !d.manual && d.esPedido !== ejemplo.esPedido && enAlcance(d, g));
  save();
  return { ejemplo, nuevo, olvidadas: exactas + parecidas };
}

// Al borrar una, lo aprendido con su MISMO veredicto pudo haber salido de
// ella: se vuelve a preguntar. Y si el local se quedó sin frases propias,
// vuelve a la memoria general y la suya ya no sirve.
function desensenar(id) {
  const quitado = aiEjemplos.remove(id);
  if (!quitado) return null;
  const g = quitado.groupId;
  let olvidadas = olvidar((d) => !d.manual && d.esPedido === quitado.esPedido && enAlcance(d, g));
  if (g && !aiEjemplos.tieneLocales(g)) olvidadas += olvidar((d) => !d.manual && d.groupId === g);
  save();
  return { quitado, olvidadas };
}

module.exports = {
  analizar,
  esPedidoDeVerdad,
  estaConfigurado,
  getDecision,
  guardarDecision,
  corregir,
  getAll,
  removeDecision,
  probar,
  ensenar,
  desensenar,
  getEjemplos: aiEjemplos.getAll,
  MOTIVOS,
  MODELO,
};
