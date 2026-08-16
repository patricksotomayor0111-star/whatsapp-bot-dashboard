const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("locales-data.json");

// Los locales (restaurantes, negocios) que le dan pedidos al delivery.
// Cada ganancia registrada es un reparto hecho para alguno de ellos, y su
// monto es lo que se cobró por ese reparto. Como en el grupo se escriben
// abreviados y no siempre igual ("bum", "buma"), cada local guarda sus
// propias abreviaturas para poder juntarlos en un solo ranking.
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { locales: Array.isArray(parsed.locales) ? parsed.locales : [] };
  } catch (err) {
    return { locales: [] };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar locales-data.json:", err.message);
  }
}

const COMBINING_MARKS = new RegExp("[̀-ͯ]", "g");
function normalizeText(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .trim();
}

function slugify(nombre) {
  const base = normalizeText(nombre)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "local";
}

function normalizarAliases(aliases) {
  if (!Array.isArray(aliases)) return [];
  return Array.from(new Set(aliases.map((a) => normalizeText(a)).filter(Boolean)));
}

function getAll() {
  return data.locales;
}

// A qué local pertenece una descripción. Se acepta que coincida entera, que
// alguna de sus palabras sea la abreviatura, o que empiece con ella (así
// "bum" agarra también "bumanguesa"). Devuelve el local o null.
function localDe(descripcion) {
  const desc = normalizeText(descripcion);
  if (!desc) return null;
  const palabras = desc.split(/[^a-z0-9]+/).filter(Boolean);

  for (const local of data.locales) {
    for (const alias of local.aliases) {
      if (desc === alias || palabras.includes(alias) || desc.startsWith(alias)) return local;
    }
  }
  return null;
}

function addLocal({ nombre, aliases }) {
  const nombreLimpio = String(nombre || "").trim();
  if (!nombreLimpio) throw new Error("Ponle un nombre al local.");
  let id = slugify(nombreLimpio);
  let sufijo = 1;
  while (data.locales.some((l) => l.id === id)) id = `${slugify(nombreLimpio)}_${sufijo++}`;

  // Sin abreviaturas explícitas se usa el propio nombre, que es lo más
  // común: el local se llama igual que como se escribe en el grupo.
  const nuevo = {
    id,
    nombre: nombreLimpio,
    aliases: normalizarAliases(aliases && aliases.length ? aliases : [nombreLimpio]),
  };
  data.locales.push(nuevo);
  save();
  return nuevo;
}

function editLocal(id, cambios) {
  const local = data.locales.find((l) => l.id === id);
  if (!local) return null;
  if (cambios.nombre !== undefined && String(cambios.nombre).trim()) local.nombre = String(cambios.nombre).trim();
  if (cambios.aliases !== undefined) local.aliases = normalizarAliases(cambios.aliases);
  save();
  return local;
}

function removeLocal(id) {
  const antes = data.locales.length;
  data.locales = data.locales.filter((l) => l.id !== id);
  if (data.locales.length !== antes) save();
}

// Solo los repartos (ganancias) del mes pedido; con mes vacío, todo el
// historial guardado.
function gananciasDelMes(movimientos, mes) {
  return movimientos.filter((m) => m.tipo === "ganancia" && (!mes || m.fecha.slice(0, 7) === mes));
}

function diasEntreLabels(desde, hasta) {
  const a = new Date(`${desde}T00:00:00Z`).getTime();
  const b = new Date(`${hasta}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

// Ranking de locales: cuánto dejó cada uno, cuántos repartos y cuánto paga
// en promedio por reparto. "diasSinPedir" mira SIEMPRE el historial
// completo (no solo el mes elegido), porque sirve para darse cuenta de que
// un local dejó de dar trabajo.
// "costoPorReparto" es lo que cuesta hacer UN reparto (combustible,
// mantenimiento: los gastos marcados como del negocio, repartidos entre
// todos los repartos del período). Sirve para saber cuánto deja LIMPIO
// cada local, que es distinto de lo que cobra: un local que paga S/7.40
// deja mucho menos de lo que parece.
function getRanking(movimientos, mes, hoyLabel, costoPorReparto = 0) {
  const delMes = gananciasDelMes(movimientos, mes);
  const porLocal = {};

  delMes.forEach((m) => {
    const local = localDe(m.descripcion);
    if (!local) return;
    porLocal[local.id] = porLocal[local.id] || { total: 0, pedidos: 0 };
    porLocal[local.id].total += m.monto;
    porLocal[local.id].pedidos += 1;
  });

  // Última vez que cada local dio un reparto, en todo el historial.
  const ultimaFecha = {};
  movimientos.forEach((m) => {
    if (m.tipo !== "ganancia") return;
    const local = localDe(m.descripcion);
    if (!local) return;
    if (!ultimaFecha[local.id] || m.fecha > ultimaFecha[local.id]) ultimaFecha[local.id] = m.fecha;
  });

  return data.locales
    .map((local) => {
      const acumulado = porLocal[local.id] || { total: 0, pedidos: 0 };
      const ultima = ultimaFecha[local.id] || null;
      const promedio = acumulado.pedidos ? acumulado.total / acumulado.pedidos : 0;
      return {
        id: local.id,
        nombre: local.nombre,
        aliases: local.aliases,
        total: +acumulado.total.toFixed(2),
        pedidos: acumulado.pedidos,
        promedio: +promedio.toFixed(2),
        netoPorReparto: acumulado.pedidos ? +(promedio - costoPorReparto).toFixed(2) : 0,
        netoTotal: +(acumulado.total - costoPorReparto * acumulado.pedidos).toFixed(2),
        ultimaFecha: ultima,
        diasSinPedir: ultima && hoyLabel ? diasEntreLabels(ultima, hoyLabel) : null,
      };
    })
    .sort((a, b) => b.total - a.total);
}

// Descripciones que todavía no pertenecen a ningún local, para poder
// darlas de alta sin tener que acordarse de todas de memoria.
function getSinAsignar(movimientos, mes) {
  const delMes = gananciasDelMes(movimientos, mes);
  const sueltos = {};

  delMes.forEach((m) => {
    if (localDe(m.descripcion)) return;
    const clave = normalizeText(m.descripcion);
    if (!clave) return;
    sueltos[clave] = sueltos[clave] || { nombre: clave, total: 0, pedidos: 0 };
    sueltos[clave].total += m.monto;
    sueltos[clave].pedidos += 1;
  });

  return Object.values(sueltos)
    .map((s) => ({ ...s, total: +s.total.toFixed(2) }))
    .sort((a, b) => b.total - a.total);
}

module.exports = {
  getAll,
  localDe,
  addLocal,
  editLocal,
  removeLocal,
  getRanking,
  getSinAsignar,
};
