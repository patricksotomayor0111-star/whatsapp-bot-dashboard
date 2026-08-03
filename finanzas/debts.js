const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("debts-data.json");

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { personas: parsed.personas || {} };
  } catch (err) {
    return { personas: {} };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar debts-data.json:", err.message);
  }
}

// Fecha y hora actuales en Perú (UTC-5), igual que en cashbox.js.
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

function normKey(persona) {
  return String(persona || "").trim().toLowerCase();
}

function ensurePersona(k, label) {
  if (!data.personas[k]) {
    data.personas[k] = { label, saldo: 0, movimientos: [] };
  } else if (label) {
    // Se refresca con la última forma en que se escribió el nombre (mayúsculas, etc.)
    data.personas[k].label = label;
  }
  return data.personas[k];
}

// "Menos X Nombre debe": Nombre te debe X soles. No afecta la caja.
function addDebt(personaRaw, monto, descripcion) {
  const k = normKey(personaRaw);
  if (!k) return null;
  const p = ensurePersona(k, personaRaw.trim());
  const ahora = peruAhora();
  p.saldo += monto;
  p.movimientos.push({
    fecha: fechaLabel(ahora),
    hora: horaLabel(ahora),
    tipo: "debe",
    monto,
    descripcion: descripcion || "",
  });
  save();
  return { key: k, label: p.label, saldo: p.saldo };
}

// "X Nombre pago": salda (total o parcialmente) la deuda de Nombre. No afecta la caja.
function payDebt(personaRaw, monto, descripcion) {
  const k = normKey(personaRaw);
  if (!k) return null;
  const p = ensurePersona(k, personaRaw.trim());
  const ahora = peruAhora();
  p.saldo -= monto;
  p.movimientos.push({
    fecha: fechaLabel(ahora),
    hora: horaLabel(ahora),
    tipo: "pago",
    monto,
    descripcion: descripcion || "",
  });
  save();
  return { key: k, label: p.label, saldo: p.saldo };
}

function getDeudas() {
  return Object.entries(data.personas).map(([k, p]) => ({
    key: k,
    label: p.label,
    saldo: p.saldo,
  }));
}

function getDeuda(personaRaw) {
  const p = data.personas[normKey(personaRaw)];
  return p ? { label: p.label, saldo: p.saldo } : null;
}

function getMovimientos(personaRaw) {
  const p = data.personas[normKey(personaRaw)];
  return p ? p.movimientos : [];
}

// Marca como saldada la deuda completa de una persona (uso desde el panel).
function clearDebt(personaRaw) {
  const k = normKey(personaRaw);
  if (data.personas[k]) {
    data.personas[k].saldo = 0;
    save();
  }
}

// Elimina por completo el registro de una persona (uso desde el panel).
function removePersona(personaRaw) {
  const k = normKey(personaRaw);
  delete data.personas[k];
  save();
}

function efectoDelta(tipo, monto, signo) {
  // "debe" sube el saldo (te deben más), "pago" lo baja.
  return tipo === "debe" ? signo * monto : -signo * monto;
}

// Edita un movimiento puntual (por índice dentro del historial de esa
// persona): revierte su efecto viejo sobre el saldo y aplica el nuevo.
function editMovimiento(personaRaw, indice, cambios) {
  const p = data.personas[normKey(personaRaw)];
  if (!p || !p.movimientos[indice]) return null;
  const mov = p.movimientos[indice];

  p.saldo += efectoDelta(mov.tipo, mov.monto, -1);

  if (cambios.tipo !== undefined) mov.tipo = cambios.tipo;
  if (cambios.monto !== undefined) mov.monto = Number(cambios.monto) || 0;
  if (cambios.descripcion !== undefined) mov.descripcion = cambios.descripcion;
  if (cambios.fecha !== undefined) mov.fecha = cambios.fecha;
  if (cambios.hora !== undefined) mov.hora = cambios.hora;

  p.saldo += efectoDelta(mov.tipo, mov.monto, 1);

  save();
  return { saldo: p.saldo, movimiento: mov };
}

// Elimina un movimiento puntual y revierte su efecto sobre el saldo.
function removeMovimiento(personaRaw, indice) {
  const p = data.personas[normKey(personaRaw)];
  if (!p || !p.movimientos[indice]) return false;
  const mov = p.movimientos[indice];
  p.saldo += efectoDelta(mov.tipo, mov.monto, -1);
  p.movimientos.splice(indice, 1);
  save();
  return true;
}

module.exports = {
  addDebt,
  payDebt,
  getDeudas,
  getDeuda,
  getMovimientos,
  clearDebt,
  removePersona,
  editMovimiento,
  removeMovimiento,
};
