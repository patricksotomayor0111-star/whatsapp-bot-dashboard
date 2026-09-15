const businessDay = require("./businessDay");

// El mes visto como mes, no como lista.
//
// Hasta ahora todo era una tira de movimientos: para saber cómo te fue el
// martes pasado, o qué te toca pagar la semana que viene, había que ir
// filtrando. Acá el mes se ve entero de un vistazo: cada día con lo que
// ganaste y gastaste, y los días que vienen con lo que te toca pagar.

function diasEnMes(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

function etiqueta(y, mo, d) {
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

// Qué día de la semana cae (0 domingo ... 6 sábado). Se hace en UTC a
// propósito: la etiqueta ya viene en hora Perú, así que convertirla otra
// vez la correría un día.
function diaSemana(label) {
  const [y, mo, d] = label.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

// En qué fecha de ESTE mes cae un recordatorio. Devuelve la etiqueta o
// null si ese mes no le toca.
function fechaDelRecordatorioEnMes(r, y, mo) {
  const ultimo = diasEnMes(y, mo);
  if (r.tipo === "mensual_dia" && r.dia) return etiqueta(y, mo, Math.min(r.dia, ultimo));
  if (r.tipo === "mensual_finmes") return etiqueta(y, mo, ultimo);
  if (r.tipo === "unica") {
    const f = r.fecha || "";
    return f.slice(0, 7) === etiqueta(y, mo, 1).slice(0, 7) ? f : null;
  }
  return null; // los semanales se resuelven aparte, caen varias veces
}

// mes: "YYYY-MM".
// proyeccionDia(fecha) -> { total } de gastos programados de ese día.
function armar({ mes, movimientos, recordatorios, proyeccionDia }) {
  const hoy = businessDay.businessDayLabel();
  const [y, mo] = mes.split("-").map(Number);
  const ultimo = diasEnMes(y, mo);

  // Lo que ya pasó sale de los movimientos, no de los cierres: un día que
  // nunca llegó a cerrar igual tiene movimientos, y si se leyera de los
  // cierres ese día aparecería vacío.
  const porDia = new Map();
  (movimientos || []).forEach((m) => {
    if (!m.fecha || m.fecha.slice(0, 7) !== mes) return;
    const d = porDia.get(m.fecha) || { ganancias: 0, gastos: 0, cantidad: 0 };
    if (m.tipo === "ganancia") d.ganancias += m.monto || 0;
    else if (m.tipo === "gasto") d.gastos += m.monto || 0;
    d.cantidad += 1;
    porDia.set(m.fecha, d);
  });

  const dias = [];
  for (let d = 1; d <= ultimo; d++) {
    const fecha = etiqueta(y, mo, d);
    const reales = porDia.get(fecha) || { ganancias: 0, gastos: 0, cantidad: 0 };
    const esFuturo = fecha > hoy;

    // Los pagos del día: los que caen en esa fecha exacta más los
    // semanales que caen ese día de la semana.
    const pagos = [];
    (recordatorios || []).forEach((r) => {
      if (r.activo === false) return;
      if (r.tipo === "semanal") {
        if (r.dia === diaSemana(fecha)) pagos.push({ id: r.id, label: r.label, monto: r.monto || 0 });
        return;
      }
      if (fechaDelRecordatorioEnMes(r, y, mo) === fecha) {
        pagos.push({ id: r.id, label: r.label, monto: r.monto || 0 });
      }
    });

    // Los gastos de todos los días (almuerzo, gasolina) solo se muestran
    // hacia adelante: para atrás ya está el gasto real, y mostrar los dos
    // haría parecer que gastaste el doble.
    const programado = esFuturo && typeof proyeccionDia === "function" ? proyeccionDia(fecha).total || 0 : 0;

    dias.push({
      fecha,
      dia: d,
      diaSemana: diaSemana(fecha),
      esHoy: fecha === hoy,
      esFuturo,
      ganancias: +reales.ganancias.toFixed(2),
      gastos: +reales.gastos.toFixed(2),
      neto: +(reales.ganancias - reales.gastos).toFixed(2),
      movimientos: reales.cantidad,
      programado: +programado.toFixed(2),
      pagos,
      // Solo hacia adelante: para un dia que ya paso, lo que importa es
      // lo que de verdad gastaste, no lo que tocaba. Que un pago haya
      // vencido y no se marcara es cosa de Pendientes, no del calendario.
      porPagar: esFuturo ? +(programado + pagos.reduce((s, p) => s + p.monto, 0)).toFixed(2) : 0,
    });
  }

  const pasados = dias.filter((d) => !d.esFuturo);
  const futuros = dias.filter((d) => d.esFuturo);

  return {
    mes,
    hoy,
    // Para que el calendario sepa en qué columna empieza el mes.
    empiezaEn: diaSemana(etiqueta(y, mo, 1)),
    dias,
    totales: {
      ganancias: +pasados.reduce((s, d) => s + d.ganancias, 0).toFixed(2),
      gastos: +pasados.reduce((s, d) => s + d.gastos, 0).toFixed(2),
      neto: +pasados.reduce((s, d) => s + d.neto, 0).toFixed(2),
      porPagar: +futuros.reduce((s, d) => s + d.porPagar, 0).toFixed(2),
      diasTrabajados: pasados.filter((d) => d.ganancias > 0).length,
      mejorDia: pasados.reduce((mejor, d) => (!mejor || d.ganancias > mejor.ganancias ? d : mejor), null),
    },
  };
}

module.exports = { armar, diasEnMes };
