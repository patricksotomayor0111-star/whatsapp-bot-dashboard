const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("budget-categories-data.json");

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

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      categorias: Array.isArray(parsed.categorias) && parsed.categorias.length ? parsed.categorias : CATEGORIAS_SEMILLA.slice(),
      limits: parsed.limits || {},
      metas: parsed.metas || {},
    };
  } catch (err) {
    return { categorias: CATEGORIAS_SEMILLA.slice(), limits: {}, metas: {} };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar budget-categories-data.json:", err.message);
  }
}

function getCategoriaDef(id) {
  if (id === "otros") return CATEGORIA_OTROS;
  return data.categorias.find((c) => c.id === id) || null;
}

function getAllCategorias() {
  return [...data.categorias, CATEGORIA_OTROS];
}

// Clasifica una descripción en una categoría según la primera palabra
// clave que matchee (en orden de prioridad). Si ninguna matchea, "Otros".
function categorize(descripcion) {
  const texto = String(descripcion || "").toLowerCase();
  for (const cat of data.categorias) {
    if (cat.keywords.some((kw) => texto.includes(kw))) return cat.id;
  }
  return "otros";
}

// Categoría "de verdad" de un movimiento: si se le asignó una a mano desde
// el panel (y esa categoría todavía existe), esa gana; si no, se clasifica
// solo por palabras clave en la descripción.
function resolveCategoriaId(movimiento) {
  const manual = movimiento.categoriaId;
  if (manual && (manual === "otros" || data.categorias.some((c) => c.id === manual))) return manual;
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
function addCategoria({ label, keywords, tipo, limiteDefault, metaDefault, saldoInicialDefault }) {
  const nombre = String(label || "").trim();
  if (!nombre) throw new Error("El nombre de la categoría no puede estar vacío.");
  let id = slugify(nombre);
  let sufijo = 1;
  while (id === "otros" || data.categorias.some((c) => c.id === id)) {
    id = `${slugify(nombre)}_${sufijo++}`;
  }
  const cat = {
    id,
    label: nombre,
    keywords: normalizarKeywords(keywords),
    tipo: tipo === "meta" ? "meta" : "limite",
  };
  if (cat.tipo === "meta") {
    cat.metaDefault = Number(metaDefault) || 0;
    cat.saldoInicialDefault = Number(saldoInicialDefault) || 0;
  } else {
    cat.limiteDefault =
      limiteDefault === null || limiteDefault === undefined || limiteDefault === "" ? null : Number(limiteDefault);
  }
  data.categorias.push(cat);
  save();
  return cat;
}

// Edita el nombre y/o las palabras clave de una categoría existente (no
// cambia su tipo ni su id, para no romper límites/metas ya guardados).
function editCategoria(id, cambios) {
  const cat = data.categorias.find((c) => c.id === id);
  if (!cat) return null;
  if (cambios.label !== undefined && String(cambios.label).trim()) cat.label = String(cambios.label).trim();
  if (cambios.keywords !== undefined) cat.keywords = normalizarKeywords(cambios.keywords);
  save();
  return cat;
}

// Elimina una categoría (y sus límites/metas guardados). "Otros" no se
// puede eliminar, es el cajón de sastre por defecto.
function removeCategoria(id) {
  if (id === "otros") return false;
  const antes = data.categorias.length;
  data.categorias = data.categorias.filter((c) => c.id !== id);
  delete data.limits[id];
  delete data.metas[id];
  save();
  return data.categorias.length < antes;
}

function getLimit(id) {
  if (Object.prototype.hasOwnProperty.call(data.limits, id)) return data.limits[id];
  const def = getCategoriaDef(id);
  return def ? def.limiteDefault : null;
}

function setLimit(id, valor) {
  if (!getCategoriaDef(id)) throw new Error("Categoría inválida: " + id);
  data.limits[id] = valor === null || valor === "" || valor === undefined ? null : Number(valor);
  save();
}

function getMeta(id) {
  const def = getCategoriaDef(id);
  if (Object.prototype.hasOwnProperty.call(data.metas, id)) {
    return { meta: data.metas[id].meta, saldoInicial: data.metas[id].saldoInicial };
  }
  return { meta: def?.metaDefault || 0, saldoInicial: def?.saldoInicialDefault || 0 };
}

function setMeta(id, meta, saldoInicial) {
  const def = getCategoriaDef(id);
  if (!def || def.tipo !== "meta") throw new Error("Categoría inválida o no es de tipo meta: " + id);
  data.metas[id] = { meta: Number(meta) || 0, saldoInicial: Number(saldoInicial) || 0 };
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

module.exports = {
  getAllCategorias,
  getCategoriaDef,
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
