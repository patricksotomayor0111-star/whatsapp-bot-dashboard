// Pruebas del catálogo de productos y del autocompletado.
// Se corren con:  node finanzas/productos.prueba.js
//
// Escriben en una carpeta temporal (DATA_DIR) para no tocar datos reales.
const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "prueba-productos-"));

const { correrComo } = require("./contexto");
const p = require("./productos");

let fallos = 0;
function ok(nombre, real, esperado) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) {
    fallos++;
    console.log(`  FALLA ${nombre}: ${JSON.stringify(real)} != ${JSON.stringify(esperado)}`);
  } else {
    console.log(`  ok  ${nombre}`);
  }
}
const nombres = (lista) => lista.map((x) => x.nombre);

correrComo("prueba", () => {
  console.log("\n-- cargar el catálogo --");
  p.agregar("Inca Kola 500 ml", "3.00");
  p.agregar("Coca Cola 500 ml", "3.00", { codigo: "7501055300013" });
  p.agregar("Agua 625 ml", "2.00");
  p.agregar("Pan francés", "0.50");
  p.agregar("Queso para pan", "8.00");
  ok("5 productos", p.listar().length, 5);
  ok("precio en centavos", p.listar().find((x) => x.nombre === "Pan francés").precio, 50);

  console.log("\n-- agregar repetido actualiza, no duplica --");
  p.agregar("coca cola 500 ML", "3.50");
  ok("sigue habiendo 5", p.listar().length, 5);
  ok("precio actualizado", p.listar().find((x) => x.nombre === "Coca Cola 500 ml").precio, 350);
  ok("el nombre bien escrito no se pisa", nombres(p.listar()).includes("coca cola 500 ML"), false);
  p.agregar("Coca Cola 500 ml", "3.00");

  console.log("\n-- autocompletado --");
  ok("'coca' sugiere la Coca primero", nombres(p.sugerir("coca"))[0], "Coca Cola 500 ml");
  ok("'pan' prioriza el que empieza con pan", nombres(p.sugerir("pan")), ["Pan francés", "Queso para pan"]);
  ok("'coca 500' encuentra igual", nombres(p.sugerir("coca 500")), ["Coca Cola 500 ml"]);
  ok("sin tildes encuentra con tildes", nombres(p.sugerir("frances")), ["Pan francés"]);
  ok("'kola' por palabra interna", nombres(p.sugerir("kola")), ["Inca Kola 500 ml"]);
  ok("lo que no existe no sugiere nada", p.sugerir("zzz"), []);
  ok("respeta el límite", p.sugerir("ml", 2).length, 2);

  console.log("\n-- lo más vendido sube --");
  const agua = p.listar().find((x) => x.nombre === "Agua 625 ml");
  p.registrarUso(agua.id);
  p.registrarUso(agua.id);
  ok("usos contados", p.listar().find((x) => x.id === agua.id).usos, 2);
  ok("sin escribir nada, primero lo más usado", nombres(p.sugerir(""))[0], "Agua 625 ml");

  console.log("\n-- código de barras --");
  ok("busca exacto", p.porCodigo("7501055300013").nombre, "Coca Cola 500 ml");
  ok("código inexistente", p.porCodigo("000"), null);
  ok("código vacío no devuelve cualquiera", p.porCodigo(""), null);

  console.log("\n-- pasar a ítem de documento --");
  const item = p.aItem(p.listar().find((x) => x.nombre === "Pan francés"), 8);
  ok("ítem armado", item, { descripcion: "Pan francés", cantidad: 8, precioUnitario: "0.50" });

  console.log("\n-- importar una lista pegada --");
  const r = p.importarTexto([
    "Galleta Soda  1.50",
    "2.00 Chicha morada vaso",
    "Keke | 4.00",
    "esto no tiene precio",
    "",
    "Leche Gloria tarro S/ 4.80",
  ].join("\n"));
  ok("4 importados", r.agregados, 4);
  ok("1 ignorada", r.ignoradas, ["esto no tiene precio"]);
  ok("precio al final", p.listar().find((x) => x.nombre === "Galleta Soda").precio, 150);
  ok("precio al inicio", p.listar().find((x) => x.nombre === "Chicha morada vaso").precio, 200);
  ok("separado por barra", p.listar().find((x) => x.nombre === "Keke").precio, 400);
  ok("con S/ al final", p.listar().find((x) => x.nombre === "Leche Gloria tarro").precio, 480);

  console.log("\n-- editar y borrar --");
  const keke = p.listar().find((x) => x.nombre === "Keke");
  p.actualizar(keke.id, { precio: "4.50", nombre: "Keke de chocolate" });
  ok("precio editado", p.listar().find((x) => x.id === keke.id).precio, 450);
  ok("nombre editado", p.listar().find((x) => x.id === keke.id).nombre, "Keke de chocolate");
  ok("borrar", p.eliminar(keke.id), true);
  ok("borrar lo que no está", p.eliminar(99999), false);

  console.log("\n-- sobrevive al reinicio --");
  ok("se guardó en disco", fs.existsSync(path.join(process.env.DATA_DIR, "users", "prueba", "productos-data.json")), true);
});

console.log(fallos === 0 ? "\nTODO OK\n" : `\n${fallos} FALLAS\n`);
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
process.exit(fallos === 0 ? 0 : 1);
