const businessDay = require("./businessDay");
const scheduledExpenses = require("./scheduledExpenses");

// Lo que NO gastaste de lo que tenías planeado.
//
// Tienes gastos de todos los días (almuerzo, gasolina) y de cada semana
// (la salida del sábado). Pero hay días que no sales, o que comes en casa,
// y ese gasto no ocurre. Esa plata no aparece en ningún lado: no es una
// ganancia, así que no sale en ganancias, y no es un gasto, así que
// tampoco sale en gastos. Simplemente no se gastó, y eso no se veía.
//
// Acá se mira día por día hacia atrás: qué estaba planeado para ese día y
// qué se gastó de verdad en eso. La diferencia a favor es lo que te
// ahorraste.
//
// SOLO HACIA ATRÁS, a propósito. Un día que todavía no llegó no te ahorró
// nada: contarlo sería inventarse plata.

// Dos gastos programados que comparten una palabra se pisan: un gasto
// real de "almuerzo" lo reconocen LOS DOS, así que cada uno cree que ya
// se gastó lo suyo. No se puede adivinar cuál era, así que se avisa en
// vez de inventar un reparto.
function conflictosEntre(gastos) {
  const porClave = new Map();
  (gastos || []).forEach((g) => {
    if (g.activo === false) return;
    scheduledExpenses.clavesDe(g.label).forEach((k) => {
      if (!porClave.has(k)) porClave.set(k, []);
      porClave.get(k).push(g.label);
    });
  });
  // Dos o más gastos comparten la palabra. Si los nombres son iguales, es
  // el mismo gasto cargado dos veces; si son distintos, se confunden.
  const vistos = new Set();
  return [...porClave.entries()]
    .filter(([, labels]) => labels.length > 1)
    .map(([palabra, labels]) => ({
      palabra,
      cuales: [...new Set(labels)].sort(),
      repetido: new Set(labels).size === 1,
    }))
    // "Salida familiar" repetido comparte "salida" Y "familiar": con
    // avisarlo una vez alcanza.
    .filter((c) => {
      const clave = c.cuales.join("|");
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
}

function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function diasEnMes(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function diaSemana(label) {
  const [y, mo, d] = label.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

// El reconocimiento sale de scheduledExpenses a propósito: uno descuenta
// lo ya gastado y el otro cuenta lo que no se gastó. Si decidieran
// distinto, los dos números se contradirían entre sí.
function gastadoEnEseDia(claves, movimientos, fecha) {
  if (!claves.length) return 0;
  return (movimientos || []).reduce((suma, m) => {
    if (m.tipo !== "gasto" || m.fecha !== fecha) return suma;
    return scheduledExpenses.describeCoincide(claves, m.descripcion) ? suma + (m.monto || 0) : suma;
  }, 0);
}

// ¿A este gasto programado le tocaba este día?
function leTocabaEseDia(g, fecha) {
  if (g.activo === false) return false;
  if (g.fechaInicio && fecha < g.fechaInicio) return false;
  if (g.fechaFin && fecha > g.fechaFin) return false;
  if (g.tipo === "rango") return true; // todos los días del rango
  if (g.tipo === "semanal") return diaSemana(fecha) === g.dia;
  return false;
}

// desde/hasta: días laborales. gastos: los programados. movimientos: los
// de la caja.
function calcular({ desde, hasta, gastos, movimientos }) {
  const hoy = businessDay.businessDayLabel();
  // Nunca más allá de hoy: el futuro no ahorra.
  const finReal = !hasta || hasta > hoy ? hoy : hasta;
  if (!desde || desde > finReal) {
    return { desde: desde || "", hasta: finReal, total: 0, dias: [], conceptos: [] };
  }

  const activos = (gastos || []).filter((g) => g.activo !== false);
  const claves = new Map(activos.map((g) => [g.id, scheduledExpenses.clavesDe(g.label)]));

  const porConcepto = new Map();
  const dias = [];

  let cursor = desde;
  while (cursor <= finReal) {
    let planeado = 0;
    let gastado = 0;
    const detalle = [];

    activos.forEach((g) => {
      if (!leTocabaEseDia(g, cursor)) return;
      const real = gastadoEnEseDia(claves.get(g.id), movimientos, cursor);
      // Gastar de más en un día no "des-ahorra" lo de otro: cada día se
      // mira solo, y de más no cuenta como ahorro negativo.
      const ahorroDelDia = Math.max((g.monto || 0) - real, 0);
      planeado += g.monto || 0;
      gastado += Math.min(real, g.monto || 0);
      if (ahorroDelDia > 0) {
        detalle.push({ id: g.id, label: g.label, planeado: g.monto || 0, gastado: real, ahorro: r2(ahorroDelDia) });
        const c = porConcepto.get(g.id) || { id: g.id, label: g.label, veces: 0, ahorro: 0, planeado: 0 };
        c.veces += 1;
        c.ahorro += ahorroDelDia;
        c.planeado += g.monto || 0;
        porConcepto.set(g.id, c);
      }
    });

    dias.push({
      fecha: cursor,
      dia: Number(cursor.slice(8, 10)),
      diaSemana: diaSemana(cursor),
      planeado: r2(planeado),
      gastado: r2(gastado),
      ahorro: r2(Math.max(planeado - gastado, 0)),
      detalle,
    });

    const [y, mo, d] = cursor.split("-").map(Number);
    const sig = new Date(Date.UTC(y, mo - 1, d + 1));
    cursor = sig.toISOString().slice(0, 10);
  }

  const conflictos = conflictosEntre(activos);
  const total = dias.reduce((s, x) => s + x.ahorro, 0);
  const planeadoTotal = dias.reduce((s, x) => s + x.planeado, 0);

  return {
    desde,
    hasta: finReal,
    total: r2(total),
    planeado: r2(planeadoTotal),
    gastado: r2(planeadoTotal - total),
    // El día que más te ahorraste, para poder mirarlo.
    mejorDia: dias.reduce((mejor, d) => (!mejor || d.ahorro > mejor.ahorro ? d : mejor), null),
    diasSinGastar: dias.filter((d) => d.planeado > 0 && d.gastado === 0).length,
    conflictos,
    dias,
    conceptos: [...porConcepto.values()]
      .map((c) => ({ ...c, ahorro: r2(c.ahorro), planeado: r2(c.planeado) }))
      .sort((a, b) => b.ahorro - a.ahorro),
  };
}

// El mes entero (hasta hoy si el mes es el actual), para pintarlo como
// calendario.
function delMes(mes, gastos, movimientos) {
  const [y, mo] = mes.split("-").map(Number);
  const ultimo = diasEnMes(y, mo);
  const r = calcular({
    desde: mes + "-01",
    hasta: mes + "-" + String(ultimo).padStart(2, "0"),
    gastos,
    movimientos,
  });
  return {
    ...r,
    mes,
    // Para que el calendario sepa en qué columna arranca el mes.
    empiezaEn: diaSemana(mes + "-01"),
    diasDelMes: ultimo,
  };
}

module.exports = { calcular, delMes, leTocabaEseDia, diasEnMes };
