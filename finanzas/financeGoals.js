const { crearAlmacen } = require("./almacenPorUsuario");

// Lo unico que se guarda a mano es el ahorro mensual: cuanto quiere juntar
// ese mes ademas de cubrir sus gastos. Las metas diaria/semanal/mensual ya
// NO se escriben, se calculan solas en metasAutomaticas.js a partir de lo
// que falta pagar de aqui a fin de mes.
//
// getGoals() sigue devolviendo las tres para que todo lo que ya las leia
// (el bot, las notificaciones, el panel) reciba el numero correcto sin
// tener que cambiar cada lugar por separado.
const TIPOS = ["ahorroMensual"];
const CALCULADAS = ["diaria", "semanal", "mensual"];

const almacen = crearAlmacen("finance-goals-data.json", function (parsed) {
  try {
    return { ahorroMensual: Number(parsed.ahorroMensual) || 0 };
  } catch (err) {
    return { ahorroMensual: 0 };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;

// Lo lee metasAutomaticas. Va aparte de getGoals() a proposito: si llamara
// a getGoals() se llamarian el uno al otro sin fin.
function getAhorroMensual() {
  return datos().ahorroMensual || 0;
}

// hasta: fecha limite opcional (YYYY-MM-DD). Sin ella va al fin de mes,
// que es lo que usan el bot y las notificaciones.
function getGoals(hasta) {
  const metas = require("./metasAutomaticas").calcular(hasta);
  return {
    diaria: metas.diaria,
    semanal: metas.semanal,
    mensual: metas.mensual,
    ahorroMensual: getAhorroMensual(),
    automaticas: metas,
  };
}

function setGoal(tipo, monto) {
  if (CALCULADAS.includes(tipo)) {
    throw new Error("La meta " + tipo + " se calcula sola a partir de tus pendientes; no se escribe a mano.");
  }
  if (!TIPOS.includes(tipo)) throw new Error("Meta inválida: " + tipo);
  datos()[tipo] = Number(monto) || 0;
  save();
}

module.exports = { getGoals, setGoal, getAhorroMensual };
