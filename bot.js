// En Baileys v7 makeWASocket puede venir como export con nombre o como
// default según el build (CJS/ESM), así que se toma el que exista.
const baileysLib = require("@whiskeysockets/baileys");
const makeWASocket = baileysLib.makeWASocket || baileysLib.default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileysLib;
const P = require("pino");
const qrcode = require("qrcode-terminal");
const path = require("path");
const fs = require("fs");
const { positiveKeywords, excludedKeywords, defaultResponse } = require("./keywords");
const excludedNumbers = require("./excludedNumbers");
const dynamicKeywords = require("./dynamicKeywords");
const numberExceptions = require("./numberExceptions");
const pendingQuotes = require("./pendingQuotes");
const quoteConfig = require("./quoteConfig");
const pushSubscriptions = require("./pushSubscriptions");
const mediaTriggers = require("./mediaTriggers");
const groupDelays = require("./groupDelays");
const scheduledBroadcasts = require("./scheduledBroadcasts");
const pendingTimeMatches = require("./pendingTimeMatches");
const { dataPath } = require("./dataDir");
const { sectorSeedByName, specialSeedByName, numberExceptionSeed } = require("./groupSeed");
const {
  getGroupSector,
  isGroupActive,
  getFocusedGroups,
  getResponseDelay,
  hasGroupSector,
  setGroupSector,
  getTimeWindowMinutes,
  getEsperaAutomaticaActiva,
  getAntiguedadMaximaMin,
  isGroupSinRemarcarEfectivo,
  isGroupSectorActiveEfectivo,
} = require("./sectors");

const MAX_HISTORY = 100;

const SESSION_PATH = dataPath("session");

// Quita tildes/acentos ("móvil" -> "movil", "envía" -> "envia") para que dé
// igual si el mensaje o la palabra clave los llevan o no.
const COMBINING_MARKS = new RegExp("[̀-ͯ]", "g");
function normalizeText(str) {
  return str
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase();
}

// Convierte cada palabra clave en una expresión regular que solo coincide
// al INICIO de una palabra (no si está enterrada en medio de otra palabra).
// Así "ref" detecta "referencia" pero no "prefiero".
const WORD_CHARS = "a-z0-9";
function buildKeywordRegex(rawKeyword) {
  const keyword = normalizeText(rawKeyword.trim());
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const empiezaConLetraONumero = new RegExp(`^[${WORD_CHARS}]`, "i").test(keyword);
  const prefix = empiezaConLetraONumero ? `(?<![${WORD_CHARS}])` : "";
  return new RegExp(prefix + escaped, "i");
}

function buildMatchers(keywordList) {
  return keywordList.map((k) => ({ keyword: k, regex: buildKeywordRegex(k) }));
}

// Se reconstruyen en cada mensaje (no en el arranque) porque las keywords
// globales/excluidas/especiales se pueden agregar o quitar desde el panel
// en cualquier momento.
//
// Las keywords base (keywords.js) respetan las exclusiones como siempre.
// Las que se agregan desde el panel ("Keywords globales") NO se fijan en
// las exclusiones, igual que las especiales por grupo — pero sí siguen
// respetando que el sector/grupo estén activos.
function getBasePositiveMatchers() {
  return buildMatchers(positiveKeywords);
}

function getExtraPositiveMatchers() {
  return buildMatchers(dynamicKeywords.getExtraPositive());
}

function getExcludedMatchers() {
  return buildMatchers([...excludedKeywords, ...dynamicKeywords.getExtraExcluded()]);
}

// Palabras de relleno que se ignoran al buscar keywords especiales por grupo:
// "hola que hace una compra" se reduce a las palabras importantes ["hola","compra"].
const STOP_WORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "a", "en", "y", "o", "u",
  "que", "hace", "hacer", "hizo", "es", "son", "era", "fue", "ser", "estar", "esta", "estan", "estas",
  "para", "por", "con", "sin", "se", "su", "sus", "mi", "mis", "tu", "tus", "le", "les", "lo", "me", "te", "nos",
  "ese", "esa", "esos", "esas", "este", "estos", "ya", "no", "si", "mas", "muy", "pero",
  "como", "cuando", "donde", "quien", "cual", "hay", "ha", "he", "has", "han", "va", "van", "voy", "vas",
  "yo", "el", "ella", "ellos", "ellas", "nosotros", "ustedes", "tambien", "solo", "sobre", "entre",
]);

// De una frase deja solo las palabras "importantes" (sin conectores ni palabras de 1 letra).
function getSignificantWords(phrase) {
  return normalizeText(phrase)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

// Búsqueda flexible por palabras: alcanza con que TODAS las palabras
// importantes de la frase aparezcan en el mensaje (en cualquier orden, con
// lo que sea en el medio). Así "hola que hace una compra" también detecta
// "hola quiero una compra en metro" (tiene "hola" y "compra").
function matchPorPalabras(text, frase) {
  const palabras = getSignificantWords(frase);
  if (palabras.length === 0) return null;
  const resultados = palabras.map((w) => buildKeywordRegex(w).exec(text));
  if (!resultados.every(Boolean)) return null;
  const primero = resultados[0];
  return { keyword: frase, index: primero.index, length: primero[0].length };
}

// Las keywords especiales de un grupo: frases propias de ESE grupo que se
// saltan las palabras excluidas, pero respetan los bloqueos de número y que
// el sector/grupo estén activos (eso se chequea más adelante en el flujo).
function buscarKeywordEspecial(text, chatId) {
  for (const frase of dynamicKeywords.getSpecialForGroup(chatId)) {
    const m = matchPorPalabras(text, frase);
    if (m) return m;
  }
  return null;
}

// En estos 3 grupos suelen escribir "venir" apurados y con errores de
// tipeo ("ve ir", "venie", "v3nir", "ven8r"...). En vez de ir agregando
// cada variante a mano, se compara cada palabra del mensaje (y cada par
// de palabras pegadas, por si separan "ve ir") contra "venir" con
// distancia de edición <= 1, así se reconocen también errores que
// todavía no vimos, sin arriesgar falsos positivos con otras palabras
// de 5 letras (que difieren en 2 o más letras de "venir").
const VENIR_FUZZY_GROUPS = new Set([
  "LA BUMANGUESA BOX DELIVERY",
  "AYABACA - BUMANGUESA II",
  "BOLETAS LOCALES",
]);
const PALABRA_VENIR = "venir";

function editDistanceAcotada(a, b, maxDist) {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + costo);
      }
    }
  }
  return d[a.length][b.length];
}

function buscarVenirTypo(text, grupoActual) {
  const nombre = (grupoActual?.name || "").trim().toUpperCase();
  if (!VENIR_FUZZY_GROUPS.has(nombre)) return null;

  const palabras = text.split(/[^a-z0-9]+/).filter(Boolean);
  const candidatos = [...palabras];
  for (let i = 0; i < palabras.length - 1; i++) {
    candidatos.push(palabras[i] + palabras[i + 1]);
  }

  for (const palabra of candidatos) {
    if (palabra === PALABRA_VENIR) continue; // esa ya la agarra la keyword normal
    if (palabra.length < 3 || palabra.length > 7) continue;
    if (editDistanceAcotada(palabra, PALABRA_VENIR, 1) <= 1) {
      const index = text.indexOf(palabra);
      return { keyword: `venir (typo: "${palabra}")`, index: index < 0 ? 0 : index, length: palabra.length };
    }
  }
  return null;
}

// ---------- Comparación tolerante a letras comidas ----------
// En los grupos de "solo autorizados" el que manda los pedidos ya sabe que
// hay un bot y a veces recorta letras a propósito para que no lo detecte
// ("recojo de client" sin la e, "pendient"). Acá se compara palabra por
// palabra aceptando esos recortes.
//
// Se puede ser generoso SIN riesgo porque en esos grupos el bot ignora a
// todos menos al número autorizado (ver GRUPOS_SOLO_AUTORIZADOS): un falso
// positivo solo podría venir de esa misma persona.
function palabraSeParece(palabraMensaje, palabraFrase) {
  if (palabraMensaje === palabraFrase) return true;

  // Recortes por el final: "clie" por "cliente", "pendient" por
  // "pendiente". Se exige un mínimo de letras para no confundir palabras
  // cortas entre sí ("de" no debe valer por "delivery").
  const minPrefijo = Math.min(4, palabraFrase.length);
  if (palabraMensaje.length >= minPrefijo && palabraFrase.startsWith(palabraMensaje)) return true;
  if (palabraFrase.length >= minPrefijo && palabraMensaje.startsWith(palabraFrase)) return true;

  // Letras cambiadas o faltantes en el medio: "cliemte", "clinte".
  const tolerancia = palabraFrase.length >= 7 ? 2 : 1;
  return editDistanceAcotada(palabraMensaje, palabraFrase, tolerancia) <= tolerancia;
}

function matchPorPalabrasFlexible(text, frase) {
  const palabrasFrase = getSignificantWords(frase);
  if (palabrasFrase.length === 0) return null;
  const palabrasMensaje = text.split(/[^a-z0-9]+/).filter(Boolean);
  if (palabrasMensaje.length === 0) return null;

  const estanTodas = palabrasFrase.every((pf) => palabrasMensaje.some((pm) => palabraSeParece(pm, pf)));
  if (!estanTodas) return null;
  return { keyword: frase, index: 0, length: 0 };
}

// ---------- Detección: qué activa al bot, y por qué ----------
// Revisa en orden todas las formas en que un mensaje puede activar al bot,
// y va anotando qué se probó con qué resultado.
//
// Devuelve las dos cosas a la vez a propósito:
//   - match : lo que usa el bot para decidir si responde.
//   - pasos : lo que usa el panel ("Probar frase") para explicar por qué NO
//             respondió.
// Así la explicación no puede mentir: sale del mismo código que decide.
// Si se agrega una forma nueva de detectar, va acá y queda explicada sola.
//
// Se usa exec() (no find()) para saber en qué posición del texto aparece la
// palabra clave y poder resaltarla en el historial.
function buscarEnMatchers(text, matchers) {
  for (const m of matchers) {
    const result = m.regex.exec(text);
    if (result) return { keyword: m.keyword, index: result.index, length: result[0].length };
  }
  return null;
}

function analizarDeteccion(text, chatId, senderNumber, grupoActual, opciones = {}) {
  const { bloqueadoGlobal, esImagenTrigger, esContactoTrigger, esAudioTrigger } = opciones;
  const pasos = [];
  const anotar = (nombre, detalle) => pasos.push({ nombre, detalle });
  let match = null;

  if (bloqueadoGlobal) {
    // Número bloqueado globalmente (o grupo de solo autorizados): ya ni las
    // keywords especiales lo saltan. Solo puede responder si hay una
    // excepción activa para este número+grupo+frase.
    const motivo = esGrupoSoloAutorizados(grupoActual?.name)
      ? "Este grupo solo responde a números autorizados"
      : "Este número está en la lista de ignorados";
    match = buscarExcepcionNumero(text, chatId, senderNumber, grupoActual?.name);
    anotar("Frases autorizadas para este número", match ? `coincide "${match.keyword}"` : "ninguna coincide");
    return { match, pasos, contexto: motivo };
  }

  match = buscarKeywordEspecial(text, chatId);
  anotar("Frases especiales de este grupo", match ? `coincide "${match.keyword}"` : "ninguna coincide");

  if (!match && esImagenTrigger) match = { keyword: "(foto)", index: 0, length: 0 };
  if (!match && esContactoTrigger) match = { keyword: "(contacto)", index: 0, length: 0 };
  if (!match && esAudioTrigger) match = { keyword: "(nota de voz)", index: 0, length: 0 };

  if (!match) {
    // Las keywords globales agregadas desde el panel no se fijan en las
    // palabras excluidas (pero sí las que ya venían en keywords.js).
    match = buscarEnMatchers(text, getExtraPositiveMatchers());
    anotar("Keywords globales del panel", match ? `coincide "${match.keyword}"` : "ninguna coincide");

    if (!match) {
      const exclusion = getExcludedMatchers().find(({ regex }) => regex.test(text));
      if (exclusion) {
        anotar("Palabras excluidas", `encontré "${exclusion.keyword}", que bloquea las keywords base`);
      } else {
        anotar("Palabras excluidas", "ninguna");
        match = buscarEnMatchers(text, getBasePositiveMatchers());
        anotar("Keywords base", match ? `coincide "${match.keyword}"` : "ninguna coincide");

        if (!match) {
          match = buscarVenirTypo(text, grupoActual);
          const aplica = VENIR_FUZZY_GROUPS.has((grupoActual?.name || "").trim().toUpperCase());
          anotar(
            '"venir" mal escrito',
            !aplica ? "no aplica en este grupo" : match ? `coincide "${match.keyword}"` : "no se parece"
          );
        }
      }
    }
  }

  return { match, pasos, contexto: null };
}

// Un número que está en la lista global de excluidos puede tener frases de
// excepción para UN grupo puntual: si las escribe ahí, sí responde (pero
// sigue bloqueado en cualquier otro grupo). A diferencia de las especiales,
// esto SÍ respeta que el sector/grupo estén activos.
//
// En los grupos de solo autorizados se usa la comparación tolerante; en el
// resto se mantiene la exacta de siempre, para no aflojar el filtro en
// grupos donde escribe cualquiera.
function buscarExcepcionNumero(text, chatId, senderNumber, nombreGrupo) {
  const excepciones = numberExceptions.getExceptions(chatId, senderNumber).filter((e) => e.active);
  const flexible = esGrupoSoloAutorizados(nombreGrupo);
  for (const { phrase } of excepciones) {
    const m = flexible ? matchPorPalabrasFlexible(text, phrase) : matchPorPalabras(text, phrase);
    if (m) return m;
  }
  return null;
}

// ---------- Filtro de tiempo (0 a N minutos, configurable desde el panel) ----------
// Si el mensaje menciona una cantidad de minutos ("en 20 minutos") o una
// hora de reloj ("11:15 am"), el bot solo responde si eso cae entre 0 y N
// minutos desde ahora (hora de Perú, N configurable en Opciones). Si no
// menciona nada de tiempo, esta regla no aplica y no afecta la detección normal.

// "en 20 minutos", "en 20 min", "en 20min", "en 20 m", "en 20",
// "20 minutos", "20 min", "20min" (sin "en" pero con unidad explícita)
// Cantidades escritas con letras ("media hora", "dos horas"), que en los
// pedidos aparecen tanto como los números.
const CANTIDADES_ESCRITAS = {
  media: 0.5,
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
};

function extractRelativeMinutes(text) {
  // Las HORAS se revisan primero a propósito: si no, "en 2 horas" caía en
  // el patrón de minutos de abajo (que acepta el número suelto) y se leía
  // como 2 MINUTOS, así que el bot marcaba al toque un pedido que era para
  // dentro de 2 horas — justo al revés de lo que se quiere.
  const horas = text.match(
    /\b(?:en\s+)?(\d{1,2}|media|una?|uno|dos|tres|cuatro|cinco|seis)\s*h(?:ora)?s?\b/i
  );
  if (horas) {
    const escrito = horas[1].toLowerCase();
    const valor = CANTIDADES_ESCRITAS[escrito] ?? parseInt(escrito, 10);
    if (Number.isFinite(valor)) {
      // "una hora y media", "2 horas y media"
      const yMedia = /\by\s+media\b/i.test(text);
      return Math.round(valor * 60) + (yMedia ? 30 : 0);
    }
  }

  let m = text.match(/\ben\s*(\d{1,3})\s*(?:min(?:uto)?s?\.?|m)?\b/i);
  if (m) return parseInt(m[1], 10);
  m = text.match(/\b(\d{1,3})\s*min(?:uto)?s?\.?\b/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

// "11:15 am", "11:15am", "11:15 a.m.", "11.15", "11.15 am", "a las 11:15",
// "11h15", "11 y 15", "11:15 pm"
function extractClockTime(text) {
  const m = text.match(/\b(\d{1,2})(?:\s*:\s*|\s*\.\s*|\s*h\s*|\s+y\s+)(\d{2})(?:\s*(a\.?\s*m\.?|p\.?\s*m\.?))?\b/i);
  if (m) {
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour > 23 || minute > 59) return null;
    const meridiem = m[3] ? m[3].toLowerCase().replace(/[.\s]/g, "") : null; // "am", "pm" o null
    return { hour, minute, meridiem };
  }

  // Hora en punto con am/pm y SIN minutos: "6pm", "6 pm", "6 p.m.".
  // Antes esto no se detectaba, así que un pedido para las 6pm se marcaba
  // al toque en vez de esperar.
  const conMeridiem = text.match(/\b(\d{1,2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)\b/i);
  if (conMeridiem) {
    const hour = parseInt(conMeridiem[1], 10);
    if (hour >= 1 && hour <= 12) {
      return { hour, minute: 0, meridiem: conMeridiem[2].toLowerCase().replace(/[.\s]/g, "") };
    }
  }

  // "a las 6", "a la 1" (sin minutos ni am/pm). Se exige el "a la(s)" para
  // no confundir cualquier número suelto del mensaje con una hora.
  const aLas = text.match(/\ba\s+las?\s+(\d{1,2})\b/i);
  if (aLas) {
    const hour = parseInt(aLas[1], 10);
    if (hour <= 23) return { hour, minute: 0, meridiem: null };
  }

  return null;
}

// Hora actual en Perú (UTC-5, sin horario de verano), sin importar en qué
// zona horaria esté corriendo el servidor.
function getPeruNow() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs - 5 * 3600000);
}

// A qué hora exacta (timestamp) se refiere el mensaje, sin mirar ninguna
// ventana todavía. Tres resultados posibles:
//   - null                  -> no menciona ningún tiempo (la regla no aplica)
//   - { targetMs: null }    -> menciona una hora, pero ya pasó (sin
//                              candidato futuro válido hoy)
//   - { targetMs: <ms> }    -> el momento futuro exacto al que se refiere
function calcularObjetivoTiempo(text, now) {
  const minutosRelativos = extractRelativeMinutes(text);
  if (minutosRelativos !== null) {
    return { targetMs: now.getTime() + minutosRelativos * 60000 };
  }
  const horaMencionada = extractClockTime(text);
  if (horaMencionada) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const candidatosHora = [];
    if (horaMencionada.meridiem === "am") {
      candidatosHora.push(horaMencionada.hour % 12);
    } else if (horaMencionada.meridiem === "pm") {
      candidatosHora.push((horaMencionada.hour % 12) + 12);
    } else {
      candidatosHora.push(horaMencionada.hour % 24);
      if (horaMencionada.hour <= 11) candidatosHora.push(horaMencionada.hour + 12);
    }
    // Si no dice am/pm, hay dos candidatos posibles: se usa el que esté
    // más cerca en el futuro (el que tiene el diff positivo más chico).
    let mejorDiff = null;
    candidatosHora.forEach((h) => {
      const diff = h * 60 + horaMencionada.minute - nowMinutes;
      if (diff >= 0 && (mejorDiff === null || diff < mejorDiff)) mejorDiff = diff;
    });
    if (mejorDiff === null) return { targetMs: null };
    return { targetMs: now.getTime() + mejorDiff * 60000 };
  }
  return null;
}

// Punto de entrada del filtro de tiempo, ahora con ventana POR SECTOR y
// espera automática. Devuelve:
//   { enVentana: true,  esperaMs: null }  -> responde ya (sin mención de
//                                            tiempo, o ya cae en la ventana)
//   { enVentana: false, esperaMs: null }  -> no responde nunca (mención de
//                                            tiempo ya pasada, sin futuro)
//   { enVentana: false, esperaMs: N }     -> fuera de la ventana por ahora;
//                                            si la espera automática está
//                                            activa, se puede reintentar en
//                                            N ms (cuando entre a la ventana)
function evaluarVentanaTiempo(text, sectorId, now = getPeruNow()) {
  const objetivo = calcularObjetivoTiempo(text, now);
  if (objetivo === null) return { enVentana: true, esperaMs: null };
  if (objetivo.targetMs === null) return { enVentana: false, esperaMs: null };
  const ventanaMs = getTimeWindowMinutes(sectorId) * 60000;
  const esperaMs = objetivo.targetMs - ventanaMs - now.getTime();
  if (esperaMs <= 0) return { enVentana: true, esperaMs: null };
  return { enVentana: false, esperaMs };
}

// Versión mínima de un mensaje, suficiente para que Baileys pueda citarlo
// ({ quoted: ... }) sin depender del objeto original de WhatsApp — se usa
// para los pedidos que quedan en espera (pendingTimeMatches.js), porque ese
// objeto original puede dejar de existir (reconexión, reinicio) antes de
// que llegue el momento de marcar.
function construirQuotedStub(msg, chatId, senderJid, rawText) {
  return {
    key: {
      remoteJid: chatId,
      id: msg.key.id,
      fromMe: false,
      participant: msg.key.participant || senderJid,
    },
    message: { conversation: rawText || "" },
  };
}

// ---------- Grupos que este bot ignora por completo ----------
// GANANCIAS ahora lo maneja un proyecto aparte (finanzas/), vinculado a
// otro número de WhatsApp: este bot no debe procesar nada de ese grupo
// (ni caja chica, ni keywords, ni nada), para que no se pisen los dos.
const IGNORED_GROUP_NAMES = new Set(["GANANCIAS"]);

// ---------- Grupos donde SOLO responden los números autorizados ----------
// En el resto de grupos el bot le responde a cualquiera (menos a los
// números ignorados). En estos, al revés: ignora a TODOS por defecto y solo
// responde a quien tenga una "frase por sector" activa para ese grupo
// (panel → Palabras clave → FRASES POR SECTOR).
//
// Es lo que corresponde en un grupo de reportes con muchos repartidores:
// antes, cualquiera que escribiera "moto" activaba el bot, y había que ir
// agregando cada número a la lista de ignorados uno por uno, después de que
// ya había activado el bot al menos una vez.
const GRUPOS_SOLO_AUTORIZADOS = new Set(["REPORTES BOX DELIVERY"]);

function esGrupoSoloAutorizados(nombreGrupo) {
  return GRUPOS_SOLO_AUTORIZADOS.has(String(nombreGrupo || "").trim().toUpperCase());
}

// ---------- Cotización de delivery ----------
// La web de Punto Caliente (antes La Bumanguesa) pide acá una cotización
// cuando el cliente cae fuera de las zonas ya mapeadas: manda el link de
// ubicación citando el mensaje, y solo cuenta como precio válido una
// respuesta que CITE ese mensaje.
//
// A qué grupos se manda, quién puede responder la tarifa y el texto del
// mensaje se configuran desde el panel (ver quoteConfig.js), no acá.

// ---------- Pedidos que no llegan como texto (foto / contacto / audio) ----------
// En algunos grupos el pedido viene como una foto (nota escrita a mano,
// boleta), como una tarjeta de contacto, o como una nota de voz. El bot
// responde igual, siempre que se cumplan las demás reglas (número no
// bloqueado, sector/grupo activos, etc.) — no las salta.
//
// Qué grupos y el tope de segundos del audio se configuran desde el panel
// (ver mediaTriggers.js), ya no acá.

// True si el mensaje trae una imagen (foto), sin importar si viene
// envuelta en un mensaje efímero o "ver una vez", igual que extractText().
function tieneImagen(msg) {
  const m =
    msg.message.ephemeralMessage?.message ||
    msg.message.viewOnceMessage?.message ||
    msg.message.viewOnceMessageV2?.message ||
    msg.message;
  return Boolean(m.imageMessage);
}

// True si el mensaje trae una tarjeta de contacto compartida (una o varias),
// igual de flexible ante mensajes efímeros / "ver una vez" que tieneImagen().
// Se usa para los grupos configurados en mediaTriggers.js (editables desde
// el panel), donde el restaurante a veces manda el contacto del cliente en
// vez de escribir el pedido con palabra clave.
function tieneContacto(msg) {
  const m =
    msg.message.ephemeralMessage?.message ||
    msg.message.viewOnceMessage?.message ||
    msg.message.viewOnceMessageV2?.message ||
    msg.message;
  return Boolean(m.contactMessage || m.contactsArrayMessage);
}

// True si el mensaje es una NOTA DE VOZ (la del micrófono) lo bastante
// corta como para ser un pedido. A propósito se exige ptt (push to talk):
// un audio reenviado o una canción no son un pedido y no deben activar
// nada. Como el bot no puede escuchar el audio, la duración es el único
// filtro posible: un "mándame un motorizado" dura 2-5 segundos.
//
// Si WhatsApp no mandara la duración (no debería pasar), se toma como 0 y
// se responde igual: en un grupo configurado para esto, una nota de voz
// es casi siempre un pedido.
function esNotaDeVozCorta(msg, maxSegundos) {
  const m =
    msg.message.ephemeralMessage?.message ||
    msg.message.viewOnceMessage?.message ||
    msg.message.viewOnceMessageV2?.message ||
    msg.message;
  const audio = m.audioMessage;
  if (!audio || !audio.ptt) return false;
  const segundos = Number(audio.seconds) || 0;
  return segundos <= maxSegundos;
}

// True si el mensaje viene marcado como "reenviado" (la flechita de
// WhatsApp). Un pedido reenviado suele ser una dirección o un pedido
// copiado de otro chat, no un pedido directo — el bot no los responde.
function esMensajeReenviado(msg) {
  const m =
    msg.message.ephemeralMessage?.message ||
    msg.message.viewOnceMessage?.message ||
    msg.message.viewOnceMessageV2?.message ||
    msg.message;
  const inner = m.extendedTextMessage || m.imageMessage || m.videoMessage || m.documentMessage || {};
  const ctx = inner.contextInfo || {};
  return Boolean(ctx.isForwarded) || (ctx.forwardingScore || 0) > 0;
}

// Id del mensaje citado/remarcado por este mensaje (si responde a otro
// citándolo), o null si no cita nada. Se usa para validar cotizaciones de
// delivery: solo vale si cita justo el mensaje que mandó el bot.
function extractQuotedStanzaId(msg) {
  const m =
    msg.message.ephemeralMessage?.message ||
    msg.message.viewOnceMessage?.message ||
    msg.message.viewOnceMessageV2?.message ||
    msg.message;
  const inner = m.extendedTextMessage || m.imageMessage || m.videoMessage || m.documentMessage || {};
  return inner.contextInfo?.stanzaId || null;
}

// Saca el primer número (con decimales opcionales) de un texto, para leer
// el precio que responde el equipo de delivery (ej. "8", "8 soles", "S/8.50").
function parsePrecioCotizacion(text) {
  const m = String(text || "").match(/\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const precio = parseFloat(m[0].replace(",", "."));
  return Number.isFinite(precio) && precio > 0 ? precio : null;
}

// Le avisa a bumanguesa-web el precio cotizado para que el cliente lo vea.
async function reportarCotizacionDelivery(codigo, precio) {
  const url = process.env.BUMANGUESA_URL;
  const secret = process.env.INTEGRATION_SECRET;
  if (!url || !secret) {
    throw new Error("Falta configurar BUMANGUESA_URL o INTEGRATION_SECRET");
  }
  const res = await fetch(`${url.replace(/\/$/, "")}/api/cotizaciones/${codigo}/precio`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Integration-Secret": secret },
    body: JSON.stringify({ precio }),
  });
  if (!res.ok) throw new Error(`bumanguesa-web respondió ${res.status}`);
}

// Deja solo los dígitos y se queda con los últimos 9 (número peruano sin
// el "51" ni "+"), así "+51 934 343 343", "51934343343" y "934343343"
// se comparan como el mismo número.
function canonicalNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits;
}

// WhatsApp a veces identifica al remitente con un ID interno "@lid" (para
// privacidad en grupos grandes) en vez de su número real "@s.whatsapp.net".
// Baileys v7 manda el JID alternativo en msg.key.participantAlt: si uno de
// los dos es "@lid" y el otro no, nos quedamos con el que SÍ es un número real.
const esJidLid = (jid) => typeof jid === "string" && jid.endsWith("@lid");

function elegirJidReal(principal, alterno) {
  if (principal && !esJidLid(principal)) return principal;
  if (alterno && !esJidLid(alterno)) return alterno;
  return principal || alterno || "";
}

// Mapa persistente LID -> número real, que se aprende solo: cada vez que un
// mensaje trae los dos datos juntos (el LID y el número), se guarda la
// equivalencia. Así, si más adelante llega un mensaje SOLO con el LID, se
// puede resolver igual el número real y aplicar los bloqueos como
// corresponde (esto era lo que dejaba pasar a números excluidos).
const LID_MAP_PATH = dataPath("lid-map.json");
let lidMap = {};
try {
  lidMap = JSON.parse(fs.readFileSync(LID_MAP_PATH, "utf8"));
} catch (err) {
  lidMap = {};
}

// Guardar el mapa entero en disco es CARO, y antes se hacía una vez por
// cada equivalencia nueva. Con ~7.000 participantes repartidos en ~360
// grupos, refreshGroups() aprende miles de golpe: eso eran miles de
// escrituras sincrónicas seguidas, cada una del archivo COMPLETO (y cada
// vez más grande). Como writeFileSync bloquea el proceso entero, durante
// todo ese rato el bot no procesaba ningún mensaje ni respondía el panel
// — era la causa de que "se lageara" o pareciera colgado al conectar.
//
// Ahora solo se marca que hay cambios pendientes y se escribe UNA sola
// vez, poco después de la última equivalencia nueva.
let lidMapPendiente = false;
let lidMapTimer = null;

function guardarLidMap() {
  lidMapTimer = null;
  if (!lidMapPendiente) return;
  lidMapPendiente = false;
  try {
    // Sin indentación: este archivo solo lo lee el bot, y así ocupa ~3
    // veces menos (menos bytes que escribir y que leer al arrancar).
    fs.writeFileSync(LID_MAP_PATH, JSON.stringify(lidMap));
  } catch (err) {
    console.error("No se pudo guardar lid-map.json:", err.message);
  }
}

function recordLidMapping(lidJid, pnJid) {
  const lid = String(lidJid || "").replace(/@.*/, "");
  const pn = canonicalNumber(String(pnJid || "").replace(/@.*/, ""));
  if (!lid || !pn || lidMap[lid] === pn) return;
  lidMap[lid] = pn;
  lidMapPendiente = true;
  if (!lidMapTimer) lidMapTimer = setTimeout(guardarLidMap, 2000);
}

// Resuelve el número real del remitente. Prioridad: JID con número real
// (directo o por participantAlt) > mapa aprendido > mapa interno de Baileys
// v7 > últimos dígitos del LID (último recurso, como antes).
async function resolverSenderNumber(sock, msgKey) {
  const participante = msgKey.participant || "";
  const alterno = msgKey.participantAlt || "";
  if (esJidLid(participante) && alterno && !esJidLid(alterno)) {
    recordLidMapping(participante, alterno);
  }

  const senderJid = elegirJidReal(participante, alterno) || msgKey.remoteJid || "";
  if (!esJidLid(senderJid)) {
    return { senderJid, senderNumber: canonicalNumber(senderJid.replace(/@.*/, "")) };
  }

  const lidDigits = senderJid.replace(/@.*/, "");
  let numeroReal = lidMap[lidDigits] || null;

  if (!numeroReal) {
    // Baileys v7 mantiene su propio mapa LID->número; se consulta de forma
    // defensiva por si el método cambia de nombre entre versiones.
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(senderJid);
      if (pn) {
        numeroReal = canonicalNumber(String(pn).replace(/@.*/, ""));
        recordLidMapping(senderJid, pn);
      }
    } catch (err) {
      // sin mapeo disponible: se sigue con los dígitos del LID
    }
  }

  return { senderJid, senderNumber: numeroReal || canonicalNumber(lidDigits) };
}

// Estado compartido con el dashboard (server.js lo lee)
const botState = {
  connected: false,
  qr: null,
  lastActivity: null,
  history: [],
  groups: [],
  active: false, // arranca inactivo: hay que activarlo manualmente desde el panel tras vincular
  recentSenders: [], // diagnóstico temporal: últimos remitentes vistos por grupo
};

function logSender(chatId, groupName, senderJid, senderNumber, blocked, text) {
  botState.recentSenders.unshift({
    chatId,
    groupName,
    senderJid,
    senderNumber,
    blocked,
    text: String(text || "").slice(0, 120),
    time: new Date().toISOString(),
  });
  if (botState.recentSenders.length > 50) botState.recentSenders.length = 50;
}

let currentSock = null;

// Evita procesar el mismo mensaje dos veces (ej. si Baileys lo reentrega
// al reconectar). Se guarda un set acotado de los últimos IDs vistos;
// sobrevive a reconexiones porque es una variable del módulo, no del socket.
const mensajesProcesados = new Set();
const MAX_MENSAJES_PROCESADOS = 500;
function yaFueProcesado(id) {
  if (!id) return false;
  if (mensajesProcesados.has(id)) return true;
  mensajesProcesados.add(id);
  if (mensajesProcesados.size > MAX_MENSAJES_PROCESADOS) {
    mensajesProcesados.delete(mensajesProcesados.values().next().value);
  }
  return false;
}

// Descarta mensajes viejos que Baileys reentrega al reconectar (historial),
// sin depender del "type" del evento: los mensajes que escribe el propio
// dueño desde su teléfono NO siempre llegan como "notify", así que
// filtrar por type dejaba fuera justo los de la caja chica.
// messageTimestamp puede venir como número o como Long ({low, high}).
// Devuelve los milisegundos en que se escribió el mensaje, o null si no
// se pudo saber.
function fechaDelMensajeMs(msg) {
  const raw = msg?.messageTimestamp;
  if (raw === undefined || raw === null) return null;
  const segundos =
    typeof raw === "number" ? raw : typeof raw.toNumber === "function" ? raw.toNumber() : Number(raw.low ?? raw);
  if (!Number.isFinite(segundos) || segundos <= 0) return null;
  return segundos * 1000;
}

function esMensajeViejo(msg) {
  const escritoMs = fechaDelMensajeMs(msg);
  if (escritoMs === null) return false; // sin fecha: se procesa igual
  return Date.now() - escritoMs > getAntiguedadMaximaMin() * 60000;
}

// ---------- Corte por momento de activación ----------
// Momento en que se prendió el bot por última vez. Si el bot estaba
// apagado es porque ese pedido ya lo estaba atendiendo alguien; al
// reactivarlo se quiere ganar lo que el restaurante mande DE AHÍ EN
// ADELANTE, no lo que quedó escrito antes.
//
// Hace falta además de esMensajeViejo() porque WhatsApp a veces retiene
// mensajes y los entrega juntos al reconectar: un mensaje escrito con el
// bot apagado podía llegar segundos después de activarlo y marcarse.
let activadoEnMs = 0;

function setBotActivo(valor) {
  const nuevo = Boolean(valor);
  if (nuevo && !botState.active) activadoEnMs = Date.now();
  botState.active = nuevo;
  return botState.active;
}

function esAnteriorALaActivacion(msg) {
  if (!activadoEnMs) return false;
  const escritoMs = fechaDelMensajeMs(msg);
  if (escritoMs === null) return false; // sin fecha: no se puede descartar
  // El timestamp viene truncado a segundos, así que se compara contra el
  // segundo en que se activó (si no, un mensaje escrito en el mismo
  // segundo que el clic quedaría afuera por milisegundos).
  return escritoMs < Math.floor(activadoEnMs / 1000) * 1000;
}

// Manda un mensaje y deja anotado su ID como "ya procesado", para que
// cuando WhatsApp lo devuelva por messages.upsert el bot no lo lea como
// si fuera un mensaje entrante (defensa extra además del filtro por
// "fromMe" de más abajo).
async function enviarMensaje(sock, chatId, contenido, opciones) {
  const enviado = await sock.sendMessage(chatId, contenido, opciones);
  const idEnviado = enviado?.key?.id;
  if (idEnviado) yaFueProcesado(idEnviado);
  return enviado;
}

// Igual que enviarMensaje, pero con foto (usada por los mensajes
// programados). "caption" es opcional: una foto sola sin texto es válida.
async function enviarImagen(sock, chatId, buffer, caption) {
  const contenido = { image: buffer };
  if (caption) contenido.caption = caption;
  const enviado = await sock.sendMessage(chatId, contenido);
  const idEnviado = enviado?.key?.id;
  if (idEnviado) yaFueProcesado(idEnviado);
  return enviado;
}

// Espera creciente para reintentar si falla la carga de grupos (ej. un
// "rate-overlimit" temporal de WhatsApp por reconectar varias veces
// seguidas): 30s, 1min, 2min. Si para entonces sigue fallando, se deja
// así hasta que se cumpla el "enfriamiento" de abajo.
const REINTENTO_GRUPOS_MS = [30000, 60000, 120000];

// refreshGroups() no se llama solo al conectar: WhatsApp también dispara
// "groups.upsert"/"groups.update" mientras la conexión está inestable, y
// cada uno arrancaba SU PROPIA cascada de reintentos sin esperar a que
// terminara la anterior — varias cascadas solapadas terminaban insistiendo
// mucho más de lo previsto contra un límite de WhatsApp que ya estaba
// activo, probablemente empeorándolo. Estas dos variables evitan eso: no
// se arranca una cascada nueva si ya hay una en curso, ni tampoco recién
// fracasó una (se espera el enfriamiento antes de volver a intentar).
let refreshEnCurso = false;
let ultimoFalloTs = 0;
const ENFRIAMIENTO_TRAS_FALLO_MS = 5 * 60 * 1000; // 5 minutos

async function refreshGroups(sock, intento = 0) {
  if (intento === 0) {
    if (refreshEnCurso) return;
    if (Date.now() - ultimoFalloTs < ENFRIAMIENTO_TRAS_FALLO_MS) return;
    refreshEnCurso = true;
  }

  try {
    const groupsMap = await sock.groupFetchAllParticipating();
    botState.groups = Object.values(groupsMap)
      .map((g) => ({
        id: g.id,
        name: g.subject || "(sin nombre)",
        participants: g.participants?.length || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Si Baileys v7 trae el número real junto al LID de cada participante,
    // se aprenden todas las equivalencias de una vez (sin esperar a que
    // cada persona escriba un mensaje).
    Object.values(groupsMap).forEach((g) => {
      (g.participants || []).forEach((p) => {
        const id = p.id || "";
        const alterno = p.phoneNumber || p.jid || "";
        if (esJidLid(id) && alterno && !esJidLid(alterno)) recordLidMapping(id, alterno);
        if (!esJidLid(id) && p.lid) recordLidMapping(p.lid, id);
      });
    });

    applyGroupSeed();
    refreshEnCurso = false;
  } catch (err) {
    console.error("No se pudo obtener la lista de grupos:", err.message);
    if (intento < REINTENTO_GRUPOS_MS.length) {
      const esperaMs = REINTENTO_GRUPOS_MS[intento];
      setTimeout(() => {
        // Si mientras tanto hubo una reconexión real, ese "sock" ya quedó
        // viejo: el reintento de la reconexión nueva se encarga solo.
        if (sock === currentSock) refreshGroups(sock, intento + 1);
      }, esperaMs);
    } else {
      refreshEnCurso = false;
      ultimoFalloTs = Date.now();
    }
  }
}

// La primera vez que aparece un grupo con un nombre conocido de groupSeed.js,
// le aplica su sector y sus keywords especiales automáticamente. Si ya se
// configuró antes (a mano o por un seed anterior), no lo vuelve a tocar.
function applyGroupSeed() {
  botState.groups.forEach((g) => {
    const sectorId = sectorSeedByName[g.name];
    if (sectorId && !hasGroupSector(g.id)) {
      setGroupSector(g.id, sectorId);
    }

    const frases = specialSeedByName[g.name];
    if (frases && !dynamicKeywords.hasSpecialForGroup(g.id)) {
      frases.forEach((frase) => dynamicKeywords.addSpecialForGroup(g.id, frase));
    }

    const excepcionesPorNumero = numberExceptionSeed[g.name];
    if (excepcionesPorNumero) {
      Object.entries(excepcionesPorNumero).forEach(([numero, frasesExcepcion]) => {
        if (!numberExceptions.hasExceptions(g.id, numero)) {
          // Cada frase puede venir como texto simple (arranca activa) o
          // como { phrase, active } si debe arrancar apagada.
          frasesExcepcion.forEach((item) => {
            const frase = typeof item === "string" ? item : item.phrase;
            const activa = typeof item === "string" ? true : item.active !== false;
            numberExceptions.addException(g.id, numero, frase);
            if (!activa) numberExceptions.setExceptionActive(g.id, numero, frase, false);
          });
        }
      });
    }
  });
}

// Cierra sesión de WhatsApp y borra las credenciales guardadas,
// para que el bot vuelva a mostrar un QR nuevo listo para vincular.
async function logoutBot() {
  if (!currentSock) return;
  try {
    await currentSock.logout();
  } catch (err) {
    console.error("Error al cerrar sesión:", err.message);
  }
}

// Antes se reconectaba AL INSTANTE y sin límite. Cuando WhatsApp está
// rechazando la conexión (rate limit tras varios intentos seguidos), eso
// se volvía un bucle: cerrar → reconectar → cerrar → reconectar... Cada
// intento empeoraba el bloqueo y lo alargaba, por eso se veían decenas de
// "Conexión cerrada. Reconectando..." seguidas y a veces tardaba horas en
// volver. Ahora cada reintento seguido espera más, y el contador se
// reinicia apenas la conexión vuelve a abrir.
const ESPERA_RECONEXION_MS = [1000, 2000, 5000, 15000, 30000, 60000];
let intentosReconexion = 0;
let reconexionProgramada = false;

function programarReconexion(motivo) {
  if (reconexionProgramada) return; // ya hay una en camino: no encimar otra
  reconexionProgramada = true;
  const espera = ESPERA_RECONEXION_MS[Math.min(intentosReconexion, ESPERA_RECONEXION_MS.length - 1)];
  intentosReconexion++;
  console.log(`${motivo} Reintentando en ${Math.round(espera / 1000)}s...`);
  setTimeout(() => {
    reconexionProgramada = false;
    startBot().catch((err) => console.error("Error al reconectar:", err.message));
  }, espera);
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
  });

  currentSock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    // Un socket viejo sigue emitiendo eventos un rato después de que ya se
    // creó el nuevo. Si no se ignoran, el "close" del viejo dispara OTRA
    // reconexión en paralelo: terminan dos sockets vivos peleándose la
    // misma sesión, y WhatsApp corta los dos.
    if (sock !== currentSock) return;

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      botState.qr = qr;
      console.log("\nEscanea este código QR con WhatsApp (Dispositivos vinculados):\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      botState.connected = false;
      botState.groups = [];
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        programarReconexion("Conexión cerrada.");
      } else {
        console.log("Sesión cerrada. Generando un nuevo QR para vincular...");
        fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        intentosReconexion = 0; // el usuario está esperando el QR: sin castigo de espera
        programarReconexion("Sesión cerrada.");
      }
    } else if (connection === "open") {
      botState.connected = true;
      botState.qr = null;
      intentosReconexion = 0; // conectó bien: la próxima caída vuelve a empezar desde 1s
      console.log("Bot conectado a WhatsApp correctamente.");
      refreshGroups(sock);
    }
  });

  // Mantiene la lista de grupos al día si se crean, editan o el bot se une/sale de uno
  sock.ev.on("groups.upsert", () => refreshGroups(sock));
  sock.ev.on("groups.update", () => refreshGroups(sock));

  // Detección de palabra clave y respuesta citando el mensaje original.
  // WhatsApp a veces entrega varios mensajes juntos en un mismo evento
  // (por ejemplo si se mandan seguidos), así que hay que revisarlos todos,
  // no solo el primero.
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (!msg?.message) continue;
      // Dos protecciones contra responder dos veces lo mismo tras una
      // reconexión: no procesar un ID ya visto, y descartar lo que sea
      // historial viejo. NO se filtra por "type" porque los mensajes que
      // escribe el propio dueño (los de la caja chica) no siempre llegan
      // como "notify".
      if (yaFueProcesado(msg.key.id)) continue;
      if (esMensajeViejo(msg)) continue;

      const chatId = msg.key.remoteJid;
      const grupoActual = botState.groups.find((g) => g.id === chatId);
      const rawText = extractText(msg).trim();

      // Grupos que este bot no debe tocar en absoluto (ver
      // IGNORED_GROUP_NAMES): ni caja chica, ni keywords, ni nada.
      if (grupoActual && IGNORED_GROUP_NAMES.has(grupoActual.name.trim().toUpperCase())) continue;

      // Cotización de delivery: corre igual antes del "fromMe continue" de
      // más abajo, porque uno de los dos números autorizados (en "CARTAS
      // RESTAURANTES") es justo el que tiene vinculado el bot (los mensajes
      // que él manda llegan como fromMe). Si no cita un mensaje de
      // cotización pendiente, no hace nada acá y el mensaje sigue su camino
      // normal (pedidos del grupo).
      if (grupoActual && quoteConfig.isQuoteGroup(grupoActual.name)) {
        const stanzaId = extractQuotedStanzaId(msg);
        const pendiente = stanzaId ? pendingQuotes.get(stanzaId) : null;
        if (pendiente) {
          const autorizado = msg.key.fromMe
            ? true
            : quoteConfig.canQuote((await resolverSenderNumber(sock, msg.key)).senderNumber);
          if (autorizado) {
            const precio = parsePrecioCotizacion(rawText);
            if (precio != null) {
              pendingQuotes.remove(stanzaId);
              reportarCotizacionDelivery(pendiente.codigo, precio)
                .then(() =>
                  sock
                    .sendMessage(chatId, { text: `✅ Cotización registrada: S/ ${precio}` }, { quoted: msg })
                    .catch(() => {})
                )
                .catch((err) => console.error("Error al reportar cotización de delivery:", err.message));
              continue;
            }
          }
        }
      }

      // Fuera de la caja chica, los mensajes propios se ignoran como
      // siempre: el bot jamás debe responderse a sí mismo.
      if (msg.key.fromMe) continue;

      // El registro de remitentes corre SIEMPRE (aunque el bot esté
      // inactivo), para poder observar desde el panel quién escribe y si
      // quedó bloqueado — sin que el bot responda. Solo se registran
      // mensajes de grupos (no estados ni chats privados).
      const { senderJid, senderNumber } = await resolverSenderNumber(sock, msg.key);
      // En un grupo de "solo autorizados" se trata a todos como bloqueados:
      // así solo pasan los que tengan una frase por sector activa, que es
      // exactamente el mismo permiso que ya usaban los números ignorados.
      const bloqueadoGlobal =
        excludedNumbers.isExcluded(senderNumber) || esGrupoSoloAutorizados(grupoActual?.name);
      if (chatId.endsWith("@g.us")) {
        logSender(chatId, grupoActual?.name || chatId, senderJid, senderNumber, bloqueadoGlobal, extractText(msg));
      }

      if (!botState.active) continue;
      // Escrito antes de que prendieras el bot: no se marca (ver
      // esAnteriorALaActivacion).
      if (esAnteriorALaActivacion(msg)) continue;

      const text = normalizeText(rawText);
      const esImagenTrigger = mediaTriggers.isEnabled("imagen", grupoActual?.name) && tieneImagen(msg);
      const esContactoTrigger = mediaTriggers.isEnabled("contacto", grupoActual?.name) && tieneContacto(msg);
      const esAudioTrigger =
        mediaTriggers.isEnabled("audio", grupoActual?.name) &&
        esNotaDeVozCorta(msg, mediaTriggers.getAudioMaxSegundos());
      if (!text && !esImagenTrigger && !esContactoTrigger && !esAudioTrigger) continue;

      // Los mensajes reenviados no cuentan nunca (ni para keywords, ni
      // especiales, ni excepciones): suelen ser direcciones o pedidos
      // copiados de otro chat, no un pedido directo.
      if (esMensajeReenviado(msg)) continue;

      const { match } = analizarDeteccion(text, chatId, senderNumber, grupoActual, {
        bloqueadoGlobal,
        esImagenTrigger,
        esContactoTrigger,
        esAudioTrigger,
      });

      if (!match) continue;

      // Si el mensaje menciona una hora o una cantidad de minutos fuera de
      // la ventana del sector, no responde todavía. Si la espera automática
      // está activa (panel principal), el pedido queda guardado para
      // marcarse solo cuando el tiempo restante entre en la ventana — sin
      // que el local tenga que volver a escribir.
      const sectorIdParaVentana = getGroupSector(chatId);
      const ventana = evaluarVentanaTiempo(text, sectorIdParaVentana);
      if (!ventana.enVentana) {
        if (ventana.esperaMs !== null && getEsperaAutomaticaActiva()) {
          pendingTimeMatches.add({
            chatId,
            groupName: grupoActual?.name || chatId,
            senderNumber,
            rawText,
            keyword: match.keyword,
            matchIndex: match.index,
            matchLength: match.length,
            quotedStub: construirQuotedStub(msg, chatId, senderJid, rawText),
            targetFireMs: Date.now() + ventana.esperaMs,
          });
        }
        continue;
      }

      const sectorId = sectorIdParaVentana;
      const focusedGroups = getFocusedGroups();
      const enModoEnfoque = focusedGroups.length > 0;
      const sinRemarcar = isGroupSinRemarcarEfectivo(chatId, sectorId);

      // El modo enfoque es un filtro ADICIONAL, no un reemplazo: si el
      // grupo no está enfocado, no responde. Pero igual necesita cumplir
      // lo de siempre (sector activo, grupo activo) tanto con enfoque como
      // sin él. Cada sector tiene DOS interruptores independientes: uno
      // para sus grupos que remarcan normal y otro para los que están sin
      // remarcar — acá se usa el que corresponda.
      if (enModoEnfoque && !focusedGroups.includes(chatId)) continue;
      if (!isGroupSectorActiveEfectivo(chatId, sectorId)) continue;
      if (!isGroupActive(chatId)) continue;

      const marcado = await marcarPedido(sock, {
        chatId,
        groupName: grupoActual?.name || chatId,
        senderNumber,
        rawText,
        keyword: match.keyword,
        matchIndex: match.index,
        matchLength: match.length,
        sinRemarcar,
        quotedMsg: msg,
      });
      if (marcado) break;
    }
  });

  return sock;
}

// Manda el "Voy" (citando el mensaje original salvo que el grupo sea "sin
// remarcar"), lo registra en el historial, avisa por notificación push, y
// apaga el bot — el mismo flujo sin importar si el pedido se marcó al
// toque o quedó en espera y se está marcando ahora. Devuelve true si se
// mandó con éxito.
async function marcarPedido(
  sock,
  { chatId, groupName, senderNumber, rawText, keyword, matchIndex, matchLength, sinRemarcar, quotedMsg }
) {
  const entry = {
    chatId,
    groupName,
    senderNumber,
    text: rawText || "📷 (foto sin texto)",
    matchIndex,
    matchLength,
    keyword,
    response: defaultResponse,
    time: new Date().toISOString(),
    sent: false,
  };
  botState.lastActivity = entry;

  // Pequeña espera antes de responder, para que se sienta más natural.
  // Si el grupo tiene un delay personalizado (panel > Delays por grupo),
  // ese gana; si no, se usa el global de siempre.
  const delayMs = groupDelays.getDelay(groupName) ?? getResponseDelay();
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  try {
    await enviarMensaje(
      sock,
      chatId,
      { text: defaultResponse },
      sinRemarcar || !quotedMsg ? {} : { quoted: quotedMsg }
    );
    entry.sent = true;
    botState.history.unshift(entry);
    if (botState.history.length > MAX_HISTORY) botState.history.length = MAX_HISTORY;

    // Avisa por notificación push (si hay algún dispositivo suscrito)
    // que el bot acaba de responder, sin bloquear el resto del flujo.
    pushSubscriptions
      .notifyAll({
        title: "🤖 El bot respondió",
        body: `${entry.groupName}: "${keyword}"`,
      })
      .catch((err) => console.error("Error al mandar notificación push:", err.message));

    // El bot se apaga solo después de responder: hay que reactivarlo a mano.
    setBotActivo(false);
    return true;
  } catch (err) {
    console.error("Error al enviar la respuesta:", err.message);
    entry.error = err.message;
    return false;
  }
}

// Revisa cada 30s los pedidos que quedaron en espera por la ventana de
// tiempo (ver evaluarVentanaTiempo) y marca los que ya llegaron a su hora.
// Respeta el botón general: si el bot está en pausa, no marca nada — igual
// que un pedido normal, que tampoco se marcaría con el bot apagado.
async function checkPendingTimeMatches() {
  if (!currentSock || !botState.connected || !botState.active) return;

  const due = pendingTimeMatches.getDue(Date.now());
  for (const p of due) {
    // Se saca de la cola ANTES de marcar (igual que los mensajes
    // programados): si falla el envío, no se reintenta solo para no
    // duplicar si el problema era transitorio.
    pendingTimeMatches.remove(p.id);

    const sectorId = getGroupSector(p.chatId);
    const focusedGroups = getFocusedGroups();
    const enModoEnfoque = focusedGroups.length > 0;
    // Se revisan de nuevo las condiciones operativas (pudieron cambiar en
    // los minutos de espera): grupo/sector activos, modo enfoque. El
    // número bloqueado y la palabra clave NO se vuelven a revisar, porque
    // ya se decidieron con el mensaje original.
    if (enModoEnfoque && !focusedGroups.includes(p.chatId)) continue;
    if (!isGroupSectorActiveEfectivo(p.chatId, sectorId)) continue;
    if (!isGroupActive(p.chatId)) continue;

    const sinRemarcar = isGroupSinRemarcarEfectivo(p.chatId, sectorId);
    const marcado = await marcarPedido(currentSock, {
      chatId: p.chatId,
      groupName: p.groupName,
      senderNumber: p.senderNumber,
      rawText: p.rawText,
      keyword: p.keyword,
      matchIndex: p.matchIndex,
      matchLength: p.matchLength,
      sinRemarcar,
      quotedMsg: p.quotedStub,
    });
    // Igual que el flujo normal: un pedido marcado apaga el bot, así que
    // el resto de la cola espera al próximo tick (si se reactiva antes).
    if (marcado) break;
  }
}

setInterval(() => {
  checkPendingTimeMatches().catch((err) => console.error("Error en checkPendingTimeMatches:", err.message));
}, 30000);

function extractText(msg) {
  // Si el chat tiene mensajes que desaparecen (o es "ver una vez"), el texto
  // real viene envuelto adentro y no directo en msg.message.
  const m =
    msg.message.ephemeralMessage?.message ||
    msg.message.viewOnceMessage?.message ||
    msg.message.viewOnceMessageV2?.message ||
    msg.message;

  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    ""
  );
}

// El servidor (server.js) necesita mandar mensajes desde afuera del
// listener (ej. para pedir una cotización de delivery), así que se expone
// una función que siempre devuelve el socket actual (no un valor fijo,
// porque currentSock cambia cuando el bot reconecta).
function getSock() {
  return currentSock;
}

// ---------- Mensajes programados (texto + foto opcional, a horas fijas) ----------
// Revisa cada 30s si la hora Perú actual (HH:MM) coincide con algún
// horario configurado en un mensaje activo, y si ese horario ya se mandó
// hoy. Igual que checkCashboxSchedule en finanzas/bot.js, pero para varios
// horarios por mensaje en vez de uno solo fijo.
// Cuánto tiempo después de su hora se puede "recuperar" un mensaje que no
// llegó a salir (corte de internet, bot reconectando, Railway
// redesplegando). Pasado ese rato se deja pasar hasta el día siguiente.
const VENTANA_RECUPERACION_MIN = 120;

async function checkScheduledBroadcasts() {
  // OJO: a propósito acá NO se mira botState.active. Ese botón controla
  // las respuestas por palabra clave y se apaga solo después de cada
  // respuesta, así que atarle los mensajes programados hacía que casi
  // nunca salieran. Cada mensaje ya tiene su propio interruptor
  // (b.activo) en el panel, que es el que manda.
  if (!currentSock || !botState.connected) return;

  const now = getPeruNow();
  const horarioActual = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const hoyLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const pendientes = scheduledBroadcasts.getPendientes(horarioActual, hoyLabel, VENTANA_RECUPERACION_MIN);
  for (const { broadcast: b, horario } of pendientes) {
    // Se marca como enviado ANTES de mandar (no después): si un solo grupo
    // falla, no queremos reintentar el resto en el próximo tick y duplicar
    // en los grupos que sí llegaron.
    scheduledBroadcasts.registrarEnvio(b.id, horario, hoyLabel);

    const imagenPath = scheduledBroadcasts.getImagenPath(b.id);
    const buffer = imagenPath && fs.existsSync(imagenPath) ? fs.readFileSync(imagenPath) : null;

    for (const groupId of b.groupIds) {
      try {
        if (buffer) {
          await enviarImagen(currentSock, groupId, buffer, b.texto);
        } else if (b.texto) {
          await enviarMensaje(currentSock, groupId, { text: b.texto });
        }
      } catch (err) {
        console.error(`Error al mandar el mensaje programado "${b.nombre}" al grupo ${groupId}:`, err.message);
      }
    }
  }
}

setInterval(() => {
  checkScheduledBroadcasts().catch((err) => console.error("Error en checkScheduledBroadcasts:", err.message));
}, 30000);

// ---------- "Probar frase" del panel ----------
// Simula qué haría el bot con una frase escrita a mano en un grupo, para
// poder ver POR QUÉ no respondió y decidir si hace falta agregarle una
// frase especial a ese restaurante.
//
// A propósito separa dos cosas:
//   - detecta      : si la frase activa al bot (lo que se está probando).
//   - advertencias : si además hay algo apagado (sector, grupo, el bot).
// Si se mezclaran, como el bot se apaga solo tras cada respuesta, toda
// prueba diría "el bot está apagado" y nunca se llegaría a lo de la frase.
function probarFrase(textoCrudo, chatId) {
  const grupoActual = botState.groups.find((g) => g.id === chatId);
  if (!grupoActual) throw new Error("No encuentro ese grupo. ¿El bot sigue adentro?");

  const rawText = String(textoCrudo || "").trim();
  if (!rawText) throw new Error("Escribe la frase que quieres probar.");
  const text = normalizeText(rawText);

  const nombreGrupo = grupoActual.name;
  const ignorado = IGNORED_GROUP_NAMES.has(nombreGrupo.trim().toUpperCase());
  // Se prueba como si llegara de un número normal (el caso de cualquier
  // restaurante); lo que sí se respeta es si el grupo es de solo autorizados.
  const bloqueadoGlobal = esGrupoSoloAutorizados(nombreGrupo);

  const { match, pasos, contexto } = ignorado
    ? { match: null, pasos: [], contexto: "El bot ignora este grupo por completo" }
    : analizarDeteccion(text, chatId, "", grupoActual, { bloqueadoGlobal });

  const sectorId = getGroupSector(chatId);
  const sinRemarcar = isGroupSinRemarcarEfectivo(chatId, sectorId);
  const focusedGroups = getFocusedGroups();

  const advertencias = [];
  if (!botState.active) advertencias.push("El bot está apagado ahora mismo (se prende desde la tarjeta principal).");
  if (focusedGroups.length > 0 && !focusedGroups.includes(chatId)) {
    advertencias.push("El modo enfoque está activo y este grupo no está enfocado.");
  }
  if (!isGroupSectorActiveEfectivo(chatId, sectorId)) advertencias.push("El sector de este grupo está apagado.");
  if (!isGroupActive(chatId)) advertencias.push("Este grupo está marcado como inactivo.");

  // La ventana de tiempo solo cuenta si la frase menciona una hora.
  const ventana = evaluarVentanaTiempo(text, sectorId);
  if (match && !ventana.enVentana) {
    if (ventana.esperaMs === null) {
      advertencias.push("La hora que menciona ya pasó, así que no se marcaría.");
    } else {
      const min = Math.round(ventana.esperaMs / 60000);
      advertencias.push(
        `La hora que menciona está fuera de la ventana del sector: quedaría en espera ${min} min` +
          (getEsperaAutomaticaActiva() ? "." : ", pero la espera automática está apagada, así que no se marcaría.")
      );
    }
  }

  return {
    grupo: nombreGrupo,
    detecta: Boolean(match),
    keyword: match?.keyword || null,
    pasos,
    contexto,
    advertencias,
    sinRemarcar,
    respuesta: defaultResponse,
  };
}

module.exports = { startBot, botState, logoutBot, getSock, setBotActivo, probarFrase };
