const path = require("path");
const fs = require("fs");
const os = require("os");

// Deudas, faltantes y custodia se editaban por su posición en la lista.
// Con el panel abierto en dos lados, o con el bot anotando algo mientras
// tanto, la lista cambiaba entre que la abrías y que tocabas guardar: se
// corregía el que no era. Esto comprueba que ahora se editan por
// identidad y que los datos viejos (sin id) se migran solos.
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "identidad-"));
process.env.DATA_DIR = CARPETA;

const { correrComo } = require("./contexto");
const custodias = require("./custodias");
const debts = require("./debts");
const shortfalls = require("./shortfalls");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}

const CARPETA_USUARIO = path.join(CARPETA, "users", "prueba");
fs.mkdirSync(CARPETA_USUARIO, { recursive: true });

correrComo("prueba", () => {
  // ---------- CUSTODIA ----------
  custodias.addPersona("Ana");
  custodias.addPersona("Mama");
  custodias.registrar("ana", "guardo", 100, "primero");
  custodias.registrar("ana", "gasto", 30, "segundo");
  custodias.registrar("ana", "guardo", 50, "tercero");

  let movs = custodias.getMovimientos("ana");
  ok(movs.every((m) => m.id && m.id.startsWith("cus_")), "custodia: todos tienen id");
  ok(new Set(movs.map((m) => m.id)).size === 3, "custodia: los ids no se repiten");

  const idSegundo = movs[1].id;
  // Se borra el PRIMERO: si se editara por posición, el "segundo" pasaría
  // a ser el índice 0 y se tocaría el que no era.
  custodias.removeMovimientoPorId("ana", movs[0].id);
  custodias.editMovimientoPorId("ana", idSegundo, { monto: 33 });
  movs = custodias.getMovimientos("ana");
  ok(movs.find((m) => m.id === idSegundo).monto === 33, "custodia: edita el correcto tras borrar otro");
  ok(movs.find((m) => m.descripcion === "tercero").monto === 50, "custodia: el otro queda intacto");

  const r = custodias.moverMovimiento("ana", idSegundo, "mama");
  ok(r && r.a === "Mama", "custodia: mover dice a quién fue");
  ok(!custodias.getMovimientos("ana").some((m) => m.id === idSegundo), "custodia: salió del origen");
  ok(custodias.getMovimientos("mama").some((m) => m.id === idSegundo), "custodia: llegó al destino");
  ok(custodias.moverMovimiento("ana", "no_existe", "mama") === null, "custodia: un id inventado no mueve nada");
  ok(custodias.moverMovimiento("mama", idSegundo, "mama") === null, "custodia: moverlo a sí mismo no hace nada");

  const personas = custodias.getPersonas();
  ok(personas.find((p) => p.clave === "ana").saldo === 50, "custodia: el saldo sale de sumar el historial");
  ok(personas.find((p) => p.clave === "mama").saldo === -33, "custodia: el gasto movido resta en el destino");

  // ---------- DEUDAS ----------
  debts.addDebt("Juan", 100, "fiado 1");
  debts.addDebt("Juan", 40, "fiado 2");
  debts.payDebt("Juan", 20, "abono");
  const dm = debts.getMovimientos("Juan");
  ok(dm.length === 3 && dm.every((m) => m.id && m.id.startsWith("deu_")), "deudas: todos tienen id");
  ok(debts.getDeuda("Juan").saldo === 120, "deudas: saldo 100+40-20");

  const idFiado2 = dm[1].id;
  debts.removeMovimientoPorId("Juan", dm[0].id);
  debts.editMovimientoPorId("Juan", idFiado2, { monto: 60 });
  ok(debts.getDeuda("Juan").saldo === 40, "deudas: el saldo sigue los cambios por id");
  ok(debts.getMovimientos("Juan").find((m) => m.id === idFiado2).monto === 60, "deudas: edita el correcto");
  ok(debts.editMovimientoPorId("Juan", "no_existe", { monto: 1 }) === null, "deudas: id inventado no edita");
  ok(debts.removeMovimientoPorId("Juan", "no_existe") === false, "deudas: id inventado no borra");

  // ---------- FALTANTES ----------
  shortfalls.addFaltante(10, "uno", "mov_a");
  shortfalls.addFaltante(25, "dos", "mov_b");
  const fm = shortfalls.getMovimientos();
  ok(fm.every((m) => m.id && m.id.startsWith("fal_")), "faltantes: todos tienen id");
  ok(shortfalls.getTotal() === 35, "faltantes: el total suma");

  const idDos = fm[1].id;
  shortfalls.removeMovimientoPorId(fm[0].id);
  shortfalls.editMovimientoPorId(idDos, { monto: 30 });
  ok(shortfalls.getTotal() === 30, "faltantes: el total sigue los cambios por id");
  ok(shortfalls.removeMovimientoPorId("no_existe") === null, "faltantes: id inventado no borra");
  // El enlace con el gasto que dejó en la caja tiene que seguir andando.
  ok(shortfalls.editPorMovimiento("mov_b", { monto: 31 }) !== null, "faltantes: sigue el enlace con la caja");

  // ---------- DATOS VIEJOS, SIN ID ----------
  const archivo = path.join(CARPETA_USUARIO, "custodias-data.json");
  const crudo = JSON.parse(fs.readFileSync(archivo, "utf8"));
  crudo.personas.viejo = {
    label: "Viejo",
    movimientos: [
      { fecha: "2026-01-01", hora: "10:00", tipo: "guardo", monto: 70, descripcion: "sin id" },
      { fecha: "2026-01-02", hora: "11:00", tipo: "gasto", monto: 20, descripcion: "tampoco" },
    ],
  };
  fs.writeFileSync(archivo, JSON.stringify(crudo, null, 2));

  delete require.cache[require.resolve("./custodias")];
  const custodias2 = require("./custodias");
  const viejos = custodias2.getMovimientos("viejo");
  ok(viejos.length === 2 && viejos.every((m) => m.id), "viejos: se les pone id al leerlos");
  const guardado = JSON.parse(fs.readFileSync(archivo, "utf8"));
  ok(guardado.personas.viejo.movimientos.every((m) => m.id), "viejos: el id queda guardado en disco");
  ok(custodias2.editMovimientoPorId("viejo", viejos[1].id, { monto: 21 }) !== null, "viejos: ya se editan por id");
});

fs.rmSync(CARPETA, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
