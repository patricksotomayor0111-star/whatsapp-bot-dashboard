const path = require("path");
const fs = require("fs");
const os = require("os");

// La meta automática y los días de descanso.
//
// Un día de descanso no tiene meta: lo que falta se reparte entre los días
// que SÍ va a salir. Pedirle su meta de un día de trabajo en su día libre
// es pedirle algo que no se propuso. Y si sale un rato igual, eso es
// extra: no puede bajarle el promedio ni hacerle creer que rinde menos.
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "metas-"));
process.env.DATA_DIR = CARPETA;
fs.mkdirSync(path.join(CARPETA, "users", "prueba"), { recursive: true });

const { correrComo } = require("./contexto");
const metas = require("./metasAutomaticas");
const diasLibres = require("./diasLibres");
const cashbox = require("./cashbox");
const businessDay = require("./businessDay");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}

const HOY = businessDay.businessDayLabel();
const DIA_DE_HOY = businessDay.ymdToUtc(HOY).getUTCDay();

correrComo("prueba", () => {
  // ---------- Sin días libres: como siempre ----------
  let r = metas.calcular("");
  ok(r.hoyEsLibre === false, "sin días libres configurados, hoy no es libre");
  const habilesAntes = r.diasHabiles;
  ok(habilesAntes > 0, "cuenta días hábiles");

  // ---------- Marcando hoy como día de descanso ----------
  diasLibres.setSemanales([DIA_DE_HOY]);
  r = metas.calcular("");
  ok(r.hoyEsLibre === true, "marcado el día de la semana, hoy es libre");
  ok(r.diasHabiles < habilesAntes, "y quedan menos días de trabajo");

  // Lo que falta se reparte entre los que quedan, así que la meta de un
  // día de trabajo SUBE: son menos días para lo mismo.
  if (r.falta > 0) {
    ok(r.diaria > 0, "sigue habiendo meta para los días que sí trabaja");
  }

  // ---------- Lo ganado en un día libre no entra al promedio ----------
  diasLibres.setSemanales([]);
  diasLibres.addFecha(HOY); // hoy, como fecha suelta
  ok(diasLibres.esLibre(HOY) === true, "una fecha suelta también es día libre");

  // Un día de trabajo bueno y hoy (libre) un rato flojo.
  const ayer = businessDay.addDays(HOY, -1);
  cashbox.addMovimientoManual("ganancia", 200, "bum", ayer);
  r = metas.calcular("");
  const promedioSoloTrabajo = r.ritmo.promedioDiario;
  ok(promedioSoloTrabajo === 200, "el promedio sale del día de trabajo");

  cashbox.addMovimientoManual("ganancia", 40, "bum ratito", HOY);
  r = metas.calcular("");
  ok(r.ritmo.promedioDiario === 200, "salir un rato en tu día libre NO te baja el promedio");
  ok(r.ganadoEnDiasLibres === 40, "pero sí queda contado aparte como extra");
  ok(r.hoyEsLibre === true, "y hoy sigue siendo libre");

  // Esa plata igual cuenta en lo que tienes: es tuya.
  const hoyCaja = cashbox.getToday();
  ok(hoyCaja.ganancias === 40, "la plata del día libre sí entra a la caja");

  // ---------- Un día normal vuelve a contar ----------
  diasLibres.removeFecha(HOY);
  r = metas.calcular("");
  ok(r.hoyEsLibre === false, "sacándole la marca, hoy vuelve a ser día de trabajo");
  ok(r.ritmo.promedioDiario === 120, "y ahora sí promedia los dos días (200 y 40)");
  ok(r.ganadoEnDiasLibres === 0, "ya no hay nada contado como extra");

  // ---------- Si marca TODO libre no se rompe ----------
  diasLibres.setSemanales([0, 1, 2, 3, 4, 5, 6]);
  r = metas.calcular("");
  ok(r.diasHabiles >= 1, "con todo marcado libre no divide entre cero");
  ok(Number.isFinite(r.diaria), "y la meta sigue siendo un número");
});

fs.rmSync(CARPETA, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
