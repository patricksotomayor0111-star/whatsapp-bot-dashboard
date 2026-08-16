const fs = require("fs");
const webpush = require("web-push");
const { crearAlmacen } = require("./almacenPorUsuario");
const { dataPath } = require("./dataDir");

// Las suscripciones sí son de cada cuenta (son los celulares de esa
// persona), pero las claves VAPID identifican al SERVIDOR frente al
// servicio de notificaciones, no al usuario. Por eso viven aparte, una
// sola vez para toda la instalación: si cada cuenta generara las suyas,
// las suscripciones existentes dejarían de funcionar.
const almacen = crearAlmacen("push-data.json", function (parsed) {
  try {
    return { subscriptions: parsed.subscriptions || [] };
  } catch (err) {
    return { subscriptions: [] };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;

const VAPID_PATH = dataPath("vapid-data.json");

function cargarVapid() {
  try {
    const guardado = JSON.parse(fs.readFileSync(VAPID_PATH, "utf8"));
    if (guardado.publicKey && guardado.privateKey) return guardado;
  } catch (err) {
    // sigue abajo y las genera
  }

  // Antes las claves vivían dentro de push-data.json. Se reutilizan si
  // están ahí, para que los celulares ya suscritos no pierdan las
  // notificaciones al pasar a multiusuario.
  try {
    const viejo = JSON.parse(fs.readFileSync(dataPath("push-data.json"), "utf8"));
    if (viejo.vapidPublicKey && viejo.vapidPrivateKey) {
      const heredadas = { publicKey: viejo.vapidPublicKey, privateKey: viejo.vapidPrivateKey };
      fs.writeFileSync(VAPID_PATH, JSON.stringify(heredadas, null, 2));
      return heredadas;
    }
  } catch (err) {
    // no había nada previo
  }

  const nuevas = webpush.generateVAPIDKeys();
  try {
    fs.writeFileSync(VAPID_PATH, JSON.stringify(nuevas, null, 2));
  } catch (err) {
    console.error("No se pudo guardar vapid-data.json:", err.message);
  }
  return nuevas;
}

const vapid = cargarVapid();
webpush.setVapidDetails("mailto:notificaciones@whatsapp-bot-dashboard.local", vapid.publicKey, vapid.privateKey);

function getPublicKey() {
  return vapid.publicKey;
}

function addSubscription(sub) {
  if (!sub || !sub.endpoint) return;
  const yaExiste = datos().subscriptions.some((s) => s.endpoint === sub.endpoint);
  if (!yaExiste) {
    datos().subscriptions.push(sub);
    save();
  }
}

function removeSubscription(endpoint) {
  const antes = datos().subscriptions.length;
  datos().subscriptions = datos().subscriptions.filter((s) => s.endpoint !== endpoint);
  if (datos().subscriptions.length !== antes) save();
}

// Manda la notificación a todos los dispositivos suscritos. Si alguno ya no
// es válido (404/410 — el usuario desinstaló o revocó el permiso), se borra
// solo para no seguir intentando mandarle en vano.
async function notifyAll(payload) {
  if (datos().subscriptions.length === 0) return;
  const payloadStr = JSON.stringify(payload);
  const subs = datos().subscriptions.slice();
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
