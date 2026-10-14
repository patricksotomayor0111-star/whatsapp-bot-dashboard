const { crearAlmacen } = require("./almacenPorUsuario");
const { aCentavos, aTexto } = require("./documento");

// Catálogo de lo que vendes, para no tipear el nombre y el precio en cada
// documento. Escribes "coca" y sale "Coca Cola 500 ml — S/ 3.00"; solo
// pones la cantidad.
//
// Es distinto de productPrices.js, que anota precios de lo que COMPRAS en
// distintos locales (ahí la descripción incluye el lugar a propósito, para
// comparar dónde conviene ir). Esto es lo que VENDES, con un precio por
// producto.

const almacen = crearAlmacen("productos-data.json", function (parsed) {
  try {
    return { productos: Array.isArray(parsed.productos) ? parsed.productos : [] };
  } catch (err) {
    return { productos: [] };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;

const COMBINING_MARKS = new RegExp("[̀-ͯ]", "g");

// Sin tildes y en minúsculas, para que "panadería" y "panaderia" busquen
// igual. Nadie escribe tildes cuando está apurado en el mostrador.
function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function siguienteId() {
  return datos().productos.reduce((mayor, p) => Math.max(mayor, Number(p.id) || 0), 0) + 1;
}

function buscarPorNombre(nombre) {
  const clave = normalizar(nombre);
  return datos().productos.find((p) => normalizar(p.nombre) === clave) || null;
}

// Agregar un producto que ya existe ACTUALIZA su precio en vez de crear un
// duplicado. Si no, al reanotar algo que subió de precio quedarían los dos
// y el autocompletado ofrecería el viejo — que es justo el error que
// termina cobrándole de menos al cliente.
function agregar(nombre, precio, extra = {}) {
  const limpio = String(nombre || "").trim().replace(/\s+/g, " ");
  if (!limpio) throw new Error("El producto necesita un nombre.");

  const centavos = Math.max(0, aCentavos(precio));
  const existente = buscarPorNombre(limpio);
  if (existente) {
    // Solo se actualiza el precio, NO el nombre. Volver a cargar el
    // producto tipeando rápido ("coca cola 500 ML") no tiene por qué
    // pisar el nombre bien escrito que ya estaba en el catálogo. Para
    // corregir el nombre está actualizar(), que es explícito.
    existente.precio = centavos;
    if (extra.codigo !== undefined) existente.codigo = String(extra.codigo || "").trim();
    if (extra.unidad !== undefined) existente.unidad = String(extra.unidad || "").trim();
    existente.fecha = new Date().toISOString();
    save();
    return existente;
  }

  const producto = {
    id: siguienteId(),
    nombre: limpio,
    precio: centavos,
    codigo: String(extra.codigo || "").trim(),
    unidad: String(extra.unidad || "").trim(),
    // Cuántas veces se usó. Es lo que hace que el autocompletado ponga
    // arriba lo que más vendes en vez de lo que cargaste primero.
    usos: 0,
    fecha: new Date().toISOString(),
  };
  datos().productos.push(producto);
  save();
  return producto;
}

function actualizar(id, cambios = {}) {
  const producto = datos().productos.find((p) => p.id === Number(id));
  if (!producto) return null;
  if (cambios.nombre !== undefined) {
    const limpio = String(cambios.nombre).trim().replace(/\s+/g, " ");
    if (limpio) producto.nombre = limpio;
  }
  if (cambios.precio !== undefined) producto.precio = Math.max(0, aCentavos(cambios.precio));
  if (cambios.codigo !== undefined) producto.codigo = String(cambios.codigo || "").trim();
  if (cambios.unidad !== undefined) producto.unidad = String(cambios.unidad || "").trim();
  producto.fecha = new Date().toISOString();
  save();
  return producto;
}

function eliminar(id) {
  const antes = datos().productos.length;
  datos().productos = datos().productos.filter((p) => p.id !== Number(id));
  if (datos().productos.length === antes) return false;
  save();
  return true;
}

function listar() {
  return datos().productos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

// Para el lector de códigos de barras: acá sí se busca exacto.
function porCodigo(codigo) {
  const clave = normalizar(codigo);
  if (!clave) return null;
  return datos().productos.find((p) => normalizar(p.codigo) === clave) || null;
}

// ---------- Autocompletado ----------
//
// El puntaje ordena por qué tan "al principio" cae lo que escribiste. Con
// pocas letras lo que importa es el arranque del nombre: escribiendo "pan"
// se espera "Pan francés" antes que "Queso para pan", aunque los dos
// contengan "pan".
function puntaje(producto, consulta) {
  const nombre = normalizar(producto.nombre);
  const q = normalizar(consulta);
  if (!q) return 0;

  if (normalizar(producto.codigo) && normalizar(producto.codigo) === q) return 1000;
  if (nombre === q) return 900;
  if (nombre.startsWith(q)) return 700;

  const palabras = nombre.split(" ");
  if (palabras.some((p) => p.startsWith(q))) return 500;
  if (nombre.includes(q)) return 300;

  // Varias palabras sueltas: "coca 500" tiene que encontrar
  // "Coca Cola 500 ml" aunque no sean consecutivas.
  const terminos = q.split(" ").filter(Boolean);
  if (terminos.length > 1 && terminos.every((t) => palabras.some((p) => p.startsWith(t)))) return 200;

  return 0;
}

// Lo que alimenta la lista que aparece mientras escribes.
function sugerir(texto, limite = 8) {
  const q = normalizar(texto);
  const productos = datos().productos;

  // Sin nada escrito se ofrece lo más usado: al abrir un documento nuevo
  // lo más probable es que vendas otra vez lo de siempre.
  if (!q) {
    return productos
      .slice()
      .sort((a, b) => (b.usos || 0) - (a.usos || 0) || a.nombre.localeCompare(b.nombre, "es"))
      .slice(0, limite);
  }

  return productos
    .map((p) => ({ producto: p, pts: puntaje(p, q) }))
    .filter((x) => x.pts > 0)
    .sort((a, b) =>
      b.pts - a.pts ||
      (b.producto.usos || 0) - (a.producto.usos || 0) ||
      a.producto.nombre.localeCompare(b.producto.nombre, "es"))
    .slice(0, limite)
    .map((x) => x.producto);
}

// Se llama al meter el producto en un documento, no al escribirlo: lo que
// interesa contar son las ventas, no las veces que apareció en una lista.
function registrarUso(id) {
  const producto = datos().productos.find((p) => p.id === Number(id));
  if (!producto) return null;
  producto.usos = (producto.usos || 0) + 1;
  producto.ultimoUso = new Date().toISOString();
  save();
  return producto;
}

// Convierte un producto del catálogo en un ítem de documento. El precio se
// copia, no se referencia: si mañana subes el precio, los documentos ya
// emitidos tienen que seguir diciendo lo que se cobró ese día.
function aItem(producto, cantidad = 1) {
  return {
    descripcion: producto.nombre,
    cantidad: Number(cantidad) || 1,
    precioUnitario: aTexto(producto.precio),
  };
}

// ---------- Importar ----------

// Una línea de una lista pegada. Se aceptan los dos órdenes porque la
// gente escribe de las dos formas: "Coca Cola 3.00" y "3.00 Coca Cola"
// (esta última es la que ya venías usando para anotar precios).
function parseLinea(linea) {
  const texto = String(linea || "").replace(/\s+/g, " ").trim();
  if (!texto) return null;

  const precioAlInicio = texto.match(/^(?:s\/\.?\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\s+(.{2,})$/i);
  if (precioAlInicio) {
    return { nombre: precioAlInicio[2].trim(), precio: precioAlInicio[1] };
  }

  const precioAlFinal = texto.match(/^(.{2,}?)[\s|,;\t]+(?:s\/\.?\s*)?(\d{1,6}(?:[.,]\d{1,2})?)$/i);
  if (precioAlFinal) {
    return { nombre: precioAlFinal[1].replace(/[|,;\t]+$/, "").trim(), precio: precioAlFinal[2] };
  }

  return null;
}

// Carga una lista pegada de golpe. Devuelve qué entró y qué no se entendió,
// para poder mostrarlo y corregir a mano solo esas líneas.
function importarTexto(texto) {
  const agregados = [];
  const ignoradas = [];
  String(texto || "").split(/\r?\n/).forEach((linea) => {
    if (!linea.trim()) return;
    const parsed = parseLinea(linea);
    if (!parsed) {
      ignoradas.push(linea.trim());
      return;
    }
    agregados.push(agregar(parsed.nombre, parsed.precio));
  });
  return { agregados: agregados.length, ignoradas };
}

module.exports = {
  normalizar,
  agregar,
  actualizar,
  eliminar,
  listar,
  porCodigo,
  puntaje,
  sugerir,
  registrarUso,
  aItem,
  parseLinea,
  importarTexto,
};
