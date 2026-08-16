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
// persistente (o del proyecto, en local). Se usa para lo que es GLOBAL a
// toda la instalación: el registro de usuarios y poco más.
function dataPath(nombre) {
  return path.join(DATA_DIR, nombre);
}

// ---------- Datos por cuenta ----------
// Cada usuario tiene su propia carpeta bajo "users/", así una cuenta no
// puede leer ni pisar los datos de otra ni por error de programación.
const USERS_DIR = path.join(DATA_DIR, "users");

function carpetaDe(userId) {
  if (!userId || /[^a-zA-Z0-9_-]/.test(userId)) {
    // El id va directo al filesystem: si dejara pasar barras o puntos,
    // un id armado a mano podría salirse de su carpeta.
    throw new Error("Id de usuario inválido: " + userId);
  }
  const carpeta = path.join(USERS_DIR, userId);
  fs.mkdirSync(carpeta, { recursive: true });
  return carpeta;
}

function userDataPath(userId, nombre) {
  return path.join(carpetaDe(userId), nombre);
}

// Pasa los datos que hoy viven sueltos en la raíz del volumen a la carpeta
// del dueño. Se COPIA, no se mueve: si hubiera que volver atrás, los
// archivos originales siguen donde estaban y el sistema viejo los
// encuentra igual. Solo copia lo que todavía no exista en destino, así
// correrlo de nuevo nunca pisa datos más nuevos.
function migrarADueño(userId, archivos) {
  const copiados = [];
  archivos.forEach((nombre) => {
    const origen = path.join(DATA_DIR, nombre);
    const destino = userDataPath(userId, nombre);
    try {
      if (!fs.existsSync(origen) || fs.existsSync(destino)) return;
      fs.copyFileSync(origen, destino);
      copiados.push(nombre);
    } catch (err) {
      console.error(`No se pudo migrar ${nombre}:`, err.message);
    }
  });
  if (copiados.length) {
    console.log(`Datos migrados a la cuenta "${userId}": ${copiados.join(", ")}`);
  }
  return copiados;
}

module.exports = { DATA_DIR, dataPath, userDataPath, migrarADueño };
