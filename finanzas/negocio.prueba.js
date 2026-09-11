// Pruebas del perfil del negocio y la numeración.
// Se corren con:  node finanzas/negocio.prueba.js
const os = require("os");
const fs = require("fs");
const path = require("path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "prueba-negocio-"));

const { correrComo } = require("./contexto");
const n = require("./negocio");

let fallos = 0;
function ok(nombre, real, esperado) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado);
  if (!bien) { fallos++; console.log(`  FALLA ${nombre}: ${JSON.stringify(real)} != ${JSON.stringify(esperado)}`); }
  else console.log(`  ok  ${nombre}`);
}

correrComo("prueba", () => {
  console.log("\n-- valores de arranque --");
  ok("serie por defecto", n.get().serie, "NV001");
  ok("arranca en el 1", n.proximoNumero(), "NV001-000001");

  console.log("\n-- los datos del negocio --");
  n.set({
    nombre: "Minimarket La Esquina",
    ruc: "20-123456789",
    direccion: "Av. Los Álamos 456",
    telefono: "962 555 111",
  });
  ok("RUC solo dígitos", n.get().ruc, "20123456789");
  ok("nombre guardado", n.get().nombre, "Minimarket La Esquina");
  ok("sirve como emisor", n.comoEmisor(), {
    nombre: "Minimarket La Esquina", ruc: "20123456789",
    direccion: "Av. Los Álamos 456", telefono: "962 555 111",
  });

  console.log("\n-- la serie se limpia --");
  ok("con espacios y guiones", n.set({ serie: "nv 001-" }).serie, "NV001");
  ok("vacía vuelve al default", n.set({ serie: "" }).serie, "NV001");
  ok("no pasa de 6", n.set({ serie: "ABCDEFGHIJ" }).serie, "ABCDEF");
  n.set({ serie: "B001" });
  ok("serie propia", n.proximoNumero(), "B001-000001");

  console.log("\n-- previsualizar NO gasta números --");
  n.proximoNumero(); n.proximoNumero(); n.proximoNumero();
  ok("sigue en el 1", n.proximoNumero(), "B001-000001");

  console.log("\n-- emitir sí --");
  ok("primer emitido", n.consumirNumero(), "B001-000001");
  ok("segundo emitido", n.consumirNumero(), "B001-000002");
  ok("el próximo ya es el 3", n.proximoNumero(), "B001-000003");

  console.log("\n-- retomar un talonario empezado --");
  n.set({ correlativo: 2351 });
  ok("continúa donde ibas", n.proximoNumero(), "B001-002351");
  ok("cero se ignora", n.set({ correlativo: 0 }).correlativo, 2351);
  ok("negativo se ignora", n.set({ correlativo: -5 }).correlativo, 2351);

  console.log("\n-- avisos --");
  ok("negocio completo no se queja", n.revisar(), []);
  n.set({ ruc: "123" });
  ok("RUC corto avisa", n.revisar().some((a) => a.campo === "ruc"), true);
  n.set({ ruc: "" });
  ok("sin RUC no se queja (muchos no lo ponen)", n.revisar(), []);

  console.log("\n-- sobrevive al reinicio --");
  ok("guardado en disco", fs.existsSync(path.join(process.env.DATA_DIR, "users", "prueba", "negocio-data.json")), true);
});

console.log(fallos === 0 ? "\nTODO OK\n" : `\n${fallos} FALLAS\n`);
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
process.exit(fallos === 0 ? 0 : 1);
