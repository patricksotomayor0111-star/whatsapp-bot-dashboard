const path = require("path");
const fs = require("fs");
const os = require("os");

const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "prestamos-"));
process.env.DATA_DIR = CARPETA;

const { correrComo } = require("./contexto");
const prestamos = require("./prestamos");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}

fs.mkdirSync(path.join(CARPETA, "users", "prueba"), { recursive: true });

correrComo("prueba", () => {
  // ---------- Reconocer la palabra ----------
  ok(prestamos.esPrestamo("400 yape credito"), "reconoce 'credito'");
  ok(prestamos.esPrestamo("un prestamo de mi tio"), "reconoce 'prestamo'");
  ok(!prestamos.esPrestamo("80 bum"), "una ganancia normal no es préstamo");
  ok(!prestamos.esPrestamo("acreditado 50"), "no matchea dentro de otra palabra");
  ok(prestamos.nombreDesdeDescripcion("yape credito", prestamos.getPalabras()) === "Yape", "saca el nombre");

  // ---------- Alta y saldo ----------
  const p = prestamos.addPrestamo({ label: "Yape", recibido: 400, aDevolver: 440 });
  ok(p.saldo === 440, "debes el total con interés, no lo que recibiste");
  ok(p.interes === 40, "sabe cuánto te cuesta de más");
  ok(prestamos.getTotales().debes === 440, "el total a devolver");
  ok(prestamos.getTotales().recibido === 400, "y cuánto te entró");

  // Sin decir el interés se asume que no hay.
  const sinInteres = prestamos.addPrestamo({ label: "Tío", recibido: 100 });
  ok(sinInteres.saldo === 100 && sinInteres.interes === 0, "sin interés, debes lo que te prestaron");
  prestamos.removePrestamo(sinInteres.id);

  // ---------- Pagos ----------
  prestamos.registrarPago(p.id, { monto: 110 });
  ok(prestamos.getById(p.id).saldo === 330, "un pago baja el saldo");
  ok(prestamos.getById(p.id).pagado === 110, "y se acumula lo pagado");

  prestamos.registrarPago(p.id, { monto: 330 });
  ok(prestamos.getById(p.id).saldado === true, "al llegar a cero queda saldado");
  ok(prestamos.getById(p.id).activo === false, "y deja de estar activo");
  ok(prestamos.getTotales().debes === 0, "y ya no se cuenta en lo que debes");

  // Borrar un pago lo reabre: si te equivocaste, no queda trabado.
  const ultimoPago = prestamos.getById(p.id).pagos.slice(-1)[0];
  prestamos.quitarPago(p.id, ultimoPago.id);
  ok(prestamos.getById(p.id).saldo === 330, "quitar un pago devuelve el saldo");
  ok(prestamos.getById(p.id).activo === true, "y lo vuelve a abrir");

  // ---------- No contar dos veces ----------
  // Con pendiente atado: lo cuenta el pendiente, no el préstamo.
  prestamos.editPrestamo(p.id, { recordatorioId: "sip_credito" });
  let deb = prestamos.aDevolverEn("2026-01-01", "2026-12-31");
  ok(deb.total === 0, "atado a un pendiente NO cuenta aparte en la meta");

  // Sin pendiente y sin cuota: cuenta entero, porque no hay plan de pago.
  prestamos.editPrestamo(p.id, { recordatorioId: "" });
  deb = prestamos.aDevolverEn("2026-01-01", "2026-12-31");
  ok(deb.total === 330, "sin pendiente ni cuota, cuenta entero");
  ok(deb.detalle[0].porque.includes("sin fecha"), "y dice por qué");

  // Sin pendiente pero con cuota: se proyecta lo que cae en el periodo.
  prestamos.editPrestamo(p.id, { cuota: 110, diaDelMes: 28 });
  deb = prestamos.aDevolverEn("2026-09-01", "2026-09-30");
  ok(deb.total === 110, "con cuota, solo la que cae en el mes");
  deb = prestamos.aDevolverEn("2026-09-01", "2026-11-30");
  ok(deb.total === 330, "tres meses, tres cuotas");
  // Nunca puede pedir más de lo que debes.
  deb = prestamos.aDevolverEn("2026-09-01", "2027-12-31");
  ok(deb.total === 330, "no proyecta más cuotas de las que faltan");

  // ---------- El pago que entra desde un pendiente ----------
  prestamos.editPrestamo(p.id, { recordatorioId: "sip_credito" });
  const antes = prestamos.getById(p.id).saldo;
  prestamos.registrarPagoPorRecordatorio("sip_credito", 110);
  ok(prestamos.getById(p.id).saldo === antes - 110, "marcar el pendiente baja el préstamo");
  ok(
    prestamos.getById(p.id).pagos.slice(-1)[0].origen === "pendiente",
    "y queda anotado de dónde vino ese pago"
  );
  ok(prestamos.registrarPagoPorRecordatorio("no_existe", 50) === null, "un pendiente sin préstamo no hace nada");

  // ---------- El calendario ----------
  prestamos.editPrestamo(p.id, { recordatorioId: "" });
  ok(prestamos.cuotasDelDia("2026-09-28").length === 1, "la cuota sale en su día");
  ok(prestamos.cuotasDelDia("2026-09-27").length === 0, "y no en otro");
  prestamos.editPrestamo(p.id, { recordatorioId: "sip_credito" });
  ok(
    prestamos.cuotasDelDia("2026-09-28").length === 0,
    "si cuelga de un pendiente no sale dos veces en el calendario"
  );

  // ---------- Pedir más al mismo ----------
  prestamos.editPrestamo(p.id, { recordatorioId: "" });
  const saldoPrevio = prestamos.getById(p.id).saldo;
  const mismo = prestamos.abrirOSumar({ label: "yape", recibido: 200 });
  ok(mismo.id === p.id, "pedir otra vez al mismo suma al préstamo que ya tenías");
  ok(mismo.saldo === saldoPrevio + 200, "y sube el saldo");
  ok(prestamos.getAll().length === 1, "no abre uno nuevo");

  const otro = prestamos.abrirOSumar({ label: "BCP", recibido: 1000 });
  ok(otro.id !== p.id && prestamos.getAll().length === 2, "otro prestamista sí abre uno nuevo");

  // ---------- Cuánto del mes fue prestado ----------
  const hoyMes = require("./businessDay").businessDayLabel().slice(0, 7);
  ok(prestamos.loPrestadoEn(hoyMes + "-01", hoyMes + "-31") > 0, "sabe cuánto se pidió prestado este mes");
  ok(prestamos.loPrestadoEn("1999-01-01", "1999-12-31") === 0, "y cero en un periodo sin préstamos");

  // ---------- Simular antes de pedir ----------
  const sim = prestamos.simular({ monto: 400, meses: 4, interesPorciento: 10 });
  ok(sim.recibes === 400 && sim.aDevolver === 440, "calcula lo que devolverías");
  ok(sim.cuota === 110, "y la cuota");
  const sinPct = prestamos.simular({ monto: 300, meses: 3 });
  ok(sinPct.aDevolver === 300 && sinPct.cuota === 100, "sin interés también");

  // ---------- Las palabras se pueden cambiar ----------
  prestamos.setPalabras(["fiado"]);
  ok(prestamos.esPrestamo("200 fiado tienda"), "reconoce la palabra nueva");
  ok(!prestamos.esPrestamo("400 yape credito"), "y deja de reconocer la vieja");
});

fs.rmSync(CARPETA, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
