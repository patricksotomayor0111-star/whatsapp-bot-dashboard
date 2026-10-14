const { crearAlmacen } = require("./almacenPorUsuario");
const businessDay = require("./businessDay");
const bitacora = require("./bitacora");

// Lo que TÚ debes. Es lo contrario de debts.js, que es lo que te deben.
//
// Un crédito de Yape entra a la caja como cualquier ganancia, y está bien:
// esa plata la tienes y sirve para pagar. Pero no la generaste trabajando
// y, sobre todo, hay que devolverla. Sin esto la app creía que sacar un
// crédito te dejaba mejor: "lo que tengo" subía y "lo que tengo que pagar"
// no se movía, así que un préstamo de S/400 se leía como S/400 de sobra
// cuando en realidad era S/440 de deuda nueva.
//
// REGLA IMPORTANTE, para no contar dos veces lo mismo:
// si el préstamo está atado a un pendiente (un recordatorio de pago), el
// que manda para "lo que tengo que pagar" es EL PENDIENTE. Acá solo se
// lleva el saldo. Si no tiene pendiente, entonces sí cuenta por su cuenta,
// porque no hay nadie más contándolo.
// Las palabras que hacen que una ganancia se anote ADEMAS como prestamo.
// Editables, porque cada uno le dice distinto.
const PALABRAS_BASE = ["credito", "prestamo", "presto", "prestado"];

const almacen = crearAlmacen("prestamos-data.json", function (parsed) {
  try {
    return {
      prestamos: Array.isArray(parsed.prestamos) ? parsed.prestamos : [],
      palabras:
        Array.isArray(parsed.palabras) && parsed.palabras.length ? parsed.palabras : PALABRAS_BASE.slice(),
    };
  } catch (err) {
    return { prestamos: [], palabras: PALABRAS_BASE.slice() };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;

let contador = 0;
function nuevoId(prefijo) {
  contador += 1;
  return prefijo + "_" + Date.now() + "_" + contador;
}

const COMBINING_MARKS = new RegExp("[̀-ͯ]", "g");
function normalizar(texto) {
  return String(texto || "").normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase().trim();
}

function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Lo que falta pagar de un préstamo.
function saldoDe(p) {
  return r2((p.aDevolver || 0) - (p.pagos || []).reduce((s, x) => s + (x.monto || 0), 0));
}

function conCalculos(p) {
  const pagado = r2((p.pagos || []).reduce((s, x) => s + (x.monto || 0), 0));
  const saldo = r2((p.aDevolver || 0) - pagado);
  return {
    ...p,
    pagos: (p.pagos || []).slice(),
    pagado,
    saldo,
    // Lo que el préstamo te cuesta de más por encima de lo que recibiste.
    interes: r2((p.aDevolver || 0) - (p.recibido || 0)),
    saldado: saldo <= 0.009,
  };
}

function getAll() {
  return datos().prestamos.map(conCalculos);
}

function getById(id) {
  const p = datos().prestamos.find((x) => x.id === id);
  return p ? conCalculos(p) : null;
}

// ---------- Alta ----------
// recibido: lo que entró a tu bolsillo. aDevolver: lo que tienes que
// devolver, con interés. Si no se dice, se asume sin interés (y el panel
// te avisa para que lo corrijas).
function addPrestamo({ label, recibido, aDevolver, fecha, recordatorioId, movimientoId, cuota, diaDelMes, nota }) {
  const nombre = String(label || "").trim();
  if (!nombre) throw new Error("Ponle un nombre: de quién es el préstamo.");
  const entro = r2(recibido);
  if (!(entro > 0)) throw new Error("¿Cuánto te prestaron?");
  const ahora = businessDay.peruAhora();

  const p = {
    id: nuevoId("pre"),
    label: nombre,
    recibido: entro,
    aDevolver: r2(aDevolver) > 0 ? r2(aDevolver) : entro,
    fecha: fecha || businessDay.businessDayLabel(),
    hora: businessDay.horaLabel(ahora),
    // El pendiente que lo paga. Mientras exista, este préstamo NO cuenta
    // aparte en las metas: el pendiente ya lo está contando.
    recordatorioId: recordatorioId || null,
    // La ganancia que este préstamo dejó en la caja, para poder seguirla.
    movimientoId: movimientoId || null,
    // Si no hay pendiente, con esto se puede proyectar igual.
    cuota: r2(cuota) > 0 ? r2(cuota) : null,
    diaDelMes: Number(diaDelMes) > 0 ? Math.min(31, Number(diaDelMes)) : null,
    nota: nota || "",
    activo: true,
    pagos: [],
  };
  datos().prestamos.push(p);
  save();
  bitacora.registrar({
    que: "prestamo",
    accion: "creo",
    ref: p.id,
    resumen: "Pediste prestado S/ " + entro + " a " + nombre +
      (p.aDevolver !== entro ? " (devuelves S/ " + p.aDevolver + ")" : ""),
  });
  return conCalculos(p);
}

function editPrestamo(id, cambios) {
  const p = datos().prestamos.find((x) => x.id === id);
  if (!p) return null;
  const antes = { ...p };

  if (cambios.label !== undefined && String(cambios.label).trim()) p.label = String(cambios.label).trim();
  if (cambios.recibido !== undefined) p.recibido = r2(cambios.recibido);
  if (cambios.aDevolver !== undefined) p.aDevolver = r2(cambios.aDevolver);
  if (cambios.fecha !== undefined) p.fecha = cambios.fecha;
  if (cambios.nota !== undefined) p.nota = cambios.nota;
  if (cambios.activo !== undefined) p.activo = !!cambios.activo;
  // Vacío = desatarlo del pendiente. Ojo: desatarlo hace que pase a
  // contar por su cuenta en las metas.
  if (cambios.recordatorioId !== undefined) p.recordatorioId = cambios.recordatorioId || null;
  if (cambios.cuota !== undefined) p.cuota = r2(cambios.cuota) > 0 ? r2(cambios.cuota) : null;
  if (cambios.diaDelMes !== undefined) {
    p.diaDelMes = Number(cambios.diaDelMes) > 0 ? Math.min(31, Number(cambios.diaDelMes)) : null;
  }

  save();
  bitacora.registrar({
    que: "prestamo",
    accion: "edito",
    ref: p.id,
    resumen: "Corregiste el préstamo de " + p.label + ". Falta S/ " + saldoDe(p),
    antes: { monto: antes.aDevolver, descripcion: antes.label },
    despues: { monto: p.aDevolver, descripcion: p.label },
  });
  return conCalculos(p);
}

function removePrestamo(id) {
  const p = datos().prestamos.find((x) => x.id === id);
  if (!p) return false;
  datos().prestamos = datos().prestamos.filter((x) => x.id !== id);
  save();
  bitacora.registrar({
    que: "prestamo",
    accion: "borro",
    ref: id,
    resumen: "Borraste el préstamo de " + p.label + " · S/ " + p.aDevolver,
    antes: { monto: p.aDevolver, descripcion: p.label },
  });
  return true;
}

// ---------- Pagos ----------
// origen: "panel" | "pendiente". El de "pendiente" es el que entra solo
// cuando marcas "Ya pagué" en un recordatorio atado a este préstamo.
function registrarPago(id, { monto, fecha, descripcion, origen } = {}) {
  const p = datos().prestamos.find((x) => x.id === id);
  if (!p) return null;
  const m = r2(monto);
  if (!(m > 0)) throw new Error("¿De cuánto fue el pago?");
  const ahora = businessDay.peruAhora();

  p.pagos.push({
    id: nuevoId("pag"),
    fecha: fecha || businessDay.businessDayLabel(),
    hora: businessDay.horaLabel(ahora),
    monto: m,
    descripcion: descripcion || "",
    origen: origen === "pendiente" ? "pendiente" : "panel",
  });

  const saldo = saldoDe(p);
  // Al terminar de pagarlo deja de estar activo, pero no se borra: el
  // historial sirve para saber cuánto te costó el crédito.
  if (saldo <= 0.009) p.activo = false;
  save();

  bitacora.registrar({
    que: "prestamo",
    accion: "pago",
    ref: p.id,
    resumen: "Pagaste S/ " + m + " de lo que le debes a " + p.label +
      (saldo <= 0.009 ? ". ¡Terminaste de pagarlo!" : ". Falta S/ " + saldo),
  });
  return conCalculos(p);
}

function quitarPago(id, pagoId) {
  const p = datos().prestamos.find((x) => x.id === id);
  if (!p) return null;
  const pago = (p.pagos || []).find((x) => x.id === pagoId);
  if (!pago) return null;
  p.pagos = p.pagos.filter((x) => x.id !== pagoId);
  // Si estaba saldado y se le quita un pago, vuelve a estar abierto.
  if (saldoDe(p) > 0.009) p.activo = true;
  save();
  bitacora.registrar({
    que: "prestamo",
    accion: "borro",
    ref: p.id,
    resumen: "Borraste un pago de S/ " + pago.monto + " a " + p.label + ". Falta S/ " + saldoDe(p),
    antes: { monto: pago.monto, fecha: pago.fecha },
  });
  return conCalculos(p);
}

// Cuando marcas "Ya pagué" en un pendiente, el préstamo que cuelga de ese
// pendiente baja solo. Es lo que evita tener que anotar lo mismo dos veces.
function registrarPagoPorRecordatorio(recordatorioId, monto) {
  if (!recordatorioId) return null;
  const p = datos().prestamos.find((x) => x.recordatorioId === recordatorioId && x.activo !== false);
  if (!p) return null;
  return registrarPago(p.id, { monto, origen: "pendiente", descripcion: "cuota" });
}

// ---------- Totales ----------
function getTotales() {
  const todos = getAll();
  const activos = todos.filter((p) => !p.saldado);
  return {
    // Lo que falta devolver en total. Este es el número que se resta de
    // "tu plata de verdad".
    debes: r2(activos.reduce((s, p) => s + p.saldo, 0)),
    recibido: r2(activos.reduce((s, p) => s + p.recibido, 0)),
    prestamos: activos.length,
    // Lo que los créditos te cuestan de más, contando también los ya
    // pagados: es plata que se fue y no se ve en ningún lado.
    interesesTotales: r2(todos.reduce((s, p) => s + Math.max(p.interes, 0), 0)),
  };
}

function interesesDesde(desdeLabel) {
  return r2(
    getAll()
      .filter((p) => !desdeLabel || (p.fecha || "") >= desdeLabel)
      .reduce((s, p) => s + Math.max(p.interes, 0), 0)
  );
}

// Cuánto de lo que entró en un periodo fue prestado. Si eso es una parte
// grande, el mes no se sostuvo con el trabajo sino con el crédito, y eso
// no se ve en ningún otro lado.
function loPrestadoEn(desde, hasta) {
  return r2(
    getAll()
      .filter((p) => (!desde || p.fecha >= desde) && (!hasta || p.fecha <= hasta))
      .reduce((s, p) => s + p.recibido, 0)
  );
}

// ---------- Lo que hay que devolver en un periodo ----------
// Solo de los préstamos que NO tienen pendiente: los que sí lo tienen ya
// están contados por ese pendiente, y sumarlos acá contaría doble.
//
// De los que quedan:
//   - con cuota y día: se proyectan las cuotas que caen en el rango
//   - sin cuota: cuenta el saldo entero, porque no hay plan de pago y lo
//     honesto es tratarlo como si lo debieras ya
function aDevolverEn(desde, hasta) {
  const detalle = [];
  let total = 0;

  getAll().forEach((p) => {
    if (p.saldado || p.activo === false) return;
    if (p.recordatorioId) return; // lo cuenta el pendiente

    let monto;
    let porque;
    if (p.cuota && p.diaDelMes) {
      const veces = ocurrenciasDelDiaEnRango(desde, hasta, p.diaDelMes);
      monto = Math.min(r2(veces * p.cuota), p.saldo);
      porque = veces === 0 ? "no cae ninguna cuota en este periodo" : veces + " cuota(s) de S/ " + p.cuota;
    } else {
      monto = p.saldo;
      porque = "sin fecha de pago: cuenta entero";
    }
    if (monto > 0) {
      total += monto;
      detalle.push({ id: p.id, label: p.label, monto: r2(monto), porque, saldo: p.saldo });
    }
  });

  return { total: r2(total), detalle };
}

function diasEnMes(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

// Cuántas veces cae un día del mes dentro de un rango de fechas. En los
// meses cortos se corre al último día, igual que los recordatorios.
function ocurrenciasDelDiaEnRango(desde, hasta, dia) {
  if (!desde || !hasta || desde > hasta) return 0;
  let veces = 0;
  const [yD, moD] = desde.split("-").map(Number);
  const [yH, moH] = hasta.split("-").map(Number);
  let y = yD;
  let mo = moD;
  // Tope de seguridad: nadie proyecta más de 10 años.
  for (let i = 0; i < 120; i++) {
    const d = Math.min(dia, diasEnMes(y, mo));
    const label = y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    if (label >= desde && label <= hasta) veces += 1;
    if (y > yH || (y === yH && mo >= moH)) break;
    mo += 1;
    if (mo > 12) {
      mo = 1;
      y += 1;
    }
  }
  return veces;
}

// Las cuotas que caen en un día puntual, para pintarlas en el calendario.
// Otra vez: solo las de préstamos sin pendiente, que las otras ya salen
// como pendiente.
function cuotasDelDia(fecha) {
  const dia = Number((fecha || "").slice(8, 10));
  const [y, mo] = (fecha || "").split("-").map(Number);
  if (!dia || !y) return [];
  return getAll()
    .filter((p) => !p.saldado && p.activo !== false && !p.recordatorioId && p.cuota && p.diaDelMes)
    .filter((p) => Math.min(p.diaDelMes, diasEnMes(y, mo)) === dia)
    .map((p) => ({ id: p.id, label: p.label, monto: Math.min(p.cuota, p.saldo) }));
}

// ¿Me conviene sacar este crédito? Devuelve qué pasaría con la plata.
function simular({ monto, meses, interesPorciento }) {
  const m = r2(monto);
  const n = Math.max(1, Math.round(Number(meses) || 1));
  const pct = Number(interesPorciento) || 0;
  const aDevolver = r2(m * (1 + pct / 100));
  return {
    recibes: m,
    aDevolver,
    interes: r2(aDevolver - m),
    meses: n,
    cuota: r2(aDevolver / n),
  };
}

// El nombre de un préstamo sacado de lo que escribió: de "yape credito"
// sale "Yape". Si no queda nada, se le pone un nombre genérico.
function nombreDesdeDescripcion(descripcion, palabras) {
  const fuera = new Set((palabras || []).map(normalizar));
  const partes = normalizar(descripcion)
    .split(/[^a-z0-9]+/)
    .filter((p) => p && !fuera.has(p) && !/^\d/.test(p));
  if (!partes.length) return "Préstamo";
  return partes.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

// Si ya hay un préstamo abierto con ese nombre se le suma, en vez de abrir
// uno nuevo cada vez: pedir dos veces a Yape es la misma deuda creciendo.
function abrirOSumar({ label, recibido, movimientoId }) {
  const clave = normalizar(label);
  const existente = datos().prestamos.find(
    (p) => normalizar(p.label) === clave && p.activo !== false && saldoDe(p) > 0.009
  );
  if (!existente) return addPrestamo({ label, recibido, movimientoId });

  const entro = r2(recibido);
  existente.recibido = r2(existente.recibido + entro);
  existente.aDevolver = r2(existente.aDevolver + entro);
  save();
  bitacora.registrar({
    que: "prestamo",
    accion: "creo",
    ref: existente.id,
    resumen: "Pediste S/ " + entro + " más a " + existente.label + ". Ahora le debes S/ " + saldoDe(existente),
  });
  return conCalculos(existente);
}

// ---------- Las palabras que lo disparan ----------
function getPalabras() {
  return (datos().palabras || PALABRAS_BASE).slice();
}

function setPalabras(lista) {
  const limpias = [...new Set((Array.isArray(lista) ? lista : []).map(normalizar).filter(Boolean))];
  datos().palabras = limpias;
  save();
  return getPalabras();
}

// ¿Esta ganancia es plata prestada? Por palabra completa, para que una
// palabra corta no matchee dentro de otra.
function esPrestamo(descripcion) {
  const palabras = normalizar(descripcion).split(/[^a-z0-9]+/).filter(Boolean);
  return getPalabras().some((k) => palabras.includes(k));
}

module.exports = {
  getPalabras,
  setPalabras,
  esPrestamo,
  getAll,
  getById,
  addPrestamo,
  editPrestamo,
  removePrestamo,
  registrarPago,
  quitarPago,
  registrarPagoPorRecordatorio,
  getTotales,
  interesesDesde,
  loPrestadoEn,
  aDevolverEn,
  cuotasDelDia,
  simular,
  nombreDesdeDescripcion,
  abrirOSumar,
  ocurrenciasDelDiaEnRango,
};
