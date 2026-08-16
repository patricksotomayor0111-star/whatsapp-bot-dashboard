const contexto = require("./contexto");
const users = require("./users");
const reminders = require("./reminders");
const budgetCategories = require("./budgetCategories");
const scheduledExpenses = require("./scheduledExpenses");
const productionGoals = require("./productionGoals");

// Las cuentas creadas ANTES de que las semillas se limitaran al dueño
// alcanzaron a guardar su configuración en sus propios archivos: al mirar
// sus pendientes veían los pagos del dueño con sus montos reales. Dejar de
// sembrar no alcanza para esas, porque ya lo tienen escrito en disco.
//
// Esta limpieza corre una vez al arrancar y saca de las cuentas ajenas lo
// que quedó sembrado. Solo borra lo que sigue EXACTAMENTE igual que la
// semilla: si esa persona ya lo edito o le puso lo suyo, se respeta.
function esIgualALaSemilla(actual, semilla, campos) {
  return campos.every((c) => String(actual[c] ?? "") === String(semilla[c] ?? ""));
}

function limpiarCuenta(userId) {
  let borrados = 0;

  // Pendientes de pago
  const semillaPagos = reminders.SEED_ORIGINAL || [];
  reminders.getAll().forEach((r) => {
    const semilla = semillaPagos.find((s) => s.id === r.id);
    if (semilla && esIgualALaSemilla(r, semilla, ["label", "monto", "tipo"])) {
      reminders.removeReminder(r.id);
      borrados++;
    }
  });

  // Categorías de presupuesto
  const semillaCategorias = budgetCategories.SEMILLA_ORIGINAL || [];
  budgetCategories.getAllCategorias().forEach((c) => {
    const semilla = semillaCategorias.find((s) => s.id === c.id);
    if (semilla && esIgualALaSemilla(c, semilla, ["label"])) {
      budgetCategories.removeCategoria(c.id);
      borrados++;
    }
  });

  // Gastos programados
  const semillaGastos = scheduledExpenses.SEED_ORIGINAL || [];
  scheduledExpenses.getAll().forEach((g) => {
    const semilla = semillaGastos.find((s) => s.id === g.id);
    if (semilla && esIgualALaSemilla(g, semilla, ["label", "monto"])) {
      scheduledExpenses.removeGasto(g.id);
      borrados++;
    }
  });

  // Metas de producción
  const semillaMetas = productionGoals.SEED_ORIGINAL || {};
  Object.keys(semillaMetas).forEach((mes) => {
    const actual = productionGoals.getMeta(mes);
    const semilla = semillaMetas[mes];
    if (actual && esIgualALaSemilla(actual, semilla, ["metaDiariaBase", "diasProduccion"])) {
      productionGoals.removeMeta(mes);
      borrados++;
    }
  });

  return borrados;
}

function limpiar() {
  users.getAll().forEach((u) => {
    if (u.id === users.DUENO_ID) return; // la del dueño es suya de verdad
    try {
      const borrados = contexto.correrComo(u.id, () => limpiarCuenta(u.id));
      if (borrados > 0) {
        console.log(`Se quitaron ${borrados} datos del dueño que habían quedado en la cuenta "${u.id}".`);
      }
    } catch (err) {
      console.error(`No se pudo limpiar la cuenta "${u.id}":`, err.message);
    }
  });
}

module.exports = { limpiar };
