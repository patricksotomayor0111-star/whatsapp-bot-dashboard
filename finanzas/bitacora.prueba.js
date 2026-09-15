const path = require("path");
const fs = require("fs");
const os = require("os");

const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "bitacora-"));
process.env.DATA_DIR = CARPETA;

const contexto = require("./contexto");
const bitacora = require("./bitacora");
const cashbox = require("./cashbox");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}

fs.mkdirSync(path.join(CARPETA, "users", "prueba"), { recursive: true });

// Sin usuario en contexto no puede tumbar nada, solo no anota.
ok(bitacora.registrar({ que: "movimiento", accion: "creo" }) === null, "sin sesión no anota y no explota");

contexto.correrComo("prueba", () => {
  contexto.marcarOrigen("panel");

  const id = cashbox.addGasto(20, "gasolina");
  let entradas = bitacora.getEntradas();
  ok(entradas.length === 1, "anota el gasto");
  ok(entradas[0].que === "movimiento" && entradas[0].accion === "creo", "con su qué y su acción");
  ok(entradas[0].origen === "panel", "y de dónde vino");
  ok(entradas[0].resumen.includes("20") && entradas[0].resumen.includes("gasolina"), "el resumen se entiende solo");

  // Editar tiene que decir QUÉ cambió, no solo que cambió.
  cashbox.editMovimientoPorId(id, { monto: 35, descripcion: "gasolina grifo" });
  entradas = bitacora.getEntradas();
  const edicion = entradas[0];
  ok(edicion.accion === "edito", "anota la corrección");
  const porCampo = Object.fromEntries(edicion.cambios.map((c) => [c.campo, c]));
  ok(porCampo.monto && porCampo.monto.antes === 20 && porCampo.monto.despues === 35, "dice cómo cambió el monto");
  ok(porCampo.descripcion.antes === "gasolina", "y la descripción");
  ok(!porCampo.fecha, "lo que no cambió no aparece");

  // Cambiar de origen queda registrado.
  contexto.marcarOrigen("whatsapp");
  cashbox.addGanancia(50, "bum");
  ok(bitacora.getEntradas()[0].origen === "whatsapp", "un mensaje de WhatsApp se anota como tal");

  // Borrar guarda cómo estaba.
  contexto.marcarOrigen("panel");
  cashbox.removeMovimientoPorId(id);
  const borrado = bitacora.getEntradas()[0];
  ok(borrado.accion === "borro", "anota el borrado");
  ok(borrado.antes && borrado.antes.monto === 35, "y con cuánto estaba cuando lo borraste");

  // Un conteo de caja deja dicho si cuadró.
  cashbox.setCaja(1000);
  const conteo = bitacora.getEntradas()[0];
  ok(conteo.que === "caja" && conteo.accion === "conto", "anota el conteo de caja");
  ok(conteo.resumen.includes("1000"), "con lo que contaste");

  // El cierre del día, que es donde más veces se perdió el rastro.
  cashbox.closeDay(cashbox.getHoyLabel());
  const cierre = bitacora.getEntradas().find((e) => e.que === "dia");
  ok(!!cierre && cierre.accion === "cerro", "anota el cierre del día");

  // Filtros.
  ok(bitacora.getEntradas({ que: "caja" }).every((e) => e.que === "caja"), "se puede filtrar por tipo");
  ok(bitacora.getEntradas({ limite: 2 }).length === 2, "se puede pedir solo las últimas");
  ok(bitacora.getEntradas({ desde: "2999-01-01" }).length === 0, "filtrar por fecha deja fuera lo viejo");

  // Las más nuevas primero: es como se lee cuando algo no cuadra.
  const todas = bitacora.getEntradas();
  ok(todas[0].cuando >= todas[todas.length - 1].cuando, "vienen de la más nueva a la más vieja");
  ok(bitacora.contar() === todas.length, "el contador coincide");
});

fs.rmSync(CARPETA, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
