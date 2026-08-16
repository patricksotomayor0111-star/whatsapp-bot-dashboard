const { crearAlmacen } = require("./almacenPorUsuario");

const NOMBRES_BASE = ["yape", "plin", "sip", "efectivo"];


const almacen = crearAlmacen("reference-accounts-data.json", function (parsed) {
  try {
    return {
      nombres: Array.isArray(parsed.nombres) && parsed.nombres.length ? parsed.nombres : NOMBRES_BASE.slice(),
      entradas: parsed.entradas || [],
    };
  } catch (err) {
    return { nombres: NOMBRES_BASE.slice(), entradas: [] };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;


function peruAhora() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs - 5 * 3600000);
}

function fechaLabel(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dia}`;
}

function horaLabel(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function getNombres() {
  return datos().nombres;
}

function addNombre(nombre) {
  const n = String(nombre || "").trim().toLowerCase();
  if (n && !datos().nombres.includes(n)) {
    datos().nombres.push(n);
    save();
  }
}

function removeNombre(nombre) {
  const n = String(nombre || "").trim().toLowerCase();
  datos().nombres = datos().nombres.filter((x) => x !== n);
  save();
}

// Un mensaje es una nota de referencia si, después de sacarle el número, lo
// que queda es EXACTAMENTE uno de los nombres de cuenta configurados (ej.
// "416.14 yape" -> resto "yape"). Se recibe ya normalizado (sin tildes,
// en minúsculas).
function matchNombre(restoNorm) {
  const texto = String(restoNorm || "").trim();
  return datos().nombres.find((n) => texto === n) || null;
}

// Solo queda registrada como nota (fecha/hora/monto/descripción); no afecta
// caja ni ganancia.
function addEntrada(cuenta, monto, descripcion) {
  const ahora = peruAhora();
  datos().entradas.push({
    fecha: fechaLabel(ahora),
    hora: horaLabel(ahora),
    cuenta,
    monto,
    descripcion: descripcion || "",
  });
  save();
}

function getEntradas() {
  return datos().entradas;
}

function removeEntrada(index) {
  if (index >= 0 && index < datos().entradas.length) {
    datos().entradas.splice(index, 1);
    save();
  }
}

function editEntrada(index, cambios) {
  const entrada = datos().entradas[index];
  if (!entrada) return null;
  if (cambios.cuenta !== undefined) entrada.cuenta = cambios.cuenta;
  if (cambios.monto !== undefined) entrada.monto = Number(cambios.monto) || 0;
  if (cambios.descripcion !== undefined) entrada.descripcion = cambios.descripcion;
  if (cambios.fecha !== undefined) entrada.fecha = cambios.fecha;
  if (cambios.hora !== undefined) entrada.hora = cambios.hora;
  save();
  return entrada;
}

module.exports = {
  getNombres,
  addNombre,
  removeNombre,
  matchNombre,
  addEntrada,
  getEntradas,
  removeEntrada,
  editEntrada,
};
