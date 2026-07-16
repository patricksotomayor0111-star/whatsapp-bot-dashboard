const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const P = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const path = require('path');
const { EventEmitter } = require('events');

const {
  NUMEROS_IGNORADOS, GRUPOS_FOTO, GRUPOS_PRIORITARIOS, SIEMPRE_INACTIVOS,
  SECTOR_BASE, ORDEN_GRUPOS,
} = require('./constants');
const {
  loadConfig, saveConfig, loadGanancias, saveGanancias, loadReporte, saveReporte,
  loadHistorial, saveHistorial, getHoraPeru, getFechaLunesActual,
} = require('./store');
const {
  tieneHoraFuturaLejana, detectarMinutosCercanos, tieneExclusion, tieneKeywordPositiva,
  buscarKeywordEspecial, getSectorDeGrupo, esGrupoSinRemarcar, esGrupoGanancias,
  procesarMensajeSectorBase, extraerEntradas, generarTextoReporte,
} = require('./textLogic');

const SESSION_PATH = path.join(__dirname, '..', 'session');

class WhatsAppBot extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this._wantsRunning = false;
    this._starting = false;
    this._lastReply = {}; // { [chatId]: timestampMs }
    this.groups = []; // [{ id, name }]
    this.state = {
      status: 'stopped', // stopped | starting | qr | connected
      qr: null,
      qrDataUrl: null,
    };
    this._reporteEnviadoHoy = false;
    this._reporteSemanalEnviado = false;
    this._scheduleTick();
  }

  getState() {
    const cfg = loadConfig();
    return { ...this.state, botActivo: cfg.botActivo };
  }

  // ---------- Conexión ----------
  async start() {
    if (this._starting || this.state.status === 'connected') return;
    this._starting = true;
    this._wantsRunning = true;
    this._setState({ status: 'starting', qr: null, qrDataUrl: null });

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({ version, auth: state, logger: P({ level: 'silent' }) });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const qrDataUrl = await QRCode.toDataURL(qr).catch(() => null);
        this._setState({ status: 'qr', qr, qrDataUrl });
        console.log('\nEscanea este código QR con WhatsApp (o hazlo desde el panel web):\n');
        qrcodeTerminal.generate(qr, { small: true });
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        this._starting = false;
        this._setState({ status: 'stopped', qr: null, qrDataUrl: null });

        if (loggedOut) {
          console.log('Sesión cerrada desde el teléfono. Hay que volver a escanear el QR.');
          this._wantsRunning = false;
        } else if (this._wantsRunning) {
          console.log('Conexión cerrada. Reconectando...');
          setTimeout(() => this.start(), 2000);
        } else {
          console.log('Bot detenido manualmente.');
        }
      } else if (connection === 'open') {
        this._starting = false;
        this._setState({ status: 'connected', qr: null, qrDataUrl: null });
        console.log('Bot conectado a WhatsApp correctamente.');
        setTimeout(() => this.refreshGroups(), 3000);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      const msg = messages[0];
      try {
        await this._handleMessage(msg);
      } catch (e) {
        console.error('Error procesando mensaje:', e.message);
      }
    });
  }

  async stop() {
    this._wantsRunning = false;
    if (this.sock) {
      try {
        this.sock.end(new Error('Detenido manualmente desde el panel'));
      } catch (e) {
        // ignorar
      }
      this.sock = null;
    }
    this._setState({ status: 'stopped', qr: null, qrDataUrl: null });
  }

  _setState(partial) {
    this.state = { ...this.state, ...partial };
    this.emit('state', this.getState());
  }

  // ---------- Grupos reales ----------
  async refreshGroups() {
    if (!this.sock || this.state.status !== 'connected') return this.groups;
    try {
      const groupsObj = await this.sock.groupFetchAllParticipating();
      const groups = Object.values(groupsObj).map((g) => ({ id: g.id, name: g.subject }));

      groups.sort((a, b) => {
        const ia = ORDEN_GRUPOS.findIndex((n) => n.trim().toLowerCase() === a.name.trim().toLowerCase());
        const ib = ORDEN_GRUPOS.findIndex((n) => n.trim().toLowerCase() === b.name.trim().toLowerCase());
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });

      this.groups = groups;

      // Auto-activa grupos nuevos (salvo los que deben quedar inactivos por defecto)
      const cfg = loadConfig();
      groups.forEach((g) => {
        const esInactivo = SIEMPRE_INACTIVOS.some((n) => g.name.toLowerCase().includes(n.toLowerCase()));
        const esSectorX = getSectorDeGrupo(g.name) === 'Sector X (otros)';
        const esGan = esGrupoGanancias(g.name);
        if (esInactivo || (esSectorX && !esGan)) {
          cfg.gruposActivos = cfg.gruposActivos.filter((id) => id !== g.id);
          return;
        }
        if (!cfg.gruposActivos.includes(g.id)) cfg.gruposActivos.push(g.id);
      });
      saveConfig(cfg);

      this.emit('state', this.getState());
      return this.groups;
    } catch (e) {
      console.error('Error cargando grupos:', e.message);
      return this.groups;
    }
  }

  // ---------- Envío citando el mensaje original (esto sí funciona en Baileys) ----------
  async _responder(chatId, nombreGrupo, msg, texto) {
    const cfg = loadConfig();
    const respuesta = texto || cfg.autoReply || 'Voy';
    if (esGrupoSinRemarcar(nombreGrupo)) {
      return this.sock.sendMessage(chatId, { text: respuesta });
    }
    return this.sock.sendMessage(chatId, { text: respuesta }, { quoted: msg });
  }

  _extractText(msg) {
    return (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      ''
    );
  }

  _extractNumero(msg) {
    const jid = msg.key.participant || msg.key.remoteJid || '';
    return jid.replace(/@.*/, '').replace(/[^0-9]/g, '');
  }

  _registrarHistorial(grupo, sector, mensaje) {
    const historial = loadHistorial();
    const now = getHoraPeru();
    const entry = {
      grupo,
      sector,
      mensaje: mensaje.substring(0, 80),
      fecha: now.toLocaleDateString('es-PE'),
      hora: now.toLocaleTimeString('es-PE'),
    };
    historial.unshift(entry);
    saveHistorial(historial);
    this.emit('activity', entry);
  }

  // ---------- Manejo de mensajes ----------
  async _handleMessage(msg) {
    if (!msg?.message || msg.key.fromMe) return;
    if (this.state.status !== 'connected') return;

    const chatId = msg.key.remoteJid;
    if (!chatId || !chatId.endsWith('@g.us')) return;

    const esFoto = Boolean(msg.message.imageMessage);
    const esTexto = Boolean(msg.message.conversation || msg.message.extendedTextMessage);
    if (!esTexto && !esFoto) return;

    let grupoActual = this.groups.find((g) => g.id === chatId);
    if (!grupoActual) {
      await this.refreshGroups();
      grupoActual = this.groups.find((g) => g.id === chatId);
      if (!grupoActual) return;
    }

    const texto = this._extractText(msg);
    const numero = this._extractNumero(msg);
    const cfg = loadConfig();
    const cooldownMs = (cfg.cooldownMinutos || 5) * 60 * 1000;

    // ---- Grupo de ganancias: registra montos, no responde con "Voy" ----
    if (esGrupoGanancias(grupoActual.name)) {
      if (texto.trim().toLowerCase() === 'reset') {
        saveGanancias({ fecha: getHoraPeru().toLocaleDateString('es-PE'), ganancias: 0, gastos: 0 });
        await this.sock.sendMessage(chatId, {
          text: '✅ Listo, nuevo día\n✅ GANANCIAS: Total hoy: 0 soles\n📉 GASTOS: Total hoy: -0 soles\nTOTAL LIQUIDO 🤑: 0 soles',
        });
        return;
      }
      const entradas = extraerEntradas(texto);
      if (entradas.length > 0) {
        let ganData = loadGanancias();
        let rep = loadReporte();
        const lunesActual = getFechaLunesActual();
        if (rep.semana_inicio !== lunesActual) {
          rep = { semana_inicio: lunesActual, locales: {}, gastos: {}, localesHoy: {}, gastosHoy: {} };
        }
        let tGan = 0;
        let tGas = 0;
        entradas.forEach((e) => {
          if (e.tipo === 'local') {
            tGan += e.monto;
            rep.locales[e.nombre] = Math.round(((rep.locales[e.nombre] || 0) + e.monto) * 100) / 100;
            rep.localesHoy[e.nombre] = Math.round(((rep.localesHoy[e.nombre] || 0) + e.monto) * 100) / 100;
          } else {
            tGas += e.monto;
            const ng = e.nombre.charAt(0).toUpperCase() + e.nombre.slice(1);
            rep.gastos[ng] = Math.round(((rep.gastos[ng] || 0) + e.monto) * 100) / 100;
            rep.gastosHoy[ng] = Math.round(((rep.gastosHoy[ng] || 0) + e.monto) * 100) / 100;
          }
        });
        ganData.ganancias = Math.round((ganData.ganancias + tGan) * 100) / 100;
        ganData.gastos = Math.round((ganData.gastos + tGas) * 100) / 100;
        saveGanancias(ganData);
        saveReporte(rep);
        const liq = Math.round((ganData.ganancias - ganData.gastos) * 100) / 100;
        await this.sock.sendMessage(chatId, {
          text: `✅ GANANCIAS: Total hoy: ${ganData.ganancias} soles\n📉 GASTOS: Total hoy: -${ganData.gastos} soles\nTOTAL LIQUIDO ${liq >= 0 ? '🤑' : '😬'}: ${liq} soles`,
        });
        this.emit('state', this.getState());
      }
      return;
    }

    const sectorDelGrupo = getSectorDeGrupo(grupoActual.name);

    // ---- Sector Base: solo números autorizados + frases fijas ----
    if (sectorDelGrupo === SECTOR_BASE) {
      if (!cfg.botActivo) return;
      if (!cfg.gruposActivos.includes(chatId)) return;
      if (cfg.sectoresApagados.includes(SECTOR_BASE)) return;
      if (!procesarMensajeSectorBase(grupoActual.name, numero, texto)) return;

      const ahora = Date.now();
      if (this._lastReply[chatId] && ahora - this._lastReply[chatId] < cooldownMs) return;
      this._lastReply[chatId] = ahora;

      await new Promise((r) => setTimeout(r, cfg.delay || 700));
      await this._responder(chatId, grupoActual.name, msg);

      this._registrarHistorial(grupoActual.name, SECTOR_BASE, texto);
      cfg.botActivo = false;
      saveConfig(cfg);
      return;
    }

    // ---- Resto de grupos ----
    if (NUMEROS_IGNORADOS.includes(numero)) return;
    if (!cfg.botActivo) return;
    if (!cfg.gruposActivos.includes(chatId)) return;
    if (cfg.sectoresApagados.includes(sectorDelGrupo)) return;
    if (esTexto && tieneHoraFuturaLejana(texto)) return;

    const esFotoGrupo = GRUPOS_FOTO.some((n) => grupoActual.name.toLowerCase().includes(n.toLowerCase()));
    const esPrioritario = GRUPOS_PRIORITARIOS.includes(grupoActual.name.trim().toLowerCase());
    let tieneKeyword = false;

    if (esTexto) {
      const resultMinutos = detectarMinutosCercanos(texto);
      if (resultMinutos === true) tieneKeyword = true;
      else if (resultMinutos === false) return;
    }

    if (!tieneKeyword) {
      if (esPrioritario) {
        if (buscarKeywordEspecial(texto, grupoActual.name.trim())) {
          tieneKeyword = true;
        } else {
          if (tieneExclusion(texto)) return;
          tieneKeyword = tieneKeywordPositiva(texto);
        }
      } else {
        if (tieneExclusion(texto)) return;
        tieneKeyword = tieneKeywordPositiva(texto);
        if (!tieneKeyword) tieneKeyword = buscarKeywordEspecial(texto, grupoActual.name.trim());
      }
    }

    if (!tieneKeyword && !(esFoto && esFotoGrupo)) return;

    const ahora = Date.now();
    if (this._lastReply[chatId] && ahora - this._lastReply[chatId] < cooldownMs) return;
    this._lastReply[chatId] = ahora;

    await new Promise((r) => setTimeout(r, cfg.delay || 700));
    await this._responder(chatId, grupoActual.name, msg);

    this._registrarHistorial(grupoActual.name, sectorDelGrupo, esFoto ? '📸 Foto' : texto);
    cfg.botActivo = false;
    saveConfig(cfg);
  }

  // ---------- Reportes automáticos (diario 23:59, semanal domingo) ----------
  _scheduleTick() {
    setInterval(async () => {
      if (this.state.status !== 'connected') return;
      const ahora = getHoraPeru();
      const esDomingo = ahora.getDay() === 0;
      const esHora2359 = ahora.getHours() === 23 && ahora.getMinutes() === 59;

      if (esHora2359 && !this._reporteEnviadoHoy) {
        this._reporteEnviadoHoy = true;
        await this._enviarReporteDiario(ahora);
        if (esDomingo && !this._reporteSemanalEnviado) {
          this._reporteSemanalEnviado = true;
          await this._enviarReporteSemanal(ahora);
        }
      }
      if (ahora.getHours() === 0 && ahora.getMinutes() === 0) {
        this._reporteEnviadoHoy = false;
        this._reporteSemanalEnviado = false;
      }
    }, 60 * 1000);
  }

  async _enviarReporteDiario(ahora) {
    try {
      const grupoGan = this.groups.find((g) => esGrupoGanancias(g.name));
      if (!grupoGan) return;
      const ganData = loadGanancias();
      const rep = loadReporte();
      let txt = `📋 *RESUMEN DEL DÍA - ${ahora.toLocaleDateString('es-PE')}*\n─────────────────\n✅ *GANANCIAS POR LOCAL:*\n`;
      const lH = Object.keys(rep.localesHoy || {});
      txt += lH.length ? lH.map((n) => `  • ${n}: ${rep.localesHoy[n]} soles`).join('\n') + '\n' : '  (sin registros)\n';
      txt += `💰 *Total ganancias: ${ganData.ganancias} soles*\n─────────────────\n📉 *GASTOS:*\n`;
      const gH = Object.keys(rep.gastosHoy || {});
      txt += gH.length ? gH.map((n) => `  • ${n}: ${rep.gastosHoy[n]} soles`).join('\n') + '\n' : '  (sin registros)\n';
      txt += `💸 *Total gastos: ${ganData.gastos} soles*\n─────────────────\n`;
      const liq = Math.round((ganData.ganancias - ganData.gastos) * 100) / 100;
      txt += `TOTAL LIQUIDO ${liq >= 0 ? '🤑' : '😬'}: *${liq} soles*`;
      await this.sock.sendMessage(grupoGan.id, { text: txt });
      rep.localesHoy = {};
      rep.gastosHoy = {};
      saveReporte(rep);
    } catch (e) {
      console.error('Error en reporte diario:', e.message);
    }
  }

  async _enviarReporteSemanal(ahora) {
    try {
      const grupoGan = this.groups.find((g) => esGrupoGanancias(g.name));
      if (!grupoGan) return;
      const rep = loadReporte();
      const texto = generarTextoReporte(rep, rep.semana_inicio || getFechaLunesActual(), ahora.toLocaleDateString('es-PE'));
      await this.sock.sendMessage(grupoGan.id, { text: texto });
      saveReporte({ semana_inicio: getFechaLunesActual(), locales: {}, gastos: {}, localesHoy: {}, gastosHoy: {} });
    } catch (e) {
      console.error('Error en reporte semanal:', e.message);
    }
  }
}

module.exports = new WhatsAppBot();
