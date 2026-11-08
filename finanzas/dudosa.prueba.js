const path = require("path");
const fs = require("fs");
const os = require("os");
const { EventEmitter } = require("events");

// Cuando una línea no se entiende, el bot pregunta qué es en vez de
// adivinar. El caso real (03/11): "9 - 225 Interbank" se anotó como una
// ganancia de S/ 9, porque Interbank no estaba entre las cuentas.
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "dudosa-"));
process.env.DATA_DIR = CARPETA;
fs.mkdirSync(path.join(CARPETA, "users", "patrick"), { recursive: true });

// WhatsApp simulado: guarda lo que el bot manda.
const enviados = [];
let sock = null;
function crearSock() {
  sock = {
    ev: new EventEmitter(),
    user: { id: "51900000000:1@s.whatsapp.net" },
    groupFetchAllParticipating: async () => ({ "gan@g.us": { id: "gan@g.us", subject: "GANANCIAS", participants: [] } }),
    groupMetadata: async () => ({ subject: "GANANCIAS" }),
    sendMessage: async (jid, contenido, opciones) => {
      const key = { id: "BOT" + (enviados.length + 1), remoteJid: jid, fromMe: true };
      enviados.push({ contenido, citado: opciones?.quoted?.key?.id || null, key });
      return { key };
    },
    end() {},
    logout: async () => {},
  };
  return sock;
}
const archivo = require.resolve("@whiskeysockets/baileys");
const real = require(archivo);
require.cache[archivo] = {
  id: archivo,
  filename: archivo,
  loaded: true,
  exports: {
    ...real,
    makeWASocket: crearSock,
    default: crearSock,
    useMultiFileAuthState: async () => ({ state: {}, saveCreds() {} }),
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
  },
};

const contexto = require("./contexto");
const bot = require("./bot");
const cashbox = require("./cashbox");
const referenceAccounts = require("./referenceAccounts");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const como = (fn) => contexto.correrComo("patrick", fn);

// ---------- Qué cuenta como dudosa ----------
como(() => {
  const leer = (t) => bot.parseCashboxLine(t);
  let r = leer("9 - 225 Interbank");
  ok(r && r.type === "dudosa" && r.monto === 9 && r.palabras === "Interbank", '"9 - 225 Interbank" ya no es una ganancia de S/ 9: es dudosa');
  ok(leer("9-225 Interbank").type === "dudosa", "pegado sin espacios también");
  ok(leer("menos 50 - 20 almuerzo").type === "dudosa", "con menos también");
  ok(leer("20x3 almuerzo").type === "dudosa", '"20x3" también (¿20 o 60?)');
  ok(leer("15 pers").type === "ganancia" && leer("menos 15 pasaje").type === "gasto", "lo de siempre sigue igual");
  ok(leer("199.35 - 7 yape").type === "referencia", "una cuenta conocida sigue siendo anotación, sin preguntar");
});

let n = 0;
const mensaje = (texto, citado) => ({
  key: { id: "M" + ++n, remoteJid: "gan@g.us", fromMe: true },
  messageTimestamp: Math.floor(Date.now() / 1000),
  message: citado
    ? { extendedTextMessage: { text: texto, contextInfo: { stanzaId: citado.id, quotedMessage: { conversation: citado.texto || "" } } } }
    : { conversation: texto },
});
async function escribir(texto, citado) {
  const antes = enviados.length;
  const msg = mensaje(texto, citado);
  sock.ev.emit("messages.upsert", { messages: [msg], type: "notify" });
  await esperar(150);
  return { msg, nuevos: enviados.slice(antes) };
}
const ganado = () => como(() => cashbox.getToday().ganancias);
const gastado = () => como(() => cashbox.getToday().gastos);

(async () => {
  await como(() => bot.startBot("patrick"));
  sock.ev.emit("connection.update", { connection: "open" });
  await esperar(50);

  // ---------- El mensaje del 03/11 ----------
  let { msg, nuevos } = await escribir("988 efectivo\n9 - 225 Interbank\n15 pers");
  ok(ganado() === 15, "anota lo que entiende (15 pers) y NO los S/ 9");
  const reaccion = nuevos.find((e) => e.contenido.react);
  ok(reaccion && reaccion.contenido.react.text === "🤔", "le pone 🤔 al mensaje (no ✅)");
  const pregunta = nuevos.find((e) => e.contenido.text && e.contenido.text.startsWith("🤔 No anoté"));
  ok(pregunta && pregunta.citado === msg.key.id, "y pregunta, citando el mensaje");
  ok(/«9 - 225 Interbank»/.test(pregunta.contenido.text) && /Lo demás del mensaje sí lo anoté/.test(pregunta.contenido.text), "dice qué línea y que lo demás sí se anotó");
  ok(/1 = ganancia de S\/ 9/.test(pregunta.contenido.text) && /3 = saldo de la cuenta «Interbank»/.test(pregunta.contenido.text), "con las opciones");

  // Responde 3: era el saldo de Interbank.
  ({ nuevos } = await escribir("3", { id: pregunta.key.id, texto: pregunta.contenido.text }));
  ok(ganado() === 15 && gastado() === 0, "al responder 3 no suma ni resta");
  ok(como(() => referenceAccounts.getNombres().includes("interbank")), "e Interbank queda como cuenta");
  ok(nuevos.some((e) => e.contenido.text && /Desde ahora reconozco esa cuenta/.test(e.contenido.text)), "y lo confirma");
  ({ nuevos } = await escribir("50 - 10 Interbank"));
  ok(!nuevos.some((e) => e.contenido.text && e.contenido.text.startsWith("🤔")), "la próxima vez ya no pregunta: es una cuenta");
  // Antes la reacción nunca salía: usaba una variable que no existía ahí.
  ok(nuevos.some((e) => e.contenido.react?.text === "✅"), "y le pone ✅ al mensaje anotado");

  // ---------- Responder sin citar (una sola pregunta abierta) ----------
  ({ nuevos } = await escribir("20x3 almuerzo"));
  ok(nuevos.some((e) => e.contenido.text && e.contenido.text.startsWith("🤔 No anoté «20x3 almuerzo»")), "pregunta por 20x3");
  ({ nuevos } = await escribir("2"));
  ok(gastado() === 20, 'un "2" suelto responde la única pregunta abierta: gasto de S/ 20');

  // ---------- Ignorar ----------
  const p = (await escribir("7 - 3 cosas")).nuevos.find((e) => e.contenido.text?.startsWith("🤔"));
  await escribir("4", { id: p.key.id, texto: p.contenido.text });
  ok(ganado() === 15 && gastado() === 20, "4 = no se anota nada");

  // ---------- Se reinició y ya no tiene la pregunta ----------
  ({ nuevos } = await escribir("1", { id: "VIEJA", texto: "🤔 No anoté «5 - 1 algo»: no sé qué es." }));
  ok(nuevos.some((e) => e.contenido.text && /Ya no tengo esa pregunta/.test(e.contenido.text)) && ganado() === 15, "si no tiene la pregunta, avisa que la escriba de nuevo (y no anota S/ 1)");

  fs.rmSync(CARPETA, { recursive: true, force: true });
  console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
  process.exit(fallos === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
