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

// El token es "vencimiento.firma": no guarda nada del lado del servidor,
// así que sigue siendo válido aunque el servicio se reinicie o redespliegue.
function crearToken() {
  const vence = Date.now() + DURACION_MS;
  return `${vence}.${firmar(vence)}`;
}

function tokenValido(token) {
  if (!estaConfigurado() || !token) return false;
  const [vence, firma] = String(token).split(".");
  if (!vence || !firma) return false;
  if (!igualSeguro(firma, firmar(vence))) return false;
  return Number(vence) > Date.now();
}

function leerCookie(req, nombre) {
  const crudo = req.headers.cookie || "";
  for (const parte of crudo.split(";")) {
    const [clave, ...resto] = parte.trim().split("=");
    if (clave === nombre) return decodeURIComponent(resto.join("="));
  }
  return null;
}

function haySesion(req) {
  return tokenValido(leerCookie(req, COOKIE));
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

module.exports = { estaConfigurado, passwordCorrecta, crearToken, haySesion, cookieDeSesion, cookieVacia };
