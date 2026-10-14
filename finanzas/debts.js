const { crearAlmacen } = require("./almacenPorUsuario");
const bitacora = require("./bitacora");



const almacen = crearAlmacen("debts-data.json", function (parsed) {
  try {
    return { personas: parsed.personas || {} };
  } catch (err) {
    return { personas: {} };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;


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
  if (!datos().personas[k]) {
    datos().personas[k] = { label, saldo: 0, movimientos: [] };
  } else if (label) {
    // Se refresca con la última forma en que se escribió el nombre (mayúsculas, etc.)
    datos().personas[k].label = label;
  }
  return datos().personas[k];
}

// "Menos X Nombre debe": Nombre te debe X soles. No afecta la caja.
let contadorMovDeuda = 0;
function nuevoIdMov() {
  contadorMovDeuda += 1;
  return "deu_" + Date.now() + "_" + contadorMovDeuda;
}

// A los movimientos que ya existian se les pone id la primera vez que se
// los lee, y se guarda una sola vez.
function asegurarIds(p) {
  let cambio = false;
  (p.movimientos || []).forEach((m) => {
    if (!m.id) {
      m.id = nuevoIdMov();
      cambio = true;
    }
  });
  return cambio;
}

function addDebt(personaRaw, monto, descripcion) {
  const k = normKey(personaRaw);
  if (!k) return null;
  const p = ensurePersona(k, personaRaw.trim());
  const ahora = peruAhora();
  p.saldo += monto;
  p.movimientos.push({
    id: nuevoIdMov(),
    fecha: fechaLabel(ahora),
    hora: horaLabel(ahora),
    tipo: "debe",
    monto,
    descripcion: descripcion || "",
  });
  save();
  bitacora.registrar({
    que: "deuda",
    accion: "creo",
    ref: k,
    resumen: p.label + " te quedó debiendo S/ " + monto + (descripcion ? " · " + descripcion : "") +
      ". Ahora te debe S/ " + p.saldo,
  });
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
    id: nuevoIdMov(),
    fecha: fechaLabel(ahora),
    hora: horaLabel(ahora),
    tipo: "pago",
    monto,
    descripcion: descripcion || "",
  });
  save();
  bitacora.registrar({
    que: "deuda",
    accion: "pago",
    ref: k,
    resumen: p.label + " te pagó S/ " + monto + (descripcion ? " · " + descripcion : "") +
      ". Queda debiendo S/ " + p.saldo,
  });
  return { key: k, label: p.label, saldo: p.saldo };
}

function getDeudas() {
  return Object.entries(datos().personas).map(([k, p]) => ({
    key: k,
    label: p.label,
    saldo: p.saldo,
  }));
}

function getDeuda(personaRaw) {
  const p = datos().personas[normKey(personaRaw)];
  return p ? { label: p.label, saldo: p.saldo } : null;
}

// Por identidad, no por posicion.
function editMovimientoPorId(personaRaw, id, cambios) {
  const p = datos().personas[normKey(personaRaw)];
  if (!p) return null;
  asegurarIds(p);
  const i = (p.movimientos || []).findIndex((m) => m.id === id);
  return i === -1 ? null : editMovimiento(personaRaw, i, cambios);
}

function removeMovimientoPorId(personaRaw, id) {
  const p = datos().personas[normKey(personaRaw)];
  if (!p) return false;
  asegurarIds(p);
  const i = (p.movimientos || []).findIndex((m) => m.id === id);
  return i === -1 ? false : removeMovimiento(personaRaw, i);
}

function getMovimientos(personaRaw) {
  const p = datos().personas[normKey(personaRaw)];
  if (!p) return [];
  // Los movimientos viejos no tenian id. Se los ponemos al leerlos, una
  // sola vez, para poder editarlos por identidad y no por posicion.
  if (asegurarIds(p)) save();
  return p.movimientos;
}

// Marca como saldada la deuda completa de una persona (uso desde el panel).
function clearDebt(personaRaw) {
  const k = normKey(personaRaw);
  if (datos().personas[k]) {
    datos().personas[k].saldo = 0;
    save();
  }
}

// Elimina por completo el registro de una persona (uso desde el panel).
function removePersona(personaRaw) {
  const k = normKey(personaRaw);
  delete datos().personas[k];
  save();
}

function efectoDelta(tipo, monto, signo) {
  // "debe" sube el saldo (te deben más), "pago" lo baja.
  return tipo === "debe" ? signo * monto : -signo * monto;
}

// Edita un movimiento puntual (por índice dentro del historial de esa
// persona): revierte su efecto viejo sobre el saldo y aplica el nuevo.
function editMovimiento(personaRaw, indice, cambios) {
  const p = datos().personas[normKey(personaRaw)];
  if (!p || !p.movimientos[indice]) return null;
  const mov = p.movimientos[indice];
  const copiaAntes = { ...mov };

  p.saldo += efectoDelta(mov.tipo, mov.monto, -1);

  if (cambios.tipo !== undefined) mov.tipo = cambios.tipo;
  if (cambios.monto !== undefined) mov.monto = Number(cambios.monto) || 0;
  if (cambios.descripcion !== undefined) mov.descripcion = cambios.descripcion;
  if (cambios.fecha !== undefined) mov.fecha = cambios.fecha;
  if (cambios.hora !== undefined) mov.hora = cambios.hora;

  p.saldo += efectoDelta(mov.tipo, mov.monto, 1);

  save();
  bitacora.registrar({
    que: "deuda",
    accion: "edito",
    ref: mov.id,
    resumen: "Corregiste un movimiento de " + p.label + ". Ahora te debe S/ " + p.saldo,
    antes: copiaAntes,
    despues: mov,
  });
  return { saldo: p.saldo, movimiento: mov };
}

// Elimina un movimiento puntual y revierte su efecto sobre el saldo.
function removeMovimiento(personaRaw, indice) {
  const p = datos().personas[normKey(personaRaw)];
  if (!p || !p.movimientos[indice]) return false;
  const mov = p.movimientos[indice];
  p.saldo += efectoDelta(mov.tipo, mov.monto, -1);
  p.movimientos.splice(indice, 1);
  save();
  bitacora.registrar({
    que: "deuda",
    accion: "borro",
    ref: mov.id,
    resumen: "Borraste un movimiento de " + p.label + ". Ahora te debe S/ " + p.saldo,
    antes: mov,
  });
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
  editMovimientoPorId,
  removeMovimientoPorId,
};
