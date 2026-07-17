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
const {
  getGroupSector,
  isSectorActive,
  isGroupActive,
  esSectorSinRemarcar,
  getFocusedGroups,
  getResponseDelay,
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
function getPositiveMatchers() {
  return buildMatchers([...positiveKeywords, ...dynamicKeywords.getExtraPositive()]);
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

// Las keywords especiales por grupo no buscan la frase completa: alcanza con
// que TODAS sus palabras importantes aparezcan en el mensaje (en cualquier
// orden, con lo que sea en el medio). Así "hola que hace una compra" también
// detecta "hola quiero una compra en metro" (tiene "hola" y "compra").
function buscarKeywordEspecial(text, chatId) {
  const frases = dynamicKeywords.getSpecialForGroup(chatId);
  for (const frase of frases) {
    const palabras = getSignificantWords(frase);
    if (palabras.length === 0) continue;
    const resultados = palabras.map((w) => buildKeywordRegex(w).exec(text));
    if (resultados.every(Boolean)) {
      const primero = resultados[0];
      return { keyword: frase, index: primero.index, length: primero[0].length };
    }
  }
  return null;
}

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
  } catch (err) {
    console.error("No se pudo obtener la lista de grupos:", err.message);
  }
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
    if (!botState.active) return;

    for (const msg of messages) {
      if (!msg?.message || msg.key.fromMe) continue;

      const chatId = msg.key.remoteJid;
      const grupoActual = botState.groups.find((g) => g.id === chatId);

      // Ignora por completo a los números excluidos, sin importar qué escriban.
      const senderJid = msg.key.participant || msg.key.remoteJid || "";
      const senderNumber = canonicalNumber(senderJid.replace(/@.*/, ""));
      const bloqueado = excludedNumbersSet.has(senderNumber);
      logSender(chatId, grupoActual?.name || chatId, senderJid, senderNumber, bloqueado);
      if (bloqueado) continue;

      const rawText = extractText(msg).trim();
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

      // Las keywords especiales de ESTE grupo ganan siempre, sin importar
      // las exclusiones globales (búsqueda flexible por palabras, no frase exacta).
      let match = buscarKeywordEspecial(text, chatId);

      if (!match) {
        const tieneExclusion = getExcludedMatchers().some(({ regex }) => regex.test(text));
        if (tieneExclusion) continue;
        match = buscarMatch(getPositiveMatchers());
      }

      if (!match) continue;

      const sectorId = getGroupSector(chatId);
      const focusedGroups = getFocusedGroups();
      const enModoEnfoque = focusedGroups.length > 0;

      if (enModoEnfoque) {
        // En modo enfoque SOLO responden los grupos marcados, pase lo que
        // pase con su sector o su estado individual.
        if (!focusedGroups.includes(chatId)) continue;
      } else {
        // Fuera de modo enfoque: hace falta que el sector Y el grupo estén activos.
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
