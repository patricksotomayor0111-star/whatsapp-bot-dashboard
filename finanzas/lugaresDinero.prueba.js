const path = require("path");
const fs = require("fs");
const os = require("os");

// Carpeta propia y descartable: la prueba no puede tocar datos de verdad.
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "lugares-"));
process.env.DATA_DIR = CARPETA;

const { correrComo } = require("./contexto");
const lugares = require("./lugaresDinero");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}

fs.mkdirSync(path.join(CARPETA, "users", "prueba"), { recursive: true });

correrComo("prueba", () => {
  // Lo que viene de fábrica.
  const base = lugares.getAll();
  ok(base.length === 2, "arranca con efectivo y Yape");
  ok(base[0].id === "efectivo" && base[0].porDefecto, "el efectivo es el de por defecto");
  ok(base[0].esEfectivo === true, "y está marcado como efectivo");

  // Por palabra, y por palabra COMPLETA.
  ok(lugares.clasificar("80 bum yape") === "yape", "reconoce yape en medio de la frase");
  ok(lugares.clasificar("me yapearon 50") === "yape", "reconoce otra forma de la palabra");
  ok(lugares.clasificar("30 plin mia") === "yape", "plin también cae en Yape");
  ok(lugares.clasificar("80 bum") === "efectivo", "sin palabra cae en efectivo");
  ok(lugares.clasificar("50 yapemart") === "efectivo", "no matchea dentro de otra palabra");
  ok(lugares.clasificar("") === "efectivo", "sin descripción, efectivo");

  // Lo puesto a mano manda sobre lo detectado.
  ok(lugares.resolveLugarId({ descripcion: "80 bum yape" }) === "yape", "sin nada a mano usa las palabras");
  ok(
    lugares.resolveLugarId({ descripcion: "80 bum yape", lugarId: "efectivo" }) === "efectivo",
    "lo puesto a mano manda"
  );
  ok(
    lugares.resolveLugarId({ descripcion: "80 bum yape", lugarId: "no_existe" }) === "yape",
    "un lugar que ya no existe no rompe nada"
  );

  // Agregar, editar y borrar.
  const banco = lugares.addLugar({ label: "Banco BCP", keywords: ["bcp", "deposito"] });
  ok(banco.id === "banco_bcp", "el id sale del nombre");
  ok(lugares.clasificar("500 deposito sueldo") === "banco_bcp", "el lugar nuevo reconoce sus palabras");

  let exploto = false;
  try {
    lugares.addLugar({ label: "Banco BCP" });
  } catch (err) {
    exploto = true;
  }
  ok(exploto, "no deja dos lugares con el mismo nombre");

  exploto = false;
  try {
    lugares.removeLugar("efectivo");
  } catch (err) {
    exploto = true;
  }
  ok(exploto, "el efectivo no se puede borrar");

  ok(lugares.editLugar("banco_bcp", { label: "Banco" }).label === "Banco", "se puede renombrar");
  ok(lugares.removeLugar("banco_bcp") === true, "los demás sí se borran");
  ok(lugares.clasificar("500 deposito sueldo") === "efectivo", "y lo suyo vuelve a caer en efectivo");

  // Los saldos: cuánto hay en cada lado.
  const movs = [
    { tipo: "ganancia", monto: 80, descripcion: "bum yape" },
    { tipo: "ganancia", monto: 40, descripcion: "mister" },
    { tipo: "gasto", monto: 10, descripcion: "gasolina" },
    { tipo: "gasto", monto: 30, descripcion: "recarga yape" },
    // Un conteo de caja no suma ni resta: solo dice cuánto hay.
    { tipo: "caja", monto: 9999, descripcion: "conteo de caja" },
  ];
  const s = lugares.getSaldos(movs);
  const efectivo = s.detalle.find((l) => l.id === "efectivo");
  const yape = s.detalle.find((l) => l.id === "yape");

  ok(efectivo.entro === 40 && efectivo.salio === 10, "el efectivo suma lo suyo");
  ok(efectivo.saldo === 30, "y su saldo");
  ok(yape.entro === 80 && yape.salio === 30 && yape.saldo === 50, "Yape también");
  ok(s.fueraDelEfectivo === 50, "dice cuánto NO está en el bolsillo");
  ok(efectivo.movimientos === 2 && yape.movimientos === 2, "un conteo de caja no cuenta como movimiento de lugar");

  const vacio = lugares.getSaldos([]);
  ok(vacio.fueraDelEfectivo === 0, "sin movimientos, nada fuera del efectivo");
});

fs.rmSync(CARPETA, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
