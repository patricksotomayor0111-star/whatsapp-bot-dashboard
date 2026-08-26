const express = require("express");
const path = require("path");
const { startBot, startBotsGuardados, estadoDe, logoutBot, getSock, avisarAlGrupo, chatsDisponibles } = require("./bot");
const cashbox = require("./cashbox");
const pushSubscriptions = require("./pushSubscriptions");
const budgetCategories = require("./budgetCategories");
const queryIntents = require("./queryIntents");
const productPrices = require("./productPrices");
const reminders = require("./reminders");
const debts = require("./debts");
const shortfalls = require("./shortfalls");
const referenceAccounts = require("./referenceAccounts");
const financeGoals = require("./financeGoals");
const productionGoals = require("./productionGoals");
const scheduledExpenses = require("./scheduledExpenses");
const tasks = require("./tasks");
const locales = require("./locales");
const backup = require("./backup");
const auth = require("./auth");
const users = require("./users");
const contexto = require("./contexto");
const chatConfig = require("./chatConfig");
const custodias = require("./custodias");
const marca = require("./marca");

// Crea la cuenta del dueño y le pasa los datos que hoy están sueltos en el
// volumen. Se hace al arrancar, antes de atender cualquier pedido.
users.asegurarDueno();
require("./limpiarSemillas").limpiar();
const ExcelJS = require("exceljs");

const app = express();
// El límite por defecto de Express son 100kb, que no alcanza para restaurar
// un respaldo (lleva todo el historial de la caja chica).
app.use(express.json({ limit: "25mb" }));

// ---------- Acceso al panel ----------
// Todo lo de abajo pide sesión. Lo único abierto es la pantalla de entrada,
// el endpoint para entrar y los archivos que esa pantalla necesita para
// dibujarse (íconos y manifest): sin esto el panel quedaba público, con la
// información financiera y el QR de WhatsApp al alcance de cualquiera.
const RUTAS_PUBLICAS = new Set(["/login", "/api/login", "/manifest.json", "/icon-192.png", "/icon-512.png", "/sw.js"]);

// La marca se puede LEER sin sesión (la pantalla de entrada la necesita
// para pintarse), pero escribirla no: eso pasa por el candado y queda
// solo para el dueño. Si se dejara la ruta entera abierta, el pedido no
// pasaría por el middleware y nadie quedaría identificado.
const GETS_PUBLICOS = new Set(["/api/marca"]);

// Nombre y logo de la app. Es lo único que NO es por cuenta: es la marca
// del producto, igual para todos. Se sirve sin sesión porque la pantalla
// de entrada también la necesita para pintarse.
app.get("/api/marca", (req, res) => {
  res.json(marca.getMarca());
});

app.post("/api/login", (req, res) => {
  if (!auth.estaConfigurado()) {
    return res.status(503).json({ error: "Falta configurar PANEL_PASSWORD en el servidor." });
  }

  // Sin usuario se asume el dueño, para que su acceso de siempre (solo la
  // contraseña) siga funcionando igual que antes de haber varias cuentas.
  const nombreUsuario = String(req.body?.usuario || "").trim() || users.DUENO_ID;
  const cuenta = users.getByUsuario(nombreUsuario) || users.getById(nombreUsuario);

  if (!cuenta || cuenta.activo === false || !users.passwordCorrecta(cuenta, req.body?.password)) {
    // Un solo mensaje para usuario inexistente y contraseña mala: así no
    // se puede averiguar qué cuentas existen probando nombres.
    return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
  }

  res.setHeader("Set-Cookie", auth.cookieDeSesion(auth.crearToken(cuenta.id)));
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", auth.cookieVacia());
  res.json({ ok: true });
});

// Administrar cuentas es solo del dueño: una cuenta cliente no tiene por
// qué ver quién más usa el sistema, ni menos crear o borrar cuentas.
function soloDueno(req, res, next) {
  if (req.userId !== users.DUENO_ID) {
    return res.status(403).json({ error: "Solo el dueño puede administrar las cuentas." });
  }
  next();
}

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.use((req, res, next) => {
  if (RUTAS_PUBLICAS.has(req.path)) return next();
  if (req.method === "GET" && GETS_PUBLICOS.has(req.path)) return next();

  if (!auth.estaConfigurado()) {
    // Se prefiere dejar el panel cerrado antes que abierto por descuido.
    const aviso = "Falta configurar la variable PANEL_PASSWORD en Railway para poder entrar.";
    return req.path.startsWith("/api/")
      ? res.status(503).json({ error: aviso })
      : res.status(503).send(`<h1>Panel bloqueado</h1><p>${aviso}</p>`);
  }

  const userId = auth.usuarioDeSesion(req);
  const cuenta = userId ? users.getById(userId) : null;

  if (!cuenta || cuenta.activo === false) {
    // A la API se le contesta 401 (para que el panel sepa que expiró la
    // sesión); a una pantalla se la manda a la de entrada.
    return req.path.startsWith("/api/") ? res.status(401).json({ error: "Sesión expirada." }) : res.redirect("/login");
  }

  // Desde acá y hasta terminar de responder, todo lo que toque datos lo
  // hace como esta cuenta. Es lo que impide que un pedido lea o escriba
  // en la información de otra.
  req.userId = cuenta.id;
  contexto.correrComo(cuenta.id, next);
});

// Quién soy: lo usa el panel para saludar y para mostrar la
// administración de cuentas solo cuando corresponde.
app.get("/api/sesion", (req, res) => {
  const cuenta = users.getById(req.userId);
  res.json({
    id: cuenta.id,
    usuario: cuenta.usuario,
    nombre: cuenta.nombre,
    esDueno: cuenta.id === users.DUENO_ID,
    tutorialVisto: chatConfig.getConfig().tutorialVisto,
  });
});

// El tutorial de bienvenida se muestra una sola vez por cuenta.
app.post("/api/tutorial-visto", (req, res) => {
  chatConfig.marcarTutorialVisto();
  res.json({ ok: true });
});

app.post("/api/marca", soloDueno, (req, res) => {
  try {
    res.json({ ok: true, marca: marca.setMarca(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/marca/icono", soloDueno, (req, res) => {
  try {
    res.json({ ok: true, marca: marca.setIcono(req.body?.icono) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/marca/icono", soloDueno, (req, res) => {
  res.json({ ok: true, marca: marca.quitarIcono() });
});

app.get("/api/usuarios", soloDueno, (req, res) => {
  res.json({ usuarios: users.getAll() });
});

app.post("/api/usuarios", soloDueno, (req, res) => {
  try {
    res.json({ ok: true, usuario: users.addUsuario(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/usuarios/:id/password", soloDueno, (req, res) => {
  try {
    if (!users.cambiarPassword(req.params.id, req.body?.password)) {
      return res.status(404).json({ error: "Cuenta no encontrada." });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/usuarios/:id/activo", soloDueno, (req, res) => {
  try {
    if (!users.setActivo(req.params.id, req.body?.activo)) {
      return res.status(404).json({ error: "Cuenta no encontrada." });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/usuarios/:id", soloDueno, (req, res) => {
  try {
    users.removeUsuario(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

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
  // Se arma al vuelo para que refleje el nombre y el logo configurados.
  const { nombre, descripcion } = marca.getMarca();
  res.json({
    name: nombre,
    short_name: nombre,
    description: descripcion,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#22C55E",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  });
});
app.get("/sw.js", (req, res) => {
  res.sendFile(path.join(__dirname, "sw.js"));
});
function servirIcono(nombreArchivo) {
  return (req, res) => {
    const propio = marca.getIconoPath();
    res.sendFile(propio || path.join(__dirname, nombreArchivo));
  };
}
app.get("/icon-192.png", servirIcono("icon-192.png"));
app.get("/icon-512.png", servirIcono("icon-512.png"));

// Endpoint mínimo para medir la calidad de conexión real del celular/PC
// que tiene el panel abierto. No hace nada más que responder rápido.
app.get("/api/ping", (req, res) => {
  res.json({ t: Date.now() });
});

// El panel consulta esto para saber si el bot está conectado y, si no lo
// está, obtener el QR para vincular.
app.get("/api/status", (req, res) => {
  // Cada cuenta ve el estado de SU propio bot: su conexión y su QR. El
  // bot se crea al pedirlo por primera vez, que es cuando esa cuenta
  // entra al panel a vincular su WhatsApp.
  res.json(estadoDe(req.userId));
});

// Dónde escucha el bot de esta cuenta. La lista de chats solo tiene
// contenido después de vincular WhatsApp: antes el servidor no sabe qué
// grupos tiene esa persona.
app.get("/api/bot/chats", (req, res) => {
  res.json({ chats: chatsDisponibles(req.userId), ...chatConfig.getConfig() });
});

app.post("/api/bot/chats", (req, res) => {
  if (req.body?.chatCaja !== undefined) chatConfig.setChatCaja(req.body.chatCaja);
  if (req.body?.chatPrecios !== undefined) chatConfig.setChatPrecios(req.body.chatPrecios);
  res.json({ ok: true, ...chatConfig.getConfig() });
});

// Arranca (o revive) el bot de esta cuenta para que genere su QR.
app.post("/api/bot/vincular", (req, res) => {
  startBot(req.userId).catch((err) => console.error("No se pudo iniciar el bot:", err.message));
  res.json({ ok: true });
});

// Cierra la sesión de WhatsApp vinculada, para volver a mostrar un QR nuevo.
app.post("/api/bot/logout", async (req, res) => {
  await logoutBot(req.userId);
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

// ---------- Respaldo de los datos ----------
// Es el respaldo más importante de los dos: acá vive el historial de plata,
// que no se puede rehacer de memoria. NO incluye la sesión de WhatsApp
// (ver backup.js: son credenciales, el QR se vuelve a escanear).
app.get("/api/backup", (req, res) => {
  const datos = backup.crear();
  const fecha = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="respaldo-finanzas-${fecha}.json"`);
  res.send(JSON.stringify(datos, null, 2));
});

app.post("/api/backup/preview", (req, res) => {
  try {
    const datos = req.body?.backup;
    if (!datos || datos.marca !== backup.MARCA) {
      return res.status(400).json({ error: "Ese archivo no es un respaldo de este bot." });
    }
    if (datos.app !== backup.APP) {
      return res.status(400).json({ error: `Ese respaldo es de "${datos.app}", no de finanzas.` });
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
      aviso: "Reinicia el servicio en Railway para que tome los datos restaurados.",
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Precios de productos anotados en el grupo "Precios general de productos".
// El bot los va guardando solo; estas rutas son para verlos, borrar alguno
// mal cargado, y pegar de una el historial viejo que WhatsApp nunca le
// entregó al bot.
app.get("/api/prices", (req, res) => {
  const q = String(req.query.q || "").trim();
  res.json({ precios: q ? productPrices.buscar(q) : productPrices.getAll() });
});

app.post("/api/prices/import", (req, res) => {
  const resultado = productPrices.addBulk(req.body?.texto);
  res.json({ ok: true, ...resultado, precios: productPrices.getAll() });
});

app.post("/api/prices/:id/remove", (req, res) => {
  const ok = productPrices.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: "Ese precio ya no existe." });
  res.json({ ok: true, precios: productPrices.getAll() });
});

app.get("/api/cashbox/today", (req, res) => {
  // "custodia" es el total de plata de OTRAS personas que estás guardando,
  // sumando a todas: antes era solo de Ana, que estaba fija en el código.
  const personas = custodias.getPersonas();
  const custodia = personas.reduce(
    (acc, p) => ({ guardado: acc.guardado + p.guardado, gastado: acc.gastado + p.gastado, saldo: acc.saldo + p.saldo }),
    { guardado: 0, gastado: 0, saldo: 0 }
  );
  res.json({ ...cashbox.getToday(), custodia, personasCustodia: personas.length });
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
  // Si este gasto salió de un faltante, el total de faltantes tiene que
  // seguir el mismo cambio (si no, quedaría contando el monto viejo).
  if (mov.id) shortfalls.editPorMovimiento(mov.id, req.body || {});
  res.json({ ok: true, movimiento: mov });
});

app.delete("/api/finance/movements/:index", (req, res) => {
  // Se mira el id ANTES de borrarlo, para poder descontar el faltante que
  // lo haya generado.
  const movimientoId = cashbox.getMovimientos()[Number(req.params.index)]?.id;
  const ok = cashbox.removeMovimiento(Number(req.params.index));
  if (!ok) return res.status(404).json({ error: "Movimiento no encontrado." });
  if (movimientoId) shortfalls.removePorMovimiento(movimientoId);
  res.json({ ok: true });
});

// Plata de otras personas en custodia (aparte de la caja). Cada cuenta
// arma su propia lista: antes era una sola persona fija ("Ana") escrita
// en el código, que todos los clientes veían.
app.get("/api/finance/custodias", (req, res) => {
  // Lo que ya estaba guardado como "Ana" pasa a la lista la primera vez.
  // Solo el historial: el saldo lo calcula custodias sumandolo.
  const ana = cashbox.getAna();
  custodias.migrarDesdeAna({
    guardado: ana.guardado || 0,
    gastado: ana.gastado || 0,
    movimientos: cashbox.getAnaMovimientos(),
  });
  res.json({ personas: custodias.getPersonas() });
});

app.post("/api/finance/custodias", (req, res) => {
  try {
    res.json({ ok: true, persona: custodias.addPersona(req.body?.nombre) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/finance/custodias/:clave", (req, res) => {
  if (!custodias.editPersona(req.params.clave, req.body?.nombre)) {
    return res.status(404).json({ error: "Persona no encontrada." });
  }
  res.json({ ok: true });
});

app.delete("/api/finance/custodias/:clave", (req, res) => {
  custodias.removePersona(req.params.clave);
  res.json({ ok: true });
});

app.get("/api/finance/custodias/:clave/movements", (req, res) => {
  res.json({ movimientos: custodias.getMovimientos(req.params.clave).map((m, index) => ({ ...m, index })) });
});

app.post("/api/finance/custodias/:clave/movements", (req, res) => {
  const monto = Number(req.body?.monto);
  if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: "Monto inválido." });
  const tipo = req.body?.tipo === "gasto" ? "gasto" : "guardo";
  if (!custodias.registrar(req.params.clave, tipo, monto, req.body?.descripcion)) {
    return res.status(404).json({ error: "Persona no encontrada." });
  }
  res.json({ ok: true });
});

app.put("/api/finance/custodias/:clave/movements/:index", (req, res) => {
  const mov = custodias.editMovimiento(req.params.clave, Number(req.params.index), req.body || {});
  if (!mov) return res.status(404).json({ error: "Movimiento no encontrado." });
  res.json({ ok: true, movimiento: mov });
});

app.delete("/api/finance/custodias/:clave/movements/:index", (req, res) => {
  if (!custodias.removeMovimiento(req.params.clave, Number(req.params.index))) {
    return res.status(404).json({ error: "Movimiento no encontrado." });
  }
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
  // normal, además de quedar en el total de faltantes aparte. Los dos
  // quedan enlazados por el id del gasto, para poder corregirlos juntos.
  const movimientoId = cashbox.addGasto(montoNum, req.body?.descripcion);
  shortfalls.addFaltante(montoNum, req.body?.descripcion, movimientoId);
  res.json({ ok: true });
});

app.put("/api/finance/shortfalls/:index", (req, res) => {
  const mov = shortfalls.editMovimiento(Number(req.params.index), req.body || {});
  if (!mov) return res.status(404).json({ error: "Movimiento no encontrado." });
  // El gasto que este faltante dejó en la caja tiene que quedar igual, si no
  // el efectivo esperado seguiría calculado con el monto viejo.
  if (mov.movimientoId) cashbox.editMovimientoPorId(mov.movimientoId, req.body || {});
  res.json({ ok: true, movimiento: mov });
});

app.delete("/api/finance/shortfalls/:index", (req, res) => {
  const mov = shortfalls.removeMovimiento(Number(req.params.index));
  if (!mov) return res.status(404).json({ error: "Movimiento no encontrado." });
  if (mov.movimientoId) cashbox.removeMovimientoPorId(mov.movimientoId);
  res.json({ ok: true, enlazado: !!mov.movimientoId });
});

// ---------- Locales que dan pedidos (ranking de repartos) ----------
// Cada ganancia es un reparto hecho para un local; acá se agrupan por
// local para ver cuál da más volumen, cuál paga mejor por reparto y cuál
// dejó de dar trabajo. ?mes=YYYY-MM acota el ranking (vacío = todo).
app.get("/api/finance/locales", (req, res) => {
  const mes = req.query.mes || "";
  const movimientos = cashbox.getMovimientos();
  // El costo de un reparto sale de los gastos marcados como del negocio,
  // repartidos entre todos los repartos del mismo período.
  const rentabilidad = budgetCategories.getRentabilidad(movimientos, mes);
  res.json({
    ranking: locales.getRanking(movimientos, mes, cashbox.getHoyLabel(), rentabilidad.costoPorReparto),
    costoPorReparto: rentabilidad.costoPorReparto,
    sinAsignar: locales.getSinAsignar(movimientos, mes),
    meses: Array.from(new Set(movimientos.map((m) => m.fecha.slice(0, 7)))).sort().reverse(),
  });
});

// Mapa de cuándo entran los repartos: por día de la semana y por hora.
// Sirve para decidir a qué hora y qué días conviene salir a trabajar.
app.get("/api/finance/actividad", (req, res) => {
  const mes = req.query.mes || "";
  const repartos = cashbox
    .getMovimientos()
    .filter((m) => m.tipo === "ganancia" && (!mes || m.fecha.slice(0, 7) === mes));

  // celdas[diaSemana][hora] = { total, pedidos }
  const celdas = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ total: 0, pedidos: 0 })));
  const diasDistintos = Array.from({ length: 7 }, () => new Set());

  repartos.forEach((m) => {
    const [y, mo, d] = m.fecha.split("-").map(Number);
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    const hora = parseInt(String(m.hora).split(":")[0], 10);
    if (!Number.isFinite(hora)) return;
    celdas[dow][hora].total += m.monto;
    celdas[dow][hora].pedidos += 1;
    diasDistintos[dow].add(m.fecha);
  });

  // Promedio por día trabajado, para comparar días con distinta cantidad
  // de fechas registradas sin que el que más veces cayó gane siempre.
  const porDia = celdas.map((horas, dow) => {
    const total = horas.reduce((s, c) => s + c.total, 0);
    const pedidos = horas.reduce((s, c) => s + c.pedidos, 0);
    const veces = diasDistintos[dow].size;
    return { dow, total: +total.toFixed(2), pedidos, veces, promedio: veces ? +(total / veces).toFixed(2) : 0 };
  });

  const porHora = Array.from({ length: 24 }, (_, h) => {
    const total = celdas.reduce((s, dia) => s + dia[h].total, 0);
    const pedidos = celdas.reduce((s, dia) => s + dia[h].pedidos, 0);
    return { hora: h, total: +total.toFixed(2), pedidos };
  });

  res.json({ celdas, porDia, porHora, meses: Array.from(new Set(cashbox.getMovimientos().map((m) => m.fecha.slice(0, 7)))).sort().reverse() });
});

app.post("/api/finance/locales", (req, res) => {
  try {
    const local = locales.addLocal(req.body || {});
    res.json({ ok: true, local });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/finance/locales/:id", (req, res) => {
  const local = locales.editLocal(req.params.id, req.body || {});
  if (!local) return res.status(404).json({ error: "Local no encontrado." });
  res.json({ ok: true, local });
});

app.delete("/api/finance/locales/:id", (req, res) => {
  locales.removeLocal(req.params.id);
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

  // Las metas ya vienen calculadas dentro de getGoals(). Se reenvia el
  // desglose completo para que el panel muestre de donde sale el numero,
  // y para que panel y bot no puedan decir cifras distintas.
  const metas = goals.automaticas;

  res.json({
    goals,
    automaticas: metas,
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
      total: metas.detalle.pendientes.total,
      detalle: metas.detalle.pendientes.items.map((p) => ({ ...p, subtotal: p.monto })),
      necesidadTotal: metas.necesito,
      necesidadFaltante: metas.falta,
      metaDiariaReal: metas.diaria,
    },
  });
});

// Presupuesto: límites mensuales por categoría y metas de deudas (Junta,
// Caja Cuzco, Universidad), calculados a partir del registro de gastos.
app.get("/api/budget/categories", (req, res) => {
  // ?mes=YYYY-MM opcional: para ver el gasto por categoría de un mes
  // anterior en los gráficos, en vez de siempre el mes en curso.
  const mes = req.query.mes || cashbox.getMesActualLabel();
  const movimientos = cashbox.getMovimientos();
  res.json({
    categorias: budgetCategories.getResumen(movimientos, mes),
    rentabilidad: budgetCategories.getRentabilidad(movimientos, mes),
  });
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
      origen: "panel",
    });

    const aviso = registrado
      ? `✅ Marcaste "${recordatorio.label}" como pagado desde el panel.\n📉 Registré el gasto por ${formatSoles(monto)}.\nNo hace falta que lo escribas acá.`
      : `✅ Marcaste "${recordatorio.label}" como pagado desde el panel.\nEse gasto ya estaba registrado${gastoExistente.descripcion ? ` ("${gastoExistente.descripcion}")` : ""}, así que no registré nada para no duplicarlo.`;
    avisarAlGrupo(req.userId, aviso).catch((err) => console.error("No se pudo avisar al grupo:", err.message));

    res.json({ ok: true, registrado, gastoExistente });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Historial de pagos marcados, con si su gasto se registró en la caja o ya
// estaba escrito. Con ?id=xxx devuelve solo el de ese pago.
app.get("/api/reminders/historial", (req, res) => {
  res.json({ historial: reminders.getHistorialPagos(req.query.id) });
});

// Deshace un "Ya pagué" marcado por error (solo reabre el aviso; el gasto
// que haya quedado en la caja se corrige aparte desde Movimientos).
app.post("/api/reminders/:id/desmarcar", (req, res) => {
  try {
    reminders.desmarcarPagado(req.params.id);
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

// Levanta los bots de todas las cuentas que ya vincularon su WhatsApp.
startBotsGuardados();
