# Voz Pedidos (app Android)

Dice en voz alta lo que el bot Voy le manda (ver `vozPedidos.js` en la raíz):
lo que escribe el restaurante en los grupos de los sectores (menos "Otros") y
los "voy" de los números ignorados. Se prende y se apaga en la app.

- Se conecta a `/voz/stream?t=<llave>` del bot y escucha (text/event-stream).
- Habla con el audio de la ALARMA: suena en "No molestar" y con la pantalla apagada.
- Se vincula desde el panel: menú → Leer en voz alta → "2. Vincular la app"
  (abre `vozpedidos://vincular?u=<dirección>&t=<llave>`), o a mano.
- El instalador que descarga el panel es `dist/voz-pedidos.apk`.

## Armar el instalador

Necesita el Android SDK (platform 35 y build-tools 35):

```
echo "sdk.dir=/ruta/al/android-sdk" > local.properties
gradle assembleRelease
cp app/build/outputs/apk/release/app-release.apk dist/voz-pedidos.apk
```

Va firmada con la llave de depuración de la máquina donde se arma: si se arma
en otra, para actualizarla hay que desinstalar la anterior y volver a vincular.
