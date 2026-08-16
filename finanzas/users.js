const fs = require("fs");
const crypto = require("crypto");
const { dataPath, migrarADueño } = require("./dataDir");

const DATA_PATH = dataPath("users-data.json");

// Archivos que hasta ahora vivían sueltos en la raíz del volumen y pasan a
// ser de la cuenta del dueño. La sesión de WhatsApp NO está en la lista:
// en esta fase el bot sigue siendo uno solo, atado al dueño, y se maneja
// aparte.
const ARCHIVOS_DE_CUENTA = [
  "cashbox-data.json",
  "debts-data.json",
  "shortfalls-data.json",
  "reference-accounts-data.json",
  "finance-goals-data.json",
  "budget-categories-data.json",
  "production-goals-data.json",
  "scheduled-expenses-data.json",
  "query-intents-data.json",
  "reminders-data.json",
  "tasks-data.json",
  "locales-data.json",
  "product-prices-data.json",
  "push-data.json",
];

// El dueño es la cuenta que ya existía antes de que esto fuera
// multiusuario: es la que se queda con los datos actuales y con el bot.
const DUENO_ID = "patrick";

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    return { usuarios: Array.isArray(parsed.usuarios) ? parsed.usuarios : [] };
  } catch (err) {
    return { usuarios: [] };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar users-data.json:", err.message);
  }
}

// scrypt viene con Node, así que no hace falta agregar una dependencia
// para guardar contraseñas como corresponde (nunca en texto plano).
function hashear(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function crearHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return { salt, hash: hashear(password, salt) };
}

function passwordCorrecta(usuario, intento) {
  if (!usuario || !usuario.hash || !usuario.salt) return false;
  const calculado = Buffer.from(hashear(intento || "", usuario.salt));
  const guardado = Buffer.from(usuario.hash);
  if (calculado.length !== guardado.length) return false;
  return crypto.timingSafeEqual(calculado, guardado);
}

function getById(id) {
  return data.usuarios.find((u) => u.id === id) || null;
}

function getByUsuario(nombreUsuario) {
  const clave = String(nombreUsuario || "").trim().toLowerCase();
  return data.usuarios.find((u) => u.usuario === clave) || null;
}

// Lista para administrar; nunca sale el hash ni la sal.
function getAll() {
  return data.usuarios.map((u) => ({
    id: u.id,
    usuario: u.usuario,
    nombre: u.nombre,
    esDueno: u.id === DUENO_ID,
    activo: u.activo !== false,
    creado: u.creado,
  }));
}

function slugify(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function addUsuario({ usuario, nombre, password }) {
  const clave = slugify(usuario);
  if (!clave) throw new Error("El usuario no puede estar vacío.");
  if (String(password || "").length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
  if (getByUsuario(clave)) throw new Error("Ya existe un usuario con ese nombre.");

  const { salt, hash } = crearHash(password);
  const nuevo = {
    id: clave,
    usuario: clave,
    nombre: String(nombre || usuario).trim(),
    salt,
    hash,
    activo: true,
    creado: new Date().toISOString(),
  };
  data.usuarios.push(nuevo);
  save();
  return { id: nuevo.id, usuario: nuevo.usuario, nombre: nuevo.nombre };
}

function cambiarPassword(id, password) {
  const u = getById(id);
  if (!u) return null;
  if (String(password || "").length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
  const { salt, hash } = crearHash(password);
  u.salt = salt;
  u.hash = hash;
  save();
  return true;
}

function setActivo(id, activo) {
  const u = getById(id);
  if (!u) return null;
  if (id === DUENO_ID) throw new Error("No se puede desactivar la cuenta del dueño.");
  u.activo = !!activo;
  save();
  return true;
}

function removeUsuario(id) {
  if (id === DUENO_ID) throw new Error("No se puede eliminar la cuenta del dueño.");
  const antes = data.usuarios.length;
  data.usuarios = data.usuarios.filter((u) => u.id !== id);
  if (data.usuarios.length !== antes) save();
  // La carpeta de datos NO se borra a propósito: si se elimina una cuenta
  // por error, su información sigue ahí para poder recuperarla.
}

// Primera vez que arranca con multiusuario: crea la cuenta del dueño con
// la contraseña que ya venía por variable de entorno y le pasa los datos
// que hoy están sueltos, para que no tenga que reconfigurar nada.
function asegurarDueno() {
  if (getById(DUENO_ID)) return getById(DUENO_ID);

  const passwordInicial = (process.env.PANEL_PASSWORD || "").trim();
  if (!passwordInicial) {
    console.error("No se puede crear la cuenta del dueño: falta PANEL_PASSWORD.");
    return null;
  }

  const { salt, hash } = crearHash(passwordInicial);
  data.usuarios.push({
    id: DUENO_ID,
    usuario: DUENO_ID,
    nombre: "Patrick",
    salt,
    hash,
    activo: true,
    creado: new Date().toISOString(),
  });
  save();
  migrarADueño(DUENO_ID, ARCHIVOS_DE_CUENTA);
  console.log(`Cuenta del dueño "${DUENO_ID}" creada con la contraseña de PANEL_PASSWORD.`);
  return getById(DUENO_ID);
}

module.exports = {
  DUENO_ID,
  ARCHIVOS_DE_CUENTA,
  asegurarDueno,
  getById,
  getByUsuario,
  getAll,
  addUsuario,
  cambiarPassword,
  setActivo,
  removeUsuario,
  passwordCorrecta,
};
