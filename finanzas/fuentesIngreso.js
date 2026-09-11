const { crearAlmacen } = require("./almacenPorUsuario");

// De donde viene cada ganancia: del delivery, de otro trabajo, de una
// venta. Es OTRA cosa que los locales: el local dice QUE restaurante te
// dio el pedido; la fuente dice DE QUE tipo es esa plata. Un mismo
// movimiento tiene las dos.
//
// Funciona igual que las categorias de gastos, para que no haya que
// aprender dos formas distintas: se detecta por palabra en la descripcion
// y se puede corregir a mano desde el panel.
//
// Una de las fuentes es la "por defecto": ahi cae todo lo que no matchee
// con ninguna palabra. Se puede renombrar pero no borrar, porque si no
// habria ganancias sin ningun lado donde caer.
// esTrabajo: si esa plata la genero trabajando. Un deposito del banco o
// plata de Ana SI es suya y SI sirve para pagar, asi que entra en la caja
// y en las metas igual que todo. Pero no la gano repartiendo, asi que no
// debe contar para el promedio por dia: si contara, la app creeria que
// trabajando hace mas de lo que de verdad hace.
const SEMILLA = [{ id: "delivery", label: "Delivery", keywords: [], porDefecto: true, esTrabajo: true }];

const almacen = crearAlmacen("fuentes-ingreso-data.json", function (parsed) {
  try {
    const lista = Array.isArray(parsed.fuentes) && parsed.fuentes.length ? parsed.fuentes : null;
    return { fuentes: lista || SEMILLA.map((f) => ({ ...f })) };
  } catch (err) {
    return { fuentes: SEMILLA.map((f) => ({ ...f })) };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;

const COMBINING_MARKS = new RegExp("[\u0300-\u036f]", "g");
function normalizar(texto) {
  return String(texto || "").normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase().trim();
}

function slugify(nombre) {
  return normalizar(nombre).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "fuente";
}

function getAll() {
  // esTrabajo por defecto en true: las fuentes creadas antes de que
  // existiera la marca siguen contando como trabajo, que es lo que eran.
  return datos().fuentes.map((f) => ({
    ...f,
    esTrabajo: f.esTrabajo !== false,
    keywords: (f.keywords || []).slice(),
  }));
}

// Las fuentes que NO son trabajo: plata que entro pero no se genero
// repartiendo. Sirve para sacarlas del promedio por dia.
function idsQueNoSonTrabajo() {
  return getAll().filter((f) => !f.esTrabajo).map((f) => f.id);
}

function porDefecto() {
  const f = datos().fuentes.find((x) => x.porDefecto);
  return f || datos().fuentes[0] || null;
}

function getFuenteDef(id) {
  return datos().fuentes.find((f) => f.id === id) || porDefecto();
}

function addFuente({ label, keywords, esTrabajo }) {
  const nombre = String(label || "").trim();
  if (!nombre) throw new Error("Ponle un nombre a la fuente.");
  const id = slugify(nombre);
  if (datos().fuentes.some((f) => f.id === id)) throw new Error("Ya tienes una fuente con ese nombre.");
  const nueva = {
    id,
    label: nombre,
    keywords: normalizarKeywords(keywords),
    porDefecto: false,
    esTrabajo: esTrabajo !== false,
  };
  datos().fuentes.push(nueva);
  save();
  return nueva;
}

function normalizarKeywords(keywords) {
  if (!Array.isArray(keywords)) return [];
  return [...new Set(keywords.map((k) => normalizar(k)).filter(Boolean))];
}

function editFuente(id, cambios) {
  const f = datos().fuentes.find((x) => x.id === id);
  if (!f) return null;
  if (cambios.label !== undefined && String(cambios.label).trim()) f.label = String(cambios.label).trim();
  if (cambios.keywords !== undefined) f.keywords = normalizarKeywords(cambios.keywords);
  if (cambios.esTrabajo !== undefined) f.esTrabajo = !!cambios.esTrabajo;
  save();
  return f;
}

// La fuente por defecto no se borra: dejaria ganancias sin donde caer.
function removeFuente(id) {
  const f = datos().fuentes.find((x) => x.id === id);
  if (!f) return false;
  if (f.porDefecto) throw new Error("Esa es la fuente por defecto; renómbrala si quieres, pero no se puede borrar.");
  datos().fuentes = datos().fuentes.filter((x) => x.id !== id);
  save();
  return true;
}

// Por palabra completa, para que una palabra corta no matchee por
// casualidad dentro de otra ("bum" dentro de "bumerang").
function clasificar(descripcion) {
  const palabras = normalizar(descripcion).split(/[^a-z0-9]+/).filter(Boolean);
  for (const f of datos().fuentes) {
    const kws = f.keywords || [];
    for (const kw of kws) {
      const partes = kw.split(/[^a-z0-9]+/).filter(Boolean);
      if (!partes.length) continue;
      if (palabras.some((_, i) => partes.every((p, j) => palabras[i + j] === p))) return f.id;
    }
  }
  const def = porDefecto();
  return def ? def.id : "delivery";
}

// La asignada a mano manda sobre la detectada por palabras.
function resolveFuenteId(movimiento) {
  const manual = movimiento.fuenteId;
  if (manual && datos().fuentes.some((f) => f.id === manual)) return manual;
  return clasificar(movimiento.descripcion);
}

// Cuanto entro por cada fuente en un rango de fechas.
function getResumen(movimientos, desde, hasta) {
  const acumulado = new Map();
  let total = 0;

  (movimientos || []).forEach((m) => {
    if (m.tipo !== "ganancia") return;
    if (desde && m.fecha < desde) return;
    if (hasta && m.fecha > hasta) return;
    const id = resolveFuenteId(m);
    const actual = acumulado.get(id) || { monto: 0, cantidad: 0 };
    actual.monto += m.monto || 0;
    actual.cantidad += 1;
    acumulado.set(id, actual);
    total += m.monto || 0;
  });

  const detalle = getAll()
    .map((f) => {
      const a = acumulado.get(f.id) || { monto: 0, cantidad: 0 };
      return {
        id: f.id,
        label: f.label,
        monto: +a.monto.toFixed(2),
        cantidad: a.cantidad,
        porcentaje: total > 0 ? Math.round((a.monto / total) * 100) : 0,
      };
    })
    .filter((f) => f.cantidad > 0)
    .sort((a, b) => b.monto - a.monto);

  return { total: +total.toFixed(2), detalle };
}

module.exports = {
  getAll,
  getFuenteDef,
  addFuente,
  editFuente,
  removeFuente,
  clasificar,
  resolveFuenteId,
  idsQueNoSonTrabajo,
  getResumen,
};
