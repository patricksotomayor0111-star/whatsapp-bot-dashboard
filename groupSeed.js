// Configuración inicial por NOMBRE de grupo (no por ID, porque el ID todavía
// no existe hasta que el bot se vincule a la cuenta real de WhatsApp donde
// están estos grupos). La primera vez que el bot ve un grupo con uno de
// estos nombres exactos, le aplica el sector y las keywords especiales de
// acá abajo. Después de esa primera vez, lo que cambies desde el panel
// manda (no se vuelve a pisar).
//
// OJO: varios nombres reales de WhatsApp traen un espacio al final
// ("BRUCES BOX DELIVERY " en vez de "BRUCES BOX DELIVERY"). Estas claves
// están copiadas tal cual las devuelve la cuenta real (verificado el
// 2026-07-17), no las edites "prolijas" o dejan de calzar.

// Sectores que no son "Otros" (todo lo que no está acá cae en Otros por defecto)
const sectorSeedByName = {
  "Hola": "base",
  "REPORTES BOX DELIVERY": "base",

  "BRUCES BOX DELIVERY ": "ptb",
  "CARTAS RESTAURANTES": "ptb",
  "FLAMANGOS - BOX DELIVERY": "ptb",
  "KAFFA COFFEE - BOX DELIVERY": "ptb",
  "LA BUMANGUESA BOX DELIVERY": "ptb",
  "MUELLE BOX DELIVERY ": "ptb",
  "PEÑONETTI BOX DELIVERY": "ptb",
  "PUERTO RICO BOX DELIVERY ": "ptb",
  "SHAWABURGUER BOX DELIVERY": "ptb",

  "AJI LIMO- BOX DELIVERY": "san_jose",
  "AYABACA - BUMANGUESA II": "san_jose",
  "BOCHITOS BOX DELIVERY": "san_jose",
  "CRIOLLO BOX DELIVERY ": "san_jose",
  "HARVEST BOX DELIVERY": "san_jose",
  "HELADERÍA EL PINGÜINO": "san_jose",
  "KAM LONG PEDIDOS": "san_jose",
  "LAS NIEVES BOX DELIVERY": "san_jose",
  "MR. SUSHI BOX DELIVERY": "san_jose",
  "RICOS PROTEIN - BOX DELIVERY": "san_jose",
  "THE CROWN BOX DELIVERY": "san_jose",

  "BIRKA BOX DELIVERY": "moderna",
  "BUBATON BOX DELIVERY": "moderna",
  "CANTONES - BOX DELIVERY": "moderna",
  "CHIFA CHANG KEE PEDIDOS": "moderna",
  "CHIFA LIU BOX DELIVERY": "moderna",
  "COMBINADOS - BOX DELIVERY": "moderna",
  "COSTA SUR BOX": "moderna",
  "CRAZY CORN 🌭🧋🤗": "moderna",
  "KANASTAS BOX DELIVERY ": "moderna",
  "McGrill Restaurante BOX DELIVERY": "moderna",
  "MISTER JUGO BOX DELIVERY ": "moderna",
  "MONO ALITAS BOX DELIVERY": "moderna",
  "PATRIA PEDIDOS ": "moderna",
  "PIM PAM POLLO BOX DELIVERY": "moderna",
  "REST CENTRO BOX DELIVERY ": "moderna",

  "Don Alejandro -BOX DELYBERY": "la_angostura",
  "EL BORGO BOX DELIVERY": "la_angostura",
  "FIDEL - BOX DELIVERY ICA": "la_angostura",
  "OCTAVIA LA ANGOSTURA - BOX DELIVERY": "la_angostura",

  "ARTIA PASTELERIA (dribox)": "comodin",
  "Boletas locales": "comodin",
  "BOX DELIVERY EL PESQUERO": "comodin",
  "BOX DELIVERY JUGO": "comodin",
  "CHACHO BOX DELIVERY": "comodin",
  "DELIVERY BIEN PESCAO 🏍️": "comodin",
  "DELIVERY BOX / LAGUNILLA": "comodin",
  "Hugo Restaurante BOX DELIVERY ": "comodin",
  "LA PARRILLERIA BOX DELIVERY ": "comodin",
  "LAS CAÑAS BOX DELIVERY ": "comodin",
  "MIAS BOX DELIVERY": "comodin",
  "MISKY POLLERIA (dribox)": "comodin",
  "MONKEY DONUTS BOX DELIVERY ": "comodin",
  "ONEST BOX DELIVERY ": "comodin",
  "Palacio Oriental BOX DELIVERY": "comodin",
  "PAPEADO SAN ISIDRO BOX DELIVERY": "comodin",
  "Paradero ": "comodin",
  "PEPEFOD DELIVERY": "comodin",
  "Pizzería cardenatti box delivery ": "comodin",
  "POLLERÍA EL HUARANGO - BOX DELIVERY": "comodin",
  "PUNTO CALIENTE - BOX DELIVERY": "comodin",
  "Rincón del sabor BOX DELIVERY": "comodin",
  "ROCA STEAK HOUSE BOX DELIVERY": "comodin",
  "Selah Coffe BOX DELIVERY": "comodin",
  "SMART NUTRITION BOX DELIVERY": "comodin",
};

const FRASES_MCGRILL_CARTAS = [
  "hola me envias uno", "me mandas uno", "alguien cerca",
  "alguien disponible en 10min", "alguien disponible en 5min", "me envia uno urgente",
  "me envia uno porfa", "enviame uno porfa", "enviame uno", "manda uno", "alguien disponible",
];

const specialSeedByName = {
  "AYABACA - BUMANGUESA II": ["listo"],
  "ARTIA PASTELERIA (dribox)": ["ya esta listo"],
  "PEPEFOD DELIVERY": ["por favor un recojo en raul porras barrenechea d4"],
  "CHIFA LIU BOX DELIVERY": ["hola pedido"],
  "HARVEST BOX DELIVERY": [
    "puede acercarce uno mas por favor para llevar otro?",
    "chicos alguien se puede acercar para llevar un pedido a onest?",
  ],
  "BUBATON BOX DELIVERY": ["ingrese"],
  "CARTAS RESTAURANTES": [
    "ingrese", "a tienda por favor", "pedido", "a tienda", "tienda por favor", "delivery",
    "delivery a divino maestro", "manden a tienda", "uno a tienda", "uno a huacachina",
    "uno para huacachina", ...FRASES_MCGRILL_CARTAS,
  ],
  "BRUCES BOX DELIVERY ": ["uno", "hola uno por favor", "delivery a divino maestro", "uno por favor"],
  "Pizzería cardenatti box delivery ": ["delivery"],
  "LA PARRILLERIA BOX DELIVERY ": [
    "a tienda por favor", "a tienda", "tienda por favor", "manden a tienda", "uno a tienda",
  ],
  "MUELLE BOX DELIVERY ": ["uno a huacachina", "uno para huacachina"],
  "McGrill Restaurante BOX DELIVERY": [...FRASES_MCGRILL_CARTAS],
  "THE CROWN BOX DELIVERY": ["disculpe para que puedan venir por el delivery"],
  "BOCHITOS BOX DELIVERY": ["buenas tardes podrian enviarme un delivery porfa?"],
};

// Excepciones número+grupo+frase: estos números están en excludedNumbers.js
// (bloqueados en todos lados), pero en ESTE grupo puntual sí pueden activar
// al bot si escriben una de estas frases. En cualquier otro grupo siguen
// bloqueados igual que siempre.
//
// Cada frase puede ser un texto simple (arranca activa) o { phrase, active }
// si quieres que arranque apagada.
//
// OJO con los LID: a veces WhatsApp identifica a la misma persona con un
// ID alterno tipo "272984178720993@lid" en vez de su número real, sobre
// todo en grupos grandes. Si eso pasa, hay que agregar también ese número
// (los últimos 9 dígitos del LID) como otra excepción en el mismo grupo,
// si no el bot no lo va a reconocer. Ya nos pasó con "Hola": el número real
// es 910795590, pero WhatsApp a veces lo manda como LID 178720993.
const FRASES_EXCEPCION_HOLA = [
  { phrase: "Pendiente\nRecojo de cliente", active: false },
  { phrase: "Pendiente\nCompra de cliente", active: true },
];

const FRASES_EXCEPCION_REPORTES = [
  { phrase: "Pendiente\nRecojo de cliente", active: true },
  { phrase: "Pendiente\nCompra de cliente", active: true },
];

const numberExceptionSeed = {
  "Hola": {
    "910795590": FRASES_EXCEPCION_HOLA,
    "178720993": FRASES_EXCEPCION_HOLA, // alias por LID de la misma persona
  },
  "REPORTES BOX DELIVERY": {
    "960186738": FRASES_EXCEPCION_REPORTES,
  },
};

module.exports = { sectorSeedByName, specialSeedByName, numberExceptionSeed };
