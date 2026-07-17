const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const P = require("pino");
const qrcode = require("qrcode-terminal");
const path = require("path");
const fs = require("fs");
const { positiveKeywords, excludedKeywords, defaultResponse } = require("./keywords");
const { excludedNumbers } = require("./excludedNumbers");
const dynamicKeywords = require("./dynamicKeywords");
const numberExceptions = require("./numberExceptions");
const cashbox = require("./cashbox");
const { sectorSeedByName, specialSeedByName, numberExceptionSeed } = require("./groupSeed");
const {
  getGroupSector,
  isSectorActive,
  isGroupActive,
  esSectorSinRemarcar,
  getFocusedGroups,
  getResponseDelay,
  hasGroupSector,
  setGroupSector,
  getTimeWindowMinutes,
} = require("./sectors");

const MAX_HISTORY = 100;

const SESSION_PATH = path.join(__dirname, "session");

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

// Las keywords especiales de un grupo ganan siempre, sin importar exclusiones
// ni si el sector/grupo está apagado.
function buscarKeywordEspecial(text, chatId) {
  for (const frase of dynamicKeywords.getSpecialForGroup(chatId)) {
    const m = matchPorPalabras(text, frase);
    if (m) return m;
  }
  return null;
}

// Un número que está en la lista global de excluidos puede tener frases de
// excepción para UN grupo puntual: si las escribe ahí, sí responde (pero
// sigue bloqueado en cualquier otro grupo). A diferencia de las especiales,
// esto SÍ respeta que el sector/grupo estén activos.
function buscarExcepcionNumero(text, chatId, senderNumber) {
  const excepciones = numberExceptions.getExceptions(chatId, senderNumber).filter((e) => e.active);
  for (const { phrase } of excepciones) {
    const m = matchPorPalabras(text, phrase);
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
function extractRelativeMinutes(text) {
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
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour > 23 || minute > 59) return null;
  const meridiem = m[3] ? m[3].toLowerCase().replace(/[.\s]/g, "") : null; // "am", "pm" o null
  return { hour, minute, meridiem };
}

// Hora actual en Perú (UTC-5, sin horario de verano), sin importar en qué
// zona horaria esté corriendo el servidor.
function getPeruNow() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs - 5 * 3600000);
}

// True si ALGUNA interpretación de la hora mencionada (am/pm, o ambas si no
// se especifica) cae dentro de la ventana configurada, en el FUTURO respecto a ahora.
function horaEstaEnRango(hour, minute, meridiem, now) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const candidatosHora = [];
  if (meridiem === "am") {
    candidatosHora.push(hour % 12);
  } else if (meridiem === "pm") {
    candidatosHora.push((hour % 12) + 12);
  } else {
    candidatosHora.push(hour % 24);
    if (hour <= 11) candidatosHora.push(hour + 12);
  }
  const maxMinutos = getTimeWindowMinutes();
  return candidatosHora.some((h) => {
    const diff = h * 60 + minute - nowMinutes;
    return diff >= 0 && diff <= maxMinutos;
  });
}

// Punto de entrada: true si el mensaje NO tiene ninguna mención de tiempo
// (la regla no aplica), o si la que tiene cae dentro del rango permitido.
function tiempoEnRango(text) {
  const minutosRelativos = extractRelativeMinutes(text);
  if (minutosRelativos !== null) {
    return minutosRelativos >= 0 && minutosRelativos <= getTimeWindowMinutes();
  }
  const horaMencionada = extractClockTime(text);
  if (horaMencionada) {
    return horaEstaEnRango(horaMencionada.hour, horaMencionada.minute, horaMencionada.meridiem, getPeruNow());
  }
  return true;
}

// ---------- Caja chica (grupo "GANANCIAS") ----------
// Funciona siempre, sin importar si el botón principal del bot está
// activo o no. Un mensaje que empieza con un número es una ganancia;
// uno que empieza con "menos" + número es un gasto. El resto del texto
// queda como descripción. "mil" multiplica x1000 (ej: "5 mil" = 5000).
const CASHBOX_GROUP_NAME = "GANANCIAS";

function parseCashboxEntry(rawText) {
  const text = rawText.trim();
  if (!text) return null;

  let m = text.match(/^menos\s+(\d+(?:\.\d+)?)\s*(mil)?\s*(.*)$/i);
  if (m) {
    const monto = parseFloat(m[1]) * (m[2] ? 1000 : 1);
    return { type: "gasto", monto, descripcion: m[3].trim() };
  }

  m = text.match(/^(\d+(?:\.\d+)?)\s*(mil)?\s*(.*)$/i);
  if (m) {
    const monto = parseFloat(m[1]) * (m[2] ? 1000 : 1);
    return { type: "ganancia", monto, descripcion: m[3].trim() };
  }

  return null;
}

function formatSoles(n) {
  return "S/ " + n.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

async function handleCashboxEntry(sock, chatId, msg, entry) {
  if (entry.type === "gasto") {
    cashbox.addGasto(entry.monto);
  } else {
    cashbox.addGanancia(entry.monto);
  }
  const hoy = cashbox.getToday();
  const emoji = entry.type === "gasto" ? "📉 Gasto registrado" : "✅ Ganancia registrada";
  const descripcionTexto = entry.descripcion ? ` (${entry.descripcion})` : "";
  const texto =
    `${emoji}: ${formatSoles(entry.monto)}${descripcionTexto}\n\n` +
    `✅ Ganancias hoy: ${formatSoles(hoy.ganancias)}\n` +
    `📉 Gastos hoy: ${formatSoles(hoy.gastos)}\n` +
    `💰 Total líquido hoy: ${formatSoles(hoy.total)}`;

  try {
    await sock.sendMessage(chatId, { text: texto }, { quoted: msg });
  } catch (err) {
    console.error("Error al confirmar registro de caja chica:", err.message);
  }
}

// Formatea la fecha (en hora Perú) como "YYYY-MM-DD", para usarla como
// identificador de "qué día ya se cerró" y no cerrar el mismo día dos veces.
function peruDateLabel(now) {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

// Revisa cada cierto tiempo si ya son las 11:59pm hora Perú para cerrar el
// día (y, si es domingo, también la semana). Guarda qué día ya cerró para
// no mandar el mensaje dos veces si esta función corre más de una vez
// dentro del mismo minuto.
async function checkCashboxSchedule() {
  if (!currentSock || !botState.connected) return;

  const now = getPeruNow();
  if (now.getHours() !== 23 || now.getMinutes() !== 59) return;

  const hoyLabel = peruDateLabel(now);
  if (cashbox.getLastClosedDay() === hoyLabel) return;

  const grupo = botState.groups.find((g) => g.name.trim().toUpperCase() === CASHBOX_GROUP_NAME);
  if (!grupo) return;

  const resumenDia = cashbox.closeDay(hoyLabel);
  const textoDia =
    `📦 Caja chica del día\n\n` +
    `✅ Ganancias: ${formatSoles(resumenDia.ganancias)}\n` +
    `📉 Gastos: ${formatSoles(resumenDia.gastos)}\n` +
    `💰 Total líquido: ${formatSoles(resumenDia.total)}`;

  try {
    await currentSock.sendMessage(grupo.id, { text: textoDia });
  } catch (err) {
    console.error("Error al mandar el cierre diario de caja chica:", err.message);
  }

  // Domingo = 0 en getDay(). Además del cierre diario, manda el resumen semanal.
  if (now.getDay() === 0 && cashbox.getLastClosedWeek() !== hoyLabel) {
    const resumenSemana = cashbox.closeWeek(hoyLabel);
    const textoSemana =
      `🗓️ Resumen semanal\n\n` +
      `✅ Total ganancias de la semana: ${formatSoles(resumenSemana.ganancias)}\n` +
      `📉 Total gastos de la semana: ${formatSoles(resumenSemana.gastos)}`;
    try {
      await currentSock.sendMessage(grupo.id, { text: textoSemana });
    } catch (err) {
      console.error("Error al mandar el resumen semanal de caja chica:", err.message);
    }
  }
}

setInterval(() => {
  checkCashboxSchedule().catch((err) => console.error("Error en checkCashboxSchedule:", err.message));
}, 30000);

// Deja solo los dígitos y se queda con los últimos 9 (número peruano sin
// el "51" ni "+"), así "+51 934 343 343", "51934343343" y "934343343"
// se comparan como el mismo número.
function canonicalNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits;
}

const excludedNumbersSet = new Set(
  excludedNumbers.flatMap((n) => [canonicalNumber(n), String(n).replace(/\D/g, "")])
);

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

function logSender(chatId, groupName, senderJid, senderNumber, blocked) {
  botState.recentSenders.unshift({
    chatId,
    groupName,
    senderJid,
    senderNumber,
    blocked,
    time: new Date().toISOString(),
  });
  if (botState.recentSenders.length > 30) botState.recentSenders.length = 30;
}

let currentSock = null;

async function refreshGroups(sock) {
  try {
    const groupsMap = await sock.groupFetchAllParticipating();
    botState.groups = Object.values(groupsMap)
      .map((g) => ({
        id: g.id,
        name: g.subject || "(sin nombre)",
        participants: g.participants?.length || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    applyGroupSeed();
  } catch (err) {
    console.error("No se pudo obtener la lista de grupos:", err.message);
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
        console.log("Conexión cerrada. Reconectando...");
        startBot().catch((err) => console.error("Error al reconectar:", err));
      } else {
        console.log("Sesión cerrada. Generando un nuevo QR para vincular...");
        fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        startBot().catch((err) => console.error("Error al reiniciar tras cerrar sesión:", err));
      }
    } else if (connection === "open") {
      botState.connected = true;
      botState.qr = null;
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
      if (!msg?.message || msg.key.fromMe) continue;

      const chatId = msg.key.remoteJid;
      const grupoActual = botState.groups.find((g) => g.id === chatId);
      const rawText = extractText(msg).trim();

      // Caja chica: corre siempre, sin importar el botón principal.
      if (grupoActual && grupoActual.name.trim().toUpperCase() === CASHBOX_GROUP_NAME) {
        const entry = parseCashboxEntry(rawText);
        if (entry) {
          await handleCashboxEntry(sock, chatId, msg, entry);
          continue;
        }
      }

      if (!botState.active) continue;

      const senderJid = msg.key.participant || msg.key.remoteJid || "";
      const senderNumber = canonicalNumber(senderJid.replace(/@.*/, ""));
      const bloqueadoGlobal = excludedNumbersSet.has(senderNumber);
      logSender(chatId, grupoActual?.name || chatId, senderJid, senderNumber, bloqueadoGlobal);

      const text = normalizeText(rawText);
      if (!text) continue;

      // Se usa exec() (no find()) para saber en qué posición del texto
      // aparece la palabra clave y poder resaltarla en el historial.
      const buscarMatch = (matchers) => {
        for (const m of matchers) {
          const result = m.regex.exec(text);
          if (result) return { keyword: m.keyword, index: result.index, length: result[0].length };
        }
        return null;
      };

      // Las keywords especiales de ESTE grupo ganan siempre: se saltan
      // exclusiones, números bloqueados y hasta el sector/grupo apagado.
      let match = buscarKeywordEspecial(text, chatId);
      const esEspecial = Boolean(match);

      if (!match && bloqueadoGlobal) {
        // Número bloqueado globalmente: solo puede responder si hay una
        // excepción activa para este número+grupo+frase. Si no, sigue
        // bloqueado sin más vueltas (no revisa keywords normales).
        match = buscarExcepcionNumero(text, chatId, senderNumber);
        if (!match) continue;
      } else if (!match) {
        // Número normal: las keywords globales agregadas desde el panel
        // no respetan las exclusiones (pero si las que ya venían en keywords.js).
        match = buscarMatch(getExtraPositiveMatchers());
        if (!match) {
          const tieneExclusion = getExcludedMatchers().some(({ regex }) => regex.test(text));
          if (!tieneExclusion) {
            match = buscarMatch(getBasePositiveMatchers());
          }
        }
      }

      if (!match) continue;

      // Si el mensaje menciona una hora o una cantidad de minutos fuera de
      // la ventana configurada (0 a N minutos), no responde — aplica por
      // igual a especiales, excepciones y keywords normales.
      if (!tiempoEnRango(text)) continue;

      const sectorId = getGroupSector(chatId);
      const focusedGroups = getFocusedGroups();
      const enModoEnfoque = focusedGroups.length > 0;

      if (enModoEnfoque) {
        // El modo enfoque manda por encima de todo, incluso de las especiales:
        // SOLO responden los grupos marcados.
        if (!focusedGroups.includes(chatId)) continue;
      } else if (!esEspecial) {
        // Fuera de modo enfoque: las especiales se saltan este check, pero
        // el resto (excepciones por número, keywords normales) necesitan
        // que el sector Y el grupo estén activos.
        if (!isSectorActive(sectorId)) continue;
        if (!isGroupActive(chatId)) continue;
      }

      const sinRemarcar = esSectorSinRemarcar(sectorId);

      const entry = {
        chatId,
        groupName: grupoActual?.name || chatId,
        senderNumber,
        text: rawText,
        matchIndex: match.index,
        matchLength: match.length,
        keyword: match.keyword,
        response: defaultResponse,
        time: new Date().toISOString(),
        sent: false,
      };
      botState.lastActivity = entry;

      // Pequeña espera antes de responder, para que se sienta más natural.
      await new Promise((resolve) => setTimeout(resolve, getResponseDelay()));

      try {
        await sock.sendMessage(
          chatId,
          { text: defaultResponse },
          sinRemarcar ? {} : { quoted: msg } // el sector Comodín no cita el mensaje original
        );
        entry.sent = true;
        botState.history.unshift(entry);
        if (botState.history.length > MAX_HISTORY) botState.history.length = MAX_HISTORY;

        // El bot se apaga solo después de responder: hay que reactivarlo a mano.
        botState.active = false;
        break;
      } catch (err) {
        console.error("Error al enviar la respuesta:", err.message);
        entry.error = err.message;
      }
    }
  });

  return sock;
}

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

module.exports = { startBot, botState, logoutBot };
