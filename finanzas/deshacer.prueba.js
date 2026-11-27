const path = require("path");
const fs = require("fs");
const os = require("os");

// Deshacer cualquier pago marcado, y "menos 50 junta" con dos juntas.
//
// El caso real (22/11): el dueño entró a otra junta y escribió "menos 50
// junta". MORA lo tomó como pago de su Junta de S/ 100 (marcó la cuota del
// 24/11 por adelantado) y el ↺ solo deshace el último pago mientras el
// pendiente no vence. Ahora cualquier pago se deshace desde el historial, y
// con dos juntas gana la que coincide en monto.
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "deshacer-"));
process.env.DATA_DIR = CARPETA;
fs.mkdirSync(path.join(CARPETA, "users", "prueba"), { recursive: true });

const { correrComo } = require("./contexto");
const reminders = require("./reminders");
const cashbox = require("./cashbox");
const businessDay = require("./businessDay");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}

const HOY = businessDay.businessDayLabel();
const masDias = (label, n) => businessDay.addDays(label, n);
const dowHoy = businessDay.ymdToUtc(HOY).getUTCDay();

correrComo("prueba", () => {
  const bot = require("./bot");
  const buscar = (id) => reminders.getAll().find((x) => x.id === id);
  const escribir = (texto) => bot.handleCashboxEntries(bot.parseCashboxMessage(texto));
  const lotes = (id) => [...new Set(reminders.getHistorialPagos(id).map((p) => p.lote))];
  const diaJunta = (dowHoy + 2) % 7; // vence pasado mañana
  const proxima = masDias(HOY, 2);

  // ---------- 1) El caso real: "menos 50 junta" marcó la Junta de 100 ----------
  const junta = reminders.addReminder({ label: "Junta", monto: 100, tipo: "semanal", dia: diaJunta });
  escribir("menos 50 junta");
  ok(buscar(junta).pagadoHasta === proxima, "\"menos 50 junta\" marcó la Junta de 100 (como pasó)");
  const [loteMal] = lotes(junta);
  const previa = reminders.previaDeshacer(loteMal);
  ok(previa && previa.label === "Junta" && previa.este.monto === 50 && previa.posteriores.length === 0, "antes de deshacer se ve qué pago es (S/ 50, sin otros después)");
  ok(previa.este.origen === "grupo" && previa.este.gastoDeMora === false, "lo escribiste en el grupo: no se ofrece borrar el gasto");
  reminders.deshacerPago(loteMal);
  ok(buscar(junta).pagadoHasta === null && buscar(junta).siguientes[0] === proxima, "deshecho: la cuota vuelve a quedar por pagar");
  ok(reminders.getHistorialPagos(junta).length === 0, "y sale del historial");
  ok(cashbox.getMovimientos().some((m) => m.tipo === "gasto" && m.monto === 50 && /junta/i.test(m.descripcion)), "los S/ 50 que escribiste siguen en la caja");
  let error = null;
  try {
    reminders.deshacerPago(loteMal);
  } catch (e) {
    error = e.message;
  }
  ok(error && /ya no está/.test(error), "deshacer dos veces el mismo pago avisa que ya no está");
  ok(reminders.previaDeshacer("lote_inventado") === null, "un pago que no existe no se encuentra");

  // ---------- 2) Dos juntas: gana la que coincide en monto ----------
  const junta2 = reminders.addReminder({ label: "Junta 2", monto: 50, tipo: "semanal", dia: diaJunta });
  escribir("menos 50 junta");
  ok(buscar(junta2).pagadoHasta === proxima && buscar(junta).pagadoHasta === null, "\"menos 50 junta\" ahora marca la Junta 2 (S/ 50), no la de 100");
  reminders.deshacerPago(lotes(junta2)[0]);
  escribir("menos 100 junta");
  ok(buscar(junta).pagadoHasta === proxima && buscar(junta2).pagadoHasta === null, "\"menos 100 junta\" marca la Junta de 100");
  reminders.deshacerPago(lotes(junta)[0]);
  escribir("menos 300 junta");
  ok(buscar(junta).pagadoHasta === masDias(proxima, 14) && buscar(junta2).pagadoHasta === null, "\"menos 300 junta\" sigue siendo 3 cuotas de la de 100");
  reminders.deshacerPago(lotes(junta)[0]);
  ok(buscar(junta).pagadoHasta === null, "y deshacer un pago de 3 cuotas las deja las 3 por pagar");
  escribir("menos 50 junta 2");
  ok(buscar(junta2).pagadoHasta === proxima, "\"menos 50 junta 2\" también va a la Junta 2");
  reminders.deshacerPago(lotes(junta2)[0]);

  // Un solo pendiente parecido: como siempre.
  const luz = reminders.addReminder({ label: "Luz", monto: 80, tipo: "semanal", dia: diaJunta });
  escribir("menos 80 luz");
  ok(buscar(luz).pagadoHasta === proxima, "con un solo parecido, se marca como siempre");

  // ---------- 3) Deshacer uno del medio: se van también los de después ----------
  const arce = reminders.addReminder({ label: "Cuota ARCE", monto: 27, tipo: "semanal", dia: diaJunta });
  reminders.adelantarPagos(arce, 1, { monto: 27 }); // A: la que viene
  reminders.adelantarPagos(arce, 2, { monto: 54 }); // B: las 2 siguientes
  reminders.adelantarPagos(arce, 1, { monto: 27 }); // C: la cuarta
  const [A, B, C] = lotes(arce).reverse(); // el historial viene del más nuevo al más viejo
  ok(buscar(arce).pagadoHasta === masDias(proxima, 21), "tres pagos: pagado hasta la cuarta cuota");
  const previaB = reminders.previaDeshacer(B);
  ok(previaB.este.cuotas === 2 && previaB.posteriores.length === 1 && previaB.posteriores[0].lote === C, "deshacer el del medio avisa que también se va el de después");
  reminders.deshacerPago(B);
  ok(buscar(arce).pagadoHasta === proxima, "queda pagado solo el primero");
  ok(JSON.stringify(lotes(arce)) === JSON.stringify([A]), "y en el historial queda solo ese");
  reminders.deshacerPago(A);
  ok(buscar(arce).pagadoHasta === null && reminders.getHistorialPagos(arce).length === 0, "y deshacer el primero deja todo por pagar");

  // ---------- 4) Pagado con "Ya pagué": el gasto lo anotó MORA ----------
  const cable = reminders.addReminder({ label: "Cable", monto: 60, tipo: "semanal", dia: dowHoy });
  const gastoId = cashbox.addGasto(60, "Cable");
  reminders.marcarPagado(cable, { monto: 60, registrado: true, gastoId, origen: "panel" });
  ok(buscar(cable).pendiente === false, "Cable pagado con \"Ya pagué\"");
  const previaCable = reminders.previaDeshacer(lotes(cable)[0]);
  ok(previaCable.este.gastoDeMora === true && previaCable.este.gastoId === gastoId, "ese sí ofrece borrar el gasto que anotó MORA");
  const hecho = reminders.deshacerPago(lotes(cable)[0]);
  ok(buscar(cable).pendiente === true && hecho.deshechos[0].gastoId === gastoId, "deshecho: vuelve a estar pendiente (vence hoy) y devuelve qué gasto era");

  // ---------- 5) Si pagaba un préstamo, el saldo vuelve ----------
  const prestamos = require("./prestamos");
  const cuota = reminders.addReminder({ label: "Caja Huancayo", monto: 100, tipo: "semanal", dia: diaJunta });
  const prestamo = prestamos.addPrestamo({ label: "Caja Huancayo", recibido: 500, aDevolver: 600, recordatorioId: cuota });
  reminders.adelantarPagos(cuota, 1, { monto: 100 });
  reminders.adelantarPagos(cuota, 1, { monto: 100 });
  ok(prestamos.getById(prestamo.id).saldo === 400, "dos cuotas pagadas: el préstamo baja a S/ 400");
  reminders.deshacerPago(lotes(cuota).reverse()[0]);
  ok(prestamos.getById(prestamo.id).saldo === 600, "deshacer el primero (y el de después) devuelve los S/ 200");

  // ---------- 6) El ↺ de siempre sigue andando ----------
  reminders.adelantarPagos(luz, 1, { monto: 80 });
  reminders.desmarcarPagado(luz);
  ok(buscar(luz).pagadoHasta === proxima, "el ↺ sigue deshaciendo solo el último");
});

fs.rmSync(CARPETA, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
