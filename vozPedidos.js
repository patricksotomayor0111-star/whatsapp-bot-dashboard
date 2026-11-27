const fs = require("fs");
const crypto = require("crypto");
const { dataPath } = require("./dataDir");

// Leer en voz alta: el celular dice lo que escriben en los grupos.
//
// La idea: dejar el celular cargando con la pantalla apagada (durmiendo) y,
// sin levantarse, escuchar "ARTIA: un motorizado por favor" o "ARTIA: Juan
// dijo voy" (así se sabe que alguien ya fue por ese pedido).
//
// Quién decide qué se lee es el bot, porque es el que ve el NÚMERO exacto de
// quien escribe y ya tiene la lista de números ignorados. La app del
// celular (carpeta voz-app) solo recibe el texto y lo dice. Se prende y se
// apaga en la app, aparte del bot: con el bot apagado igual se lee.
//
// Qué se lee, en los grupos de todos los sectores menos "Otros":
//   - lo que escribe el restaurante (todo número que no esté en la lista de
//     ignorados) se lee entero, y si manda una ubicación, un audio o una
//     foto se avisa que la mandó;
//   - de los números ignorados, solo un mensaje corto con una palabra
//     especial ("voy", editable en el panel), cite el mensaje o no;
//   - nada más.
//
// La app se conecta a /voz/stream con una llave (token) propia, porque no
// tiene la sesión del panel. Si se pierde la conexión un momento, al volver
// recibe lo que se dijo mientras tanto (si no es muy viejo).

const DATA_PATH = dataPath("voz-pedidos.json");
const PALABRAS_POR_DEFECTO = ["voy"];
const MAX_PALABRAS = 20;
const MAX_LARGO_PALABRA = 40;
// Un "voy" es un mensaje corto. "no voy a poder ir hoy" no es tomar el pedido.
const MAX_PALABRAS_MENSAJE_ESPECIAL = 5;
const MAX_LARGO_LECTURA = 280;
const MAX_EVENTOS = 50;
// Al reconectar se repite lo que se perdió, pero no algo de hace rato: a
// las 3 am no sirve escuchar un pedido de las 2.
const REPETIR_HASTA_MS = 3 * 60 * 1000;
const LATIDO_MS = 20 * 1000;

function normalizar(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nuevoToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function cargar() {
  let guardado = {};
  try {
    guardado = JSON.parse(fs.readFileSync(DATA_PATH, "utf8")) || {};
  } catch {}
  const palabras = Array.isArray(guardado.palabras)
    ? guardado.palabras.map(normalizar).filter(Boolean)
    : PALABRAS_POR_DEFECTO.slice();
  const token = typeof guardado.token === "string" && guardado.token.length >= 20 ? guardado.token : nuevoToken();
  return { palabras: [...new Set(palabras)], token };
}

let config = cargar();

function guardar() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("No se pudo guardar voz-pedidos.json:", err.message);
  }
}
// La llave se crea una vez y queda guardada: si cambiara en cada arranque,
// la app perdería la conexión con cada cambio que se sube.
guardar();

// ---------- Palabras especiales ----------
function getPalabras() {
  return config.palabras.slice();
}

// Lanza un Error con el mensaje para el panel.
function agregarPalabra(cruda) {
  const palabra = normalizar(cruda);
  if (!palabra) throw new Error("Escribe la palabra.");
  if (palabra.length > MAX_LARGO_PALABRA) throw new Error(`Muy larga (hasta ${MAX_LARGO_PALABRA} letras).`);
  if (palabra.split(" ").length > MAX_PALABRAS_MENSAJE_ESPECIAL) {
    throw new Error(`Hasta ${MAX_PALABRAS_MENSAJE_ESPECIAL} palabras.`);
  }
  if (config.palabras.includes(palabra)) throw new Error(`"${palabra}" ya está.`);
  if (config.palabras.length >= MAX_PALABRAS) throw new Error(`Puedes tener hasta ${MAX_PALABRAS}.`);
  config.palabras.push(palabra);
  guardar();
  return getPalabras();
}

function quitarPalabra(cruda) {
  const palabra = normalizar(cruda);
  config.palabras = config.palabras.filter((p) => p !== palabra);
  guardar();
  return getPalabras();
}

// La palabra especial que trae el mensaje, o null. Tiene que estar como
// palabra entera ("voy", "yo voy", "voy 🏍️"; no "voyager") y el mensaje
// tiene que ser corto.
function palabraEspecialEn(texto) {
  const t = normalizar(texto);
  if (!t) return null;
  const palabras = t.split(" ");
  if (palabras.length > MAX_PALABRAS_MENSAJE_ESPECIAL) return null;
  const conEspacios = ` ${t} `;
  return config.palabras.find((p) => conEspacios.includes(` ${p} `)) || null;
}

// ---------- Cómo se dice ----------
// El lector de voz lee los emojis por su nombre ("cara sonriendo") y los
// links letra por letra: se sacan.
function limpiarParaVoz(str) {
  return String(str || "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " un link ")
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍️⃣]/gu, " ")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cortar(str, max = MAX_LARGO_LECTURA) {
  if (str.length <= max) return str;
  const corte = str.slice(0, max);
  const espacio = corte.lastIndexOf(" ");
  return (espacio > max * 0.6 ? corte.slice(0, espacio) : corte) + "…";
}

// El nombre del local, corto y que se entienda: "MISTER JUGO BOX DELIVERY"
// se dice "Mister Jugo". Casi todos los grupos terminan en "BOX DELIVERY" o
// "PEDIDOS", y oírlo en cada mensaje cansa. En mayúsculas el lector a
// veces deletrea, por eso cada palabra queda como "Jugo" (menos los
// números romanos: "Bumanguesa II").
function nombreParaVoz(nombre) {
  const limpio = limpiarParaVoz(nombre);
  if (!limpio) return "Un grupo";
  const corto =
    limpio
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/[\s\-–—]*\bbox(\s+del\w*)?(\s+ica)?\s*$/i, "")
      .replace(/[\s\-–—]*\bpedidos\s*$/i, "")
      .replace(/^[\s\-–—]+|[\s\-–—]+$/g, "")
      .replace(/\s+/g, " ")
      .trim() || limpio;
  return corto
    .split(" ")
    .map((p) => {
      if (/^[IVX]+$/.test(p) || !/\p{L}/u.test(p) || p !== p.toUpperCase()) return p;
      return p.charAt(0) + p.slice(1).toLowerCase();
    })
    .join(" ");
}

const QUE_MANDO = {
  ubicacion: "mandó una ubicación",
  contacto: "mandó un contacto",
  audio: "mandó un audio",
  foto: "mandó una foto",
  video: "mandó un video",
  archivo: "mandó un archivo",
};

// Lo que hay que decir para este mensaje, o null si no se lee.
//   tipo: "texto" | "ubicacion" | "contacto" | "audio" | "foto" | "video" | "archivo" | "otro"
function queDecir({ grupoNombre, esOtros = false, esDelRestaurante, rawText = "", nombre = "", tipo = "texto" }) {
  if (esOtros) return null;
  const grupo = nombreParaVoz(grupoNombre);
  const texto = cortar(limpiarParaVoz(rawText));

  if (esDelRestaurante) {
    const mando = QUE_MANDO[tipo];
    if (mando) return texto ? `${grupo} ${mando}: ${texto}` : `${grupo} ${mando}`;
    if (tipo === "texto" && texto) return `${grupo}: ${texto}`;
    return null; // stickers, reacciones y demás no se leen
  }

  if (tipo !== "texto" || !palabraEspecialEn(rawText) || !texto) return null;
  const quien = limpiarParaVoz(nombre) || "alguien";
  return `${grupo}: ${quien} dijo ${texto}`;
}

// ---------- Envío a los celulares ----------
const ARRANQUE = Date.now().toString(36);
let contador = 0;
const eventos = []; // los últimos, para repetir al reconectar y para el panel
const clientes = new Set(); // { res, dispositivo, desdeMs, latido }

function escribir(res, evento) {
  res.write(`id: ${evento.id}\nevent: leer\ndata: ${JSON.stringify({ texto: evento.texto, ms: evento.ms })}\n\n`);
}

function emitir(texto, extra = {}) {
  contador += 1;
  const evento = { id: `${ARRANQUE}-${contador}`, n: contador, ms: Date.now(), texto, ...extra };
  eventos.push(evento);
  if (eventos.length > MAX_EVENTOS) eventos.shift();
  for (const c of clientes) {
    try {
      escribir(c.res, evento);
    } catch {}
  }
  return evento;
}

// Revisa un mensaje de grupo y, si toca, lo manda a los celulares. Devuelve
// lo que se dijo (o null). Nunca lanza: no puede frenar al bot.
function revisarMensaje(datos) {
  try {
    const texto = queDecir(datos);
    if (!texto) return null;
    emitir(texto, { grupo: datos.grupoNombre || "", especial: !datos.esDelRestaurante });
    return texto;
  } catch (err) {
    console.error("Voz: no se pudo revisar el mensaje:", err.message);
    return null;
  }
}

function probar() {
  return emitir("Prueba de voz. Así vas a escuchar los mensajes de tus grupos.", { prueba: true });
}

function tokenValido(token) {
  const a = Buffer.from(String(token || ""));
  const b = Buffer.from(config.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// "abc-12" -> lo que se dijo después de eso. Si el servidor se reinició
// (otro ARRANQUE), todo lo de este arranque es nuevo para la app.
function pendientesDesde(ultimoId, ahora = Date.now()) {
  const [arranque, n] = String(ultimoId || "").split("-");
  const desde = arranque === ARRANQUE ? Number(n) || 0 : 0;
  if (!ultimoId) return [];
  return eventos.filter((e) => e.n > desde && ahora - e.ms <= REPETIR_HASTA_MS);
}

function conectar(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  const ultimoId = req.get("Last-Event-ID") || req.query.ultimo || "";
  for (const e of pendientesDesde(ultimoId)) escribir(res, e);

  const cliente = {
    res,
    dispositivo: String(req.query.d || "Celular").slice(0, 60),
    desdeMs: Date.now(),
    // Algo cada 20 seg para que ni Railway ni el celular den la conexión
    // por muerta mientras no pasa nada.
    latido: setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {}
    }, LATIDO_MS),
  };
  clientes.add(cliente);
  req.on("close", () => {
    clearInterval(cliente.latido);
    clientes.delete(cliente);
  });
}

// Una llave nueva desconecta los celulares que tenían la anterior.
function cambiarToken() {
  config.token = nuevoToken();
  guardar();
  for (const c of clientes) {
    try {
      c.res.end();
    } catch {}
  }
  return config.token;
}

function getToken() {
  return config.token;
}

function estado(ahora = Date.now()) {
  return {
    palabras: getPalabras(),
    conectados: [...clientes].map((c) => ({ dispositivo: c.dispositivo, desdeMs: c.desdeMs })),
    ultimos: eventos
      .slice(-15)
      .reverse()
      .map((e) => ({ texto: e.texto, ms: e.ms, prueba: Boolean(e.prueba), especial: Boolean(e.especial) })),
    ahoraMs: ahora,
  };
}

module.exports = {
  getPalabras,
  agregarPalabra,
  quitarPalabra,
  palabraEspecialEn,
  queDecir,
  revisarMensaje,
  probar,
  tokenValido,
  conectar,
  cambiarToken,
  getToken,
  estado,
  pendientesDesde,
  // Para las pruebas.
  _limpiarParaVoz: limpiarParaVoz,
  _nombreParaVoz: nombreParaVoz,
};
