const fs = require("fs");
const { dataPath } = require("./dataDir");

const DATA_PATH = dataPath("finance-goals-data.json");
const TIPOS = ["diaria", "semanal", "mensual", "ahorroMensual"];

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      diaria: Number(parsed.diaria) || 0,
      semanal: Number(parsed.semanal) || 0,
      mensual: Number(parsed.mensual) || 0,
      ahorroMensual: Number(parsed.ahorroMensual) || 0,
    };
  } catch (err) {
    return { diaria: 0, semanal: 0, mensual: 0, ahorroMensual: 0 };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar finance-goals-data.json:", err.message);
  }
}

function getGoals() {
  return { ...data };
}

function setGoal(tipo, monto) {
  if (!TIPOS.includes(tipo)) throw new Error("Meta inválida: " + tipo);
  data[tipo] = Number(monto) || 0;
  save();
}

module.exports = { getGoals, setGoal };
