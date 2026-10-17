// Las metas diaria/semanal/mensual no son un numero escrito a mano: salen
// de lo que realmente falta juntar para cubrir todo lo que hay que pagar
// de HOY hasta una fecha limite.
//
//   me falta   = (lo que tengo que gastar) - (lo que ya tengo)
//   diaria     = lo que faltaba al EMPEZAR hoy / dias de trabajo que quedan
//   semanal    = diaria x dias de trabajo que quedan de esta semana
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
  const diasLibres = require("./diasLibres");

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
  const gananciasHoy = hoy.ganancias || 0;

  // 2. Lo que tengo que gastar de HOY hasta la fecha limite.
  //    Lo que vence dentro del periodo, y TAMBIEN lo que quedo con fecha
  //    vieja sin marcar como pagado: si no lo pago, lo sigue debiendo.
  //    Antes eso quedaba afuera (por si lo habia pagado y no lo marco), y
  //    la meta salia mas baja que la real: la Junta del lunes vencida y sin
  //    pagar no se pedia en ningun lado. Si ya lo pago, lo marca y la meta
  //    baja sola; si se olvida de marcarlo, la meta pide de mas, que es el
  //    lado seguro para equivocarse.
  const todosLosPagos = reminders.getPagosEnRango(offset);
  const pagos = todosLosPagos.filter((p) => !p.fecha || p.fecha >= hoyLabel);
  const atrasados = todosLosPagos.filter((p) => p.fecha && p.fecha < hoyLabel);
  const pendientes = pagos.reduce((s, p) => s + (p.monto || 0), 0);
  const atrasadosTotal = atrasados.reduce((s, p) => s + (p.monto || 0), 0);

  //    Programados: los recurrentes (almuerzo, gasolina) proyectados de
  //    hoy a la fecha limite. Cuenta el de hoy aunque ya lo haya gastado;
  //    al dia siguiente se corrige solo y mientras tanto pide de mas, que
  //    es el lado seguro para equivocarse.
  // Se le pasan los movimientos para que descuente lo que ya se gasto de
  //    verdad en cada concepto: si no, anotar "menos 20 almuerzo" bajaba la
  //    caja y la proyeccion seguia pidiendo el almuerzo entero.
  const proyeccion = scheduledExpenses.getProyeccion(hoyLabel, hasta, cashbox.getMovimientos());
  const programados = proyeccion.total || 0;

  //    OJO: el modulo debts es plata que OTROS le deben A EL ("deudas por
  //    cobrar", el bot dice "Nombre te debe X"). No es plata que el deba.
  //    Por eso NO entra en lo que tiene que gastar: sumarla era al reves y
  //    le inflaba la meta. Tampoco se suma a lo que tiene, porque no la
  //    tiene en mano y puede no cobrarla nunca. Va aparte, como aviso.
  const porCobrarLista = debts.getDeudas().filter((d) => d.saldo > 0);
  const porCobrar = porCobrarLista.reduce((s, d) => s + d.saldo, 0);

  //    El ahorro ya no es "del mes": es un plan con su propia fecha. Si
  //    el corte pedido llega al final del plan entra completo; si queda
  //    antes, solo la parte proporcional que toca hasta ahi. Asi cambiar
  //    la meta de ahorro o su fecha recalcula todo lo demas solo.
  const ahorro = financeGoals.ahorroRequeridoHasta(hasta);

  //    Y lo que hay que DEVOLVER de los prestamos. Ojo: solo el de los
  //    que NO tienen un pendiente atado. Los que si lo tienen ya estan
  //    contados arriba, en "pendientes", y sumarlos aca contaria doble
  //    la misma plata.
  const prestamos = require("./prestamos");
  const devolver = prestamos.aDevolverEn(hoyLabel, hasta);

  const necesito = pendientes + atrasadosTotal + programados + ahorro + devolver.total;
  const falta = Math.max(necesito - tengo, 0);

  // 3. Repartirlo en los dias que VA A TRABAJAR, no en todos los del
  //    calendario. Si descansa domingos y se divide entre todos, la app
  //    le pide menos por dia del que necesita y el ultimo domingo lo
  //    agarra corto. Sin dias libres configurados esto da igual que antes.
  const diasHabiles = diasLibres.contarHabiles(hoyLabel, hasta);
  // Hoy puede ser un día de descanso. En ese caso no hay meta de hoy: lo
  // que haga sale de más, y lo que falta ya está repartido entre los días
  // que sí va a trabajar.
  const hoyEsLibre = diasLibres.esLibre(hoyLabel);

  //    La meta de HOY se saca con lo que faltaba al empezar el día. Lo que
  //    va ganando hoy es AVANCE de esa meta, no algo que la achique: antes
  //    se contaba dos veces (bajaba la meta y además sumaba como avance),
  //    y la meta parecía cumplida antes de tiempo. Lo que gasta hoy sí la
  //    sube en vivo, que es lo que tiene que pasar.
  //    En un día de descanso hoy no está entre los días de trabajo, así que
  //    lo que haga baja directamente lo que falta para los demás.
  const baseDelDia = hoyEsLibre ? tengo : tengo - gananciasHoy;
  const faltaAlEmpezar = Math.max(necesito - baseDelDia, 0);
  const diaria = faltaAlEmpezar / diasHabiles;

  //    Para la semanal: cuantos de esos dias de trabajo caen en lo que
  //    queda de esta semana, sin pasarse de la fecha limite.
  const finDeSemana = businessDay.addDays(hoyLabel, diasQueQuedanDeLaSemana(hoyLabel) - 1);
  const corteSemana = finDeSemana < hasta ? finDeSemana : hasta;
  const diasSemana = diasLibres.contarHabiles(hoyLabel, corteSemana);

  // 4. A su ritmo actual, ¿va a llegar?
  //    Se promedian las GANANCIAS por dia trabajado, no el neto: "falta"
  //    ya es lo que tiene que GENERAR, porque los gastos que vienen estan
  //    contados dentro de "necesito". Promediar el neto restaria dos
  //    veces lo mismo.
  //    Solo dias con ganancias: los que descanso o no salio bajarian el
  //    promedio sin que eso diga nada de como le va cuando trabaja.
  //    Se calcula desde los movimientos y no desde los totales del dia,
  //    porque hay que poder dejar afuera lo que NO se gano trabajando:
  //    un deposito del banco o plata de Ana es suya y sirve para pagar,
  //    pero contarla aca haria creer que repartiendo hace mas de lo real.
  const DIAS_PARA_EL_PROMEDIO = 30;
  const fuentesIngreso = require("./fuentesIngreso");
  const noEsTrabajo = new Set(fuentesIngreso.idsQueNoSonTrabajo());

  //    Y los dias de DESCANSO quedan fuera del promedio. Si sale un rato
  //    en su dia libre y hace S/60, ese dia no dice como le va cuando
  //    trabaja: metido en el promedio lo baja y la app cree que rinde
  //    menos de lo que rinde. Esa plata sigue contando en "lo que tengo",
  //    que es donde tiene que contar. Ademas el promedio se multiplica
  //    por los dias HABILES, asi que tiene que ser el promedio de un dia
  //    habil o las dos mitades no hablan de lo mismo.
  const porDiaTrabajado = new Map();
  let ingresosNoTrabajo = 0;
  let ganadoEnDiasLibres = 0;
  cashbox.getMovimientos().forEach((m) => {
    if (m.tipo !== "ganancia") return;
    if (noEsTrabajo.has(fuentesIngreso.resolveFuenteId(m))) {
      ingresosNoTrabajo += m.monto || 0;
      return;
    }
    if (diasLibres.esLibre(m.fecha)) {
      ganadoEnDiasLibres += m.monto || 0;
      return;
    }
    porDiaTrabajado.set(m.fecha, (porDiaTrabajado.get(m.fecha) || 0) + (m.monto || 0));
  });

  //    Hoy tampoco entra: el dia todavia no termino. Con los S/ 75 de la
  //    mañana metidos como un dia entero, el promedio bajaba durante el dia
  //    y volvia a subir al dia siguiente.
  const diasTrabajados = Array.from(porDiaTrabajado.entries())
    .filter((par) => par[1] > 0 && par[0] !== hoyLabel)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-DIAS_PARA_EL_PROMEDIO);
  const promedioDiario = diasTrabajados.length
    ? diasTrabajados.reduce((s, par) => s + par[1], 0) / diasTrabajados.length
    : 0;

  //    Cuanto juntaria de aca al final haciendo "porDia" cada dia de trabajo.
  //    Hoy ya esta en marcha y lo que ya hizo esta en "tengo": de hoy solo
  //    se cuenta lo que le falta para llegar a ese monto. Sin esto, a las 5
  //    de la tarde contaba lo de hoy dos veces (en la caja y en el pronostico).
  function juntaria(porDia, yaHechoHoy) {
    const deHoy = hoyEsLibre ? 0 : Math.min(yaHechoHoy, porDia);
    return Math.max(porDia * diasHabiles - deHoy, 0);
  }
  const ganadoTrabajandoHoy = porDiaTrabajado.get(hoyLabel) || 0;
  const proyectado = juntaria(promedioDiario, ganadoTrabajandoHoy);
  const sobraARitmo = tengo + proyectado - necesito;

  // 5. Los tres caminos para cerrar el periodo, para verlos lado a lado:
  //    lo justo (la meta), su minimo por dia, y su ritmo real. "sobra" es
  //    lo que le quedaria al final (negativo = lo que le faltaria).
  const minimo = financeGoals.getMinimoDiario();
  const sobraConMinimo = minimo > 0 ? tengo + juntaria(minimo, gananciasHoy) - necesito : null;

  //    Lo que le sobraria haciendo su minimo, repartido en los dias que
  //    quedan: es lo que puede gastar en gustos sin tocar nada de lo que
  //    tiene que pagar (los gastos de todos los dias ya estan contados).
  const gustosPorDia = sobraConMinimo !== null && sobraConMinimo > 0 ? sobraConMinimo / diasRestantes : 0;

  const vencenHoy = pagos.filter((p) => p.fecha === hoyLabel);

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
    diasHabiles,
    hoyEsLibre,
    // Lo que entró en días de descanso: es extra, no parte del ritmo.
    ganadoEnDiasLibres: r2(ganadoEnDiasLibres),
    // Que dias NO trabaja dentro de este periodo, para poder mostrarselos.
    diasLibresEnPeriodo: diasLibres.listarLibres(hoyLabel, hasta),
    diasSemana,
    // Su ritmo real, para saber si con lo que viene haciendo le alcanza.
    ritmo: {
      promedioDiario: r2(promedioDiario),
      diasMedidos: diasTrabajados.length,
      proyectado: r2(proyectado),
      alcanza: sobraARitmo >= 0,
      diferencia: r2(sobraARitmo),
      // Plata que entro pero no se gano trabajando (bancos, Ana). Cuenta
      // en la caja y en las metas; solo queda fuera del promedio.
      ingresosNoTrabajo: r2(ingresosNoTrabajo),
    },
    diaria: r2(diaria),
    semanal: r2(diaria * diasSemana),
    mensual: r2(falta),
    // La meta de hoy con su avance: lo mismo que muestra Inicio y dice el bot.
    hoy: {
      esLibre: hoyEsLibre,
      meta: r2(hoyEsLibre ? 0 : diaria),
      ganado: r2(gananciasHoy),
      falta: r2(hoyEsLibre ? 0 : Math.max(diaria - gananciasHoy, 0)),
    },
    minimoDiario: r2(minimo),
    escenarios: {
      justo: { porDia: r2(diaria) },
      minimo: minimo > 0 ? { porDia: r2(minimo), sobra: r2(sobraConMinimo), alcanza: sobraConMinimo >= 0 } : null,
      ritmo:
        diasTrabajados.length > 0
          ? { porDia: r2(promedioDiario), sobra: r2(sobraARitmo), alcanza: sobraARitmo >= 0 }
          : null,
    },
    gustosPorDia: r2(gustosPorDia),
    detalle: {
      pendientes: { total: r2(pendientes), items: pagos },
      programados: { total: r2(programados), items: proyeccion.detalle || [] },
      // No suma ni resta: es plata que le deben, todavia no la tiene.
      porCobrar: { total: r2(porCobrar), items: porCobrarLista },
      ahorro: { total: r2(ahorro) },
      prestamos: { total: r2(devolver.total), items: devolver.detalle },
      // Ya vencidos y sin marcar como pagados: SI suman a la meta.
      atrasados: { total: r2(atrasadosTotal), items: atrasados },
      // Los que vencen hoy (ya estan dentro de "pendientes").
      vencenHoy: { total: r2(vencenHoy.reduce((s, p) => s + (p.monto || 0), 0)), items: vencenHoy },
    },
  };
}

module.exports = { calcular };
