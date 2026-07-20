const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("sectors-data.json");

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
const DEFAULT_TIME_WINDOW_MINUTES = 10;

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      groupSectors: parsed.groupSectors || {},
      sectorActive: parsed.sectorActive || {},
      sectorSinRemarcarActive: parsed.sectorSinRemarcarActive || {},
      groupActive: parsed.groupActive || {},
      focusedGroups: parsed.focusedGroups || [],
      responseDelayMs: parsed.responseDelayMs || DEFAULT_DELAY_MS,
      timeWindowMinutes:
        parsed.timeWindowMinutes !== undefined ? parsed.timeWindowMinutes : DEFAULT_TIME_WINDOW_MINUTES,
      groupRemarcarOverride: parsed.groupRemarcarOverride || {},
      groupNoRemarcar: parsed.groupNoRemarcar || {}, // legado, se migra una sola vez
      otrosInactivoPorDefectoMigrado: Boolean(parsed.otrosInactivoPorDefectoMigrado),
      groupNoRemarcarMigrado: Boolean(parsed.groupNoRemarcarMigrado),
    };
  } catch (err) {
    return {
      groupSectors: {},
      sectorActive: {},
      sectorSinRemarcarActive: {},
      groupActive: {},
      focusedGroups: [],
      responseDelayMs: DEFAULT_DELAY_MS,
      timeWindowMinutes: DEFAULT_TIME_WINDOW_MINUTES,
      groupRemarcarOverride: {},
      groupNoRemarcar: {},
      otrosInactivoPorDefectoMigrado: false,
      groupNoRemarcarMigrado: false,
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

// Un sector está ON salvo que se haya apagado explícitamente — EXCEPTO
// "Otros", que arranca APAGADO salvo que se haya prendido explícitamente.
function isSectorActive(sectorId) {
  if (Object.prototype.hasOwnProperty.call(data.sectorActive, sectorId)) {
    return data.sectorActive[sectorId] !== false;
  }
  return sectorId !== DEFAULT_SECTOR;
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

// Segundo interruptor por sector, independiente del de arriba: controla
// SOLO a los grupos "sin remarcar" de ese sector (por Comodín o por
// override individual). Mismo default que el otro: ON salvo "Otros".
function isSectorSinRemarcarActive(sectorId) {
  if (Object.prototype.hasOwnProperty.call(data.sectorSinRemarcarActive, sectorId)) {
    return data.sectorSinRemarcarActive[sectorId] !== false;
  }
  return sectorId !== DEFAULT_SECTOR;
}

function setSectorSinRemarcarActive(sectorId, active) {
  if (!SECTOR_IDS.includes(sectorId)) throw new Error("Sector inválido: " + sectorId);
  data.sectorSinRemarcarActive[sectorId] = Boolean(active);
  save();
}

function getSectorSinRemarcarActiveMap() {
  const map = {};
  SECTOR_IDS.forEach((id) => {
    map[id] = isSectorSinRemarcarActive(id);
  });
  return map;
}

// Un grupo está Activo salvo que se haya apagado explícitamente — EXCEPTO
// los del sector "Otros", que arrancan APAGADOS salvo que se hayan
// prendido explícitamente (aunque el sector "Otros" en sí esté prendido).
function isGroupActive(groupId) {
  if (Object.prototype.hasOwnProperty.call(data.groupActive, groupId)) {
    return data.groupActive[groupId] !== false;
  }
  return getGroupSector(groupId) !== DEFAULT_SECTOR;
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

function removeFocusGroup(groupId) {
  const idx = data.focusedGroups.indexOf(groupId);
  if (idx !== -1) {
    data.focusedGroups.splice(idx, 1);
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

// ---------- Remarcar / sin remarcar por grupo (override en cualquier sentido) ----------
// Por defecto, un grupo remarca o no según su sector (el Sector Comodín no
// remarca). Acá se puede forzar un grupo puntual para cualquiera de los dos
// lados, sin importar su sector: "no_remarcar" fuerza a que NO cite el
// mensaje, "remarcar" fuerza a que SÍ lo cite. Sin override (null), hereda
// el comportamiento del sector.
const REMARCAR_OVERRIDES = ["no_remarcar", "remarcar"];

function getGroupRemarcarOverride(groupId) {
  return data.groupRemarcarOverride[groupId] || null;
}

function setGroupRemarcarOverride(groupId, value) {
  if (value === null || value === "") {
    delete data.groupRemarcarOverride[groupId];
  } else if (REMARCAR_OVERRIDES.includes(value)) {
    data.groupRemarcarOverride[groupId] = value;
  } else {
    throw new Error("Valor inválido para el override de remarcar: " + value);
  }
  save();
}

// True si, en definitiva, el bot NO debe citar el mensaje en este grupo
// (combina el override individual con el comportamiento del sector).
function isGroupSinRemarcarEfectivo(groupId, sectorId) {
  const override = getGroupRemarcarOverride(groupId);
  if (override === "no_remarcar") return true;
  if (override === "remarcar") return false;
  return esSectorSinRemarcar(sectorId);
}

// El sector de un grupo tiene DOS interruptores independientes: uno para
// sus grupos que remarcan normal, y otro para los que están sin remarcar.
// Esta función decide cuál de los dos aplica según cómo responda este
// grupo puntual, y devuelve si ESE interruptor está prendido.
function isGroupSectorActiveEfectivo(groupId, sectorId) {
  return isGroupSinRemarcarEfectivo(groupId, sectorId)
    ? isSectorSinRemarcarActive(sectorId)
    : isSectorActive(sectorId);
}

// Migración única: el interruptor viejo (solo "sin remarcar" true/false) se
// convierte al nuevo override de 3 estados. Corre una sola vez.
function migrarGroupNoRemarcarAOverride() {
  if (data.groupNoRemarcarMigrado) return;
  Object.keys(data.groupNoRemarcar).forEach((groupId) => {
    if (data.groupNoRemarcar[groupId] === true && !data.groupRemarcarOverride[groupId]) {
      data.groupRemarcarOverride[groupId] = "no_remarcar";
    }
  });
  data.groupNoRemarcarMigrado = true;
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

// Migración única: antes de este cambio, "Otros" y sus grupos arrancaban
// Activos por defecto. Si quedó guardado un "true" explícito de esa época
// (no un "true" que vos pusiste a propósito después de este cambio), lo
// borramos una sola vez para que caigan en el nuevo default (apagado).
// Corre una sola vez por instalación, gracias a la bandera guardada.
function migrarOtrosInactivoPorDefecto() {
  if (data.otrosInactivoPorDefectoMigrado) return;

  if (data.sectorActive[DEFAULT_SECTOR] === true) {
    delete data.sectorActive[DEFAULT_SECTOR];
  }
  Object.keys(data.groupActive).forEach((groupId) => {
    if (data.groupActive[groupId] === true && getGroupSector(groupId) === DEFAULT_SECTOR) {
      delete data.groupActive[groupId];
    }
  });

  data.otrosInactivoPorDefectoMigrado = true;
  save();
}

migrarOtrosInactivoPorDefecto();
migrarGroupNoRemarcarAOverride();

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
  isSectorSinRemarcarActive,
  setSectorSinRemarcarActive,
  getSectorSinRemarcarActiveMap,
  isGroupActive,
  setGroupActive,
  getFocusedGroups,
  addFocusGroup,
  removeFocusGroup,
  clearFocus,
  getResponseDelay,
  setResponseDelay,
  getTimeWindowMinutes,
  setTimeWindowMinutes,
  getGroupRemarcarOverride,
  setGroupRemarcarOverride,
  isGroupSinRemarcarEfectivo,
  isGroupSectorActiveEfectivo,
};
