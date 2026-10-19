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
    const reminders = Array.isArray(parsed.reminders)
      ? parsed.reminders
      : sembrarSoloAlDueno(SEED.map((r) => ({ ...r, activo: true, lastPaidCycle: null })));
    // Repara los pagos a los que se les cambió el día antes de que existiera
    // alinearCicloPagado (volvían a salir pendientes estando pagados). En los
    // que nunca se editaron no cambia nada.
    reminders.forEach(alinearCicloPagado);
    return {
      reminders,
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

// El pago se guarda con la FECHA del ciclo que se pagó (lastPaidCycle). Si
// después se cambia el día (ej. del 22 al 23), esa fecha queda "atrás" del
// nuevo vencimiento del MISMO mes y el mes ya pagado volvía a salir
// pendiente. Esto mueve el pago a la fecha equivalente del mismo período
// con el calendario nuevo: el mismo mes (pagos mensuales) o el día más
// cercano de esa semana (semanales). Solo lo mueve hacia adelante y dentro
// del mismo período, así que nunca da por pagado un ciclo que no se pagó; y
// en un pago que nunca se editó no cambia nada.
function alinearCicloPagado(r) {
  if (!r || !r.lastPaidCycle || !/^\d{4}-\d{2}-\d{2}$/.test(r.lastPaidCycle)) return false;
  const pagado = r.lastPaidCycle;
  let equivalente = null;
  if (r.tipo === "mensual_dia" || r.tipo === "mensual_finmes") {
    const [y, mo] = pagado.split("-").map(Number);
    const ultimo = diasEnMes(y, mo);
    const dia = r.tipo === "mensual_finmes" ? ultimo : Math.min(Number(r.dia), ultimo);
    if (!Number.isInteger(dia) || dia < 1) return false;
    equivalente = utcToLabel(new Date(Date.UTC(y, mo - 1, dia)));
  } else if (r.tipo === "semanal") {
    const diaSemana = Number(r.dia);
    if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) return false;
    let diff = (diaSemana - ymdToUtc(pagado).getUTCDay() + 7) % 7;
    if (diff > 3) diff -= 7; // el de esa misma semana (el más cercano)
    equivalente = addDays(pagado, diff);
  }
  if (equivalente && equivalente > pagado) {
    r.lastPaidCycle = equivalente;
    return true;
  }
  return false;
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
  // Pasado el final ya no se debe nada: dejar de avisar es el punto de
  // ponerle fecha de término.
  if (r.fechaFin && due > r.fechaFin) return null;
  if (r.lastPaidCycle && r.lastPaidCycle >= due) return null;
  return due;
}

// ¿Este pago ya terminó? Se usa para mostrarlo como terminado en vez de
// como "al día", que haría creer que todavía corre.
function yaTermino(r, hoyLabel) {
  if (!r.fechaFin) return false;
  const proxima = proximaFecha(r, hoyLabel);
  return !proxima || proxima > r.fechaFin;
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
// Primero lo que vence mas pronto, del mas cercano al mas lejano. Los
// desactivados van al final: no hay nada que pagar aunque su fecha caiga
// cerca. Se ordena aca y no en el panel para que cualquiera que pida la
// lista la reciba ya en orden.
function porCercania(a, b) {
  if (a.activo !== b.activo) return a.activo ? -1 : 1;
  const fa = a.vence || a.proxima || "9999-12-31";
  const fb = b.vence || b.proxima || "9999-12-31";
  if (fa !== fb) return fa.localeCompare(fb);
  return String(a.label).localeCompare(String(b.label));
}

function getAll() {
  const hoy = fechaLabelPeru();
  return datos()
    .reminders.map((r) => {
      const due = estaPendiente(r, hoy);
      const prox = proximaFecha(r, hoy);
      const termino = yaTermino(r, hoy);
      // Lo próximo que de verdad falta pagar: si se adelantaron cuotas, la
      // "próxima" ya no es la fecha que viene sino la primera sin pagar.
      const porPagar = ciclosPorPagar(r, hoy, MAX_CUOTAS_ADELANTO);
      const adelantado = r.tipo !== "unica" && r.lastPaidCycle && prox && r.lastPaidCycle >= prox;
      const finDeMes = hoy.slice(0, 7) + "-" + String(diasEnMes(...hoy.split("-").slice(0, 2).map(Number))).padStart(2, "0");
      const ultimo = ultimoLote(r.id);
      return {
        id: r.id,
        label: r.label,
        monto: r.monto,
        tipo: r.tipo,
        dia: r.dia ?? null,
        fecha: r.fecha ?? null,
        fechaFin: r.fechaFin ?? null,
        activo: r.activo !== false,
        pendiente: !!due,
        vence: due || null,
        // Pasado el final no hay próxima: el pago se acabó.
        proxima: termino ? null : adelantado ? porPagar[0] || null : prox,
        termino,
        // Hasta qué fecha está pagado por adelantado (null si no se adelantó).
        pagadoHasta: adelantado ? r.lastPaidCycle : null,
        // Las cuotas que se pueden adelantar, y cuántas caen en este mes.
        siguientes: porPagar,
        hastaFinDeMes: porPagar.filter((f) => f <= finDeMes).length,
        // El último pago marcado, para poder decir qué se deshace.
        ultimoPago: ultimo ? { fecha: ultimo.fecha, cuotas: ultimo.cuotas, monto: ultimo.monto, hasta: ultimo.hasta } : null,
      };
    })
    .sort(porCercania);
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

// Cuanto se parece la descripcion de un gasto al nombre de un pendiente.
// Por PALABRA COMPLETA, no por pedazo: antes se usaba includes() sobre el
// texto entero, asi que "Ana pasaje" pasaba por "Compartimos banco Ana"
// solo por compartir la palabra "ana", y "mia colegio sip" pasaba por
// "Sip credito".
function coincidenciaConPendiente(label, descripcion) {
  const claves = palabrasClaveDe(label);
  const palabras = normalizeText(descripcion).split(/[^a-z0-9]+/).filter(Boolean);
  const encontradas = claves.filter((k) => palabras.includes(k));
  return { claves, encontradas, todas: claves.length > 0 && encontradas.length === claves.length };
}

// Margen para los recibos que varian un poco mes a mes.
function montoParecido(a, b) {
  if (!(b > 0)) return false;
  return Math.abs(a - b) <= Math.max(1, b * 0.15);
}

// Cuántos días hacia atrás tiene sentido buscar, según cada cuánto se paga.
const DIAS_VENTANA = { semanal: 7, mensual_dia: 31, mensual_finmes: 31, unica: 31 };

// Busca en los movimientos de la caja un gasto que corresponda a este pago
// dentro de su ciclo (la semana o el mes en curso). Devuelve el movimiento
// encontrado, o null si no está registrado.
// El vencimiento del ciclo ANTERIOR a este. Sirve para no mirar mas atras
// de lo que corresponde: lo que se pago el mes pasado no puede contar
// como el pago de este mes.
function ocurrenciaAnterior(r, dueLabel) {
  if (!dueLabel) return null;
  if (r.tipo === "semanal") return addDays(dueLabel, -7);

  const [y, mo] = dueLabel.split("-").map(Number);
  const prevMo = mo === 1 ? 12 : mo - 1;
  const prevY = mo === 1 ? y - 1 : y;

  if (r.tipo === "mensual_dia") {
    const dia = Math.min(r.dia, diasEnMes(prevY, prevMo));
    return utcToLabel(new Date(Date.UTC(prevY, prevMo - 1, dia)));
  }
  if (r.tipo === "mensual_finmes") {
    return utcToLabel(new Date(Date.UTC(prevY, prevMo - 1, diasEnMes(prevY, prevMo))));
  }
  return null; // "unica" no se repite: no hay ciclo anterior
}

function buscarGastoDelPago(id, movimientos, montoPagado) {
  const r = getById(id);
  if (!r) return null;
  const hoy = fechaLabelPeru();
  const due = ultimaVentanaAbierta(r, hoy) || hoy;

  // La ventana cubre SOLO el ciclo en curso. Antes miraba 31 dias hacia
  // atras desde el vencimiento, lo que se metia de lleno en el ciclo
  // anterior: el gasto del mes pasado se tomaba como el de este, el boton
  // "Ya pagué" concluia que ya estaba registrado y no anotaba nada.
  const anterior = ocurrenciaAnterior(r, due);
  let desde = anterior ? addDays(anterior, 1) : addDays(due, -(DIAS_VENTANA[r.tipo] || 31));
  // Y si ya marco pagado un ciclo, todo lo de antes ya quedo saldado.
  if (r.lastPaidCycle && r.lastPaidCycle >= desde) desde = addDays(r.lastPaidCycle, 1);

  // Corte por el DIA EN QUE MARCO el ultimo pago, no por el vencimiento
  // de ese ciclo. Si pago la junta del lunes recien el miercoles, ese
  // gasto del miercoles caia dentro de la semana siguiente y tapaba el
  // pago nuevo: el boton decia "ya estaba registrado" y no anotaba nada.
  const ultimoPago = datos()
    .pagosMarcados.filter((p) => p.id === id && p.fecha)
    .reduce((a, p) => (!a || p.fecha > a.fecha ? p : a), null);
  if (ultimoPago && ultimoPago.fecha >= desde) desde = addDays(ultimoPago.fecha, 1);

  // Contra lo que dice que pago, no contra el monto configurado: algunos
  // recibos cambian mes a mes.
  const referencia = Number(montoPagado) > 0 ? Number(montoPagado) : r.monto;

  return (
    movimientos.find((m) => {
      if (m.tipo !== "gasto") return false;
      if (m.fecha < desde || m.fecha > hoy) return false;
      const { encontradas, todas } = coincidenciaConPendiente(r.label, m.descripcion);
      if (!encontradas.length) return false;
      // Si aparece el nombre entero alcanza, aunque el monto no cuadre.
      if (todas) return true;
      // Si solo aparece parte del nombre, el monto tiene que respaldarlo.
      return montoParecido(m.monto, referencia);
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
    const { encontradas, todas } = coincidenciaConPendiente(r.label, descripcion);
    if (!encontradas.length) continue;
    // Mismo criterio que al reves: con parte del nombre hace falta que el
    // monto acompane, para no dar por pagado un pendiente que no toca.
    if (!todas && !montoParecido(montoNum, r.monto)) continue;
    if (r.monto > 0 && montoNum < r.monto * FRACCION_MONTO_MINIMA) continue;
    const vence = cicloMarcable(r, hoy);
    if (vence) return { reminder: r, vence };
  }
  return null;
}

// Vuelve a dejar un pago como no pagado (por si se marcó por error). Ojo:
// solo reabre el aviso; el gasto que haya quedado en la caja se corrige
// aparte desde Movimientos.
// Deshace el ÚLTIMO pago marcado (con todas sus cuotas, si fue adelantado):
// vuelve el pendiente a como estaba antes y, si ese pago había descontado de
// un préstamo, lo devuelve. Los pagos viejos (de antes de guardar el "antes")
// se deshacen como siempre: el pendiente vuelve a quedar sin pagar.
function desmarcarPagado(id) {
  const r = datos().reminders.find((x) => x.id === id);
  if (!r) throw new Error("Recordatorio inexistente: " + id);
  const ultimo = ultimoLote(id);
  const primero = ultimo ? datos().pagosMarcados.find((p) => p.lote === ultimo.lote && p.antes) : null;
  if (primero) {
    r.lastPaidCycle = primero.antes.lastPaidCycle;
    r.activo = primero.antes.activo;
    if (primero.prestamo) {
      try {
        require("./prestamos").quitarPago(primero.prestamo.id, primero.prestamo.pagoId);
      } catch (err) {
        console.error("No se pudo devolver el pago al préstamo:", err.message);
      }
    }
    datos().pagosMarcados = datos().pagosMarcados.filter((p) => p.lote !== ultimo.lote);
  } else {
    r.lastPaidCycle = null;
    if (r.tipo === "unica") r.activo = true;
  }
  save();
  return r;
}

const MAX_PAGOS_MARCADOS = 100;

// ---------- Pagar por adelantado ----------
// Las próximas cuotas que faltan pagar, en orden: la que está abierta (vencida
// o que vence mañana) si no se pagó, y después las que vienen. Nunca más allá
// del final del pago (fechaFin). Un pago de una sola vez tiene una sola.
const MAX_CUOTAS_ADELANTO = 12;

function ciclosPorPagar(r, hoy, n) {
  if (!r || r.activo === false) return [];
  if (r.tipo === "unica") return r.fecha ? [r.fecha] : [];
  const lista = [];
  let cursor = estaPendiente(r, hoy);
  if (!cursor) {
    let desde = hoy;
    if (r.lastPaidCycle && r.lastPaidCycle >= desde) desde = addDays(r.lastPaidCycle, 1);
    cursor = proximaFecha(r, desde);
  }
  let vueltas = 0; // tope de seguridad: nunca un bucle sin fin
  while (cursor && lista.length < n && vueltas < 400) {
    vueltas++;
    if (r.fechaFin && cursor > r.fechaFin) break;
    if (!(r.lastPaidCycle && r.lastPaidCycle >= cursor)) lista.push(cursor);
    cursor = proximaFecha(r, addDays(cursor, 1));
  }
  return lista;
}

let contadorLote = 0;
function nuevoLote() {
  contadorLote += 1;
  return "lot_" + Date.now().toString(36) + "_" + contadorLote;
}

// Anota en el historial un pago de una o varias cuotas. Todas las cuotas de
// un mismo pago comparten "lote", y la primera guarda cómo estaba antes, para
// que "Deshacer" vuelva exactamente a eso.
function anotarLote(r, ciclos, total, info, antes) {
  const hoy = fechaLabelPeru();
  const hora = horaLabel(peruAhora());
  const porCuota = Math.round((total / ciclos.length) * 100) / 100;
  const lote = nuevoLote();

  // Si este pendiente está pagando un préstamo, su saldo baja solo. Se pide
  // adentro para no armar un require circular al arrancar.
  let prestamo = null;
  if (total > 0) {
    try {
      const hecho = require("./prestamos").registrarPagoPorRecordatorio(r.id, total);
      if (hecho && hecho.prestamoId && hecho.pagoId) prestamo = { id: hecho.prestamoId, pagoId: hecho.pagoId };
    } catch (err) {
      console.error("No se pudo descontar del préstamo:", err.message);
    }
  }

  ciclos.forEach((vence, i) => {
    datos().pagosMarcados.push({
      id: r.id,
      label: r.label,
      vence,
      fecha: hoy,
      hora,
      monto: porCuota,
      registrado: !!info.registrado,
      gastoExistente: info.gastoExistente || null,
      origen: info.origen === "grupo" ? "grupo" : "panel",
      adelantado: vence > hoy,
      lote,
      cuotasLote: ciclos.length,
      montoLote: Math.round(total * 100) / 100,
      ...(i === 0 ? { antes, prestamo } : {}),
    });
  });
  if (datos().pagosMarcados.length > MAX_PAGOS_MARCADOS) {
    datos().pagosMarcados.splice(0, datos().pagosMarcados.length - MAX_PAGOS_MARCADOS);
  }
  return { lote, total };
}

// Paga de una vez las próximas "cuotas" cuotas (la Junta de 3 martes, o un
// pago único antes de su fecha). Deja el pendiente apagado hasta la cuota
// siguiente. Devuelve qué cuotas cubrió y por cuánto.
function adelantarPagos(id, cuotas, info = {}) {
  const r = datos().reminders.find((x) => x.id === id);
  if (!r) throw new Error("Recordatorio inexistente: " + id);
  const hoy = fechaLabelPeru();
  const n = Math.max(1, Math.min(Math.floor(Number(cuotas) || 1), MAX_CUOTAS_ADELANTO));
  const ciclos = ciclosPorPagar(r, hoy, n);
  if (!ciclos.length) throw new Error("Este pago no tiene cuotas por pagar.");

  const antes = { lastPaidCycle: r.lastPaidCycle || null, activo: r.activo !== false };
  if (r.tipo === "unica") r.activo = false;
  else r.lastPaidCycle = ciclos[ciclos.length - 1];
  const total = Number(info.monto) > 0 ? Number(info.monto) : (Number(r.monto) || 0) * ciclos.length;
  anotarLote(r, ciclos, total, info, antes);
  save();
  return { ciclos, total, siguiente: ciclosPorPagar(r, hoy, 1)[0] || null };
}

// Cuántas cuotas paga un monto: "menos 300 junta" con una Junta de S/ 100
// son 3. Solo si el monto es justo un múltiplo (con un sol de margen); si no,
// es una sola cuota como siempre.
function cuotasQueCubre(r, monto) {
  if (!r || r.tipo === "unica" || !(Number(r.monto) > 0)) return 1;
  const m = Number(monto) || 0;
  const k = Math.round(m / r.monto);
  if (k < 2) return 1;
  if (Math.abs(m - k * r.monto) > Math.max(1, 0.02 * k * r.monto)) return 1;
  return Math.max(1, Math.min(k, ciclosPorPagar(r, fechaLabelPeru(), MAX_CUOTAS_ADELANTO).length));
}

// El último pago marcado de este pendiente (todas sus cuotas juntas).
function ultimoLote(id) {
  const lista = datos().pagosMarcados.filter((p) => p.id === id && p.lote);
  if (!lista.length) return null;
  const lote = lista[lista.length - 1].lote;
  const delLote = lista.filter((p) => p.lote === lote);
  return {
    lote,
    fecha: delLote[0].fecha,
    cuotas: delLote.length,
    monto: delLote[0].montoLote || delLote.reduce((s, p) => s + (p.monto || 0), 0),
    hasta: delLote[delLote.length - 1].vence,
  };
}

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
  const antes = { lastPaidCycle: r.lastPaidCycle || null, activo: r.activo !== false };
  if (r.tipo === "unica") {
    r.activo = false; // pago único: no vuelve a aparecer
  } else if (due) {
    r.lastPaidCycle = due; // recurrente: se apaga hasta el próximo ciclo
  }

  if (info) {
    // Un pago de una cuota es un lote de una: así "Deshacer" funciona igual
    // para los dos.
    anotarLote(r, [due || hoy], Number(info.monto) || 0, info, antes);
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

function addReminder({ label, monto, tipo, dia, fecha, fechaFin }) {
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
  // Hasta cuándo se paga. Vacío = para siempre, como era antes.
  if (fechaFin) nuevo.fechaFin = fechaFin;
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
  // Vacío borra el final: vuelve a repetirse sin término.
  if (cambios.fechaFin !== undefined) {
    if (cambios.fechaFin) r.fechaFin = cambios.fechaFin;
    else delete r.fechaFin;
  }
  if (r.tipo === "unica") delete r.dia;
  else delete r.fecha;
  // Cambiar el día no puede deshacer un pago ya hecho (ver alinearCicloPagado).
  alinearCicloPagado(r);
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
    // Un pago con fecha de término no se proyecta mas alla de ella.
    const tope = r.fechaFin && r.fechaFin < hasta ? r.fechaFin : hasta;

    // Lo que ya está vencido y sigue sin pagar, sea de hoy o de antes.
    const vencidoSinPagar = estaPendiente(r, hoy);
    if (vencidoSinPagar && vencidoSinPagar <= tope) agregar(r, vencidoSinPagar);

    if (r.tipo === "unica") {
      if (r.fecha && r.fecha >= hoy && r.fecha <= tope) agregar(r, r.fecha);
      return;
    }

    // Próximas ocurrencias dentro del rango (sin repetir la ya agregada).
    let cursor = hoy;
    while (cursor <= tope) {
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
  SEED_ORIGINAL: SEED,
  getPendientes,
  getAll,
  getById,
  buscarGastoDelPago,
  buscarPendientePorGasto,
  getHistorialPagos,
  marcarPagado,
  desmarcarPagado,
  adelantarPagos,
  cuotasQueCubre,
  ciclosPorPagar,
  ultimoLote,
  MAX_CUOTAS_ADELANTO,
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
  // Para pruebas.
  _alinearCicloPagado: alinearCicloPagado,
};
