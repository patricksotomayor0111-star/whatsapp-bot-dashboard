const h = require("./gastosHormiga");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}

function dia(n) {
  return "2026-03-" + String(n).padStart(2, "0");
}

const movs = [];
// Lo chiquito que se repite: esto es lo que tiene que salir.
for (let i = 1; i <= 12; i++) movs.push({ tipo: "gasto", fecha: dia(i), monto: 6, descripcion: "almuerzo" });
for (let i = 1; i <= 8; i++) movs.push({ tipo: "gasto", fecha: dia(i), monto: 10, descripcion: "gasolina grifo" });
// Con la palabra en otra forma: tiene que caer en el mismo grupo.
movs.push({ tipo: "gasto", fecha: dia(13), monto: 7, descripcion: "Almuerzo pollo" });
movs.push({ tipo: "gasto", fecha: dia(14), monto: 8, descripcion: "mi almuerzo" });
// Chico pero suelto: no es hormiga.
movs.push({ tipo: "gasto", fecha: dia(5), monto: 8, descripcion: "pasaje" });
// Grande: no es chico aunque se repita.
for (let i = 1; i <= 5; i++) movs.push({ tipo: "gasto", fecha: dia(i), monto: 500, descripcion: "terreno" });
// Una ganancia no se cuenta.
movs.push({ tipo: "ganancia", fecha: dia(3), monto: 200, descripcion: "almuerzo bum" });
// De otro mes: fuera del rango pedido.
movs.push({ tipo: "gasto", fecha: "2026-02-10", monto: 6, descripcion: "almuerzo" });

const r = h.analizar(movs, { desde: "2026-03-01", hasta: "2026-03-31" });

const almuerzo = r.grupos.find((g) => g.clave === "almuerzo");
const gasolina = r.grupos.find((g) => g.clave === "gasolina");

ok(!!almuerzo, "encuentra el almuerzo");
ok(almuerzo.veces === 14, "junta 'almuerzo', 'Almuerzo pollo' y 'mi almuerzo'");
ok(almuerzo.total === 12 * 6 + 7 + 8, "suma bien el almuerzo");
ok(!!gasolina && gasolina.veces === 8, "encuentra la gasolina");

ok(!r.grupos.some((g) => g.clave === "pasaje"), "algo suelto no es gasto hormiga");
ok(!r.grupos.some((g) => g.clave === "terreno"), "un gasto grande no es hormiga aunque se repita");
ok(r.totalGastos === 12 * 6 + 8 * 10 + 7 + 8 + 8 + 5 * 500, "el total de gastos incluye los grandes");
ok(r.totalHormiga === almuerzo.total + gasolina.total, "el total hormiga solo suma los grupos");
ok(r.grupos[0].total >= r.grupos[1].total, "sale primero el que más pesa");
ok(r.grupos.every((g) => g.promedio > 0 && g.ejemplos.length > 0), "cada grupo trae promedio y ejemplos");

// Un mes en que no pasó nada no puede inventar grupos.
const vacio = h.analizar(movs, { desde: "2026-07-01", hasta: "2026-07-31" });
ok(vacio.grupos.length === 0 && vacio.totalHormiga === 0, "un mes sin gastos no inventa nada");

// El tope y el mínimo se pueden mover.
const conTopeBajo = h.analizar(movs, { desde: "2026-03-01", hasta: "2026-03-31", tope: 7 });
ok(!conTopeBajo.grupos.some((g) => g.clave === "gasolina"), "subiendo la exigencia, la gasolina de S/10 ya no es chica");

const conMinimoAlto = h.analizar(movs, { desde: "2026-03-01", hasta: "2026-03-31", minimoVeces: 13 });
ok(conMinimoAlto.grupos.length === 1, "pidiendo más repeticiones queda solo el almuerzo");

// Las palabras que no dicen nada no pueden volverse el nombre del grupo.
ok(h.palabraClave("de la comida") === "comida", "salta las palabras vacías");
ok(h.palabraClave("20 pollo") === "pollo", "salta los números");
ok(h.palabraClave("") === "", "sin descripción no hay palabra");

console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
process.exit(fallos === 0 ? 0 : 1);
