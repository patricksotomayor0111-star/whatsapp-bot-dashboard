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
const { keywordRules } = require("./keywords");

const SESSION_PATH = path.join(__dirname, "session");

// Estado compartido con el dashboard (server.js lo lee)
const botState = {
  connected: false,
  qr: null,
  lastActivity: null,
  groups: [],
  active: false, // arranca inactivo: hay que activarlo manualmente desde el panel tras vincular
};

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

  // Detección de palabra clave y respuesta citando el mensaje original
  sock.ev.on("messages.upsert", async ({ messages }) => {
    if (!botState.active) return;

    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const chatId = msg.key.remoteJid;
    const text = extractText(msg).trim().toLowerCase();
    if (!text) return;

    const rule = keywordRules.find(
      (r) =>
        (r.groupId === "*" || r.groupId === chatId) &&
        text === r.keyword.toLowerCase()
    );

    if (rule) {
      botState.lastActivity = {
        chatId,
        keyword: rule.keyword,
        response: rule.response,
        time: new Date().toISOString(),
      };

      await sock.sendMessage(
        chatId,
        { text: rule.response },
        { quoted: msg } // esto genera la respuesta citada (igual que la captura)
      );
    }
  });

  return sock;
}

function extractText(msg) {
  return (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    ""
  );
}

module.exports = { startBot, botState, logoutBot };
