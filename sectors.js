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
const SECTOR_SIN_REMARCAR = "comodin"; // en este sector el bot responde sin citar el mensaje

const DEFAULT_DELAY_MS = 300;
const DEFAULT_TIME_WINDOW_MINUTES = 15;

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      groupSectors: parsed.groupSectors || {},
      sectorActive: parsed.sectorActive || {},
      groupActive: parsed.groupActive || {},
      focusedGroups: parsed.focusedGroups || [],
      responseDelayMs: parsed.responseDelayMs || DEFAULT_DELAY_MS,
      timeWindowMinutes:
        parsed.timeWindowMinutes !== undefined ? parsed.timeWindowMinutes : DEFAULT_TIME_WINDOW_MINUTES,
    };
  } catch (err) {
    return {
      groupSectors: {},
      sectorActive: {},
      groupActive: {},
      focusedGroups: [],
      responseDelayMs: DEFAULT_DELAY_MS,
      timeWindowMinutes: DEFAULT_TIME_WINDOW_MINUTES,
    };
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

// True solo si a este grupo ya se le asignó un sector explícitamente
// (a diferencia de getGroupSector, que devuelve "otros" por defecto).
function hasGroupSector(groupId) {
  return Object.prototype.hasOwnProperty.call(data.groupSectors, groupId);
}

function setGroupSector(groupId, sectorId) {
  if (!SECTOR_IDS.includes(sectorId)) throw new Error("Sector inválido: " + sectorId);
  data.groupSectors[groupId] = sectorId;
  save();
}

function esSectorSinRemarcar(sectorId) {
  return sectorId === SECTOR_SIN_REMARCAR;
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

// Un grupo está Activo salvo que se haya apagado explícitamente.
function isGroupActive(groupId) {
  return data.groupActive[groupId] !== false;
}

function setGroupActive(groupId, active) {
  data.groupActive[groupId] = Boolean(active);
  save();
}

// ---------- Modo enfoque ----------
// Mientras haya grupos enfocados, el bot SOLO responde en esos grupos,
// sin importar su sector ni su estado individual.
function getFocusedGroups() {
  return data.focusedGroups;
}

function addFocusGroup(groupId) {
  if (!data.focusedGroups.includes(groupId)) {
    data.focusedGroups.push(groupId);
    save();
  }
}

function clearFocus() {
  data.focusedGroups = [];
  save();
}

// ---------- Delay de respuesta ----------
function getResponseDelay() {
  return data.responseDelayMs;
}

function setResponseDelay(ms) {
  const value = Number(ms);
  if (!Number.isInteger(value) || value < 100 || value > 1000 || value % 100 !== 0) {
    throw new Error("El delay debe ser un múltiplo de 100 entre 100 y 1000");
  }
  data.responseDelayMs = value;
  save();
}

// ---------- Ventana de tiempo (0 a N minutos) ----------
function getTimeWindowMinutes() {
  return data.timeWindowMinutes;
}

function setTimeWindowMinutes(minutes) {
  const value = Number(minutes);
  if (!Number.isInteger(value) || value < 0 || value > 15) {
    throw new Error("La ventana de tiempo debe ser un número entero entre 0 y 15");
  }
  data.timeWindowMinutes = value;
  save();
}

module.exports = {
  SECTOR_DEFS,
  DEFAULT_SECTOR,
  getGroupSector,
  setGroupSector,
  hasGroupSector,
  esSectorSinRemarcar,
  isSectorActive,
  setSectorActive,
  getSectorActiveMap,
  isGroupActive,
  setGroupActive,
  getFocusedGroups,
  addFocusGroup,
  clearFocus,
  getResponseDelay,
  setResponseDelay,
  getTimeWindowMinutes,
  setTimeWindowMinutes,
};
