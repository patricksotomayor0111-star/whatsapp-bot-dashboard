const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "dynamic-keywords-data.json");

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      extraPositive: parsed.extraPositive || [],
      extraExcluded: parsed.extraExcluded || [],
      specialByGroup: parsed.specialByGroup || {},
    };
  } catch (err) {
    return { extraPositive: [], extraExcluded: [], specialByGroup: {} };
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

// ---------- Keywords especiales por grupo ----------
// Si el mensaje en ESE grupo contiene una de sus frases especiales, el bot
// responde sin importar las exclusiones (gana siempre).
function getSpecialForGroup(groupId) {
  return data.specialByGroup[groupId] || [];
}

function getAllSpecial() {
  return data.specialByGroup;
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
  data.specialByGroup[groupId] = data.specialByGroup[groupId].filter((p) => p !== normalizePhrase(phrase));
  if (data.specialByGroup[groupId].length === 0) delete data.specialByGroup[groupId];
  save();
}

module.exports = {
  getExtraPositive,
  addExtraPositive,
  removeExtraPositive,
  getExtraExcluded,
  addExtraExcluded,
  removeExtraExcluded,
  getSpecialForGroup,
  getAllSpecial,
  addSpecialForGroup,
  removeSpecialForGroup,
};
