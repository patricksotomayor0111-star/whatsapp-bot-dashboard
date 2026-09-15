// Pruebas de plantillas. Se corren con:  node finanzas/plantillas.prueba.js
const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "prueba-plantillas-"));

const { correrComo } = require("./contexto");
const pl = require("./plantillas");
const termica = require("./termica");

let fallos = 0;
function ok(nombre, real, esperado) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) { fallos++; console.log(`  FALLA ${nombre}: ${JSON.stringify(real)} != ${JSON.stringify(esperado)}`); }
  else console.log(`  ok  ${nombre}`);
}
function intentar(fn) { try { fn(); return null; } catch (e) { return e.message; } }

const DOC = {
  emisor: { nombre: "MI BODEGA", ruc: "20123456789" },
  numero: "NV001-000007",
  items: [{ descripcion: "Pan", cantidad: 3, precioUnitario: "0.50" }],
};

correrComo("prueba", () => {
  console.log("\n-- las de fábrica --");
  ok("hay tres", pl.DE_FABRICA.length, 3);
  ok("la activa por defecto", pl.activa().id, "completa");
  ok("no se pueden borrar", pl.eliminar("completa"), false);

  console.log("\n-- cambiar de plantilla cambia el papel --");
  const completa = termica.previa(DOC, { perfil: "pos-8001dd", plantilla: pl.porId("completa").bloques });
  const corta = termica.previa(DOC, { perfil: "pos-8001dd", plantilla: pl.porId("corta").bloques });
  const comanda = termica.previa(DOC, { perfil: "pos-8001dd", plantilla: pl.porId("comanda").bloques });
  ok("la completa trae el IGV", completa.includes("IGV"), true);
  ok("la corta también (mismo documento)", corta.includes("TOTAL"), true);
  ok("la corta es más corta", corta.split("\n").length < completa.split("\n").length, true);
  ok("la comanda no muestra totales", comanda.includes("TOTAL"), false);
  ok("la comanda sí los productos", comanda.includes("Pan"), true);

  console.log("\n-- guardar una propia --");
  const mia = pl.guardar("La mía", [
    { tipo: "campo", campo: "emisor.nombre", align: "center", negrita: true },
    { tipo: "items" },
    { tipo: "totales" },
  ]);
  ok("le pone id", mia.id, "p1");
  ok("queda activa al guardarla", pl.activa().id, "p1");
  ok("aparece en la lista", pl.todas().length, 4);

  console.log("\n-- limpieza de lo que llega --");
  const sucia = pl.limpiarBloques([
    { tipo: "inventado" },
    { tipo: "texto", texto: "hola", align: "diagonal", negrita: 1 },
    { tipo: "separador", caracter: "==" },
    { tipo: "espacio", lineas: 99 },
    { tipo: "campo", campo: "no.existe" },
    null,
  ]);
  ok("descarta el tipo inventado y el nulo", sucia.length, 4);
  ok("descarta la alineación inválida", sucia[0].align, undefined);
  ok("negrita queda booleana", sucia[0].negrita, true);
  ok("el separador es un solo carácter", sucia[1].caracter, "=");
  ok("el espacio tiene tope", sucia[2].lineas, 6);
  ok("el campo inválido cae al primero", sucia[3].campo, "emisor.nombre");

  console.log("\n-- una plantilla vacía no se guarda --");
  ok("avisa", intentar(() => pl.guardar("Vacía", [])).includes("ningún bloque"), true);
  ok("tampoco con puros bloques inválidos", intentar(() => pl.guardar("Mala", [{ tipo: "xx" }])).includes("ningún bloque"), true);

  console.log("\n-- editar y borrar --");
  pl.guardar("Renombrada", mia.bloques, "p1");
  ok("se renombró sin duplicar", pl.todas().filter((p) => p.id === "p1")[0].nombre, "Renombrada");
  ok("sigue habiendo 4", pl.todas().length, 4);
  ok("borrar la propia", pl.eliminar("p1"), true);
  ok("al borrar la activa vuelve a la de fábrica", pl.activa().id, "completa");

  console.log("\n-- un bloque desconocido no rompe la impresión --");
  const conBasura = termica.previa(DOC, { perfil: "pos-8001dd", plantilla: [
    { tipo: "campo", campo: "emisor.nombre", align: "center" },
    { tipo: "esto-no-existe" },
    { tipo: "items" },
  ]});
  ok("imprime el resto igual", conBasura.includes("MI BODEGA") && conBasura.includes("Pan"), true);

  console.log("\n-- tamaño doble: la mitad de columnas --");
  // A doble tamaño cada carácter ocupa el doble, así que en la fila entran
  // 24 y no 48. Si se calculara sobre 48, la línea se desbordaría y la
  // impresora la partiría donde le tocara.
  const normal = termica.previa(DOC, { perfil: "pos-8001dd", plantilla: [{ tipo: "totales" }] });
  const doble = termica.previa(DOC, { perfil: "pos-8001dd", plantilla: [{ tipo: "totales", tamano: 2 }] });
  const lineaTotal = (t) => t.split("\n").find((l) => l.startsWith("TOTAL:"));
  ok("normal ocupa 48", lineaTotal(normal).length, 48);
  ok("doble ocupa 24", lineaTotal(doble).length, 24);
  ok("el importe no se pierde", lineaTotal(doble).includes("1.50"), true);
  // El TOTAL va al doble, pero el subtotal y el IGV se quedan a tamaño
  // normal: el doble se reserva para el número que el cliente busca.
  const lineaSub = doble.split("\n").find((l) => l.startsWith("SUBTOTAL:"));
  ok("el subtotal sigue ocupando 48", lineaSub.length, 48);

  console.log("\n-- la marca DEMO no depende de la plantilla --");
  const demoCorta = termica.previa({ ...DOC, demo: true }, { perfil: "pos-8001dd", plantilla: pl.porId("corta").bloques });
  ok("sale aunque la plantilla no la tenga", demoCorta.includes("NO VÁLIDO"), true);
  const demoVacia = termica.previa({ ...DOC, demo: true }, { perfil: "pos-8001dd", plantilla: [{ tipo: "items" }] });
  ok("sale con la plantilla más pelada", demoVacia.includes("DEMOSTRACIÓN"), true);
});

console.log(fallos === 0 ? "\nTODO OK\n" : `\n${fallos} FALLAS\n`);
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
process.exit(fallos === 0 ? 0 : 1);
