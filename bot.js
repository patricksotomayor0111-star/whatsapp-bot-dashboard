const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const P = require("pino");
const qrcode = require("qrcode-terminal");
const QRImage = require("qrcode");
const path = require("path");
const { keywordRules } = require("./keywords");

const SESSION_PATH = path.join(__dirname, "session");

// Estado compartido con el dashboard (server.js lo lee)
const botState = {
  connected: false,
  qr: null,
  qrImage: null,
  lastActivity: null,
};

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      botState.qr = qr;
      console.log("\nEscanea este código QR con WhatsApp (Dispositivos vinculados):\n");
      qrcode.generate(qr, { small: true });
      try {
        botState.qrImage = await QRImage.toDataURL(qr);
      } catch (err) {
        console.error("No se pudo generar la imagen del QR:", err);
      }
    }

    if (connection === "close") {
      botState.connected = false;
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("Conexión cerrada.", shouldReconnect ? "Reconectando..." : "Sesión cerrada, escanea el QR de nuevo.");
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      botState.connected = true;
      botState.qr = null;
      botState.qrImage = null;
      console.log("Bot conectado a WhatsApp correctamente.");
    }
  });

  // Detección de palabra clave y respuesta citando el mensaje original
  sock.ev.on("messages.upsert", async ({ messages }) => {
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

module.exports = { startBot, botState };
