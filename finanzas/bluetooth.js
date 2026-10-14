// Conexión con la impresora térmica por Bluetooth BLE. Solo navegador.
//
// Web Bluetooth habla BLE, no Bluetooth clásico (SPP). La POS-8001DD
// anuncia 4.0 y 3.0: el 4.0 es BLE y es el que se usa acá. Funciona en
// Chrome (Android, Windows, Mac, Linux) y NO en Safari ni en iPhone, que
// no tienen Web Bluetooth y no está previsto que lo tengan.
self.Impresora = (function () {
  let dispositivo = null;
  let caracteristica = null;
  const oyentes = [];

  function avisar(estado, detalle) {
    oyentes.forEach((fn) => fn(estado, detalle));
  }

  function alCambiar(fn) {
    oyentes.push(fn);
  }

  function disponible() {
    return typeof navigator !== "undefined" && Boolean(navigator.bluetooth);
  }

  function conectada() {
    return Boolean(dispositivo && dispositivo.gatt && dispositivo.gatt.connected && caracteristica);
  }

  function nombre() {
    return dispositivo ? (dispositivo.name || "Impresora") : null;
  }

  // Busca una característica donde se pueda escribir.
  //
  // Primero las conocidas, porque acertar de una evita recorrer todo. Si
  // ninguna aparece —y pasa, porque el mismo modelo sale de fábrica con
  // UUID distintos según el lote— se recorren todos los servicios y se
  // toma la primera que acepte escritura. Es feo, pero es la diferencia
  // entre que funcione con tu impresora o no.
  async function buscarCaracteristica(servidor, perfil) {
    const preferidas = ((perfil && perfil.ble && perfil.ble.escritura) || []).map((u) => u.toLowerCase());
    const servicios = await servidor.getPrimaryServices();
    let respaldo = null;

    for (const servicio of servicios) {
      let cars;
      try {
        cars = await servicio.getCharacteristics();
      } catch (err) {
        continue; // un servicio que no deja listar no sirve igual
      }
      for (const c of cars) {
        if (!c.properties.write && !c.properties.writeWithoutResponse) continue;
        if (preferidas.includes(c.uuid.toLowerCase())) return c;
        if (!respaldo) respaldo = c;
      }
    }
    return respaldo;
  }

  async function conectar(perfil) {
    if (!disponible()) {
      throw new Error("Este navegador no tiene Bluetooth. Usá Chrome en Android o en la computadora (en iPhone no funciona).");
    }
    // acceptAllDevices porque estas impresoras no anuncian un servicio
    // estándar por el que filtrar; optionalServices es obligatorio igual,
    // si no el navegador bloquea el acceso a los servicios después.
    dispositivo = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: (perfil && perfil.ble && perfil.ble.servicios) || [],
    });

    dispositivo.addEventListener("gattserverdisconnected", () => {
      caracteristica = null;
      avisar("desconectada");
    });

    const servidor = await dispositivo.gatt.connect();
    caracteristica = await buscarCaracteristica(servidor, perfil);
    if (!caracteristica) {
      dispositivo.gatt.disconnect();
      throw new Error("Se conectó, pero esa impresora no expone por dónde escribir. Puede que hable Bluetooth clásico en vez de BLE.");
    }
    avisar("conectada", nombre());
    return nombre();
  }

  function desconectar() {
    if (dispositivo && dispositivo.gatt && dispositivo.gatt.connected) dispositivo.gatt.disconnect();
    caracteristica = null;
    avisar("desconectada");
  }

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  // Manda los bytes por partes.
  //
  // BLE tiene un tope por paquete de unos 20 bytes por defecto, y aunque se
  // negocie más, estas impresoras tienen un buffer chico. Si se les tira el
  // ticket entero de una, descartan lo que no les entra: el papel sale
  // cortado a la mitad o con caracteres sueltos, y parece un problema del
  // contenido cuando es del transporte. Por eso se parte y se le da tiempo
  // de imprimir entre trozo y trozo.
  async function enviar(bytes, perfil, alAvanzar) {
    if (!conectada()) throw new Error("No hay ninguna impresora conectada.");
    const trozo = (perfil && perfil.chunk) || 180;
    const pausa = (perfil && perfil.pausaMs) || 20;
    // writeValueWithoutResponse es bastante más rápido, pero no todas las
    // características lo soportan.
    const sinRespuesta = caracteristica.properties.writeWithoutResponse;

    for (let i = 0; i < bytes.length; i += trozo) {
      const parte = bytes.slice(i, i + trozo);
      if (sinRespuesta) await caracteristica.writeValueWithoutResponse(parte);
      else await caracteristica.writeValue(parte);
      if (alAvanzar) alAvanzar(Math.min(100, Math.round(((i + parte.length) / bytes.length) * 100)));
      if (pausa) await esperar(pausa);
    }
  }

  // Traduce los errores del navegador a algo que se entienda en el
  // mostrador. "NotFoundError" no le dice nada a nadie.
  function mensajeDeError(err) {
    const n = err && err.name;
    if (n === "NotFoundError") return "No elegiste ninguna impresora.";
    if (n === "SecurityError") return "El navegador bloqueó el Bluetooth. La página tiene que abrirse con https.";
    if (n === "NetworkError") return "No se pudo conectar. Fijate que esté encendida y cerca.";
    if (n === "NotSupportedError") return "Esa impresora no acepta este tipo de conexión.";
    return (err && err.message) || "Algo salió mal con la impresora.";
  }

  return { disponible, conectada, conectar, desconectar, enviar, nombre, alCambiar, mensajeDeError };
})();
