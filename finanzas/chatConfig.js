const { crearAlmacen } = require("./almacenPorUsuario");

// En qué chat de WhatsApp escucha el bot de cada cuenta.
//
// Antes el nombre del grupo estaba fijo en el código ("GANANCIAS"), así
// que cualquiera que usara la app tenía que crear un grupo con ese nombre
// exacto: si lo escribía distinto, no funcionaba y no había forma de
// darse cuenta. Ahora cada cuenta elige su chat.
//
// El valor guardado puede ser:
//   - null            -> sin elegir: se usa el grupo con el nombre de
//                        siempre, para no cambiarle nada a quien ya lo tenía
//   - "__yo__"        -> los mensajes que se manda a sí mismo
//   - un id de chat   -> un grupo puntual
const YO_MISMO = "__yo__";

const almacen = crearAlmacen("chat-config-data.json", function (parsed) {
  try {
    return { chatCaja: parsed.chatCaja || null, chatPrecios: parsed.chatPrecios || null };
  } catch (err) {
    return { chatCaja: null, chatPrecios: null };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;

function getConfig() {
  return { chatCaja: datos().chatCaja, chatPrecios: datos().chatPrecios };
}

function setChatCaja(chatId) {
  datos().chatCaja = chatId || null;
  save();
}

function setChatPrecios(chatId) {
  datos().chatPrecios = chatId || null;
  save();
}

module.exports = { YO_MISMO, getConfig, setChatCaja, setChatPrecios };
