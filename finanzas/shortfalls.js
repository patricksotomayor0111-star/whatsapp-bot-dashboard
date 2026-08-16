const { crearAlmacen } = require("./almacenPorUsuario");



const almacen = crearAlmacen("shortfalls-data.json", function (parsed) {
  try {
    return { total: parsed.total || 0, movimientos: parsed.movimientos || [] };
  } catch (err) {
    return { total: 0, movimientos: [] };
  }
});
const datos = almacen.datos;
const save = almacen.guardar;


function peruAhora() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs - 5 * 3600000);
}

function fechaLabel(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dia}`;
}

function horaLabel(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// "Menos X falto": ya se resta de la caja como un gasto normal (eso lo hace
// quien llama a esto, vía cashbox.addGasto); acá solo se lleva la cuenta
// aparte de cuánto se ha perdido en total.
//
// "movimientoId" es el gasto que quedó en la caja por este faltante, para
// poder corregirlo o borrarlo junto con él. Los faltantes viejos no lo
// tienen: en esos, cada lado se sigue corrigiendo por separado.
function addFaltante(monto, descripcion, movimientoId) {
  const ahora = peruAhora();
  datos().total += monto;
  datos().movimientos.push({
    fecha: fechaLabel(ahora),
    hora: horaLabel(ahora),
    monto,
    descripcion: descripcion || "",
    movimientoId: movimientoId || null,
  });
  save();
}

function getTotal() {
  return datos().total;
}

function getMovimientos() {
  return datos().movimientos;
}

// Corrige el total de faltantes. Devuelve el movimiento (con su
// "movimientoId") para que quien llama arregle también el gasto que quedó
// en la caja, y los dos lados no se desincronicen.
function editMovimiento(indice, cambios) {
  const mov = datos().movimientos[indice];
  if (!mov) return null;
  datos().total -= mov.monto;
  if (cambios.monto !== undefined) mov.monto = Number(cambios.monto) || 0;
  if (cambios.descripcion !== undefined) mov.descripcion = cambios.descripcion;
  if (cambios.fecha !== undefined) mov.fecha = cambios.fecha;
  if (cambios.hora !== undefined) mov.hora = cambios.hora;
  datos().total += mov.monto;
  save();
  return mov;
}

// Devuelve el faltante que se borró (o null), por el mismo motivo.
function removeMovimiento(indice) {
  const mov = datos().movimientos[indice];
  if (!mov) return null;
  datos().total -= mov.monto;
  datos().movimientos.splice(indice, 1);
  save();
  return mov;
}

// El camino inverso: borrar el gasto desde Movimientos también tiene que
// descontar ese faltante del total acumulado.
function removePorMovimiento(movimientoId) {
  if (!movimientoId) return null;
  const indice = datos().movimientos.findIndex((m) => m.movimientoId === movimientoId);
  return indice === -1 ? null : removeMovimiento(indice);
}

// Y editar el monto del gasto tiene que corregir el faltante.
function editPorMovimiento(movimientoId, cambios) {
  if (!movimientoId) return null;
  const indice = datos().movimientos.findIndex((m) => m.movimientoId === movimientoId);
  return indice === -1 ? null : editMovimiento(indice, cambios);
}

module.exports = {
  addFaltante,
  getTotal,
  getMovimientos,
  editMovimiento,
  removeMovimiento,
  removePorMovimiento,
  editPorMovimiento,
};
