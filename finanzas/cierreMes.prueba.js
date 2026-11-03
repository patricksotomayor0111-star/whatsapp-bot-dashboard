const path = require("path");
const fs = require("fs");
const os = require("os");

// "Para cerrar el mes tranquilo": la meta de hoy, el mínimo por día y los
// tres caminos (lo justo, tu mínimo, tu ritmo). Es lo que dice el mensaje
// de las 7am y lo que muestra Inicio, así que tiene que cuadrar solo.
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "cierre-"));
process.env.DATA_DIR = CARPETA;
fs.mkdirSync(path.join(CARPETA, "users", "prueba"), { recursive: true });
fs.mkdirSync(path.join(CARPETA, "users", "patrick"), { recursive: true });

const { correrComo } = require("./contexto");
const metas = require("./metasAutomaticas");
const financeGoals = require("./financeGoals");
const cashbox = require("./cashbox");
const reminders = require("./reminders");
const diasLibres = require("./diasLibres");
const businessDay = require("./businessDay");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}
const cerca = (a, b) => Math.abs(a - b) < 0.02;

const HOY = businessDay.businessDayLabel();

// ---------- El mínimo con el que arranca cada cuenta ----------
correrComo("patrick", () => {
  ok(financeGoals.getMinimoDiario() === 100, "el dueño arranca con su mínimo de S/ 100");
});

correrComo("prueba", () => {
  ok(financeGoals.getMinimoDiario() === 0, "una cuenta nueva arranca sin mínimo");

  // Caja de 500 y un pago de 2000 que vence hoy: faltan 1500.
  cashbox.setCaja(500);
  const luz = reminders.addReminder({ label: "Luz", monto: 2000, tipo: "unica", fecha: HOY });
  let r = metas.calcular("");
  const n = r.diasHabiles;
  ok(r.falta === 1500, "falta lo que hay que pagar menos lo que tienes");
  ok(cerca(r.hoy.meta, 1500 / n), "la meta de hoy es lo que falta entre los días de trabajo");
  ok(r.hoy.ganado === 0 && cerca(r.hoy.falta, r.hoy.meta), "sin ganar nada, te falta toda la meta");
  ok(r.detalle.vencenHoy.items.some((p) => p.id === luz), "avisa que la Luz vence hoy");
  ok(r.escenarios.minimo === null, "sin mínimo no hay camino del mínimo");

  // ---------- Lo que ganas hoy es avance, no baja la meta ----------
  const metaDeLaManana = r.hoy.meta;
  cashbox.addGanancia(60, "delivery");
  r = metas.calcular("");
  ok(cerca(r.hoy.meta, metaDeLaManana), "ganar no cambia la meta de hoy (antes la bajaba y además contaba como avance)");
  ok(r.hoy.ganado === 60, "lo ganado cuenta como avance");
  ok(cerca(r.hoy.falta, metaDeLaManana - 60), "y te falta la meta menos lo que hiciste");
  ok(cerca(r.diaria, r.hoy.meta), "Plan (HOY) y Inicio dicen lo mismo");

  // ---------- Lo que gastas hoy sí la sube, en vivo ----------
  cashbox.addGasto(30, "algo que no estaba planeado");
  r = metas.calcular("");
  ok(cerca(r.hoy.meta, metaDeLaManana + 30 / n), "un gasto de más sube la meta de hoy al toque");

  // ---------- Tu mínimo ----------
  financeGoals.setMinimoDiario(100);
  r = metas.calcular("");
  const tengo = 500 + 60 - 30;
  const conMinimo = tengo + Math.max(100 * n - 60, 0) - 2000;
  ok(r.escenarios.minimo && r.escenarios.minimo.porDia === 100, "con mínimo aparece su camino");
  ok(cerca(r.escenarios.minimo.sobra, conMinimo), "lo que sobraría haciendo tu mínimo (lo de hoy no se cuenta dos veces)");
  ok(r.escenarios.minimo.alcanza === conMinimo >= 0, "y dice si alcanza");
  const gustos = conMinimo > 0 ? conMinimo / r.diasRestantes : 0;
  ok(cerca(r.gustosPorDia, gustos), "los gustos por día salen de lo que sobraría con el mínimo");

  // ---------- Tu ritmo: lo de hoy tampoco se cuenta dos veces ----------
  // Hoy (60) no entra al promedio porque no terminó; sin otros días
  // trabajados todavía no hay ritmo.
  ok(r.escenarios.ritmo === null, "sin días terminados no hay ritmo");
  // Ayer se hizo 200: ese es el ritmo. De hoy ya se hicieron 60, así que de
  // hoy solo se proyectan los 140 que faltan para el promedio.
  cashbox.addMovimientoManual("ganancia", 200, "delivery", businessDay.addDays(HOY, -1));
  r = metas.calcular("");
  ok(r.ritmo.promedioDiario === 200, "el promedio sale de los días ya terminados");
  ok(cerca(r.ritmo.proyectado, 200 * n - 60), "de hoy solo proyecta lo que falta para el promedio");
  ok(cerca(r.escenarios.ritmo.sobra, r.tengo + 200 * n - 60 - 2000), "lo que sobraría a tu ritmo");

  // ---------- El mensaje de las 7am y el bot dicen lo mismo ----------
  const bot = require("./bot");
  const soles = (n) => "S/ " + n.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const texto = bot.textoCierreMes(r);
  ok(texto.includes("Para cerrar") && texto.includes(soles(r.tengo)) && texto.includes(soles(r.necesito)), "el mensaje trae lo que tienes y lo que te toca cubrir");
  ok(texto.includes("Tu mínimo (" + soles(100) + " por día)"), "trae tu mínimo");
  ok(texto.includes("📌 Hoy vence: Luz"), "avisa lo que vence hoy");
  ok(!/gastar hoy hasta/.test(texto), "ya no dice el 'puedes gastar hoy hasta' que estaba mal calculado");

  const meta = bot.responderConsultaFinanciera("meta de hoy");
  ok(meta.includes(soles(r.hoy.meta)) && meta.includes(soles(r.hoy.falta)), "'meta de hoy' por WhatsApp = la de Inicio");
  const mesResp = bot.responderConsultaFinanciera("resumen del mes");
  ok(mesResp.includes(soles(r.falta)), "'resumen del mes' dice lo que de verdad falta juntar");
  const gastar = bot.responderConsultaFinanciera("cuanto puedo gastar hoy");
  ok(gastar.includes("tu mínimo"), "'cuánto puedo gastar' responde con los gustos por día");

  // ---------- Un mínimo mal escrito no se guarda ----------
  let exploto = false;
  try {
    financeGoals.setMinimoDiario("cien");
  } catch (err) {
    exploto = true;
  }
  ok(exploto && financeGoals.getMinimoDiario() === 100, "un mínimo que no es un número no se guarda");

  // ---------- Hoy descansas ----------
  diasLibres.addFecha(HOY);
  r = metas.calcular("");
  ok(r.hoy.esLibre && r.hoy.meta === 0, "en tu día libre no hay meta de hoy");
  ok(cerca(r.diaria, r.falta / r.diasHabiles), "lo que hagas hoy baja lo de los días que sí trabajas");
  diasLibres.removeFecha(HOY);
});

fs.rmSync(CARPETA, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
