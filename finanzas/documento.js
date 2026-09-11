// Modelo de un documento imprimible (nota de venta, comanda, cotización,
// ticket, cierre de caja).
//
// La idea central: el documento NUNCA guarda posiciones. Es una lista de
// bloques en orden, y la posición de cada uno sale de renderizar la lista
// de arriba a abajo. Eso es justamente lo que hace que "reorganizar
// automáticamente" no exista como función: si agregas un producto, no hay
// nada que mover, porque abajo no había nada anclado a una coordenada.
// Se vuelve a renderizar y listo. Si en cambio guardáramos "el total va en
// la fila 24", cada cambio obligaría a recalcular las coordenadas de todo
// lo de abajo y tarde o temprano algo se pisaría.
//
// Por lo mismo el documento se guarda como datos y no como imagen: la
// impresión se regenera limpia cada vez, sin arrastrar los defectos de
// nada.

// ---------- Dinero ----------
// Todo el dinero se maneja en CENTAVOS enteros. Con decimales flotantes,
// 0.1 + 0.2 da 0.30000000000000004 y después de veinte ítems el total
// impreso no coincide con la suma que hace el cliente con la calculadora.

// Lee un precio escrito de cualquiera de las formas que aparecen en la
// práctica: 3, "3.00", "S/ 3,00", "1,234.56", "1.234,56".
function aCentavos(valor) {
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? Math.round(valor * 100) : 0;
  }
  let texto = String(valor || "").replace(/[^\d.,-]/g, "").trim();
  if (!texto) return 0;

  const negativo = texto.startsWith("-");
  texto = texto.replace(/-/g, "");

  // Con los dos separadores presentes, el que va más a la derecha es el
  // decimal y el otro es de miles ("1,234.56" y "1.234,56" son el mismo
  // número escrito por dos personas distintas).
  const ultimaComa = texto.lastIndexOf(",");
  const ultimoPunto = texto.lastIndexOf(".");
  let decimal = "";
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    decimal = ultimaComa > ultimoPunto ? "," : ".";
  } else if (ultimaComa >= 0) {
    // Una sola coma: es decimal solo si le siguen 1 o 2 dígitos hasta el
    // final ("3,50"). Si le siguen 3 ("1,500") es separador de miles.
    decimal = /,\d{1,2}$/.test(texto) ? "," : "";
  } else if (ultimoPunto >= 0) {
    decimal = /\.\d{1,2}$/.test(texto) ? "." : "";
  }

  let entero = texto;
  let centavos = 0;
  if (decimal) {
    const corte = texto.lastIndexOf(decimal);
    entero = texto.slice(0, corte);
    centavos = Number((texto.slice(corte + 1) + "0").slice(0, 2)) || 0;
  }
  entero = Number(entero.replace(/[.,]/g, "")) || 0;

  const total = entero * 100 + centavos;
  return negativo ? -total : total;
}

// Centavos a texto para imprimir. Siempre con dos decimales: "3.00" y no
// "3", porque una columna de importes donde unos tienen decimales y otros
// no se lee pésimo en papel angosto.
function aTexto(centavos) {
  const n = Math.round(Number(centavos) || 0);
  const signo = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${signo}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// La cantidad sí puede tener decimales (1.5 kg de pan), pero se imprime
// sin decimales cuando es entera: "2" y no "2.000".
function cantidadATexto(cantidad) {
  const n = Number(cantidad) || 0;
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toFixed(3)));
}

// ---------- Tipos de documento ----------
// A propósito no hay tipo "boleta" ni "factura": esos son comprobantes de
// pago y solo valen emitidos electrónicamente contra SUNAT, que devuelve
// el CDR y el QR de verificación. Imprimir un papel con ese nombre sin
// pasar por SUNAT no genera un comprobante, genera una imitación. Lo que
// sí sirve de verdad en el mostrador es esto:
const TIPOS = {
  nota: "NOTA DE VENTA",
  cotizacion: "COTIZACIÓN",
  comanda: "COMANDA",
  orden: "ORDEN DE PEDIDO",
  ticket: "TICKET",
  cierre: "CIERRE DE CAJA",
};

const IGV_PERU = 0.18;

// ---------- Ítems ----------

// Marca de que el dinero del documento ya está en centavos.
//
// normalizar() se llama muchas veces sobre el mismo documento: después de
// cada edición, dentro de revisar(), y otra vez antes de imprimir. Sin
// esta marca la segunda pasada volvería a leer "300 centavos" como si
// fueran 300 soles, y el total se multiplicaría por cien en cada llamada.
// Con la marca, normalizar(normalizar(x)) da exactamente lo mismo que
// normalizar(x), que es lo que permite llamarla sin pensarlo.
const FORMATO = "centavos";

// "dinero" es la conversión que corresponda: desde texto del usuario la
// primera vez, y la identidad cuando el documento ya venía normalizado.
function normalizarItem(item, indice, dinero = aCentavos) {
  const cantidad = Number(item && item.cantidad);
  return {
    id: (item && item.id) || `it${indice + 1}`,
    descripcion: String((item && item.descripcion) || "").trim(),
    cantidad: Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 1,
    precioUnitario: dinero(item && item.precioUnitario),
    // Descuento por línea, en centavos y ya como monto (no porcentaje):
    // el vendedor piensa en "le bajo un sol", no en "le bajo 6.67%".
    descuento: Math.max(0, dinero(item && item.descuento)),
  };
}

// Para valores que ya están en centavos.
function yaEnCentavos(valor) {
  return Math.round(Number(valor) || 0);
}

// El importe de la línea se redondea acá, y el total es la suma de los
// importes YA redondeados. Al revés (sumar exacto y redondear al final) el
// papel queda con líneas que no suman el total impreso: el cliente suma lo
// que ve, le da un centavo de diferencia y hay que explicarle por qué.
function importeDe(item) {
  return Math.max(0, Math.round(item.cantidad * item.precioUnitario) - item.descuento);
}

// ---------- Totales ----------
//
// En el Perú los precios de mostrador ya llevan el IGV adentro, así que
// ese es el modo por defecto: el total es lo que el cliente paga y el
// subtotal se deduce hacia atrás. Para cotizaciones a empresas a veces se
// cotiza el valor neto y el IGV se suma encima, y para eso está
// igvIncluido: false.
//
// En los dos casos el IGV se calcula como la DIFERENCIA y no por separado.
// Si se redondeara subtotal e IGV cada uno por su lado, habría documentos
// donde subtotal + IGV da un centavo más (o menos) que el total impreso.
function calcularTotales(items, opciones = {}) {
  const tasa = opciones.tasaIgv === undefined ? IGV_PERU : Number(opciones.tasaIgv) || 0;
  const igvIncluido = opciones.igvIncluido !== false;
  // Ya en centavos, igual que el precio de los ítems que recibe.
  const descuentoGlobal = Math.max(0, yaEnCentavos(opciones.descuentoGlobal));

  const bruto = items.reduce((suma, item) => suma + importeDe(item), 0);

  if (igvIncluido) {
    const total = Math.max(0, bruto - descuentoGlobal);
    const subtotal = Math.round(total / (1 + tasa));
    return { bruto, descuentoGlobal, subtotal, igv: total - subtotal, total, tasa, igvIncluido };
  }

  const subtotal = Math.max(0, bruto - descuentoGlobal);
  const igv = Math.round(subtotal * tasa);
  return { bruto, descuentoGlobal, subtotal, igv, total: subtotal + igv, tasa, igvIncluido };
}

// ---------- Documento ----------

// Deja el documento en su forma canónica y con los totales al día. Se
// llama después de CUALQUIER cambio (agregar ítem, cambiar cantidad,
// cambiar el IGV), y por eso no hace falta que quien edita se acuerde de
// recalcular: no hay forma de que los totales queden desfasados de los
// ítems porque no se guardan editados a mano en ningún lado.
function normalizar(doc = {}) {
  const dinero = doc.formato === FORMATO ? yaEnCentavos : aCentavos;
  const items = (Array.isArray(doc.items) ? doc.items : [])
    .map((item, i) => normalizarItem(item, i, dinero));
  const opciones = {
    tasaIgv: doc.tasaIgv,
    igvIncluido: doc.igvIncluido,
    descuentoGlobal: dinero(doc.descuentoGlobal),
  };

  return {
    formato: FORMATO,
    tipo: TIPOS[doc.tipo] ? doc.tipo : "nota",
    titulo: String(doc.titulo || TIPOS[doc.tipo] || TIPOS.nota),
    numero: String(doc.numero || "").trim(),
    fecha: doc.fecha || new Date().toISOString(),
    // Datos del negocio que emite: son TUYOS y salen de tu configuración,
    // no de la foto de un documento ajeno.
    emisor: {
      nombre: String((doc.emisor && doc.emisor.nombre) || "").trim(),
      ruc: String((doc.emisor && doc.emisor.ruc) || "").replace(/\D/g, ""),
      direccion: String((doc.emisor && doc.emisor.direccion) || "").trim(),
      telefono: String((doc.emisor && doc.emisor.telefono) || "").trim(),
    },
    cliente: String(doc.cliente || "").trim(),
    items,
    tasaIgv: opciones.tasaIgv === undefined ? IGV_PERU : Number(opciones.tasaIgv) || 0,
    igvIncluido: doc.igvIncluido !== false,
    descuentoGlobal: Math.max(0, opciones.descuentoGlobal),
    mostrarIgv: doc.mostrarIgv !== false,
    pago: doc.pago ? { medio: String(doc.pago.medio || ""), recibido: dinero(doc.pago.recibido) } : null,
    qr: doc.qr ? { contenido: String(doc.qr.contenido || ""), tamano: Number(doc.qr.tamano) || 6 } : null,
    codigoBarras: doc.codigoBarras ? { contenido: String(doc.codigoBarras.contenido || "") } : null,
    logo: doc.logo || null,
    pie: String(doc.pie === undefined ? "¡Gracias por su compra!" : doc.pie),
    totales: calcularTotales(items, opciones),
  };
}

// Agrega un ítem y devuelve el documento renormalizado. No inserta por
// posición: va al final y los totales se rehacen solos.
function agregarItem(doc, item) {
  const actual = normalizar(doc);
  // El ítem nuevo viene del usuario ("3.50"), así que se convierte con
  // aCentavos aunque el documento que lo recibe ya esté en centavos.
  actual.items.push(normalizarItem(item, actual.items.length, aCentavos));
  return normalizar(actual);
}

function quitarItem(doc, id) {
  const actual = normalizar(doc);
  actual.items = actual.items.filter((it) => it.id !== id);
  return normalizar(actual);
}

// Los cambios llegan como los escribió el usuario, así que el dinero que
// traigan se convierte acá. Mezclar un "3.50" crudo dentro de un ítem que
// ya está en centavos lo dejaría en 4 centavos.
const CAMPOS_DINERO = ["precioUnitario", "descuento"];

function cambiarItem(doc, id, cambios) {
  const actual = normalizar(doc);
  const limpios = { ...cambios };
  CAMPOS_DINERO.forEach((campo) => {
    if (limpios[campo] !== undefined) limpios[campo] = aCentavos(limpios[campo]);
  });
  delete limpios.id;
  actual.items = actual.items.map((it) => (it.id === id ? { ...it, ...limpios } : it));
  return normalizar(actual);
}

// El vuelto sale del documento y no se escribe a mano, así no hay
// documentos donde el vuelto impreso no corresponde a lo recibido.
function vuelto(doc) {
  const d = normalizar(doc);
  if (!d.pago || !d.pago.recibido) return null;
  return d.pago.recibido - d.totales.total;
}

// Lo que alimenta la pantalla de revisión (🟢 / 🟡). Devuelve solo lo que
// está mal o dudoso: si está vacío, el documento se puede imprimir.
function revisar(doc) {
  const d = normalizar(doc);
  const avisos = [];

  if (!d.emisor.nombre) avisos.push({ campo: "emisor", nivel: "alerta", mensaje: "Falta el nombre del negocio." });
  if (d.emisor.ruc && d.emisor.ruc.length !== 11) {
    avisos.push({ campo: "ruc", nivel: "alerta", mensaje: "El RUC debe tener 11 dígitos." });
  }
  if (d.items.length === 0) avisos.push({ campo: "items", nivel: "error", mensaje: "El documento no tiene ítems." });

  d.items.forEach((it) => {
    if (!it.descripcion) avisos.push({ campo: it.id, nivel: "error", mensaje: "Hay un ítem sin descripción." });
    if (it.precioUnitario <= 0) {
      avisos.push({ campo: it.id, nivel: "alerta", mensaje: `"${it.descripcion || it.id}" no tiene precio.` });
    }
    if (it.descuento > Math.round(it.cantidad * it.precioUnitario)) {
      avisos.push({ campo: it.id, nivel: "error", mensaje: `El descuento de "${it.descripcion}" supera el importe.` });
    }
  });

  // Este nunca debería saltar: es la red de seguridad de que el redondeo
  // de arriba quedó bien. Si salta, hay un bug, no un dato malo.
  if (d.totales.subtotal + d.totales.igv !== d.totales.total) {
    avisos.push({ campo: "totales", nivel: "error", mensaje: "Subtotal + IGV no da el total." });
  }

  const v = vuelto(d);
  if (v !== null && v < 0) {
    avisos.push({ campo: "pago", nivel: "alerta", mensaje: "Lo recibido es menor que el total." });
  }

  return avisos;
}

module.exports = {
  TIPOS,
  IGV_PERU,
  aCentavos,
  aTexto,
  cantidadATexto,
  importeDe,
  calcularTotales,
  normalizar,
  agregarItem,
  quitarItem,
  cambiarItem,
  vuelto,
  revisar,
};
