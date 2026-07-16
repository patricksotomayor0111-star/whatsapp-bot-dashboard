const express = require("express");
const path = require("path");
const { startBot, botState } = require("./bot");

const app = express();
app.use(express.json());

// Solo se exponen estos 3 archivos del panel (no todo el proyecto,
// para no dejar accesible el código del bot ni la sesión de WhatsApp)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
app.get("/styles.css", (req, res) => {
  res.sendFile(path.join(__dirname, "styles.css"));
});
app.get("/script.js", (req, res) => {
  res.sendFile(path.join(__dirname, "script.js"));
});

// El dashboard consulta esto para saber si el bot está conectado
app.get("/api/status", (req, res) => {
  res.json({
    connected: botState.connected,
    lastActivity: botState.lastActivity,
  });
});

app.get("/api/qr", (req, res) => {
  res.json({
    connected: botState.connected,
    qrImage: botState.qrImage,
  });
});

// Página para escanear el código QR desde el navegador (más confiable que los logs)
app.get("/qr", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Vincular WhatsApp</title>
<style>
  body { font-family: sans-serif; background:#F8FAFC; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:20px; text-align:center; }
  h1 { font-size:18px; color:#1F1F1F; }
  p { color:#5F5E5A; font-size:14px; }
  img { width:280px; height:280px; margin:20px 0; border:8px solid white; border-radius:12px; box-shadow:0 4px 20px rgba(0,0,0,0.1); }
  .connected { color:#16a34a; font-weight:bold; font-size:20px; }
</style>
</head>
<body>
  <h1>Vincula tu WhatsApp</h1>
  <p>Abre WhatsApp en tu celular → Dispositivos vinculados → Vincular un dispositivo, y escanea este código</p>
  <div id="content">Cargando...</div>
  <script>
    async function refresh() {
      try {
        const res = await fetch('/api/qr');
        const data = await res.json();
        const content = document.getElementById('content');
        if (data.connected) {
          content.innerHTML = '<p class="connected">Bot conectado correctamente</p>';
        } else if (data.qrImage) {
          content.innerHTML = '<img src="' + data.qrImage + '" alt="Código QR" />';
        } else {
          content.innerHTML = '<p>Esperando código QR...</p>';
        }
      } catch (e) {}
    }
    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Dashboard disponible en el puerto ${PORT}`);
});

startBot().catch((err) => {
  console.error("Error al iniciar el bot:", err);
});
