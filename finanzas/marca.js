const fs = require("fs");
const { dataPath } = require("./dataDir");

// El nombre y el logo de la app. A diferencia de casi todo lo demás, esto
// NO es por cuenta: es la marca del producto, igual para todos los
// clientes. Solo el dueño la edita.
const DATA_PATH = dataPath("marca-data.json");
const ICONO_PATH = dataPath("marca-icono.png");

const POR_DEFECTO = {
  nombre: "Finanzas",
  descripcion: "Caja chica, deudas, metas y gastos programados por WhatsApp",
};

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    return {
      nombre: parsed.nombre || POR_DEFECTO.nombre,
      descripcion: parsed.descripcion || POR_DEFECTO.descripcion,
    };
  } catch (err) {
    return { ...POR_DEFECTO };
  }
}

const data = loadData();

function save() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("No se pudo guardar marca-data.json:", err.message);
  }
}

function tieneIconoPropio() {
  return fs.existsSync(ICONO_PATH);
}

function getMarca() {
  return { nombre: data.nombre, descripcion: data.descripcion, tieneIcono: tieneIconoPropio() };
}

function setMarca({ nombre, descripcion }) {
  if (nombre !== undefined && String(nombre).trim()) data.nombre = String(nombre).trim();
  if (descripcion !== undefined) data.descripcion = String(descripcion).trim() || POR_DEFECTO.descripcion;
  save();
  return getMarca();
}

// El logo llega como data URL desde el panel (así no hace falta agregar
// una dependencia para subir archivos). Se guarda como PNG y desde ahí se
// sirve en lugar del ícono que viene con la app.
function setIcono(dataUrl) {
  const m = String(dataUrl || "").match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
  if (!m) throw new Error("La imagen no es válida. Usa un PNG o JPG.");
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > 2 * 1024 * 1024) throw new Error("La imagen es muy pesada (máximo 2MB).");
  fs.writeFileSync(ICONO_PATH, buffer);
  return getMarca();
}

function quitarIcono() {
  try {
    fs.unlinkSync(ICONO_PATH);
  } catch (err) {
    // no había ícono propio
  }
  return getMarca();
}

// Ruta del ícono a servir: el propio si lo hay, si no el que viene con la
// app. Devuelve null para que quien llama use el archivo de siempre.
function getIconoPath() {
  return tieneIconoPropio() ? ICONO_PATH : null;
}

module.exports = { getMarca, setMarca, setIcono, quitarIcono, getIconoPath };
