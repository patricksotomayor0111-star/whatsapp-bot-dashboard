const doc = require("./documento");

// Render para impresora térmica.
//
// El papel térmico no tiene tipografía proporcional: imprime una grilla de
// caracteres de ancho fijo. Por eso el layout no es "posicionar cajas",
// es armar líneas de N columnas. Y por eso la vista previa puede ser
// EXACTA: si la previa se arma con las mismas líneas que se le mandan a la
// impresora, lo que ves es literalmente lo que sale.

// Columnas útiles por ancho de papel, con la fuente A (la normal).
// Son las de las impresoras compatibles ESC/POS: 58 mm imprime 48 mm
// útiles y 80 mm imprime 72 mm.
const PERFILES = {
  "58": { columnas: 32, puntos: 384 },
  "80": { columnas: 48, puntos: 576 },
};

function perfil(ancho) {
  return PERFILES[String(ancho)] || PERFILES["58"];
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
function componer(documento, opciones = {}) {
  const d = doc.normalizar(documento);
  const ancho = perfil(opciones.ancho || "58").columnas;
  const L = [];

  const texto = (t, extra = {}) => envolver(t, extra.tamano === 2 ? Math.floor(ancho / 2) : ancho)
    .forEach((linea) => L.push({ tipo: "texto", texto: linea, align: "left", ...extra }));

  if (d.logo) L.push({ tipo: "imagen", imagen: d.logo, align: "center" });

  if (d.emisor.nombre) texto(d.emisor.nombre, { align: "center", negrita: true });
  if (d.emisor.ruc) texto(`RUC: ${d.emisor.ruc}`, { align: "center" });
  if (d.emisor.direccion) texto(d.emisor.direccion, { align: "center" });
  if (d.emisor.telefono) texto(`Tel: ${d.emisor.telefono}`, { align: "center" });

  L.push({ tipo: "espacio" });
  texto(doc.TIPOS[d.tipo], { align: "center", negrita: true });
  if (d.numero) texto(d.numero, { align: "center" });
  L.push({ tipo: "separador", texto: separador(ancho) });

  const fecha = fechaLegible(d.fecha);
  if (fecha) L.push({ tipo: "texto", texto: columnas("Fecha:", fecha, ancho) });
  if (d.cliente) texto(`Cliente: ${d.cliente}`);

  L.push({ tipo: "separador", texto: separador(ancho) });
  const cols = columnasDeItems(d.items);
  d.items.forEach((item) => {
    lineasDeItem(item, ancho, cols).forEach((linea) => L.push({ tipo: "texto", align: "left", ...linea }));
  });
  L.push({ tipo: "separador", texto: separador(ancho) });

  const t = d.totales;
  if (t.descuentoGlobal > 0) {
    L.push({ tipo: "texto", texto: columnas("Descuento:", "-S/ " + doc.aTexto(t.descuentoGlobal), ancho) });
  }
  if (d.mostrarIgv && t.tasa > 0) {
    L.push({ tipo: "texto", texto: columnas("SUBTOTAL:", "S/ " + doc.aTexto(t.subtotal), ancho) });
    const etiqueta = `IGV (${Math.round(t.tasa * 100)}%):`;
    L.push({ tipo: "texto", texto: columnas(etiqueta, "S/ " + doc.aTexto(t.igv), ancho) });
  }
  L.push({
    tipo: "texto",
    texto: columnas("TOTAL:", "S/ " + doc.aTexto(t.total), ancho),
    negrita: true,
  });

  if (d.pago) {
    L.push({ tipo: "espacio" });
    if (d.pago.medio) L.push({ tipo: "texto", texto: columnas("Pago:", d.pago.medio, ancho) });
    if (d.pago.recibido) {
      L.push({ tipo: "texto", texto: columnas("Recibido:", "S/ " + doc.aTexto(d.pago.recibido), ancho) });
      const v = doc.vuelto(d);
      if (v !== null && v >= 0) {
        L.push({ tipo: "texto", texto: columnas("Vuelto:", "S/ " + doc.aTexto(v), ancho) });
      }
    }
  }

  if (d.codigoBarras && d.codigoBarras.contenido) {
    L.push({ tipo: "espacio" });
    L.push({ tipo: "codigoBarras", contenido: d.codigoBarras.contenido, align: "center" });
  }
  if (d.qr && d.qr.contenido) {
    L.push({ tipo: "espacio" });
    L.push({ tipo: "qr", contenido: d.qr.contenido, tamano: d.qr.tamano, align: "center" });
  }
  if (d.pie) {
    L.push({ tipo: "espacio" });
    texto(d.pie, { align: "center" });
  }

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
  return Buffer.from(bytes);
}

const ESC = 0x1b;
const GS = 0x1d;
const ALINEACION = { left: 0, center: 1, right: 2 };

function comandoQr(contenido, tamano) {
  const datos = codificar(contenido);
  const largo = datos.length + 3;
  return Buffer.concat([
    Buffer.from([GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0]),                       // modelo 2
    Buffer.from([GS, 0x28, 0x6b, 3, 0, 49, 67, Math.min(16, Math.max(1, tamano || 6))]),
    Buffer.from([GS, 0x28, 0x6b, 3, 0, 49, 69, 49]),                          // corrección M
    Buffer.from([GS, 0x28, 0x6b, largo & 0xff, (largo >> 8) & 0xff, 49, 80, 48]),
    datos,
    Buffer.from([GS, 0x28, 0x6b, 3, 0, 49, 81, 48]),                          // imprimir
  ]);
}

function comandoCodigoBarras(contenido) {
  // CODE128 juego B: acepta letras, números y símbolos, que es lo que hace
  // falta para un número de documento tipo "NV001-000123".
  const datos = codificar("{B" + contenido);
  return Buffer.concat([
    Buffer.from([GS, 0x68, 64]),          // altura 64 puntos
    Buffer.from([GS, 0x77, 2]),           // ancho de módulo
    Buffer.from([GS, 0x48, 2]),           // imprimir el texto debajo
    Buffer.from([GS, 0x6b, 73, datos.length]),
    datos,
  ]);
}

// La imagen llega ya en 1 bit por píxel (el navegador la convierte a
// monocromo con dithering antes de mandarla: ahí el canvas ya da los
// píxeles y no hace falta que el servidor sepa decodificar PNG).
// "bits" son las filas, cada una empaquetada de a 8 píxeles por byte.
function comandoImagen(imagen) {
  const bytesPorFila = Math.ceil(imagen.ancho / 8);
  const datos = Buffer.from(imagen.bits);
  return Buffer.concat([
    Buffer.from([GS, 0x76, 0x30, 0,
      bytesPorFila & 0xff, (bytesPorFila >> 8) & 0xff,
      imagen.alto & 0xff, (imagen.alto >> 8) & 0xff]),
    datos,
  ]);
}

// Bytes listos para mandar a la impresora.
function aEscPos(documento, opciones = {}) {
  const { lineas } = componer(documento, opciones);
  const copias = Math.min(10, Math.max(1, Number(opciones.copias) || 1));
  const partes = [];

  partes.push(Buffer.from([ESC, 0x40]));       // reiniciar
  partes.push(Buffer.from([ESC, 0x74, 2]));    // página de códigos CP850

  for (let copia = 0; copia < copias; copia += 1) {
    let alineacionActual = 0;
    let negritaActual = false;
    let tamanoActual = 1;

    lineas.forEach((l) => {
      const align = ALINEACION[l.align] === undefined ? 0 : ALINEACION[l.align];
      if (align !== alineacionActual) {
        partes.push(Buffer.from([ESC, 0x61, align]));
        alineacionActual = align;
      }

      if (l.tipo === "espacio") {
        partes.push(Buffer.from([0x0a]));
        return;
      }
      if (l.tipo === "qr") {
        partes.push(comandoQr(l.contenido, l.tamano));
        partes.push(Buffer.from([0x0a]));
        return;
      }
      if (l.tipo === "codigoBarras") {
        partes.push(comandoCodigoBarras(l.contenido));
        partes.push(Buffer.from([0x0a]));
        return;
      }
      if (l.tipo === "imagen") {
        if (l.imagen && l.imagen.bits) partes.push(comandoImagen(l.imagen));
        return;
      }

      const negrita = Boolean(l.negrita);
      if (negrita !== negritaActual) {
        partes.push(Buffer.from([ESC, 0x45, negrita ? 1 : 0]));
        negritaActual = negrita;
      }
      const tamano = l.tamano === 2 ? 2 : 1;
      if (tamano !== tamanoActual) {
        // GS ! empaqueta ancho y alto en un byte: 4 bits cada uno.
        const n = ((tamano - 1) << 4) | (tamano - 1);
        partes.push(Buffer.from([GS, 0x21, n]));
        tamanoActual = tamano;
      }

      partes.push(codificar(l.texto || ""));
      partes.push(Buffer.from([0x0a]));
    });

    // Se dejan limpios los modos antes de cortar: si queda la negrita
    // activada, el documento siguiente sale entero en negrita.
    if (negritaActual) partes.push(Buffer.from([ESC, 0x45, 0]));
    if (tamanoActual !== 1) partes.push(Buffer.from([GS, 0x21, 0]));
    if (alineacionActual !== 0) partes.push(Buffer.from([ESC, 0x61, 0]));

    // Avance para que el corte no pase por encima de la última línea: el
    // cabezal y la cuchilla están separados unos milímetros.
    partes.push(Buffer.from([ESC, 0x64, 4]));
    if (opciones.cortar !== false) partes.push(Buffer.from([GS, 0x56, 66, 0]));
  }

  return Buffer.concat(partes);
}

// Impresión de prueba, para verificar ancho, página de códigos y corte sin
// gastar un documento real.
function prueba(opciones = {}) {
  const ancho = perfil(opciones.ancho || "58").columnas;
  return aEscPos({
    tipo: "ticket",
    emisor: { nombre: "PRUEBA DE IMPRESIÓN" },
    items: [{ descripcion: `Ancho: ${ancho} columnas`, cantidad: 1, precioUnitario: 0 }],
    pie: "Acentos: áéíóú ñÑ ¿¡ °\n" + "1234567890".repeat(5).slice(0, ancho),
    mostrarIgv: false,
  }, opciones);
}

module.exports = { PERFILES, perfil, envolver, columnas, columnasDeItems, componer, previa, aEscPos, codificar, prueba };
