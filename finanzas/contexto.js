const { AsyncLocalStorage } = require("async_hooks");

// De quién son los datos que se están tocando en este momento.
//
// Los módulos (caja, deudas, locales...) guardan su información en memoria
// y la escriben a disco. Cuando había un solo dueño eso era una variable
// global y alcanzaba. Con varias cuentas, cada pedido HTTP y cada mensaje
// de WhatsApp tiene que saber a qué cuenta pertenece, sin tener que pasar
// el usuario por parámetro a las cientos de funciones que ya existen.
//
// AsyncLocalStorage resuelve justo eso: se abre un "contexto" al empezar a
// atender algo, y cualquier código que corra adentro —por más anidado o
// asíncrono que sea— puede preguntar de quién es sin recibirlo explícito.
const almacen = new AsyncLocalStorage();

// Corre una función dentro del contexto de un usuario.
function correrComo(userId, fn) {
  if (!userId) throw new Error("correrComo necesita un userId.");
  return almacen.run({ userId }, fn);
}

// El usuario actual. Falla a propósito si no hay contexto: es preferible
// un error ruidoso a que una cuenta termine leyendo o pisando los datos de
// otra por accidente.
function usuarioActual() {
  const ctx = almacen.getStore();
  if (!ctx || !ctx.userId) {
    throw new Error("No hay usuario en contexto: se intentó tocar datos fuera de una sesión.");
  }
  return ctx.userId;
}

// Para los pocos casos donde solo se quiere saber si hay contexto.
function hayContexto() {
  const ctx = almacen.getStore();
  return Boolean(ctx && ctx.userId);
}

module.exports = { correrComo, usuarioActual, hayContexto };
