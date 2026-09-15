// Este archivo corre en el servidor Y en el navegador. Las dos formas de
// traer las dependencias porque el navegador no tiene require().
const doc = typeof require === "function" ? require("./documento") : self.Documento;
const impresoras = typeof require === "function" ? require("./impresoras") : self.Impresoras;

// Bytes con Uint8Array y no con Buffer: Buffer solo existe en Node, y la
// impresión tiene que poder armarse en el celular sin pasar por el
// servidor. Sin esto, quedarse sin señal en el mostrador significaría no
// poder imprimir aunque la impresora esté a treinta centímetros.
function B(arr) {
  return Uint8Array.from(arr);
}

function unir(partes) {
  let largo = 0;
  partes.forEach((p) => { largo += p.length; });
  const salida = new Uint8Array(largo);
  let i = 0;
  partes.forEach((p) => { salida.set(p, i); i += p.length; });
  return salida;
}

// Render para impresora térmica.
//
// El papel térmico no tiene tipografía proporcional: imprime una grilla de
// caracteres de ancho fijo. Por eso el layout no es "posicionar cajas",
// es armar líneas de N columnas. Y por eso la vista previa puede ser
// EXACTA: si la previa se arma con las mismas líneas que se le mandan a la
// impresora, lo que ves es literalmente lo que sale.

// Qué impresora es. Acepta el nombre de un modelo ("pos-8001dd"), un
// ancho de papel ("58" / "80") o un perfil ya armado.
function perfil(entrada) {
  return impresoras.perfilDe(entrada);
}

// De las opciones de impresión sale siempre un perfil: "perfil" si vino,
// y si no el ancho suelto, por compatibilidad con las llamadas viejas.
function perfilDeOpciones(opciones = {}) {
  return perfil(opciones.perfil || opciones.ancho);
}

// ---------- Texto en grilla ----------

// Corta el texto en líneas de a lo más "ancho" caracteres, respetando las
// palabras. Las palabras más largas que el ancho se parten a la fuerza:
// si no, la impresora las corta ella sola donde le da la gana y descuadra
// todo lo que viene después (un código de producto largo alcanza para
// arruinar la alineación del resto del documento).
function envolver(texto, ancho) {
  const palabras = String(texto || "").split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [""];

  const lineas = [];
  let actual = "";
  palabras.forEach((palabra) => {
    while (palabra.length > ancho) {
      if (actual) {
        lineas.push(actual);
        actual = "";
      }
      lineas.push(palabra.slice(0, ancho));
      palabra = palabra.slice(ancho);
    }
    if (!actual) {
      actual = palabra;
    } else if (actual.length + 1 + palabra.length <= ancho) {
      actual += " " + palabra;
    } else {
      lineas.push(actual);
      actual = palabra;
    }
  });
  if (actual) lineas.push(actual);
  return lineas;
}

// Una línea con algo pegado a la izquierda y algo pegado a la derecha.
// Si no entran los dos, se recorta la izquierda: el importe de la derecha
// es lo que no se puede perder.
function columnas(izquierda, derecha, ancho) {
  const der = String(derecha || "");
  let izq = String(izquierda || "");
  const espacio = ancho - der.length;
  if (espacio <= 0) return der.slice(-ancho);
  if (izq.length > espacio - 1) izq = izq.slice(0, Math.max(0, espacio - 1));
  return izq + " ".repeat(ancho - izq.length - der.length) + der;
}

function separador(ancho, caracter = "-") {
  return caracter.repeat(ancho);
}

// ---------- Armado del documento ----------

function fechaLegible(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

// Un ítem ocupa una línea o dos según el ancho del papel. En 58 mm no hay
// forma de meter descripción, cantidad, precio e importe en 32 columnas
// sin que la descripción quede en tres letras, así que va en su propia
// línea y debajo el cálculo.
// Ancho de las columnas numéricas, calculado sobre TODOS los ítems.
// Si cada línea usara el ancho de su propio cálculo, "2 x 3.00" y
// "1 x 12.90" quedarían empezando en columnas distintas y la lista se
// leería torcida.
function columnasDeItems(items) {
  let calculo = 0;
  let importe = 0;
  items.forEach((item) => {
    calculo = Math.max(calculo, `${doc.cantidadATexto(item.cantidad)} x ${doc.aTexto(item.precioUnitario)}`.length);
    importe = Math.max(importe, doc.aTexto(doc.importeDe(item)).length);
  });
  return { calculo, importe };
}

function lineasDeItem(item, ancho, cols) {
  const importe = doc.aTexto(doc.importeDe(item));
  const calculo = `${doc.cantidadATexto(item.cantidad)} x ${doc.aTexto(item.precioUnitario)}`;
  const descripcion = item.descripcion || "(sin descripción)";
  const salida = [];

  if (ancho >= 42) {
    // En 80 mm entra todo en una línea mientras la descripción no sea
    // larguísima; si lo es, se envuelve y el cálculo va en la última.
    const anchoCalculo = cols.calculo + 2;
    const anchoImporte = cols.importe + 2;
    const anchoDescripcion = ancho - anchoCalculo - anchoImporte;
    const partes = envolver(descripcion, anchoDescripcion);
    partes.forEach((parte, i) => {
      if (i < partes.length - 1) {
        salida.push({ texto: parte });
        return;
      }
      salida.push({
        texto: parte.padEnd(anchoDescripcion) +
          calculo.padStart(anchoCalculo) +
          importe.padStart(anchoImporte),
      });
    });
  } else {
    envolver(descripcion, ancho).forEach((parte) => salida.push({ texto: parte }));
    salida.push({ texto: columnas("  " + calculo, importe, ancho) });
  }

  if (item.descuento > 0) {
    salida.push({ texto: columnas("  Descuento", "-" + doc.aTexto(item.descuento), ancho) });
  }
  return salida;
}

// Convierte el documento en la lista de líneas que se van a imprimir.
// Cada línea lleva su alineación y su énfasis, y esa MISMA lista alimenta
// tanto la vista previa como los bytes de la impresora.
// ---------- Plantillas ----------
//
// El orden de los bloques era código; ahora son datos. Es lo que permite
// editarlo sin tocar el programa, y es lo único que hay para editar: el
// papel térmico no tiene coordenadas ni tipografías, solo una secuencia de
// líneas con su alineación. "Mover un elemento" es cambiarlo de lugar en
// esta lista, nada más.
const PREDETERMINADA = [
  { tipo: "logo" },
  { tipo: "campo", campo: "emisor.nombre", align: "center", negrita: true },
  { tipo: "campo", campo: "emisor.ruc", prefijo: "RUC: ", align: "center" },
  { tipo: "campo", campo: "emisor.direccion", align: "center" },
  { tipo: "campo", campo: "emisor.telefono", prefijo: "Tel: ", align: "center" },
  { tipo: "espacio" },
  { tipo: "campo", campo: "tipo", align: "center", negrita: true },
  { tipo: "campo", campo: "numero", align: "center" },
  { tipo: "separador", caracter: "-" },
  { tipo: "par", etiqueta: "Fecha:", campo: "fecha" },
  { tipo: "campo", campo: "cliente", prefijo: "Cliente: " },
  { tipo: "separador", caracter: "-" },
  { tipo: "items" },
  { tipo: "separador", caracter: "-" },
  { tipo: "totales" },
  { tipo: "pago" },
  { tipo: "codigoBarras" },
  { tipo: "qr" },
  { tipo: "pie" },
];

// Saca el valor de un campo del documento. Acepta "emisor.nombre" para
// llegar a lo anidado sin tener que enumerar cada caso.
function valorDe(d, campo) {
  if (campo === "tipo") return doc.TIPOS[d.tipo] || "";
  if (campo === "fecha") return fechaLegible(d.fecha);
  let v = d;
  for (const parte of String(campo || "").split(".")) {
    if (v === null || v === undefined) return "";
    v = v[parte];
  }
  return v === null || v === undefined ? "" : String(v);
}

// Dibuja un bloque. Un bloque sin dato NO deja rastro: si no cargaste
// teléfono, no queda una línea en blanco donde iría. Por eso la plantilla
// puede tener todos los campos y adaptarse a cada negocio sola.
function dibujarBloque(b, d, ctx) {
  const { L, ancho, texto } = ctx;
  const estilo = { align: b.align || "left", negrita: Boolean(b.negrita), tamano: b.tamano === 2 ? 2 : 1 };
  // A tamaño doble cada carácter ocupa el doble, así que en la fila entran
  // la mitad. Calcular las columnas sobre el ancho completo hace que la
  // línea se desborde y la impresora la parta donde le toque, descuadrando
  // todo lo que viene después.
  const util = estilo.tamano === 2 ? Math.floor(ancho / 2) : ancho;

  switch (b.tipo) {
    case "logo":
      if (d.logo) L.push({ tipo: "imagen", imagen: d.logo, align: b.align || "center" });
      return;

    case "texto":
      if (b.texto) texto(b.texto, estilo);
      return;

    case "campo": {
      const v = valorDe(d, b.campo);
      if (v) texto((b.prefijo || "") + v + (b.sufijo || ""), estilo);
      return;
    }

    case "par": {
      // Etiqueta a la izquierda, valor pegado a la derecha.
      const v = valorDe(d, b.campo);
      if (v) L.push({ tipo: "texto", texto: columnas(b.etiqueta || "", v, util), ...estilo, align: "left" });
      return;
    }

    case "separador":
      L.push({ tipo: "separador", texto: separador(ancho, b.caracter || "-") });
      return;

    case "espacio":
      for (let n = 0; n < Math.max(1, Number(b.lineas) || 1); n++) L.push({ tipo: "espacio" });
      return;

    case "items":
      d.items.forEach((item) => {
        lineasDeItem(item, ancho, ctx.cols).forEach((linea) => L.push({ tipo: "texto", align: "left", ...linea }));
      });
      return;

    case "totales": {
      const t = d.totales;
      // El subtotal y el IGV van siempre a tamaño normal: el doble se
      // reserva para el TOTAL, que es el número que el cliente busca.
      if (t.descuentoGlobal > 0) {
        L.push({ tipo: "texto", texto: columnas("Descuento:", "-S/ " + doc.aTexto(t.descuentoGlobal), ancho) });
      }
      if (d.mostrarIgv && t.tasa > 0) {
        L.push({ tipo: "texto", texto: columnas("SUBTOTAL:", "S/ " + doc.aTexto(t.subtotal), ancho) });
        L.push({ tipo: "texto", texto: columnas(`IGV (${Math.round(t.tasa * 100)}%):`, "S/ " + doc.aTexto(t.igv), ancho) });
      }
      L.push({
        tipo: "texto",
        texto: columnas("TOTAL:", "S/ " + doc.aTexto(t.total), util),
        negrita: true,
        tamano: estilo.tamano,
      });
      return;
    }

    case "pago": {
      if (!d.pago) return;
      L.push({ tipo: "espacio" });
      if (d.pago.medio) L.push({ tipo: "texto", texto: columnas("Pago:", d.pago.medio, ancho) });
      if (d.pago.recibido) {
        L.push({ tipo: "texto", texto: columnas("Recibido:", "S/ " + doc.aTexto(d.pago.recibido), ancho) });
        const v = doc.vuelto(d);
        if (v !== null && v >= 0) L.push({ tipo: "texto", texto: columnas("Vuelto:", "S/ " + doc.aTexto(v), ancho) });
      }
      return;
    }

    case "qr":
      if (d.qr && d.qr.contenido) {
        L.push({ tipo: "espacio" });
        L.push({ tipo: "qr", contenido: d.qr.contenido, tamano: b.tamano || d.qr.tamano, align: b.align || "center" });
      }
      return;

    case "codigoBarras":
      if (d.codigoBarras && d.codigoBarras.contenido) {
        L.push({ tipo: "espacio" });
        L.push({ tipo: "codigoBarras", contenido: d.codigoBarras.contenido, align: b.align || "center" });
      }
      return;

    case "pie":
      if (d.pie) {
        L.push({ tipo: "espacio" });
        texto(d.pie, { align: b.align || "center", negrita: estilo.negrita, tamano: estilo.tamano });
      }
      return;

    default:
      // Un bloque de un tipo desconocido se ignora en vez de romper. Una
      // plantilla vieja con algo que ya no existe tiene que seguir
      // imprimiendo el resto.
      return;
  }
}

// La marca de demostración NO sale de la plantilla: la pone el render a
// partir de la bandera del documento. Si fuera un bloque más, se podría
// borrar desde el editor y dejaría de cumplir su función.
function marcaDemo(d, ctx, donde) {
  if (!d.demo) return;
  const { L, ancho, texto } = ctx;
  if (donde === "arriba") {
    L.push({ tipo: "separador", texto: separador(ancho, "*") });
    texto("DOCUMENTO DE DEMOSTRACIÓN", { align: "center", negrita: true });
    texto("NO VÁLIDO COMO COMPROBANTE FISCAL", { align: "center" });
    L.push({ tipo: "separador", texto: separador(ancho, "*") });
    L.push({ tipo: "espacio" });
  } else {
    L.push({ tipo: "espacio" });
    L.push({ tipo: "separador", texto: separador(ancho, "*") });
    texto("DEMO — NO VÁLIDO COMO COMPROBANTE FISCAL", { align: "center", negrita: true });
    L.push({ tipo: "separador", texto: separador(ancho, "*") });
  }
}

function componer(documento, opciones = {}) {
  const d = doc.normalizar(documento);
  const ancho = perfilDeOpciones(opciones).columnas;
  const plantilla = Array.isArray(opciones.plantilla) && opciones.plantilla.length
    ? opciones.plantilla
    : PREDETERMINADA;

  const L = [];
  const texto = (t, extra = {}) => envolver(String(t), extra.tamano === 2 ? Math.floor(ancho / 2) : ancho)
    .forEach((linea) => L.push({ tipo: "texto", texto: linea, align: "left", ...extra }));

  const ctx = { L, ancho, texto, cols: columnasDeItems(d.items) };

  marcaDemo(d, ctx, "arriba");
  plantilla.forEach((b) => dibujarBloque(b, d, ctx));
  marcaDemo(d, ctx, "abajo");

  return { ancho, lineas: L };
}

// Vista previa en texto plano, para revisar en consola o en el navegador
// con tipografía monoespaciada. Los bloques gráficos se marcan con su
// lugar reservado para que la altura de la previa sea realista.
function previa(documento, opciones = {}) {
  const { ancho, lineas } = componer(documento, opciones);
  const centrar = (t) => {
    const sobra = ancho - t.length;
    return sobra > 0 ? " ".repeat(Math.floor(sobra / 2)) + t : t;
  };

  return lineas
    .map((l) => {
      if (l.tipo === "espacio") return "";
      if (l.tipo === "qr") return centrar("[ QR ]");
      if (l.tipo === "codigoBarras") return centrar("[ CÓDIGO DE BARRAS ]");
      if (l.tipo === "imagen") return centrar("[ LOGO ]");
      const t = l.texto || "";
      if (l.align === "center") return centrar(t);
      if (l.align === "right") return t.padStart(ancho);
      return t;
    })
    .join("\n");
}

// ---------- ESC/POS ----------

// La impresora no entiende UTF-8: recibe un byte por carácter e
// interpreta según la página de códigos que tenga seleccionada. Si se le
// manda UTF-8 crudo, cada "ñ" o "é" sale como dos símbolos raros. Se
// selecciona CP850 (ESC t 2) y se traduce lo que se sale del ASCII.
const CP850 = {
  "ç": 0x87, "ü": 0x81, "é": 0x82, "â": 0x83, "ä": 0x84, "à": 0x85, "ê": 0x88,
  "ë": 0x89, "è": 0x8a, "ï": 0x8b, "î": 0x8c, "ì": 0x8d, "Ä": 0x8e, "Ç": 0x80,
  "É": 0x90, "ô": 0x93, "ö": 0x94, "ò": 0x95, "û": 0x96, "ù": 0x97, "Ö": 0x99,
  "Ü": 0x9a, "á": 0xa0, "í": 0xa1, "ó": 0xa2, "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5,
  "ª": 0xa6, "º": 0xa7, "¿": 0xa8, "¡": 0xad, "Á": 0xb5, "Â": 0xb6, "À": 0xb7,
  "Í": 0xd6, "Î": 0xd7, "Ï": 0xd8, "Ó": 0xe0, "ß": 0xe1, "Ô": 0xe2, "Ò": 0xe3,
  "Ú": 0xe9, "Û": 0xea, "Ù": 0xeb, "Ý": 0xed, "°": 0xf8, "Ê": 0xd2, "È": 0xd4,
};

function codificar(texto) {
  const bytes = [];
  for (const ch of String(texto || "")) {
    const codigo = ch.codePointAt(0);
    if (codigo < 0x80) {
      bytes.push(codigo);
    } else if (CP850[ch] !== undefined) {
      bytes.push(CP850[ch]);
    } else {
      // Antes de mandar un byte que la impresora no sabe interpretar, se
      // intenta la letra sin tilde; si tampoco, "?" — es feo, pero es
      // legible y no descuadra la columna (siempre ocupa 1 carácter).
      const sinTilde = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      bytes.push(sinTilde.length === 1 && sinTilde.codePointAt(0) < 0x80 ? sinTilde.codePointAt(0) : 0x3f);
    }
  }
  return B(bytes);
}

const ESC = 0x1b;
const GS = 0x1d;
const ALINEACION = { left: 0, center: 1, right: 2 };

function comandoQr(contenido, tamano) {
  const datos = codificar(contenido);
  const largo = datos.length + 3;
  return unir([
    B([GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0]),                       // modelo 2
    B([GS, 0x28, 0x6b, 3, 0, 49, 67, Math.min(16, Math.max(1, tamano || 6))]),
    B([GS, 0x28, 0x6b, 3, 0, 49, 69, 49]),                          // corrección M
    B([GS, 0x28, 0x6b, largo & 0xff, (largo >> 8) & 0xff, 49, 80, 48]),
    datos,
    B([GS, 0x28, 0x6b, 3, 0, 49, 81, 48]),                          // imprimir
  ]);
}

function comandoCodigoBarras(contenido) {
  // CODE128 juego B: acepta letras, números y símbolos, que es lo que hace
  // falta para un número de documento tipo "NV001-000123".
  const datos = codificar("{B" + contenido);
  return unir([
    B([GS, 0x68, 64]),          // altura 64 puntos
    B([GS, 0x77, 2]),           // ancho de módulo
    B([GS, 0x48, 2]),           // imprimir el texto debajo
    B([GS, 0x6b, 73, datos.length]),
    datos,
  ]);
}

// La imagen llega ya en 1 bit por píxel (el navegador la convierte a
// monocromo con dithering antes de mandarla: ahí el canvas ya da los
// píxeles y no hace falta que el servidor sepa decodificar PNG).
// "bits" son las filas, cada una empaquetada de a 8 píxeles por byte.
function comandoImagen(imagen) {
  const bytesPorFila = Math.ceil(imagen.ancho / 8);
  // Los bits llegan como Buffer desde el disco o como Uint8Array desde el
  // navegador. Uint8Array.from() acepta los dos sin copiar de más.
  const datos = imagen.bits instanceof Uint8Array ? imagen.bits : Uint8Array.from(imagen.bits);
  return unir([
    B([GS, 0x76, 0x30, 0,
      bytesPorFila & 0xff, (bytesPorFila >> 8) & 0xff,
      imagen.alto & 0xff, (imagen.alto >> 8) & 0xff]),
    datos,
  ]);
}

// Bytes listos para mandar a la impresora.
function aEscPos(documento, opciones = {}) {
  const { lineas } = componer(documento, opciones);
  const perfilImpresora = perfilDeOpciones(opciones);
  // Por defecto se corta solo si la impresora tiene cuchilla. Se puede
  // forzar con cortar:true para una que no esté en la lista de perfiles.
  const cortar = opciones.cortar === undefined ? Boolean(perfilImpresora.cortador) : Boolean(opciones.cortar);
  const copias = Math.min(10, Math.max(1, Number(opciones.copias) || 1));
  const partes = [];

  partes.push(B([ESC, 0x40]));       // reiniciar
  partes.push(B([ESC, 0x74, 2]));    // página de códigos CP850

  for (let copia = 0; copia < copias; copia += 1) {
    let alineacionActual = 0;
    let negritaActual = false;
    let tamanoActual = 1;

    lineas.forEach((l) => {
      const align = ALINEACION[l.align] === undefined ? 0 : ALINEACION[l.align];
      if (align !== alineacionActual) {
        partes.push(B([ESC, 0x61, align]));
        alineacionActual = align;
      }

      if (l.tipo === "espacio") {
        partes.push(B([0x0a]));
        return;
      }
      if (l.tipo === "qr") {
        partes.push(comandoQr(l.contenido, l.tamano));
        partes.push(B([0x0a]));
        return;
      }
      if (l.tipo === "codigoBarras") {
        partes.push(comandoCodigoBarras(l.contenido));
        partes.push(B([0x0a]));
        return;
      }
      if (l.tipo === "imagen") {
        if (l.imagen && l.imagen.bits) partes.push(comandoImagen(l.imagen));
        return;
      }

      const negrita = Boolean(l.negrita);
      if (negrita !== negritaActual) {
        partes.push(B([ESC, 0x45, negrita ? 1 : 0]));
        negritaActual = negrita;
      }
      const tamano = l.tamano === 2 ? 2 : 1;
      if (tamano !== tamanoActual) {
        // GS ! empaqueta ancho y alto en un byte: 4 bits cada uno.
        const n = ((tamano - 1) << 4) | (tamano - 1);
        partes.push(B([GS, 0x21, n]));
        tamanoActual = tamano;
      }

      partes.push(codificar(l.texto || ""));
      partes.push(B([0x0a]));
    });

    // Se dejan limpios los modos antes de cortar: si queda la negrita
    // activada, el documento siguiente sale entero en negrita.
    if (negritaActual) partes.push(B([ESC, 0x45, 0]));
    if (tamanoActual !== 1) partes.push(B([GS, 0x21, 0]));
    if (alineacionActual !== 0) partes.push(B([ESC, 0x61, 0]));

    // El avance final lo manda el perfil. En una portátil sin cuchilla es
    // lo ÚNICO que separa la última línea de la barra dentada: sin esto se
    // rasga por encima del total, porque la barra está unos milímetros más
    // adelante que el cabezal.
    partes.push(B([ESC, 0x64, perfilImpresora.avanceFinal || 4]));
    if (cortar) partes.push(B([GS, 0x56, 66, 0]));
  }

  return unir(partes);
}

// Hoja de diagnóstico. No es un documento de adorno: cada línea contesta
// una pregunta que no se puede responder sin ver el papel salir.
function lineasDiagnostico(p) {
  const ancho = p.columnas;
  return [
    { tipo: "texto", texto: "DIAGNÓSTICO DE IMPRESIÓN", align: "center", negrita: true },
    { tipo: "texto", texto: p.nombre, align: "center" },
    { tipo: "espacio" },

    // Si esta línea de gatos entra justa y NO salta a una segunda línea,
    // el ancho del perfil es el correcto. Si se parte, sobran columnas.
    { tipo: "texto", texto: `1. Ancho: deben entrar ${ancho} (#) en UNA línea` },
    { tipo: "texto", texto: "#".repeat(ancho) },
    { tipo: "espacio" },

    // La regla permite contar a ojo dónde se cortó, si se cortó.
    { tipo: "texto", texto: "2. Regla (el último número es la columna)" },
    { tipo: "texto", texto: "1234567890".repeat(Math.ceil(ancho / 10)).slice(0, ancho) },
    { tipo: "espacio" },

    // Si acá salen símbolos raros, la impresora no está en CP850 y hay
    // que probar otra página de códigos.
    { tipo: "texto", texto: "3. Acentos: áéíóú ÁÉÍÓÚ ñÑ üÜ ¿¡ °" },
    { tipo: "espacio" },

    { tipo: "texto", texto: "4. Negrita:" },
    { tipo: "texto", texto: "   esta línea va en negrita", negrita: true },
    { tipo: "texto", texto: "   esta línea va normal" },
    { tipo: "espacio" },

    { tipo: "texto", texto: "5. Alineación:" },
    { tipo: "texto", texto: "izquierda", align: "left" },
    { tipo: "texto", texto: "centro", align: "center" },
    { tipo: "texto", texto: "derecha", align: "right" },
    { tipo: "espacio" },

    { tipo: "texto", texto: "6. QR (debe poder escanearse):" },
    { tipo: "qr", contenido: "https://ejemplo.pe/prueba", tamano: 6, align: "center" },
    { tipo: "espacio" },

    { tipo: "texto", texto: "7. Código de barras:" },
    { tipo: "codigoBarras", contenido: "PRUEBA123", align: "center" },
    { tipo: "espacio" },

    {
      tipo: "texto",
      texto: p.cortador
        ? "8. Debajo de esta línea debe cortar solo."
        : "8. Sin cuchilla: esta línea tiene que quedar\n   COMPLETA por encima de la barra dentada.",
    },
  ];
}

// Se arma sin pasar por componer(): el diagnóstico no es un documento de
// venta y no tiene por qué tener totales ni emisor.
function prueba(opciones = {}) {
  const p = perfilDeOpciones(opciones);
  const cortar = opciones.cortar === undefined ? Boolean(p.cortador) : Boolean(opciones.cortar);
  const partes = [B([ESC, 0x40]), B([ESC, 0x74, 2])];

  let alineacionActual = 0;
  let negritaActual = false;

  lineasDiagnostico(p).forEach((l) => {
    const align = ALINEACION[l.align] === undefined ? 0 : ALINEACION[l.align];
    if (align !== alineacionActual) {
      partes.push(B([ESC, 0x61, align]));
      alineacionActual = align;
    }
    if (l.tipo === "espacio") return partes.push(B([0x0a]));
    if (l.tipo === "qr") return partes.push(comandoQr(l.contenido, l.tamano), B([0x0a]));
    if (l.tipo === "codigoBarras") return partes.push(comandoCodigoBarras(l.contenido), B([0x0a]));

    const negrita = Boolean(l.negrita);
    if (negrita !== negritaActual) {
      partes.push(B([ESC, 0x45, negrita ? 1 : 0]));
      negritaActual = negrita;
    }
    String(l.texto).split("\n").forEach((linea) => {
      partes.push(codificar(linea), B([0x0a]));
    });
    return undefined;
  });

  if (negritaActual) partes.push(B([ESC, 0x45, 0]));
  if (alineacionActual !== 0) partes.push(B([ESC, 0x61, 0]));
  partes.push(B([ESC, 0x64, p.avanceFinal || 4]));
  if (cortar) partes.push(B([GS, 0x56, 66, 0]));

  return unir(partes);
}

// La misma hoja en texto, para verla en pantalla antes de gastar papel.
function previaDiagnostico(opciones = {}) {
  const p = perfilDeOpciones(opciones);
  const centrar = (t) => {
    const sobra = p.columnas - t.length;
    return sobra > 0 ? " ".repeat(Math.floor(sobra / 2)) + t : t;
  };
  return lineasDiagnostico(p)
    .map((l) => {
      if (l.tipo === "espacio") return "";
      if (l.tipo === "qr") return centrar("[ QR ]");
      if (l.tipo === "codigoBarras") return centrar("[ CÓDIGO DE BARRAS ]");
      if (l.align === "center") return centrar(l.texto);
      if (l.align === "right") return String(l.texto).padStart(p.columnas);
      return l.texto;
    })
    .join("\n");
}

// El bloque mantiene API fuera del ámbito global: en el navegador los
// tres módulos comparten scope y dos "const API" chocarían.
{
  const API = {
    perfil, perfilDeOpciones, envolver, columnas, columnasDeItems,
    componer, previa, aEscPos, codificar, prueba, previaDiagnostico, unir,
    PREDETERMINADA, valorDe,
  };
  
  if (typeof module !== "undefined" && module.exports) module.exports = API;
    else self.Termica = API;
}
