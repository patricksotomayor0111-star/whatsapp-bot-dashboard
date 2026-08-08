// Bot de WhatsApp exclusivo para el grupo GANANCIAS: registro de caja
// chica, consultas financieras y los mensajes automáticos de 7am/3am. No
// tiene nada del bot de delivery (keywords, sectores, cotizaciones): ese
// vive en el proyecto separado, vinculado a otro número de WhatsApp.
const baileysLib = require("@whiskeysockets/baileys");
const makeWASocket = baileysLib.makeWASocket || baileysLib.default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileysLib;
const P = require("pino");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const cashbox = require("./cashbox");
const pushSubscriptions = require("./pushSubscriptions");
const reminders = require("./reminders");
const tasks = require("./tasks");
const businessDay = require("./businessDay");
const productionGoals = require("./productionGoals");
const scheduledExpenses = require("./scheduledExpenses");
const debts = require("./debts");
const shortfalls = require("./shortfalls");
const referenceAccounts = require("./referenceAccounts");
const financeGoals = require("./financeGoals");
const budgetCategories = require("./budgetCategories");
const queryIntents = require("./queryIntents");
const { dataPath } = require("./dataDir");

const SESSION_PATH = dataPath("session");

// Quita tildes/acentos ("móvil" -> "movil") para que dé igual si el
// mensaje o la frase configurada los llevan o no.
const COMBINING_MARKS = new RegExp("[̀-ͯ]", "g");
function normalizeText(str) {
  return str.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

const CASHBOX_GROUP_NAME = "GANANCIAS";

// ---------- Registro de caja chica ----------
function parseCashboxLine(rawLine) {
  const text = rawLine.trim();
  if (!text) return null;

  // Plata de Ana en custodia (aparte de la caja): solo si el mensaje dice
  // explícitamente "guardo" además de "ana" (para no chocar con "Ana debe" /
  // "Ana pago", que son deudas, no custodia).
  // "5 Ana guardo" -> Ana me deja plata para guardar.
  // "menos 5 Ana guardo" -> le devuelvo / gasta de lo suyo.
  const norm = normalizeText(text);
  if (/\bana\b/.test(norm) && /\bguardo\b/.test(norm)) {
    const num = text.match(/(\d+(?:\.\d+)?)\s*(mil)?/i);
    if (num) {
      const monto = parseFloat(num[1]) * (num[2] ? 1000 : 1);
      const tipo = /\bmenos\b/.test(norm) ? "ana_gasto" : "ana_guardo";
      return { type: tipo, monto, descripcion: text };
    }
  }

  let m = text.match(/^menos\s+(\d+(?:\.\d+)?)\s*(mil)?\s*(.*)$/i);
  if (m) {
    const monto = parseFloat(m[1]) * (m[2] ? 1000 : 1);
    const resto = m[3].trim();
    const restoNorm = normalizeText(resto);

    // "Menos X Nombre debe": Nombre te debe X (no resta de la caja).
    if (/\bdebe\b/.test(restoNorm)) {
      const persona = resto.replace(/\bdebe\b/i, "").trim();
      if (persona) return { type: "deuda_debe", monto, persona, descripcion: resto };
    }

    // "Menos X falto": diferencia de caja que no cuadró. Sí resta de la
    // caja (como un gasto normal) y además queda en un total aparte.
    if (/\bfalto\b/.test(restoNorm)) {
      return { type: "faltante", monto, descripcion: resto };
    }

    return { type: "gasto", monto, descripcion: resto };
  }

  m = text.match(/^(\d+(?:\.\d+)?)\s*(mil)?\s*(.*)$/i);
  if (m) {
    const monto = parseFloat(m[1]) * (m[2] ? 1000 : 1);
    const descripcion = m[3].trim();
    const descNorm = normalizeText(descripcion);

    // "X Nombre pago": salda la deuda de Nombre (no suma a la caja).
    if (/\bpago\b/.test(descNorm)) {
      const persona = descripcion.replace(/\bpago\b/i, "").trim();
      if (persona) return { type: "deuda_pago", monto, persona, descripcion };
    }

    // "1050 caja" o "1050 caja chica" no es una ganancia: es el conteo
    // físico de la caja (borrón y cuenta nueva, ver cashbox.setCaja).
    if (descNorm === "caja" || descNorm === "caja chica") {
      return { type: "caja", monto, descripcion: descNorm };
    }

    // Cuentas de referencia (Yape/Plin/Sip/Efectivo, configurables desde el
    // panel): solo una nota, no afecta caja ni ganancia.
    const cuenta = referenceAccounts.matchNombre(descNorm);
    if (cuenta) {
      return { type: "referencia", monto, cuenta, descripcion };
    }

    return { type: "ganancia", monto, descripcion };
  }

  return null;
}

// Un mensaje puede traer varios movimientos juntos, uno por línea (ej: "menos
// 5 gasolina" y "10 mister" en líneas separadas del mismo mensaje). Cada
// línea se interpreta por separado; las que no matchean se ignoran.
function parseCashboxMessage(rawText) {
  return rawText
    .split("\n")
    .map((linea) => parseCashboxLine(linea))
    .filter(Boolean);
}

function formatSoles(n) {
  return "S/ " + n.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function capitalizar(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ---------- Consultas por WhatsApp ----------
// Si el mensaje es una pregunta en lenguaje natural (no un movimiento a
// registrar), el bot responde con datos reales en vez de tratarlo como
// ganancia/gasto. Devuelve null si el texto no matchea ninguna consulta
// conocida (y entonces sigue el camino normal de parseCashboxMessage).
// Tanto las frases que disparan cada consulta como el texto de la
// respuesta son editables desde el panel (ver queryIntents.js).
function aplicarPlantilla(texto, vars) {
  return String(texto || "").replace(/\{(\w+)\}/g, (match, key) => (key in vars ? vars[key] : match));
}

// Para consultas "prefijo" (ej. "cuanto debe {persona}"): el mensaje debe
// EMPEZAR con la frase configurada, y lo que sigue es la variable.
function extraerTrasPrefijo(textoLimpio, frase) {
  if (!textoLimpio.startsWith(frase)) return null;
  const resto = textoLimpio.slice(frase.length).trim().replace(/\?+$/, "").trim();
  return resto || null;
}

// Formatea una lista de pagos pendientes (de reminders.getPagos*) para
// mandarla por WhatsApp: un renglón por pago, con su fecha.
function formatearListaPagos(lista) {
  return lista.map((p) => `${p.label} (${p.fecha}): ${formatSoles(p.monto)}`).join("\n");
}

// "¿Voy bien?" no es "cuánto me queda para gastar" (gastar nunca ayuda a
// cumplir una meta de ingreso). Se compara lo que ya se tiene más lo
// proyectado a generar en lo que resta del mes, contra lo que de verdad
// falta pagar (Pendientes reales, no todo el mes) más la meta de ahorro.
// Compartido entre la consulta "gastarHoy" y el mensaje automático de las
// 7am.
function calcularMargenHoy() {
  const hoy = cashbox.getToday();
  const pendientes = reminders.getPendientes();
  const pendientesTotal = pendientes.reduce((sum, p) => sum + p.monto, 0);
  const goals = financeGoals.getGoals();
  const mes = cashbox.getMonthSoFar();
  const { diaActual, diasRestantes } = cashbox.getDiasDelMes();

  const promedioDiario = diaActual > 0 ? (mes.ganancias - mes.gastos) / diaActual : 0;
  const gananciaProyectadaResto = promedioDiario * diasRestantes;
  const recursos = hoy.esperado + gananciaProyectadaResto;
  const necesidad = pendientesTotal + goals.ahorroMensual;
  const margen = recursos - necesidad;
  return { hoy, pendientesTotal, goals, margen };
}

function calcularRespuestaConsulta(intent, variable) {
  const campo = (nombre, fallback) => (intent[nombre] ? intent[nombre] : fallback);

  if (intent.id === "deudaPersona") {
    const deuda = debts.getDeuda(variable);
    if (!deuda || deuda.saldo === 0) {
      return aplicarPlantilla(campo("respuestaVacia", "{persona} no te debe nada. ✅"), { persona: capitalizar(variable) });
    }
    return aplicarPlantilla(intent.respuesta, { persona: deuda.label, monto: formatSoles(deuda.saldo) });
  }

  if (intent.id === "quienDebe") {
    const deudas = debts.getDeudas().filter((d) => d.saldo > 0);
    if (deudas.length === 0) return aplicarPlantilla(campo("respuestaVacia", "Nadie te debe nada ahora mismo. ✅"), {});
    const lista = deudas.map((d) => `${d.label}: ${formatSoles(d.saldo)}`).join("\n");
    return aplicarPlantilla(intent.respuesta, { lista });
  }

  if (intent.id === "gastarCategoria") {
    const cat = budgetCategories
      .getAllCategorias()
      .find((c) => c.tipo === "limite" && (normalizeText(c.label).includes(variable) || c.keywords.some((k) => variable.includes(k))));
    if (!cat) return aplicarPlantilla(campo("respuestaSinCategoria", 'No tengo una categoría configurada como "{categoria}".'), { categoria: variable });
    const resumen = budgetCategories.getResumen(cashbox.getMovimientos(), cashbox.getMesActualLabel());
    const info = resumen.find((r) => r.id === cat.id);
    if (info.limite === null) return aplicarPlantilla(campo("respuestaSinLimite", "{categoria} no tiene límite mensual configurado."), { categoria: cat.label });
    return aplicarPlantilla(intent.respuesta, {
      categoria: cat.label,
      gastado: formatSoles(info.gastado),
      limite: formatSoles(info.limite),
      disponible: formatSoles(info.disponible),
    });
  }

  if (intent.id === "gastarHoy") {
    const { hoy, pendientesTotal, goals, margen } = calcularMargenHoy();
    const lineaAhorro = goals.ahorroMensual > 0 ? ` y tu meta de ahorro (${formatSoles(goals.ahorroMensual)})` : "";

    const vars = {
      caja: formatSoles(hoy.esperado),
      pendientes: formatSoles(pendientesTotal),
      lineaAhorro,
      margen: formatSoles(Math.abs(margen)),
    };
    if (margen >= 0) return aplicarPlantilla(intent.respuesta, vars);
    return aplicarPlantilla(campo("respuestaFaltante", intent.respuesta), vars);
  }

  if (intent.id === "vendiHoy") {
    return aplicarPlantilla(intent.respuesta, { ganancias: formatSoles(cashbox.getToday().ganancias) });
  }

  if (intent.id === "gasteHoy") {
    return aplicarPlantilla(intent.respuesta, { gastos: formatSoles(cashbox.getToday().gastos) });
  }

  if (intent.id === "caja") {
    return aplicarPlantilla(intent.respuesta, { esperado: formatSoles(cashbox.getToday().esperado) });
  }

  if (intent.id === "metaHoy") {
    const metaDiaria = financeGoals.getGoals().diaria;
    if (metaDiaria <= 0) return aplicarPlantilla(campo("respuestaSinMeta", "No tienes una meta diaria configurada."), {});
    const hoy = cashbox.getToday();
    const falta = Math.max(metaDiaria - hoy.ganancias, 0);
    if (falta === 0) {
      return aplicarPlantilla(campo("respuestaCumplida", "¡Ya cumpliste tu meta de hoy! Llevas {ganancias} de {meta}. 🎉"), {
        ganancias: formatSoles(hoy.ganancias),
        meta: formatSoles(metaDiaria),
      });
    }
    return aplicarPlantilla(intent.respuesta, {
      meta: formatSoles(metaDiaria),
      ganancias: formatSoles(hoy.ganancias),
      falta: formatSoles(falta),
    });
  }

  if (intent.id === "resumenDia") {
    const hoy = cashbox.getToday();
    return aplicarPlantilla(intent.respuesta, {
      ganancias: formatSoles(hoy.ganancias),
      gastos: formatSoles(hoy.gastos),
      total: formatSoles(hoy.total),
      esperado: formatSoles(hoy.esperado),
    });
  }

  if (intent.id === "resumenMes") {
    const mes = cashbox.getMonthSoFar();
    const metaMensual = financeGoals.getGoals().mensual;
    let respuesta = aplicarPlantilla(intent.respuesta, {
      ganancias: formatSoles(mes.ganancias),
      gastos: formatSoles(mes.gastos),
      neto: formatSoles(mes.ganancias - mes.gastos),
    });
    if (metaMensual > 0) {
      const falta = Math.max(metaMensual - mes.ganancias, 0);
      respuesta += `\n🎯 Meta: ${formatSoles(metaMensual)} (te faltan ${formatSoles(falta)})`;
    }
    return respuesta;
  }

  if (intent.id === "faltante") {
    return aplicarPlantilla(intent.respuesta, { total: formatSoles(shortfalls.getTotal()) });
  }

  if (intent.id === "pagosSemana" || intent.id === "pagosQuincena" || intent.id === "pagosMes") {
    const lista =
      intent.id === "pagosSemana"
        ? reminders.getPagosSemana()
        : intent.id === "pagosQuincena"
          ? reminders.getPagosQuincena()
          : reminders.getPagosMesRestante();
    if (lista.length === 0) return aplicarPlantilla(campo("respuestaVacia", "No tienes pagos pendientes. ✅"), {});
    const total = lista.reduce((sum, p) => sum + p.monto, 0);
    return aplicarPlantilla(intent.respuesta, { lista: formatearListaPagos(lista), total: formatSoles(total) });
  }

  if (intent.id === "metaProduccionHoy") {
    const progreso = productionGoals.getProgresoHoy();
    if (!progreso) return aplicarPlantilla(campo("respuestaSinMeta", "No tienes una meta de producción configurada para este mes."), {});
    if (progreso.cumplido) {
      return aplicarPlantilla(campo("respuestaCumplida", intent.respuesta), {
        generadoHoy: formatSoles(progreso.generadoHoy),
        metaHoy: formatSoles(progreso.metaHoy),
        excedenteHoy: formatSoles(progreso.excedenteHoy),
      });
    }
    return aplicarPlantilla(intent.respuesta, {
      metaHoy: formatSoles(progreso.metaHoy),
      generadoHoy: formatSoles(progreso.generadoHoy),
      faltaHoy: formatSoles(progreso.faltaHoy),
    });
  }

  if (intent.id === "faltaSemanaProduccion" || intent.id === "faltaQuincenaProduccion") {
    const config = productionGoals.getMeta(cashbox.getMesActualLabel());
    if (!config) return aplicarPlantilla(campo("respuestaSinMeta", "No tienes una meta de producción configurada para este mes."), {});
    const esQuincena = intent.id === "faltaQuincenaProduccion";
    const meta = config.metaDiariaBase * (esQuincena ? 15 : 7);
    const generado = esQuincena ? cashbox.getQuincenaSoFar().ganancias : cashbox.getWeekSoFar().ganancias;
    const falta = Math.max(meta - generado, 0);
    if (falta === 0) {
      return aplicarPlantilla(campo("respuestaCumplida", "¡Ya cumpliste tu meta! Llevas {generado} de {meta}. 🎉"), {
        generado: formatSoles(generado),
        meta: formatSoles(meta),
      });
    }
    return aplicarPlantilla(intent.respuesta, { generado: formatSoles(generado), meta: formatSoles(meta), falta: formatSoles(falta) });
  }

  if (intent.id === "faltaMesProduccion") {
    const progreso = productionGoals.getProgresoHoy();
    if (!progreso) return aplicarPlantilla(campo("respuestaSinMeta", "No tienes una meta de producción configurada para este mes."), {});
    const generado = progreso.generadoAcumulado + progreso.generadoHoy;
    const falta = Math.max(progreso.metaMensualReferencia - generado, 0);
    if (falta === 0) {
      return aplicarPlantilla(campo("respuestaCumplida", "¡Ya cumpliste tu meta de producción del mes! Llevas {generado} de {meta}. 🎉"), {
        generado: formatSoles(generado),
        meta: formatSoles(progreso.metaMensualReferencia),
      });
    }
    return aplicarPlantilla(intent.respuesta, {
      generado: formatSoles(generado),
      meta: formatSoles(progreso.metaMensualReferencia),
      falta: formatSoles(falta),
    });
  }

  if (intent.id === "ahorradoMes") {
    const mes = cashbox.getMonthSoFar();
    return aplicarPlantilla(intent.respuesta, { ahorrado: formatSoles(mes.ganancias - mes.gastos) });
  }

  if (intent.id === "faltaMeta") {
    const cat = budgetCategories
      .getAllCategorias()
      .find((c) => c.tipo === "meta" && (normalizeText(c.label).includes(variable) || c.keywords.some((k) => variable.includes(k))));
    if (cat) {
      const resumen = budgetCategories.getResumen(cashbox.getMovimientos(), cashbox.getMesActualLabel());
      const info = resumen.find((r) => r.id === cat.id);
      return aplicarPlantilla(intent.respuesta, {
        categoria: cat.label,
        pagado: formatSoles(info.pagado),
        meta: formatSoles(info.meta),
        restante: formatSoles(info.restante),
        porcentaje: Math.round(info.porcentaje * 100),
      });
    }
    const rec = reminders.getAll().find((r) => {
      const label = normalizeText(r.label);
      return label.includes(variable) || variable.includes(label);
    });
    if (rec) {
      return aplicarPlantilla(campo("respuestaRecordatorio", "{label}: {monto}, próximo vencimiento {proxima}."), {
        label: rec.label,
        monto: formatSoles(rec.monto),
        proxima: rec.proxima,
      });
    }
    return aplicarPlantilla(campo("respuestaSinCategoria", 'No encontré ninguna meta ni pago configurado como "{categoria}".'), { categoria: variable });
  }

  if (intent.id === "pagosManana") {
    const lista = reminders.getPagosManana();
    if (lista.length === 0) return aplicarPlantilla(campo("respuestaVacia", "No tienes pagos para mañana. ✅"), {});
    const total = lista.reduce((sum, p) => sum + p.monto, 0);
    return aplicarPlantilla(intent.respuesta, { lista: formatearListaPagos(lista), total: formatSoles(total) });
  }

  if (intent.id === "proyeccionMes") {
    const progreso = productionGoals.getProgresoHoy();
    const mes = cashbox.getMonthSoFar();
    const compromisos = reminders.getComprisosDelMes();
    const gastosProgramados = scheduledExpenses.getProyeccionRestoDeMes();
    let respuesta = aplicarPlantilla(intent.respuesta, {
      ganancias: formatSoles(mes.ganancias),
      gastos: formatSoles(mes.gastos),
      compromisos: formatSoles(compromisos.total),
      gastosProgramados: formatSoles(gastosProgramados.total),
    });
    if (progreso) {
      respuesta += `\n🎯 Meta de producción del mes: ${formatSoles(progreso.metaMensualReferencia)} (llevas ${formatSoles(progreso.generadoAcumulado + progreso.generadoHoy)})`;
    }
    return respuesta;
  }

  if (intent.id === "cumplireMetas") {
    const { margen } = calcularMargenHoy();
    if (margen >= 0) return aplicarPlantilla(intent.respuesta, { margen: formatSoles(margen) });
    return aplicarPlantilla(campo("respuestaFaltante", intent.respuesta), { margen: formatSoles(Math.abs(margen)) });
  }

  if (intent.id === "promedioDiario") {
    const mes = cashbox.getMonthSoFar();
    const { diaActual } = cashbox.getDiasDelMes();
    const promedio = diaActual > 0 ? (mes.ganancias - mes.gastos) / diaActual : 0;
    return aplicarPlantilla(intent.respuesta, { promedio: formatSoles(promedio) });
  }

  if (intent.id === "metaDiariaTodasMetas") {
    const goals = financeGoals.getGoals();
    const mes = cashbox.getMonthSoFar();
    const ahorroActual = mes.ganancias - mes.gastos;
    const compromisos = reminders.getComprisosDelMes();
    const necesidadTotal = compromisos.total + goals.ahorroMensual;
    const necesidadFaltante = Math.max(necesidadTotal - ahorroActual, 0);
    const { diasRestantes } = cashbox.getDiasDelMes();
    const metaDiariaReal = diasRestantes > 0 ? necesidadFaltante / diasRestantes : necesidadFaltante;
    return aplicarPlantilla(intent.respuesta, {
      metaDiariaReal: formatSoles(metaDiariaReal),
      necesidadFaltante: formatSoles(necesidadFaltante),
    });
  }

  if (intent.id === "gastoMasFuerte") {
    const resumen = budgetCategories.getResumen(cashbox.getMovimientos(), cashbox.getMesActualLabel());
    const conGasto = resumen.filter((r) => r.tipo === "limite" && r.gastado > 0);
    if (conGasto.length === 0) return aplicarPlantilla(campo("respuestaVacia", "Todavía no registraste gastos categorizados este mes."), {});
    const mayor = conGasto.reduce((a, b) => (b.gastado > a.gastado ? b : a));
    return aplicarPlantilla(intent.respuesta, { categoria: mayor.label, monto: formatSoles(mayor.gastado) });
  }

  return null;
}

function responderConsultaFinanciera(rawText) {
  const text = rawText.trim();
  if (!text) return null;
  const norm = normalizeText(text);
  if (!/[a-z]/.test(norm)) return null; // sin letras no puede ser una pregunta
  const textoLimpio = norm.replace(/^¿+/, "").trim();

  for (const intent of queryIntents.getIntents()) {
    if (intent.tipo === "prefijo") {
      for (const frase of intent.frases) {
        const variable = extraerTrasPrefijo(textoLimpio, frase);
        if (variable) return calcularRespuestaConsulta(intent, variable);
      }
    } else if (intent.frases.some((frase) => textoLimpio.includes(frase))) {
      return calcularRespuestaConsulta(intent, null);
    }
  }

  return null;
}

// Registra los movimientos EN SILENCIO (sin responder en el grupo): los
// totales se ven en vivo en el panel. Los únicos mensajes que la caja
// chica manda al grupo son el cierre diario de las 3am, el "buenos días"
// de las 7am y el resumen semanal del domingo.
function handleCashboxEntries(entradas) {
  entradas.forEach((entrada) => {
    if (entrada.type === "gasto") {
      cashbox.addGasto(entrada.monto, entrada.descripcion);
    } else if (entrada.type === "caja") {
      cashbox.setCaja(entrada.monto);
    } else if (entrada.type === "ana_guardo") {
      cashbox.addAnaGuardo(entrada.monto, entrada.descripcion);
    } else if (entrada.type === "ana_gasto") {
      cashbox.addAnaGasto(entrada.monto, entrada.descripcion);
    } else if (entrada.type === "deuda_debe") {
      debts.addDebt(entrada.persona, entrada.monto, entrada.descripcion);
    } else if (entrada.type === "deuda_pago") {
      debts.payDebt(entrada.persona, entrada.monto, entrada.descripcion);
    } else if (entrada.type === "faltante") {
      cashbox.addGasto(entrada.monto, entrada.descripcion);
      shortfalls.addFaltante(entrada.monto, entrada.descripcion);
    } else if (entrada.type === "referencia") {
      referenceAccounts.addEntrada(entrada.cuenta, entrada.monto, entrada.descripcion);
    } else {
      cashbox.addGanancia(entrada.monto, entrada.descripcion);
    }
  });
}

// ---------- Estado y conexión ----------
const botState = {
  connected: false,
  qr: null,
  groups: [],
};

let currentSock = null;

// Dedup por ID de mensaje (sobrevive a reconexiones porque está fuera de
// startBot) + descarte de mensajes viejos que Baileys reentrega al
// reconectar. NO se filtra por "type": los mensajes que escribe el propio
// dueño desde su teléfono no siempre llegan como "notify".
const mensajesProcesados = new Set();
const MAX_MENSAJES_PROCESADOS = 500;
function yaFueProcesado(id) {
  if (!id) return false;
  if (mensajesProcesados.has(id)) return true;
  mensajesProcesados.add(id);
  if (mensajesProcesados.size > MAX_MENSAJES_PROCESADOS) {
    mensajesProcesados.delete(mensajesProcesados.values().next().value);
  }
  return false;
}

const ANTIGUEDAD_MAXIMA_MS = 5 * 60 * 1000; // 5 minutos
function esMensajeViejo(msg) {
  const raw = msg?.messageTimestamp;
  if (raw === undefined || raw === null) return false; // sin fecha: se procesa igual
  // messageTimestamp puede venir como número o como Long ({low, high}).
  const segundos = typeof raw === "number" ? raw : typeof raw.toNumber === "function" ? raw.toNumber() : Number(raw.low ?? raw);
  if (!Number.isFinite(segundos) || segundos <= 0) return false;
  return Date.now() - segundos * 1000 > ANTIGUEDAD_MAXIMA_MS;
}

// Manda un mensaje y deja anotado su ID como "ya procesado", para que
// cuando WhatsApp lo devuelva por messages.upsert el bot no lo lea como
// si fuera un mensaje entrante. CRÍTICO acá: el bot escucha también los
// mensajes propios (fromMe) porque el dueño registra la caja desde su
// teléfono con la misma cuenta — sin esta marca, una respuesta que
// contenga una frase de consulta se dispara a sí misma sin parar.
async function enviarMensaje(sock, chatId, contenido, opciones) {
  if (contenido?.text) recordarTextoEnviado(contenido.text);
  const enviado = await sock.sendMessage(chatId, contenido, opciones);
  const idEnviado = enviado?.key?.id;
  if (idEnviado) yaFueProcesado(idEnviado);
  return enviado;
}

// Segunda barrera contra el bucle, por si algún envío no devolviera su ID.
const textosEnviados = new Set();
const MAX_TEXTOS_ENVIADOS = 50;
function recordarTextoEnviado(texto) {
  const clave = normalizeText(String(texto || "")).trim();
  if (!clave) return;
  textosEnviados.add(clave);
  if (textosEnviados.size > MAX_TEXTOS_ENVIADOS) {
    textosEnviados.delete(textosEnviados.values().next().value);
  }
}
function esEcoDelBot(texto) {
  const clave = normalizeText(String(texto || "")).trim();
  return Boolean(clave) && textosEnviados.has(clave);
}

// Espera creciente para reintentar si falla la carga de grupos (ej. un
// "rate-overlimit" temporal de WhatsApp por reconectar varias veces
// seguidas): 30s, 1min, 2min. Si para entonces sigue fallando, se deja así
// hasta que se cumpla el "enfriamiento" de abajo. groups.upsert/update
// también disparan esto, así que hace falta el guard: no arrancar una
// cascada nueva si ya hay una en curso, ni tampoco recién fracasó una.
const REINTENTO_GRUPOS_MS = [30000, 60000, 120000];
let refreshEnCurso = false;
let ultimoFalloTs = 0;
const ENFRIAMIENTO_TRAS_FALLO_MS = 5 * 60 * 1000; // 5 minutos

async function refreshGroups(sock, intento = 0) {
  if (intento === 0) {
    if (refreshEnCurso) return;
    if (Date.now() - ultimoFalloTs < ENFRIAMIENTO_TRAS_FALLO_MS) return;
    refreshEnCurso = true;
  }

  try {
    const groupsMap = await sock.groupFetchAllParticipating();
    botState.groups = Object.values(groupsMap).map((g) => ({ id: g.id, name: g.subject || "(sin nombre)" }));
    refreshEnCurso = false;
  } catch (err) {
    console.error("No se pudo obtener la lista de grupos:", err.message);
    if (intento < REINTENTO_GRUPOS_MS.length) {
      const esperaMs = REINTENTO_GRUPOS_MS[intento];
      setTimeout(() => {
        if (sock === currentSock) refreshGroups(sock, intento + 1);
      }, esperaMs);
    } else {
      refreshEnCurso = false;
      ultimoFalloTs = Date.now();
    }
  }
}

// Revisa cada cierto tiempo si ya son las 3:00am hora Perú (fin del día
// laboral, que va de 7am a 7am) para cerrar el día (y, si el día laboral
// que cierra fue domingo, también la semana). Guarda qué día ya cerró para
// no mandar el mensaje dos veces si esta función corre más de una vez
// dentro del mismo minuto.
async function checkCashboxSchedule() {
  if (!currentSock || !botState.connected) return;

  const now = businessDay.peruAhora();
  if (now.getHours() !== 3 || now.getMinutes() !== 0) return;

  // A las 3am, businessDayLabel() ya resuelve al día laboral que se está
  // cerrando (el que empezó ayer a las 7am), no al calendario de hoy.
  const hoyLabel = businessDay.businessDayLabel();
  if (cashbox.getLastClosedDay() === hoyLabel) return;

  const grupo = botState.groups.find((g) => g.name.trim().toUpperCase() === CASHBOX_GROUP_NAME);
  if (!grupo) return;

  // La meta de producción que estuvo vigente el día que se está cerrando
  // se calcula ANTES de cerrar (closeDay agrega el cierre de hoy, lo que
  // recalcularía la meta para el día siguiente en vez de la de hoy).
  const mesQueCierra = hoyLabel.slice(0, 7);
  const progresoAntes = productionGoals.getProgresoMes(mesQueCierra);

  const resumenDia = cashbox.closeDay(hoyLabel);

  // La meta del día siguiente ya sale recalculada con el cierre de hoy
  // incluido; puede caer en otro mes (ej. cerrar el 31 y empezar el 1).
  const mesSiguiente = businessDay.addDays(hoyLabel, 1).slice(0, 7);
  const progresoSiguiente = productionGoals.getProgresoMes(mesSiguiente);

  let textoDia =
    `📦 Caja chica del día\n\n` +
    `✅ Ganancias: ${formatSoles(resumenDia.ganancias)}\n` +
    `📉 Gastos: ${formatSoles(resumenDia.gastos)}\n` +
    `💰 Total líquido: ${formatSoles(resumenDia.total)}\n` +
    `🧮 Caja inicial: ${formatSoles(resumenDia.caja)}\n` +
    `💵 Efectivo esperado: ${formatSoles(resumenDia.esperado)}`;

  if (progresoAntes) {
    const cumplioMeta = resumenDia.ganancias >= progresoAntes.metaHoy;
    textoDia +=
      `\n\n🎯 Meta de producción de hoy: ${formatSoles(progresoAntes.metaHoy)} — ${cumplioMeta ? "cumplida ✅" : "no cumplida ⚠️"}\n` +
      `📈 Vas en ${formatSoles(progresoAntes.generadoAcumulado + resumenDia.ganancias)} de ${formatSoles(progresoAntes.metaMensualReferencia)} este mes.`;
  }
  if (progresoSiguiente) {
    textoDia += `\n🌅 Meta de mañana: ${formatSoles(progresoSiguiente.metaHoy)}`;
  }

  try {
    await enviarMensaje(currentSock, grupo.id, { text: textoDia });
  } catch (err) {
    console.error("Error al mandar el cierre diario de caja chica:", err.message);
  }

  // Si hay meta diaria configurada y no se cumplió, avisa por notificación
  // push (aparte del mensaje de WhatsApp de arriba).
  const metaDiaria = financeGoals.getGoals().diaria;
  if (metaDiaria > 0 && resumenDia.ganancias < metaDiaria) {
    pushSubscriptions
      .notifyAll({
        title: "📉 No llegaste a la meta de hoy",
        body: `Ganaste ${formatSoles(resumenDia.ganancias)} de tu meta de ${formatSoles(metaDiaria)}.`,
      })
      .catch((err) => console.error("Error al notificar meta diaria no cumplida:", err.message));
  }

  // Domingo = 0. Se revisa el día de la semana del día laboral que se
  // está cerrando (hoyLabel), no el del momento actual (3am ya es lunes).
  // Además del cierre diario, manda el resumen semanal.
  if (businessDay.ymdToUtc(hoyLabel).getUTCDay() === 0 && cashbox.getLastClosedWeek() !== hoyLabel) {
    const resumenSemana = cashbox.closeWeek(hoyLabel);
    const textoSemana =
      `🗓️ Resumen semanal\n\n` +
      `✅ Total ganancias de la semana: ${formatSoles(resumenSemana.ganancias)}\n` +
      `📉 Total gastos de la semana: ${formatSoles(resumenSemana.gastos)}`;
    try {
      await enviarMensaje(currentSock, grupo.id, { text: textoSemana });
    } catch (err) {
      console.error("Error al mandar el resumen semanal de caja chica:", err.message);
    }
  }
}

let lastMorningMessageLabel = null;

// Revisa cada cierto tiempo si ya son las 7:00am hora Perú (inicio del día
// laboral) para mandar el mensaje de "buenos días": la meta de producción
// de hoy, cuánto falta para completar el mes, cuánto conviene ahorrar hoy
// y cuánto se puede gastar sin afectar los objetivos.
async function checkMorningSchedule() {
  if (!currentSock || !botState.connected) return;

  const now = businessDay.peruAhora();
  if (now.getHours() !== 7 || now.getMinutes() !== 0) return;

  const hoyLabel = businessDay.businessDayLabel();
  if (lastMorningMessageLabel === hoyLabel) return;

  const grupo = botState.groups.find((g) => g.name.trim().toUpperCase() === CASHBOX_GROUP_NAME);
  if (!grupo) return;

  lastMorningMessageLabel = hoyLabel;

  const progreso = productionGoals.getProgresoMes(cashbox.getMesActualLabel());
  const { goals, margen } = calcularMargenHoy();
  const { diasRestantes } = cashbox.getDiasDelMes();
  const mes = cashbox.getMonthSoFar();
  const ahorroActual = mes.ganancias - mes.gastos;
  const ahorroFaltante = Math.max(goals.ahorroMensual - ahorroActual, 0);
  const recomendadoDiario = diasRestantes > 0 ? ahorroFaltante / diasRestantes : ahorroFaltante;

  let texto = `☀️ Buenos días, Patrick.\n\n`;
  if (progreso) {
    const faltaMes = Math.max(progreso.metaMensualReferencia - progreso.generadoAcumulado, 0);
    texto +=
      `🎯 Hoy tu meta de producción es: ${formatSoles(progreso.metaHoy)}\n` +
      `📅 Te faltan ${formatSoles(faltaMes)} para completar la meta del mes.\n`;
  } else {
    texto += `No tienes una meta de producción configurada para este mes.\n`;
  }
  if (goals.ahorroMensual > 0) {
    texto += `💰 Deberías ahorrar hoy: ${formatSoles(recomendadoDiario)}\n`;
  }
  texto +=
    margen >= 0
      ? `✅ Puedes gastar hoy hasta ${formatSoles(margen)} sin afectar tus objetivos.`
      : `⚠️ Todavía no tienes margen para gastar de más: te faltan ${formatSoles(Math.abs(margen))} para cubrir tus compromisos y tu ahorro.`;

  try {
    await enviarMensaje(currentSock, grupo.id, { text: texto });
  } catch (err) {
    console.error("Error al mandar el mensaje de buenos días:", err.message);
  }
}

setInterval(() => {
  checkCashboxSchedule().catch((err) => console.error("Error en checkCashboxSchedule:", err.message));
  checkMorningSchedule().catch((err) => console.error("Error en checkMorningSchedule:", err.message));
}, 30000);

// ---------- Recordatorios de pagos: notificación diaria de las 8am ----------
// Independiente de WhatsApp: cada tanto revisa si hay pagos pendientes y, una
// sola vez por día (a partir de las 8am Perú), manda una notificación push.
// Si el usuario no marca "Ya pagué", al día siguiente a las 8am vuelve a avisar.
function describirDias(dias) {
  if (dias > 1) return `en ${dias} días`;
  if (dias === 1) return "mañana";
  if (dias === 0) return "hoy";
  return "vencido";
}

function chequearRecordatorios() {
  const pendientes = reminders.necesitaNotificar();
  if (!pendientes) return;
  const detalle = pendientes.map((p) => `${p.label} S/ ${p.monto} (${describirDias(p.dias)})`).join(", ");
  pushSubscriptions
    .notifyAll({
      title: "💸 Tenés pagos pendientes",
      body: detalle,
    })
    .then(() => reminders.registrarNotificacion())
    .catch((err) => console.error("Error al notificar recordatorios:", err.message));
}

// Se revisa cada 5 minutos; la lógica interna se asegura de mandar una sola
// notificación por día.
setInterval(chequearRecordatorios, 5 * 60 * 1000);

// ---------- Tareas sueltas: notificación cada 30 minutos ----------
// A diferencia de los pagos de arriba (una vez al día), una tarea sin
// confirmar sigue avisando cada 30 minutos. Se revisa cada 5 minutos; la
// lógica de tasks.necesitanAviso() filtra cuáles ya llevan 30+ min sin avisar.
function chequearTareas() {
  const pendientes = tasks.necesitanAviso();
  if (pendientes.length === 0) return;
  const detalle = pendientes.map((t) => t.texto).join(", ");
  pushSubscriptions
    .notifyAll({
      title: "🗒️ Tienes tareas pendientes",
      body: detalle,
    })
    .then(() => tasks.registrarAviso(pendientes.map((t) => t.id)))
    .catch((err) => console.error("Error al notificar tareas:", err.message));
}

setInterval(chequearTareas, 5 * 60 * 1000);

function extractText(msg) {
  // Si el chat tiene mensajes que desaparecen (o es "ver una vez"), el texto
  // real viene envuelto adentro y no directo en msg.message.
  const m =
    msg.message.ephemeralMessage?.message ||
    msg.message.viewOnceMessage?.message ||
    msg.message.viewOnceMessageV2?.message ||
    msg.message;

  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || "";
}

async function logoutBot() {
  if (!currentSock) return;
  try {
    await currentSock.logout();
  } catch (err) {
    console.error("Error al cerrar sesión:", err.message);
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
  });

  currentSock = sock;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      botState.qr = qr;
      console.log("\nEscanea este código QR con WhatsApp (Dispositivos vinculados):\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      botState.connected = false;
      botState.groups = [];
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log("Conexión cerrada. Reconectando...");
        startBot().catch((err) => console.error("Error al reconectar:", err));
      } else {
        console.log("Sesión cerrada. Generando un nuevo QR para vincular...");
        fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        startBot().catch((err) => console.error("Error al reiniciar tras cerrar sesión:", err));
      }
    } else if (connection === "open") {
      botState.connected = true;
      botState.qr = null;
      console.log("Bot de FINANZAS conectado a WhatsApp correctamente.");
      refreshGroups(sock);
    }
  });

  // Mantiene la lista de grupos al día si se crean, editan o el bot se une/sale de uno.
  sock.ev.on("groups.upsert", () => refreshGroups(sock));
  sock.ev.on("groups.update", () => refreshGroups(sock));

  // Solo escucha el grupo GANANCIAS: registro de caja chica y consultas
  // financieras. Todo lo demás (otros grupos, cotizaciones, keywords) no
  // existe en este bot — vive en el proyecto de delivery, aparte.
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (!msg?.message) continue;
      // Dos protecciones contra responder dos veces lo mismo tras una
      // reconexión: no procesar un ID ya visto, y descartar lo que sea
      // historial viejo. NO se filtra por "type" porque los mensajes que
      // escribe el propio dueño (los de la caja chica) no siempre llegan
      // como "notify".
      if (yaFueProcesado(msg.key.id)) continue;
      if (esMensajeViejo(msg)) continue;

      const chatId = msg.key.remoteJid;
      const grupoActual = botState.groups.find((g) => g.id === chatId);
      if (!grupoActual || grupoActual.name.trim().toUpperCase() !== CASHBOX_GROUP_NAME) continue;

      const rawText = extractText(msg).trim();
      if (esEcoDelBot(rawText)) continue; // es una respuesta que mandó el propio bot

      const respuestaConsulta = responderConsultaFinanciera(rawText);
      if (respuestaConsulta) {
        try {
          await enviarMensaje(sock, chatId, { text: respuestaConsulta });
        } catch (err) {
          console.error("Error al responder consulta financiera:", err.message);
        }
        continue;
      }

      const entradas = parseCashboxMessage(rawText);
      if (entradas.length > 0) {
        handleCashboxEntries(entradas);
      }
    }
  });

  return sock;
}

// El servidor (server.js) necesita mandar mensajes desde afuera del
// listener (ej. desde una ruta de administración), así que se expone una
// función que siempre devuelve el socket actual (no un valor fijo, porque
// currentSock cambia cuando el bot reconecta).
function getSock() {
  return currentSock;
}

module.exports = { startBot, botState, logoutBot, getSock };
