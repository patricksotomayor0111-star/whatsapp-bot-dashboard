const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("quote-config-data.json");

// Configuración de las cotizaciones de delivery (cuando la web manda una
// ubicación fuera de las zonas ya mapeadas). Todo esto se edita desde el
// panel, así que ya no hay nombres de grupo ni números fijos en el código.
const DEFAULTS = {
  // Grupos de WhatsApp (por nombre) a los que se manda la cotización.
  groupNames: ["CARTAS RESTAURANTES"],
  // Si está en true, cualquier persona del grupo puede responder la tarifa.
  // Si está en false, solo los números de authorizedNumbers.
  anyoneCanQuote: false,
  // Números autorizados a responder la tarifa (solo si anyoneCanQuote=false).
  authorizedNumbers: ["939610396", "918943697"],
  // Texto que acompaña al link de ubicación en el mensaje.
  message: "Cotización urgente 🛵",
};

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    return {
      groupNames: Array.isArray(parsed.groupNames) ? parsed.groupNames : DEFAULTS.groupNames,
      anyoneCanQuote: Boolean(parsed.anyoneCanQuote),
      authorizedNumbers: Array.isArray(parsed.authorizedNumbers)
        ? parsed.authorizedNumbers
        : DEFAULTS.authorizedNumbers,
      message: typeof parsed.message === "string" ? parsed.message : DEFAULTS.message,
    };
  } catch (err) {
    return { ...DEFAULTS, groupNames: [...DEFAULTS.groupNames], authorizedNumbers: [...DEFAULTS.authorizedNumbers] };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar quote-config-data.json:", err.message);
  }
}

// Mismo criterio que numberExceptions/excludedNumbers: solo dígitos y los
// últimos 9, así "+51 939 610 396" y "939610396" son el mismo número.
function canonicalNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits;
}

function normalizeGroupName(name) {
  return String(name || "").trim().toUpperCase();
}

function getConfig() {
  return {
    groupNames: data.groupNames,
    anyoneCanQuote: data.anyoneCanQuote,
    authorizedNumbers: data.authorizedNumbers,
    message: data.message,
  };
}

// ---------- Grupos que reciben la cotización ----------
function getGroupNames() {
  return data.groupNames;
}

function isQuoteGroup(groupName) {
  const n = normalizeGroupName(groupName);
  return data.groupNames.some((g) => normalizeGroupName(g) === n);
}

function addGroupName(name) {
  const n = String(name || "").trim();
  if (!n) throw new Error("El nombre del grupo no puede estar vacío");
  if (!data.groupNames.some((g) => normalizeGroupName(g) === normalizeGroupName(n))) {
    data.groupNames.push(n);
    save();
  }
}

function removeGroupName(name) {
  data.groupNames = data.groupNames.filter((g) => normalizeGroupName(g) !== normalizeGroupName(name));
  save();
}

// ---------- Quién puede responder la tarifa ----------
function setAnyoneCanQuote(value) {
  data.anyoneCanQuote = Boolean(value);
  save();
}

function getAuthorizedNumbers() {
  return data.authorizedNumbers;
}

function addAuthorizedNumber(number) {
  const n = canonicalNumber(number);
  if (!n) throw new Error("El número no puede estar vacío");
  if (!data.authorizedNumbers.some((x) => canonicalNumber(x) === n)) {
    data.authorizedNumbers.push(n);
    save();
  }
}

function removeAuthorizedNumber(number) {
  const n = canonicalNumber(number);
  data.authorizedNumbers = data.authorizedNumbers.filter((x) => canonicalNumber(x) !== n);
  save();
}

// True si ese número puede responder la tarifa en ese grupo.
function canQuote(senderNumber) {
  if (data.anyoneCanQuote) return true;
  const n = canonicalNumber(senderNumber);
  return data.authorizedNumbers.some((x) => canonicalNumber(x) === n);
}

// ---------- Mensaje que acompaña la ubicación ----------
function getMessage() {
  return data.message;
}

function setMessage(text) {
  const t = String(text ?? "").trim();
  if (!t) throw new Error("El mensaje no puede estar vacío");
  data.message = t;
  save();
}

module.exports = {
  canonicalNumber,
  getConfig,
  getGroupNames,
  isQuoteGroup,
  addGroupName,
  removeGroupName,
  setAnyoneCanQuote,
  getAuthorizedNumbers,
  addAuthorizedNumber,
  removeAuthorizedNumber,
  canQuote,
  getMessage,
  setMessage,
};
