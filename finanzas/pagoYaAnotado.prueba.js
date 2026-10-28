const path = require("path");
const fs = require("fs");
const os = require("os");

// "Ya pagué" y el gasto que ya estaba anotado. El caso real: marcar MI
// BANCO (S/ 574) dijo que ya estaba registrado como "banco mibanco
// Patrick", porque bastaba con que el gasto dijera "banco", sin importar el
// monto ni la fecha. Ahora solo aparecen gastos que de verdad podrían ser
// ese pago, y el panel pregunta cuál es en vez de decidir solo.
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "pago-anotado-"));
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
const dias = (n) => businessDay.addDays(HOY, n);

// ---------- El nombre ----------
const parecido = (label, desc) => reminders.coincidenciaConPendiente(label, desc);
ok(parecido("MI BANCO", "banco mibanco Patrick").todas, '"mibanco" es el nombre entero de MI BANCO');
ok(parecido("MI BANCO", "pagué mi banco").todas, '"mi banco" separado también');
const soloBanco = parecido("MI BANCO", "banco ana");
ok(soloBanco.encontradas.length === 1 && !soloBanco.todas, '"banco" solo es apenas parte del nombre (lo tienen varios pagos)');
ok(!parecido("Sip credito", "mia colegio sip").todas, "Sip credito sigue sin pasar por \"mia colegio sip\"");
ok(parecido("Cuota ARCE", "arce").todas, '"Cuota ARCE" se reconoce por "arce", como siempre');
ok(parecido("Caja Cuzco", "cajacuzco").todas, '"cajacuzco" junto también es Caja Cuzco');
ok(!parecido("Junta", "almuerzo ana").encontradas.length, "un gasto de otra cosa no se parece en nada");

correrComo("prueba", () => {
  // MI BANCO venció hace 2 días y todavía no se marcó.
  const dia = Number(dias(-2).slice(8, 10));
  const banco = reminders.addReminder({ label: "MI BANCO", monto: 574, tipo: "mensual_dia", dia });
  const movs = () => cashbox.getMovimientos();
  const buscar = (monto = 574) => reminders.buscarGastosDelPago(banco, movs(), monto);

  // ---------- El caso real: otro gasto con "banco" ----------
  cashbox.addMovimientoManual("gasto", 50, "banco mibanco Patrick", dias(-1));
  ok(buscar().length === 0, "un gasto de S/ 50 ya no cuenta como el pago de S/ 574, aunque diga mibanco");

  cashbox.addMovimientoManual("gasto", 300, "banco ana", HOY);
  ok(buscar().length === 0, '"banco ana" por S/ 300 tampoco');

  // ---------- Lo que sí podría ser ----------
  cashbox.addMovimientoManual("gasto", 574, "Compartamos banco", HOY);
  cashbox.addMovimientoManual("gasto", 570, "mibanco cuota", dias(-1));
  let c = buscar();
  ok(c.length === 2, "aparecen los dos gastos con monto parecido y algo del nombre");
  ok(c[0].descripcion === "mibanco cuota", "primero el que tiene el nombre entero");
  ok(c[1].descripcion === "Compartamos banco", "después el que solo comparte una palabra (para que tú digas)");

  // Contra lo que dice que pagó: un recibo que cambió de monto.
  ok(buscar(700).length === 0, "si dice que pagó S/ 700, los de S/ 570-574 no se ofrecen");

  // ---------- La fecha ----------
  cashbox.addMovimientoManual("gasto", 574, "mibanco", dias(-15));
  ok(!buscar().some((m) => m.fecha === dias(-15)), "un gasto de 13 días antes del vencimiento no se mira");

  // ---------- Un gasto no paga dos cosas ----------
  const elegido = c[0];
  const otro = reminders.addReminder({ label: "Mibanco Ana", monto: 570, tipo: "unica", fecha: HOY });
  ok(reminders.buscarGastosDelPago(otro, movs(), 570).some((m) => m.id === elegido.id), "(antes de usarlo, sirve para los dos)");
  reminders.marcarPagado(banco, { monto: 574, registrado: false, gastoExistente: elegido.descripcion, gastoId: elegido.id, origen: "panel" });
  ok(
    !reminders.buscarGastosDelPago(otro, movs(), 570).some((m) => m.id === elegido.id),
    "el gasto que quedó como pago de MI BANCO ya no se ofrece para otro pendiente"
  );
  const ultimo = reminders.getHistorialPagos(banco)[0];
  ok(ultimo.gastoId === elegido.id && ultimo.gastoExistente === "mibanco cuota", "el historial guarda cuál gasto fue");

  // ---------- Deshacer lo libera ----------
  reminders.desmarcarPagado(banco);
  ok(buscar().some((m) => m.id === elegido.id), "al deshacer el pago, ese gasto vuelve a poder elegirse");

  // ---------- Escribir el gasto en el grupo ----------
  // "menos 300 banco ana" no puede marcar MI BANCO como pagado...
  ok(!reminders.buscarPendientePorGasto("banco ana", 300), '"menos 300 banco ana" no marca MI BANCO');
  // ...pero "menos 574 mibanco" sí.
  const desdeGrupo = reminders.buscarPendientePorGasto("mibanco", 574);
  ok(desdeGrupo && desdeGrupo.reminder.id === banco, '"menos 574 mibanco" sí lo marca solo');
});

fs.rmSync(CARPETA, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
