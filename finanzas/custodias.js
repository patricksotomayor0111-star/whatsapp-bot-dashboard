const { crearAlmacen } = require("./almacenPorUsuario");
const businessDay = require("./businessDay");

// Plata de OTRA persona que uno guarda: cuánto dejó, cuánto gastó de eso
// y cuánto queda en tu poder. No es tuya, así que no entra a la caja.
//
// Antes esto existía para una sola persona ("Ana") escrita a mano en el
// código, así que cualquier cliente de la app veía una pestaña con el
// nombre de una desconocida. Ahora cada cuenta arma su propia lista.
//
// El bot solo reconoce a las personas dadas de alta acá: si aceptara
// cualquier palabra antes de "guardo", una línea como "50 plata guardo"
// crearía una persona llamada "plata".
const almacen = crearAlmacen("custodias-data.json", function (parsed) {
  try {
    return { personas: parsed.personas && typeof parsed.personas === "object" ? parsed.personas : {} };
  } catch (err) {
    return { personas: {} };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;

const COMBINING_MARKS = new RegExp("[̀-ͯ]", "g");
function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .trim();
}

function claveDe(nombre) {
  return normalizar(nombre).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function getPersonas() {
  return Object.entries(datos().personas).map(([clave, p]) => ({
    clave,
    label: p.label,
    guardado: +(p.guardado || 0).toFixed(2),
    gastado: +(p.gastado || 0).toFixed(2),
    saldo: +((p.guardado || 0) - (p.gastado || 0)).toFixed(2),
    movimientos: (p.movimientos || []).length,
  }));
}

function addPersona(nombre) {
  const label = String(nombre || "").trim();
  if (!label) throw new Error("Ponle un nombre a la persona.");
  const clave = claveDe(label);
  if (!clave) throw new Error("Ese nombre no sirve como identificador.");
  if (datos().personas[clave]) throw new Error("Ya tienes a alguien con ese nombre.");
  datos().personas[clave] = { label, guardado: 0, gastado: 0, movimientos: [] };
  save();
  return { clave, label };
}

function editPersona(clave, nombre) {
  const p = datos().personas[clave];
  if (!p) return null;
  const label = String(nombre || "").trim();
  if (label) p.label = label;
  save();
  return p;
}

// Se borra a la persona con todo su historial: es su plata, no queda nada
// que reconciliar del lado de la caja.
function removePersona(clave) {
  delete datos().personas[clave];
  save();
}

// A qué persona se refiere un texto ("30 mama guardo" -> mama). Devuelve
// la clave o null. Se busca por palabra completa para que un nombre corto
// no matchee por casualidad dentro de otra palabra.
function personaEnTexto(texto) {
  const palabras = normalizar(texto).split(/[^a-z0-9]+/).filter(Boolean);
  for (const [clave, p] of Object.entries(datos().personas)) {
    const partes = normalizar(p.label).split(/[^a-z0-9]+/).filter(Boolean);
    if (partes.length && partes.every((parte) => palabras.includes(parte))) return clave;
  }
  return null;
}

function registrar(clave, tipo, monto, descripcion) {
  const p = datos().personas[clave];
  if (!p) return null;
  const ahora = businessDay.peruAhora();
  if (tipo === "guardo") p.guardado += monto;
  else p.gastado += monto;
  p.movimientos.push({
    fecha: businessDay.businessDayLabel(),
    hora: businessDay.horaLabel(ahora),
    tipo,
    monto,
    descripcion: descripcion || "",
  });
  save();
  return p;
}

function getMovimientos(clave) {
  const p = datos().personas[clave];
  return p ? p.movimientos : [];
}

function efectoDelta(tipo, monto, signo) {
  return tipo === "guardo" ? { g: signo * monto, gs: 0 } : { g: 0, gs: signo * monto };
}

function editMovimiento(clave, indice, cambios) {
  const p = datos().personas[clave];
  if (!p || !p.movimientos[indice]) return null;
  const mov = p.movimientos[indice];

  const viejo = efectoDelta(mov.tipo, mov.monto, -1);
  p.guardado += viejo.g;
  p.gastado += viejo.gs;

  if (cambios.tipo !== undefined) mov.tipo = cambios.tipo === "guardo" ? "guardo" : "gasto";
  if (cambios.monto !== undefined) mov.monto = Number(cambios.monto) || 0;
  if (cambios.descripcion !== undefined) mov.descripcion = cambios.descripcion;

  const nuevo = efectoDelta(mov.tipo, mov.monto, 1);
  p.guardado += nuevo.g;
  p.gastado += nuevo.gs;

  save();
  return mov;
}

function removeMovimiento(clave, indice) {
  const p = datos().personas[clave];
  if (!p || !p.movimientos[indice]) return false;
  const mov = p.movimientos[indice];
  const efecto = efectoDelta(mov.tipo, mov.monto, -1);
  p.guardado += efecto.g;
  p.gastado += efecto.gs;
  p.movimientos.splice(indice, 1);
  save();
  return true;
}

// Trae lo que estaba guardado como "Ana" en la caja (cuando esto era de
// una sola persona fija) a la lista nueva, para no perder ese historial.
// Solo corre si esa cuenta tiene algo de Ana y todavía no tiene personas.
function migrarDesdeAna({ guardado, gastado, movimientos }) {
  if (Object.keys(datos().personas).length > 0) return false;
  if (!guardado && !gastado && (!movimientos || movimientos.length === 0)) return false;
  datos().personas.ana = {
    label: "Ana",
    guardado: guardado || 0,
    gastado: gastado || 0,
    movimientos: (movimientos || []).map((m) => ({
      fecha: m.fecha,
      hora: m.hora,
      tipo: m.tipo === "ana_guardo" || m.tipo === "guardo" ? "guardo" : "gasto",
      monto: m.monto,
      descripcion: m.descripcion || "",
    })),
  };
  save();
  return true;
}

module.exports = {
  getPersonas,
  addPersona,
  editPersona,
  removePersona,
  personaEnTexto,
  registrar,
  getMovimientos,
  editMovimiento,
  removeMovimiento,
  migrarDesdeAna,
};
