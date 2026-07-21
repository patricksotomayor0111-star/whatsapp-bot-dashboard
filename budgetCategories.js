const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("budget-categories-data.json");

// Orden de prioridad: la primera palabra clave que aparezca en la
// descripción gana (por eso "colegio" va antes que "mia" — así "13 mia
// colegio" cae en Colegio y no en Gustos de Mia).
const CATEGORIAS_BASE = [
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
    return { limits: parsed.limits || {}, metas: parsed.metas || {} };
  } catch (err) {
    return { limits: {}, metas: {} };
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
  return CATEGORIAS_BASE.find((c) => c.id === id) || null;
}

function getAllCategorias() {
  return [...CATEGORIAS_BASE, CATEGORIA_OTROS];
}

// Clasifica una descripción en una categoría según la primera palabra
// clave que matchee (en orden de prioridad). Si ninguna matchea, "Otros".
function categorize(descripcion) {
  const texto = String(descripcion || "").toLowerCase();
  for (const cat of CATEGORIAS_BASE) {
    if (cat.keywords.some((kw) => texto.includes(kw))) return cat.id;
  }
  return "otros";
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
    const catId = categorize(m.descripcion);
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
      limite,
      gastado,
      disponible: limite === null ? null : Math.max(limite - gastado, 0),
      porcentaje: limite ? Math.min(gastado / limite, 1) : null,
    };
  });
}

module.exports = {
  getAllCategorias,
  getCategoriaDef,
  categorize,
  getLimit,
  setLimit,
  getMeta,
  setMeta,
  getResumen,
};
