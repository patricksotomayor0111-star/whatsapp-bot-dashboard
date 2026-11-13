const path = require("path");
const fs = require("fs");
const os = require("os");

// Corregir algo de un día pasado tiene que llegar hasta el efectivo de hoy.
// El caso: "si quito algo de S/ 100 de hace una semana, mi balance de hoy
// debería cambiar". Antes se corregía solo ese día: cada noche la caja del
// día siguiente ya se había copiado y la diferencia no llegaba nunca. Salvo
// que después se haya contado la caja ("1050 caja"): lo contado es lo que
// de verdad había, y de ahí en adelante no cambia nada.
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "arrastre-"));
process.env.DATA_DIR = CARPETA;
fs.mkdirSync(path.join(CARPETA, "users", "prueba"), { recursive: true });

const businessDay = require("./businessDay");
const HOY = businessDay.businessDayLabel();
const dia = (n) => businessDay.addDays(HOY, n);
const D3 = dia(-3);
const D2 = dia(-2);
const D1 = dia(-1);

// Tres días cerrados y hoy en curso:
//   D3: caja 1000 + 400 ganado (300 + una de 100 mal anotada) - 50 = 1350
//   D2: caja 1350 + 200 = 1550
//   D1: caja 1550 + 100 = 1650
//   hoy: caja 1650 + 20 = 1670
function armar() {
  const mov = (id, fecha, hora, tipo, monto, descripcion) => ({ id, fecha, hora, tipo, monto, descripcion });
  const movimientos = [
    mov("a", D3, "10:00", "ganancia", 300, "delivery"),
    mov("mal", D3, "11:00", "ganancia", 100, "mal anotada"),
    mov("b", D3, "12:00", "gasto", 50, "almuerzo"),
    mov("c", D2, "15:00", "ganancia", 200, "delivery"),
    mov("d", D1, "15:00", "ganancia", 100, "delivery"),
    mov("e", HOY, "09:00", "ganancia", 20, "delivery"),
  ];
  const cierre = (fecha, caja, ganancias, gastos) => ({ fecha, caja, ganancias, gastos, total: ganancias - gastos, esperado: caja + ganancias - gastos });
  fs.writeFileSync(
    path.join(CARPETA, "users", "prueba", "cashbox-data.json"),
    JSON.stringify({
      todayGanancias: 20,
      todayGastos: 0,
      cajaInicial: 1650,
      movimientos,
      cierres: [cierre(D3, 1000, 400, 50), cierre(D2, 1350, 200, 0), cierre(D1, 1550, 100, 0)],
      lastClosedDay: D1,
      diaEnCurso: HOY,
    })
  );
}

armar();
const { correrComo } = require("./contexto");
const cashbox = require("./cashbox");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}
const hoyEsperado = () => cashbox.getToday().esperado;
const cierreDe = (fecha) => cashbox.getCierres().find((c) => c.fecha === fecha);

correrComo("prueba", () => {
  ok(hoyEsperado() === 1670, "arranca con S/ 1670 hoy");

  // ---------- El caso: borrar una ganancia de S/ 100 de hace días ----------
  let r = cashbox.conEfectoEnHoy(() => cashbox.removeMovimientoPorId("mal"));
  ok(cierreDe(D3).esperado === 1250, "ese día ahora cierra con S/ 100 menos");
  ok(cierreDe(D2).caja === 1250 && cierreDe(D2).esperado === 1450, "el día siguiente arranca con S/ 100 menos");
  ok(cierreDe(D1).caja === 1450 && cierreDe(D1).esperado === 1550, "y el otro también");
  ok(hoyEsperado() === 1570, "y el efectivo de HOY baja S/ 100 (antes se quedaba en 1670)");
  ok(r.efectivoHoy.antes === 1670 && r.efectivoHoy.despues === 1570 && r.efectivoHoy.conteo === null, "el panel recibe de cuánto a cuánto pasó");
  ok(cierreDe(D2).ganancias === 200 && cierreDe(D1).ganancias === 100, "lo ganado de los otros días no se toca");

  // Deshacer (volver a anotarla igual) lo deja como estaba.
  r = cashbox.conEfectoEnHoy(() => cashbox.addMovimientoManual("ganancia", 100, "mal anotada", D3, "11:00"));
  ok(hoyEsperado() === 1670 && cierreDe(D2).caja === 1350, "deshacer lo devuelve todo como estaba");

  // ---------- Al revés: borrar un gasto sube el efectivo ----------
  cashbox.removeMovimientoPorId("b");
  ok(hoyEsperado() === 1720, "borrar un gasto de S/ 50 de hace días sube el efectivo de hoy S/ 50");
  cashbox.addMovimientoManual("gasto", 50, "almuerzo", D3, "12:00");
  ok(hoyEsperado() === 1670, "(y anotarlo de nuevo lo baja)");

  // ---------- Corregir el monto ----------
  r = cashbox.conEfectoEnHoy(() => cashbox.editMovimientoPorId("d", { monto: 150 }));
  ok(cierreDe(D1).esperado === 1700 && hoyEsperado() === 1720, "corregir de 100 a 150 una ganancia de ayer: hoy sube S/ 50");
  cashbox.editMovimientoPorId("d", { monto: 100 });

  // ---------- Cambiarle la fecha ----------
  const id = cashbox.addMovimientoManual("gasto", 30, "pasaje", D3, "18:00");
  ok(hoyEsperado() === 1640, "un gasto olvidado de hace 3 días baja el efectivo de hoy");
  cashbox.editMovimientoPorId(id, { fecha: D1 });
  ok(cierreDe(D3).esperado === 1350 && cierreDe(D1).esperado === 1620 && hoyEsperado() === 1640, "pasarlo a ayer cambia esos días, no el efectivo de hoy");
  cashbox.removeMovimientoPorId(id);
  ok(hoyEsperado() === 1670, "(borrado, todo como al principio)");

  // ---------- Corregir el total de un día cerrado ----------
  r = cashbox.conEfectoEnHoy(() => cashbox.editCierre(D3, { ganancias: 430 }));
  ok(cierreDe(D2).caja === 1380 && cierreDe(D1).caja === 1580 && hoyEsperado() === 1700, "corregir el total de un día llega hasta hoy (antes, solo al día siguiente)");
  cashbox.editCierre(D3, { ganancias: 400 });
  ok(hoyEsperado() === 1670, "(y vuelve)");
});

// ---------- Un conteo de caja frena la corrección ----------
// El D2 a la noche contó la caja: lo contado es lo que había.
const conteoD2 = { id: "k", fecha: D2, hora: "21:00", tipo: "caja", monto: 1550, descripcion: "conteo de caja" };
correrComo("prueba", () => {
  cashbox.getMovimientos().push(conteoD2);

  // (Al deshacer arriba se volvió a anotar con otro id.)
  const mal = cashbox.getMovimientos().find((m) => m.descripcion === "mal anotada");
  let r = cashbox.conEfectoEnHoy(() => cashbox.removeMovimientoPorId(mal.id));
  ok(cierreDe(D3).esperado === 1250, "borrar la de S/ 100 corrige ese día igual");
  ok(cierreDe(D2).caja === 1350 && cierreDe(D1).caja === 1550 && hoyEsperado() === 1670, "pero no pasa del conteo: ni los días siguientes ni hoy cambian");
  ok(r.efectivoHoy.antes === r.efectivoHoy.despues && r.efectivoHoy.conteo === D2, "y el panel sabe que lo frenó el conteo de ese día");
  cashbox.addMovimientoManual("ganancia", 100, "mal anotada", D3, "11:00");

  // Algo DESPUÉS del conteo sí llega hasta hoy.
  r = cashbox.conEfectoEnHoy(() => cashbox.editMovimientoPorId("d", { monto: 150 }));
  ok(hoyEsperado() === 1720 && r.efectivoHoy.conteo === null, "lo de ayer, que es después del conteo, sí llega hasta hoy");
  cashbox.editMovimientoPorId("d", { monto: 100 });

  // El mismo día del conteo: lo de antes queda adentro de lo contado.
  r = cashbox.conEfectoEnHoy(() => cashbox.editMovimientoPorId("c", { monto: 260 }));
  ok(cierreDe(D2).ganancias === 260, "corregir algo de ese día, antes del conteo, corrige lo ganado ese día");
  ok(cierreDe(D2).esperado === 1550 && cierreDe(D1).caja === 1550 && hoyEsperado() === 1670, "pero lo que quedó (lo contado) no cambia, ni lo de después");
  ok(r.efectivoHoy.conteo === D2, "(lo frenó el conteo)");
  cashbox.editMovimientoPorId("c", { monto: 200 });
  ok(cierreDe(D2).caja === 1350 && cierreDe(D2).esperado === 1550, "(y vuelve a como estaba)");

  // ---------- Hoy, con un conteo más tarde ----------
  cashbox.getMovimientos().push({ id: "kh", fecha: HOY, hora: "10:00", tipo: "caja", monto: 1670, descripcion: "conteo de caja" });
  r = cashbox.conEfectoEnHoy(() => cashbox.editMovimientoPorId("e", { monto: 30 }));
  ok(cashbox.getToday().ganancias === 30 && hoyEsperado() === 1670, "hoy: corregir algo de antes del conteo de hoy cambia lo ganado, no lo contado");
  ok(r.efectivoHoy.conteo === HOY, "(lo frenó el conteo de hoy)");

  // Algo de hoy sin conteo después: cambia como siempre.
  r = cashbox.conEfectoEnHoy(() => cashbox.addMovimientoManual("gasto", 10, "agua", HOY, "11:00"));
  ok(hoyEsperado() === 1660 && r.efectivoHoy.conteo === null, "un gasto de hoy, después del conteo, baja el efectivo como siempre");
});

fs.rmSync(CARPETA, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
