// Las metas diaria/semanal/mensual no son un numero escrito a mano: salen
// de lo que realmente falta juntar para cubrir todo lo que hay que pagar
// de HOY hasta una fecha limite.
//
//   me falta   = (lo que tengo que gastar) - (lo que ya tengo)
//   diaria     = me falta / dias que quedan hasta esa fecha
//   semanal    = diaria x dias que quedan de esta semana
//   del periodo= me falta
//
// Por defecto la fecha limite es el fin del mes en curso, pero se puede
// pedir cualquier otra (la quincena, un dia del mes que viene) para
// responder "cuanto tengo que hacer por dia si quiero llegar hasta X".
//
// Como "lo que ya tengo" es el efectivo esperado de la caja, cada ingreso
// que se anota lo sube y por lo tanto baja la meta sola, en vivo. Si ya
// esta todo cubierto la meta queda en 0 (nunca en negativo).
//
// Los require van adentro de la funcion a proposito: financeGoals llama a
// este modulo y este necesita el ahorro de financeGoals. Pidiendolos al
// momento de calcular se evita el require circular.

const MAX_DIAS_HORIZONTE = 366; // tope sano para una fecha limite pedida

function diasQueQuedanDeLaSemana(fechaLabel) {
  // Semana de lunes a domingo. Cuenta el dia de hoy.
  const [y, m, d] = fechaLabel.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return dow === 0 ? 1 : 8 - dow;
}

function esFechaLabel(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// Fecha limite efectiva: la pedida si es valida, si no el fin de este mes.
// Nunca hacia atras (no tendria dias) ni mas alla del tope.
function resolverHasta(pedido, hoyLabel, businessDay) {
  const [y, mo] = hoyLabel.split("-").map(Number);
  const finDeMes = hoyLabel.slice(0, 7) + "-" + String(businessDay.diasEnMes(y, mo)).padStart(2, "0");
  let hasta = esFechaLabel(pedido) ? pedido : finDeMes;
  if (hasta < hoyLabel) hasta = hoyLabel;
  const tope = businessDay.addDays(hoyLabel, MAX_DIAS_HORIZONTE);
  if (hasta > tope) hasta = tope;
  return { hasta, finDeMes, esFinDeMes: hasta === finDeMes };
}

function calcular(hastaPedido) {
  const cashbox = require("./cashbox");
  const reminders = require("./reminders");
  const scheduledExpenses = require("./scheduledExpenses");
  const debts = require("./debts");
  const financeGoals = require("./financeGoals");
  const businessDay = require("./businessDay");

  const hoyLabel = businessDay.businessDayLabel();
  const { hasta, finDeMes, esFinDeMes } = resolverHasta(hastaPedido, hoyLabel, businessDay);

  // Dias del periodo, contando hoy: si la fecha limite es hoy mismo, es 1.
  const offset = Math.round(
    (businessDay.ymdToUtc(hasta).getTime() - businessDay.ymdToUtc(hoyLabel).getTime()) / 86400000
  );
  const diasRestantes = offset + 1;

  // 1. Lo que ya tengo: el efectivo esperado que muestra el panel.
  const hoy = cashbox.getToday();
  const tengo = hoy.esperado || 0;

  // 2. Lo que tengo que gastar de HOY hasta la fecha limite.
  //    Solo cuenta lo que vence dentro del periodo. Lo que quedo con
  //    fecha vieja sin marcar como pagado NO entra: el efectivo que tiene
  //    hoy ya refleja lo que pago antes, asi que sumarlo seria pedirle la
  //    misma plata dos veces. Se devuelve aparte para poder avisarle, que
  //    es distinto de ignorarlo en silencio.
  const todosLosPagos = reminders.getPagosEnRango(offset);
  const pagos = todosLosPagos.filter((p) => !p.fecha || p.fecha >= hoyLabel);
  const atrasados = todosLosPagos.filter((p) => p.fecha && p.fecha < hoyLabel);
  const pendientes = pagos.reduce((s, p) => s + (p.monto || 0), 0);
  const atrasadosTotal = atrasados.reduce((s, p) => s + (p.monto || 0), 0);

  //    Programados: los recurrentes (almuerzo, gasolina) proyectados de
  //    hoy a la fecha limite. Cuenta el de hoy aunque ya lo haya gastado;
  //    al dia siguiente se corrige solo y mientras tanto pide de mas, que
  //    es el lado seguro para equivocarse.
  const proyeccion = scheduledExpenses.getProyeccion(hoyLabel, hasta);
  const programados = proyeccion.total || 0;

  //    OJO: el modulo debts es plata que OTROS le deben A EL ("deudas por
  //    cobrar", el bot dice "Nombre te debe X"). No es plata que el deba.
  //    Por eso NO entra en lo que tiene que gastar: sumarla era al reves y
  //    le inflaba la meta. Tampoco se suma a lo que tiene, porque no la
  //    tiene en mano y puede no cobrarla nunca. Va aparte, como aviso.
  const porCobrarLista = debts.getDeudas().filter((d) => d.saldo > 0);
  const porCobrar = porCobrarLista.reduce((s, d) => s + d.saldo, 0);

  //    El ahorro es una meta MENSUAL, asi que se cuenta una sola vez
  //    aunque el periodo pedido pase a otro mes.
  const ahorro = financeGoals.getAhorroMensual();

  const necesito = pendientes + programados + ahorro;
  const falta = Math.max(necesito - tengo, 0);

  // 3. Repartirlo en el tiempo que queda.
  const diasSemana = Math.min(diasQueQuedanDeLaSemana(hoyLabel), diasRestantes);
  const diaria = diasRestantes > 0 ? falta / diasRestantes : falta;

  const r2 = (n) => Math.round(n * 100) / 100;

  return {
    desde: hoyLabel,
    hasta,
    finDeMes,
    esFinDeMes,
    tengo: r2(tengo),
    necesito: r2(necesito),
    falta: r2(falta),
    cubierto: falta <= 0,
    diasRestantes,
    diasSemana,
    diaria: r2(diaria),
    semanal: r2(diaria * diasSemana),
    mensual: r2(falta),
    detalle: {
      pendientes: { total: r2(pendientes), items: pagos },
      programados: { total: r2(programados), items: proyeccion.detalle || [] },
      // No suma ni resta: es plata que le deben, todavia no la tiene.
      porCobrar: { total: r2(porCobrar), items: porCobrarLista },
      ahorro: { total: r2(ahorro) },
      // No suman a la meta; solo para avisarle que los revise.
      atrasados: { total: r2(atrasadosTotal), items: atrasados },
    },
  };
}

module.exports = { calcular };
