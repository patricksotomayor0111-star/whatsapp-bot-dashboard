const { crearAlmacen } = require("./almacenPorUsuario");
const users = require("./users");
const { usuarioActual } = require("./contexto");

// Las semillas son la configuración con la que arrancó el dueño. Una
// cuenta nueva debe empezar vacía: si no, vería los pagos y las
// categorías (con sus montos) de otra persona.
function sembrarSoloAlDueno(semilla) {
  return usuarioActual() === users.DUENO_ID ? semilla : [];
}




// Categorías originales (orden de prioridad: la primera palabra clave que
// aparezca en la descripción gana, por eso "colegio" va antes que "mia").
// Solo se usan como semilla la primera vez; después, las categorías viven
// en budget-categories-data.json y son totalmente editables desde el panel
// (agregar, editar, eliminar).
const CATEGORIAS_SEMILLA = [
  { id: "colegio", label: "Colegio Mia", keywords: ["colegio"], tipo: "limite", limiteDefault: null },
  { id: "bueno", label: "Comida especial", keywords: ["bueno"], tipo: "limite", limiteDefault: 559 },
  { id: "frutas", label: "Frutas Mia", keywords: ["frutas"], tipo: "limite", limiteDefault: 60 },
  { id: "cuidado", label: "Cuidado Mia", keywords: ["cuidado", "mama"], tipo: "limite", limiteDefault: 600 },
  { id: "mia", label: "Mia gastos", keywords: ["mia"], tipo: "limite", limiteDefault: null },
  { id: "familia", label: "Salida familiar", keywords: ["familia", "salida"], tipo: "limite", limiteDefault: 430 },
  { id: "comida_diaria", label: "Comida diaria", keywords: ["almuerzo", "desayuno"], tipo: "limite", limiteDefault: 900 },
  { id: "servicios", label: "Servicios (luz/agua/netflix)", keywords: ["luz", "agua", "netflix"], tipo: "limite", limiteDefault: 120 },
  { id: "arce", label: "Cuota ARCE", keywords: ["arce"], tipo: "limite", limiteDefault: 116 },
  { id: "movistar", label: "Movistar internet", keywords: ["movistar", "internet"], tipo: "limite", limiteDefault: 46 },
  { id: "terreno", label: "Terreno", keywords: ["terreno"], tipo: "limite", limiteDefault: 500 },
  { id: "junta", label: "Junta", keywords: ["junta"], tipo: "meta", metaDefault: 13000, saldoInicialDefault: 4500 },
  { id: "cuzco", label: "Caja Cuzco", keywords: ["cuzco"], tipo: "meta", metaDefault: 5976, saldoInicialDefault: 0 },
  { id: "universidad", label: "Universidad", keywords: ["universidad"], tipo: "meta", metaDefault: 5200, saldoInicialDefault: 0 },
];
const CATEGORIA_OTROS = { id: "otros", label: "Otros", keywords: [], tipo: "limite", limiteDefault: null };


const almacen = crearAlmacen("budget-categories-data.json", function (parsed) {
  try {
    return {
      categorias: Array.isArray(parsed.categorias) && parsed.categorias.length ? parsed.categorias : sembrarSoloAlDueno(CATEGORIAS_SEMILLA.slice()),
      limits: parsed.limits || {},
      metas: parsed.metas || {},
    };
  } catch (err) {
    return { categorias: sembrarSoloAlDueno(CATEGORIAS_SEMILLA.slice()), limits: {}, metas: {} };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;


function getCategoriaDef(id) {
  if (id === "otros") return CATEGORIA_OTROS;
  return datos().categorias.find((c) => c.id === id) || null;
}

function getAllCategorias() {
  return [...datos().categorias, CATEGORIA_OTROS];
}

// Clasifica una descripción en una categoría según la primera palabra
// clave que matchee (en orden de prioridad). Si ninguna matchea, "Otros".
function categorize(descripcion) {
  const texto = String(descripcion || "").toLowerCase();
  for (const cat of datos().categorias) {
    if (cat.keywords.some((kw) => texto.includes(kw))) return cat.id;
  }
  return "otros";
}

// Categoría "de verdad" de un movimiento: si se le asignó una a mano desde
// el panel (y esa categoría todavía existe), esa gana; si no, se clasifica
// solo por palabras clave en la descripción.
function resolveCategoriaId(movimiento) {
  const manual = movimiento.categoriaId;
  if (manual && (manual === "otros" || datos().categorias.some((c) => c.id === manual))) return manual;
  return categorize(movimiento.descripcion);
}

function slugify(label) {
  const base = String(label || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "categoria";
}

function normalizarKeywords(keywords) {
  if (!Array.isArray(keywords)) return [];
  return keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean);
}

// Agrega una categoría nueva (id generado a partir del nombre, sin chocar
// con una existente ni con "otros").
// Un gasto puede ser del NEGOCIO (combustible, mantenimiento de la moto:
// lo que cuesta hacer los repartos) o PERSONAL (comida, ahorros, familia).
// Sin separarlos, la rentabilidad no se puede calcular: los ahorros y los
// gastos de casa se cuentan como si fueran costo de operar.
function ambitoValido(ambito) {
  return ambito === "negocio" ? "negocio" : "personal";
}

// El ámbito de una categoría; por defecto personal, que es lo más común.
function getAmbito(cat) {
  return ambitoValido(cat && cat.ambito);
}

function addCategoria({ label, keywords, tipo, ambito, limiteDefault, metaDefault, saldoInicialDefault }) {
  const nombre = String(label || "").trim();
  if (!nombre) throw new Error("El nombre de la categoría no puede estar vacío.");
  let id = slugify(nombre);
  let sufijo = 1;
  while (id === "otros" || datos().categorias.some((c) => c.id === id)) {
    id = `${slugify(nombre)}_${sufijo++}`;
  }
  const cat = {
    id,
    label: nombre,
    keywords: normalizarKeywords(keywords),
    tipo: tipo === "meta" ? "meta" : "limite",
    ambito: ambitoValido(ambito),
  };
  if (cat.tipo === "meta") {
    cat.metaDefault = Number(metaDefault) || 0;
    cat.saldoInicialDefault = Number(saldoInicialDefault) || 0;
  } else {
    cat.limiteDefault =
      limiteDefault === null || limiteDefault === undefined || limiteDefault === "" ? null : Number(limiteDefault);
  }
  datos().categorias.push(cat);
  save();
  return cat;
}

// Edita el nombre y/o las palabras clave de una categoría existente (no
// cambia su tipo ni su id, para no romper límites/metas ya guardados).
function editCategoria(id, cambios) {
  const cat = datos().categorias.find((c) => c.id === id);
  if (!cat) return null;
  if (cambios.label !== undefined && String(cambios.label).trim()) cat.label = String(cambios.label).trim();
  if (cambios.keywords !== undefined) cat.keywords = normalizarKeywords(cambios.keywords);
  if (cambios.ambito !== undefined) cat.ambito = ambitoValido(cambios.ambito);
  save();
  return cat;
}

// Elimina una categoría (y sus límites/metas guardados). "Otros" no se
// puede eliminar, es el cajón de sastre por defecto.
function removeCategoria(id) {
  if (id === "otros") return false;
  const antes = datos().categorias.length;
  datos().categorias = datos().categorias.filter((c) => c.id !== id);
  delete datos().limits[id];
  delete datos().metas[id];
  save();
  return datos().categorias.length < antes;
}

function getLimit(id) {
  if (Object.prototype.hasOwnProperty.call(datos().limits, id)) return datos().limits[id];
  const def = getCategoriaDef(id);
  return def ? def.limiteDefault : null;
}

function setLimit(id, valor) {
  if (!getCategoriaDef(id)) throw new Error("Categoría inválida: " + id);
  datos().limits[id] = valor === null || valor === "" || valor === undefined ? null : Number(valor);
  save();
}

function getMeta(id) {
  const def = getCategoriaDef(id);
  if (Object.prototype.hasOwnProperty.call(datos().metas, id)) {
    return { meta: datos().metas[id].meta, saldoInicial: datos().metas[id].saldoInicial };
  }
  return { meta: def?.metaDefault || 0, saldoInicial: def?.saldoInicialDefault || 0 };
}

function setMeta(id, meta, saldoInicial) {
  const def = getCategoriaDef(id);
  if (!def || def.tipo !== "meta") throw new Error("Categoría inválida o no es de tipo meta: " + id);
  datos().metas[id] = { meta: Number(meta) || 0, saldoInicial: Number(saldoInicial) || 0 };
  save();
}

// Arma el resumen de todas las categorías a partir del log de movimientos:
// para "limite" suma los gastos de ESTE MES; para "meta" suma TODOS los
// gastos históricos de esa categoría + el saldo inicial (lo que ya venía
// pagado antes de empezar a registrar).
function getResumen(movimientos, mesActualLabel) {
  const totalesMes = {};
  const totalesTotal = {};

  movimientos.forEach((m) => {
    if (m.tipo !== "gasto") return;
    const catId = resolveCategoriaId(m);
    totalesTotal[catId] = (totalesTotal[catId] || 0) + m.monto;
    if (m.fecha.slice(0, 7) === mesActualLabel) {
      totalesMes[catId] = (totalesMes[catId] || 0) + m.monto;
    }
  });

  return getAllCategorias().map((cat) => {
    if (cat.tipo === "meta") {
      const { meta, saldoInicial } = getMeta(cat.id);
      const pagado = saldoInicial + (totalesTotal[cat.id] || 0);
      return {
        id: cat.id,
        label: cat.label,
        tipo: "meta",
        keywords: cat.keywords || [],
        ambito: getAmbito(cat),
        meta,
        saldoInicial,
        pagado,
        restante: Math.max(meta - pagado, 0),
        porcentaje: meta > 0 ? Math.min(pagado / meta, 1) : 0,
      };
    }
    const limite = getLimit(cat.id);
    const gastado = totalesMes[cat.id] || 0;
    return {
      id: cat.id,
      label: cat.label,
      tipo: "limite",
      keywords: cat.keywords || [],
      ambito: getAmbito(cat),
      limite,
      gastado,
      disponible: limite === null ? null : Math.max(limite - gastado, 0),
      porcentaje: limite ? Math.min(gastado / limite, 1) : null,
    };
  });
}

// Lista los gastos que caen en una categoría (para el panel: "ver todo lo
// que está en Otros" y poder reasignarlos). Mismo alcance que getResumen:
// solo el mes actual para categorías de límite, histórico completo para
// las de meta. Cada movimiento trae su índice real dentro de
// cashbox.getMovimientos(), necesario para poder editarlo después.
function getMovimientosCategoria(movimientos, catId, mesActualLabel) {
  const def = getCategoriaDef(catId);
  const esMeta = def && def.tipo === "meta";
  return movimientos
    .map((m, index) => ({ ...m, index }))
    .filter((m) => m.tipo === "gasto")
    .filter((m) => resolveCategoriaId(m) === catId)
    .filter((m) => esMeta || m.fecha.slice(0, 7) === mesActualLabel)
    .reverse();
}

// Rentabilidad real del mes: separa los gastos que cuestan hacer los
// repartos (negocio) de los que son de casa o ahorro (personal). Sin esta
// separación el margen sale absurdo, porque guardar plata para el terreno
// se cuenta igual que cargar combustible.
function getRentabilidad(movimientos, mesLabel) {
  let ingresos = 0;
  let gastoNegocio = 0;
  let gastoPersonal = 0;
  let repartos = 0;

  movimientos.forEach((m) => {
    if (mesLabel && m.fecha.slice(0, 7) !== mesLabel) return;
    if (m.tipo === "ganancia") {
      ingresos += m.monto;
      repartos += 1;
      return;
    }
    if (m.tipo !== "gasto") return;
    const def = getCategoriaDef(resolveCategoriaId(m));
    if (getAmbito(def) === "negocio") gastoNegocio += m.monto;
    else gastoPersonal += m.monto;
  });

  const gananciaNeta = ingresos - gastoNegocio;
  return {
    ingresos: +ingresos.toFixed(2),
    gastoNegocio: +gastoNegocio.toFixed(2),
    gastoPersonal: +gastoPersonal.toFixed(2),
    gananciaNeta: +gananciaNeta.toFixed(2),
    margen: ingresos > 0 ? +((gananciaNeta / ingresos) * 100).toFixed(1) : 0,
    repartos,
    cobradoPorReparto: repartos ? +(ingresos / repartos).toFixed(2) : 0,
    costoPorReparto: repartos ? +(gastoNegocio / repartos).toFixed(2) : 0,
    netoPorReparto: repartos ? +(gananciaNeta / repartos).toFixed(2) : 0,
  };
}

module.exports = {
  SEMILLA_ORIGINAL: CATEGORIAS_SEMILLA,
  getAllCategorias,
  getCategoriaDef,
  getRentabilidad,
  categorize,
  resolveCategoriaId,
  getMovimientosCategoria,
  getLimit,
  setLimit,
  getMeta,
  setMeta,
  getResumen,
  addCategoria,
  editCategoria,
  removeCategoria,
};
