// Utilidades de fecha/hora compartidas por todo el sistema (cashbox.js,
// reminders.js, bot.js). Centralizadas acá para que el "día laboral" se
// calcule en un solo lugar y no haya versiones ligeramente distintas
// repetidas en cada archivo.
//
// El día laboral va de las 7:00am a las 6:59am del día siguiente (el
// cierre automático corre a las 3:00am, pero el límite de a qué día
// laboral pertenece un movimiento se resuelve a las 7am): antes de las
// 7am todavía es el día laboral que empezó ayer.

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

function horaPeru() {
  return peruAhora().getHours();
}

function ymdToUtc(label) {
  const [y, mo, d] = label.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

function utcToLabel(dt) {
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function addDays(label, n) {
  const dt = ymdToUtc(label);
  dt.setUTCDate(dt.getUTCDate() + n);
  return utcToLabel(dt);
}

function diasEnMes(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate(); // día 0 del mes siguiente = último de este
}

// Etiqueta "YYYY-MM-DD" del día laboral al que pertenece una fecha/hora dada
// (separada de businessDayLabel() para poder probarla sin depender del
// reloj real).
function businessDayLabelFor(d) {
  const label = fechaLabel(d);
  return d.getHours() < 7 ? addDays(label, -1) : label;
}

// Etiqueta "YYYY-MM-DD" del día laboral en curso.
function businessDayLabel() {
  return businessDayLabelFor(peruAhora());
}

module.exports = {
  peruAhora,
  fechaLabel,
  horaLabel,
  horaPeru,
  ymdToUtc,
  utcToLabel,
  addDays,
  diasEnMes,
  businessDayLabelFor,
  businessDayLabel,
};
