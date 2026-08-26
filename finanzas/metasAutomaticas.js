// Las metas diaria/semanal/mensual no son un numero escrito a mano: salen
// de lo que realmente falta juntar para cubrir todo lo que hay que pagar
// de aqui a fin de mes.
//
//   me falta   = (lo que tengo que gastar) - (lo que ya tengo)
//   diaria     = me falta / dias que quedan del mes
//   semanal    = diaria x dias que quedan de esta semana
//   mensual    = me falta
//
// Como "lo que ya tengo" es el efectivo esperado de la caja, cada ingreso
// que se anota lo sube y por lo tanto baja la meta sola, en vivo. Si ya
// esta todo cubierto la meta queda en 0 (nunca en negativo).
//
// Los require van adentro de la funcion a proposito: financeGoals llama a
// este modulo y este necesita el ahorro de financeGoals. Pidiendolos al
// momento de calcular se evita el require circular.

function diasQueQuedanDeLaSemana(fechaLabel) {
  // Semana de lunes a domingo. Cuenta el dia de hoy.
  const [y, m, d] = fechaLabel.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return dow === 0 ? 1 : 8 - dow;
}

function calcular() {
  const cashbox = require("./cashbox");
  const reminders = require("./reminders");
  const scheduledExpenses = require("./scheduledExpenses");
  const debts = require("./debts");
  const financeGoals = require("./financeGoals");
  const businessDay = require("./businessDay");

  // 1. Lo que ya tengo: el efectivo esperado que muestra el panel.
  const hoy = cashbox.getToday();
  const tengo = hoy.esperado || 0;

  // 2. Lo que tengo que gastar de aqui a fin de mes.
  //    Pendientes: incluye lo vencido sin pagar y descuenta lo ya pagado.
  const pagos = reminders.getPagosMesRestante();
  const pendientes = pagos.reduce((s, p) => s + (p.monto || 0), 0);

  //    Programados: los recurrentes (almuerzo, gasolina) proyectados de
  //    hoy a fin de mes. Cuenta el de hoy aunque ya lo hayas gastado; al
  //    dia siguiente se corrige solo y mientras tanto pide de mas, que es
  //    el lado seguro para equivocarse.
  const proyeccion = scheduledExpenses.getProyeccionRestoDeMes();
  const programados = proyeccion.total || 0;

  //    Deudas: solo las que TU debes (saldo a favor de la otra persona).
  const deudasLista = debts.getDeudas().filter((d) => d.saldo > 0);
  const deudas = deudasLista.reduce((s, d) => s + d.saldo, 0);

  //    Y el ahorro que se propuso ese mes, que tambien hay que generar.
  const ahorro = financeGoals.getAhorroMensual();

  const necesito = pendientes + programados + deudas + ahorro;
  const falta = Math.max(necesito - tengo, 0);

  // 3. Repartirlo en el tiempo que queda.
  const { diasRestantes } = cashbox.getDiasDelMes();
  const diasSemana = Math.min(diasQueQuedanDeLaSemana(businessDay.businessDayLabel()), diasRestantes);
  const diaria = diasRestantes > 0 ? falta / diasRestantes : falta;

  const r2 = (n) => Math.round(n * 100) / 100;

  return {
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
      deudas: { total: r2(deudas), items: deudasLista },
      ahorro: { total: r2(ahorro) },
    },
  };
}

module.exports = { calcular };
