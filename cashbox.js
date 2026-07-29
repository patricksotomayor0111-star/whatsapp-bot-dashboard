const fs = require("fs");
const { dataPath } = require("./dataDir");
const businessDay = require("./businessDay");

const DATA_PATH = dataPath("cashbox-data.json");
const MAX_CIERRES = 90; // días de historial de cierres que se conservan
const MAX_MOVIMIENTOS = 20000; // tope de líneas de detalle (poda de las más viejas)

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      todayGanancias: parsed.todayGanancias || 0,
      todayGastos: parsed.todayGastos || 0,
      cajaInicial: parsed.cajaInicial || 0,
      weekGanancias: parsed.weekGanancias || 0,
      weekGastos: parsed.weekGastos || 0,
      movimientos: parsed.movimientos || [],
      cierres: parsed.cierres || [],
      lastClosedDay: parsed.lastClosedDay || null,
      lastClosedWeek: parsed.lastClosedWeek || null,
      // Plata de Ana (aparte de la caja): saldos acumulados que NO se
      // reinician con el día ni la semana, y su propio detalle para el Excel.
      anaGuardado: parsed.anaGuardado || 0,
      anaGastado: parsed.anaGastado || 0,
      anaMovimientos: parsed.anaMovimientos || [],
    };
  } catch (err) {
    return {
      todayGanancias: 0,
      todayGastos: 0,
      cajaInicial: 0,
      weekGanancias: 0,
      weekGastos: 0,
      movimientos: [],
      cierres: [],
      lastClosedDay: null,
      lastClosedWeek: null,
      anaGuardado: 0,
      anaGastado: 0,
      anaMovimientos: [],
    };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar cashbox-data.json:", err.message);
  }
}

// Fecha y hora actuales en Perú (UTC-5, sin horario de verano), sin
// depender de la zona horaria del servidor.
const { peruAhora, fechaLabel, horaLabel, businessDayLabel } = businessDay;

// Cada movimiento queda registrado con el DÍA LABORAL (7am-7am, no el
// calendario) y la hora real (Perú), para que un registro de la madrugada
// (antes de las 7am) siga agrupado con el día que todavía sigue abierto.
function registrarMovimiento(tipo, monto, descripcion) {
  const ahora = peruAhora();
  data.movimientos.push({
    fecha: businessDayLabel(),
    hora: horaLabel(ahora),
    tipo,
    monto,
    descripcion: descripcion || "",
  });
  if (data.movimientos.length > MAX_MOVIMIENTOS) {
    data.movimientos.splice(0, data.movimientos.length - MAX_MOVIMIENTOS);
  }
}

function addGanancia(monto, descripcion) {
  data.todayGanancias += monto;
  registrarMovimiento("ganancia", monto, descripcion);
  save();
}

function addGasto(monto, descripcion) {
  data.todayGastos += monto;
  registrarMovimiento("gasto", monto, descripcion);
  save();
}

// Un conteo de caja ("1050 caja chica") es borrón y cuenta nueva: la plata
// contada ya absorbe lo ganado/gastado hasta ese momento, así que eso pasa
// al acumulado semanal (para no perderlo del resumen del domingo) y el día
// arranca de nuevo desde este conteo.
function setCaja(monto) {
  data.weekGanancias += data.todayGanancias;
  data.weekGastos += data.todayGastos;
  data.todayGanancias = 0;
  data.todayGastos = 0;
  data.cajaInicial = monto;
  registrarMovimiento("caja", monto, "conteo de caja");
  save();
}

function getToday() {
  const total = data.todayGanancias - data.todayGastos;
  return {
    ganancias: data.todayGanancias,
    gastos: data.todayGastos,
    total,
    caja: data.cajaInicial,
    esperado: data.cajaInicial + total,
  };
}

// Plata de Ana: totalmente aparte de la caja. "Ana guardó" es lo que ella me
// deja para custodiar; "Ana gastó" es lo que le devuelvo. Son acumulados que
// no se reinician (es un saldo que le sigo debiendo hasta devolverlo).
function registrarAna(tipo, monto, descripcion) {
  const ahora = peruAhora();
  data.anaMovimientos.push({
    fecha: businessDayLabel(),
    hora: horaLabel(ahora),
    tipo,
    monto,
    descripcion: descripcion || "",
  });
  if (data.anaMovimientos.length > MAX_MOVIMIENTOS) {
    data.anaMovimientos.splice(0, data.anaMovimientos.length - MAX_MOVIMIENTOS);
  }
}

function addAnaGuardo(monto, descripcion) {
  data.anaGuardado += monto;
  registrarAna("guardo", monto, descripcion);
  save();
}

function addAnaGasto(monto, descripcion) {
  data.anaGastado += monto;
  registrarAna("gasto", monto, descripcion);
  save();
}

function getAna() {
  return {
    guardado: data.anaGuardado,
    gastado: data.anaGastado,
    saldo: data.anaGuardado - data.anaGastado,
  };
}

function getAnaMovimientos() {
  return data.anaMovimientos;
}

function efectoAna(tipo, monto, signo) {
  // "guardo" sube lo guardado, "gasto" sube lo gastado/retirado.
  return tipo === "guardo" ? { g: signo * monto, gs: 0 } : { g: 0, gs: signo * monto };
}

// Edita un movimiento puntual de Ana (por índice): revierte su efecto
// viejo sobre guardado/gastado y aplica el nuevo.
function editAnaMovimiento(indice, cambios) {
  const mov = data.anaMovimientos[indice];
  if (!mov) return null;

  const viejo = efectoAna(mov.tipo, mov.monto, -1);
  data.anaGuardado += viejo.g;
  data.anaGastado += viejo.gs;

  if (cambios.tipo !== undefined) mov.tipo = cambios.tipo;
  if (cambios.monto !== undefined) mov.monto = Number(cambios.monto) || 0;
  if (cambios.descripcion !== undefined) mov.descripcion = cambios.descripcion;
  if (cambios.fecha !== undefined) mov.fecha = cambios.fecha;
  if (cambios.hora !== undefined) mov.hora = cambios.hora;

  const nuevo = efectoAna(mov.tipo, mov.monto, 1);
  data.anaGuardado += nuevo.g;
  data.anaGastado += nuevo.gs;

  save();
  return mov;
}

// Elimina un movimiento puntual de Ana y revierte su efecto.
function removeAnaMovimiento(indice) {
  const mov = data.anaMovimientos[indice];
  if (!mov) return false;
  const efecto = efectoAna(mov.tipo, mov.monto, -1);
  data.anaGuardado += efecto.g;
  data.anaGastado += efecto.gs;
  data.anaMovimientos.splice(indice, 1);
  save();
  return true;
}

// Cierra el día: guarda el resumen en el historial de cierres (para el
// Excel), suma lo del día a la semana, y deja el día en cero. La caja NO se
// resetea a 0: es un saldo corrido, así que mañana arranca con el efectivo
// esperado de hoy (el conteo manual "N caja" sigue sirviendo para corregirla
// contra la plata física real cuando el usuario quiera).
function closeDay(dayLabel) {
  const resumen = getToday();
  data.cierres.push({ fecha: dayLabel, ...resumen });
  if (data.cierres.length > MAX_CIERRES) {
    data.cierres.splice(0, data.cierres.length - MAX_CIERRES);
  }
  data.weekGanancias += data.todayGanancias;
  data.weekGastos += data.todayGastos;
  data.todayGanancias = 0;
  data.todayGastos = 0;
  data.cajaInicial = resumen.esperado;
  data.lastClosedDay = dayLabel;
  save();
  return resumen;
}

// Cierra la semana: devuelve el resumen semanal y la deja en cero.
function closeWeek(weekLabel) {
  const resumen = { ganancias: data.weekGanancias, gastos: data.weekGastos };
  data.weekGanancias = 0;
  data.weekGastos = 0;
  data.lastClosedWeek = weekLabel;
  save();
  return resumen;
}

// Reconstruye por completo un día (para corregir el Excel a mano): borra los
// movimientos que había de esa fecha y los reemplaza por la lista dada,
// fija la caja inicial, y si es hoy actualiza los totales del día en curso
// (si ya estaba cerrado, corrige su cierre). Opcionalmente reinicia Ana.
function rebuildDay(fecha, caja, movs, resetAna) {
  data.movimientos = data.movimientos.filter((m) => m.fecha !== fecha);
  let g = 0;
  let gs = 0;
  (movs || []).forEach((m) => {
    const monto = Number(m.monto) || 0;
    data.movimientos.push({
      fecha,
      hora: m.hora || "",
      tipo: m.tipo,
      monto,
      descripcion: m.descripcion || "",
    });
    if (m.tipo === "ganancia") g += monto;
    else if (m.tipo === "gasto") gs += monto;
  });
  const cajaNum = Number(caja) || 0;
  const esHoy = fecha === businessDayLabel();
  if (esHoy) {
    data.todayGanancias = g;
    data.todayGastos = gs;
    data.cajaInicial = cajaNum;
  } else {
    const cierre = data.cierres.find((c) => c.fecha === fecha);
    if (cierre) {
      cierre.ganancias = g;
      cierre.gastos = gs;
      cierre.total = g - gs;
      cierre.caja = cajaNum;
      cierre.esperado = cajaNum + (g - gs);
    }
  }
  if (resetAna) {
    data.anaGuardado = 0;
    data.anaGastado = 0;
    data.anaMovimientos = (data.anaMovimientos || []).filter((m) => m.fecha !== fecha);
  }
  save();
  return { fecha, caja: cajaNum, ganancias: g, gastos: gs, total: g - gs, esperado: cajaNum + (g - gs) };
}

function getMovimientos() {
  return data.movimientos;
}

// Suma (o resta) el efecto de un movimiento de ganancia/gasto sobre los
// totales de su fecha: si es hoy, ajusta el día en curso; si ya cerró,
// corrige su cierre guardado. Usado por editMovimiento/removeMovimiento/
// addMovimientoManual para que el panel pueda corregir cualquier
// movimiento sin romper el efectivo esperado.
function ajustarTotalesPorFecha(fecha, deltaGanancia, deltaGasto) {
  const esHoy = fecha === businessDayLabel();
  if (esHoy) {
    data.todayGanancias += deltaGanancia;
    data.todayGastos += deltaGasto;
  } else {
    const cierre = data.cierres.find((c) => c.fecha === fecha);
    if (cierre) {
      cierre.ganancias += deltaGanancia;
      cierre.gastos += deltaGasto;
      cierre.total = cierre.ganancias - cierre.gastos;
      cierre.esperado = cierre.caja + cierre.total;
    }
  }
}

function efectoDelta(tipo, monto, signo) {
  if (tipo === "ganancia") return { g: signo * monto, gs: 0 };
  if (tipo === "gasto") return { g: 0, gs: signo * monto };
  return { g: 0, gs: 0 }; // "caja" (conteo) no participa de este ajuste
}

// Agrega un movimiento manual desde el panel (fecha/hora editable, por si
// se quiere registrar algo de un día pasado).
function addMovimientoManual(tipo, monto, descripcion, fecha, hora) {
  const ahora = peruAhora();
  const f = fecha || fechaLabel(ahora);
  const h = hora || horaLabel(ahora);
  data.movimientos.push({ fecha: f, hora: h, tipo, monto, descripcion: descripcion || "" });
  const efecto = efectoDelta(tipo, monto, 1);
  ajustarTotalesPorFecha(f, efecto.g, efecto.gs);
  save();
}

// Edita un movimiento existente (por índice en el arreglo que devuelve
// getMovimientos): revierte su efecto viejo sobre los totales, aplica los
// cambios, y vuelve a sumar el efecto nuevo (incluso si cambió de fecha).
function editMovimiento(indice, cambios) {
  const mov = data.movimientos[indice];
  if (!mov) return null;

  const viejo = efectoDelta(mov.tipo, mov.monto, -1);
  ajustarTotalesPorFecha(mov.fecha, viejo.g, viejo.gs);

  if (cambios.tipo !== undefined) mov.tipo = cambios.tipo;
  if (cambios.monto !== undefined) mov.monto = Number(cambios.monto) || 0;
  if (cambios.descripcion !== undefined) mov.descripcion = cambios.descripcion;
  if (cambios.fecha !== undefined) mov.fecha = cambios.fecha;
  if (cambios.hora !== undefined) mov.hora = cambios.hora;

  const nuevo = efectoDelta(mov.tipo, mov.monto, 1);
  ajustarTotalesPorFecha(mov.fecha, nuevo.g, nuevo.gs);

  save();
  return mov;
}

// Elimina un movimiento (por índice) y revierte su efecto de los totales.
function removeMovimiento(indice) {
  const mov = data.movimientos[indice];
  if (!mov) return false;
  const efecto = efectoDelta(mov.tipo, mov.monto, -1);
  ajustarTotalesPorFecha(mov.fecha, efecto.g, efecto.gs);
  data.movimientos.splice(indice, 1);
  save();
  return true;
}

function getCierres() {
  return data.cierres;
}

// "YYYY-MM-DD" del día siguiente a uno dado (sin conversión de huso
// horario: es aritmética simple sobre una fecha ya en hora Perú).
function fechaSiguiente(fecha) {
  const [y, m, d] = fecha.split("-").map(Number);
  return fechaLabel(new Date(y, m - 1, d + 1));
}

// Edita un día ya cerrado (ganancias/gastos/caja inicial) y recalcula su
// total y efectivo esperado. Si el día siguiente ya tiene su propio
// cierre, le actualiza la caja inicial para que la cadena siga cuadrando
// (un solo salto, no en cadena); si el día siguiente es hoy (todavía sin
// cerrar), le actualiza directo la caja inicial del día en curso.
function editCierre(fecha, cambios) {
  const cierre = data.cierres.find((c) => c.fecha === fecha);
  if (!cierre) return null;

  if (cambios.ganancias !== undefined) cierre.ganancias = Number(cambios.ganancias) || 0;
  if (cambios.gastos !== undefined) cierre.gastos = Number(cambios.gastos) || 0;
  if (cambios.caja !== undefined) cierre.caja = Number(cambios.caja) || 0;
  cierre.total = cierre.ganancias - cierre.gastos;
  cierre.esperado = cierre.caja + cierre.total;

  const siguiente = fechaSiguiente(fecha);
  const cierreSiguiente = data.cierres.find((c) => c.fecha === siguiente);
  if (cierreSiguiente) {
    cierreSiguiente.caja = cierre.esperado;
    cierreSiguiente.total = cierreSiguiente.ganancias - cierreSiguiente.gastos;
    cierreSiguiente.esperado = cierreSiguiente.caja + cierreSiguiente.total;
  } else if (siguiente === businessDayLabel()) {
    data.cajaInicial = cierre.esperado;
  }

  save();
  return cierre;
}

function getLastClosedDay() {
  return data.lastClosedDay;
}

function getLastClosedWeek() {
  return data.lastClosedWeek;
}

// "YYYY-MM" del mes actual (hora Perú), para agrupar gastos por mes en
// el resumen de categorías con límite mensual.
function getMesActualLabel() {
  return businessDayLabel().slice(0, 7);
}

// "YYYY-MM-DD" de hoy (hora Perú), para que los gráficos puedan ubicar el
// día en curso junto al historial de días ya cerrados.
function getHoyLabel() {
  return businessDayLabel();
}

// Lo acumulado de la semana (weekGanancias/weekGastos, que solo se suman
// recién al cerrar el día) más lo que va del día de hoy, para poder medir
// el progreso de la meta semanal sin esperar al cierre.
function getWeekSoFar() {
  return {
    ganancias: data.weekGanancias + data.todayGanancias,
    gastos: data.weekGastos + data.todayGastos,
  };
}

// Lo acumulado del mes en curso (sumando los cierres diarios de este mes)
// más lo que va del día de hoy, para medir el progreso de la meta mensual.
function getMonthSoFar() {
  const mesActual = getMesActualLabel();
  let ganancias = data.todayGanancias;
  let gastos = data.todayGastos;
  data.cierres.forEach((c) => {
    if (c.fecha.slice(0, 7) === mesActual) {
      ganancias += c.ganancias;
      gastos += c.gastos;
    }
  });
  return { ganancias, gastos };
}

// Totales del mes anterior (a partir de los cierres guardados), para
// comparar el mes en curso contra el que ya pasó.
function getPreviousMonthTotals() {
  const ahora = peruAhora();
  const mesAnteriorDate = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  const mesAnteriorLabel = `${mesAnteriorDate.getFullYear()}-${String(mesAnteriorDate.getMonth() + 1).padStart(2, "0")}`;
  let ganancias = 0;
  let gastos = 0;
  data.cierres.forEach((c) => {
    if (c.fecha.slice(0, 7) === mesAnteriorLabel) {
      ganancias += c.ganancias;
      gastos += c.gastos;
    }
  });
  return { ganancias, gastos };
}

// Día del mes en curso, cuántos días tiene el mes, y cuántos quedan
// (incluyendo hoy), para calcular cuánto ahorrar por día y proyectar el
// cierre de mes.
function getDiasDelMes() {
  const ahora = peruAhora();
  const diaActual = ahora.getDate();
  const diasEnMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
  return { diaActual, diasEnMes, diasRestantes: diasEnMes - diaActual + 1 };
}

module.exports = {
  addGanancia,
  addGasto,
  setCaja,
  getToday,
  closeDay,
  closeWeek,
  getMovimientos,
  getCierres,
  editCierre,
  getLastClosedDay,
  getLastClosedWeek,
  getMesActualLabel,
  getHoyLabel,
  getWeekSoFar,
  getMonthSoFar,
  getPreviousMonthTotals,
  getDiasDelMes,
  addAnaGuardo,
  addAnaGasto,
  getAna,
  getAnaMovimientos,
  editAnaMovimiento,
  removeAnaMovimiento,
  rebuildDay,
  addMovimientoManual,
  editMovimiento,
  removeMovimiento,
};
