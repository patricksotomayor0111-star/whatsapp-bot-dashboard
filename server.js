const express = require("express");
const path = require("path");
const { startBot, botState, logoutBot } = require("./bot");
const sectors = require("./sectors");
const dynamicKeywords = require("./dynamicKeywords");

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

// El dashboard consulta esto para saber si el bot está conectado
// y, si no lo está, obtener el QR para vincular.
app.get("/api/status", (req, res) => {
  res.json({
    connected: botState.connected,
    active: botState.active,
    qr: botState.qr,
    lastActivity: botState.lastActivity,
    groupsCount: botState.groups.length,
  });
});

// Lista de grupos reales de WhatsApp (solo disponible una vez conectado),
// con el sector asignado, si está activo individualmente y si está enfocado.
app.get("/api/groups", (req, res) => {
  const focusedGroups = sectors.getFocusedGroups();
  const groups = botState.groups.map((g) => ({
    ...g,
    sectorId: sectors.getGroupSector(g.id),
    active: sectors.isGroupActive(g.id),
    focused: focusedGroups.includes(g.id),
  }));
  res.json({ groups, focusedGroups });
});

// Lista de sectores y su estado ON/OFF
app.get("/api/sectors", (req, res) => {
  res.json({
    sectors: sectors.SECTOR_DEFS,
    sectorActive: sectors.getSectorActiveMap(),
  });
});

// Enciende o apaga un sector completo (los grupos siguen "Activos" mostrándose,
// pero el bot no responde en ellos mientras el sector esté apagado)
app.post("/api/sectors/:id/active", (req, res) => {
  try {
    sectors.setSectorActive(req.params.id, req.body.active);
    res.json({ ok: true, active: sectors.isSectorActive(req.params.id) });
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

// Modo enfoque: agrega un grupo a la lista de enfocados (solo esos responden)
app.post("/api/focus/:groupId", (req, res) => {
  sectors.addFocusGroup(req.params.groupId);
  res.json({ ok: true, focusedGroups: sectors.getFocusedGroups() });
});

// Restaura el modo enfoque: vuelve al comportamiento normal por sector/grupo
app.post("/api/focus/clear", (req, res) => {
  sectors.clearFocus();
  res.json({ ok: true });
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Dashboard disponible en el puerto ${PORT}`);
});

startBot().catch((err) => {
  console.error("Error al iniciar el bot:", err);
});
