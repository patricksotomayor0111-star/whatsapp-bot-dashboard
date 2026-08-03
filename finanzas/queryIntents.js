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
    id: "metaProduccionHoy",
    tipo: "fijo",
    label: "Cuánto debo generar hoy (meta de producción)",
    frases: [
      "cuanto debo generar hoy",
      "cuanto tengo que generar hoy",
      "meta de produccion hoy",
      "cuanto necesito generar hoy",
      "cual es mi meta de produccion",
    ],
    respuesta: "🎯 Meta de producción de hoy: {metaHoy}. Llevas {generadoHoy}, te faltan {faltaHoy}.",
    respuestaCumplida: "🎉 ¡Ya cumpliste tu meta de producción de hoy! Llevas {generadoHoy} de {metaHoy} ({excedenteHoy} de más).",
    respuestaSinMeta: "No tienes una meta de producción configurada para este mes. Puedes crearla en el panel (Finanzas → Metas).",
  },
  {
    id: "faltaSemanaProduccion",
    tipo: "fijo",
    label: "Cuánto me falta para terminar la semana (producción)",
    frases: ["cuanto me falta para terminar la semana", "cuanto me falta esta semana", "cuanto me falta para la semana"],
    respuesta: "Esta semana llevas {generado} de tu meta de {meta}. Te faltan {falta}.",
    respuestaCumplida: "🎉 ¡Ya cumpliste tu meta de esta semana! Llevas {generado} de {meta}.",
    respuestaSinMeta: "No tienes una meta de producción configurada para este mes.",
  },
  {
    id: "faltaQuincenaProduccion",
    tipo: "fijo",
    label: "Cuánto me falta para la quincena (producción)",
    frases: ["cuanto me falta para la quincena", "cuanto me falta esta quincena"],
    respuesta: "Esta quincena llevas {generado} de tu meta de {meta}. Te faltan {falta}.",
    respuestaCumplida: "🎉 ¡Ya cumpliste tu meta de esta quincena! Llevas {generado} de {meta}.",
    respuestaSinMeta: "No tienes una meta de producción configurada para este mes.",
  },
  {
    id: "faltaMesProduccion",
    tipo: "fijo",
    label: "Cuánto me falta para terminar el mes (producción)",
    frases: ["cuanto me falta para terminar el mes", "cuanto me falta este mes", "cuanto me falta para el mes"],
    respuesta: "Este mes llevas {generado} de tu meta de producción de {meta}. Te faltan {falta}.",
    respuestaCumplida: "🎉 ¡Ya cumpliste tu meta de producción del mes! Llevas {generado} de {meta}.",
    respuestaSinMeta: "No tienes una meta de producción configurada para este mes.",
  },
  {
    id: "ahorradoMes",
    tipo: "fijo",
    label: "Cuánto llevo ahorrado",
    frases: ["cuanto llevo ahorrado", "cuanto tengo ahorrado", "cuanto he ahorrado"],
    respuesta: "Llevas ahorrado {ahorrado} este mes (ganancias menos gastos).",
  },
  {
    id: "faltaMeta",
    tipo: "prefijo",
    label: "Cuánto me falta / debo para [meta o pago] (ej. Universidad, Cuzco, Terreno)",
    frases: ["cuanto me falta para", "cuanto debo para", "cuanto falta para"],
    respuesta: "{categoria}: llevas {pagado} de {meta}, te faltan {restante} ({porcentaje}%).",
    respuestaRecordatorio: "{label}: {monto}, próximo vencimiento {proxima}.",
    respuestaSinCategoria: 'No encontré ninguna meta ni pago configurado como "{categoria}".',
  },
  {
    id: "pagosManana",
    tipo: "fijo",
    label: "Qué pagos tengo mañana",
    frases: ["que pagos tengo manana", "que debo pagar manana", "pagos de manana"],
    respuesta: "📅 Pagos de mañana:\n{lista}\nTotal: {total}",
    respuestaVacia: "No tienes pagos para mañana. ✅",
  },
  {
    id: "proyeccionMes",
    tipo: "fijo",
    label: "Cuál es mi proyección para este mes",
    frases: ["cual es mi proyeccion", "proyeccion para este mes", "proyeccion del mes"],
    respuesta:
      "📊 Proyección del mes\n✅ Ganancias hasta hoy: {ganancias}\n📉 Gastos hasta hoy: {gastos}\n📌 Compromisos del mes: {compromisos}\n🗓️ Gastos programados que faltan: {gastosProgramados}",
  },
  {
    id: "cumplireMetas",
    tipo: "fijo",
    label: "Si sigo así, ¿cumpliré todas mis metas?",
    frases: ["si sigo asi cumplire", "voy a cumplir mis metas", "cumplire todas mis metas", "cumplire mis metas"],
    respuesta: "✅ Sí, si mantienes este ritmo vas a cumplir tus metas — vas con {margen} de sobra.",
    respuestaFaltante: "⚠️ Al ritmo actual, no cumplirías todas tus metas: te faltarían {margen} netos.",
  },
  {
    id: "promedioDiario",
    tipo: "fijo",
    label: "Cuál es mi promedio diario",
    frases: ["cual es mi promedio diario", "mi promedio diario", "promedio diario"],
    respuesta: "Tu promedio diario este mes es {promedio}.",
  },
  {
    id: "metaDiariaTodasMetas",
    tipo: "fijo",
    label: "Cuánto necesito generar por día para llegar a todas mis metas",
    frases: ["cuanto necesito generar por dia", "cuanto necesito generar al dia para todas mis metas", "cuanto necesito para llegar a todas mis metas"],
    respuesta: "Para llegar a todas tus metas necesitas generar {metaDiariaReal} netos por día (te faltan {necesidadFaltante} en total).",
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
  "respuestaRecordatorio",
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
