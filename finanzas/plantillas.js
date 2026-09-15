const { crearAlmacen } = require("./almacenPorUsuario");
const termica = require("./termica");

// Plantillas: el orden y el estilo de los bloques, guardados aparte de los
// datos. La misma plantilla sirve para todos tus documentos; lo que cambia
// de uno a otro son los productos y los precios.
//
// Acá no se guarda nada del contenido del documento — ni ítems, ni
// totales, ni número. Si se guardaran juntos, cambiar la plantilla
// significaría arrastrar los datos de la venta con la que se creó.

// Los tipos que el render sabe dibujar. Se valida contra esta lista para
// que una plantilla guardada con un tipo inventado no llegue al papel.
const TIPOS = {
  logo: { nombre: "Logo", datos: false },
  texto: { nombre: "Texto libre", datos: true },
  campo: { nombre: "Campo del documento", datos: true },
  par: { nombre: "Etiqueta + valor", datos: true },
  separador: { nombre: "Línea separadora", datos: false },
  espacio: { nombre: "Espacio", datos: false },
  items: { nombre: "Productos", datos: false },
  totales: { nombre: "Totales", datos: false },
  pago: { nombre: "Pago y vuelto", datos: false },
  cabeceraItems: { nombre: "Encabezado de columnas", datos: false },
  letras: { nombre: "Total en letras", datos: false },
  qr: { nombre: "QR", datos: false },
  codigoBarras: { nombre: "Código de barras", datos: false },
  pie: { nombre: "Mensaje del pie", datos: false },
};

// Los campos que se pueden poner con un bloque "campo" o "par".
const CAMPOS = [
  { campo: "emisor.nombre", nombre: "Nombre del negocio" },
  { campo: "emisor.ruc", nombre: "RUC" },
  { campo: "emisor.direccion", nombre: "Dirección" },
  { campo: "emisor.telefono", nombre: "Teléfono" },
  { campo: "tipo", nombre: "Tipo de documento" },
  { campo: "numero", nombre: "Número" },
  { campo: "fecha", nombre: "Fecha y hora" },
  { campo: "cliente", nombre: "Cliente" },
];

// Las que vienen con la app. No se pueden borrar ni editar: son el punto
// de partida y el lugar al que volver cuando una propia quedó mal.
const DE_FABRICA = [
  {
    id: "completa",
    nombre: "Nota completa",
    deFabrica: true,
    bloques: termica.PREDETERMINADA,
  },
  {
    id: "corta",
    nombre: "Ticket corto",
    deFabrica: true,
    bloques: [
      { tipo: "campo", campo: "emisor.nombre", align: "center", negrita: true },
      { tipo: "campo", campo: "numero", align: "center" },
      { tipo: "separador", caracter: "=" },
      { tipo: "items" },
      { tipo: "separador", caracter: "=" },
      { tipo: "totales" },
      { tipo: "pago" },
      { tipo: "pie" },
    ],
  },
  {
    id: "detallada",
    nombre: "Detallada con columnas",
    deFabrica: true,
    // La forma que usan las cajas registradoras de acá: encabezado de
    // columnas, unidad de medida, operaciones gravadas y el total en
    // letras. Los campos apuntan a TU perfil; lo que se copia es la
    // estructura, no los datos de nadie.
    bloques: [
      { tipo: "logo" },
      { tipo: "separador", caracter: "=" },
      { tipo: "campo", campo: "emisor.nombre", align: "center", negrita: true },
      { tipo: "campo", campo: "emisor.ruc", prefijo: "RUC ", align: "center" },
      { tipo: "campo", campo: "emisor.direccion", align: "center" },
      { tipo: "campo", campo: "emisor.telefono", prefijo: "Tel. ", align: "center" },
      { tipo: "separador", caracter: "=" },
      { tipo: "campo", campo: "tipo", align: "center", negrita: true },
      { tipo: "campo", campo: "numero", align: "center", negrita: true },
      { tipo: "separador" },
      { tipo: "par", etiqueta: "F. Emisión:", campo: "fecha" },
      { tipo: "par", etiqueta: "Cliente:", campo: "cliente" },
      { tipo: "separador" },
      { tipo: "cabeceraItems" },
      { tipo: "separador" },
      { tipo: "items", columnas: true },
      { tipo: "separador" },
      { tipo: "totales", opGravadas: true, etiquetaTotal: "TOTAL A PAGAR:" },
      { tipo: "separador" },
      { tipo: "letras" },
      { tipo: "separador" },
      { tipo: "pago" },
      { tipo: "qr" },
      { tipo: "pie" },
    ],
  },
  {
    id: "comanda",
    nombre: "Comanda de cocina",
    deFabrica: true,
    // Sin precios ni totales: a la cocina le importa qué preparar, no
    // cuánto se cobró. Y el número grande para leerlo de lejos.
    bloques: [
      { tipo: "texto", texto: "COMANDA", align: "center", negrita: true, tamano: 2 },
      { tipo: "par", etiqueta: "Nº", campo: "numero" },
      { tipo: "par", etiqueta: "Hora", campo: "fecha" },
      { tipo: "campo", campo: "cliente", prefijo: "Cliente: " },
      { tipo: "separador", caracter: "=" },
      { tipo: "items" },
      { tipo: "separador", caracter: "=" },
      { tipo: "espacio", lineas: 2 },
    ],
  },
];

const almacen = crearAlmacen("plantillas-data.json", function (parsed) {
  const p = parsed || {};
  return {
    propias: Array.isArray(p.propias) ? p.propias : [],
    activa: String(p.activa || "completa"),
  };
});
const datos = almacen.datos;
const save = almacen.guardar;

// Deja un bloque en su forma canónica y descarta lo que no se entiende.
// Todo lo que llega del navegador pasa por acá antes de guardarse.
function limpiarBloque(b) {
  if (!b || !TIPOS[b.tipo]) return null;
  const salida = { tipo: b.tipo };
  if (b.align === "center" || b.align === "right") salida.align = b.align;
  if (b.negrita) salida.negrita = true;
  if (Number(b.tamano) === 2) salida.tamano = 2;

  if (b.tipo === "texto") salida.texto = String(b.texto || "").slice(0, 200);
  if (b.tipo === "campo" || b.tipo === "par") {
    salida.campo = CAMPOS.some((c) => c.campo === b.campo) ? b.campo : "emisor.nombre";
  }
  if (b.tipo === "campo") {
    if (b.prefijo) salida.prefijo = String(b.prefijo).slice(0, 40);
    if (b.sufijo) salida.sufijo = String(b.sufijo).slice(0, 40);
  }
  if (b.tipo === "par") salida.etiqueta = String(b.etiqueta || "").slice(0, 40);
  if (b.tipo === "items" || b.tipo === "cabeceraItems") {
    if (b.columnas) salida.columnas = true;
    if (b.unidad === false) salida.unidad = false;
  }
  if (b.tipo === "totales") {
    if (b.opGravadas) salida.opGravadas = true;
    if (b.etiquetaTotal) salida.etiquetaTotal = String(b.etiquetaTotal).slice(0, 30);
  }
  if (b.tipo === "letras" && b.prefijo !== undefined) salida.prefijo = String(b.prefijo).slice(0, 20);
  if (b.tipo === "separador") {
    // Un solo carácter: el separador se repite hasta llenar el ancho, y con
    // dos o más la última repetición quedaría cortada a la mitad.
    salida.caracter = String(b.caracter || "-").slice(0, 1) || "-";
  }
  if (b.tipo === "espacio") salida.lineas = Math.min(6, Math.max(1, Number(b.lineas) || 1));
  return salida;
}

function limpiarBloques(bloques) {
  return (Array.isArray(bloques) ? bloques : []).map(limpiarBloque).filter(Boolean).slice(0, 60);
}

function todas() {
  return DE_FABRICA.concat(datos().propias);
}

function porId(id) {
  return todas().find((p) => p.id === String(id)) || DE_FABRICA[0];
}

function activa() {
  return porId(datos().activa);
}

function usar(id) {
  if (!todas().some((p) => p.id === String(id))) throw new Error("Esa plantilla no existe.");
  datos().activa = String(id);
  save();
  return activa();
}

function siguienteId() {
  return "p" + (datos().propias.reduce((m, p) => Math.max(m, Number(String(p.id).slice(1)) || 0), 0) + 1);
}

function guardar(nombre, bloques, id) {
  const limpios = limpiarBloques(bloques);
  if (limpios.length === 0) throw new Error("La plantilla no tiene ningún bloque.");
  const limpio = String(nombre || "").trim().slice(0, 40) || "Sin nombre";

  // Editar una de fábrica guarda una copia propia en vez de fallar: es lo
  // que espera quien tomó una como punto de partida y la modificó.
  const existente = id ? datos().propias.find((p) => p.id === id) : null;
  if (existente) {
    existente.nombre = limpio;
    existente.bloques = limpios;
    save();
    return existente;
  }

  const nueva = { id: siguienteId(), nombre: limpio, bloques: limpios };
  datos().propias.push(nueva);
  datos().activa = nueva.id;
  save();
  return nueva;
}

function eliminar(id) {
  const antes = datos().propias.length;
  datos().propias = datos().propias.filter((p) => p.id !== String(id));
  if (datos().propias.length === antes) return false;
  if (datos().activa === String(id)) datos().activa = "completa";
  save();
  return true;
}

module.exports = { TIPOS, CAMPOS, DE_FABRICA, todas, porId, activa, usar, guardar, eliminar, limpiarBloques };
