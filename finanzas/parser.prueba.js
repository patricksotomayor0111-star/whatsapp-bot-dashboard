const path = require("path");
const fs = require("fs");
const os = require("os");

// Cómo lee el bot cada línea del grupo GANANCIAS.
//
// Esto nació de un caso real: se escribió "Menso 48 pizza cena" en vez de
// "Menos", el bot no lo entendió y lo ignoró EN SILENCIO. El gasto no
// quedó en ningún lado y no había forma de enterarse hasta que la caja no
// cuadrara, días después.
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), "parser-"));
process.env.DATA_DIR = CARPETA;
fs.mkdirSync(path.join(CARPETA, "users", "prueba"), { recursive: true });

const contexto = require("./contexto");
const bot = require("./bot");
const custodias = require("./custodias");

let fallos = 0;
function ok(cond, nombre) {
  console.log((cond ? "  ok  " : "  FALLA  ") + nombre);
  if (!cond) fallos++;
}

contexto.correrComo("prueba", () => {
  const leer = (t) => bot.parseCashboxLine(t);

  // ---------- Lo de siempre sigue igual ----------
  let r = leer("17 bum");
  ok(r && r.type === "ganancia" && r.monto === 17 && r.descripcion === "bum", "una ganancia normal");

  r = leer("menos 42 gasolina");
  ok(r && r.type === "gasto" && r.monto === 42 && r.descripcion === "gasolina", "un gasto normal");
  ok(!r.correccion, "y sin corregir nada");

  r = leer("15.50 pollo");
  ok(r && r.type === "ganancia" && r.monto === 15.5, "con decimales");

  r = leer("2 mil terreno");
  ok(r && r.type === "ganancia" && r.monto === 2000, "'mil' multiplica");

  r = leer("1050 caja");
  ok(r && r.type === "caja", "el conteo de caja");

  r = leer("menos 20 Juan debe");
  ok(r && r.type === "deuda_debe" && r.persona === "Juan", "una deuda por cobrar");

  r = leer("menos 15 falto");
  ok(r && r.type === "faltante", "un faltante");

  // ---------- El dedazo que lo empezó todo ----------
  r = leer("Menso 48 pizza cena");
  ok(r && r.type === "gasto" && r.monto === 48, "'Menso' se entiende como 'menos'");
  ok(r.descripcion === "pizza cena", "y la descripción queda bien");
  ok(r.correccion && r.correccion.escribiste === "Menso", "queda marcado que hubo que corregir");

  ok(leer("Meno 30 almuerzo").type === "gasto", "una letra de menos");
  ok(leer("Menoss 30 almuerzo").type === "gasto", "una letra de más");
  ok(leer("Menis 30 almuerzo").type === "gasto", "una letra cambiada");
  ok(leer("Mneos 30 almuerzo").type === "gasto", "dos letras volteadas al principio");

  // Y el corregido sigue entendiendo las formas especiales.
  r = leer("Menso 20 Juan debe");
  ok(r && r.type === "deuda_debe" && r.persona === "Juan", "corregido, una deuda sigue siendo deuda");
  r = leer("Menso 15 falto");
  ok(r && r.type === "faltante", "corregido, un faltante sigue siendo faltante");

  // ---------- Y lo que NO se puede confundir ----------
  // Dos errores ya es adivinar demasiado.
  ok(leer("Mensos2 30 almuerzo") === null, "con dos errores ya no adivina");
  ok(leer("hola 30 almuerzo") === null, "una palabra cualquiera no es 'menos'");
  ok(leer("gasolina 30") === null, "la descripción antes del número no cuenta");
  ok(leer("") === null, "una línea vacía");
  ok(leer("buenas noches") === null, "un mensaje sin números");

  // Un número solo no inventa una descripción.
  r = leer("20");
  ok(r && r.type === "ganancia" && r.monto === 20, "un número suelto es ganancia");

  // ---------- Varias líneas en un mensaje ----------
  const varias = bot.parseCashboxMessage("17 bum\nMenso 48 pizza cena\nbuenas noches\nmenos 10 gasolina");
  ok(varias.length === 3, "lee las que entiende y salta las que no");
  ok(varias[1].correccion, "la corregida viene marcada");

  // ---------- La custodia manda sobre todo ----------
  custodias.addPersona("Ana");
  r = leer("50 Ana guardo");
  ok(r && r.type === "custodia_guardo" && r.monto === 50, "plata que te dejan a guardar");
  r = leer("menos 20 Ana guardo");
  ok(r && r.type === "custodia_gasto", "y lo que gastas de lo suyo");

  // ---------- La comparación de palabras, suelta ----------
  ok(bot.aUnErrorDe("menos", "menos"), "igual a sí misma");
  ok(bot.aUnErrorDe("menso", "menos"), "dos letras volteadas");
  ok(bot.aUnErrorDe("MENOS", "menos"), "no le importan las mayúsculas");
  ok(!bot.aUnErrorDe("menosss", "menos"), "dos letras de más, no");
  ok(!bot.aUnErrorDe("mas", "menos"), "palabras distintas, no");
  ok(!bot.aUnErrorDe("", "menos"), "vacío, no");
});

fs.rmSync(CARPETA, { recursive: true, force: true });
console.log(fallos === 0 ? "\nTODO OK" : "\n" + fallos + " FALLAS");
// El bot deja temporizadores corriendo: se sale a propósito.
process.exit(fallos === 0 ? 0 : 1);
