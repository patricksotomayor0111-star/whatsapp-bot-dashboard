const { crearAlmacen } = require("./almacenPorUsuario");

// Los datos del negocio que emite: nombre, RUC, dirección, teléfono, y la
// numeración de los documentos.
//
// Van acá y NO salen de la foto. Son los mismos en todos los documentos,
// así que leerlos de una imagen cada vez es pagar por releer lo mismo y
// arriesgarse a que un RUC borroso entre con un dígito cambiado. Se
// escriben una vez y ya.

const almacen = crearAlmacen("negocio-data.json", function (parsed) {
  const p = parsed || {};
  return {
    nombre: String(p.nombre || ""),
    ruc: String(p.ruc || ""),
    direccion: String(p.direccion || ""),
    telefono: String(p.telefono || ""),
    pie: p.pie === undefined ? "¡Gracias por su compra!" : String(p.pie),
    serie: String(p.serie || "NV001"),
    // El próximo número a usar. Arranca en 1 y solo avanza cuando se
    // emite de verdad.
    correlativo: Number(p.correlativo) > 0 ? Number(p.correlativo) : 1,
    impresora: String(p.impresora || "pos-8001dd"),
  };
});
const datos = almacen.datos;
const save = almacen.guardar;

// La serie de un talonario es letras y números, nada más. Si se cuela un
// espacio o un guión, el número impreso queda con doble separador
// ("NV 001--000123") y se ve a la legua que lo armó un programa.
function limpiarSerie(texto) {
  return String(texto || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "NV001";
}

function get() {
  return { ...datos() };
}

function set(cambios = {}) {
  const d = datos();
  if (cambios.nombre !== undefined) d.nombre = String(cambios.nombre).trim();
  // Del RUC se guardan solo los dígitos: la gente lo escribe con guiones y
  // espacios de todas las formas posibles.
  if (cambios.ruc !== undefined) d.ruc = String(cambios.ruc).replace(/\D/g, "").slice(0, 11);
  if (cambios.direccion !== undefined) d.direccion = String(cambios.direccion).trim();
  if (cambios.telefono !== undefined) d.telefono = String(cambios.telefono).trim();
  if (cambios.pie !== undefined) d.pie = String(cambios.pie).trim();
  if (cambios.serie !== undefined) d.serie = limpiarSerie(cambios.serie);
  if (cambios.impresora !== undefined) d.impresora = String(cambios.impresora).trim();
  if (cambios.correlativo !== undefined) {
    const n = Math.floor(Number(cambios.correlativo));
    if (Number.isFinite(n) && n > 0) d.correlativo = n;
  }
  save();
  return get();
}

// "NV001-000123". Seis dígitos es lo que usa todo el mundo acá.
function formatearNumero(serie, correlativo) {
  return `${limpiarSerie(serie)}-${String(Math.max(1, correlativo)).padStart(6, "0")}`;
}

// El número que le tocaría al próximo documento, SIN gastarlo. Es el que
// se muestra mientras se arma y en la vista previa.
function proximoNumero() {
  const d = datos();
  return formatearNumero(d.serie, d.correlativo);
}

// Gasta el número. Se llama al EMITIR, no al previsualizar: si avanzara en
// cada previa, abrir la pantalla y cerrarla quemaría correlativos y el
// talonario quedaría con huecos que después hay que explicar.
function consumirNumero() {
  const d = datos();
  const numero = formatearNumero(d.serie, d.correlativo);
  d.correlativo += 1;
  save();
  return numero;
}

// Los datos del negocio con la forma que espera documento.js.
function comoEmisor() {
  const d = datos();
  return { nombre: d.nombre, ruc: d.ruc, direccion: d.direccion, telefono: d.telefono };
}

// Qué le falta al perfil para que el documento salga presentable. No
// bloquea nada: se puede imprimir sin RUC, y de hecho muchos lo hacen.
function revisar() {
  const d = datos();
  const avisos = [];
  if (!d.nombre) avisos.push({ campo: "nombre", nivel: "alerta", mensaje: "Falta el nombre del negocio." });
  if (d.ruc && d.ruc.length !== 11) {
    avisos.push({ campo: "ruc", nivel: "alerta", mensaje: "El RUC debe tener 11 dígitos." });
  }
  return avisos;
}

module.exports = {
  get, set, formatearNumero, proximoNumero, consumirNumero,
  comoEmisor, revisar, limpiarSerie,
};
