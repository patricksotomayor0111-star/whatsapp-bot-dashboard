const fs = require("fs");
const { userDataPath } = require("./dataDir");
const { usuarioActual } = require("./contexto");

// Guarda un archivo JSON por cuenta, con su copia en memoria.
//
// Antes cada módulo hacía "const data = loadData()" una sola vez al
// arrancar: una única copia en memoria para todo el servidor, que era
// justo lo que impedía tener más de un usuario. Acá se mantiene una copia
// por cuenta, que se carga la primera vez que esa cuenta la necesita.
//
// "parsear" recibe lo que había en el archivo (o null si no existe o está
// corrupto) y devuelve la forma con la que trabaja el módulo, con sus
// valores por defecto. Es el mismo loadData() de siempre, pero recibiendo
// el contenido en vez de leerlo.
function crearAlmacen(archivo, parsear) {
  const enMemoria = new Map();

  function datos() {
    const id = usuarioActual();
    if (!enMemoria.has(id)) {
      let contenido;
      try {
        contenido = parsear(JSON.parse(fs.readFileSync(userDataPath(id, archivo), "utf8")));
      } catch (err) {
        contenido = parsear(null);
      }
      enMemoria.set(id, contenido);
    }
    return enMemoria.get(id);
  }

  function guardar() {
    const id = usuarioActual();
    try {
      fs.writeFileSync(userDataPath(id, archivo), JSON.stringify(datos(), null, 2));
    } catch (err) {
      console.error(`No se pudo guardar ${archivo}:`, err.message);
    }
  }

  // Para soltar de memoria la copia de una cuenta (ej. al eliminarla), y
  // que la próxima lectura vuelva a ir al disco.
  function olvidar(id) {
    enMemoria.delete(id);
  }

  return { datos, guardar, olvidar };
}

module.exports = { crearAlmacen };
