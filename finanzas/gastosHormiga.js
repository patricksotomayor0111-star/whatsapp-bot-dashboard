// Lo chiquito que se repite.
//
// Un gasto de S/6 no asusta a nadie y por eso no aparece en ningún lado:
// cada uno se ve suelto en la lista y se olvida. Pero treinta de esos son
// S/180, más que varias de las cuotas que sí se miran todos los meses.
//
// Acá se juntan los gastos chicos por lo que son (almuerzo, gasolina,
// pasaje) y se muestran sumados, para que lo que hoy se ve como treinta
// nadas se vea como el número que en realidad es.

const TOPE_POR_DEFECTO = 25; // qué cuenta como "chico"
const MINIMO_VECES = 4; // cuántas veces tiene que repetirse para que valga

// Palabras que no dicen qué es el gasto, solo lo acompañan.
const VACIAS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas",
  "para", "por", "con", "en", "y", "a", "al", "mi", "mis", "me", "se",
  "lo", "le", "que", "sol", "soles", "hoy", "ayer", "dia", "pago", "pague",
]);

const COMBINING_MARKS = new RegExp("[̀-ͯ]", "g");

function normalizar(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase();
}

// La palabra que dice QUÉ es el gasto. Sus descripciones son cortas
// ("almuerzo", "gasolina", "pasaje mia"), así que la primera palabra con
// contenido es casi siempre la cosa.
function palabraClave(descripcion) {
  const palabras = normalizar(descripcion)
    .split(/[^a-z0-9]+/)
    .filter((p) => p && !/^\d+$/.test(p) && !VACIAS.has(p));
  return palabras[0] || "";
}

function capitalizar(p) {
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : p;
}

// movimientos: los de la caja. desde/hasta: días laborales (YYYY-MM-DD).
function analizar(movimientos, { desde, hasta, tope, minimoVeces } = {}) {
  const topeReal = Number(tope) > 0 ? Number(tope) : TOPE_POR_DEFECTO;
  const minimo = Number(minimoVeces) > 0 ? Number(minimoVeces) : MINIMO_VECES;

  const grupos = new Map();
  let totalChicos = 0;
  let totalGastos = 0;

  (movimientos || []).forEach((m) => {
    if (m.tipo !== "gasto") return;
    if (desde && m.fecha < desde) return;
    if (hasta && m.fecha > hasta) return;
    const monto = m.monto || 0;
    totalGastos += monto;
    if (monto > topeReal) return;

    const clave = palabraClave(m.descripcion);
    if (!clave) return;

    totalChicos += monto;
    const g = grupos.get(clave) || { clave, label: capitalizar(clave), veces: 0, total: 0, ejemplos: [] };
    g.veces += 1;
    g.total += monto;
    if (g.ejemplos.length < 3) g.ejemplos.push({ fecha: m.fecha, monto, descripcion: m.descripcion });
    grupos.set(clave, g);
  });

  const lista = [...grupos.values()]
    .filter((g) => g.veces >= minimo)
    .map((g) => ({
      ...g,
      total: +g.total.toFixed(2),
      promedio: +(g.total / g.veces).toFixed(2),
      // Cuánto pesa dentro de todo lo que gastaste en el período.
      porcentaje: totalGastos > 0 ? Math.round((g.total / totalGastos) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    desde: desde || "",
    hasta: hasta || "",
    tope: topeReal,
    minimoVeces: minimo,
    totalGastos: +totalGastos.toFixed(2),
    totalChicos: +totalChicos.toFixed(2),
    // Lo que suman solo los grupos que se repiten lo suficiente: es el
    // número que vale la pena mirar.
    totalHormiga: +lista.reduce((s, g) => s + g.total, 0).toFixed(2),
    grupos: lista,
  };
}

module.exports = { analizar, palabraClave, TOPE_POR_DEFECTO, MINIMO_VECES };
