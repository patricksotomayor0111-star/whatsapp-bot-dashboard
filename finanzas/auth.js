const crypto = require("crypto");

// El panel estaba abierto en internet: cualquiera con la URL podía ver y
// modificar toda la información financiera, y peor, ver el QR de
// vinculación de WhatsApp cuando el bot se caía. Esto lo cierra con una
// contraseña única que llega por variable de entorno (nunca en el código).
const PASSWORD = (process.env.PANEL_PASSWORD || "").trim();
const DURACION_MS = 30 * 24 * 3600 * 1000; // la sesión dura 30 días
const COOKIE = "panel_sesion";

// Sin contraseña configurada NO se deja pasar a nadie: es preferible que
// el panel quede inaccesible (y avise qué falta) a que siga abierto.
function estaConfigurado() {
  return PASSWORD.length > 0;
}

function firmar(valor) {
  return crypto.createHmac("sha256", PASSWORD).update(String(valor)).digest("hex");
}

// Comparación en tiempo constante, para no filtrar información por cuánto
// tarda en responder.
function igualSeguro(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function passwordCorrecta(intento) {
  return estaConfigurado() && igualSeguro(intento || "", PASSWORD);
}

// El token es "usuario.vencimiento.firma": no guarda nada del lado del
// servidor, así que sigue siendo válido aunque el servicio se reinicie o
// redespliegue. El usuario va firmado junto con el vencimiento, así nadie
// puede editarlo para entrar como otra cuenta.
function crearToken(userId) {
  const vence = Date.now() + DURACION_MS;
  const cuerpo = `${userId}.${vence}`;
  return `${cuerpo}.${firmar(cuerpo)}`;
}

// Devuelve el id del usuario del token, o null si no sirve.
function usuarioDeToken(token) {
  if (!estaConfigurado() || !token) return null;
  const partes = String(token).split(".");
  if (partes.length !== 3) return null;
  const [userId, vence, firma] = partes;
  if (!userId || !vence || !firma) return null;
  if (!igualSeguro(firma, firmar(`${userId}.${vence}`))) return null;
  if (!(Number(vence) > Date.now())) return null;
  return userId;
}

function leerCookie(req, nombre) {
  const crudo = req.headers.cookie || "";
  for (const parte of crudo.split(";")) {
    const [clave, ...resto] = parte.trim().split("=");
    if (clave === nombre) return decodeURIComponent(resto.join("="));
  }
  return null;
}

// El usuario de la sesión de este pedido, o null si no hay o venció.
function usuarioDeSesion(req) {
  return usuarioDeToken(leerCookie(req, COOKIE));
}

function cookieDeSesion(token) {
  const partes = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(DURACION_MS / 1000)}`,
    "Secure", // Railway siempre sirve por HTTPS
  ];
  return partes.join("; ");
}

function cookieVacia() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

module.exports = { estaConfigurado, passwordCorrecta, crearToken, usuarioDeSesion, cookieDeSesion, cookieVacia };
