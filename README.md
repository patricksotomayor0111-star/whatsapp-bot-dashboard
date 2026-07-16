# WhatsApp Bot + Panel de control

Bot de WhatsApp (usando Baileys) que responde automáticamente cuando detecta
una palabra clave en un grupo, citando el mensaje original. Incluye un
panel de control web para monitorear grupos, sectores y el estado del bot.

## Estructura

Todos los archivos están en un solo nivel (sin subcarpetas) para que sea
más fácil subirlos a GitHub sin errores:

```
whatsapp-bot-dashboard/
├── bot.js         → conexión con WhatsApp, detección de palabra clave, respuesta citada
├── keywords.js    → aquí agregas o editas las palabras clave y respuestas
├── index.html     → panel de control
├── styles.css
├── script.js
├── server.js      → sirve el dashboard y arranca el bot
├── package.json
└── railway.json
```

## 1. Probar en tu computadora primero

```bash
npm install
npm start
```

En la consola aparecerá un código QR. Ábrelo desde WhatsApp en tu celular:
**Ajustes → Dispositivos vinculados → Vincular un dispositivo**, y escanéalo.

Una vez conectado, escribe la palabra `box` en un grupo donde esté el número
vinculado. El bot debe responder `Voy` citando tu mensaje.

Para cambiar la palabra clave o agregar más, edita `bot/keywords.js`.

## 2. Subir a GitHub

```bash
git init
git add .
git commit -m "Bot de WhatsApp con panel de control"
git branch -M main
git remote add origin https://github.com/tu-usuario/whatsapp-bot-dashboard.git
git push -u origin main
```

## 3. Desplegar en Railway

1. Entra a [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
2. Selecciona tu repositorio. Railway detecta `package.json` automáticamente
   (usa Nixpacks) y ejecuta `npm start`.
3. Abre la pestaña **Deployments → View Logs**. Ahí aparecerá el código QR
   en texto (igual que en tu terminal local). Escanéalo desde WhatsApp.
4. Cuando el log diga `Bot conectado a WhatsApp correctamente`, ya está listo.

### Importante: la sesión debe persistir

Railway borra el sistema de archivos en cada nuevo despliegue si no usas un
volumen. Sin esto, tendrías que escanear el QR cada vez que subas un cambio.

Para evitarlo:
1. En tu proyecto de Railway, ve a **Settings → Volumes → New Volume**.
2. Móntalo en la ruta `/app/session`.
3. Vuelve a desplegar y escanea el QR una sola vez; las siguientes veces el
   bot se reconectará solo.

## 4. Acceder al panel

Railway te da una URL pública (`https://tuapp.up.railway.app`). Ahí se
muestra el dashboard, que consulta `/api/status` para saber si el bot está
conectado y cuál fue la última palabra clave detectada.
