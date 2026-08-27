const { crearAlmacen } = require("./almacenPorUsuario");
const businessDay = require("./businessDay");

const MAX_CIERRES = 90; // días de historial de cierres que se conservan
const MAX_MOVIMIENTOS = 20000; // tope de líneas de detalle (poda de las más viejas)


const almacen = crearAlmacen("cashbox-data.json", function (parsed) {
  try {
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
});
const datos = almacen.datos;
const save = almacen.guardar;


// Fecha y hora actuales en Perú (UTC-5, sin horario de verano), sin
// depender de la zona horaria del servidor.
const { peruAhora, fechaLabel, horaLabel, businessDayLabel, diasEnMes: diasEnMesDe } = businessDay;

// Cada movimiento queda registrado con el DÍA LABORAL (7am-7am, no el
// calendario) y la hora real (Perú), para que un registro de la madrugada
// (antes de las 7am) siga agrupado con el día que todavía sigue abierto.
// Id propio de cada movimiento. Sirve para que otra cosa (hoy los
// faltantes) pueda apuntar a un movimiento concreto y seguirlo aunque la
// lista cambie de orden: el índice del arreglo se corre cuando se borra
// algo, el id no. Los movimientos viejos no tienen id y siguen
// funcionando igual, solo que sin ese enlace.
let contadorMovimientos = 0;
function nuevoMovimientoId() {
  contadorMovimientos += 1;
  return `mov_${Date.now()}_${contadorMovimientos}`;
}

function registrarMovimiento(tipo, monto, descripcion) {
  const ahora = peruAhora();
  const movimiento = {
    id: nuevoMovimientoId(),
    fecha: businessDayLabel(),
    hora: horaLabel(ahora),
    tipo,
    monto,
    descripcion: descripcion || "",
  };
  datos().movimientos.push(movimiento);
  if (datos().movimientos.length > MAX_MOVIMIENTOS) {
    datos().movimientos.splice(0, datos().movimientos.length - MAX_MOVIMIENTOS);
  }
  return movimiento;
}

function addGanancia(monto, descripcion) {
  datos().todayGanancias += monto;
  const movimiento = registrarMovimiento("ganancia", monto, descripcion);
  save();
  // Devuelve el id igual que addGasto: hace falta para colgarle la foto de
  // la boleta al movimiento que se acaba de crear.
  return movimiento.id;
}

// Marca que ese movimiento tiene una foto guardada. La imagen vive en el
// disco (recibos/<id>.jpg); aca solo queda la senal para que el panel sepa
// que hay algo que mostrar sin tener que revisar el disco por cada fila.
function marcarRecibo(id) {
  const m = datos().movimientos.find((x) => x.id === id);
  if (!m) return false;
  m.recibo = true;
  save();
  return true;
}

// Devuelve el id del movimiento creado, para poder enlazarlo después
// (ej. el gasto que genera un faltante).
function addGasto(monto, descripcion) {
  datos().todayGastos += monto;
  const movimiento = registrarMovimiento("gasto", monto, descripcion);
  save();
  return movimiento.id;
}

// Un conteo de caja ("1050 caja chica") es borrón y cuenta nueva: la plata
// contada ya absorbe lo ganado/gastado hasta ese momento, así que eso pasa
// al acumulado semanal (para no perderlo del resumen del domingo) y el día
// arranca de nuevo desde este conteo.
function setCaja(monto) {
  datos().weekGanancias += datos().todayGanancias;
  datos().weekGastos += datos().todayGastos;
  datos().todayGanancias = 0;
  datos().todayGastos = 0;
  datos().cajaInicial = monto;
  registrarMovimiento("caja", monto, "conteo de caja");
  save();
}

function getToday() {
  const total = datos().todayGanancias - datos().todayGastos;
  return {
    ganancias: datos().todayGanancias,
    gastos: datos().todayGastos,
    total,
    caja: datos().cajaInicial,
    esperado: datos().cajaInicial + total,
  };
}

// Plata de Ana: totalmente aparte de la caja. "Ana guardó" es lo que ella me
// deja para custodiar; "Ana gastó" es lo que le devuelvo. Son acumulados que
// no se reinician (es un saldo que le sigo debiendo hasta devolverlo).
function registrarAna(tipo, monto, descripcion) {
  const ahora = peruAhora();
  datos().anaMovimientos.push({
    fecha: businessDayLabel(),
    hora: horaLabel(ahora),
    tipo,
    monto,
    descripcion: descripcion || "",
  });
  if (datos().anaMovimientos.length > MAX_MOVIMIENTOS) {
    datos().anaMovimientos.splice(0, datos().anaMovimientos.length - MAX_MOVIMIENTOS);
  }
}

function addAnaGuardo(monto, descripcion) {
  datos().anaGuardado += monto;
  registrarAna("guardo", monto, descripcion);
  save();
}

function addAnaGasto(monto, descripcion) {
  datos().anaGastado += monto;
  registrarAna("gasto", monto, descripcion);
  save();
}

function getAna() {
  return {
    guardado: datos().anaGuardado,
    gastado: datos().anaGastado,
    saldo: datos().anaGuardado - datos().anaGastado,
  };
}

function getAnaMovimientos() {
  return datos().anaMovimientos;
}

function efectoAna(tipo, monto, signo) {
  // "guardo" sube lo guardado, "gasto" sube lo gastado/retirado.
  return tipo === "guardo" ? { g: signo * monto, gs: 0 } : { g: 0, gs: signo * monto };
}

// Edita un movimiento puntual de Ana (por índice): revierte su efecto
// viejo sobre guardado/gastado y aplica el nuevo.
function editAnaMovimiento(indice, cambios) {
  const mov = datos().anaMovimientos[indice];
  if (!mov) return null;

  const viejo = efectoAna(mov.tipo, mov.monto, -1);
  datos().anaGuardado += viejo.g;
  datos().anaGastado += viejo.gs;

  if (cambios.tipo !== undefined) mov.tipo = cambios.tipo;
  if (cambios.monto !== undefined) mov.monto = Number(cambios.monto) || 0;
  if (cambios.descripcion !== undefined) mov.descripcion = cambios.descripcion;
  if (cambios.fecha !== undefined) mov.fecha = cambios.fecha;
  if (cambios.hora !== undefined) mov.hora = cambios.hora;

  const nuevo = efectoAna(mov.tipo, mov.monto, 1);
  datos().anaGuardado += nuevo.g;
  datos().anaGastado += nuevo.gs;

  save();
  return mov;
}

// Elimina un movimiento puntual de Ana y revierte su efecto.
function removeAnaMovimiento(indice) {
  const mov = datos().anaMovimientos[indice];
  if (!mov) return false;
  const efecto = efectoAna(mov.tipo, mov.monto, -1);
  datos().anaGuardado += efecto.g;
  datos().anaGastado += efecto.gs;
  datos().anaMovimientos.splice(indice, 1);
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
  datos().cierres.push({ fecha: dayLabel, ...resumen });
  if (datos().cierres.length > MAX_CIERRES) {
    datos().cierres.splice(0, datos().cierres.length - MAX_CIERRES);
  }
  datos().weekGanancias += datos().todayGanancias;
  datos().weekGastos += datos().todayGastos;
  datos().todayGanancias = 0;
  datos().todayGastos = 0;
  datos().cajaInicial = resumen.esperado;
  datos().lastClosedDay = dayLabel;
  save();
  return resumen;
}

// Cierra la semana: devuelve el resumen semanal y la deja en cero.
function closeWeek(weekLabel) {
  const resumen = { ganancias: datos().weekGanancias, gastos: datos().weekGastos };
  datos().weekGanancias = 0;
  datos().weekGastos = 0;
  datos().lastClosedWeek = weekLabel;
  save();
  return resumen;
}

// Reconstruye por completo un día (para corregir el Excel a mano): borra los
// movimientos que había de esa fecha y los reemplaza por la lista dada,
// fija la caja inicial, y si es hoy actualiza los totales del día en curso
// (si ya estaba cerrado, corrige su cierre). Opcionalmente reinicia Ana.
function rebuildDay(fecha, caja, movs, resetAna) {
  datos().movimientos = datos().movimientos.filter((m) => m.fecha !== fecha);
  let g = 0;
  let gs = 0;
  (movs || []).forEach((m) => {
    const monto = Number(m.monto) || 0;
    datos().movimientos.push({
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
    datos().todayGanancias = g;
    datos().todayGastos = gs;
    datos().cajaInicial = cajaNum;
  } else {
    const cierre = datos().cierres.find((c) => c.fecha === fecha);
    if (cierre) {
      cierre.ganancias = g;
      cierre.gastos = gs;
      cierre.total = g - gs;
      cierre.caja = cajaNum;
      cierre.esperado = cajaNum + (g - gs);
    }
  }
  if (resetAna) {
    datos().anaGuardado = 0;
    datos().anaGastado = 0;
    datos().anaMovimientos = (datos().anaMovimientos || []).filter((m) => m.fecha !== fecha);
  }
  save();
  return { fecha, caja: cajaNum, ganancias: g, gastos: gs, total: g - gs, esperado: cajaNum + (g - gs) };
}

function getMovimientos() {
  return datos().movimientos;
}

// Suma (o resta) el efecto de un movimiento de ganancia/gasto sobre los
// totales de su fecha: si es hoy, ajusta el día en curso; si ya cerró,
// corrige su cierre guardado. Usado por editMovimiento/removeMovimiento/
// addMovimientoManual para que el panel pueda corregir cualquier
// movimiento sin romper el efectivo esperado.
function ajustarTotalesPorFecha(fecha, deltaGanancia, deltaGasto) {
  const esHoy = fecha === businessDayLabel();
  if (esHoy) {
    datos().todayGanancias += deltaGanancia;
    datos().todayGastos += deltaGasto;
  } else {
    const cierre = datos().cierres.find((c) => c.fecha === fecha);
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
  // Sin fecha explícita va el DÍA LABORAL, igual que los movimientos que
  // entran por WhatsApp. Antes usaba la fecha del calendario: de madrugada
  // (entre las 12 y las 7am, que todavía es el día laboral anterior) las
  // dos no coincidían y el movimiento quedaba en la lista sin descontarse
  // nunca de la caja.
  const f = fecha || businessDayLabel();
  const h = hora || horaLabel(ahora);
  const movimiento = { id: nuevoMovimientoId(), fecha: f, hora: h, tipo, monto, descripcion: descripcion || "" };
  datos().movimientos.push(movimiento);
  const efecto = efectoDelta(tipo, monto, 1);
  ajustarTotalesPorFecha(f, efecto.g, efecto.gs);
  save();
  return movimiento.id;
}

// Edita un movimiento existente (por índice en el arreglo que devuelve
// getMovimientos): revierte su efecto viejo sobre los totales, aplica los
// cambios, y vuelve a sumar el efecto nuevo (incluso si cambió de fecha).
function editMovimiento(indice, cambios) {
  const mov = datos().movimientos[indice];
  if (!mov) return null;

  const viejo = efectoDelta(mov.tipo, mov.monto, -1);
  ajustarTotalesPorFecha(mov.fecha, viejo.g, viejo.gs);

  if (cambios.tipo !== undefined) mov.tipo = cambios.tipo;
  if (cambios.monto !== undefined) mov.monto = Number(cambios.monto) || 0;
  if (cambios.descripcion !== undefined) mov.descripcion = cambios.descripcion;
  if (cambios.fecha !== undefined) mov.fecha = cambios.fecha;
  if (cambios.hora !== undefined) mov.hora = cambios.hora;
  // Categoría asignada a mano desde el panel: pisa la clasificación
  // automática por palabras clave. Mandar vacío/null la borra (vuelve a
  // clasificarse solo según su descripción).
  if (cambios.categoriaId !== undefined) {
    if (cambios.categoriaId) mov.categoriaId = cambios.categoriaId;
    else delete mov.categoriaId;
  }

  const nuevo = efectoDelta(mov.tipo, mov.monto, 1);
  ajustarTotalesPorFecha(mov.fecha, nuevo.g, nuevo.gs);

  save();
  return mov;
}

// Las dos de abajo son las mismas de arriba pero buscando por id en vez de
// por índice, para lo que necesita seguir un movimiento concreto aunque la
// lista se haya movido (ej. el gasto enlazado a un faltante).
function editMovimientoPorId(id, cambios) {
  const indice = datos().movimientos.findIndex((m) => m.id === id);
  return indice === -1 ? null : editMovimiento(indice, cambios);
}

function removeMovimientoPorId(id) {
  const indice = datos().movimientos.findIndex((m) => m.id === id);
  return indice === -1 ? false : removeMovimiento(indice);
}

// Elimina un movimiento (por índice) y revierte su efecto de los totales.
function removeMovimiento(indice) {
  const mov = datos().movimientos[indice];
  if (!mov) return false;
  const efecto = efectoDelta(mov.tipo, mov.monto, -1);
  ajustarTotalesPorFecha(mov.fecha, efecto.g, efecto.gs);
  datos().movimientos.splice(indice, 1);
  save();
  return true;
}

function getCierres() {
  return datos().cierres;
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
  const cierre = datos().cierres.find((c) => c.fecha === fecha);
  if (!cierre) return null;

  if (cambios.ganancias !== undefined) cierre.ganancias = Number(cambios.ganancias) || 0;
  if (cambios.gastos !== undefined) cierre.gastos = Number(cambios.gastos) || 0;
  if (cambios.caja !== undefined) cierre.caja = Number(cambios.caja) || 0;
  cierre.total = cierre.ganancias - cierre.gastos;
  cierre.esperado = cierre.caja + cierre.total;

  const siguiente = fechaSiguiente(fecha);
  const cierreSiguiente = datos().cierres.find((c) => c.fecha === siguiente);
  if (cierreSiguiente) {
    cierreSiguiente.caja = cierre.esperado;
    cierreSiguiente.total = cierreSiguiente.ganancias - cierreSiguiente.gastos;
    cierreSiguiente.esperado = cierreSiguiente.caja + cierreSiguiente.total;
  } else if (siguiente === businessDayLabel()) {
    datos().cajaInicial = cierre.esperado;
  }

  save();
  return cierre;
}

function getLastClosedDay() {
  return datos().lastClosedDay;
}

function getLastClosedWeek() {
  return datos().lastClosedWeek;
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
    ganancias: datos().weekGanancias + datos().todayGanancias,
    gastos: datos().weekGastos + datos().todayGastos,
  };
}

// Lo acumulado del mes en curso (sumando los cierres diarios de este mes)
// más lo que va del día de hoy, para medir el progreso de la meta mensual.
function getMonthSoFar() {
  const mesActual = getMesActualLabel();
  let ganancias = datos().todayGanancias;
  let gastos = datos().todayGastos;
  datos().cierres.forEach((c) => {
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
  datos().cierres.forEach((c) => {
    if (c.fecha.slice(0, 7) === mesAnteriorLabel) {
      ganancias += c.ganancias;
      gastos += c.gastos;
    }
  });
  return { ganancias, gastos };
}

// Día del mes en curso, cuántos días tiene el mes, y cuántos quedan
// (incluyendo hoy), para calcular cuánto ahorrar por día y proyectar el
// cierre de mes. Usa el día LABORAL (no el calendario): antes de las 7am
// todavía cuenta como el día de ayer, igual que en el resto del sistema.
function getDiasDelMes() {
  const hoy = businessDayLabel();
  const [y, mo, d] = hoy.split("-").map(Number);
  const totalDiasMes = diasEnMesDe(y, mo);
  return { diaActual: d, diasEnMes: totalDiasMes, diasRestantes: totalDiasMes - d + 1 };
}

// Lo acumulado de la quincena en curso (días 1-15, o 16 hasta fin de mes)
// más lo que va del día de hoy, para medir progreso a mitad de mes.
// Cuanto se gano, gasto y ahorro entre dos fechas cualesquiera. Los dias
// ya cerrados salen de los cierres; el dia en curso todavia no tiene
// cierre, asi que se suma aparte cuando cae dentro del rango.
function getRangoTotals(desde, hasta) {
  const hoy = businessDayLabel();
  let ganancias = 0;
  let gastos = 0;
  datos().cierres.forEach((c) => {
    if (c.fecha >= desde && c.fecha <= hasta) {
      ganancias += c.ganancias;
      gastos += c.gastos;
    }
  });
  if (hoy >= desde && hoy <= hasta) {
    ganancias += datos().todayGanancias;
    gastos += datos().todayGastos;
  }
  return { desde, hasta, ganancias, gastos, ahorro: ganancias - gastos };
}

function getQuincenaSoFar() {
  const hoy = businessDayLabel();
  const [, , d] = hoy.split("-").map(Number);
  const inicioDia = d <= 15 ? 1 : 16;
  const inicioLabel = `${hoy.slice(0, 7)}-${String(inicioDia).padStart(2, "0")}`;
  let ganancias = datos().todayGanancias;
  let gastos = datos().todayGastos;
  datos().cierres.forEach((c) => {
    if (c.fecha >= inicioLabel && c.fecha.slice(0, 7) === hoy.slice(0, 7)) {
      ganancias += c.ganancias;
      gastos += c.gastos;
    }
  });
  return { ganancias, gastos, diaInicioQuincena: inicioDia, diasTranscurridos: d - inicioDia + 1 };
}

module.exports = {
  addGanancia,
  addGasto,
  marcarRecibo,
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
  getRangoTotals,
  getQuincenaSoFar,
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
  editMovimientoPorId,
  removeMovimientoPorId,
};
