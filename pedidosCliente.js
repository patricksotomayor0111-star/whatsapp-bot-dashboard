const numberExceptions = require("./numberExceptions");

// Las dos frases que el bot acepta en REPORTES BOX DELIVERY (y en "Hola", el
// grupo de prueba), de los números autorizados:
//   "Pendiente / Compra de cliente"  y  "Pendiente / Recojo de cliente".
// Desde la tarjeta de Sector Base se prende o apaga cada una con un toque,
// en todos los grupos y números donde está configurada. Es lo mismo que
// hacerlo frase por frase en Palabras clave -> Excepciones.

const TIPOS = {
  compra: /\bcompra de cliente\b/,
  recojo: /\brecojo de cliente\b/,
};

function normalizar(frase) {
  return String(frase || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tipoDe(frase) {
  const t = normalizar(frase);
  return Object.keys(TIPOS).find((tipo) => TIPOS[tipo].test(t)) || null;
}

// { compra: { total, activas }, recojo: { total, activas } }
function estado() {
  const r = {};
  for (const tipo of Object.keys(TIPOS)) r[tipo] = { total: 0, activas: 0 };
  for (const lista of Object.values(numberExceptions.getAllExceptions())) {
    for (const e of lista || []) {
      const tipo = tipoDe(e.phrase);
      if (!tipo) continue;
      r[tipo].total += 1;
      if (e.active !== false) r[tipo].activas += 1;
    }
  }
  return r;
}

function setActivo(tipo, activo) {
  if (!TIPOS[tipo]) throw new Error("Tipo inválido: " + tipo);
  for (const [clave, lista] of Object.entries(numberExceptions.getAllExceptions())) {
    const sep = clave.lastIndexOf("::");
    const groupId = clave.slice(0, sep);
    const numero = clave.slice(sep + 2);
    for (const e of lista || []) {
      if (tipoDe(e.phrase) === tipo) numberExceptions.setExceptionActive(groupId, numero, e.phrase, Boolean(activo));
    }
  }
  return estado();
}

module.exports = { estado, setActivo, tipoDe };
