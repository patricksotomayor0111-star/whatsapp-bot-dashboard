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

// Si pasan 8 minutos sin señal se da por apagada la ubicación. En
// movimiento Traccar Client manda seguido, pero QUIETO (esperando en un
// local, o en su casa) solo sube un punto cada 5-6 minutos aunque el
// "refresco en reposo" esté en 60 s: los del medio los descarta por no
// haberse movido. Con 3 minutos, todo motorizado parado salía "sin señal".
const UMBRAL_SIN_SENAL_MS = 8 * 60 * 1000;
const DIAS_DE_EVENTOS = 14;
const HORARIO_POR_DEFECTO = { inicio: "17:00", fin: "23:00", dias: [0, 1, 2, 3, 4, 5, 6] };

function cargar() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    return {
      horario: d.horario || { ...HORARIO_POR_DEFECTO },
      riders: d.riders || [],
      estado: d.estado || {},
      eventos: d.eventos || {},
    };
  } catch {
    return { horario: { ...HORARIO_POR_DEFECTO }, riders: [], estado: {}, eventos: {} };
  }
}

const data = cargar();

// Llega un punto por minuto por motorizado: escribir el archivo en cada
// uno es innecesario, alcanza con juntar los cambios unos segundos.
let guardadoPendiente = null;
function guardar() {
  if (guardadoPendiente) return;
  guardadoPendiente = setTimeout(() => {
    guardadoPendiente = null;
    try {
      fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
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
  const rider = { id: crypto.randomBytes(6).toString("hex"), nombre: n, codigo: c, horario: null };
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
  guardar();
  return rider;
}

function quitar(id) {
  const antes = data.riders.length;
  data.riders = data.riders.filter((r) => r.id !== id);
  delete data.estado[id];
  delete data.eventos[id];
  guardar();
  return data.riders.length < antes;
}

function setHorarioGeneral(h) {
  data.horario = validarHorario(h);
  guardar();
  return data.horario;
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
  if (punto.lat === null || punto.lon === null) return;
  // Fuera de horario no se guarda nada: ni ubicación ni batería. Es su
  // tiempo libre (y la ley de datos personales pide justamente eso).
  if (!enHorario(rider, punto.t)) return;

  const estado = (data.estado[rider.id] = data.estado[rider.id] || { estado: null });
  const ant = estado.ultimo;
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

function recibir(query, body) {
  const ahora = Date.now();
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
    const dentro = enHorario(rider, ahora);

    if (estado.estado === "activo" && dentro && ahora - estado.ultimo.recibido > UMBRAL_SIN_SENAL_MS) {
      agregarEvento(rider.id, { tipo: "sin_senal", t: estado.ultimo.t, bat: estado.ultimo.bat });
      estado.estado = "sin_senal";
      cambio = true;
    } else if ((estado.estado === "activo" || estado.estado === "sin_senal") && !dentro) {
      agregarEvento(rider.id, { tipo: "fin_horario", t: ahora, bat: estado.ultimo.bat });
      estado.estado = "fin_horario";
      cambio = true;
    }
  }
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
    return {
      id: r.id,
      nombre: r.nombre,
      codigo: r.codigo,
      horario: r.horario,
      horarioEfectivo: horarioDe(r),
      enHorario: enHorario(r, ahora),
      estado: est.estado || null,
      ultimo: est.ultimo || null,
      desde: ev ? ev.t : null,
      consumoHora,
      eventosHoy: eventosDelDia(r.id, hoy),
    };
  });
  return {
    ahora,
    hoy,
    horario: data.horario,
    umbralMin: UMBRAL_SIN_SENAL_MS / 60000,
    riders,
    desconocidos: [...desconocidos.entries()]
      .filter(([, t]) => ahora - t < 24 * 3600000)
      .map(([codigo, t]) => ({ codigo, t })),
  };
}

function eventos(riderId, fecha) {
  if (!data.riders.some((r) => r.id === riderId)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) fecha = peru(Date.now()).fecha;
  return eventosDelDia(riderId, fecha);
}

module.exports = {
  recibir,
  resumen,
  eventos,
  agregar,
  editar,
  quitar,
  setHorarioGeneral,
  // Para pruebas.
  _enHorario: enHorario,
  _leerPuntos: leerPuntos,
};
