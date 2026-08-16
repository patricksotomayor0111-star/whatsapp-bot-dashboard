const fs = require("fs");
const { crearAlmacen } = require("./almacenPorUsuario");
const businessDay = require("./businessDay");
const users = require("./users");
const { usuarioActual } = require("./contexto");

// Las semillas son la configuración con la que arrancó el dueño. Una
// cuenta nueva debe empezar vacía: si no, vería los pagos y las
// categorías (con sus montos) de otra persona.
function sembrarSoloAlDueno(semilla) {
  return usuarioActual() === users.DUENO_ID ? semilla : [];
}




// Recordatorios de pagos que se repiten. Cada uno se vuelve "pendiente"
// 1 día antes de su fecha (a partir de las 8am manda notificación) y sigue
// mostrándose todos los días hasta que el usuario toca "Ya pagué". Marcarlo
// pagado NO registra el gasto (eso lo escribe él en el grupo GANANCIAS);
// solo apaga el aviso hasta el próximo ciclo.
//
// tipo:
//   "semanal"        -> dia = día de la semana (0=domingo, 1=lunes ... 6=sábado)
//   "mensual_dia"    -> dia = día del mes (5, 13, 15...)
//   "mensual_finmes" -> el último día de cada mes
//   "unica"          -> fecha = "YYYY-MM-DD" (una sola vez, no se repite)
const SEED = [
  { id: "junta", label: "Junta", monto: 100, tipo: "semanal", dia: 1 },
  { id: "arce", label: "Cuota ARCE", monto: 27, tipo: "semanal", dia: 2 },
  { id: "movistar", label: "Movistar internet", monto: 46, tipo: "mensual_dia", dia: 5 },
  { id: "cuzco", label: "Caja Cuzco", monto: 998, tipo: "mensual_dia", dia: 13 },
  { id: "luz", label: "Luz", monto: 80, tipo: "mensual_dia", dia: 15 },
  { id: "terreno", label: "Terreno", monto: 500, tipo: "mensual_finmes" },
  { id: "universidad", label: "Universidad", monto: 3200, tipo: "mensual_finmes" },
];


const almacen = crearAlmacen("reminders-data.json", function (parsed) {
  try {
    return {
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : sembrarSoloAlDueno(SEED.map((r) => ({ ...r, activo: true, lastPaidCycle: null }))),
      lastNotifiedLabel: parsed.lastNotifiedLabel || null,
      pagosMarcados: Array.isArray(parsed.pagosMarcados) ? parsed.pagosMarcados : [],
    };
  } catch (err) {
    // Primera vez (sin archivo): se siembran los pagos que ya conocemos.
    return {
      reminders: sembrarSoloAlDueno(SEED.map((r) => ({ ...r, activo: true, lastPaidCycle: null }))),
      lastNotifiedLabel: null,
      pagosMarcados: [],
    };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;


// ---------- Utilidades de fecha (solo calendario, sin zona horaria) ----------
// Se trabaja con etiquetas "YYYY-MM-DD" y fechas UTC a medianoche para que la
// aritmética de días/meses no dependa de la zona del servidor. "Hoy" es el
// día LABORAL (7am a 7am, ver businessDay.js), no el día calendario: así los
// pagos vencidos/pendientes respetan el mismo corte que la caja y los
// resúmenes diarios.
const { ymdToUtc, utcToLabel, addDays, diasEnMes, horaPeru, peruAhora, horaLabel, businessDayLabel: fechaLabelPeru } = businessDay;

function diasEntre(labelA, labelB) {
  return Math.round((ymdToUtc(labelB).getTime() - ymdToUtc(labelA).getTime()) / 86400000);
}

// La fecha de vencimiento del ciclo cuyo aviso YA se abrió (1 día antes),
// es decir el mayor vencimiento <= hoy+1. Devuelve etiqueta o null si aún no
// hay ninguna ventana abierta (caso de pagos únicos futuros).
function ultimaVentanaAbierta(r, hoyLabel) {
  const limite = addDays(hoyLabel, 1); // hoy + 1: la ventana abre 1 día antes

  if (r.tipo === "semanal") {
    const w = ymdToUtc(limite).getUTCDay();
    const diff = (w - r.dia + 7) % 7;
    return addDays(limite, -diff);
  }

  if (r.tipo === "mensual_dia") {
    const [y, mo] = limite.split("-").map(Number);
    const dayLimite = Number(limite.split("-")[2]);
    const diaEsteMes = Math.min(r.dia, diasEnMes(y, mo));
    if (dayLimite >= diaEsteMes) {
      return utcToLabel(new Date(Date.UTC(y, mo - 1, diaEsteMes)));
    }
    // mes anterior
    const prevMo = mo === 1 ? 12 : mo - 1;
    const prevY = mo === 1 ? y - 1 : y;
    const diaPrev = Math.min(r.dia, diasEnMes(prevY, prevMo));
    return utcToLabel(new Date(Date.UTC(prevY, prevMo - 1, diaPrev)));
  }

  if (r.tipo === "mensual_finmes") {
    const [y, mo] = limite.split("-").map(Number);
    const ultimoEste = diasEnMes(y, mo);
    if (Number(limite.split("-")[2]) >= ultimoEste) {
      return utcToLabel(new Date(Date.UTC(y, mo - 1, ultimoEste)));
    }
    const prevMo = mo === 1 ? 12 : mo - 1;
    const prevY = mo === 1 ? y - 1 : y;
    return utcToLabel(new Date(Date.UTC(prevY, prevMo - 1, diasEnMes(prevY, prevMo))));
  }

  if (r.tipo === "unica") {
    if (!r.fecha) return null;
    return r.fecha <= limite ? r.fecha : null; // solo si su ventana ya abrió
  }

  return null;
}

// La próxima fecha de vencimiento >= hoy (para mostrar "próximo pago" aunque
// no esté pendiente todavía).
function proximaFecha(r, hoyLabel) {
  if (r.tipo === "semanal") {
    const w = ymdToUtc(hoyLabel).getUTCDay();
    const diff = (r.dia - w + 7) % 7;
    return addDays(hoyLabel, diff);
  }
  if (r.tipo === "mensual_dia") {
    const [y, mo] = hoyLabel.split("-").map(Number);
    const dayHoy = Number(hoyLabel.split("-")[2]);
    const diaEste = Math.min(r.dia, diasEnMes(y, mo));
    if (dayHoy <= diaEste) return utcToLabel(new Date(Date.UTC(y, mo - 1, diaEste)));
    const nextMo = mo === 12 ? 1 : mo + 1;
    const nextY = mo === 12 ? y + 1 : y;
    return utcToLabel(new Date(Date.UTC(nextY, nextMo - 1, Math.min(r.dia, diasEnMes(nextY, nextMo)))));
  }
  if (r.tipo === "mensual_finmes") {
    const [y, mo] = hoyLabel.split("-").map(Number);
    return utcToLabel(new Date(Date.UTC(y, mo - 1, diasEnMes(y, mo))));
  }
  if (r.tipo === "unica") return r.fecha || null;
  return null;
}

// ¿Este recordatorio está pendiente hoy? Lo está si su ventana ya abrió y esa
// fecha de vencimiento todavía no fue marcada como pagada.
function estaPendiente(r, hoyLabel) {
  if (!r.activo) return null;
  const due = ultimaVentanaAbierta(r, hoyLabel);
  if (!due) return null;
  if (r.lastPaidCycle && r.lastPaidCycle >= due) return null;
  return due;
}

function getPendientes() {
  const hoy = fechaLabelPeru();
  const lista = [];
  datos().reminders.forEach((r) => {
    const due = estaPendiente(r, hoy);
    if (due) lista.push({ id: r.id, label: r.label, monto: r.monto, vence: due, dias: diasEntre(hoy, due) });
  });
  // Los más urgentes (vencidos / de hoy) primero.
  lista.sort((a, b) => a.vence.localeCompare(b.vence));
  return lista;
}

// Lista completa para el panel de gestión (incluye estado y próxima fecha).
function getAll() {
  const hoy = fechaLabelPeru();
  return datos().reminders.map((r) => {
    const due = estaPendiente(r, hoy);
    return {
      id: r.id,
      label: r.label,
      monto: r.monto,
      tipo: r.tipo,
      dia: r.dia ?? null,
      fecha: r.fecha ?? null,
      activo: r.activo !== false,
      pendiente: !!due,
      vence: due || null,
      proxima: proximaFecha(r, hoy),
    };
  });
}

function getById(id) {
  return datos().reminders.find((x) => x.id === id) || null;
}

// ---------- ¿El gasto de este pago ya está en la caja? ----------
// Al marcar "Ya pagué" el gasto NO se registraba solo (había que
// escribirlo aparte en el grupo GANANCIAS), así que era fácil olvidarlo y
// que la caja quedara sin ese gasto. Ahora se busca primero si ya está
// registrado, para poder anotarlo solo cuando falta y no duplicarlo.

const COMBINING_MARKS = new RegExp("[̀-ͯ]", "g");
function normalizeText(str) {
  return String(str || "").normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

// Palabras demasiado genéricas como para identificar un pago: "Caja Cuzco"
// tiene que buscarse por "cuzco" (si no, cualquier gasto que diga "caja"
// lo daría por registrado), y "Cuota ARCE" por "arce".
const PALABRAS_GENERICAS = new Set(["cuota", "caja", "pago", "pagos", "mes", "mensual", "semanal", "del", "los", "las"]);

function palabrasClaveDe(label) {
  const palabras = normalizeText(label).split(/[^a-z0-9]+/).filter((p) => p.length >= 3);
  const significativas = palabras.filter((p) => !PALABRAS_GENERICAS.has(p));
  return significativas.length ? significativas : palabras;
}

// Cuántos días hacia atrás tiene sentido buscar, según cada cuánto se paga.
const DIAS_VENTANA = { semanal: 7, mensual_dia: 31, mensual_finmes: 31, unica: 31 };

// Busca en los movimientos de la caja un gasto que corresponda a este pago
// dentro de su ciclo (la semana o el mes en curso). Devuelve el movimiento
// encontrado, o null si no está registrado.
function buscarGastoDelPago(id, movimientos) {
  const r = getById(id);
  if (!r) return null;
  const hoy = fechaLabelPeru();
  const due = ultimaVentanaAbierta(r, hoy) || hoy;
  const desde = addDays(due, -(DIAS_VENTANA[r.tipo] || 31));
  const claves = palabrasClaveDe(r.label);

  return (
    movimientos.find((m) => {
      if (m.tipo !== "gasto") return false;
      if (m.fecha < desde || m.fecha > hoy) return false;
      const desc = normalizeText(m.descripcion);
      return claves.some((k) => desc.includes(k));
    }) || null
  );
}

// Cuántos días antes del vencimiento se acepta un pago adelantado, y qué
// tan parecido tiene que ser el monto al configurado para dar por pagado
// un gasto escrito en el grupo.
const DIAS_ADELANTO = 7;
const FRACCION_MONTO_MINIMA = 0.5;

// Ciclo que se puede marcar como pagado ahora mismo: el que ya está
// abierto (vencido o vence mañana) o, si se paga antes de tiempo, el
// próximo que caiga dentro de DIAS_ADELANTO días. Devuelve la fecha de
// vencimiento de ese ciclo, o null si no hay ninguno por marcar.
function cicloMarcable(r, hoy) {
  if (r.activo === false) return null;
  const abierta = ultimaVentanaAbierta(r, hoy);
  if (abierta && !(r.lastPaidCycle && r.lastPaidCycle >= abierta)) return abierta;

  const proxima = proximaFecha(r, hoy);
  if (!proxima) return null;
  if (diasEntre(hoy, proxima) > DIAS_ADELANTO) return null;
  if (r.lastPaidCycle && r.lastPaidCycle >= proxima) return null;
  return proxima;
}

// Al revés que buscarGastoDelPago: dado un gasto escrito en el grupo
// ("menos 100 junta"), busca a qué pago pendiente corresponde, para
// marcarlo solo sin tener que tocar "Ya pagué" en el panel.
//
// Se exige que el monto se parezca al configurado (de la mitad para
// arriba) para que un gasto chico que comparte la palabra —ej. "menos 20
// terreno"— no apague el aviso de un pago de S/500.
function buscarPendientePorGasto(descripcion, monto) {
  const desc = normalizeText(descripcion);
  if (!desc.trim()) return null;
  const hoy = fechaLabelPeru();
  const montoNum = Number(monto) || 0;

  for (const r of datos().reminders) {
    const claves = palabrasClaveDe(r.label);
    if (!claves.some((k) => desc.includes(k))) continue;
    if (r.monto > 0 && montoNum < r.monto * FRACCION_MONTO_MINIMA) continue;
    const vence = cicloMarcable(r, hoy);
    if (vence) return { reminder: r, vence };
  }
  return null;
}

// Vuelve a dejar un pago como no pagado (por si se marcó por error). Ojo:
// solo reabre el aviso; el gasto que haya quedado en la caja se corrige
// aparte desde Movimientos.
function desmarcarPagado(id) {
  const r = datos().reminders.find((x) => x.id === id);
  if (!r) throw new Error("Recordatorio inexistente: " + id);
  r.lastPaidCycle = null;
  if (r.tipo === "unica") r.activo = true;
  save();
  return r;
}

const MAX_PAGOS_MARCADOS = 100;

// "info" queda guardado como historial de qué pasó cada vez que se marcó
// un pago desde el panel: cuánto fue, y si el gasto se registró en la caja
// en ese momento o ya estaba escrito.
function marcarPagado(id, info) {
  const r = datos().reminders.find((x) => x.id === id);
  if (!r) throw new Error("Recordatorio inexistente: " + id);
  const hoy = fechaLabelPeru();
  // "info.vence" llega cuando el pago se marca solo desde el grupo y puede
  // ser un ciclo adelantado (que todavía no abrió su ventana); si no viene,
  // se usa el ciclo abierto de siempre.
  const due = (info && info.vence) || ultimaVentanaAbierta(r, hoy);
  if (r.tipo === "unica") {
    r.activo = false; // pago único: no vuelve a aparecer
  } else if (due) {
    r.lastPaidCycle = due; // recurrente: se apaga hasta el próximo ciclo
  }

  if (info) {
    datos().pagosMarcados.push({
      id: r.id,
      label: r.label,
      vence: due || hoy,
      fecha: hoy,
      hora: horaLabel(peruAhora()),
      monto: Number(info.monto) || 0,
      registrado: !!info.registrado,
      gastoExistente: info.gastoExistente || null,
      origen: info.origen === "grupo" ? "grupo" : "panel",
    });
    if (datos().pagosMarcados.length > MAX_PAGOS_MARCADOS) {
      datos().pagosMarcados.splice(0, datos().pagosMarcados.length - MAX_PAGOS_MARCADOS);
    }
  }

  save();
}

// Historial para el panel: lo más reciente primero. Con "id" devuelve solo
// el de ese pago (para ver cuándo se pagó cada uno).
function getHistorialPagos(id) {
  const lista = id ? datos().pagosMarcados.filter((p) => p.id === id) : datos().pagosMarcados;
  return lista.slice().reverse();
}

function setActivo(id, activo) {
  const r = datos().reminders.find((x) => x.id === id);
  if (!r) throw new Error("Recordatorio inexistente: " + id);
  r.activo = !!activo;
  save();
}

function addReminder({ label, monto, tipo, dia, fecha }) {
  const tiposValidos = ["semanal", "mensual_dia", "mensual_finmes", "unica"];
  if (!label || !tiposValidos.includes(tipo)) throw new Error("Datos de recordatorio inválidos");
  const nuevo = {
    id: "custom_" + Date.now(),
    label: String(label).trim(),
    monto: Number(monto) || 0,
    tipo,
    activo: true,
    lastPaidCycle: null,
  };
  if (tipo === "semanal" || tipo === "mensual_dia") nuevo.dia = Number(dia);
  if (tipo === "unica") nuevo.fecha = fecha;
  datos().reminders.push(nuevo);
  save();
  return nuevo.id;
}

// Edita un recordatorio existente (nombre, monto, tipo, día/fecha), para
// no tener que borrarlo y crearlo de nuevo cuando cambia un monto o una
// fecha real (ej. actualizar Cuzco o Universidad mes a mes).
function editReminder(id, cambios) {
  const r = datos().reminders.find((x) => x.id === id);
  if (!r) return null;
  const tiposValidos = ["semanal", "mensual_dia", "mensual_finmes", "unica"];
  if (cambios.label !== undefined && String(cambios.label).trim()) r.label = String(cambios.label).trim();
  if (cambios.monto !== undefined) r.monto = Number(cambios.monto) || 0;
  if (cambios.tipo !== undefined) {
    if (!tiposValidos.includes(cambios.tipo)) throw new Error("Tipo de recordatorio inválido: " + cambios.tipo);
    r.tipo = cambios.tipo;
  }
  if (cambios.dia !== undefined) r.dia = Number(cambios.dia);
  if (cambios.fecha !== undefined) r.fecha = cambios.fecha;
  if (r.tipo === "unica") delete r.dia;
  else delete r.fecha;
  save();
  return r;
}

function removeReminder(id) {
  const antes = datos().reminders.length;
  datos().reminders = datos().reminders.filter((r) => r.id !== id);
  if (datos().reminders.length !== antes) save();
}

// ---------- Notificación diaria de las 8am ----------
// El scheduler (bot.js) pregunta si toca avisar: solo una vez por día, a
// partir de las 8am hora Perú, y solo si hay algo pendiente.
function necesitaNotificar() {
  if (horaPeru() < 8) return null;
  const hoy = fechaLabelPeru();
  if (datos().lastNotifiedLabel === hoy) return null;
  const pendientes = getPendientes();
  if (pendientes.length === 0) return null;
  return pendientes;
}

function registrarNotificacion() {
  datos().lastNotifiedLabel = fechaLabelPeru();
  save();
}

// Cuántas veces cae un día de la semana (0=domingo...6=sábado) dentro de
// un mes dado.
function ocurrenciasDiaSemanaEnMes(y, mo, diaSemana) {
  const total = diasEnMes(y, mo);
  let veces = 0;
  for (let d = 1; d <= total; d++) {
    if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === diaSemana) veces++;
  }
  return veces;
}

// Compromisos fijos del mes en curso: suma todas las ocurrencias de cada
// recordatorio ACTIVO que caen dentro del mes (un semanal puede caer 4 o
// 5 veces; uno mensual, una sola vez), sin importar si ya se marcaron
// como pagados o no — es el total que hay que cubrir en el mes completo.
function getComprisosDelMes() {
  const hoy = fechaLabelPeru();
  const [y, mo] = hoy.split("-").map(Number);
  const detalle = [];

  datos().reminders.forEach((r) => {
    if (r.activo === false) return;
    let veces = 0;
    if (r.tipo === "semanal") {
      veces = ocurrenciasDiaSemanaEnMes(y, mo, r.dia);
    } else if (r.tipo === "mensual_dia" || r.tipo === "mensual_finmes") {
      veces = 1;
    } else if (r.tipo === "unica") {
      veces = r.fecha && r.fecha.slice(0, 7) === hoy.slice(0, 7) ? 1 : 0;
    }
    if (veces > 0) {
      detalle.push({ id: r.id, label: r.label, monto: r.monto, veces, subtotal: r.monto * veces });
    }
  });

  const total = detalle.reduce((sum, d) => sum + d.subtotal, 0);
  return { total, detalle };
}

// Lista genérica de pagos pendientes hasta [hoy+dias], solo de
// recordatorios activos y sin contar las que ya se marcaron pagadas
// (lastPaidCycle). Incluye DOS cosas: lo que ya está vencido y sin pagar
// (aunque su fecha sea de antes de hoy — ej. la Junta de la semana
// pasada que no se marcó pagada), más las próximas ocurrencias dentro
// del rango. Antes solo miraba hacia adelante desde hoy, así que un pago
// vencido y sin pagar "desaparecía" de la lista en vez de seguir
// apareciendo como pendiente.
function getPagosEnRango(dias) {
  const hoy = fechaLabelPeru();
  const hasta = addDays(hoy, dias);
  const lista = [];
  const vistos = new Set(); // evita duplicar la misma ocurrencia (id+fecha)

  function agregar(r, fecha) {
    const clave = r.id + "|" + fecha;
    if (vistos.has(clave)) return;
    vistos.add(clave);
    lista.push({ id: r.id, label: r.label, monto: r.monto, fecha });
  }

  datos().reminders.forEach((r) => {
    if (r.activo === false) return;

    // Lo que ya está vencido y sigue sin pagar, sea de hoy o de antes.
    const vencidoSinPagar = estaPendiente(r, hoy);
    if (vencidoSinPagar && vencidoSinPagar <= hasta) agregar(r, vencidoSinPagar);

    if (r.tipo === "unica") {
      if (r.fecha && r.fecha >= hoy && r.fecha <= hasta) agregar(r, r.fecha);
      return;
    }

    // Próximas ocurrencias dentro del rango (sin repetir la ya agregada).
    let cursor = hoy;
    while (cursor <= hasta) {
      let esOcurrencia = false;
      if (r.tipo === "semanal") {
        esOcurrencia = ymdToUtc(cursor).getUTCDay() === r.dia;
      } else if (r.tipo === "mensual_dia") {
        const [y, mo] = cursor.split("-").map(Number);
        esOcurrencia = Number(cursor.split("-")[2]) === Math.min(r.dia, diasEnMes(y, mo));
      } else if (r.tipo === "mensual_finmes") {
        const [y, mo] = cursor.split("-").map(Number);
        esOcurrencia = Number(cursor.split("-")[2]) === diasEnMes(y, mo);
      }
      const yaPagado = esOcurrencia && r.lastPaidCycle && cursor <= r.lastPaidCycle;
      if (esOcurrencia && !yaPagado) agregar(r, cursor);
      cursor = addDays(cursor, 1);
    }
  });

  lista.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return lista;
}

function getPagosSemana() {
  return getPagosEnRango(7);
}

// Solo lo que vence exactamente mañana (no lo vencido/de hoy que arrastra
// getPagosEnRango).
function getPagosManana() {
  const manana = addDays(fechaLabelPeru(), 1);
  return getPagosEnRango(1).filter((p) => p.fecha === manana);
}

function getPagosQuincena() {
  return getPagosEnRango(15);
}

// Lo que falta pagar desde hoy hasta el último día del mes en curso.
function getPagosMesRestante() {
  const hoy = fechaLabelPeru();
  const [y, mo] = hoy.split("-").map(Number);
  const diasRestantes = diasEnMes(y, mo) - Number(hoy.split("-")[2]);
  return getPagosEnRango(diasRestantes);
}

module.exports = {
  getPendientes,
  getAll,
  getById,
  buscarGastoDelPago,
  buscarPendientePorGasto,
  getHistorialPagos,
  marcarPagado,
  desmarcarPagado,
  setActivo,
  addReminder,
  editReminder,
  removeReminder,
  necesitaNotificar,
  registrarNotificacion,
  getComprisosDelMes,
  getPagosEnRango,
  getPagosSemana,
  getPagosManana,
  getPagosQuincena,
  getPagosMesRestante,
};
