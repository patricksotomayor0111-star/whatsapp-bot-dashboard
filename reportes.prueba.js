const path = require("path");
const fs = require("fs");
const os = require("os");

// REPORTES: el bot le responde SOLO a la central, y SOLO con sus dos frases
// ("Pendiente / Compra de cliente" y "Pendiente / Recojo de cliente"),
// aunque las escriba con letras cambiadas. Nada más: la central también
// escribe "Pendiente / Cantones", "Pendiente / Borgo"... y ahí no va.
//
// Se corre con: node reportes.prueba.js
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "reportes-"));
process.env.DATA_DIR = CARPETA;
delete process.env.ANTHROPIC_API_KEY;

const bot = require("./bot");
const numberExceptions = require("./numberExceptions");
const { sectorSeedByName, numberExceptionSeed } = require("./groupSeed");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}

const GRUPO = "120363000000000000@g.us";
const CENTRAL = "960186738";
bot.botState.groups.push({ id: GRUPO, name: "REPORTES BOX DELIVERY" });
numberExceptionSeed["REPORTES BOX DELIVERY"][CENTRAL].forEach((f) =>
  numberExceptions.addException(GRUPO, CENTRAL, f.phrase || f)
);

const responde = (texto, numero = CENTRAL) => bot.probarFrase(texto, GRUPO, numero).detecta;

// ---------- Sus dos frases, bien y mal escritas ----------
[
  "Pendiente\nCompra de cliente",
  "Pendiente\nRecojo de cliente",
  "Pendiente\nConrpw de cliente", // el caso real: n por m, r y p al revés, w por a
  "Pendiente\nCompr de clinte",
  "Pendiente\nConpra de cliente",
  "Pendiente\nCmpra de cliente",
  "Pendiente\nCompra de client",
  "Pendiente\nC0mpra de cliente",
  "Pendiente\nXompra de cliente",
  "Pendiente\nRecjoo de cliente",
  "Pendiente\nRevojo de cliente",
  "Pendiente\nCompras de cliente",
  "Pendiente\nRecojo del cliente",
  "Hola\nPendiente\nCompra de cliente",
  // Los trucos con los espacios siguen cayendo.
  "Pendiente comprde cliente",
  "pendientecompradecliente",
  "P E N D I E N T E\nCompra de cliente",
  "Pendi enteCompra de cliente",
  "Pendiente\nCompra decliente",
].forEach((t) => ok(responde(t), `responde: ${JSON.stringify(t)}`));

// ---------- Lo que no es su pedido ----------
[
  "Pendiente\nCantones",
  "Pendiente\nBorgo",
  "Pendiente\nCantones\nBorgo",
  "Pendiente",
  "Conrpw de cliente", // sin "pendiente"
  "Pendiente\nPago de cliente",
  "Pendiente\nCambio de cliente",
  "Pendiente\nCampo de cliente",
  // Estas tres respondían antes: estaban a 2 o 3 letras de las de verdad.
  "Pendiente\nCobro de cliente",
  "Pendiente\nRecibo de cliente",
  "Pendiente\nReclamo de cliente",
  "Hola\nPendiente\nCobro de cliente",
  "Pendiente\nEntrega de cliente",
  "Pendiente\nCliente no contesta",
].forEach((t) => ok(!responde(t), `no responde: ${JSON.stringify(t)}`));

// Otro número escribiendo lo mismo: en REPORTES solo cuenta la central.
ok(!responde("Pendiente\nCompra de cliente", "999888777"), "otro número con la misma frase: no responde");

// Los locales que la central nombra en sus "Pendiente / <local>".
const nombres = Object.keys(sectorSeedByName);
const conLocal = nombres.filter((n) => responde(`Pendiente\n${n}`) || responde(n));
ok(conLocal.length === 0, `ningún "Pendiente / <local>" responde (${nombres.length} locales)` + (conLocal.length ? `: ${conLocal.join(", ")}` : ""));

fs.rmSync(CARPETA, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
