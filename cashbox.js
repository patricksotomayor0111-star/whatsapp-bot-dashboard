const fs = require("fs");
const { dataPath } = require("./dataDir");

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
function peruAhora() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs - 5 * 3600000);
}

function fechaLabel(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dia}`;
}

function horaLabel(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Cada movimiento queda registrado con fecha y hora (Perú) para poder
// exportar el detalle completo a Excel.
function registrarMovimiento(tipo, monto, descripcion) {
  const ahora = peruAhora();
  data.movimientos.push({
    fecha: fechaLabel(ahora),
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

// Cierra el día: guarda el resumen en el historial de cierres (para el
// Excel), suma lo del día a la semana, y deja día y caja en cero.
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
  data.cajaInicial = 0;
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

function getMovimientos() {
  return data.movimientos;
}

function getCierres() {
  return data.cierres;
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
  return fechaLabel(peruAhora()).slice(0, 7);
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
  getLastClosedDay,
  getLastClosedWeek,
  getMesActualLabel,
};
