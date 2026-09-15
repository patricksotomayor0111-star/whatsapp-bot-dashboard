const { crearAlmacen } = require("./almacenPorUsuario");
const businessDay = require("./businessDay");
const contexto = require("./contexto");

// Quién tocó qué y cuándo.
//
// Cada vez que los números no cuadraban, lo que hacía falta era esto y no
// existía: un gasto pasaba de S/50 a S/80 y no quedaba rastro; un día se
// cerraba dos veces y tampoco. Reconstruirlo había que hacerlo a mano
// desde el WhatsApp, mensaje por mensaje.
//
// Acá queda una línea por cada cambio que toca plata, con lo que había
// antes y lo que quedó después. No se puede editar ni borrar desde el
// panel a propósito: si se pudiera, dejaría de servir para lo único que
// sirve.
const TOPE = 3000;

const almacen = crearAlmacen("bitacora-data.json", function (parsed) {
  try {
    return { entradas: Array.isArray(parsed.entradas) ? parsed.entradas : [] };
  } catch (err) {
    return { entradas: [] };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;

let contador = 0;
function nuevoId() {
  contador += 1;
  return "bit_" + Date.now() + "_" + contador;
}

// Lo que se guarda de un movimiento: solo lo que se mira cuando algo no
// cuadra. Guardar el objeto entero engordaría el archivo sin dar nada.
function resumirValor(v) {
  if (!v || typeof v !== "object") return v === undefined ? null : v;
  const out = {};
  ["tipo", "monto", "descripcion", "fecha", "hora", "categoriaId", "fuenteId", "localId", "lugarId"].forEach((k) => {
    if (v[k] !== undefined) out[k] = v[k];
  });
  return out;
}

// Qué cambió de verdad entre antes y después. Sin esto la bitácora
// mostraría "se editó" sin decir qué, que es justo lo que no sirve.
function diferencias(antes, despues) {
  const a = resumirValor(antes) || {};
  const d = resumirValor(despues) || {};
  const cambios = [];
  new Set([...Object.keys(a), ...Object.keys(d)]).forEach((k) => {
    if (String(a[k] === undefined ? "" : a[k]) !== String(d[k] === undefined ? "" : d[k])) {
      cambios.push({ campo: k, antes: a[k] === undefined ? null : a[k], despues: d[k] === undefined ? null : d[k] });
    }
  });
  return cambios;
}

// De dónde vino el cambio: del panel, de un mensaje de WhatsApp, o de
// algo que la app hace sola (cerrar el día a las 7am, por ejemplo).
function origenActual() {
  try {
    return contexto.origenActual() || "automatico";
  } catch (err) {
    return "automatico";
  }
}

function registrar({ que, accion, ref, resumen, antes, despues }) {
  // Sin usuario en contexto no hay dónde guardar (ej. un require suelto
  // en una prueba). Mejor no anotar que tumbar lo que se estaba haciendo.
  if (!contexto.hayContexto()) return null;
  try {
    const ahora = businessDay.peruAhora();
    const entrada = {
      id: nuevoId(),
      cuando: ahora.toISOString(),
      fecha: businessDay.businessDayLabel(),
      hora: businessDay.horaLabel(ahora),
      que,
      accion,
      ref: ref || null,
      resumen: resumen || "",
      origen: origenActual(),
      cambios: accion === "edito" ? diferencias(antes, despues) : [],
      antes: accion === "borro" ? resumirValor(antes) : null,
      despues: accion === "creo" ? resumirValor(despues) : null,
    };
    datos().entradas.push(entrada);
    // El archivo no puede crecer para siempre: se quedan las últimas.
    if (datos().entradas.length > TOPE) {
      datos().entradas = datos().entradas.slice(-TOPE);
    }
    save();
    return entrada;
  } catch (err) {
    // Anotar el cambio nunca puede hacer fallar el cambio.
    console.error("No se pudo anotar en la bitácora:", err.message);
    return null;
  }
}

// Las más nuevas primero. "desde"/"hasta" son días laborales (YYYY-MM-DD).
function getEntradas({ desde, hasta, que, limite } = {}) {
  let lista = datos().entradas.slice();
  if (desde) lista = lista.filter((e) => e.fecha >= desde);
  if (hasta) lista = lista.filter((e) => e.fecha <= hasta);
  if (que) lista = lista.filter((e) => e.que === que);
  lista.reverse();
  return limite ? lista.slice(0, limite) : lista;
}

function contar() {
  return datos().entradas.length;
}

module.exports = { registrar, getEntradas, contar };
