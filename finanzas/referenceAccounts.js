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

// Un mensaje es una nota de referencia si NOMBRA una de las cuentas
// configuradas en cualquier parte de la frase: al inicio, en medio o al
// final. Son anotaciones, no movimientos, asi que no tocan la caja.
//
// Antes se exigia que despues del numero quedara EXACTAMENTE el nombre.
// Con eso "345.45 yape" andaba, pero "345.45 - 454.55 yape" no calzaba y
// el bot se quedaba con el primer numero y lo sumaba como ganancia.
//
// Se compara por palabra completa para que "yapeando" o "efectivamente"
// no disparen por casualidad. Los nombres de varias palabras tienen que
// aparecer seguidos y en orden.
function matchNombre(restoNorm) {
  const palabras = String(restoNorm || "").split(/[^a-z0-9]+/).filter(Boolean);
  return (
    datos().nombres.find((n) => {
      const partes = String(n).split(/[^a-z0-9]+/).filter(Boolean);
      if (!partes.length) return false;
      return palabras.some((_, i) => partes.every((p, j) => palabras[i + j] === p));
    }) || null
  );
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
