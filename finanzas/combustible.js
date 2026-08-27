const { crearAlmacen } = require("./almacenPorUsuario");

// Cuanto genera por cada sol de gasolina. Para un delivery es el numero
// que dice si el trabajo esta rindiendo: si baja, o la moto anda mal o
// esta agarrando pedidos muy lejos para lo que pagan.
//
// No hay categoria de gasolina en el presupuesto (esos gastos caen en
// "otros"), asi que se reconoce por palabra en la descripcion. La lista
// es editable porque cada uno le dice distinto: grifo, petroleo, gas.
const PALABRAS_BASE = ["gasolina", "combustible", "grifo", "petroleo", "gas"];

const almacen = crearAlmacen("combustible-data.json", function (parsed) {
  try {
    return {
      palabras: Array.isArray(parsed.palabras) && parsed.palabras.length ? parsed.palabras : PALABRAS_BASE.slice(),
    };
  } catch (err) {
    return { palabras: PALABRAS_BASE.slice() };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;

const COMBINING_MARKS = new RegExp("[\u0300-\u036f]", "g");
function normalizar(texto) {
  return String(texto || "").normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

function getPalabras() {
  return datos().palabras.slice();
}

function addPalabra(palabra) {
  const p = normalizar(palabra).trim();
  if (!p) throw new Error("Escribe una palabra.");
  if (!datos().palabras.includes(p)) {
    datos().palabras.push(p);
    save();
  }
  return getPalabras();
}

function removePalabra(palabra) {
  const p = normalizar(palabra).trim();
  datos().palabras = datos().palabras.filter((x) => x !== p);
  save();
  return getPalabras();
}

// Por palabra completa, para que "gas" no matchee dentro de "gaseosa".
function esCombustible(descripcion) {
  const palabras = normalizar(descripcion).split(/[^a-z0-9]+/).filter(Boolean);
  return datos().palabras.some((p) => palabras.includes(p));
}

// Lo generado y lo gastado en combustible dentro de un rango de fechas.
function getRendimiento(movimientos, desde, hasta) {
  let combustible = 0;
  let ganancias = 0;
  let repartos = 0;
  const cargas = [];

  (movimientos || []).forEach((m) => {
    if (!m.fecha || m.fecha < desde || m.fecha > hasta) return;
    if (m.tipo === "ganancia") {
      ganancias += m.monto || 0;
      repartos += 1;
      return;
    }
    if (m.tipo !== "gasto") return;
    if (!esCombustible(m.descripcion)) return;
    combustible += m.monto || 0;
    cargas.push({ fecha: m.fecha, hora: m.hora, monto: m.monto, descripcion: m.descripcion });
  });

  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    desde,
    hasta,
    combustible: r2(combustible),
    ganancias: r2(ganancias),
    repartos,
    // Cuanto genera por cada sol de gasolina. Sin gasto no se puede
    // calcular: se devuelve null y el panel lo dice, en vez de mostrar 0
    // o infinito como si fuera un dato real.
    porSol: combustible > 0 ? r2(ganancias / combustible) : null,
    porReparto: repartos > 0 ? r2(combustible / repartos) : null,
    cargas,
  };
}

module.exports = { getPalabras, addPalabra, removePalabra, esCombustible, getRendimiento };
