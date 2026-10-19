const path = require("path");
const fs = require("fs");
const os = require("os");

// Los pagos que se repiten: hasta cuándo se pagan y qué pasa al terminar.
//
// Antes un pago se repetía para siempre: una cuota de 6 meses te seguía
// avisando en el mes 7 y había que acordarse de apagarla a mano.
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "pendientes-"));
process.env.DATA_DIR = CARPETA;
fs.mkdirSync(path.join(CARPETA, "users", "prueba"), { recursive: true });

const { correrComo } = require("./contexto");
const reminders = require("./reminders");
const businessDay = require("./businessDay");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}

const HOY = businessDay.businessDayLabel();
function masDias(label, n) {
  const [y, mo, d] = label.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

correrComo("prueba", () => {
  const buscar = (id) => reminders.getAll().find((x) => x.id === id);

  // ---------- Sin fecha de término: como siempre ----------
  const sinFin = reminders.addReminder({ label: "Luz", monto: 80, tipo: "mensual_dia", dia: 15 });
  ok(buscar(sinFin).fechaFin === null, "sin término, no tiene fecha de fin");
  ok(buscar(sinFin).proxima, "y sí tiene próximo pago");
  ok(buscar(sinFin).termino === false, "y no está terminado");

  // ---------- Con fecha de término ----------
  const hasta = masDias(HOY, 60);
  const conFin = reminders.addReminder({ label: "Natura", monto: 508, tipo: "mensual_dia", dia: 28, fechaFin: hasta });
  ok(buscar(conFin).fechaFin === hasta, "guarda hasta cuándo se paga");
  ok(buscar(conFin).termino === false, "todavía no terminó");
  ok(buscar(conFin).proxima && buscar(conFin).proxima <= hasta, "su próximo pago cae antes del final");

  // ---------- Uno que ya terminó ----------
  const yaPaso = masDias(HOY, -40);
  const terminado = reminders.addReminder({ label: "Cuota vieja", monto: 100, tipo: "mensual_dia", dia: 5, fechaFin: yaPaso });
  ok(buscar(terminado).termino === true, "un pago pasado su final queda terminado");
  ok(buscar(terminado).proxima === null, "y ya no tiene próximo pago");
  ok(buscar(terminado).pendiente === false, "ni vuelve a estar pendiente");

  // Y tampoco se proyecta.
  const proyectados = reminders.getPagosMesRestante();
  ok(!proyectados.some((p) => p.id === terminado), "un pago terminado no se proyecta");
  ok(proyectados.some((p) => p.id === sinFin) || buscar(sinFin).proxima > masDias(HOY, 30), "el que sigue corriendo sí");

  // ---------- Editar: todo se puede cambiar ----------
  reminders.editReminder(sinFin, { label: "Luz del taller", monto: 95 });
  ok(buscar(sinFin).label === "Luz del taller", "se cambia el nombre");
  ok(buscar(sinFin).monto === 95, "se cambia el monto");

  reminders.editReminder(sinFin, { tipo: "semanal", dia: 3 });
  ok(buscar(sinFin).tipo === "semanal" && buscar(sinFin).dia === 3, "se cambia cada cuánto y qué día");

  reminders.editReminder(sinFin, { fechaFin: hasta });
  ok(buscar(sinFin).fechaFin === hasta, "se le pone un final después");

  // Vaciar la fecha vuelve a dejarlo para siempre.
  reminders.editReminder(sinFin, { fechaFin: "" });
  ok(buscar(sinFin).fechaFin === null, "vaciar el final lo vuelve a dejar sin término");
  ok(buscar(sinFin).termino === false, "y vuelve a correr");

  // Pasar a "una sola vez" limpia el día.
  reminders.editReminder(sinFin, { tipo: "unica", fecha: masDias(HOY, 10) });
  ok(buscar(sinFin).tipo === "unica" && buscar(sinFin).dia === null, "al pasar a 'una vez' se limpia el día");
  ok(buscar(sinFin).fecha === masDias(HOY, 10), "y queda su fecha");

  // ---------- Lo que no se puede ----------
  let exploto = false;
  try {
    reminders.editReminder(conFin, { tipo: "cada rato" });
  } catch (err) {
    exploto = true;
  }
  ok(exploto, "no acepta un tipo inventado");
  ok(reminders.editReminder("no_existe", { monto: 1 }) === null, "editar uno que no existe no rompe nada");

  // ---------- Marcar pagado sigue andando con un final puesto ----------
  const conFinal = reminders.addReminder({
    label: "Cuota con final",
    monto: 50,
    tipo: "semanal",
    dia: new Date(HOY + "T00:00:00Z").getUTCDay(),
    fechaFin: masDias(HOY, 30),
  });
  ok(buscar(conFinal).pendiente === true, "vence hoy, así que está pendiente");
  reminders.marcarPagado(conFinal, { monto: 50, origen: "panel" });
  ok(buscar(conFinal).pendiente === false, "al marcarlo deja de estar pendiente");

  // ---------- Cambiar el día no deshace un pago ya hecho ----------
  // El caso real: "Caja ica" se pagaba el 22, se pagó septiembre y después se
  // pasó al 23. Septiembre volvía a salir pendiente aunque estaba pagado.
  const alinear = reminders._alinearCicloPagado;
  const mensual = { tipo: "mensual_dia", dia: 23, lastPaidCycle: "2026-09-22" };
  ok(alinear(mensual) && mensual.lastPaidCycle === "2026-09-23", "del 22 al 23: el pago de septiembre pasa al 23/09");
  const atras = { tipo: "mensual_dia", dia: 20, lastPaidCycle: "2026-09-22" };
  ok(!alinear(atras) && atras.lastPaidCycle === "2026-09-22", "del 22 al 20: ya contaba como pagado, no se toca");
  const fin = { tipo: "mensual_dia", dia: 31, lastPaidCycle: "2026-09-29" };
  ok(alinear(fin) && fin.lastPaidCycle === "2026-09-30", "día 31 en un mes de 30: queda en el último día del mes");
  const sinEditar = { tipo: "mensual_dia", dia: 15, lastPaidCycle: "2026-09-15" };
  ok(!alinear(sinEditar), "si nunca se cambió el día, no cambia nada");
  const nuncaPagado = { tipo: "mensual_dia", dia: 23, lastPaidCycle: null };
  ok(!alinear(nuncaPagado) && nuncaPagado.lastPaidCycle === null, "si nunca se pagó, no inventa un pago");
  const semanal = { tipo: "semanal", dia: 4, lastPaidCycle: "2026-10-12" }; // pagó el lunes, pasa a jueves
  ok(alinear(semanal) && semanal.lastPaidCycle === "2026-10-15", "semanal de lunes a jueves: cuenta pagado el jueves de esa semana");

  // Con un pago de verdad: se paga el ciclo abierto y después se mueve el día
  // un poco hacia adelante. No tiene que volver a salir pendiente.
  const diaHoy = Number(HOY.split("-")[2]);
  if (diaHoy >= 2 && diaHoy <= 26) {
    const caja = reminders.addReminder({ label: "Caja ica", monto: 214, tipo: "mensual_dia", dia: 1 });
    reminders.marcarPagado(caja, { monto: 214, origen: "panel" });
    ok(buscar(caja).pendiente === false, "pagado el ciclo del día 1");
    reminders.editReminder(caja, { dia: diaHoy }); // el día pasa a hoy: el ciclo de este mes ya estaba pagado
    ok(buscar(caja).pendiente === false, "al cambiarle el día, el mes pagado sigue pagado");
  }

  // ---------- Pagar por adelantado ----------
  // El caso real: adelantar las próximas Juntas (S/ 100 cada martes).
  const dowHoy = new Date(HOY + "T00:00:00Z").getUTCDay();
  const diaJunta = (dowHoy + 2) % 7; // vence pasado mañana
  const proxima = masDias(HOY, 2);
  const junta = reminders.addReminder({ label: "Junta", monto: 100, tipo: "semanal", dia: diaJunta });
  // Recién creado, cuenta como pendiente la de la semana pasada: se la da
  // por pagada (sin historial) para arrancar "al día".
  reminders.marcarPagado(junta);
  ok(buscar(junta).siguientes[0] === proxima, "la primera cuota por pagar es la que viene");

  const tres = reminders.adelantarPagos(junta, 3, { monto: 300, origen: "panel" });
  ok(tres.ciclos.length === 3 && tres.ciclos[0] === proxima && tres.ciclos[2] === masDias(proxima, 14), "adelantar 3 cubre las 3 que vienen");
  ok(tres.total === 300 && tres.siguiente === masDias(proxima, 21), "por S/ 300, y la siguiente es la cuarta");
  let j = buscar(junta);
  ok(j.pagadoHasta === masDias(proxima, 14) && j.proxima === masDias(proxima, 21) && !j.pendiente, "queda 'pagado hasta' la tercera");
  const enRango = reminders.getPagosEnRango(30).filter((p) => p.id === junta).map((p) => p.fecha);
  ok(![0, 7, 14].some((d) => enRango.includes(masDias(proxima, d))), "las cuotas adelantadas ya no se piden en la meta");
  ok(enRango.includes(masDias(proxima, 21)), "la cuarta sí");
  const hist = reminders.getHistorialPagos(junta);
  ok(hist.length === 3 && hist.every((p) => p.adelantado && p.cuotasLote === 3 && p.monto === 100), "el historial guarda las 3 cuotas, marcadas como adelantadas");

  // Deshacer vuelve exactamente a como estaba.
  reminders.desmarcarPagado(junta);
  j = buscar(junta);
  ok(j.pagadoHasta === null && j.siguientes[0] === proxima, "deshacer deja todo como antes");
  ok(reminders.getHistorialPagos(junta).length === 0, "y saca esas cuotas del historial");

  // Deshacer quita solo el último pago, no los anteriores.
  reminders.adelantarPagos(junta, 1, { monto: 100 });
  reminders.adelantarPagos(junta, 2, { monto: 200 });
  ok(buscar(junta).pagadoHasta === masDias(proxima, 14), "dos pagos: queda pagado hasta la tercera");
  reminders.desmarcarPagado(junta);
  ok(buscar(junta).pagadoHasta === proxima, "deshacer quita solo el último (las 2 cuotas)");
  reminders.desmarcarPagado(junta);

  // Por WhatsApp: "menos 300 junta" son 3 cuotas.
  const rJunta = reminders.getById(junta);
  ok(reminders.cuotasQueCubre(rJunta, 300) === 3, "300 de una Junta de 100 son 3 cuotas");
  ok(reminders.cuotasQueCubre(rJunta, 100) === 1, "100 es una");
  ok(reminders.cuotasQueCubre(rJunta, 250) === 1, "un monto que no es múltiplo es una sola cuota");
  const bot = require("./bot");
  const avisos = bot.handleCashboxEntries(bot.parseCashboxMessage("menos 300 junta"));
  ok(buscar(junta).pagadoHasta === masDias(proxima, 14), "escribir 'menos 300 junta' marca las 3 cuotas");
  ok(avisos.some((a) => a.includes("3 cuotas")), "y avisa cuáles marcó");
  ok(reminders.getHistorialPagos(junta).every((p) => p.origen === "grupo" && !p.registrado), "como escritas en el grupo (el gasto ya estaba en la caja)");
  reminders.desmarcarPagado(junta);

  // Un pago de una sola vez, antes de su fecha.
  const yape = reminders.addReminder({ label: "Yape", monto: 448, tipo: "unica", fecha: masDias(HOY, 6) });
  reminders.adelantarPagos(yape, 1, { monto: 448 });
  ok(!buscar(yape).activo && buscar(yape).ultimoPago.monto === 448, "un pago único se puede pagar antes de su fecha");
  ok(!reminders.getPagosEnRango(30).some((p) => p.id === yape), "y ya no se pide");
  reminders.desmarcarPagado(yape);
  ok(buscar(yape).activo, "deshacerlo lo vuelve a dejar por pagar");

  // Nunca más allá del final del pago.
  const corta = reminders.addReminder({ label: "Cuota corta", monto: 50, tipo: "semanal", dia: diaJunta, fechaFin: masDias(proxima, 7) });
  reminders.marcarPagado(corta);
  ok(buscar(corta).siguientes.length === 2, "no deja adelantar cuotas después del final");

  // Si el pendiente paga un préstamo, el saldo baja, y deshacer lo devuelve.
  const prestamos = require("./prestamos");
  const cuotaCaja = reminders.addReminder({ label: "Caja Huancayo", monto: 100, tipo: "semanal", dia: diaJunta });
  reminders.marcarPagado(cuotaCaja);
  const prestamo = prestamos.addPrestamo({ label: "Caja Huancayo", recibido: 500, aDevolver: 600, recordatorioId: cuotaCaja });
  reminders.adelantarPagos(cuotaCaja, 2, { monto: 200 });
  ok(prestamos.getById(prestamo.id).saldo === 400, "adelantar 2 cuotas baja el préstamo en S/ 200");
  reminders.desmarcarPagado(cuotaCaja);
  ok(prestamos.getById(prestamo.id).saldo === 600, "y deshacer se lo devuelve");
});

fs.rmSync(CARPETA, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
