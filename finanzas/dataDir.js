const fs = require("fs");
const path = require("path");

// En Railway el filesystem del contenedor es efímero: todo lo que se
// escribe se borra en cada redeploy (por eso había que reescanear el QR y
// restaurar la configuración a mano). Para que los datos sobrevivan —la
// sesión de WhatsApp, sectores, caja chica, presupuesto, notificaciones,
// etc.— se apunta a un volumen persistente montado por Railway, cuya ruta
// llega en la variable de entorno DATA_DIR. En local (sin DATA_DIR) se
// sigue usando la carpeta del propio proyecto, así que nada cambia al
// correrlo en la PC.
const DATA_DIR =
  process.env.DATA_DIR && process.env.DATA_DIR.trim()
    ? process.env.DATA_DIR.trim()
    : __dirname;

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  console.error("No se pudo crear el directorio de datos:", err.message);
}

// Devuelve la ruta completa de un archivo de datos dentro del directorio
// persistente (o del proyecto, en local).
function dataPath(nombre) {
  return path.join(DATA_DIR, nombre);
}

module.exports = { DATA_DIR, dataPath };
