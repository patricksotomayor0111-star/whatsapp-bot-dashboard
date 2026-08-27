const { crearAlmacen } = require("./almacenPorUsuario");

// Lo unico que se guarda a mano es el PLAN DE AHORRO: cuanto quiere juntar
// y hasta cuando. Antes era un numero suelto "ahorro del mes"; ahora es
// "desde tal dia hasta tal dia me propongo ahorrar tanto", que es como el
// lo piensa. Las metas diaria/semanal/mensual nunca se escriben: las
// calcula metasAutomaticas.js a partir de lo que falta pagar.
//
// Los require van adentro de las funciones: metasAutomaticas llama a este
// modulo y este necesita cashbox, que a su vez no debe arrastrar a los
// otros al cargar. Pedirlos al momento evita el require circular.

const almacen = crearAlmacen("finance-goals-data.json", function (parsed) {
  try {
    const a = parsed.ahorro || {};
    return {
      ahorro: {
        // Compatibilidad: lo que estaba guardado como "ahorroMensual" pasa
        // a ser el monto del plan. Sin fechas propias se asume el mes en
        // curso, que es exactamente como se comportaba antes.
        monto: Number(a.monto) || Number(parsed.ahorroMensual) || 0,
        desde: a.desde || null,
        hasta: a.hasta || null,
      },
    };
  } catch (err) {
    return { ahorro: { monto: 0, desde: null, hasta: null } };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;

function esFechaLabel(v) {
  if (typeof v !== "string" || v.length !== 10) return false;
  const p = v.split("-");
  if (p.length !== 3 || p[0].length !== 4 || p[1].length !== 2 || p[2].length !== 2) return false;
  return p.every((x) => x !== "" && Number.isFinite(Number(x)));
}

function diasEntre(a, b) {
  const businessDay = require("./businessDay");
  return Math.round((businessDay.ymdToUtc(b).getTime() - businessDay.ymdToUtc(a).getTime()) / 86400000) + 1;
}

// El plan tal cual esta guardado. Si no tiene fechas propias se asume el
// mes en curso, para que una cuenta vieja siga viendo lo mismo que antes.
function getAhorro() {
  const businessDay = require("./businessDay");
  const hoy = businessDay.businessDayLabel();
  const mes = hoy.slice(0, 7);
  const [y, mo] = hoy.split("-").map(Number);
  const a = datos().ahorro || {};
  return {
    monto: Number(a.monto) || 0,
    desde: esFechaLabel(a.desde) ? a.desde : mes + "-01",
    hasta: esFechaLabel(a.hasta) ? a.hasta : mes + "-" + String(businessDay.diasEnMes(y, mo)).padStart(2, "0"),
  };
}

function setAhorro({ monto, desde, hasta }) {
  const a = datos().ahorro || (datos().ahorro = {});
  if (monto !== undefined) a.monto = Math.max(Number(monto) || 0, 0);
  if (desde !== undefined) a.desde = esFechaLabel(desde) ? desde : null;
  if (hasta !== undefined) a.hasta = esFechaLabel(hasta) ? hasta : null;
  // Si las pone al reves se acomodan solas en vez de dejar un plan de
  // cero dias que dividiria mal.
  if (a.desde && a.hasta && a.desde > a.hasta) {
    const t = a.desde;
    a.desde = a.hasta;
    a.hasta = t;
  }
  save();
  return getAhorro();
}

// El plan con su progreso: cuanto lleva juntado dentro de la ventana,
// cuanto le falta y cuanto tendria que ahorrar por dia para llegar.
function getPlanAhorro() {
  const cashbox = require("./cashbox");
  const businessDay = require("./businessDay");
  const hoy = businessDay.businessDayLabel();
  const plan = getAhorro();

  const corte = hoy < plan.hasta ? hoy : plan.hasta;
  const logrado = plan.monto > 0 && corte >= plan.desde ? cashbox.getRangoTotals(plan.desde, corte).ahorro : 0;
  const falta = Math.max(plan.monto - logrado, 0);

  const arranque = hoy > plan.desde ? hoy : plan.desde;
  const diasRestantes = Math.max(diasEntre(arranque, plan.hasta), 0);
  const porDia = diasRestantes > 0 ? falta / diasRestantes : falta;

  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    monto: r2(plan.monto),
    desde: plan.desde,
    hasta: plan.hasta,
    activo: plan.monto > 0,
    logrado: r2(logrado),
    falta: r2(falta),
    diasRestantes,
    porDia: r2(porDia),
    vencido: plan.hasta < hoy,
    cumplido: plan.monto > 0 && falta <= 0,
  };
}

// Cuanto del plan de ahorro tiene que estar juntado si el corte es tal
// fecha. Si el corte llega al final del plan, todo. Si queda antes, la
// parte proporcional: proponerse 2000 hasta el 15/10 y preguntar "hasta
// fin de mes" no puede exigir los 2000 completos en cinco dias.
function ahorroRequeridoHasta(hastaLabel) {
  const plan = getAhorro();
  if (plan.monto <= 0) return 0;
  if (!esFechaLabel(hastaLabel) || hastaLabel >= plan.hasta) return plan.monto;

  const total = diasEntre(plan.desde, plan.hasta);
  if (total <= 0) return plan.monto;
  const transcurrido = diasEntre(plan.desde, hastaLabel);
  if (transcurrido <= 0) return 0;
  return Math.min((plan.monto * transcurrido) / total, plan.monto);
}

function getGoals(hasta) {
  const metas = require("./metasAutomaticas").calcular(hasta);
  return {
    diaria: metas.diaria,
    semanal: metas.semanal,
    mensual: metas.mensual,
    ahorro: getPlanAhorro(),
    automaticas: metas,
  };
}

module.exports = { getGoals, getAhorro, setAhorro, getPlanAhorro, ahorroRequeridoHasta };
