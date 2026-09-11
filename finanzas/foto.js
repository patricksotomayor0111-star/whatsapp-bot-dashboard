const Anthropic = require("@anthropic-ai/sdk");

// Leer una foto y sacar de ahí los datos.
//
// DOS REGLAS, heredadas de aiClassifier.js:
//   1. Sin ANTHROPIC_API_KEY esto no existe: la app sigue funcionando y se
//      carga todo a mano, como siempre. Nunca puede romper lo que ya anda.
//   2. Si la IA falla o tarda de más, se devuelve el error y el usuario
//      carga a mano. Nunca se inventan datos para "rellenar".
//
// Dos modos, que son dos cosas distintas:
//
//   "pedido" — fotografías LO QUE TE PIDIERON: la lista escrita a mano, la
//   comanda, el pedido que llegó por WhatsApp. Salen los productos y las
//   cantidades, y con eso se arma TU nota de venta, con TUS datos. Esto es
//   lo que te ahorra el tipeo, que es el trabajo de verdad.
//
//   "gasto" — fotografías la boleta que TE DIERON al comprar. Sale el
//   comercio, la fecha y el total, y eso entra como gasto a tus finanzas.
//   El resultado es un registro, no un papel para imprimir.

// Opus 5 por defecto: leer letra manuscrita torcida, con sombra y en papel
// arrugado es justo donde se nota el modelo. Si el volumen de fotos crece y
// pesa más el costo que el acierto, se baja a "claude-haiku-4-5" desde la
// variable de entorno, sin tocar el código.
const MODELO = (process.env.ANTHROPIC_MODELO_FOTO || "").trim() || "claude-opus-5";
const TIMEOUT_MS = 45000;
const MAX_BYTES = 5 * 1024 * 1024;

function disponible() {
  return Boolean((process.env.ANTHROPIC_API_KEY || "").trim());
}

// Un ítem, igual en los dos modos. "confianza" es lo que pinta el semáforo
// 🟢/🟡 en la pantalla de revisión: sirve para mirar solo lo dudoso en vez
// de releer todo.
const ITEM = {
  type: "object",
  properties: {
    descripcion: { type: "string" },
    cantidad: { type: "number" },
    // Texto y no número: en la foto puede decir "3,50" o estar borroso, y
    // convertir a centavos es trabajo de documento.js, que ya sabe leer
    // todas las formas en que se escribe un precio.
    precioUnitario: { type: ["string", "null"] },
    confianza: { type: "string", enum: ["alta", "media", "baja"] },
  },
  required: ["descripcion", "cantidad", "precioUnitario", "confianza"],
  additionalProperties: false,
};

const ESQUEMA_PEDIDO = {
  type: "object",
  properties: {
    items: { type: "array", items: ITEM },
    // Para poder avisar cuando la foto no es lo que el modo esperaba.
    tipoDeFoto: {
      type: "string",
      enum: ["lista_manuscrita", "pedido_chat", "comprobante_ajeno", "otro"],
    },
    avisos: { type: "array", items: { type: "string" } },
  },
  required: ["items", "tipoDeFoto", "avisos"],
  additionalProperties: false,
};

const ESQUEMA_GASTO = {
  type: "object",
  properties: {
    comercio: { type: ["string", "null"] },
    ruc: { type: ["string", "null"] },
    fecha: { type: ["string", "null"] },
    items: { type: "array", items: ITEM },
    total: { type: ["string", "null"] },
    igv: { type: ["string", "null"] },
    confianza: {
      type: "object",
      properties: {
        comercio: { type: "string", enum: ["alta", "media", "baja"] },
        ruc: { type: "string", enum: ["alta", "media", "baja"] },
        fecha: { type: "string", enum: ["alta", "media", "baja"] },
        total: { type: "string", enum: ["alta", "media", "baja"] },
      },
      required: ["comercio", "ruc", "fecha", "total"],
      additionalProperties: false,
    },
    avisos: { type: "array", items: { type: "string" } },
  },
  required: ["comercio", "ruc", "fecha", "items", "total", "igv", "confianza", "avisos"],
  additionalProperties: false,
};

// Lo común a los dos modos. Lo importante acá es la instrucción de NO
// inventar: en una foto movida es preferible un campo vacío marcado en
// amarillo que un precio inventado que se imprime y se cobra.
const BASE = `Estás leyendo la foto que tomó el dueño de un negocio en Perú.

REGLAS QUE NO SE ROMPEN:
- No inventes NADA. Si un dato no se lee, va null y con confianza "baja".
  Un campo vacío se corrige en dos segundos; un precio inventado se imprime
  y se cobra mal.
- Los precios van tal como aparecen ("3.50", "3,50", "S/ 3.50"). No los
  conviertas ni los redondees.
- Si no hay precio, precioUnitario va null: se completa desde el catálogo.
- La cantidad por defecto es 1 cuando no está escrita.
- Marca confianza "media" o "baja" cuando la letra sea dudosa, el papel
  esté arrugado o doblado, o haya sombra encima del dato.
- En "avisos" escribe en español y para una persona, no para un programa
  ("la última línea está tapada por el doblez del papel").`;

const PROMPT_PEDIDO = `${BASE}

Es la foto de UN PEDIDO: una lista escrita a mano, una comanda, una nota
de un cuaderno o la captura de un pedido que llegó por WhatsApp. Saca los
productos y las cantidades para armar la nota de venta del dueño.

Si la foto resulta ser el comprobante de OTRO negocio, pon tipoDeFoto en
"comprobante_ajeno" y saca ÚNICAMENTE los productos y cantidades. No
extraigas el nombre del comercio, su RUC, su serie, su número ni su logo:
el documento que se va a emitir es del dueño y lleva los datos del dueño.`;

const PROMPT_GASTO = `${BASE}

Es la foto del comprobante que le DIERON al dueño al comprar algo. Sirve
para registrar el gasto en sus finanzas.

Saca el comercio, su RUC, la fecha, los productos y el total. El RUC
peruano tiene 11 dígitos: si cuentas menos, es que no se leyó bien y la
confianza es "baja". La fecha en formato AAAA-MM-DD. Ojo con el IGV: en
Perú los precios de mostrador ya lo incluyen, así que el total es lo que
se pagó.`;

// Una promesa que se rinde a tiempo. Sin esto, una foto pesada con mala
// señal deja la pantalla colgada sin decir nada.
function conTimeout(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((_, rechazar) =>
      setTimeout(() => rechazar(new Error("La lectura tardó demasiado. Probá con una foto más liviana.")), ms)),
  ]);
}

function validarImagen(base64, mediaType) {
  if (!base64) throw new Error("No llegó ninguna imagen.");
  if (!/^image\/(jpeg|png|webp|gif)$/.test(String(mediaType || ""))) {
    throw new Error("Formato no soportado. Usá JPG, PNG o WEBP.");
  }
  // base64 ocupa 4 caracteres por cada 3 bytes.
  if (Math.floor(base64.length * 0.75) > MAX_BYTES) {
    throw new Error("La foto es muy pesada (máximo 5MB). Achicala antes de subirla.");
  }
}

async function leer(base64, mediaType, prompt, esquema) {
  if (!disponible()) {
    throw new Error("Falta la llave ANTHROPIC_API_KEY: por ahora hay que cargar a mano.");
  }
  validarImagen(base64, mediaType);

  const client = new Anthropic();
  const respuesta = await conTimeout(
    client.messages.create({
      model: MODELO,
      max_tokens: 16000,
      // Sacar datos de una foto es mecánico, no requiere darle vueltas, y
      // acá lo que importa es que la pantalla conteste rápido.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: esquema },
      },
      messages: [{
        role: "user",
        content: [
          // La imagen ANTES del texto: es lo recomendado y se nota en la
          // calidad de la lectura.
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: prompt },
        ],
      }],
    }),
    TIMEOUT_MS,
  );

  if (respuesta.stop_reason === "refusal") {
    throw new Error("No se pudo leer esta foto.");
  }

  const texto = respuesta.content.find((b) => b.type === "text");
  if (!texto) throw new Error("La respuesta vino vacía.");

  try {
    return JSON.parse(texto.text);
  } catch (err) {
    throw new Error("La respuesta no se pudo interpretar. Volvé a intentar.");
  }
}

function leerPedido(base64, mediaType) {
  return leer(base64, mediaType, PROMPT_PEDIDO, ESQUEMA_PEDIDO);
}

function leerGasto(base64, mediaType) {
  return leer(base64, mediaType, PROMPT_GASTO, ESQUEMA_GASTO);
}

// Traduce un error de la API a algo que se pueda mostrar en pantalla. Los
// mensajes crudos del SDK no le dicen nada a quien está en el mostrador.
function mensajeDeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "La llave de la API no es válida.";
  if (err instanceof Anthropic.RateLimitError) return "Demasiadas fotos seguidas. Esperá unos segundos.";
  if (err instanceof Anthropic.BadRequestError) return "La foto no se pudo procesar. Probá con otra.";
  if (err instanceof Anthropic.APIError) return "No se pudo conectar con el servicio de lectura.";
  return err.message || "Algo salió mal leyendo la foto.";
}

module.exports = { disponible, leerPedido, leerGasto, mensajeDeError, MODELO };
