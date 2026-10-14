// Pruebas del logo. Se corren con:  node finanzas/logo.prueba.js
const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "prueba-logo-"));

const { correrComo } = require("./contexto");
const logo = require("./logo");

let fallos = 0;
function ok(nombre, real, esperado) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) { fallos++; console.log(`  FALLA ${nombre}: ${JSON.stringify(real)} != ${JSON.stringify(esperado)}`); }
  else console.log(`  ok  ${nombre}`);
}
function intentar(fn) {
  try { fn(); return null; } catch (err) { return err.message; }
}

// Un damero de ancho x alto, empaquetado como lo manda el navegador.
function damero(ancho, alto) {
  const bpf = Math.ceil(ancho / 8);
  const bits = Buffer.alloc(bpf * alto);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (((x >> 2) + (y >> 2)) % 2 === 0) bits[y * bpf + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return bits.toString("base64");
}

correrComo("prueba", () => {
  console.log("\n-- sin logo --");
  ok("arranca vacío", logo.get(), null);
  ok("nada que imprimir", logo.paraImprimir(), null);

  console.log("\n-- guardar uno válido --");
  logo.set({ ancho: 64, alto: 16, bits: damero(64, 16) });
  ok("ancho guardado", logo.get().ancho, 64);
  ok("alto guardado", logo.get().alto, 16);
  ok("sale como Buffer para imprimir", Buffer.isBuffer(logo.paraImprimir().bits), true);
  ok("8 bytes por fila x 16 filas", logo.paraImprimir().bits.length, 128);

  console.log("\n-- un ancho que no es múltiplo de 8 --");
  // 60 puntos entran en 8 bytes por fila (el último medio vacío), que es
  // justo donde se descuadra si la cuenta se hace mal.
  logo.set({ ancho: 60, alto: 4, bits: damero(60, 4) });
  ok("redondea a byte completo", logo.paraImprimir().bits.length, 32);

  console.log("\n-- lo que tiene que rechazar --");
  ok("bytes de menos", intentar(() => logo.set({ ancho: 64, alto: 10, bits: "AAAA" })).includes("no cuadra"), true);
  ok("demasiado ancho", intentar(() => logo.set({ ancho: 999, alto: 10, bits: damero(999, 10) })).includes("576"), true);
  ok("demasiado alto", intentar(() => logo.set({ ancho: 64, alto: 999, bits: damero(64, 999) })).includes("400"), true);
  ok("sin medidas", intentar(() => logo.set({ bits: "AAAA" })).includes("medidas"), true);
  ok("un rechazo no pisa el que ya estaba", logo.get().ancho, 60);

  console.log("\n-- quitar --");
  logo.quitar();
  ok("queda vacío", logo.get(), null);
  ok("quitar dos veces no rompe", logo.quitar(), true);

  console.log("\n-- sobrevive al reinicio --");
  logo.set({ ancho: 32, alto: 8, bits: damero(32, 8) });
  ok("guardado en disco", fs.existsSync(path.join(process.env.DATA_DIR, "users", "prueba", "logo-data.json")), true);
});

console.log(fallos === 0 ? "\nTODO OK\n" : `\n${fallos} FALLAS\n`);
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
process.exit(fallos === 0 ? 0 : 1);
