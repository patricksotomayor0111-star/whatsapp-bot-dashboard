const cal = require("./calendario");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}

const HOY = require("./businessDay").businessDayLabel();
const MES = HOY.slice(0, 7);

const movimientos = [
  { tipo: "ganancia", fecha: MES + "-01", monto: 100 },
  { tipo: "gasto", fecha: MES + "-01", monto: 30 },
  { tipo: "ganancia", fecha: MES + "-02", monto: 180 },
  { tipo: "caja", fecha: MES + "-02", monto: 999 },
  // De otro mes: no tiene que colarse.
  { tipo: "ganancia", fecha: "2020-01-15", monto: 5000 },
];

const recordatorios = [
  { id: "junta", label: "Junta", tipo: "semanal", dia: 1, monto: 50, activo: true },
  { id: "natura", label: "Natura", tipo: "mensual_dia", dia: 28, monto: 508, activo: true },
  { id: "finmes", label: "Alquiler", tipo: "mensual_finmes", monto: 400, activo: true },
  { id: "off", label: "Apagado", tipo: "mensual_dia", dia: 5, monto: 99, activo: false },
];

const r = cal.armar({
  mes: MES,
  movimientos,
  recordatorios,
  proyeccionDia: () => ({ total: 20 }),
});

ok(r.dias.length === cal.diasEnMes(...MES.split("-").map(Number)), "trae todos los días del mes");
ok(r.empiezaEn >= 0 && r.empiezaEn <= 6, "dice en qué columna empieza el mes");

const dia1 = r.dias[0];
ok(dia1.ganancias === 100 && dia1.gastos === 30, "suma lo real del día 1");
ok(dia1.neto === 70, "el neto del día 1");

const dia2 = r.dias[1];
ok(dia2.ganancias === 180, "un conteo de caja no se suma como ganancia");
ok(dia2.movimientos === 2, "pero sí cuenta como movimiento del día");

ok(r.totales.ganancias === 280, "el mes no se come movimientos de otros meses");

// Los pagos con nombre caen donde tienen que caer.
const conNatura = r.dias.filter((d) => d.pagos.some((p) => p.label === "Natura"));
ok(conNatura.length === 1 && conNatura[0].dia === 28, "Natura cae una sola vez, el 28");

const conAlquiler = r.dias.filter((d) => d.pagos.some((p) => p.label === "Alquiler"));
ok(conAlquiler.length === 1 && conAlquiler[0].dia === r.dias.length, "el de fin de mes cae el último día");

const juntas = r.dias.filter((d) => d.pagos.some((p) => p.label === "Junta"));
ok(juntas.length >= 4, "la junta semanal cae varias veces");
ok(juntas.every((d) => d.diaSemana === 1), "y siempre en lunes");

ok(!r.dias.some((d) => d.pagos.some((p) => p.label === "Apagado")), "un recordatorio apagado no aparece");

// Lo que falta pagar es solo hacia adelante: para un día que ya pasó vale
// lo que de verdad gastaste, no lo que tocaba.
ok(r.dias.filter((d) => !d.esFuturo).every((d) => d.porPagar === 0), "los días pasados no dicen 'te toca pagar'");
ok(r.dias.filter((d) => !d.esFuturo).every((d) => d.programado === 0), "ni proyectan gastos de todos los días");
const futuros = r.dias.filter((d) => d.esFuturo);
if (futuros.length) {
  ok(futuros.every((d) => d.porPagar >= 20), "los días que vienen sí proyectan");
  ok(
    r.totales.porPagar === +futuros.reduce((s, d) => s + d.porPagar, 0).toFixed(2),
    "el total por pagar suma solo los días que vienen"
  );
}

const hoyEnLista = r.dias.filter((d) => d.esHoy);
ok(hoyEnLista.length === 1, "hoy está marcado una sola vez");
ok(r.totales.mejorDia && r.totales.mejorDia.ganancias === 180, "el mejor día es el que más entró");

console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
