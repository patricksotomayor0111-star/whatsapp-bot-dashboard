const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const DATA_PATH = path.join(__dirname, "push-data.json");

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      vapidPublicKey: parsed.vapidPublicKey || null,
      vapidPrivateKey: parsed.vapidPrivateKey || null,
      subscriptions: parsed.subscriptions || [],
    };
  } catch (err) {
    return { vapidPublicKey: null, vapidPrivateKey: null, subscriptions: [] };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar push-data.json:", err.message);
  }
}

// Las claves VAPID se generan una sola vez y se guardan: si cambiaran en
// cada reinicio, las suscripciones ya hechas por el celular dejarían de
// funcionar (quedarían firmadas con una clave vieja).
if (!data.vapidPublicKey || !data.vapidPrivateKey) {
  const keys = webpush.generateVAPIDKeys();
  data.vapidPublicKey = keys.publicKey;
  data.vapidPrivateKey = keys.privateKey;
  save();
}

webpush.setVapidDetails("mailto:notificaciones@whatsapp-bot-dashboard.local", data.vapidPublicKey, data.vapidPrivateKey);

function getPublicKey() {
  return data.vapidPublicKey;
}

function addSubscription(sub) {
  if (!sub || !sub.endpoint) return;
  const yaExiste = data.subscriptions.some((s) => s.endpoint === sub.endpoint);
  if (!yaExiste) {
    data.subscriptions.push(sub);
    save();
  }
}

function removeSubscription(endpoint) {
  const antes = data.subscriptions.length;
  data.subscriptions = data.subscriptions.filter((s) => s.endpoint !== endpoint);
  if (data.subscriptions.length !== antes) save();
}

// Manda la notificación a todos los dispositivos suscritos. Si alguno ya no
// es válido (404/410 — el usuario desinstaló o revocó el permiso), se borra
// solo para no seguir intentando mandarle en vano.
async function notifyAll(payload) {
  if (data.subscriptions.length === 0) return;
  const payloadStr = JSON.stringify(payload);
  const subs = data.subscriptions.slice();
  const resultados = await Promise.allSettled(subs.map((sub) => webpush.sendNotification(sub, payloadStr)));
  resultados.forEach((resultado, i) => {
    if (resultado.status === "rejected") {
      const statusCode = resultado.reason?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        removeSubscription(subs[i].endpoint);
      } else {
        console.error("Error al mandar notificación push:", resultado.reason?.message || resultado.reason);
      }
    }
  });
}

module.exports = { getPublicKey, addSubscription, removeSubscription, notifyAll };
