const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("contact-trigger-groups.json");

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { groupNames: Array.isArray(parsed.groupNames) ? parsed.groupNames : [] };
  } catch (err) {
    // Primera vez: se siembra el grupo que pidió el usuario originalmente.
    return { groupNames: ["AYABACA - BUMANGUESA II"] };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar contact-trigger-groups.json:", err.message);
  }
}
if (!fs.existsSync(DATA_PATH)) save();

function getGroupNames() {
  return data.groupNames;
}

function isEnabled(nombreGrupo) {
  const n = (nombreGrupo || "").trim().toUpperCase();
  return data.groupNames.some((g) => g.trim().toUpperCase() === n);
}

function addGroup(nombreGrupo) {
  if (!nombreGrupo || !nombreGrupo.trim()) throw new Error("Falta el nombre del grupo");
  if (!isEnabled(nombreGrupo)) {
    data.groupNames.push(nombreGrupo.trim());
    save();
  }
}

function removeGroup(nombreGrupo) {
  const n = (nombreGrupo || "").trim().toUpperCase();
  const antes = data.groupNames.length;
  data.groupNames = data.groupNames.filter((g) => g.trim().toUpperCase() !== n);
  if (data.groupNames.length !== antes) save();
}

module.exports = { getGroupNames, isEnabled, addGroup, removeGroup };
