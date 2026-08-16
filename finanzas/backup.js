const fs = require("fs");
const { userDataPath } = require("./dataDir");
const { usuarioActual } = require("./contexto");

// El respaldo es de la cuenta que lo pide: cada una guarda y restaura lo
// suyo. Antes leía los archivos sueltos de la raíz, que con varias cuentas
// habría significado que cualquiera se bajara los datos del dueño.
function dataPath(nombre) {
  return userDataPath(usuarioActual(), nombre);
}

// Respaldo de los datos de FINANZAS: caja chica, deudas, metas, precios y
// demás. Es el respaldo más importante de los dos, porque acá vive el
// historial de plata (no se puede rehacer de memoria).
//
// NO entra session/ a propósito: son las credenciales de WhatsApp del
// número secundario. Si el archivo se filtrara, cualquiera podría entrar.
// El QR se vuelve a escanear y listo.
const ARCHIVOS = [
  "cashbox-data.json", // caja chica: el historial de ganancias y gastos
  "product-prices-data.json", // precios de productos
  "reminders-data.json", // pagos pendientes
  "debts-data.json", // deudas por cobrar
  "shortfalls-data.json", // faltantes
  "reference-accounts-data.json", // cuentas de referencia
  "finance-goals-data.json", // metas de ganancia
  "budget-categories-data.json", // categorías de presupuesto
  "production-goals-data.json", // metas de producción
  "scheduled-expenses-data.json", // gastos programados
  "query-intents-data.json", // frases de consulta configurables
  "tasks-data.json", // tareas
  "push-data.json", // dispositivos suscritos a notificaciones
];

const MARCA = "whatsapp-bot-backup";
const APP = "finanzas";

function leerArchivo(nombre) {
  try {
    return JSON.parse(fs.readFileSync(dataPath(nombre), "utf8"));
  } catch (err) {
    return null; // no existe todavía: no es un error
  }
}

function crear() {
  const archivos = {};
  ARCHIVOS.forEach((nombre) => {
    const contenido = leerArchivo(nombre);
    if (contenido !== null) archivos[nombre] = contenido;
  });
  return { marca: MARCA, app: APP, version: 1, fecha: new Date().toISOString(), archivos };
}

function resumir(backup) {
  const archivos = backup?.archivos || {};
  const caja = archivos["cashbox-data.json"] || {};
  return {
    fecha: backup?.fecha || null,
    archivos: Object.keys(archivos).length,
    diasCerrados: (caja.cierres || []).length,
    movimientos: (caja.movimientos || []).length,
    precios: (archivos["product-prices-data.json"]?.precios || []).length,
  };
}

function restaurar(backup) {
  if (!backup || backup.marca !== MARCA) {
    throw new Error("Ese archivo no es un respaldo de este bot.");
  }
  if (backup.app !== APP) {
    throw new Error(`Ese respaldo es de "${backup.app}", no de finanzas.`);
  }
  const archivos = backup.archivos || {};
  const restaurados = [];
  Object.keys(archivos).forEach((nombre) => {
    // Solo nombres conocidos: un archivo manipulado no puede escribir en
    // cualquier lado del disco.
    if (!ARCHIVOS.includes(nombre)) return;
    try {
      fs.writeFileSync(dataPath(nombre), JSON.stringify(archivos[nombre], null, 2));
      restaurados.push(nombre);
    } catch (err) {
      console.error(`No se pudo restaurar ${nombre}:`, err.message);
    }
  });
  return { restaurados, imagenes: 0 };
}

module.exports = { crear, restaurar, resumir, ARCHIVOS, MARCA, APP };
