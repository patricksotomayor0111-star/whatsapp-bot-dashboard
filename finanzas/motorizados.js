const fs = require("fs");
const crypto = require("crypto");
const { dataPath } = require("./dataDir");

// Ubicación de los motorizados. Cada celular manda su GPS cada minuto (con
// Traccar Client, gratis en Android y iPhone) a /api/gps, y el dueño ve en
// /motorizados dónde está cada uno, su batería y a qué hora activó o dejó
// de mandar la ubicación.
//
// Es global (no por cuenta): lo administra solo el dueño, y el celular del
// motorizado no tiene sesión, se identifica únicamente por su código.

const DATA_PATH = dataPath("motorizados-data.json");
// La ruta del día va aparte: son cientos de puntos por motorizado y no hace
// falta reescribirlos cada vez que cambia algo chico del resto.
const RUTAS_PATH = dataPath("motorizados-rutas.json");

// Si pasan 8 minutos sin señal se da por apagada la ubicación. En
// movimiento Traccar Client manda seguido, pero QUIETO (esperando en un
// local, o en su casa) solo sube un punto cada 5-6 minutos aunque el
// "refresco en reposo" esté en 60 s: los del medio los descarta por no
// haberse movido. Con 3 minutos, todo motorizado parado salía "sin señal".
const UMBRAL_SIN_SENAL_MS = 8 * 60 * 1000;
const DIAS_DE_EVENTOS = 14;
const HORARIO_POR_DEFECTO = { inicio: "17:00", fin: "23:00", dias: [0, 1, 2, 3, 4, 5, 6] };
// La ruta es solo la del día laboral (de 8 am a 3 am por defecto): al
// empezar el siguiente se borra. Los km, en cambio, se acumulan siempre.
const RUTA_POR_DEFECTO = { inicio: "08:00", fin: "03:00" };
const ACEITE_POR_DEFECTO_KM = 1500;

function cargar() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    return {
      horario: d.horario || { ...HORARIO_POR_DEFECTO },
      ruta: d.ruta || { ...RUTA_POR_DEFECTO },
      riders: d.riders || [],
      estado: d.estado || {},
      eventos: d.eventos || {},
      tokens: d.tokens || {},
    };
  } catch {
    return { horario: { ...HORARIO_POR_DEFECTO }, ruta: { ...RUTA_POR_DEFECTO }, riders: [], estado: {}, eventos: {}, tokens: {} };
  }
}

function cargarRutas() {
  try {
    return JSON.parse(fs.readFileSync(RUTAS_PATH, "utf8")) || {};
  } catch {
    return {};
  }
}

const data = cargar();
// { riderId: { dia: "YYYY-MM-DD", puntos: [[t, lat, lon], ...] } }
const rutas = cargarRutas();

// Llega un punto por minuto por motorizado: escribir el archivo en cada
// uno es innecesario, alcanza con juntar los cambios unos segundos.
let guardadoPendiente = null;
function guardar() {
  if (guardadoPendiente) return;
  guardadoPendiente = setTimeout(() => {
    guardadoPendiente = null;
    try {
      fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
      fs.writeFileSync(RUTAS_PATH, JSON.stringify(rutas));
    } catch (err) {
      console.error("No se pudo guardar motorizados:", err.message);
    }
  }, 3000);
}

// ---------- Horario (hora de Perú, UTC-5 todo el año) ----------

function aMinutos(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function peru(ms) {
  const d = new Date(ms - 5 * 3600000);
  return { dia: d.getUTCDay(), minutos: d.getUTCHours() * 60 + d.getUTCMinutes(), fecha: d.toISOString().slice(0, 10) };
}

function validarHorario(h) {
  const okHora = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v));
  if (!h || !okHora(h.inicio) || !okHora(h.fin)) throw new Error("Hora inválida (usa HH:MM).");
  const dias = Array.isArray(h.dias) ? [...new Set(h.dias.map(Number).filter((n) => n >= 0 && n <= 6))] : [];
  if (!dias.length) throw new Error("Elige al menos un día.");
  return { inicio: h.inicio, fin: h.fin, dias: dias.sort() };
}

function horarioDe(rider) {
  return rider.horario || data.horario;
}

// Los días marcados son los días en que EMPIEZA el turno: un turno de
// 6pm a 2am del viernes sigue valiendo el sábado a la 1am.
function enHorario(rider, ms) {
  const h = horarioDe(rider);
  const { dia, minutos } = peru(ms);
  const ini = aMinutos(h.inicio);
  const fin = aMinutos(h.fin);
  if (ini === fin) return h.dias.includes(dia);
  if (ini < fin) return h.dias.includes(dia) && minutos >= ini && minutos < fin;
  const ayer = (dia + 6) % 7;
  return (h.dias.includes(dia) && minutos >= ini) || (h.dias.includes(ayer) && minutos < fin);
}

// ---------- Ruta del día ----------

function enVentanaRuta(ms) {
  const { minutos } = peru(ms);
  const ini = aMinutos(data.ruta.inicio);
  const fin = aMinutos(data.ruta.fin);
  if (ini === fin) return true;
  if (ini < fin) return minutos >= ini && minutos < fin;
  return minutos >= ini || minutos < fin;
}

// El día laboral empieza a la hora de inicio de la ruta: a las 2 am todavía
// cuenta como el día que empezó ayer a las 8 am.
function diaLaboral(ms) {
  return peru(ms - aMinutos(data.ruta.inicio) * 60000).fecha;
}

function setRutaConfig(r) {
  const okHora = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v));
  if (!r || !okHora(r.inicio) || !okHora(r.fin)) throw new Error("Hora inválida (usa HH:MM).");
  data.ruta = { inicio: r.inicio, fin: r.fin };
  guardar();
  return data.ruta;
}

// Distancia en km entre dos puntos (fórmula de haversine).
function distanciaKm(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Suma los km del punto nuevo. El GPS "tiembla" unos metros aunque el
// celular esté quieto, y cada tanto da un salto falso de cientos de metros:
// sumado todo el día eso infla los km. Por eso se mide siempre desde el
// último punto que SÍ contó (el ancla), y se descarta lo impreciso, lo que
// no se movió de verdad y lo que iría a una velocidad imposible en moto.
// Puntos que no sirven ni para km ni para dibujar la ruta: muy imprecisos
// o a una velocidad imposible en moto desde el punto INMEDIATAMENTE
// anterior (medirlo contra un punto viejo dejaría pasar saltos falsos
// después de un rato quieto).
function puntoDudoso(estado, punto) {
  if (punto.acc !== null && punto.acc > 50) return true;
  const prev = estado.ultimo;
  return !!(prev && punto.t > prev.t && distanciaKm(prev, punto) / ((punto.t - prev.t) / 3600000) > 120);
}

function sumarKm(rider, estado, punto) {
  if (rider.contarKm === false || puntoDudoso(estado, punto)) return;
  const km = (estado.km = estado.km || { total: 0, desdeAceite: 0, hoy: null, ancla: null, aceiteFecha: null });
  const dia = diaLaboral(punto.t);
  if (!km.hoy || km.hoy.dia !== dia) km.hoy = { dia, km: 0 };
  const ancla = km.ancla;
  if (!ancla) {
    km.ancla = { lat: punto.lat, lon: punto.lon, t: punto.t };
    return;
  }
  if (punto.t <= ancla.t) return;
  const d = distanciaKm(ancla, punto);
  if (d * 1000 < Math.max(30, punto.acc || 0)) return;
  km.total += d;
  km.desdeAceite += d;
  km.hoy.km += d;
  km.ancla = { lat: punto.lat, lon: punto.lon, t: punto.t };
}

function guardarEnRuta(rider, estado, punto) {
  if (rider.guardarRuta === false || !enVentanaRuta(punto.t) || puntoDudoso(estado, punto)) return;
  const dia = diaLaboral(punto.t);
  if (!rutas[rider.id] || rutas[rider.id].dia !== dia) rutas[rider.id] = { dia, puntos: [] };
  rutas[rider.id].puntos.push([punto.t, punto.lat, punto.lon]);
}

// Borra las rutas de días laborales que ya terminaron.
function limpiarRutas(ahora) {
  const hoy = diaLaboral(ahora);
  let cambio = false;
  for (const id of Object.keys(rutas)) {
    if (rutas[id].dia !== hoy || !data.riders.some((r) => r.id === id)) {
      delete rutas[id];
      cambio = true;
    }
  }
  return cambio;
}

function ruta(riderId) {
  const rider = data.riders.find((r) => r.id === riderId);
  if (!rider) return null;
  limpiarRutas(Date.now());
  const r = rutas[riderId];
  const puntos = r ? r.puntos.slice().sort((a, b) => a[0] - b[0]) : [];
  return { dia: diaLaboral(Date.now()), desde: data.ruta.inicio, hasta: data.ruta.fin, puntos };
}

function aceite(riderId, { accion, km }) {
  const rider = data.riders.find((r) => r.id === riderId);
  if (!rider) throw new Error("Motorizado no encontrado.");
  const estado = (data.estado[riderId] = data.estado[riderId] || { estado: null });
  const k = (estado.km = estado.km || { total: 0, desdeAceite: 0, hoy: null, ancla: null, aceiteFecha: null });
  if (accion === "cambiado") {
    k.desdeAceite = 0;
    k.aceiteFecha = Date.now();
    agregarEvento(riderId, { tipo: "aceite", t: Date.now(), bat: null });
  } else if (accion === "corregir") {
    const n = Number(km);
    if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error("Km inválidos.");
    k.desdeAceite = n;
  } else {
    throw new Error("Acción inválida.");
  }
  guardar();
  return k;
}

// ---------- Motorizados ----------

function slug(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
}

function validarCodigo(codigo, idPropio) {
  const c = String(codigo || "").trim();
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(c)) {
    throw new Error("El código debe tener de 4 a 40 letras, números o guiones.");
  }
  if (data.riders.some((r) => r.codigo === c && r.id !== idPropio)) {
    throw new Error("Ese código ya lo usa otro motorizado.");
  }
  return c;
}

function agregar({ nombre, codigo }) {
  const n = String(nombre || "").trim();
  if (!n) throw new Error("Falta el nombre.");
  // El código es lo único que identifica al celular, así que va con un
  // número al azar: con solo el nombre cualquiera podría adivinarlo y
  // mandar ubicaciones falsas.
  const c = codigo
    ? validarCodigo(codigo)
    : validarCodigo(`${slug(n) || "moto"}-${crypto.randomInt(1000, 10000)}`);
  const rider = {
    id: crypto.randomBytes(6).toString("hex"),
    nombre: n,
    codigo: c,
    horario: null,
    guardarRuta: true,
    contarKm: true,
    aceiteCadaKm: ACEITE_POR_DEFECTO_KM,
    // "siempre": el GPS manda todo el turno (Traccar Client, lo de hoy).
    // "aPedido": el GPS queda apagado y solo se enciende cuando el dueño
    // toca "Ubicar" o "Seguir" en el panel (app propia, para no gastar
    // batería ni calentar el celular todo el día).
    modo: "siempre",
  };
  data.riders.push(rider);
  desconocidos.delete(c);
  guardar();
  return rider;
}

function editar(id, cambios) {
  const rider = data.riders.find((r) => r.id === id);
  if (!rider) throw new Error("Motorizado no encontrado.");
  if (cambios.nombre !== undefined) {
    const n = String(cambios.nombre).trim();
    if (!n) throw new Error("Falta el nombre.");
    rider.nombre = n;
  }
  if (cambios.codigo !== undefined) rider.codigo = validarCodigo(cambios.codigo, id);
  if (cambios.horario !== undefined) {
    rider.horario = cambios.horario === null ? null : validarHorario(cambios.horario);
  }
  if (cambios.guardarRuta !== undefined) {
    rider.guardarRuta = cambios.guardarRuta === true;
    // Apagarla borra lo que ya se había guardado hoy: si no se quiere ver
    // su ruta, tampoco tiene sentido conservarla.
    if (!rider.guardarRuta) delete rutas[id];
  }
  if (cambios.contarKm !== undefined) {
    rider.contarKm = cambios.contarKm === true;
    // Al volver a prenderlo no se suma el tramo que hizo mientras estaba
    // apagado: se empieza a medir desde el próximo punto.
    const est = data.estado[id];
    if (est && est.km) est.km.ancla = null;
  }
  if (cambios.aceiteCadaKm !== undefined) {
    const n = Number(cambios.aceiteCadaKm);
    if (!Number.isFinite(n) || n < 100 || n > 50000) throw new Error("El intervalo de aceite debe estar entre 100 y 50 000 km.");
    rider.aceiteCadaKm = Math.round(n);
  }
  if (cambios.modo !== undefined) {
    if (!["siempre", "aPedido"].includes(cambios.modo)) throw new Error("Modo inválido.");
    rider.modo = cambios.modo;
    // Al cambiar de modo se cierra cualquier seguimiento en curso.
    const est = data.estado[id];
    if (est) est.comando = null;
  }
  guardar();
  return rider;
}

function quitar(id) {
  const antes = data.riders.length;
  data.riders = data.riders.filter((r) => r.id !== id);
  delete data.estado[id];
  delete data.eventos[id];
  delete rutas[id];
  guardar();
  return data.riders.length < antes;
}

function setHorarioGeneral(h) {
  data.horario = validarHorario(h);
  guardar();
  return data.horario;
}

// ---------- Órdenes "a pedido" ----------
//
// El dueño toca en el panel y el servidor guarda hasta qué momento el GPS
// del motorizado debe estar encendido. La app del motorizado pregunta a
// /api/gps-comando y, si falta tiempo, enciende el GPS y manda su ubicación
// cada minuto hasta esa hora; si no, lo deja apagado. Así el GPS solo se
// prende cuando el dueño lo pide.

function esAPedido(rider) {
  return (rider.modo || "siempre") === "aPedido";
}

function ventanaActiva(estado, ahora) {
  return !!(estado && estado.comando && ahora < estado.comando.hasta);
}

function setComando(id, { tipo, minutos }) {
  const rider = data.riders.find((r) => r.id === id);
  if (!rider) throw new Error("Motorizado no encontrado.");
  const estado = (data.estado[id] = data.estado[id] || { estado: null });
  const ahora = Date.now();
  let hasta;
  let evTipo;
  let min;
  if (tipo === "ubicar") {
    // 2 minutos: alcanza para que el GPS enganche aunque el primer arranque
    // sea lento, y que llegue al menos un punto.
    hasta = ahora + 2 * 60000;
    evTipo = "pedido_ubicar";
  } else if (tipo === "seguir") {
    min = Number(minutos);
    if (!Number.isFinite(min) || min < 1 || min > 720) throw new Error("Minutos inválidos (1 a 720).");
    hasta = ahora + min * 60000;
    evTipo = "pedido_seguir";
  } else if (tipo === "detener") {
    hasta = 0;
    evTipo = "pedido_detener";
  } else {
    throw new Error("Acción inválida.");
  }
  estado.comando = { hasta, issued: ahora };
  // El tramo entre un seguimiento y otro no se puede ver, así que no se
  // suma como una línea recta: se empieza a medir km desde el próximo punto.
  if (estado.km) estado.km.ancla = null;
  agregarEvento(id, { tipo: evTipo, t: ahora, bat: null, min });
  guardar();
  // Avisa al celular (Firebase/Expo) para que encienda o apague el GPS al
  // instante, sin esperar a que pregunte. Es lo que hace que "a pedido"
  // reaccione rápido con el GPS apagado. Si no hay token aún, no pasa nada.
  enviarPush(rider);
  return { hasta, ahora };
}

// Guarda el token de avisos (push) que manda la app del motorizado al
// registrarse. Se guarda por motorizado, identificado por su código.
function setToken(code, token) {
  const rider = data.riders.find((r) => r.codigo === code);
  if (!rider) throw new Error("Código no registrado.");
  const t = String(token || "");
  if (!/^Expo(nent)?PushToken\[.+\]$/.test(t)) throw new Error("Token inválido.");
  data.tokens = data.tokens || {};
  data.tokens[rider.id] = t;
  guardar();
  return true;
}

// Manda un aviso silencioso (data-only) al celular por el servicio de Expo
// (que por detrás usa Firebase). El celular lo recibe aunque la app esté
// cerrada y, con eso, enciende el GPS hasta la hora "hasta". Es "disparar y
// olvidar": si falla el envío, no rompe la orden, solo no llega el aviso.
function enviarPush(rider) {
  const token = data.tokens && data.tokens[rider.id];
  if (!token) return;
  const est = data.estado[rider.id] || {};
  const hasta = est.comando ? est.comando.hasta : 0;
  fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      to: token,
      priority: "high",
      data: { hasta, codigo: rider.codigo },
      _contentAvailable: true,
    }),
  }).catch((err) => console.error("No se pudo enviar push a", rider.codigo, err.message));
}

// Lo que lee la app del motorizado (endpoint público, se identifica por
// código). "hasta" en el futuro = encender el GPS; en el pasado = apagarlo.
function comando(code) {
  const rider = data.riders.find((r) => r.codigo === code);
  if (!rider) return null;
  const est = data.estado[rider.id];
  const ahora = Date.now();
  let hasta = 0;
  if (esAPedido(rider)) {
    // A pedido: envía solo mientras dure la ventana que abrió el dueño.
    hasta = est && est.comando ? est.comando.hasta : 0;
  } else if (enHorario(rider, ahora)) {
    // Siempre: envía durante todo su horario. Se devuelve una hora "hasta"
    // rodante (5 min) que la app va renovando cada vez que pregunta; al
    // terminar el horario deja de renovarse y la app deja de enviar.
    hasta = ahora + 5 * 60000;
  }
  return { modo: rider.modo || "siempre", hasta, intervalo: 60 };
}

// ---------- Eventos (activó / sin señal / sin internet / fin de horario) ----------

function agregarEvento(riderId, evento) {
  const lista = (data.eventos[riderId] = data.eventos[riderId] || []);
  lista.push(evento);
  const limite = Date.now() - DIAS_DE_EVENTOS * 24 * 3600000;
  while (lista.length && lista[0].t < limite) lista.shift();
}

function ultimoEvento(riderId) {
  const lista = data.eventos[riderId] || [];
  return lista[lista.length - 1];
}

// ---------- Recepción del GPS ----------

// Códigos que mandan datos pero nadie registró: se muestran en el panel
// para que al configurar un celular se vea al toque si el código quedó mal
// escrito. Solo en memoria, no hace falta guardarlos.
const desconocidos = new Map();

function numero(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function aMs(ts) {
  if (ts === undefined || ts === null || ts === "") return Date.now();
  const n = Number(ts);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const p = Date.parse(ts);
  return Number.isFinite(p) ? p : Date.now();
}

// Traccar Client manda dos formatos según la versión: la vieja manda todo
// en la URL (?id=...&lat=...&batt=85) y la nueva un JSON con
// { device_id, location: { coords, battery, timestamp } }. Se aceptan los
// dos para no depender de qué versión tenga instalada cada motorizado.
function leerPuntos(query, body) {
  const puntos = [];
  const b = body && typeof body === "object" ? body : {};

  if (b.location) {
    const codigo = b.device_id || b.deviceId || query.id || query.deviceid;
    const locs = Array.isArray(b.location) ? b.location : [b.location];
    for (const loc of locs) {
      const c = loc.coords || {};
      const nivel = numero(loc.battery?.level);
      puntos.push({
        codigo,
        lat: numero(c.latitude),
        lon: numero(c.longitude),
        acc: numero(c.accuracy),
        t: aMs(loc.timestamp),
        bat: nivel === null || nivel < 0 ? null : Math.round(nivel <= 1 ? nivel * 100 : nivel),
        cargando: loc.battery?.is_charging === true,
        latido: loc.event === "heartbeat" || loc.is_heartbeat === true,
      });
    }
    return puntos;
  }

  const p = { ...b, ...query };
  const bat = numero(p.batt ?? p.battery);
  puntos.push({
    codigo: p.id || p.deviceid,
    lat: numero(p.lat),
    lon: numero(p.lon),
    acc: numero(p.accuracy),
    t: aMs(p.timestamp),
    bat: bat === null ? null : Math.round(bat <= 1 && String(p.batt ?? p.battery).includes(".") ? bat * 100 : bat),
    cargando: String(p.charge) === "true",
  });
  return puntos;
}

// Consumo de batería del día: suma solo los tramos en que el celular NO
// estaba cargando y los dos puntos están cerca (si hubo un hueco largo no
// se sabe qué pasó en el medio, y se descarta).
function sumarConsumo(estado, punto) {
  const ant = estado.ultimo;
  const fecha = peru(punto.t).fecha;
  if (!estado.bateria || estado.bateria.fecha !== fecha) {
    estado.bateria = { fecha, porcentaje: 0, ms: 0 };
  }
  if (!ant || ant.bat === null || punto.bat === null || ant.cargando || punto.cargando) return;
  const dt = punto.t - ant.t;
  if (dt <= 0 || dt > 10 * 60 * 1000 || punto.bat > ant.bat) return;
  estado.bateria.porcentaje += ant.bat - punto.bat;
  estado.bateria.ms += dt;
}

function registrarPunto(punto, ahora) {
  const rider = data.riders.find((r) => r.codigo === punto.codigo);
  if (!rider) {
    if (punto.codigo) desconocidos.set(String(punto.codigo).slice(0, 60), ahora);
    return;
  }
  const estado = (data.estado[rider.id] = data.estado[rider.id] || { estado: null });
  const ant = estado.ultimo;

  // Con el GPS apagado Traccar Client igual manda un "latido" cada tanto
  // ("Heartbeat accepted" en sus registros), pero sin ubicación nueva: o
  // sin coordenadas, o repitiendo la última que tenía. Es la única forma de
  // saber que apagó la ubicación con el celular prendido, en vez de
  // esperar minutos de silencio.
  const sinCoords = punto.lat === null || punto.lon === null;
  const repiteUltima =
    ant && !sinCoords && punto.t <= ant.t && Math.abs(punto.lat - ant.lat) < 1e-6 && Math.abs(punto.lon - ant.lon) < 1e-6;
  if (sinCoords || repiteUltima || (punto.latido && ant && punto.t <= ant.t)) {
    registrarLatidoSinGps(rider, estado, punto, ahora);
    return;
  }

  // "siempre": fuera de horario no se guarda nada (su tiempo libre, y la ley
  // de datos personales pide justamente eso). "aPedido": solo se guarda
  // mientras hay un seguimiento activo que el dueño pidió (ese pedido queda
  // registrado); fuera de la ventana no se guarda aunque llegue algo.
  const permitido = esAPedido(rider) ? ventanaActiva(estado, ahora) : enHorario(rider, punto.t);
  if (!permitido) return;

  // Puntos viejos que llegan tarde (el celular los guardó sin internet y
  // los manda después en desorden): no cambian la posición actual.
  if (ant && punto.t <= ant.t) return;

  if (estado.estado !== "activo") {
    const ev = ultimoEvento(rider.id);
    if (estado.estado === "sin_senal" && ant && punto.t - ant.t <= UMBRAL_SIN_SENAL_MS && ev?.tipo === "sin_senal") {
      // Siguió registrando ubicación durante el corte: el GPS nunca se
      // apagó, solo se quedó sin internet. Se corrige el aviso.
      ev.tipo = "sin_internet";
      agregarEvento(rider.id, { tipo: "reconecto", t: ahora, bat: punto.bat });
    } else {
      agregarEvento(rider.id, { tipo: "activo", t: punto.t, bat: punto.bat });
    }
    estado.estado = "activo";
  }

  sumarConsumo(estado, punto);
  sumarKm(rider, estado, punto);
  guardarEnRuta(rider, estado, punto);
  estado.ultimo = {
    lat: punto.lat,
    lon: punto.lon,
    acc: punto.acc,
    t: punto.t,
    bat: punto.bat,
    cargando: punto.cargando,
    recibido: ahora,
  };
}

function registrarLatidoSinGps(rider, estado, punto, ahora) {
  if (!enHorario(rider, ahora) || !estado.ultimo) return;
  estado.latido = { t: ahora, bat: punto.bat, cargando: punto.cargando };
  if (estado.estado === "gps_apagado") return;
  const ev = ultimoEvento(rider.id);
  if (estado.estado === "sin_senal" && ev?.tipo === "sin_senal") {
    // Ya se había marcado por silencio: ahora se sabe el motivo.
    ev.tipo = "gps_apagado";
  } else if (estado.estado === "activo") {
    // La hora es la del último punto con GPS: se apagó entre ese momento
    // y este latido, y esa es la cota más cercana que se tiene.
    agregarEvento(rider.id, { tipo: "gps_apagado", t: estado.ultimo.t, bat: punto.bat ?? estado.ultimo.bat });
  } else {
    return;
  }
  estado.estado = "gps_apagado";
}

// Últimos pedidos crudos que llegaron a /api/gps, solo en memoria: sirven
// para ver qué manda exactamente cada versión de Traccar Client cuando
// algo no se marca como se esperaba.
const crudos = [];

function recibir(query, body) {
  const ahora = Date.now();
  crudos.push({ t: ahora, query, body: JSON.stringify(body || {}).slice(0, 1500) });
  if (crudos.length > 40) crudos.shift();
  const puntos = leerPuntos(query || {}, body).sort((a, b) => a.t - b.t);
  puntos.forEach((p) => registrarPunto(p, ahora));
  guardar();
}

// ---------- Vigilancia: quién dejó de mandar ----------

// Si el motorizado apaga el GPS, el celular o el internet, el celular ya
// no puede avisar nada. Por eso es el servidor el que nota el silencio y
// lo anota con la hora del último punto que llegó (que es, con un minuto
// de diferencia, la hora en que se cortó).
function revisar() {
  const ahora = Date.now();
  let cambio = false;
  for (const rider of data.riders) {
    const estado = data.estado[rider.id];
    if (!estado || !estado.ultimo) continue;
    // Los de "a pedido" están apagados a propósito casi todo el tiempo: no
    // se les marca "sin señal". Su estado se calcula en vivo en resumen().
    if (esAPedido(rider)) continue;
    const dentro = enHorario(rider, ahora);

    if (estado.estado === "activo" && dentro && ahora - estado.ultimo.recibido > UMBRAL_SIN_SENAL_MS) {
      agregarEvento(rider.id, { tipo: "sin_senal", t: estado.ultimo.t, bat: estado.ultimo.bat });
      estado.estado = "sin_senal";
      cambio = true;
    } else if (["activo", "sin_senal", "gps_apagado"].includes(estado.estado) && !dentro) {
      agregarEvento(rider.id, { tipo: "fin_horario", t: ahora, bat: estado.ultimo.bat });
      estado.estado = "fin_horario";
      cambio = true;
    }
  }
  if (limpiarRutas(ahora)) cambio = true;
  if (cambio) guardar();
}

setInterval(revisar, 30 * 1000).unref();

// ---------- Lo que ve el panel ----------

function eventosDelDia(riderId, fecha) {
  return (data.eventos[riderId] || []).filter((e) => peru(e.t).fecha === fecha);
}

function resumen() {
  revisar();
  const ahora = Date.now();
  const hoy = peru(ahora).fecha;
  const riders = data.riders.map((r) => {
    const est = data.estado[r.id] || {};
    const bat = est.bateria && est.bateria.fecha === hoy ? est.bateria : null;
    // Con menos de 20 minutos medidos el número sale muy saltón.
    const consumoHora = bat && bat.ms >= 20 * 60 * 1000 ? Math.round((bat.porcentaje / (bat.ms / 3600000)) * 10) / 10 : null;
    const ev = ultimoEvento(r.id);
    // Estado que ve el panel. Para "a pedido" se calcula en vivo según la
    // ventana que el dueño abrió y si está llegando ubicación.
    let estadoShow = est.estado || null;
    let seguimiento = null;
    if (esAPedido(r)) {
      const cmd = est.comando;
      const activo = ventanaActiva(est, ahora);
      seguimiento = { activo, hasta: cmd ? cmd.hasta : 0, desde: cmd ? cmd.issued : 0 };
      if (!activo) {
        estadoShow = "reposo";
      } else if (est.ultimo && ahora - est.ultimo.recibido < 90000) {
        estadoShow = "pedido_activo";
      } else if (cmd && ahora - cmd.issued > 180000) {
        estadoShow = "pedido_sin_respuesta";
      } else {
        estadoShow = "pedido_esperando";
      }
    }
    return {
      id: r.id,
      nombre: r.nombre,
      codigo: r.codigo,
      modo: r.modo || "siempre",
      seguimiento,
      horario: r.horario,
      horarioEfectivo: horarioDe(r),
      enHorario: enHorario(r, ahora),
      estado: estadoShow,
      ultimo: est.ultimo || null,
      latido: est.latido || null,
      desde: ev ? ev.t : null,
      consumoHora,
      eventosHoy: eventosDelDia(r.id, hoy),
      guardarRuta: r.guardarRuta !== false,
      contarKm: r.contarKm !== false,
      aceiteCadaKm: r.aceiteCadaKm || ACEITE_POR_DEFECTO_KM,
      km: est.km
        ? {
            hoy: est.km.hoy && est.km.hoy.dia === diaLaboral(ahora) ? redondear(est.km.hoy.km) : 0,
            total: redondear(est.km.total),
            desdeAceite: redondear(est.km.desdeAceite),
            aceiteFecha: est.km.aceiteFecha,
          }
        : { hoy: 0, total: 0, desdeAceite: 0, aceiteFecha: null },
      puntosRutaHoy: rutas[r.id] && rutas[r.id].dia === diaLaboral(ahora) ? rutas[r.id].puntos.length : 0,
    };
  });
  return {
    ahora,
    hoy,
    horario: data.horario,
    ruta: data.ruta,
    umbralMin: UMBRAL_SIN_SENAL_MS / 60000,
    riders,
    desconocidos: [...desconocidos.entries()]
      .filter(([, t]) => ahora - t < 24 * 3600000)
      .map(([codigo, t]) => ({ codigo, t })),
  };
}

function redondear(km) {
  return Math.round((km || 0) * 10) / 10;
}

function eventos(riderId, fecha) {
  if (!data.riders.some((r) => r.id === riderId)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) fecha = peru(Date.now()).fecha;
  return eventosDelDia(riderId, fecha);
}

module.exports = {
  recibir,
  crudos: () => crudos.slice().reverse(),
  resumen,
  eventos,
  agregar,
  editar,
  quitar,
  setHorarioGeneral,
  setRutaConfig,
  ruta,
  aceite,
  setComando,
  comando,
  setToken,
  // Para pruebas.
  _distanciaKm: distanciaKm,
  _enHorario: enHorario,
  _leerPuntos: leerPuntos,
};
