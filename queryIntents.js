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
    label: "¿Voy bien con mis compromisos? (antes \"cuánto puedo gastar\")",
    frases: ["cuanto puedo gastar hoy", "cuanto puedo gastar", "voy bien"],
    respuesta:
      "✅ Vas bien: con tu efectivo actual ({caja}) y lo que se proyecta generar en lo que queda del mes, cubres tus compromisos pendientes ({pendientes}){lineaAhorro}, con {margen} de sobra.",
    respuestaFaltante:
      "⚠️ Con tu efectivo actual ({caja}) y lo proyectado para lo que queda del mes, todavía te faltan {margen} netos para cubrir tus compromisos pendientes ({pendientes}){lineaAhorro}.",
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
  {
    id: "pagosSemana",
    tipo: "fijo",
    label: "Qué debo pagar esta semana",
    frases: ["que debo pagar esta semana", "que pago esta semana", "pagos de esta semana", "que tengo que pagar esta semana"],
    respuesta: "📅 Pagos de esta semana:\n{lista}\nTotal: {total}",
    respuestaVacia: "No tienes pagos pendientes esta semana. ✅",
  },
  {
    id: "pagosQuincena",
    tipo: "fijo",
    label: "Qué debo pagar esta quincena",
    frases: ["que debo pagar esta quincena", "pagos de esta quincena", "que tengo que pagar esta quincena"],
    respuesta: "📅 Pagos de esta quincena:\n{lista}\nTotal: {total}",
    respuestaVacia: "No tienes pagos pendientes esta quincena. ✅",
  },
  {
    id: "pagosMes",
    tipo: "fijo",
    label: "Qué debo pagar este mes",
    frases: ["que debo pagar este mes", "pagos de este mes", "que falta pagar este mes", "que tengo que pagar este mes"],
    respuesta: "📅 Pagos que faltan este mes:\n{lista}\nTotal: {total}",
    respuestaVacia: "No te falta ningún pago pendiente este mes. ✅",
  },
  {
    id: "gastoMasFuerte",
    tipo: "fijo",
    label: "Cuál es mi gasto más fuerte del mes",
    frases: ["cual es mi gasto mas fuerte", "en que gasto mas", "mi gasto mas fuerte del mes", "cual es mi mayor gasto"],
    respuesta: "Tu gasto más fuerte este mes es {categoria}: {monto}.",
    respuestaVacia: "Todavía no registraste gastos categorizados este mes.",
  },
];

const CAMPOS_RESPUESTA = [
  "respuesta",
  "respuestaVacia",
  "respuestaCumplida",
  "respuestaSinMeta",
  "respuestaSinLimite",
  "respuestaSinCategoria",
  "respuestaFaltante",
];

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
