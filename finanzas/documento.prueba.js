// Pruebas del modelo de documento y del render térmico.
// Se corren con:  node finanzas/documento.prueba.js
//
// Sin framework ni dependencias, igual que el resto del proyecto: son
// comparaciones sueltas que imprimen qué pasó y terminan con código
// distinto de cero si algo falla, que es lo que hace falta para no
// romper la aritmética del dinero sin darse cuenta.

const d = require("./documento");
const t = require("./termica");

let fallos = 0;
function ok(nombre, real, esperado) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) { fallos++; console.log(`  FALLA ${nombre}: ${JSON.stringify(real)} != ${JSON.stringify(esperado)}`); }
  else console.log(`  ok  ${nombre}`);
}

// Uint8Array.includes() busca UN valor, no una subsecuencia como hacía
// Buffer.includes(). Como los bytes ahora son Uint8Array (para que la
// impresión se pueda armar en el navegador), hace falta buscar a mano.
function contiene(bytes, patron) {
  for (let i = 0; i + patron.length <= bytes.length; i++) {
    let igual = true;
    for (let j = 0; j < patron.length; j++) {
      if (bytes[i + j] !== patron[j]) { igual = false; break; }
    }
    if (igual) return true;
  }
  return false;
}

console.log("\n-- lectura de precios --");
ok("entero", d.aCentavos(3), 300);
ok("decimal punto", d.aCentavos("3.00"), 300);
ok("decimal coma", d.aCentavos("3,50"), 350);
ok("con simbolo", d.aCentavos("S/ 12.50"), 1250);
ok("miles con coma", d.aCentavos("1,234.56"), 123456);
ok("miles con punto", d.aCentavos("1.234,56"), 123456);
ok("coma de miles sola", d.aCentavos("1,500"), 150000);
ok("vacio", d.aCentavos(""), 0);
ok("un decimal", d.aCentavos("2.5"), 250);

console.log("\n-- los ítems impresos suman el total impreso --");
// 3 x 0.33 = 0.99 exacto; el caso feo es cantidad decimal.
const doc1 = d.normalizar({
  items: [
    { descripcion: "Pan", cantidad: 3, precioUnitario: "0.333" },
    { descripcion: "Queso", cantidad: 1.5, precioUnitario: "12.90" },
  ],
});
const sumaVisible = doc1.items.reduce((s, it) => s + d.importeDe(it), 0);
ok("suma de líneas = total", sumaVisible, doc1.totales.total);

console.log("\n-- IGV --");
const conIgv = d.normalizar({ items: [{ descripcion: "X", cantidad: 1, precioUnitario: "14.75" }] });
ok("total = precio (IGV incluido)", conIgv.totales.total, 1475);
ok("subtotal + IGV = total", conIgv.totales.subtotal + conIgv.totales.igv, conIgv.totales.total);
ok("subtotal deducido", d.aTexto(conIgv.totales.subtotal), "12.50");
ok("IGV deducido", d.aTexto(conIgv.totales.igv), "2.25");

const sinIgv = d.normalizar({ igvIncluido: false, items: [{ descripcion: "X", cantidad: 1, precioUnitario: "12.50" }] });
ok("IGV sumado encima", sinIgv.totales.total, 1475);
ok("cuadra sin IGV incluido", sinIgv.totales.subtotal + sinIgv.totales.igv, sinIgv.totales.total);

// El caso que rompe si se redondea por separado.
let descuadres = 0;
for (let c = 1; c <= 20000; c++) {
  const x = d.calcularTotales([{ cantidad: 1, precioUnitario: c, descuento: 0 }], {});
  if (x.subtotal + x.igv !== x.total) descuadres++;
}
ok("20000 precios, ninguno descuadra", descuadres, 0);

console.log("\n-- exonerado de IGV --");
const exo = d.normalizar({ tasaIgv: 0, items: [{ descripcion: "X", cantidad: 2, precioUnitario: "5.00" }] });
ok("sin IGV el total es la suma", exo.totales.total, 1000);
ok("IGV cero", exo.totales.igv, 0);

console.log("\n-- el monto en letras --");
ok("el de la boleta de la foto", d.montoEnLetras(2150), "VEINTIÚN CON 50/100 SOLES");
ok("uno", d.montoEnLetras(100), "UN CON 00/100 SOLES");
ok("cien exacto es CIEN", d.montoEnLetras(10000), "CIEN CON 00/100 SOLES");
ok("ciento uno no es CIEN UNO", d.montoEnLetras(10100), "CIENTO UN CON 00/100 SOLES");
ok("veintidós va pegado", d.montoEnLetras(2200), "VEINTIDÓS CON 00/100 SOLES");
ok("veintiséis con tilde", d.montoEnLetras(2600), "VEINTISÉIS CON 00/100 SOLES");
ok("treinta y uno va separado", d.montoEnLetras(3100), "TREINTA Y UN CON 00/100 SOLES");
ok("mil solo, nunca UN MIL", d.montoEnLetras(100000), "MIL CON 00/100 SOLES");
ok("dos mil", d.montoEnLetras(200000), "DOS MIL CON 00/100 SOLES");
ok("cero", d.montoEnLetras(0), "CERO CON 00/100 SOLES");
ok("solo centavos", d.montoEnLetras(5), "CERO CON 05/100 SOLES");
ok("centavos con cero a la izquierda", d.montoEnLetras(1205), "DOCE CON 05/100 SOLES");
ok("un millón", d.montoEnLetras(100000000), "UN MILLÓN CON 00/100 SOLES");
ok("quinientos", d.montoEnLetras(50000), "QUINIENTOS CON 00/100 SOLES");
ok("otra moneda", d.montoEnLetras(2150, "DÓLARES"), "VEINTIÚN CON 50/100 DÓLARES");

console.log("\n-- envolver --");
ok("palabra larguísima se parte", t.envolver("ABCDEFGHIJ", 4), ["ABCD", "EFGH", "IJ"]);
ok("respeta palabras", t.envolver("hola mundo cruel", 11), ["hola mundo", "cruel"]);
ok("vacío", t.envolver("", 10), [""]);

console.log("\n-- columnas --");
ok("ancho exacto", t.columnas("TOTAL:", "S/ 14.75", 32).length, 32);
ok("recorta la izquierda", t.columnas("x".repeat(50), "9.99", 16).length, 16);
ok("conserva el importe", t.columnas("x".repeat(50), "9.99", 16).endsWith("9.99"), true);

console.log("\n-- reflujo: agregar un ítem no desacomoda nada --");
let doc2 = d.normalizar({ items: [{ descripcion: "Coca Cola 500 ml", cantidad: 2, precioUnitario: "3.00" }] });
const antes = doc2.totales.total;
doc2 = d.agregarItem(doc2, { descripcion: "Pan", cantidad: 1, precioUnitario: "2.50" });
ok("total recalculado solo", doc2.totales.total, antes + 250);
ok("2 ítems", doc2.items.length, 2);
doc2 = d.quitarItem(doc2, doc2.items[0].id);
ok("total tras quitar", doc2.totales.total, 250);

console.log("\n-- normalizar es idempotente --");
const base = { items: [{ descripcion: "Pan", cantidad: 3, precioUnitario: "2.50", descuento: "0.50" }], descuentoGlobal: "1.00", pago: { medio: "Efectivo", recibido: "20.00" } };
const una = d.normalizar(base);
const dosVeces = d.normalizar(una);
const tresVeces = d.normalizar(dosVeces);
ok("normalizar x2 = x1", dosVeces, una);
ok("normalizar x3 = x1", tresVeces, una);
ok("precio no se infla", una.items[0].precioUnitario, 250);
ok("descuento global estable", dosVeces.totales.descuentoGlobal, 100);
ok("recibido estable", dosVeces.pago.recibido, 2000);

console.log("\n-- vuelto --");
const conVuelto = d.normalizar({ items: [{ descripcion: "X", cantidad: 1, precioUnitario: "24.90" }], pago: { medio: "Efectivo", recibido: "30.00" } });
ok("vuelto correcto", d.aTexto(d.vuelto(conVuelto)), "5.10");
ok("vuelto tras renormalizar", d.aTexto(d.vuelto(d.normalizar(conVuelto))), "5.10");
ok("sin pago no hay vuelto", d.vuelto({ items: [] }), null);

console.log("\n-- cambiarItem con valores crudos --");
let ed = d.normalizar({ items: [{ descripcion: "Pan", cantidad: 1, precioUnitario: "2.50" }] });
ed = d.cambiarItem(ed, ed.items[0].id, { precioUnitario: "3.50", cantidad: 2 });
ok("precio nuevo en centavos", ed.items[0].precioUnitario, 350);
ok("total tras editar", ed.totales.total, 700);

console.log("\n-- revisión --");
ok("documento vacío se queja", d.revisar({ items: [] }).some(a => a.nivel === "error"), true);
ok("RUC corto se queja", d.revisar({ emisor: { nombre: "A", ruc: "123" }, items: [{ descripcion: "x", cantidad: 1, precioUnitario: 1 }] }).some(a => a.campo === "ruc"), true);
ok("documento sano no se queja", d.revisar({ emisor: { nombre: "Mi Bodega", ruc: "20123456789" }, items: [{ descripcion: "Pan", cantidad: 1, precioUnitario: "2.50" }] }), []);

console.log("\n-- codificación CP850 --");
ok("ñ a un byte", Array.from(t.codificar("ñ")), [0xa4]);
ok("á a un byte", Array.from(t.codificar("á")), [0xa0]);
ok("ASCII intacto", String.fromCharCode(...t.codificar("TOTAL")), "TOTAL");
ok("un carácter = un byte", t.codificar("Panadería ñ").length, "Panadería ñ".length);

console.log("\n-- los bytes sirven en el navegador --");
ok("codificar da Uint8Array", t.codificar("x").constructor.name, "Uint8Array");
ok("aEscPos da Uint8Array", t.aEscPos({ items: [{ descripcion: "x", cantidad: 1, precioUnitario: "1" }] }).constructor.name, "Uint8Array");
ok("unir concatena bien", Array.from(t.unir([Uint8Array.from([1, 2]), Uint8Array.from([3])])), [1, 2, 3]);
ok("unir de vacío", t.unir([]).length, 0);

console.log("\n-- ESC/POS --");
const bytes = t.aEscPos({ emisor: { nombre: "Mi Bodega" }, items: [{ descripcion: "Pan", cantidad: 1, precioUnitario: "2.50" }] }, { ancho: "58" });
ok("arranca con ESC @", Array.from(bytes.slice(0, 2)), [0x1b, 0x40]);
ok("selecciona CP850", Array.from(bytes.slice(2, 5)), [0x1b, 0x74, 2]);

console.log("\n-- la cuchilla la decide el perfil de la impresora --");
const laTuya = t.aEscPos({ emisor: { nombre: "X" }, items: [{ descripcion: "Pan", cantidad: 1, precioUnitario: "1" }] }, { perfil: "pos-8001dd" });
ok("la POS-8001DD nunca manda GS V", contiene(laTuya, [0x1d, 0x56]), false);
ok("termina avanzando 5 líneas (ESC d 5)", Array.from(laTuya.slice(-3)), [0x1b, 0x64, 5]);

const mostrador = t.aEscPos({ emisor: { nombre: "X" }, items: [{ descripcion: "Pan", cantidad: 1, precioUnitario: "1" }] }, { perfil: "generica-80" });
ok("la de mostrador sí corta", Array.from(mostrador.slice(-4)), [0x1d, 0x56, 66, 0]);
ok("se puede forzar el corte", contiene(t.aEscPos({ items: [{ descripcion: "x", cantidad: 1, precioUnitario: "1" }] }, { perfil: "pos-8001dd", cortar: true }), [0x1d, 0x56]), true);

console.log("\n-- perfil de la POS-8001DD --");
const imp = require("./impresoras");
const tuya = imp.perfilDe("pos-8001dd");
ok("48 columnas", tuya.columnas, 48);
ok("576 puntos", tuya.puntos, 576);
ok("sin cortador", tuya.cortador, false);
ok("por defecto es la tuya", imp.perfilDe().columnas, 48);
ok("ancho personalizado", imp.conAnchoPersonalizado(tuya, 40).columnas, 40);
ok("personalizado con tope", imp.conAnchoPersonalizado(tuya, 999).columnas, 96);
ok("el diagnóstico usa el ancho del perfil", t.previaDiagnostico({ perfil: "pos-8001dd" }).split("\n")[4].length, 48);
const dos = t.aEscPos({ emisor: { nombre: "X" }, items: [{ descripcion: "Pan", cantidad: 1, precioUnitario: "1" }] }, { copias: 2 });
const uno = t.aEscPos({ emisor: { nombre: "X" }, items: [{ descripcion: "Pan", cantidad: 1, precioUnitario: "1" }] }, { copias: 1 });
ok("2 copias pesan ~el doble", dos.length > uno.length * 1.8, true);

console.log(fallos === 0 ? "\nTODO OK\n" : `\n${fallos} FALLAS\n`);

// ---- vista previa ----
const ejemplo = {
  tipo: "nota",
  numero: "NV001-000123",
  emisor: { nombre: "MINIMARKET LA ESQUINA", ruc: "20123456789", direccion: "Av. Los Álamos 456, Huánuco", telefono: "962 555 111" },
  cliente: "Público general",
  items: [
    { descripcion: "Coca Cola 500 ml", cantidad: 2, precioUnitario: "3.00" },
    { descripcion: "Inca Kola 500 ml", cantidad: 1, precioUnitario: "3.00" },
    { descripcion: "Pan francés", cantidad: 8, precioUnitario: "0.50" },
    { descripcion: "Detergente Bolívar bolsa 780 g aroma floral", cantidad: 1, precioUnitario: "12.90", descuento: "1.00" },
  ],
  pago: { medio: "Efectivo", recibido: "30.00" },
  qr: { contenido: "https://mibodega.pe/nv/000123" },
  pie: "¡Gracias por su compra!",
};

console.log("=".repeat(34));
console.log("  58 mm (32 columnas)");
console.log("=".repeat(34));
console.log(t.previa(ejemplo, { ancho: "58" }));
console.log("\n" + "=".repeat(50));
console.log("  80 mm (48 columnas)");
console.log("=".repeat(50));
console.log(t.previa(ejemplo, { ancho: "80" }));

process.exit(fallos === 0 ? 0 : 1);
