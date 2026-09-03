const express = require("express");
const path = require("path");
const { startBot, botState, logoutBot, getSock, setBotActivo, probarFrase } = require("./bot");
const quoteConfig = require("./quoteConfig");
const sectors = require("./sectors");
const dynamicKeywords = require("./dynamicKeywords");
const numberExceptions = require("./numberExceptions");
const excludedNumbers = require("./excludedNumbers");
const pendingQuotes = require("./pendingQuotes");
const pushSubscriptions = require("./pushSubscriptions");
const mediaTriggers = require("./mediaTriggers");
const pendingTimeMatches = require("./pendingTimeMatches");
const groupDelays = require("./groupDelays");
const scheduledBroadcasts = require("./scheduledBroadcasts");
const backup = require("./backup");
const auth = require("./auth");
const multer = require("multer");

const app = express();
// El límite por defecto de Express son 100kb, que no alcanza para restaurar
// un respaldo (lleva la configuración entera y las fotos de los mensajes
// programados en base64).
app.use(express.json({ limit: "25mb" }));

// Sube la foto de un mensaje programado a memoria (se guarda a disco desde
// la ruta, vía scheduledBroadcasts.setImagen); 5MB alcanza de sobra para
// una foto de WhatsApp.
const uploadBroadcastImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, /^image\//.test(file.mimetype));
  },
});

// ---------- Acceso al panel ----------
// Todo lo de abajo pide sesión. Lo único abierto es la pantalla de entrada,
// el endpoint para entrar y los archivos que esa pantalla necesita: sin
// esto el panel quedaba público, con la configuración del bot, los grupos
// de clientes y el QR de WhatsApp al alcance de cualquiera.
// "/api/delivery-quote/request" NO lleva sesión a propósito: la llama la
// web de Punto Caliente desde su propio servidor, no un navegador con
// cookie. Ya tiene su propia llave (INTEGRATION_SECRET), así que pedirle
// sesión solo rompería las cotizaciones sin agregar seguridad.
const RUTAS_PUBLICAS = new Set([
  "/login",
  "/api/login",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/sw.js",
  "/api/delivery-quote/request",
]);

app.post("/api/login", (req, res) => {
  if (!auth.estaConfigurado()) {
    return res.status(503).json({ error: "Falta configurar PANEL_PASSWORD en el servidor." });
  }
  if (!auth.passwordCorrecta(req.body?.password)) {
    return res.status(401).json({ error: "Contraseña incorrecta." });
  }
  res.setHeader("Set-Cookie", auth.cookieDeSesion(auth.crearToken()));
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", auth.cookieVacia());
  res.json({ ok: true });
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.use((req, res, next) => {
  if (RUTAS_PUBLICAS.has(req.path)) return next();

  if (!auth.estaConfigurado()) {
    // Se prefiere dejar el panel cerrado antes que abierto por descuido.
    const aviso = "Falta configurar la variable PANEL_PASSWORD en Railway para poder entrar.";
    return req.path.startsWith("/api/")
      ? res.status(503).json({ error: aviso })
      : res.status(503).send(`<h1>Panel bloqueado</h1><p>${aviso}</p>`);
  }

  if (auth.haySesion(req)) return next();

  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Sesión expirada." });
  // Se recuerda a donde queria entrar (ej. /tracker desde el segundo
  // celular): sin esto, despues de la contrasena siempre caia en el panel
  // y habia que volver a escribir la direccion a mano.
  return res.redirect("/login?ir=" + encodeURIComponent(req.originalUrl));
});

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

// Rastreador de Clash Royale por voz (pagina suelta, sin relacion con el bot).
// El archivo vive en "finanzas/" porque esa es la app que Railway tiene
// desplegada y ahi el servicio solo ve esa carpeta; desde aca se sirve el
// mismo archivo, sin copias. Va detras de la sesion como todo lo demas.
app.get(["/tracker", "/tracker.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "finanzas", "tracker.html"));
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
  // Va por setBotActivo (y no tocando botState.active directo) porque al
  // activar hay que anotar el momento: los mensajes escritos antes de eso
  // no se marcan.
  res.json({ active: setBotActivo(req.body.active) });
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

// Prueba qué haría el bot con una frase, sin mandar nada a WhatsApp: sirve
// para ver por qué no detectó un pedido y decidir si hace falta agregarle
// una frase especial a ese grupo. Solo diagnostica, no cambia nada.
app.post("/api/probar-frase", (req, res) => {
  try {
    res.json(probarFrase(req.body?.texto, req.body?.groupId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Respaldo de la configuración ----------
// Descarga todo lo configurable en un solo archivo, para poder recuperarlo
// si el disco de Railway falla. NO incluye la sesión de WhatsApp (ver
// backup.js: son credenciales, el QR se vuelve a escanear).
app.get("/api/backup", (req, res) => {
  const datos = backup.crear();
  const fecha = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="respaldo-delivery-${fecha}.json"`);
  res.send(JSON.stringify(datos, null, 2));
});

// Mira qué trae un respaldo SIN restaurarlo, para poder confirmarlo antes
// de pisar la configuración actual.
app.post("/api/backup/preview", (req, res) => {
  try {
    const datos = req.body?.backup;
    if (!datos || datos.marca !== backup.MARCA) {
      return res.status(400).json({ error: "Ese archivo no es un respaldo de este bot." });
    }
    if (datos.app !== backup.APP) {
      return res.status(400).json({ error: `Ese respaldo es de "${datos.app}", no del bot de delivery.` });
    }
    res.json({ ok: true, resumen: backup.resumir(datos) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/backup/restore", (req, res) => {
  try {
    const resultado = backup.restaurar(req.body?.backup);
    // Los módulos leen su archivo una sola vez al arrancar, así que lo
    // recién escrito en disco no se aplica hasta reiniciar el servicio.
    res.json({
      ok: true,
      ...resultado,
      aviso: "Reinicia el servicio en Railway para que el bot tome la configuración restaurada.",
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Ventana de tiempo (0 a N minutos), una por sector: si el pedido menciona
// una hora o minutos dentro de la ventana de su sector, se marca al toque.
// Si está fuera, y la espera automática está activa, se guarda para
// marcarse solo cuando el tiempo restante entre en la ventana.
app.get("/api/config/timewindow", (req, res) => {
  res.json({
    porSector: sectors.getTimeWindowMinutesMap(),
    esperaAutomaticaActiva: sectors.getEsperaAutomaticaActiva(),
    antiguedadMaximaMin: sectors.getAntiguedadMaximaMin(),
  });
});

// Cuántos minutos de antigüedad tolera un mensaje. Aparte de esto, el bot
// nunca marca lo escrito ANTES de que lo activaras (eso no se configura:
// es la regla de "si lo apagué, ese pedido ya lo está viendo alguien").
app.post("/api/config/antiguedad", (req, res) => {
  try {
    sectors.setAntiguedadMaximaMin(req.body.minutos);
    res.json({ ok: true, antiguedadMaximaMin: sectors.getAntiguedadMaximaMin() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/config/timewindow", (req, res) => {
  try {
    sectors.setTimeWindowMinutes(req.body.sectorId, req.body.minutes);
    res.json({ ok: true, porSector: sectors.getTimeWindowMinutesMap() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Interruptor del panel principal: apaga la espera automática cuando hay
// mucho pedido (marca al toque si está en ventana, no responde si no).
app.post("/api/config/espera-automatica", (req, res) => {
  sectors.setEsperaAutomaticaActiva(req.body.active);
  res.json({ ok: true, active: sectors.getEsperaAutomaticaActiva() });
});

// Pedidos que quedaron en espera por la ventana de tiempo, a la vista del
// panel principal. Se pueden cancelar a mano si el dispatcher decide no
// esperar más ese pedido puntual.
app.get("/api/pending-time-matches", (req, res) => {
  res.json({ pendientes: pendingTimeMatches.getAll() });
});

app.post("/api/pending-time-matches/:id/cancel", (req, res) => {
  pendingTimeMatches.remove(Number(req.params.id));
  res.json({ ok: true });
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
// Números que el bot ignora por completo. Editable desde el panel (antes
// había que tocar el código y redesplegar para agregar uno).
app.get("/api/excluded-numbers", (req, res) => {
  res.json({ numeros: excludedNumbers.getAll() });
});

app.post("/api/excluded-numbers", (req, res) => {
  try {
    const r = excludedNumbers.addNumber(req.body?.numero);
    if (!r.ok) return res.status(400).json({ error: r.motivo });
    res.json({ ok: true, numeros: excludedNumbers.getAll() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/excluded-numbers/remove", (req, res) => {
  const ok = excludedNumbers.removeNumber(req.body?.numero);
  if (!ok) return res.status(404).json({ error: "Ese número no estaba en la lista." });
  res.json({ ok: true, numeros: excludedNumbers.getAll() });
});

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

// Pedidos que no llegan como texto: grupos donde el bot responde también a
// una foto, a una tarjeta de contacto o a una nota de voz corta. Todo
// editable desde el panel (antes las fotos estaban fijas en el código).
app.get("/api/media-triggers", (req, res) => {
  res.json(mediaTriggers.getConfig());
});

app.post("/api/media-triggers/groups", (req, res) => {
  try {
    mediaTriggers.addGroup(req.body?.tipo, req.body?.name);
    res.json({ ok: true, ...mediaTriggers.getConfig() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/media-triggers/groups/remove", (req, res) => {
  try {
    const ok = mediaTriggers.removeGroup(req.body?.tipo, req.body?.name);
    if (!ok) return res.status(404).json({ error: "Ese grupo no estaba en la lista." });
    res.json({ ok: true, ...mediaTriggers.getConfig() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/media-triggers/audio-seconds", (req, res) => {
  try {
    const segundos = mediaTriggers.setAudioMaxSegundos(req.body?.segundos);
    res.json({ ok: true, audioMaxSegundos: segundos });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

// ---------- Mensajes programados (texto + foto opcional, a horas fijas) ----------
// Se mandan solos, todos los días, a los grupos elegidos, en cada horario
// configurado (hora Perú). Todo editable desde el panel.
app.get("/api/broadcasts", (req, res) => {
  res.json({ broadcasts: scheduledBroadcasts.getAll() });
});

app.post("/api/broadcasts", (req, res) => {
  try {
    const broadcast = scheduledBroadcasts.addBroadcast(req.body || {});
    res.json({ ok: true, broadcast });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/broadcasts/:id", (req, res) => {
  try {
    const broadcast = scheduledBroadcasts.editBroadcast(req.params.id, req.body || {});
    if (!broadcast) return res.status(404).json({ error: "Mensaje programado no encontrado." });
    res.json({ ok: true, broadcast });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/broadcasts/:id/active", (req, res) => {
  const broadcast = scheduledBroadcasts.setActivo(req.params.id, req.body.activo);
  if (!broadcast) return res.status(404).json({ error: "Mensaje programado no encontrado." });
  res.json({ ok: true });
});

app.delete("/api/broadcasts/:id", (req, res) => {
  scheduledBroadcasts.removeBroadcast(req.params.id);
  res.json({ ok: true });
});

app.post("/api/broadcasts/:id/image", uploadBroadcastImage.single("imagen"), (req, res) => {
  if (!scheduledBroadcasts.getById(req.params.id)) {
    return res.status(404).json({ error: "Mensaje programado no encontrado." });
  }
  if (!req.file) return res.status(400).json({ error: "No se recibió ninguna imagen." });
  const extension = path.extname(req.file.originalname) || ".jpg";
  scheduledBroadcasts.setImagen(req.params.id, req.file.buffer, extension);
  res.json({ ok: true });
});

app.delete("/api/broadcasts/:id/image", (req, res) => {
  const broadcast = scheduledBroadcasts.quitarImagen(req.params.id);
  if (!broadcast) return res.status(404).json({ error: "Mensaje programado no encontrado." });
  res.json({ ok: true });
});

// Sirve la foto de un mensaje programado para poder previsualizarla en el
// panel (no es un directorio estático genérico, solo esta ruta puntual).
app.get("/api/broadcasts/:id/image", (req, res) => {
  const imagenPath = scheduledBroadcasts.getImagenPath(req.params.id);
  if (!imagenPath) return res.status(404).end();
  res.sendFile(imagenPath);
});

// Descarga el registro completo de la caja chica (todos los días guardados,
// no solo hoy) como un Excel de verdad (.xlsx): columnas reales, encabezados
// con color, montos "S/ 0.00" (gastos en rojo, ganancias en verde) y dos
// hojas: Movimientos y Resumen por día. Al ser .xlsx no depende de cómo
// cada programa interprete separadores, como pasaba con el CSV.
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

// ---------- Configuración de cotizaciones (editable desde el panel) ----------
app.get("/api/quote-config", (req, res) => {
  res.json(quoteConfig.getConfig());
});

app.post("/api/quote-config/groups", (req, res) => {
  try {
    quoteConfig.addGroupName(req.body.name);
    res.json({ ok: true, ...quoteConfig.getConfig() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/quote-config/groups/remove", (req, res) => {
  quoteConfig.removeGroupName(req.body.name);
  res.json({ ok: true, ...quoteConfig.getConfig() });
});

app.post("/api/quote-config/anyone", (req, res) => {
  quoteConfig.setAnyoneCanQuote(req.body.anyoneCanQuote);
  res.json({ ok: true, ...quoteConfig.getConfig() });
});

app.post("/api/quote-config/numbers", (req, res) => {
  try {
    quoteConfig.addAuthorizedNumber(req.body.number);
    res.json({ ok: true, ...quoteConfig.getConfig() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/quote-config/numbers/remove", (req, res) => {
  quoteConfig.removeAuthorizedNumber(req.body.number);
  res.json({ ok: true, ...quoteConfig.getConfig() });
});

app.post("/api/quote-config/message", (req, res) => {
  try {
    quoteConfig.setMessage(req.body.message);
    res.json({ ok: true, ...quoteConfig.getConfig() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
  const grupos = botState.groups.filter((g) => quoteConfig.isQuoteGroup(g.name));
  if (grupos.length === 0) {
    return res.status(503).json({ error: "No se encontró el grupo de cotización" });
  }
  const mapaUrl = `https://www.google.com/maps?q=${lat},${lng}`;
  const refLinea = referencia && referencia.trim() ? `\n\nReferencia: ${referencia.trim()}` : "";
  const texto = `📍 ${mapaUrl}${refLinea}\n\n${quoteConfig.getMessage()}`;
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
