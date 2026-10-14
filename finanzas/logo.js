const { crearAlmacen } = require("./almacenPorUsuario");

// El logo del negocio, ya convertido a 1 bit por píxel.
//
// La conversión a blanco y negro se hace en el NAVEGADOR, no acá. No es por
// comodidad: el canvas ya te entrega los píxeles listos, mientras que en el
// servidor habría que decodificar PNG y JPEG a mano o sumar una dependencia
// pesada para hacer exactamente lo mismo. Y de paso el usuario ve el
// resultado del dithering antes de guardar, que es cuando sirve verlo.
//
// Se guarda ya tramado porque la impresora térmica solo sabe imprimir un
// punto o no imprimirlo: no hay grises. Guardar el original y convertir al
// imprimir significaría hacer la misma cuenta en cada ticket.

const MAX_PUNTOS = 576;   // el cabezal de 80 mm
const MAX_ALTO = 400;     // ~5 cm de papel; más que eso es un cartel, no un logo

const almacen = crearAlmacen("logo-data.json", function (parsed) {
  const p = parsed || {};
  if (!p.bits || !p.ancho || !p.alto) return { logo: null };
  return { logo: { ancho: Number(p.ancho), alto: Number(p.alto), bits: String(p.bits) } };
});
const datos = almacen.datos;
const save = almacen.guardar;

function get() {
  return datos().logo;
}

// Devuelve el logo con los bits ya en Buffer, que es como lo quiere
// termica.js para armar el comando de imagen.
function paraImprimir() {
  const l = datos().logo;
  if (!l) return null;
  return { ancho: l.ancho, alto: l.alto, bits: Buffer.from(l.bits, "base64") };
}

function set({ ancho, alto, bits }) {
  const a = Math.floor(Number(ancho) || 0);
  const h = Math.floor(Number(alto) || 0);
  if (!a || !h) throw new Error("El logo llegó sin medidas.");
  if (a > MAX_PUNTOS) throw new Error(`El logo no puede pasar de ${MAX_PUNTOS} puntos de ancho.`);
  if (h > MAX_ALTO) throw new Error(`El logo no puede pasar de ${MAX_ALTO} puntos de alto.`);

  // Cada fila ocupa un número entero de bytes: 8 píxeles por byte, y la
  // última se completa con ceros. Si el tamaño no coincide, la imagen
  // saldría corrida en diagonal — es el síntoma clásico de esta cuenta
  // mal hecha.
  const esperados = Math.ceil(a / 8) * h;
  const buffer = Buffer.from(String(bits || ""), "base64");
  if (buffer.length !== esperados) {
    throw new Error(`El logo no cuadra: llegaron ${buffer.length} bytes y para ${a}x${h} hacen falta ${esperados}.`);
  }

  datos().logo = { ancho: a, alto: h, bits: buffer.toString("base64") };
  save();
  return get();
}

function quitar() {
  datos().logo = null;
  save();
  return true;
}

module.exports = { get, set, quitar, paraImprimir, MAX_PUNTOS, MAX_ALTO };
