const fs = require("fs");
const path = require("path");
const { dataPath } = require("./dataDir");

// Respaldo de toda la configuración del panel, para poder recuperarla si el
// disco de Railway falla o si hay que mudar el bot a otro lado.
//
// QUÉ NO ENTRA, a propósito:
//   - session/ : son las credenciales de WhatsApp. Si el archivo de
//     respaldo se filtrara, cualquiera podría entrar a tu WhatsApp. El QR
//     se vuelve a escanear y listo, no vale el riesgo.
//   - lid-map.json : es una caché de miles de entradas que el bot
//     reconstruye solo; haría el respaldo enorme sin aportar nada.
//   - Las colas del momento (pedidos en espera, cotizaciones pendientes):
//     son estado de este rato, no configuración.
const ARCHIVOS = [
  "sectors-data.json", // sectores, grupos, ventanas de tiempo, delays, antigüedad
  "dynamic-keywords-data.json", // keywords agregadas desde el panel
  "number-exceptions-data.json", // frases por sector
  "excluded-numbers-data.json", // números ignorados
  "media-triggers-data.json", // grupos de foto / contacto / nota de voz
  "group-delays.json", // delays personalizados por grupo
  "scheduled-broadcasts-data.json", // mensajes programados
  "quote-config-data.json", // configuración de cotizaciones
  "contact-trigger-groups.json", // legado (ya migrado a media-triggers, va por si acaso)
  "push-data.json", // dispositivos suscritos a notificaciones
];

const CARPETA_IMAGENES = "broadcast-images";
const MARCA = "whatsapp-bot-backup";
const APP = "delivery";

function leerArchivo(nombre) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(nombre), "utf8"));
  } catch (err) {
    return null; // no existe todavía: no es un error
  }
}

// Las fotos de los mensajes programados van en base64 para que el respaldo
// sea un solo archivo. Son lo más pesado que lleva (una foto de WhatsApp
// puede ser 1-2 MB, y en base64 crece un tercio más).
//
// Solo se copian las que algún mensaje esté usando de verdad
// (b.imagenArchivo): si se borra un mensaje programado y su foto queda en
// la carpeta, esa sobra no tiene por qué viajar en cada respaldo.
function leerImagenes(broadcastsData) {
  const enUso = new Set(
    (broadcastsData?.broadcasts || []).map((b) => b.imagenArchivo).filter(Boolean)
  );
  if (enUso.size === 0) return {};

  const imagenes = {};
  const carpeta = dataPath(CARPETA_IMAGENES);
  enUso.forEach((nombre) => {
    try {
      imagenes[nombre] = fs.readFileSync(path.join(carpeta, nombre)).toString("base64");
    } catch (err) {
      // la foto ya no está en disco: el mensaje queda sin ella, no es fatal
    }
  });
  return imagenes;
}

function crear() {
  const archivos = {};
  ARCHIVOS.forEach((nombre) => {
    const contenido = leerArchivo(nombre);
    if (contenido !== null) archivos[nombre] = contenido;
  });
  return {
    marca: MARCA,
    app: APP,
    version: 1,
    fecha: new Date().toISOString(),
    archivos,
    imagenes: leerImagenes(archivos["scheduled-broadcasts-data.json"]),
  };
}

// Cuenta qué trae un respaldo sin restaurarlo, para poder mostrarlo antes
// de pisar nada.
function resumir(backup) {
  const archivos = backup?.archivos || {};
  return {
    fecha: backup?.fecha || null,
    archivos: Object.keys(archivos).length,
    imagenes: Object.keys(backup?.imagenes || {}).length,
    grupos: Object.keys(archivos["sectors-data.json"]?.groupSectors || {}).length,
    numerosIgnorados: (archivos["excluded-numbers-data.json"]?.numeros || []).length,
    mensajesProgramados: (archivos["scheduled-broadcasts-data.json"]?.broadcasts || []).length,
  };
}

function restaurar(backup) {
  if (!backup || backup.marca !== MARCA) {
    throw new Error("Ese archivo no es un respaldo de este bot.");
  }
  if (backup.app !== APP) {
    throw new Error(`Ese respaldo es de "${backup.app}", no del bot de delivery.`);
  }
  const archivos = backup.archivos || {};
  const restaurados = [];

  Object.keys(archivos).forEach((nombre) => {
    // Solo se aceptan los nombres conocidos: así un archivo manipulado no
    // puede escribir en cualquier lado del disco.
    if (!ARCHIVOS.includes(nombre)) return;
    try {
      fs.writeFileSync(dataPath(nombre), JSON.stringify(archivos[nombre], null, 2));
      restaurados.push(nombre);
    } catch (err) {
      console.error(`No se pudo restaurar ${nombre}:`, err.message);
    }
  });

  const imagenes = backup.imagenes || {};
  let imagenesOk = 0;
  if (Object.keys(imagenes).length > 0) {
    const carpeta = dataPath(CARPETA_IMAGENES);
    try {
      fs.mkdirSync(carpeta, { recursive: true });
      Object.keys(imagenes).forEach((nombre) => {
        // Sin subcarpetas ni rutas raras: solo el nombre del archivo.
        if (nombre.includes("/") || nombre.includes("\\") || nombre.includes("..")) return;
        fs.writeFileSync(path.join(carpeta, nombre), Buffer.from(imagenes[nombre], "base64"));
        imagenesOk++;
      });
    } catch (err) {
      console.error("No se pudieron restaurar las imágenes:", err.message);
    }
  }

  return { restaurados, imagenes: imagenesOk };
}

module.exports = { crear, restaurar, resumir, ARCHIVOS, MARCA, APP };
