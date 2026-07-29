const express = require("express");
const path = require("path");
const { startBot, botState, logoutBot, getSock, DELIVERY_QUOTE_GROUP_NAMES } = require("./bot");
const sectors = require("./sectors");
const dynamicKeywords = require("./dynamicKeywords");
const numberExceptions = require("./numberExceptions");
const cashbox = require("./cashbox");
const pendingQuotes = require("./pendingQuotes");
const pushSubscriptions = require("./pushSubscriptions");
const budgetCategories = require("./budgetCategories");
const queryIntents = require("./queryIntents");
const reminders = require("./reminders");
const contactTriggerGroups = require("./contactTriggerGroups");
const groupDelays = require("./groupDelays");
const debts = require("./debts");
const shortfalls = require("./shortfalls");
const referenceAccounts = require("./referenceAccounts");
const financeGoals = require("./financeGoals");
const productionGoals = require("./productionGoals");
const ExcelJS = require("exceljs");

const app = express();
app.use(express.json());

// Solo se exponen estos 3 archivos del panel (no todo el proyecto,
// para no dejar accesible el código del bot ni la sesión de WhatsApp)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.get("/styles.css", (req, res) => {
  res.sendFile(path.join(__dirname, "styles.css"));
});
app.get("/script.js", (req, res) => {
  res.sendFile(path.join(__dirname, "script.js"));
});
app.get("/manifest.json", (req, res) => {
  res.sendFile(path.join(__dirname, "manifest.json"));
});
app.get("/sw.js", (req, res) => {
  res.sendFile(path.join(__dirname, "sw.js"));
});
app.get("/icon-192.png", (req, res) => {
  res.sendFile(path.join(__dirname, "icon-192.png"));
});
app.get("/icon-512.png", (req, res) => {
  res.sendFile(path.join(__dirname, "icon-512.png"));
});

// Endpoint minimo para medir la calidad de conexion real del celular/PC
// que tiene el panel abierto (el frontend mide el tiempo de ida y vuelta
// contra este mismo servidor). No hace nada mas que responder rapido.
app.get("/api/ping", (req, res) => {
  res.json({ t: Date.now() });
});

// El dashboard consulta esto para saber si el bot está conectado
// y, si no lo está, obtener el QR para vincular.
app.get("/api/status", (req, res) => {
  res.json({
    connected: botState.connected,
    active: botState.active,
    qr: botState.qr,
    lastActivity: botState.lastActivity,
    groupsCount: botState.groups.length,
    build: "lid-v7", // marcador para verificar desde afuera qué versión del código está corriendo
  });
});

// Lista de grupos reales de WhatsApp (solo disponible una vez conectado),
// con el sector asignado, si está activo individualmente y si está enfocado.
app.get("/api/groups", (req, res) => {
  const focusedGroups = sectors.getFocusedGroups();
  const groups = botState.groups.map((g) => {
    const sectorId = sectors.getGroupSector(g.id);
    return {
      ...g,
      sectorId,
      active: sectors.isGroupActive(g.id),
      focused: focusedGroups.includes(g.id),
      remarcarOverride: sectors.getGroupRemarcarOverride(g.id), // null | "no_remarcar" | "remarcar" (para el select de Opciones)
      sinRemarcarEfectivo: sectors.isGroupSinRemarcarEfectivo(g.id, sectorId), // combina override + sector (para el ícono en la lista)
    };
  });
  res.json({ groups, focusedGroups });
});

// Lista de sectores y su estado ON/OFF (los dos interruptores)
app.get("/api/sectors", (req, res) => {
  res.json({
    sectors: sectors.SECTOR_DEFS,
    sectorActive: sectors.getSectorActiveMap(),
    sectorSinRemarcarActive: sectors.getSectorSinRemarcarActiveMap(),
  });
});

// Enciende o apaga un sector completo, para sus grupos que remarcan normal
// (los grupos siguen "Activos" mostrándose, pero el bot no responde en
// ellos mientras el sector esté apagado)
app.post("/api/sectors/:id/active", (req, res) => {
  try {
    sectors.setSectorActive(req.params.id, req.body.active);
    res.json({ ok: true, active: sectors.isSectorActive(req.params.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Enciende o apaga el interruptor de "sin remarcar" de un sector: aplica
// solo a los grupos de ese sector que responden sin citar el mensaje (por
// Comodín o por override individual), independiente del interruptor de arriba.
app.post("/api/sectors/:id/sinremarcaractive", (req, res) => {
  try {
    sectors.setSectorSinRemarcarActive(req.params.id, req.body.active);
    res.json({ ok: true, active: sectors.isSectorSinRemarcarActive(req.params.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Asigna un grupo a un sector
app.post("/api/groups/:groupId/sector", (req, res) => {
  try {
    sectors.setGroupSector(req.params.groupId, req.body.sectorId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Activa o desactiva un grupo individual (dentro de un sector que sigue ON)
app.post("/api/groups/:groupId/active", (req, res) => {
  sectors.setGroupActive(req.params.groupId, req.body.active);
  res.json({ ok: true, active: sectors.isGroupActive(req.params.groupId) });
});

// Fuerza un grupo puntual a "no_remarcar" (responde sin citar) o "remarcar"
// (responde citando), sin importar su sector. body.override puede ser
// "no_remarcar", "remarcar" o null/"" para volver a heredar del sector.
app.post("/api/groups/:groupId/remarcar", (req, res) => {
  try {
    sectors.setGroupRemarcarOverride(req.params.groupId, req.body.override);
    res.json({ ok: true, override: sectors.getGroupRemarcarOverride(req.params.groupId) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Restaura el modo enfoque: vuelve al comportamiento normal por sector/grupo.
// OJO: esta ruta debe ir ANTES que "/api/focus/:groupId", si no Express
// interpreta "clear" como si fuera un groupId (por eso el bug de antes).
app.post("/api/focus/clear", (req, res) => {
  sectors.clearFocus();
  res.json({ ok: true });
});

// Enfoca/desenfoca de una todos los grupos de un sector (toggle: si ya
// estaban todos enfocados, los saca a todos; si no, los enfoca a todos).
// Al ser un path con 2 segmentos no choca con "/api/focus/:groupId" de abajo.
app.post("/api/focus/sector/:sectorId", (req, res) => {
  const sectorId = req.params.sectorId;
  const groupIds = botState.groups.filter((g) => sectors.getGroupSector(g.id) === sectorId).map((g) => g.id);
  const focusedAhora = sectors.getFocusedGroups();
  const todosEnfocados = groupIds.length > 0 && groupIds.every((id) => focusedAhora.includes(id));
  if (todosEnfocados) {
    groupIds.forEach((id) => sectors.removeFocusGroup(id));
  } else {
    groupIds.forEach((id) => sectors.addFocusGroup(id));
  }
  res.json({ ok: true, focusedGroups: sectors.getFocusedGroups() });
});

// Modo enfoque: el mismo botón 🎯 agrega o quita el grupo de la lista de
// enfocados (un toque enfoca, otro toque lo saca; si era el último, el
// modo enfoque se apaga solo).
app.post("/api/focus/:groupId", (req, res) => {
  const groupId = req.params.groupId;
  if (sectors.getFocusedGroups().includes(groupId)) {
    sectors.removeFocusGroup(groupId);
  } else {
    sectors.addFocusGroup(groupId);
  }
  res.json({ ok: true, focusedGroups: sectors.getFocusedGroups() });
});

// Pausa o reanuda las respuestas automáticas sin desconectar WhatsApp
app.post("/api/bot/active", (req, res) => {
  botState.active = Boolean(req.body.active);
  res.json({ active: botState.active });
});

// Cierra la sesión de WhatsApp vinculada, para volver a mostrar un QR nuevo
app.post("/api/bot/logout", async (req, res) => {
  await logoutBot();
  res.json({ ok: true });
});

// Historial de respuestas del bot (para la sección "Historial" del panel)
app.get("/api/history", (req, res) => {
  res.json({ history: botState.history });
});

// Diagnóstico temporal: últimos remitentes detectados por grupo, para
// verificar por qué un número excluido sí/no fue bloqueado en cierto grupo.
app.get("/api/debug/senders", (req, res) => {
  res.json({ recentSenders: botState.recentSenders });
});

// Delay de respuesta configurable (100ms a 1000ms)
app.get("/api/config/delay", (req, res) => {
  res.json({ delayMs: sectors.getResponseDelay() });
});

app.post("/api/config/delay", (req, res) => {
  try {
    sectors.setResponseDelay(req.body.delayMs);
    res.json({ ok: true, delayMs: sectors.getResponseDelay() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Ventana de tiempo (0 a N minutos) configurable para el filtro de horarios
app.get("/api/config/timewindow", (req, res) => {
  res.json({ minutes: sectors.getTimeWindowMinutes() });
});

app.post("/api/config/timewindow", (req, res) => {
  try {
    sectors.setTimeWindowMinutes(req.body.minutes);
    res.json({ ok: true, minutes: sectors.getTimeWindowMinutes() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Keywords agregadas desde el panel (además de las de keywords.js)
app.get("/api/keywords", (req, res) => {
  res.json({
    positive: dynamicKeywords.getExtraPositive(),
    excluded: dynamicKeywords.getExtraExcluded(),
    specialByGroup: dynamicKeywords.getAllSpecial(),
  });
});

app.post("/api/keywords/positive", (req, res) => {
  try {
    dynamicKeywords.addExtraPositive(req.body.phrase);
    res.json({ ok: true, positive: dynamicKeywords.getExtraPositive() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/keywords/positive/remove", (req, res) => {
  dynamicKeywords.removeExtraPositive(req.body.phrase);
  res.json({ ok: true, positive: dynamicKeywords.getExtraPositive() });
});

app.post("/api/keywords/excluded", (req, res) => {
  try {
    dynamicKeywords.addExtraExcluded(req.body.phrase);
    res.json({ ok: true, excluded: dynamicKeywords.getExtraExcluded() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/keywords/excluded/remove", (req, res) => {
  dynamicKeywords.removeExtraExcluded(req.body.phrase);
  res.json({ ok: true, excluded: dynamicKeywords.getExtraExcluded() });
});

// Keywords especiales de un grupo: si ese grupo recibe un mensaje con esta
// frase, el bot responde sin importar las exclusiones.
app.post("/api/keywords/special/:groupId", (req, res) => {
  try {
    dynamicKeywords.addSpecialForGroup(req.params.groupId, req.body.phrase);
    res.json({ ok: true, special: dynamicKeywords.getSpecialForGroup(req.params.groupId) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/keywords/special/:groupId/remove", (req, res) => {
  dynamicKeywords.removeSpecialForGroup(req.params.groupId, req.body.phrase);
  res.json({ ok: true, special: dynamicKeywords.getSpecialForGroup(req.params.groupId) });
});

// Excepciones número+grupo+frase: un número excluido globalmente puede
// responder en UN grupo puntual si escribe una de estas frases.
app.get("/api/exceptions", (req, res) => {
  res.json({ exceptions: numberExceptions.getAllExceptions() });
});

app.get("/api/exceptions/:groupId/:number", (req, res) => {
  res.json({ list: numberExceptions.getExceptions(req.params.groupId, req.params.number) });
});

app.post("/api/exceptions/:groupId/:number", (req, res) => {
  try {
    numberExceptions.addException(req.params.groupId, req.params.number, req.body.phrase);
    res.json({ ok: true, list: numberExceptions.getExceptions(req.params.groupId, req.params.number) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/exceptions/:groupId/:number/remove", (req, res) => {
  numberExceptions.removeException(req.params.groupId, req.params.number, req.body.phrase);
  res.json({ ok: true, list: numberExceptions.getExceptions(req.params.groupId, req.params.number) });
});

app.post("/api/exceptions/:groupId/:number/toggle", (req, res) => {
  numberExceptions.setExceptionActive(req.params.groupId, req.params.number, req.body.phrase, req.body.active);
  res.json({ ok: true, list: numberExceptions.getExceptions(req.params.groupId, req.params.number) });
});

// Totales del día de la caja chica (grupo "GANANCIAS"): ganancias, gastos
// y total líquido registrados hasta ahora.
app.get("/api/cashbox/today", (req, res) => {
  res.json({ ...cashbox.getToday(), ana: cashbox.getAna() });
});

// Corregir/reconstruir un día completo a mano (para que el Excel cuadre):
// reemplaza los movimientos de esa fecha por la lista enviada y fija la caja.
app.post("/api/cashbox/rebuild-day", (req, res) => {
  try {
    const { fecha, caja, movimientos, resetAna } = req.body || {};
    if (!fecha || !Array.isArray(movimientos)) {
      return res.status(400).json({ error: "Se requieren 'fecha' y 'movimientos' (array)." });
    }
    const resumen = cashbox.rebuildDay(fecha, caja, movimientos, resetAna);
    res.json({ ok: true, resumen });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Asistente financiero: movimientos, deudas, faltantes, cuentas ----------
// Todo lo que ya se registra solo (por WhatsApp, en el grupo GANANCIAS)
// también se puede agregar, editar o eliminar a mano desde el panel.

app.get("/api/finance/movements", (req, res) => {
  const movimientos = cashbox.getMovimientos().map((m, index) => ({ ...m, index }));
  res.json({ movimientos });
});

app.post("/api/finance/movements", (req, res) => {
  try {
    const { tipo, monto, descripcion, fecha, hora } = req.body || {};
    const montoNum = Number(monto);
    if (!["ganancia", "gasto"].includes(tipo) || !Number.isFinite(montoNum) || montoNum <= 0) {
      return res.status(400).json({ error: "Se requiere 'tipo' (ganancia/gasto) y 'monto' válido." });
    }
    cashbox.addMovimientoManual(tipo, montoNum, descripcion, fecha, hora);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/finance/movements/:index", (req, res) => {
  const mov = cashbox.editMovimiento(Number(req.params.index), req.body || {});
  if (!mov) return res.status(404).json({ error: "Movimiento no encontrado." });
  res.json({ ok: true, movimiento: mov });
});

app.delete("/api/finance/movements/:index", (req, res) => {
  const ok = cashbox.removeMovimiento(Number(req.params.index));
  if (!ok) return res.status(404).json({ error: "Movimiento no encontrado." });
  res.json({ ok: true });
});

// Plata de Ana en custodia (aparte de la caja): ver y editar sus movimientos.
app.get("/api/finance/ana/movements", (req, res) => {
  const movimientos = cashbox.getAnaMovimientos().map((m, index) => ({ ...m, index }));
  res.json({ movimientos });
});

app.put("/api/finance/ana/movements/:index", (req, res) => {
  const mov = cashbox.editAnaMovimiento(Number(req.params.index), req.body || {});
  if (!mov) return res.status(404).json({ error: "Movimiento no encontrado." });
  res.json({ ok: true, movimiento: mov });
});

app.delete("/api/finance/ana/movements/:index", (req, res) => {
  const ok = cashbox.removeAnaMovimiento(Number(req.params.index));
  if (!ok) return res.status(404).json({ error: "Movimiento no encontrado." });
  res.json({ ok: true });
});

// Consultas por WhatsApp del grupo GANANCIAS: frases que disparan cada
// respuesta y el texto de la respuesta misma, ambos editables.
app.get("/api/finance/query-intents", (req, res) => {
  res.json({ intents: queryIntents.getIntents() });
});

app.post("/api/finance/query-intents/:id/phrases", (req, res) => {
  try {
    const intent = queryIntents.addFrase(req.params.id, req.body?.frase);
    res.json({ ok: true, intent });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/finance/query-intents/:id/phrases", (req, res) => {
  const intent = queryIntents.removeFrase(req.params.id, req.body?.frase);
  if (!intent) return res.status(404).json({ error: "Consulta no encontrada." });
  res.json({ ok: true, intent });
});

app.put("/api/finance/query-intents/:id/response", (req, res) => {
  try {
    const intent = queryIntents.setRespuesta(req.params.id, req.body?.campo, req.body?.texto);
    res.json({ ok: true, intent });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Meta de producción diaria (por mes): mínimo diario base + días de
// producción aproximados, con redistribución automática del faltante o
// excedente entre los días que quedan.
app.get("/api/finance/production-goals", (req, res) => {
  res.json({ metas: productionGoals.getAllMetas(), hoy: productionGoals.getProgresoHoy() });
});

app.get("/api/finance/production-goals/:mes", (req, res) => {
  const progreso = productionGoals.getProgresoMes(req.params.mes);
  if (!progreso) return res.status(404).json({ error: "No hay meta configurada para ese mes." });
  res.json({ progreso });
});

app.put("/api/finance/production-goals/:mes", (req, res) => {
  try {
    const meta = productionGoals.setMeta(req.params.mes, req.body?.metaDiariaBase, req.body?.diasProduccion);
    res.json({ ok: true, meta });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/finance/production-goals/:mes", (req, res) => {
  const ok = productionGoals.removeMeta(req.params.mes);
  if (!ok) return res.status(404).json({ error: "No hay meta configurada para ese mes." });
  res.json({ ok: true });
});

// Deudas por persona
app.get("/api/finance/debts", (req, res) => {
  res.json({ deudas: debts.getDeudas() });
});

app.post("/api/finance/debts", (req, res) => {
  const { persona, monto, descripcion } = req.body || {};
  const montoNum = Number(monto);
  if (!persona || !Number.isFinite(montoNum) || montoNum <= 0) {
    return res.status(400).json({ error: "Se requiere 'persona' y 'monto' válido." });
  }
  const resultado = debts.addDebt(persona, montoNum, descripcion);
  res.json({ ok: true, deuda: resultado });
});

app.post("/api/finance/debts/pay", (req, res) => {
  const { persona, monto, descripcion } = req.body || {};
  const montoNum = Number(monto);
  if (!persona || !Number.isFinite(montoNum) || montoNum <= 0) {
    return res.status(400).json({ error: "Se requiere 'persona' y 'monto' válido." });
  }
  const resultado = debts.payDebt(persona, montoNum, descripcion);
  res.json({ ok: true, deuda: resultado });
});

app.post("/api/finance/debts/:persona/clear", (req, res) => {
  debts.clearDebt(req.params.persona);
  res.json({ ok: true });
});

app.delete("/api/finance/debts/:persona", (req, res) => {
  debts.removePersona(req.params.persona);
  res.json({ ok: true });
});

app.get("/api/finance/debts/:persona/movements", (req, res) => {
  const movimientos = debts.getMovimientos(req.params.persona).map((m, index) => ({ ...m, index }));
  res.json({ movimientos });
});

app.put("/api/finance/debts/:persona/movements/:index", (req, res) => {
  const resultado = debts.editMovimiento(req.params.persona, Number(req.params.index), req.body || {});
  if (!resultado) return res.status(404).json({ error: "Movimiento no encontrado." });
  res.json({ ok: true, ...resultado });
});

app.delete("/api/finance/debts/:persona/movements/:index", (req, res) => {
  const ok = debts.removeMovimiento(req.params.persona, Number(req.params.index));
  if (!ok) return res.status(404).json({ error: "Movimiento no encontrado." });
  res.json({ ok: true });
});

// Faltantes de caja
app.get("/api/finance/shortfalls", (req, res) => {
  res.json({ total: shortfalls.getTotal(), movimientos: shortfalls.getMovimientos().map((m, index) => ({ ...m, index })) });
});

app.post("/api/finance/shortfalls", (req, res) => {
  const montoNum = Number(req.body?.monto);
  if (!Number.isFinite(montoNum) || montoNum <= 0) {
    return res.status(400).json({ error: "Se requiere 'monto' válido." });
  }
  shortfalls.addFaltante(montoNum, req.body?.descripcion);
  res.json({ ok: true });
});

app.put("/api/finance/shortfalls/:index", (req, res) => {
  const mov = shortfalls.editMovimiento(Number(req.params.index), req.body || {});
  if (!mov) return res.status(404).json({ error: "Movimiento no encontrado." });
  res.json({ ok: true, movimiento: mov });
});

app.delete("/api/finance/shortfalls/:index", (req, res) => {
  const ok = shortfalls.removeMovimiento(Number(req.params.index));
  if (!ok) return res.status(404).json({ error: "Movimiento no encontrado." });
  res.json({ ok: true });
});

// Cuentas de referencia (Yape/Plin/Sip/Efectivo, editable)
app.get("/api/finance/accounts", (req, res) => {
  res.json({ nombres: referenceAccounts.getNombres() });
});

app.post("/api/finance/accounts", (req, res) => {
  referenceAccounts.addNombre(req.body?.nombre);
  res.json({ ok: true, nombres: referenceAccounts.getNombres() });
});

app.delete("/api/finance/accounts/:nombre", (req, res) => {
  referenceAccounts.removeNombre(req.params.nombre);
  res.json({ ok: true, nombres: referenceAccounts.getNombres() });
});

app.get("/api/finance/accounts/entries", (req, res) => {
  const entradas = referenceAccounts.getEntradas().map((e, index) => ({ ...e, index }));
  res.json({ entradas });
});

app.post("/api/finance/accounts/entries", (req, res) => {
  const { cuenta, monto, descripcion } = req.body || {};
  const montoNum = Number(monto);
  if (!cuenta || !Number.isFinite(montoNum) || montoNum <= 0) {
    return res.status(400).json({ error: "Se requiere 'cuenta' y 'monto' válido." });
  }
  referenceAccounts.addEntrada(cuenta, montoNum, descripcion);
  res.json({ ok: true });
});

app.put("/api/finance/accounts/entries/:index", (req, res) => {
  const entrada = referenceAccounts.editEntrada(Number(req.params.index), req.body || {});
  if (!entrada) return res.status(404).json({ error: "Entrada no encontrada." });
  res.json({ ok: true, entrada });
});

app.delete("/api/finance/accounts/entries/:index", (req, res) => {
  referenceAccounts.removeEntrada(Number(req.params.index));
  res.json({ ok: true });
});

// Historial de cierres diarios (ganancias/gastos/efectivo esperado por
// día) más el día en curso, para los gráficos de Finanzas.
app.get("/api/finance/history", (req, res) => {
  res.json({ cierres: cashbox.getCierres(), hoy: { fecha: cashbox.getHoyLabel(), ...cashbox.getToday() } });
});

// Corrige un día ya cerrado (ganancias/gastos/caja inicial); recalcula su
// total/esperado y, si corresponde, la caja inicial del día siguiente.
app.put("/api/finance/cierres/:fecha", (req, res) => {
  const cierre = cashbox.editCierre(req.params.fecha, req.body || {});
  if (!cierre) return res.status(404).json({ error: "Día no encontrado." });
  res.json({ ok: true, cierre });
});

// Metas de ganancia (diaria/semanal/mensual) y de ahorro mensual.
app.get("/api/finance/goals", (req, res) => {
  res.json({ goals: financeGoals.getGoals() });
});

app.post("/api/finance/goals", (req, res) => {
  try {
    financeGoals.setGoal(req.body.tipo, req.body.monto);
    res.json({ ok: true, goals: financeGoals.getGoals() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Progreso de cada meta contra lo ya ganado, cuánto falta, cuánto ahorrar
// por día para llegar a la meta de ahorro, proyección de cierre de mes y
// comparación contra el mes anterior.
app.get("/api/finance/goals/progress", (req, res) => {
  const goals = financeGoals.getGoals();
  const hoy = cashbox.getToday();
  const semana = cashbox.getWeekSoFar();
  const mes = cashbox.getMonthSoFar();
  const mesAnterior = cashbox.getPreviousMonthTotals();
  const { diaActual, diasEnMes, diasRestantes } = cashbox.getDiasDelMes();

  const ahorroActual = mes.ganancias - mes.gastos;
  const ahorroFaltante = Math.max(goals.ahorroMensual - ahorroActual, 0);
  const recomendadoDiario = diasRestantes > 0 ? ahorroFaltante / diasRestantes : ahorroFaltante;

  const promedioDiario = diaActual > 0 ? ahorroActual / diaActual : 0;
  const proyeccionFinDeMes = ahorroActual + promedioDiario * (diasEnMes - diaActual);

  // Meta diaria "real": en vez de un número a ojo, cuánto hay que generar
  // por día para cubrir los compromisos fijos del mes (Pendientes) más el
  // ahorro deseado, restando lo que ya se generó neto este mes.
  const compromisos = reminders.getComprisosDelMes();
  const necesidadTotal = compromisos.total + goals.ahorroMensual;
  const necesidadFaltante = Math.max(necesidadTotal - ahorroActual, 0);
  const metaDiariaReal = diasRestantes > 0 ? necesidadFaltante / diasRestantes : necesidadFaltante;

  res.json({
    goals,
    diaria: { meta: goals.diaria, actual: hoy.ganancias, falta: Math.max(goals.diaria - hoy.ganancias, 0) },
    semanal: { meta: goals.semanal, actual: semana.ganancias, falta: Math.max(goals.semanal - semana.ganancias, 0) },
    mensual: { meta: goals.mensual, actual: mes.ganancias, falta: Math.max(goals.mensual - mes.ganancias, 0) },
    ahorro: {
      meta: goals.ahorroMensual,
      actual: ahorroActual,
      falta: ahorroFaltante,
      diasRestantes,
      recomendadoDiario,
    },
    proyeccion: { finDeMes: proyeccionFinDeMes },
    mesAnterior,
    compromisos: {
      total: compromisos.total,
      detalle: compromisos.detalle,
      necesidadTotal,
      necesidadFaltante,
      metaDiariaReal,
    },
  });
});

// Presupuesto: límites mensuales por categoría y metas de deudas (Junta,
// Caja Cuzco, Universidad), calculados a partir del registro de gastos.
app.get("/api/budget/categories", (req, res) => {
  const mesActual = cashbox.getMesActualLabel();
  res.json({ categorias: budgetCategories.getResumen(cashbox.getMovimientos(), mesActual) });
});

app.post("/api/budget/categories/:id/limit", (req, res) => {
  try {
    budgetCategories.setLimit(req.params.id, req.body.limite);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/budget/categories/:id/meta", (req, res) => {
  try {
    budgetCategories.setMeta(req.params.id, req.body.meta, req.body.saldoInicial);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Agregar, editar (nombre/palabras clave) o eliminar una categoría entera.
app.post("/api/budget/categories", (req, res) => {
  try {
    const categoria = budgetCategories.addCategoria(req.body || {});
    res.json({ ok: true, categoria });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/budget/categories/:id", (req, res) => {
  const categoria = budgetCategories.editCategoria(req.params.id, req.body || {});
  if (!categoria) return res.status(404).json({ error: "Categoría no encontrada." });
  res.json({ ok: true, categoria });
});

app.delete("/api/budget/categories/:id", (req, res) => {
  const ok = budgetCategories.removeCategoria(req.params.id);
  if (!ok) return res.status(404).json({ error: "Categoría no encontrada o no se puede eliminar." });
  res.json({ ok: true });
});

// Recordatorios de pagos (Junta, ARCE, Movistar, Cuzco, Luz, Terreno,
// Universidad y los que agregue el usuario). "pendientes" es lo que va con
// globo rojo en el menú; "all" es la lista completa editable.
app.get("/api/reminders", (req, res) => {
  res.json({ reminders: reminders.getAll(), pendientes: reminders.getPendientes() });
});

app.post("/api/reminders", (req, res) => {
  try {
    const id = reminders.addReminder(req.body || {});
    res.json({ ok: true, id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/reminders/:id/pagado", (req, res) => {
  try {
    reminders.marcarPagado(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/reminders/:id/activo", (req, res) => {
  try {
    reminders.setActivo(req.params.id, req.body.activo);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/reminders/:id", (req, res) => {
  reminders.removeReminder(req.params.id);
  res.json({ ok: true });
});

// Grupos donde el bot responde también si mandan una tarjeta de contacto
// (sin palabra clave). Editable desde el panel: agregar/quitar locales.
app.get("/api/contact-trigger-groups", (req, res) => {
  res.json({ groupNames: contactTriggerGroups.getGroupNames() });
});

app.post("/api/contact-trigger-groups", (req, res) => {
  try {
    contactTriggerGroups.addGroup(req.body.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/contact-trigger-groups/remove", (req, res) => {
  contactTriggerGroups.removeGroup(req.body.name);
  res.json({ ok: true });
});

// Delays personalizados por grupo (100-1000ms, prioridad sobre el delay
// global). Editable desde el panel: agregar/editar/quitar en cualquier momento.
app.get("/api/group-delays", (req, res) => {
  res.json({ delays: groupDelays.getList() });
});

app.post("/api/group-delays", (req, res) => {
  try {
    groupDelays.setDelay(req.body.name, req.body.delayMs);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/group-delays/remove", (req, res) => {
  groupDelays.removeDelay(req.body.name);
  res.json({ ok: true });
});

// Descarga el registro completo de la caja chica (todos los días guardados,
// no solo hoy) como un Excel de verdad (.xlsx): columnas reales, encabezados
// con color, montos "S/ 0.00" (gastos en rojo, ganancias en verde) y dos
// hojas: Movimientos y Resumen por día. Al ser .xlsx no depende de cómo
// cada programa interprete separadores, como pasaba con el CSV.
app.get("/api/cashbox/export", async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const FORMATO_SOLES = '"S/ "#,##0.00';
    const tipoLabel = { ganancia: "Ganancia", gasto: "Gasto", caja: "Conteo de caja" };

    const pintarEncabezado = (ws) => {
      const fila = ws.getRow(1);
      fila.font = { bold: true, color: { argb: "FFFFFFFF" } };
      fila.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF22C55E" } };
    };

    const ws = wb.addWorksheet("Movimientos");
    ws.columns = [
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Hora", key: "hora", width: 8 },
      { header: "Tipo", key: "tipo", width: 16 },
      { header: "Monto", key: "monto", width: 13, style: { numFmt: FORMATO_SOLES } },
      { header: "Descripción", key: "descripcion", width: 34 },
    ];
    cashbox.getMovimientos().forEach((m) => {
      const fila = ws.addRow({
        fecha: m.fecha,
        hora: m.hora,
        tipo: tipoLabel[m.tipo] || m.tipo,
        monto: Number(m.monto || 0),
        descripcion: m.descripcion || "",
      });
      if (m.tipo === "gasto") fila.getCell("monto").font = { color: { argb: "FFDC2626" } };
      if (m.tipo === "ganancia") fila.getCell("monto").font = { color: { argb: "FF16A34A" } };
    });
    pintarEncabezado(ws);

    const ws2 = wb.addWorksheet("Resumen por día");
    ws2.columns = [
      { header: "Fecha", key: "fecha", width: 15 },
      { header: "Ganancias", key: "ganancias", width: 13, style: { numFmt: FORMATO_SOLES } },
      { header: "Gastos", key: "gastos", width: 13, style: { numFmt: FORMATO_SOLES } },
      { header: "Líquido", key: "total", width: 13, style: { numFmt: FORMATO_SOLES } },
      { header: "Caja", key: "caja", width: 13, style: { numFmt: FORMATO_SOLES } },
      { header: "Efectivo esperado", key: "esperado", width: 18, style: { numFmt: FORMATO_SOLES } },
    ];
    cashbox.getCierres().forEach((c) => {
      ws2.addRow({
        fecha: c.fecha,
        ganancias: Number(c.ganancias || 0),
        gastos: Number(c.gastos || 0),
        total: Number(c.total || 0),
        caja: Number(c.caja || 0),
        esperado: Number(c.esperado || 0),
      });
    });
    const hoy = cashbox.getToday();
    const filaHoy = ws2.addRow({
      fecha: "HOY (en curso)",
      ganancias: hoy.ganancias,
      gastos: hoy.gastos,
      total: hoy.total,
      caja: hoy.caja,
      esperado: hoy.esperado,
    });
    filaHoy.font = { bold: true };
    pintarEncabezado(ws2);

    // Colorea según % usado/completado: verde tranquilo, ámbar cuidado,
    // rojo si ya se pasó o está por pasarse del límite/meta.
    const colorPorcentaje = (p) => {
      if (p === null || p === undefined) return "FF64748B";
      if (p >= 0.9) return "FFDC2626";
      if (p >= 0.6) return "FFD97706";
      return "FF16A34A";
    };

    const mesActual = cashbox.getMesActualLabel();
    const resumenCategorias = budgetCategories.getResumen(cashbox.getMovimientos(), mesActual);

    const ws3 = wb.addWorksheet("Gastos por categoría");
    ws3.columns = [
      { header: "Categoría", key: "categoria", width: 24 },
      { header: "Gastado este mes", key: "gastado", width: 18, style: { numFmt: FORMATO_SOLES } },
      { header: "Límite", key: "limite", width: 13, style: { numFmt: FORMATO_SOLES } },
      { header: "Disponible", key: "disponible", width: 14, style: { numFmt: FORMATO_SOLES } },
      { header: "% usado", key: "porcentaje", width: 11, style: { numFmt: "0%" } },
    ];
    resumenCategorias
      .filter((c) => c.tipo === "limite")
      .forEach((c) => {
        const fila = ws3.addRow({
          categoria: c.label,
          gastado: c.gastado,
          limite: c.limite === null ? "Sin límite" : c.limite,
          disponible: c.disponible === null ? "—" : c.disponible,
          porcentaje: c.porcentaje === null ? null : c.porcentaje,
        });
        fila.getCell("porcentaje").font = { bold: true, color: { argb: colorPorcentaje(c.porcentaje) } };
      });
    pintarEncabezado(ws3);

    const ws4 = wb.addWorksheet("Deudas y Metas");
    ws4.columns = [
      { header: "Categoría", key: "categoria", width: 20 },
      { header: "Meta total", key: "meta", width: 14, style: { numFmt: FORMATO_SOLES } },
      { header: "Ya pagado", key: "pagado", width: 14, style: { numFmt: FORMATO_SOLES } },
      { header: "Restante", key: "restante", width: 14, style: { numFmt: FORMATO_SOLES } },
      { header: "% completado", key: "porcentaje", width: 14, style: { numFmt: "0%" } },
    ];
    resumenCategorias
      .filter((c) => c.tipo === "meta")
      .forEach((c) => {
        const fila = ws4.addRow({
          categoria: c.label,
          meta: c.meta,
          pagado: c.pagado,
          restante: c.restante,
          porcentaje: c.porcentaje,
        });
        // Para deudas, más completado = mejor, así que el verde es al revés.
        const colorMeta = c.porcentaje >= 0.9 ? "FF16A34A" : c.porcentaje >= 0.5 ? "FFD97706" : "FFDC2626";
        fila.getCell("porcentaje").font = { bold: true, color: { argb: colorMeta } };
      });
    pintarEncabezado(ws4);

    // Pagos programados: la lista de recordatorios con su próxima fecha y si
    // está pendiente ahora mismo.
    const cuandoLabel = {
      semanal: (r) => "Cada " + ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][r.dia],
      mensual_dia: (r) => "Día " + r.dia + " de cada mes",
      mensual_finmes: () => "Fin de cada mes",
      unica: (r) => "Una vez (" + (r.fecha || "") + ")",
    };
    const ws5 = wb.addWorksheet("Pagos programados");
    ws5.columns = [
      { header: "Pago", key: "pago", width: 22 },
      { header: "Monto", key: "monto", width: 13, style: { numFmt: FORMATO_SOLES } },
      { header: "Cuándo", key: "cuando", width: 24 },
      { header: "Próxima fecha", key: "proxima", width: 15 },
      { header: "Estado", key: "estado", width: 14 },
    ];
    reminders.getAll().forEach((r) => {
      const fila = ws5.addRow({
        pago: r.label,
        monto: Number(r.monto || 0),
        cuando: (cuandoLabel[r.tipo] || (() => r.tipo))(r),
        proxima: r.proxima || "",
        estado: !r.activo ? "Desactivado" : r.pendiente ? "PENDIENTE" : "Al día",
      });
      if (r.activo && r.pendiente) fila.getCell("estado").font = { bold: true, color: { argb: "FFDC2626" } };
      else if (!r.activo) fila.getCell("estado").font = { color: { argb: "FF94A3B8" } };
      else fila.getCell("estado").font = { color: { argb: "FF16A34A" } };
    });
    pintarEncabezado(ws5);

    // Ahorros de Ana: aparte de la caja. Sus totales y el detalle de cada
    // movimiento (lo que dejó para guardar vs lo que se le devolvió).
    const ana = cashbox.getAna();
    const ws6 = wb.addWorksheet("Ana - Ahorros");
    ws6.columns = [
      { header: "Fecha", key: "fecha", width: 12 },
      { header: "Hora", key: "hora", width: 8 },
      { header: "Tipo", key: "tipo", width: 16 },
      { header: "Monto", key: "monto", width: 13, style: { numFmt: FORMATO_SOLES } },
      { header: "Detalle", key: "descripcion", width: 34 },
    ];
    const anaTipoLabel = { guardo: "Ana guardó", gasto: "Ana gastó / le di" };
    cashbox.getAnaMovimientos().forEach((m) => {
      const fila = ws6.addRow({
        fecha: m.fecha,
        hora: m.hora,
        tipo: anaTipoLabel[m.tipo] || m.tipo,
        monto: Number(m.monto || 0),
        descripcion: m.descripcion || "",
      });
      fila.getCell("monto").font = { color: { argb: m.tipo === "gasto" ? "FFDC2626" : "FF16A34A" } };
    });
    ws6.addRow({});
    const filaGuardado = ws6.addRow({ tipo: "TOTAL guardado", monto: ana.guardado });
    const filaGastado = ws6.addRow({ tipo: "TOTAL devuelto/gastado", monto: ana.gastado });
    const filaSaldo = ws6.addRow({ tipo: "SALDO en mi poder", monto: ana.saldo });
    [filaGuardado, filaGastado, filaSaldo].forEach((f) => (f.font = { bold: true }));
    pintarEncabezado(ws6);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="caja-chica.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("No se pudo generar el Excel de caja chica:", err.message);
    res.status(500).json({ error: "No se pudo generar el Excel" });
  }
});

// Notificaciones push: el celular pide la clave pública para suscribirse,
// y manda la suscripción para que el servidor le pueda avisar cuando el
// bot responda un mensaje (ver bot.js).
app.get("/api/push/vapid-public-key", (req, res) => {
  res.json({ publicKey: pushSubscriptions.getPublicKey() });
});

app.post("/api/push/subscribe", (req, res) => {
  pushSubscriptions.addSubscription(req.body.subscription);
  res.json({ ok: true });
});

app.post("/api/push/unsubscribe", (req, res) => {
  pushSubscriptions.removeSubscription(req.body.endpoint);
  res.json({ ok: true });
});

// La web de La Bumanguesa llama acá (con un secreto compartido, ya que no
// hay otro tipo de autenticación entre servidores) para pedir que se mande
// la ubicación al grupo de cotización.
function checkIntegrationSecret(req, res) {
  const expected = process.env.INTEGRATION_SECRET;
  if (!expected || req.headers["x-integration-secret"] !== expected) {
    res.status(401).json({ error: "No autorizado" });
    return false;
  }
  return true;
}

app.post("/api/delivery-quote/request", async (req, res) => {
  if (!checkIntegrationSecret(req, res)) return;
  const { codigo, lat, lng, referencia } = req.body || {};
  if (!codigo || typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "Faltan datos" });
  }
  const sock = getSock();
  if (!sock || !botState.connected) {
    return res.status(503).json({ error: "El bot de WhatsApp no está conectado" });
  }
  const grupos = botState.groups.filter((g) => DELIVERY_QUOTE_GROUP_NAMES.has(g.name.trim().toUpperCase()));
  if (grupos.length === 0) {
    return res.status(503).json({ error: "No se encontró el grupo de cotización" });
  }
  const mapaUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  const refLinea = referencia && referencia.trim() ? `\n\nReferencia: ${referencia.trim()}` : "";
  const texto = `📍 ${mapaUrl}${refLinea}\n\nCotización urgente 🛵`;
  try {
    // Se manda a los dos grupos a la vez; el que responda primero con un
    // precio válido gana (bumanguesa-web ignora la segunda respuesta).
    for (const grupo of grupos) {
      const sent = await sock.sendMessage(grupo.id, { text: texto });
      if (sent?.key?.id) {
        pendingQuotes.add(sent.key.id, codigo);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Error al mandar la cotización de delivery:", err.message);
    res.status(500).json({ error: "No se pudo enviar el mensaje" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Dashboard disponible en el puerto ${PORT}`);
});

startBot().catch((err) => {
  console.error("Error al iniciar el bot:", err);
});
