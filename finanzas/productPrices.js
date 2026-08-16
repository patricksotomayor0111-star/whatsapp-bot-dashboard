const { crearAlmacen } = require("./almacenPorUsuario");


// Precios anotados a mano en el grupo "Precios general de productos", con
// el formato que ya venía usando el dueño:
//
//   6.00 grapas 5k unidades artesco sm x Huánuco
//   28 six pack Pilsen lata Salvatore
//    33 six pack Pilsen lata puerto rico Cutervo
//
// Primero el precio, después el producto y el lugar TODO junto y sin
// separador. A propósito NO se intenta partir producto/lugar: no hay forma
// confiable de saber dónde termina uno y empieza el otro ("six pack Pilsen
// lata Salvatore"), y tampoco hace falta — al consultar se devuelve la
// línea completa tal cual se escribió, que es lo que sirve para decidir a
// dónde ir a comprar.


const almacen = crearAlmacen("product-prices-data.json", function (parsed) {
  try {
    return { precios: Array.isArray(parsed.precios) ? parsed.precios : [] };
  } catch (err) {
    return { precios: [] };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;


// El id siguiente se calcula sobre los precios de la cuenta que está
// consultando. Antes era un contador global que se armaba al arrancar el
// servidor, lo que con varias cuentas habría hecho que una tomara ids
// pensados para otra.
function siguienteId() {
  return datos().precios.reduce((mayor, p) => Math.max(mayor, Number(p.id) || 0), 0) + 1;
}

// Quita tildes y pasa a minúsculas, para que "huánuco" y "huanuco"
// busquen igual.
const COMBINING_MARKS = new RegExp("[̀-ͯ]", "g");
function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .trim();
}

// Una línea de precio: número al inicio (con decimales y espacios de más
// opcionales) y el resto es la descripción. Devuelve null si no arranca
// con un precio, así el bot sabe que ese mensaje no era un registro.
function parsePriceLine(linea) {
  const m = String(linea || "").match(/^\s*(?:s\/\.?\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\s+(.{2,})$/i);
  if (!m) return null;
  const precio = Number(m[1].replace(",", "."));
  if (!Number.isFinite(precio) || precio <= 0) return null;
  const descripcion = m[2].trim().replace(/\s+/g, " ");
  if (!descripcion) return null;
  return { precio, descripcion };
}

// Si ya existe una entrada con la MISMA descripción, se actualiza su precio
// en vez de agregar otra. La descripción incluye el lugar ("six pack Pilsen
// lata Salvatore"), así que misma descripción = mismo producto en el mismo
// sitio: lo único que pudo cambiar es el precio. Sin esto, al reanotar algo
// que subió de precio quedarían las dos entradas y la consulta devolvería
// la vieja como "más barato", mandando a comprar a un precio que ya no es.
function add(precio, descripcion, extra = {}) {
  const clave = normalizar(descripcion);
  const existente = datos().precios.find((p) => normalizar(p.descripcion) === clave);
  if (existente) {
    existente.precio = precio;
    existente.descripcion = descripcion;
    existente.texto = `${precio} ${descripcion}`;
    existente.fecha = extra.fecha || new Date().toISOString();
    save();
    return existente;
  }

  const registro = {
    id: siguienteId(),
    precio,
    descripcion,
    texto: `${precio} ${descripcion}`,
    fecha: extra.fecha || new Date().toISOString(),
  };
  datos().precios.push(registro);
  save();
  return registro;
}

// Carga varias líneas de una (para el historial viejo que WhatsApp no le
// entrega al bot). Devuelve cuántas entraron y cuáles no se entendieron.
function addBulk(texto) {
  const lineas = String(texto || "").split(/\r?\n/);
  const agregados = [];
  const ignoradas = [];
  lineas.forEach((linea) => {
    if (!linea.trim()) return;
    const parsed = parsePriceLine(linea);
    if (!parsed) {
      ignoradas.push(linea.trim());
      return;
    }
    agregados.push(add(parsed.precio, parsed.descripcion));
  });
  return { agregados: agregados.length, ignoradas };
}

function getAll() {
  return datos().precios.slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

function remove(id) {
  const antes = datos().precios.length;
  datos().precios = datos().precios.filter((p) => p.id !== Number(id));
  if (datos().precios.length === antes) return false;
  save();
  return true;
}

// Conectores que sobran al buscar. Si no se quitan, preguntas naturales
// como "cuanto esta EL vino tabernero" fallan: se exigiría que la
// descripción contenga "el", que no lo tiene ninguna.
const PALABRAS_RELLENO = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "de", "del", "al", "en", "y", "o", "para", "por", "con",
  "es", "esta", "estan", "hay", "me", "mi", "que", "cual", "cuales",
]);

// Deja solo las palabras que sirven para buscar.
function palabrasBusqueda(terminos) {
  return normalizar(terminos)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !PALABRAS_RELLENO.has(w));
}

// Busca los precios cuya descripción contenga TODAS las palabras pedidas
// (en cualquier orden). Se busca sobre la descripción completa, así que
// también sirve buscar por el lugar ("salvatore" lista todo lo de ahí).
function buscar(terminos) {
  const palabras = palabrasBusqueda(terminos);
  if (palabras.length === 0) return [];
  return datos().precios
    .filter((p) => {
      const objetivo = normalizar(p.descripcion);
      return palabras.every((w) => objetivo.includes(w));
    })
    .sort((a, b) => a.precio - b.precio);
}

module.exports = { parsePriceLine, add, addBulk, getAll, remove, buscar, normalizar, palabrasBusqueda };
