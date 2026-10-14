const { crearAlmacen } = require("./almacenPorUsuario");

// DÓNDE está la plata: en el bolsillo, en Yape, en el banco.
//
// Es otra cosa que la fuente. La fuente dice de dónde VINO (delivery,
// otro trabajo); el lugar dice dónde ESTÁ ahora. Un mismo movimiento
// tiene los dos: "S/ 80 de delivery que me yapearon" es fuente delivery,
// lugar Yape.
//
// Para qué sirve: la app siempre asumió que todo era efectivo, así que
// el "efectivo esperado" contaba plata que no está en el bolsillo. El
// total sigue sumando igual —esa plata es suya y sirve para pagar— pero
// ahora se puede ver cuánto hay en cada lado y cuánto hay de verdad en
// la mano.
//
// El efectivo es el lugar por defecto y no se borra: si no, habría
// movimientos sin dónde caer. Sí se puede renombrar.
const SEMILLA = [
  { id: "efectivo", label: "Efectivo", keywords: [], porDefecto: true, esEfectivo: true },
  { id: "yape", label: "Yape", keywords: ["yape", "yapeo", "yapearon", "plin"], porDefecto: false, esEfectivo: false },
];

const almacen = crearAlmacen("lugares-dinero-data.json", function (parsed) {
  try {
    const lista = Array.isArray(parsed.lugares) && parsed.lugares.length ? parsed.lugares : null;
    return { lugares: lista || SEMILLA.map((l) => ({ ...l, keywords: l.keywords.slice() })) };
  } catch (err) {
    return { lugares: SEMILLA.map((l) => ({ ...l, keywords: l.keywords.slice() })) };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;

const COMBINING_MARKS = new RegExp("[̀-ͯ]", "g");
function normalizar(texto) {
  return String(texto || "").normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase().trim();
}

function slugify(nombre) {
  return normalizar(nombre).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "lugar";
}

function normalizarKeywords(keywords) {
  if (!Array.isArray(keywords)) return [];
  return [...new Set(keywords.map((k) => normalizar(k)).filter(Boolean))];
}

function getAll() {
  return datos().lugares.map((l) => ({
    ...l,
    // Los lugares creados antes de que existiera la marca son "no
    // efectivo": el efectivo es uno solo y viene de fábrica.
    esEfectivo: l.esEfectivo === true || l.porDefecto === true,
    keywords: (l.keywords || []).slice(),
  }));
}

function porDefecto() {
  return datos().lugares.find((l) => l.porDefecto) || datos().lugares[0] || null;
}

function addLugar({ label, keywords }) {
  const nombre = String(label || "").trim();
  if (!nombre) throw new Error("Ponle un nombre al lugar.");
  const id = slugify(nombre);
  if (datos().lugares.some((l) => l.id === id)) throw new Error("Ya tienes un lugar con ese nombre.");
  const nuevo = { id, label: nombre, keywords: normalizarKeywords(keywords), porDefecto: false, esEfectivo: false };
  datos().lugares.push(nuevo);
  save();
  return nuevo;
}

function editLugar(id, cambios) {
  const l = datos().lugares.find((x) => x.id === id);
  if (!l) return null;
  if (cambios.label !== undefined && String(cambios.label).trim()) l.label = String(cambios.label).trim();
  if (cambios.keywords !== undefined) l.keywords = normalizarKeywords(cambios.keywords);
  save();
  return l;
}

function removeLugar(id) {
  const l = datos().lugares.find((x) => x.id === id);
  if (!l) return false;
  if (l.porDefecto) throw new Error("El efectivo no se puede borrar; renómbralo si quieres.");
  datos().lugares = datos().lugares.filter((x) => x.id !== id);
  save();
  return true;
}

// Por palabra completa, igual que las fuentes y las categorías, para que
// una palabra corta no matchee por casualidad dentro de otra.
function clasificar(descripcion) {
  const palabras = normalizar(descripcion).split(/[^a-z0-9]+/).filter(Boolean);
  for (const l of datos().lugares) {
    for (const kw of l.keywords || []) {
      const partes = kw.split(/[^a-z0-9]+/).filter(Boolean);
      if (!partes.length) continue;
      if (palabras.some((_, i) => partes.every((p, j) => palabras[i + j] === p))) return l.id;
    }
  }
  const def = porDefecto();
  return def ? def.id : "efectivo";
}

// El asignado a mano manda sobre el detectado por palabras.
function resolveLugarId(movimiento) {
  const manual = movimiento.lugarId;
  if (manual && datos().lugares.some((l) => l.id === manual)) return manual;
  return clasificar(movimiento.descripcion);
}

// Cuánto hay en cada lugar, sumando todo el historial. Un conteo de caja
// ("N caja") no suma ni resta: solo dice cuánto efectivo hay de verdad,
// y eso ya lo maneja la caja.
function getSaldos(movimientos) {
  const acumulado = new Map();

  (movimientos || []).forEach((m) => {
    if (m.tipo !== "ganancia" && m.tipo !== "gasto") return;
    const id = resolveLugarId(m);
    const actual = acumulado.get(id) || { entro: 0, salio: 0, cantidad: 0 };
    if (m.tipo === "ganancia") actual.entro += m.monto || 0;
    else actual.salio += m.monto || 0;
    actual.cantidad += 1;
    acumulado.set(id, actual);
  });

  const detalle = getAll().map((l) => {
    const a = acumulado.get(l.id) || { entro: 0, salio: 0, cantidad: 0 };
    return {
      id: l.id,
      label: l.label,
      esEfectivo: l.esEfectivo,
      entro: +a.entro.toFixed(2),
      salio: +a.salio.toFixed(2),
      saldo: +(a.entro - a.salio).toFixed(2),
      movimientos: a.cantidad,
    };
  });

  // Lo que NO está en el bolsillo. El "efectivo esperado" de la caja
  // cuenta todo junto; restando esto sale lo que de verdad tienes en la
  // mano.
  const fuera = detalle.filter((l) => !l.esEfectivo).reduce((s, l) => s + l.saldo, 0);

  return { detalle, fueraDelEfectivo: +fuera.toFixed(2) };
}

module.exports = {
  getAll,
  addLugar,
  editLugar,
  removeLugar,
  clasificar,
  resolveLugarId,
  getSaldos,
};
