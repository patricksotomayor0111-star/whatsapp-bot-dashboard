const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("dynamic-keywords-data.json");

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      extraPositive: parsed.extraPositive || [],
      extraExcluded: parsed.extraExcluded || [],
      specialByGroup: parsed.specialByGroup || {},
      baseExcludedOff: parsed.baseExcludedOff || [],
    };
  } catch (err) {
    return { extraPositive: [], extraExcluded: [], specialByGroup: {}, baseExcludedOff: [] };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar dynamic-keywords-data.json:", err.message);
  }
}

function normalizePhrase(phrase) {
  return String(phrase || "").trim().toLowerCase();
}

// ---------- Keywords globales (positivas) agregadas desde el panel ----------
function getExtraPositive() {
  return data.extraPositive;
}

function addExtraPositive(phrase) {
  const p = normalizePhrase(phrase);
  if (!p) throw new Error("La keyword no puede estar vacía");
  if (!data.extraPositive.includes(p)) {
    data.extraPositive.push(p);
    save();
  }
}

function removeExtraPositive(phrase) {
  data.extraPositive = data.extraPositive.filter((p) => p !== normalizePhrase(phrase));
  save();
}

// ---------- Keywords excluidas agregadas desde el panel ----------
function getExtraExcluded() {
  return data.extraExcluded;
}

function addExtraExcluded(phrase) {
  const p = normalizePhrase(phrase);
  if (!p) throw new Error("La keyword no puede estar vacía");
  if (!data.extraExcluded.includes(p)) {
    data.extraExcluded.push(p);
    save();
  }
}

function removeExtraExcluded(phrase) {
  data.extraExcluded = data.extraExcluded.filter((p) => p !== normalizePhrase(phrase));
  save();
}

// ---------- Excluidas de fábrica (keywords.js) que se desactivaron ----------
// Las de keywords.js no se pueden borrar desde el panel (están en el código),
// pero sí apagar: desde "Probar una frase", cuando una de ellas es la que
// frena la frase. Se vuelven a prender desde la lista de excluidas.
// Se guardan sin tildes, igual que se comparan los mensajes.
function sinTildes(phrase) {
  return normalizePhrase(phrase).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function getBaseExcludedOff() {
  return data.baseExcludedOff;
}

function isBaseExcludedOff(phrase) {
  return data.baseExcludedOff.includes(sinTildes(phrase));
}

function setBaseExcludedOff(phrase, off) {
  const p = sinTildes(phrase);
  if (!p) throw new Error("La keyword no puede estar vacía");
  data.baseExcludedOff = data.baseExcludedOff.filter((x) => x !== p);
  if (off) data.baseExcludedOff.push(p);
  save();
}

// ---------- Keywords especiales por grupo ----------
// Si el mensaje en ESE grupo contiene una de sus frases especiales, el bot
// responde sin importar las exclusiones (gana siempre).
function getSpecialForGroup(groupId) {
  return data.specialByGroup[groupId] || [];
}

function getAllSpecial() {
  return data.specialByGroup;
}

// True solo si a este grupo ya se le agregó alguna keyword especial antes
// (incluso si después se borraron todas y quedó en []).
function hasSpecialForGroup(groupId) {
  return Object.prototype.hasOwnProperty.call(data.specialByGroup, groupId);
}

function addSpecialForGroup(groupId, phrase) {
  const p = normalizePhrase(phrase);
  if (!p) throw new Error("La keyword no puede estar vacía");
  if (!data.specialByGroup[groupId]) data.specialByGroup[groupId] = [];
  if (!data.specialByGroup[groupId].includes(p)) {
    data.specialByGroup[groupId].push(p);
    save();
  }
}

function removeSpecialForGroup(groupId, phrase) {
  if (!data.specialByGroup[groupId]) return;
  // Ojo: aunque quede en [], NO se borra la clave del grupo. Así
  // hasSpecialForGroup() sigue devolviendo true y el seed automático
  // (groupSeed.js) no vuelve a poner las frases que el usuario ya quitó.
  data.specialByGroup[groupId] = data.specialByGroup[groupId].filter((p) => p !== normalizePhrase(phrase));
  save();
}

module.exports = {
  getExtraPositive,
  addExtraPositive,
  removeExtraPositive,
  getExtraExcluded,
  addExtraExcluded,
  removeExtraExcluded,
  getBaseExcludedOff,
  isBaseExcludedOff,
  setBaseExcludedOff,
  getSpecialForGroup,
  getAllSpecial,
  hasSpecialForGroup,
  addSpecialForGroup,
  removeSpecialForGroup,
};
