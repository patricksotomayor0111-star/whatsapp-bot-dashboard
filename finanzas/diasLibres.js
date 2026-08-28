const { crearAlmacen } = require("./almacenPorUsuario");
const businessDay = require("./businessDay");

// Que dias NO trabaja. Sirve para que la meta diaria se reparta solo entre
// los dias que va a salir: si descansa domingos y se divide entre todos
// los dias del mes, la app le pide menos por dia del que necesita y el
// ultimo domingo lo agarra corto.
//
// Dos formas, porque son cosas distintas:
//   semanales -> los que descansa siempre (0 = domingo ... 6 = sabado)
//   fechas    -> dias sueltos: un feriado, un dia que no pudo salir
//
// Por defecto no descansa ningun dia, asi que sin configurar nada se
// comporta igual que antes.
const almacen = crearAlmacen("dias-libres-data.json", function (parsed) {
  try {
    return {
      semanales: Array.isArray(parsed.semanales) ? parsed.semanales.map(Number).filter((d) => d >= 0 && d <= 6) : [],
      fechas: Array.isArray(parsed.fechas) ? parsed.fechas.filter(esFechaLabel) : [],
    };
  } catch (err) {
    return { semanales: [], fechas: [] };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;

function esFechaLabel(v) {
  if (typeof v !== "string" || v.length !== 10) return false;
  const p = v.split("-");
  if (p.length !== 3 || p[0].length !== 4 || p[1].length !== 2 || p[2].length !== 2) return false;
  return p.every((x) => x !== "" && Number.isFinite(Number(x)));
}

function diaDeLaSemana(label) {
  return businessDay.ymdToUtc(label).getUTCDay(); // 0 = domingo
}

function getConfig() {
  const d = datos();
  return {
    semanales: (d.semanales || []).slice().sort((a, b) => a - b),
    fechas: (d.fechas || []).slice().sort(),
  };
}

function setSemanales(dias) {
  datos().semanales = Array.isArray(dias) ? [...new Set(dias.map(Number).filter((x) => x >= 0 && x <= 6))] : [];
  save();
  return getConfig();
}

function addFecha(label) {
  if (!esFechaLabel(label)) throw new Error("Fecha inválida.");
  if (!datos().fechas.includes(label)) {
    datos().fechas.push(label);
    save();
  }
  return getConfig();
}

function removeFecha(label) {
  datos().fechas = (datos().fechas || []).filter((f) => f !== label);
  save();
  return getConfig();
}

function esLibre(label) {
  const d = datos();
  if ((d.fechas || []).includes(label)) return true;
  return (d.semanales || []).includes(diaDeLaSemana(label));
}

// Cuantos dias TRABAJA entre dos fechas, contando las dos puntas.
// Si resultara 0 (marco libre todo el tramo) se devuelve 1: dividir entre
// cero romperia la meta, y en la practica significa que lo que falta hay
// que hacerlo igual.
function contarHabiles(desde, hasta) {
  if (!esFechaLabel(desde) || !esFechaLabel(hasta) || hasta < desde) return 1;
  let n = 0;
  let cursor = desde;
  while (cursor <= hasta) {
    if (!esLibre(cursor)) n++;
    cursor = businessDay.addDays(cursor, 1);
  }
  return n > 0 ? n : 1;
}

// Que dias exactamente quedan libres en un tramo. Sirve para mostrarselos:
// como los dias libres salen de DOS lados (los botones de la semana y las
// fechas sueltas), sin ver la lista es facil creer que solo cuentan las
// fechas que uno agrego a mano.
function listarLibres(desde, hasta) {
  if (!esFechaLabel(desde) || !esFechaLabel(hasta) || hasta < desde) return [];
  const lista = [];
  let cursor = desde;
  while (cursor <= hasta) {
    if (esLibre(cursor)) {
      lista.push({
        fecha: cursor,
        // De donde sale: del boton del dia de la semana o de una fecha suelta.
        motivo: (datos().fechas || []).includes(cursor) ? "fecha" : "semanal",
      });
    }
    cursor = businessDay.addDays(cursor, 1);
  }
  return lista;
}

module.exports = { getConfig, setSemanales, addFecha, removeFecha, esLibre, contarHabiles, listarLibres };
