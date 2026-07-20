const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("number-exceptions-data.json");

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { exceptions: parsed.exceptions || {} };
  } catch (err) {
    return { exceptions: {} };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar number-exceptions-data.json:", err.message);
  }
}

// Deja solo los dígitos y se queda con los últimos 9 (mismo criterio que
// excludedNumbers, así "+51 910 795 590" y "910795590" son la misma clave).
function canonicalNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits;
}

function key(groupId, number) {
  return `${groupId}::${canonicalNumber(number)}`;
}

// Un número puede tener excepciones en varios grupos: esta función junta
// todos los grupos donde ese número tiene alguna frase configurada.
function getExceptions(groupId, number) {
  return data.exceptions[key(groupId, number)] || [];
}

function hasExceptions(groupId, number) {
  return Object.prototype.hasOwnProperty.call(data.exceptions, key(groupId, number));
}

function getAllExceptions() {
  return data.exceptions;
}

function addException(groupId, number, phrase) {
  const p = String(phrase || "").trim();
  if (!p) throw new Error("La frase no puede estar vacía");
  const k = key(groupId, number);
  if (!data.exceptions[k]) data.exceptions[k] = [];
  if (!data.exceptions[k].some((e) => e.phrase === p)) {
    data.exceptions[k].push({ phrase: p, active: true });
    save();
  }
}

function removeException(groupId, number, phrase) {
  const k = key(groupId, number);
  if (!data.exceptions[k]) return;
  data.exceptions[k] = data.exceptions[k].filter((e) => e.phrase !== phrase);
  save();
}

function setExceptionActive(groupId, number, phrase, active) {
  const k = key(groupId, number);
  if (!data.exceptions[k]) return;
  const entry = data.exceptions[k].find((e) => e.phrase === phrase);
  if (entry) {
    entry.active = Boolean(active);
    save();
  }
}

module.exports = {
  canonicalNumber,
  getExceptions,
  hasExceptions,
  getAllExceptions,
  addException,
  removeException,
  setExceptionActive,
};
