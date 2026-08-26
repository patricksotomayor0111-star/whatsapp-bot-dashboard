const { crearAlmacen } = require("./almacenPorUsuario");

const TIPOS = ["diaria", "semanal", "mensual", "ahorroMensual"];


const almacen = crearAlmacen("finance-goals-data.json", function (parsed) {
  try {
    return {
      diaria: Number(parsed.diaria) || 0,
      semanal: Number(parsed.semanal) || 0,
      mensual: Number(parsed.mensual) || 0,
      ahorroMensual: Number(parsed.ahorroMensual) || 0,
    };
  } catch (err) {
    return { diaria: 0, semanal: 0, mensual: 0, ahorroMensual: 0 };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;


function getGoals() {
  return { ...datos() };
}

function setGoal(tipo, monto) {
  if (!TIPOS.includes(tipo)) throw new Error("Meta inválida: " + tipo);
  datos()[tipo] = Number(monto) || 0;
  save();
}

module.exports = { getGoals, setGoal };
