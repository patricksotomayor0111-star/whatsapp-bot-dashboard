const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("reference-accounts-data.json");
const NOMBRES_BASE = ["yape", "plin", "sip", "efectivo"];

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      nombres: Array.isArray(parsed.nombres) && parsed.nombres.length ? parsed.nombres : NOMBRES_BASE.slice(),
      entradas: parsed.entradas || [],
    };
  } catch (err) {
    return { nombres: NOMBRES_BASE.slice(), entradas: [] };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar reference-accounts-data.json:", err.message);
  }
}

function peruAhora() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs - 5 * 3600000);
}

function fechaLabel(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dia}`;
}

function horaLabel(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function getNombres() {
  return data.nombres;
}

function addNombre(nombre) {
  const n = String(nombre || "").trim().toLowerCase();
  if (n && !data.nombres.includes(n)) {
    data.nombres.push(n);
    save();
  }
}

function removeNombre(nombre) {
  const n = String(nombre || "").trim().toLowerCase();
  data.nombres = data.nombres.filter((x) => x !== n);
  save();
}

// Un mensaje es una nota de referencia si, después de sacarle el número, lo
// que queda es EXACTAMENTE uno de los nombres de cuenta configurados (ej.
// "416.14 yape" -> resto "yape"). Se recibe ya normalizado (sin tildes,
// en minúsculas).
function matchNombre(restoNorm) {
  const texto = String(restoNorm || "").trim();
  return data.nombres.find((n) => texto === n) || null;
}

// Solo queda registrada como nota (fecha/hora/monto/descripción); no afecta
// caja ni ganancia.
function addEntrada(cuenta, monto, descripcion) {
  const ahora = peruAhora();
  data.entradas.push({
    fecha: fechaLabel(ahora),
    hora: horaLabel(ahora),
    cuenta,
    monto,
    descripcion: descripcion || "",
  });
  save();
}

function getEntradas() {
  return data.entradas;
}

function removeEntrada(index) {
  if (index >= 0 && index < data.entradas.length) {
    data.entradas.splice(index, 1);
    save();
  }
}

module.exports = {
  getNombres,
  addNombre,
  removeNombre,
  matchNombre,
  addEntrada,
  getEntradas,
  removeEntrada,
};
