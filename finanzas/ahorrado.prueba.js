const ahorrado = require("./ahorrado");
const scheduledExpenses = require("./scheduledExpenses");
const businessDay = require("./businessDay");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}

// Un mes ya pasado, para que nada quede "en el futuro".
const MES = "2026-03";
const gastos = [
  { id: "alm", label: "Almuerzos diarios", monto: 20, tipo: "rango", fechaInicio: MES + "-01", fechaFin: null, activo: true },
  { id: "sab", label: "Salida familiar", monto: 100, tipo: "semanal", dia: 6, fechaInicio: MES + "-01", fechaFin: null, activo: true },
  { id: "off", label: "Apagado", monto: 999, tipo: "rango", fechaInicio: MES + "-01", fechaFin: null, activo: false },
];

const movs = [
  { tipo: "gasto", fecha: MES + "-01", monto: 20, descripcion: "almuerzo pollo" },
  { tipo: "gasto", fecha: MES + "-02", monto: 12, descripcion: "almuerzo" },
  { tipo: "gasto", fecha: MES + "-03", monto: 40, descripcion: "gasolina" },
  // Una ganancia no puede contar como gasto.
  { tipo: "ganancia", fecha: MES + "-04", monto: 500, descripcion: "almuerzo bum" },
];

const r = ahorrado.calcular({ desde: MES + "-01", hasta: MES + "-05", gastos, movimientos: movs });

ok(r.dias.length === 5, "trae un día por cada día del tramo");
ok(r.dias[0].planeado === 20 && r.dias[0].gastado === 20, "el día que gastaste todo");
ok(r.dias[0].ahorro === 0, "no te ahorraste nada ese día");
ok(r.dias[1].gastado === 12 && r.dias[1].ahorro === 8, "gastar de menos deja la diferencia");
ok(r.dias[2].ahorro === 20, "el día que gastaste en otra cosa, el almuerzo sigue sin gastarse");
ok(r.dias[3].ahorro === 20, "una ganancia no cuenta como que lo gastaste");
ok(r.total === 68, "el total del tramo");
ok(r.planeado === 100, "lo planeado es solo de los gastos activos");
ok(!r.conceptos.some((c) => c.label === "Apagado"), "un gasto apagado no se cuenta");

// El singular y el plural tienen que ser la misma palabra: sin eso,
// "almuerzo" no reconocía "Almuerzos diarios" y el ahorro salía inflado.
ok(scheduledExpenses.describeCoincide(scheduledExpenses.clavesDe("Almuerzos diarios"), "almuerzo"), "plural y singular son lo mismo");
ok(!scheduledExpenses.describeCoincide(scheduledExpenses.clavesDe("Almuerzos diarios"), "gasolina"), "y lo que no es, no es");
ok(JSON.stringify(scheduledExpenses.clavesDe("gas")) === '["gas"]', "no destroza palabras cortas");
ok(JSON.stringify(scheduledExpenses.clavesDe("mes")) === '["mes"]', "ni 'mes'");

// El semanal cae solo su día.
const sabados = r.dias.filter((d) => d.diaSemana === 6);
ok(sabados.every((d) => d.planeado === 120), "el sábado se suma la salida familiar");
ok(r.dias.filter((d) => d.diaSemana !== 6).every((d) => d.planeado === 20), "los otros días solo el almuerzo");

// Un gasto con fechas no cuenta fuera de ellas.
const acotado = [{ id: "x", label: "Pasaje", monto: 5, tipo: "rango", fechaInicio: MES + "-03", fechaFin: MES + "-04", activo: true }];
const r2 = ahorrado.calcular({ desde: MES + "-01", hasta: MES + "-06", gastos: acotado, movimientos: [] });
ok(r2.total === 10, "solo cuenta dentro de sus fechas");
ok(r2.dias[0].planeado === 0 && r2.dias[5].planeado === 0, "fuera de sus fechas no hay nada planeado");

// EL FUTURO NO AHORRA. Un día que no llegó no te ahorró nada.
const hoy = businessDay.businessDayLabel();
const futuro = ahorrado.calcular({
  desde: hoy,
  hasta: "2099-12-31",
  gastos: [{ id: "f", label: "Almuerzo", monto: 20, tipo: "rango", fechaInicio: "2000-01-01", fechaFin: null, activo: true }],
  movimientos: [],
});
ok(futuro.hasta === hoy, "nunca mira más allá de hoy");
ok(futuro.dias.length === 1, "y solo cuenta el día de hoy");

// Un tramo al revés no explota.
const alReves = ahorrado.calcular({ desde: "2030-01-01", hasta: "2020-01-01", gastos, movimientos: [] });
ok(alReves.total === 0 && alReves.dias.length === 0, "un tramo imposible da cero");

// El mes entero, para el calendario.
const mes = ahorrado.delMes(MES, gastos, movs);
ok(mes.dias.length === 31, "marzo trae 31 días");
ok(mes.empiezaEn >= 0 && mes.empiezaEn <= 6, "dice en qué columna empieza");
ok(mes.mejorDia && mes.mejorDia.ahorro > 0, "sabe cuál fue el día que más te ahorraste");
ok(mes.diasSinGastar > 0, "y cuántos días no gastaste nada");

console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
