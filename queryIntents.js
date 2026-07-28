const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("query-intents-data.json");

// Cada consulta tiene: un tipo ("fijo" = frase que puede aparecer en
// cualquier parte del mensaje; "prefijo" = el mensaje debe EMPEZAR con la
// frase, y lo que sigue es la variable, ej. el nombre de una persona o
// una categoría), una lista de frases editable, y el texto de la
// respuesta (también editable, con {placeholders} que el bot reemplaza
// por datos reales). Solo se usan como semilla la primera vez.
const DEFAULTS = [
  {
    id: "deudaPersona",
    tipo: "prefijo",
    label: "Cuánto me debe [persona]",
    frases: ["cuanto me debe", "cuanto debe"],
    respuesta: "{persona} te debe {monto}.",
    respuestaVacia: "{persona} no te debe nada. ✅",
  },
  {
    id: "quienDebe",
    tipo: "fijo",
    label: "Quién me debe",
    frases: ["quien me debe", "quien debe"],
    respuesta: "👥 Te deben:\n{lista}",
    respuestaVacia: "Nadie te debe nada ahora mismo. ✅",
  },
  {
    id: "gastarCategoria",
    tipo: "prefijo",
    label: "Cuánto puedo gastar en [categoría]",
    frases: ["cuanto puedo gastar en"],
    respuesta: "En {categoria} ya gastaste {gastado} de {limite}. Puedes gastar {disponible} más.",
    respuestaSinLimite: "{categoria} no tiene límite mensual configurado.",
    respuestaSinCategoria: 'No tengo una categoría configurada como "{categoria}".',
  },
  {
    id: "gastarHoy",
    tipo: "fijo",
    label: "Cuánto puedo gastar hoy",
    frases: ["cuanto puedo gastar hoy", "cuanto puedo gastar"],
    respuesta: "Tu meta de hoy es {meta} y ya gastaste {gastos}. Puedes gastar hasta {disponible} más sin pasarte.",
    respuestaSinMeta: "Todavía no configuraste una meta de ganancia diaria (Finanzas → Metas en el panel), así que no puedo calcular esto.",
  },
  {
    id: "vendiHoy",
    tipo: "fijo",
    label: "Cuánto vendí/gané hoy",
    frases: ["cuanto vendi hoy", "cuanto gane hoy", "cuanto ingrese hoy"],
    respuesta: "Hoy llevas {ganancias} en ganancias.",
  },
  {
    id: "gasteHoy",
    tipo: "fijo",
    label: "Cuánto gasté hoy",
    frases: ["cuanto gaste hoy", "cuanto gasto hoy"],
    respuesta: "Hoy gastaste {gastos}.",
  },
  {
    id: "caja",
    tipo: "fijo",
    label: "Cuánto tengo en caja",
    frases: ["cuanto tengo en caja", "cuanto hay en caja"],
    respuesta: "Efectivo esperado en caja: {esperado}.",
  },
  {
    id: "metaHoy",
    tipo: "fijo",
    label: "Meta de hoy",
    frases: ["meta de hoy"],
    respuesta: "Meta de hoy: {meta}. Llevas {ganancias}, te faltan {falta}.",
    respuestaCumplida: "¡Ya cumpliste tu meta de hoy! Llevas {ganancias} de {meta}. 🎉",
    respuestaSinMeta: "No tienes una meta diaria configurada. Puedes ponerla en el panel (Finanzas → Metas).",
  },
  {
    id: "resumenDia",
    tipo: "fijo",
    label: "Resumen del día",
    frases: ["resumen del dia", "resumen de hoy"],
    respuesta: "📦 Resumen del día\n✅ Ganancias: {ganancias}\n📉 Gastos: {gastos}\n💰 Total: {total}\n💵 Efectivo esperado: {esperado}",
  },
  {
    id: "resumenMes",
    tipo: "fijo",
    label: "Resumen del mes / cómo voy",
    frases: ["resumen del mes", "como voy este mes", "como voy"],
    respuesta: "🗓️ Resumen del mes\n✅ Ganancias: {ganancias}\n📉 Gastos: {gastos}\n💰 Neto: {neto}",
  },
  {
    id: "faltante",
    tipo: "fijo",
    label: "Faltantes acumulados",
    frases: ["faltante", "faltantes"],
    respuesta: "Faltante acumulado en total: {total}.",
  },
];

const CAMPOS_RESPUESTA = ["respuesta", "respuestaVacia", "respuestaCumplida", "respuestaSinMeta", "respuestaSinLimite", "respuestaSinCategoria"];

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      intents: Array.isArray(parsed.intents) && parsed.intents.length ? parsed.intents : DEFAULTS.map((i) => ({ ...i })),
    };
  } catch (err) {
    return { intents: DEFAULTS.map((i) => ({ ...i })) };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar query-intents-data.json:", err.message);
  }
}

function getIntents() {
  return data.intents;
}

function getIntent(id) {
  return data.intents.find((i) => i.id === id) || null;
}

function normalizarFrase(frase) {
  return String(frase || "").trim().toLowerCase();
}

function addFrase(id, frase) {
  const intent = getIntent(id);
  if (!intent) throw new Error("Consulta inválida: " + id);
  const f = normalizarFrase(frase);
  if (!f) throw new Error("La frase no puede estar vacía.");
  if (!intent.frases.includes(f)) intent.frases.push(f);
  save();
  return intent;
}

function removeFrase(id, frase) {
  const intent = getIntent(id);
  if (!intent) return null;
  const f = normalizarFrase(frase);
  intent.frases = intent.frases.filter((x) => x !== f);
  save();
  return intent;
}

function setRespuesta(id, campo, texto) {
  const intent = getIntent(id);
  if (!intent) throw new Error("Consulta inválida: " + id);
  if (!CAMPOS_RESPUESTA.includes(campo)) throw new Error("Campo de respuesta inválido: " + campo);
  intent[campo] = String(texto || "");
  save();
  return intent;
}

module.exports = { getIntents, getIntent, addFrase, removeFrase, setRespuesta };
