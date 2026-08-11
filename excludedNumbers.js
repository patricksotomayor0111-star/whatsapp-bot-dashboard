const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("excluded-numbers-data.json");

// Números de WhatsApp que el bot debe ignorar por completo: si el mensaje lo
// manda alguno de estos números, no responde aunque el texto tenga una
// palabra clave válida. (La excepción son las "frases por sector": un número
// ignorado sí puede activar el bot en un grupo puntual con una frase exacta,
// ver numberExceptions.js.)
//
// Antes esta lista vivía escrita acá y había que tocar el código y
// redesplegar para agregar uno. Ahora se edita desde el panel y se guarda en
// excluded-numbers-data.json; esto es solo la semilla de la primera vez.
const SEED = [
  "272984178720993",
  "51942535017", "942535017",
  "51952696865", "952696865",
  "51960186738", "960186738",
  "51946043902", "946043902",
  "51902955167", "902955167",
  "51942008845", "942008845",
  "51906459224", "906459224",
  "51943103514", "943103514",
  "51946847341", "946847341",
  "51987140046", "987140046",
  "51957185654", "957185654",
  "51934983992", "934983992",
  "51929744391", "929744391",
  "51931235198", "931235198",
  "51936711829", "936711829",
  "51924047949", "924047949",
  "51912675969", "912675969",
  "51981290024", "981290024",
  "51914352139", "914352139",
  "51936899473", "936899473",
  "51956856787", "956856787",
  "51910795590", "910795590",
  "51934572456", "934572456",
  "51972077603", "972077603",
  "51972066872", "972066872",
  "51950006969", "950006969",
  "51957511240", "957511240",
  "51997186215", "997186215",
  "51966124285", "966124285",
  "51912699997", "912699997",
  "51924917366", "924917366",
  "51963936600", "963936600",
  "51976481032", "976481032",
  "51907413081", "907413081",
  "923938101", "51923938101",
  "51979397948", "979397948",
  "51955214645", "955214645",
  "51955794995", "955794995",
  "51932736288", "932736288",
  "51902425988", "902425988",
  "51973155047", "973155047",
  "34641095746",
  "51956640522", "956640522",
  "51923304241", "923304241",
  "51973388700", "973388700",
  "51930636985", "930636985",
];

// Deja solo los dígitos y se queda con los últimos 9 (número peruano sin el
// "51" ni el "+"), así "+51 934 343 343", "51934343343" y "934343343" se
// comparan como el mismo número.
function canonicalNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits;
}

function soloDigitos(raw) {
  return String(raw || "").replace(/\D/g, "");
}

// La semilla trae el mismo número repetido en dos formatos ("51942535017" y
// "942535017"). Se deja uno solo por número real, quedándose con la forma
// más corta, para que la lista del panel no se vea duplicada.
function normalizarLista(lista) {
  const porNumero = new Map();
  lista.forEach((n) => {
    const digits = soloDigitos(n);
    if (!digits) return;
    const clave = canonicalNumber(digits);
    const actual = porNumero.get(clave);
    if (!actual || digits.length < actual.length) porNumero.set(clave, digits);
  });
  return Array.from(porNumero.values());
}

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const numeros = Array.isArray(parsed.numeros) ? parsed.numeros : [];
    return { numeros: normalizarLista(numeros) };
  } catch (err) {
    return { numeros: normalizarLista(SEED) };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar excluded-numbers-data.json:", err.message);
  }
}

// Se guarda un Set con AMBAS formas de cada número (completo y últimos 9)
// para que la comparación sea instantánea sin importar cómo llegue el
// número del remitente. Se reconstruye en cada cambio.
let excluidosSet = new Set();
function reconstruirSet() {
  excluidosSet = new Set(data.numeros.flatMap((n) => [canonicalNumber(n), soloDigitos(n)]));
}
reconstruirSet();

function isExcluded(numero) {
  const digits = soloDigitos(numero);
  if (!digits) return false;
  return excluidosSet.has(digits) || excluidosSet.has(canonicalNumber(digits));
}

function getAll() {
  return data.numeros.slice().sort();
}

function addNumber(numero) {
  const digits = soloDigitos(numero);
  if (digits.length < 6) throw new Error("Número inválido: escribe al menos 6 dígitos.");
  if (isExcluded(digits)) return { ok: false, motivo: "Ese número ya estaba en la lista." };
  data.numeros.push(digits);
  reconstruirSet();
  save();
  return { ok: true };
}

function removeNumber(numero) {
  const clave = canonicalNumber(numero);
  const antes = data.numeros.length;
  data.numeros = data.numeros.filter((n) => canonicalNumber(n) !== clave);
  if (data.numeros.length === antes) return false;
  reconstruirSet();
  save();
  return true;
}

module.exports = { isExcluded, getAll, addNumber, removeNumber, canonicalNumber };
