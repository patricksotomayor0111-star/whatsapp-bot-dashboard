const express = require("express");
const path = require("path");
const { startBot, botState, logoutBot } = require("./bot");
const sectors = require("./sectors");
const dynamicKeywords = require("./dynamicKeywords");
const numberExceptions = require("./numberExceptions");
const cashbox = require("./cashbox");
const pushSubscriptions = require("./pushSubscriptions");
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
  res.json(cashbox.getToday());
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
  console.log(`Dashboard disponible en el puerto ${PORT}`);
});

startBot().catch((err) => {
  console.error("Error al iniciar el bot:", err);
});
