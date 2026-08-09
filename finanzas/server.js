const express = require("express");
const path = require("path");
const { startBot, botState, logoutBot, getSock, avisarAlGrupo } = require("./bot");
const cashbox = require("./cashbox");
const pushSubscriptions = require("./pushSubscriptions");
const budgetCategories = require("./budgetCategories");
const queryIntents = require("./queryIntents");
const reminders = require("./reminders");
const debts = require("./debts");
const shortfalls = require("./shortfalls");
const referenceAccounts = require("./referenceAccounts");
const financeGoals = require("./financeGoals");
const productionGoals = require("./productionGoals");
const scheduledExpenses = require("./scheduledExpenses");
const tasks = require("./tasks");
const ExcelJS = require("exceljs");

const app = express();
app.use(express.json());

// Solo se exponen estos archivos del panel (no todo el proyecto, para no
// dejar accesible el código del bot ni la sesión de WhatsApp).
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

// Endpoint mínimo para medir la calidad de conexión real del celular/PC
// que tiene el panel abierto. No hace nada más que responder rápido.
app.get("/api/ping", (req, res) => {
  res.json({ t: Date.now() });
});

// El panel consulta esto para saber si el bot está conectado y, si no lo
// está, obtener el QR para vincular.
app.get("/api/status", (req, res) => {
  res.json({
    connected: botState.connected,
    qr: botState.qr,
    groupsCount: botState.groups.length,
  });
});

// Cierra la sesión de WhatsApp vinculada, para volver a mostrar un QR nuevo.
app.post("/api/bot/logout", async (req, res) => {
  await logoutBot();
  res.json({ ok: true });
});

// ---------- Migración desde el proyecto de delivery (temporal) ----------
// Recibe lo que devuelve GET /api/admin/export-finance-data del proyecto
// viejo y lo escribe tal cual en este DATA_DIR. Los módulos ya cargaron su
// "semilla" en memoria al arrancar, así que hace falta reiniciar este
// servicio (redeploy o restart en Railway) para que tome los datos
// importados.
const FINANCE_DATA_FILES = [
  "cashbox-data.json",
  "reminders-data.json",
  "debts-data.json",
  "shortfalls-data.json",
  "reference-accounts-data.json",
  "finance-goals-data.json",
  "budget-categories-data.json",
  "production-goals-data.json",
  "scheduled-expenses-data.json",
  "query-intents-data.json",
];

function checkMigrationSecret(req, res) {
  const expected = process.env.MIGRATION_SECRET;
  if (!expected || req.headers["x-migration-secret"] !== expected) {
    res.status(401).json({ error: "No autorizado" });
    return false;
  }
  return true;
}

app.post("/api/admin/import-finance-data", (req, res) => {
  if (!checkMigrationSecret(req, res)) return;
  const fs = require("fs");
  const { dataPath } = require("./dataDir");
  const archivos = req.body?.archivos || {};
  const escritos = [];
  FINANCE_DATA_FILES.forEach((nombre) => {
    if (archivos[nombre] === undefined || archivos[nombre] === null) return;
    fs.writeFileSync(dataPath(nombre), JSON.stringify(archivos[nombre], null, 2));
    escritos.push(nombre);
  });
  res.json({ ok: true, escritos, aviso: "Reinicia este servicio para que tome los datos importados." });
});

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
  const movimientos = cashbox.getMovimientos().map((m, index) => ({
    ...m,
    index,
    // Categoría resuelta (manual si se asignó, si no por palabras clave),
    // para que el panel pueda mostrar/editar la categoría de cada gasto
    // sin tener que reimplementar la clasificación del lado del cliente.
    categoriaEfectiva: m.tipo === "gasto" ? budgetCategories.resolveCategoriaId(m) : undefined,
  }));
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

// Gastos programados (almuerzos, gasolina, salida familiar, etc.): solo
// planificación/proyección, no tocan la caja real. "proyeccion" acepta
// ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD; sin parámetros, devuelve lo que
// falta del mes en curso.
app.get("/api/finance/scheduled-expenses", (req, res) => {
  res.json({ gastos: scheduledExpenses.getAll() });
});

app.get("/api/finance/scheduled-expenses/proyeccion", (req, res) => {
  const { desde, hasta } = req.query;
  if (desde && hasta) return res.json(scheduledExpenses.getProyeccion(desde, hasta));
  res.json(scheduledExpenses.getProyeccionRestoDeMes());
});

app.post("/api/finance/scheduled-expenses", (req, res) => {
  try {
    const gasto = scheduledExpenses.addGasto(req.body || {});
    res.json({ ok: true, gasto });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/finance/scheduled-expenses/:id", (req, res) => {
  try {
    const gasto = scheduledExpenses.editGasto(req.params.id, req.body || {});
    if (!gasto) return res.status(404).json({ error: "Gasto programado no encontrado." });
    res.json({ ok: true, gasto });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/finance/scheduled-expenses/:id/activo", (req, res) => {
  try {
    scheduledExpenses.setActivo(req.params.id, req.body?.activo);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/finance/scheduled-expenses/:id", (req, res) => {
  const ok = scheduledExpenses.removeGasto(req.params.id);
  if (!ok) return res.status(404).json({ error: "Gasto programado no encontrado." });
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
  // Igual que "menos X falto" por WhatsApp: resta de la caja como un gasto
  // normal, además de quedar en el total de faltantes aparte.
  cashbox.addGasto(montoNum, req.body?.descripcion);
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
// día) más el día en curso, para los gráficos y la lista diaria de
// Finanzas.
app.get("/api/finance/history", (req, res) => {
  // "meses" sale de TODOS los movimientos (no solo los cierres) para que un
  // gasto cargado a mano con fecha pasada también aparezca como mes
  // disponible en el selector de "Gasto por categoría", aunque ese día
  // nunca haya llegado a cerrar.
  const meses = Array.from(new Set(cashbox.getMovimientos().map((m) => m.fecha.slice(0, 7))))
    .sort()
    .reverse();
  res.json({ cierres: cashbox.getCierres(), hoy: { fecha: cashbox.getHoyLabel(), ...cashbox.getToday() }, meses });
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
  // ?mes=YYYY-MM opcional: para ver el gasto por categoría de un mes
  // anterior en los gráficos, en vez de siempre el mes en curso.
  const mes = req.query.mes || cashbox.getMesActualLabel();
  res.json({ categorias: budgetCategories.getResumen(cashbox.getMovimientos(), mes) });
});

// Lista los gastos de una categoría (incluye "otros"), para poder verlos
// y reasignarlos a otra categoría desde el panel.
app.get("/api/budget/categories/:id/movements", (req, res) => {
  const mesActual = cashbox.getMesActualLabel();
  const movimientos = budgetCategories.getMovimientosCategoria(cashbox.getMovimientos(), req.params.id, mesActual);
  res.json({ movimientos });
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

app.put("/api/reminders/:id", (req, res) => {
  try {
    const r = reminders.editReminder(req.params.id, req.body || {});
    if (!r) return res.status(404).json({ error: "Recordatorio no encontrado." });
    res.json({ ok: true, reminder: r });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function formatSoles(n) {
  return "S/ " + Number(n).toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Marcar un pago como pagado desde el panel. Antes esto solo apagaba el
// aviso y el gasto había que escribirlo aparte en el grupo GANANCIAS, así
// que era fácil marcarlo y olvidarse de registrarlo (la caja quedaba sin
// ese gasto). Ahora se revisa si ya está registrado en el ciclo: si falta,
// se registra solo; si ya estaba, no se duplica. En ambos casos se avisa
// al grupo para que quede a la vista y no se escriba dos veces.
app.post("/api/reminders/:id/pagado", (req, res) => {
  try {
    const recordatorio = reminders.getById(req.params.id);
    if (!recordatorio) return res.status(404).json({ error: "Recordatorio inexistente." });

    const montoNum = Number(req.body?.monto);
    const monto = Number.isFinite(montoNum) && montoNum > 0 ? montoNum : recordatorio.monto;

    const gastoExistente = reminders.buscarGastoDelPago(req.params.id, cashbox.getMovimientos());
    const registrado = !gastoExistente;
    if (registrado) cashbox.addGasto(monto, recordatorio.label);

    reminders.marcarPagado(req.params.id, {
      monto,
      registrado,
      gastoExistente: gastoExistente ? gastoExistente.descripcion || "" : null,
    });

    const aviso = registrado
      ? `✅ Marcaste "${recordatorio.label}" como pagado desde el panel.\n📉 Registré el gasto por ${formatSoles(monto)}.\nNo hace falta que lo escribas acá.`
      : `✅ Marcaste "${recordatorio.label}" como pagado desde el panel.\nEse gasto ya estaba registrado${gastoExistente.descripcion ? ` ("${gastoExistente.descripcion}")` : ""}, así que no registré nada para no duplicarlo.`;
    avisarAlGrupo(aviso).catch((err) => console.error("No se pudo avisar al grupo:", err.message));

    res.json({ ok: true, registrado, gastoExistente });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Historial de pagos marcados desde el panel, con si su gasto se registró
// en la caja o ya estaba escrito.
app.get("/api/reminders/historial", (req, res) => {
  res.json({ historial: reminders.getHistorialPagos() });
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

// Tareas sueltas sin monto (distintas de los pagos de arriba): avisan cada
// 30 minutos mientras no se marquen como hechas.
app.get("/api/tasks", (req, res) => {
  res.json({ tasks: tasks.getAll() });
});

app.post("/api/tasks", (req, res) => {
  try {
    const task = tasks.addTask(req.body?.texto);
    res.json({ ok: true, task });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/tasks/:id", (req, res) => {
  const task = tasks.editTask(req.params.id, req.body?.texto);
  if (!task) return res.status(404).json({ error: "Tarea no encontrada." });
  res.json({ ok: true, task });
});

app.post("/api/tasks/:id/confirmar", (req, res) => {
  const task = tasks.setConfirmado(req.params.id, true);
  if (!task) return res.status(404).json({ error: "Tarea no encontrada." });
  res.json({ ok: true });
});

app.post("/api/tasks/:id/reabrir", (req, res) => {
  const task = tasks.setConfirmado(req.params.id, false);
  if (!task) return res.status(404).json({ error: "Tarea no encontrada." });
  res.json({ ok: true });
});

app.delete("/api/tasks/:id", (req, res) => {
  tasks.removeTask(req.params.id);
  res.json({ ok: true });
});

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Finanzas disponible en el puerto ${PORT}`);
});

startBot().catch((err) => {
  console.error("Error al iniciar el bot de Finanzas:", err);
});
