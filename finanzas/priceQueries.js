const productPrices = require("./productPrices");

// Consultas de precios escritas en el grupo, en el lenguaje de todos los
// días: "six pack pilsen mas barato", "cuanto esta el vino tabernero",
// "precio de grapas artesco", "salvatore".
//
// El grupo se usa para DOS cosas a la vez (anotar precios y preguntar), así
// que hay que distinguirlas sin ambigüedad: si el mensaje arranca con un
// número es un registro (lo resuelve productPrices.parsePriceLine antes de
// llegar acá); si no, se busca una intención de consulta.

const MAS_BARATO = ["mas barato", "más barato", "mas economico", "más económico", "el menor", "mas bajo", "más bajo"];
const MAS_CARO = ["mas caro", "más caro", "el mayor", "mas alto", "más alto"];
// Sirven para preguntar sin decir barato/caro: devuelven la lista completa.
const DISPARADORES_LISTA = [
  "precio de", "precios de", "precio", "precios",
  "cuanto esta", "cuánto está", "cuanto cuesta", "cuánto cuesta",
  "cuanto vale", "cuánto vale", "donde compro", "dónde compro",
];

const MAX_RESULTADOS = 6;

function formatearPrecio(n) {
  return Number.isInteger(n) ? `S/ ${n}` : `S/ ${n.toFixed(2)}`;
}

// Saca la frase disparadora del texto y devuelve lo que queda: eso es lo
// que se busca. "six pack pilsen mas barato" -> "six pack pilsen".
function quitarFrase(textoNorm, frases) {
  for (const f of frases) {
    const fNorm = productPrices.normalizar(f);
    if (textoNorm.includes(fNorm)) {
      return textoNorm.replace(fNorm, " ").replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

function armarRespuesta(titulo, resultados, modo) {
  if (resultados.length === 0) {
    return `🏷️ ${titulo}\n\nNo tengo ningún precio anotado con eso.`;
  }

  // buscar() ya devuelve de más barato a más caro.
  const ordenados = modo === "caro" ? resultados.slice().reverse() : resultados;
  const destacado = ordenados[0];
  const resto = ordenados.slice(1, MAX_RESULTADOS);

  const etiqueta = modo === "caro" ? "Más caro" : "Más barato";
  let salida = `🏷️ ${titulo}\n\n✅ ${etiqueta}: ${formatearPrecio(destacado.precio)}\n   ${destacado.descripcion}`;

  if (resto.length > 0) {
    salida += "\n\nTambién:";
    resto.forEach((r) => {
      salida += `\n   ${formatearPrecio(r.precio)} — ${r.descripcion}`;
    });
  }
  if (resultados.length > MAX_RESULTADOS) {
    salida += `\n\n(hay ${resultados.length - MAX_RESULTADOS} más)`;
  }
  return salida;
}

// Devuelve el texto a responder, o null si el mensaje no era una consulta
// de precios (y entonces el bot no contesta nada).
function responderConsultaPrecio(rawText) {
  const texto = productPrices.normalizar(rawText);
  if (!texto) return null;

  const resolver = (terminos, modo) => {
    // Se limpian los conectores ("el", "de"...) antes de buscar Y antes de
    // mostrar el título, si no queda un "six pack pilsen el" feo y sin
    // resultados.
    const limpio = productPrices.palabrasBusqueda(terminos).join(" ");
    if (!limpio) return null; // "precio" o "mas barato" a secas: no dice qué buscar
    return armarRespuesta(limpio, productPrices.buscar(limpio), modo);
  };

  let terminos = quitarFrase(texto, MAS_BARATO);
  if (terminos !== null) return resolver(terminos, "barato");

  terminos = quitarFrase(texto, MAS_CARO);
  if (terminos !== null) return resolver(terminos, "caro");

  terminos = quitarFrase(texto, DISPARADORES_LISTA);
  if (terminos !== null) return resolver(terminos, "barato");

  return null;
}

module.exports = { responderConsultaPrecio, formatearPrecio };
