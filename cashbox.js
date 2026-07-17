const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "cashbox-data.json");

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      todayGanancias: parsed.todayGanancias || 0,
      todayGastos: parsed.todayGastos || 0,
      weekGanancias: parsed.weekGanancias || 0,
      weekGastos: parsed.weekGastos || 0,
      lastClosedDay: parsed.lastClosedDay || null,
      lastClosedWeek: parsed.lastClosedWeek || null,
    };
  } catch (err) {
    return {
      todayGanancias: 0,
      todayGastos: 0,
      weekGanancias: 0,
      weekGastos: 0,
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

function addGanancia(monto) {
  data.todayGanancias += monto;
  save();
}

function addGasto(monto) {
  data.todayGastos += monto;
  save();
}

function getToday() {
  return {
    ganancias: data.todayGanancias,
    gastos: data.todayGastos,
    total: data.todayGanancias - data.todayGastos,
  };
}

// Cierra el día: suma lo del día a la semana, devuelve el resumen del día
// que se está cerrando, y deja el día en cero para que arranque de nuevo.
function closeDay(dayLabel) {
  const resumen = {
    ganancias: data.todayGanancias,
    gastos: data.todayGastos,
    total: data.todayGanancias - data.todayGastos,
  };
  data.weekGanancias += data.todayGanancias;
  data.weekGastos += data.todayGastos;
  data.todayGanancias = 0;
  data.todayGastos = 0;
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

function getLastClosedDay() {
  return data.lastClosedDay;
}

function getLastClosedWeek() {
  return data.lastClosedWeek;
}

module.exports = {
  addGanancia,
  addGasto,
  getToday,
  closeDay,
  closeWeek,
  getLastClosedDay,
  getLastClosedWeek,
};
