const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "sectors-data.json");

const SECTOR_DEFS = [
  { id: "base", label: "Sector Base" },
  { id: "moderna", label: "Sector Moderna" },
  { id: "ptb", label: "Sector PTB" },
  { id: "san_jose", label: "Sector San José" },
  { id: "la_angostura", label: "Sector La Angostura" },
  { id: "comodin", label: "Sector Comodín" },
  { id: "otros", label: "Otros" },
];

const SECTOR_IDS = SECTOR_DEFS.map((s) => s.id);
const DEFAULT_SECTOR = "otros";

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      groupSectors: parsed.groupSectors || {},
      sectorActive: parsed.sectorActive || {},
    };
  } catch (err) {
    return { groupSectors: {}, sectorActive: {} };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar sectors-data.json:", err.message);
  }
}

// A qué sector pertenece un grupo. Si nunca se asignó, cae en "Otros".
function getGroupSector(groupId) {
  return data.groupSectors[groupId] || DEFAULT_SECTOR;
}

function setGroupSector(groupId, sectorId) {
  if (!SECTOR_IDS.includes(sectorId)) throw new Error("Sector inválido: " + sectorId);
  data.groupSectors[groupId] = sectorId;
  save();
}

// Un sector está ON salvo que se haya apagado explícitamente.
function isSectorActive(sectorId) {
  return data.sectorActive[sectorId] !== false;
}

function setSectorActive(sectorId, active) {
  if (!SECTOR_IDS.includes(sectorId)) throw new Error("Sector inválido: " + sectorId);
  data.sectorActive[sectorId] = Boolean(active);
  save();
}

function getSectorActiveMap() {
  const map = {};
  SECTOR_IDS.forEach((id) => {
    map[id] = isSectorActive(id);
  });
  return map;
}

module.exports = {
  SECTOR_DEFS,
  DEFAULT_SECTOR,
  getGroupSector,
  setGroupSector,
  isSectorActive,
  setSectorActive,
  getSectorActiveMap,
};
