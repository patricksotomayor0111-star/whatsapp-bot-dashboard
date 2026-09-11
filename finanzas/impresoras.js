// Perfiles de impresora.
//
// "ESC/POS" es un estándar con dialectos: casi todas entienden los mismos
// comandos de texto, pero difieren en el ancho, en si tienen cuchilla y en
// cómo se conectan. Guardar eso como dato —en vez de repartirlo por el
// código— es lo que permite agregar otra impresora sin tocar el render.

const MODELOS = {
  // La portátil de 80 mm a batería. Vendida también como ZJ-8001DD y
  // NT-8001DD; es la misma máquina con otra etiqueta.
  "pos-8001dd": {
    nombre: "POS-8001DD (ZJiang ZJ-8001DD)",
    anchoPapel: 80,
    // 72 mm útiles a 203 dpi. Los 576 puntos son el límite del cabezal:
    // una imagen más ancha se corta, no se reescala sola.
    puntos: 576,
    columnas: 48,
    dpi: 203,

    // Sin cuchilla: se corta a mano contra la barra dentada. Mandarle
    // GS V no rompe nada (las impresoras ignoran lo que no entienden),
    // pero tampoco hace avanzar el papel, y ahí está el problema real: la
    // barra dentada está unos milímetros MÁS ADELANTE que el cabezal, así
    // que sin avance extra se rasga por encima de la última línea
    // impresa, que casi siempre es el total.
    cortador: false,
    // ~18 mm a 203 dpi con líneas de 24 puntos. Es lo que hace falta para
    // que la última línea pase la barra antes de cortar.
    avanceFinal: 5,

    // Bluetooth 4.0 es BLE, que es lo que sabe hablar el navegador
    // (Web Bluetooth, Chrome en Android). El 3.0 de la ficha es SPP
    // clásico y desde el navegador no se puede usar.
    conexion: ["ble", "usb"],

    // Estas impresoras chinas no usan un servicio BLE estándar, y el
    // mismo modelo sale de fábrica con UUIDs distintos según el lote. No
    // hay forma de saber cuál trae la tuya sin preguntarle, así que se
    // declaran todos los conocidos y después se prueba cuál responde.
    ble: {
      servicios: [
        "000018f0-0000-1000-8000-00805f9b34fb",
        "0000ff00-0000-1000-8000-00805f9b34fb",
        "49535343-fe7d-4ae5-8fa9-9fafd205e455",
        "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
      ],
      // Se prefieren estas si aparecen; si no, se toma cualquier
      // característica que acepte escritura.
      escritura: [
        "00002af1-0000-1000-8000-00805f9b34fb",
        "0000ff02-0000-1000-8000-00805f9b34fb",
        "49535343-8841-43f4-a8d4-ecbe34729bb3",
        "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
      ],
    },

    // BLE manda paquetes chicos. Si se le tira el documento entero de una,
    // la impresora descarta lo que no le entra y el ticket sale cortado a
    // la mitad o con caracteres sueltos. Hay que partirlo y darle tiempo
    // de imprimir entre paquete y paquete.
    chunk: 180,
    pausaMs: 20,
  },

  "generica-58": {
    nombre: "Genérica 58 mm",
    anchoPapel: 58,
    puntos: 384,
    columnas: 32,
    dpi: 203,
    cortador: false,
    avanceFinal: 5,
    conexion: ["ble", "usb"],
    ble: MODELOS_BLE_GENERICO(),
    chunk: 180,
    pausaMs: 20,
  },

  "generica-80": {
    nombre: "Genérica 80 mm de mostrador",
    anchoPapel: 80,
    puntos: 576,
    columnas: 48,
    dpi: 203,
    // Las de mostrador enchufadas a la corriente sí suelen traer cuchilla.
    cortador: true,
    avanceFinal: 4,
    conexion: ["usb", "red"],
    ble: null,
    chunk: 512,
    pausaMs: 0,
  },
};

function MODELOS_BLE_GENERICO() {
  return {
    servicios: [
      "000018f0-0000-1000-8000-00805f9b34fb",
      "0000ff00-0000-1000-8000-00805f9b34fb",
      "49535343-fe7d-4ae5-8fa9-9fafd205e455",
      "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
    ],
    escritura: [
      "00002af1-0000-1000-8000-00805f9b34fb",
      "0000ff02-0000-1000-8000-00805f9b34fb",
      "49535343-8841-43f4-a8d4-ecbe34729bb3",
      "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
    ],
  };
}

const POR_DEFECTO = "pos-8001dd";

// Resuelve un perfil desde lo que venga: el nombre de un modelo, un ancho
// de papel ("58" / "80"), o un perfil ya armado con ajustes propios.
function perfilDe(entrada) {
  if (!entrada) return MODELOS[POR_DEFECTO];
  if (typeof entrada === "object") {
    const base = MODELOS[entrada.modelo] || MODELOS[POR_DEFECTO];
    return { ...base, ...entrada };
  }
  const clave = String(entrada).toLowerCase();
  if (MODELOS[clave]) return MODELOS[clave];
  if (clave === "58") return MODELOS["generica-58"];
  if (clave === "80") return MODELOS["generica-80"];
  return MODELOS[POR_DEFECTO];
}

// Ancho personalizado: es solo una cuenta de columnas. Se calcula desde
// los puntos del cabezal para no tener que adivinarla — la fuente A ocupa
// 12 puntos de ancho por carácter.
function conAnchoPersonalizado(perfil, columnas) {
  const n = Math.max(16, Math.min(96, Math.round(Number(columnas) || 0)));
  return { ...perfil, columnas: n, personalizado: true };
}

function columnasParaPuntos(puntos) {
  return Math.floor(Number(puntos) / 12);
}

function listar() {
  return Object.entries(MODELOS).map(([clave, m]) => ({
    clave,
    nombre: m.nombre,
    anchoPapel: m.anchoPapel,
    columnas: m.columnas,
    cortador: m.cortador,
    conexion: m.conexion,
  }));
}

module.exports = { MODELOS, POR_DEFECTO, perfilDe, conAnchoPersonalizado, columnasParaPuntos, listar };
