package pe.boxdelivery.voz;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.service.quicksettings.TileService;
import android.speech.tts.TextToSpeech;

import org.json.JSONObject;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedList;
import java.util.List;
import java.util.Locale;

/**
 * Se queda conectada al bot (aunque la pantalla esté apagada) y dice en voz
 * alta lo que el bot le manda. El bot decide qué se lee (ver vozPedidos.js);
 * acá solo se escucha y se habla.
 *
 * Suena con el volumen de la ALARMA: así se escucha aunque el celular esté
 * en "No molestar" o en silencio.
 */
public class VozService extends Service implements TextToSpeech.OnInitListener {
    static final String ACCION_APAGAR = "pe.boxdelivery.voz.APAGAR";
    static final String ACCION_RECONECTAR = "pe.boxdelivery.voz.RECONECTAR";
    private static final String CANAL = "voz_estado";
    private static final int NOTIF_ID = 1;
    private static final int MAX_ULTIMOS = 20;

    // Lo que muestra la pantalla de la app (la lee cada segundo).
    static volatile boolean corriendo = false;
    static volatile boolean conectada = false;
    static volatile String estado = "Apagada";
    private static final LinkedList<String> ultimos = new LinkedList<>();

    private Handler principal;
    private TextToSpeech tts;
    private boolean ttsListo = false;
    private final List<String> porDecir = new ArrayList<>();
    private ToneGenerator tono;
    private AudioAttributes atributos;

    private Thread hilo;
    private volatile boolean seguir = false;
    private volatile HttpURLConnection conexion;
    private final Object espera = new Object();

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private ConnectivityManager.NetworkCallback redCallback;

    // ---------- Para prender y apagar desde la app, el botón rápido y el arranque ----------
    static void prender(Context c) {
        Prefs.setPrendida(c, true);
        c.startForegroundService(new Intent(c, VozService.class));
        avisarBotonRapido(c);
    }

    static void apagar(Context c) {
        Prefs.setPrendida(c, false);
        c.stopService(new Intent(c, VozService.class));
        avisarBotonRapido(c);
    }

    /** Después de vincular de nuevo: vuelve a conectar con la llave nueva. */
    static void reconectar(Context c) {
        if (!corriendo) return;
        c.startForegroundService(new Intent(c, VozService.class).setAction(ACCION_RECONECTAR));
    }

    static void avisarBotonRapido(Context c) {
        try {
            TileService.requestListeningState(c, new ComponentName(c, VozTile.class));
        } catch (Exception ignorado) {
        }
    }

    static List<String> ultimos() {
        synchronized (ultimos) {
            return new ArrayList<>(ultimos);
        }
    }

    // ---------- Ciclo de vida ----------
    @Override
    public void onCreate() {
        super.onCreate();
        principal = new Handler(Looper.getMainLooper());
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel canal = new NotificationChannel(CANAL, "Voz prendida", NotificationManager.IMPORTANCE_LOW);
        canal.setDescription("Aviso fijo mientras la app escucha tus grupos.");
        canal.setShowBadge(false);
        nm.createNotificationChannel(canal);

        atributos = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
        tts = new TextToSpeech(this, this);
        try {
            tono = new ToneGenerator(AudioManager.STREAM_ALARM, 70);
        } catch (RuntimeException e) {
            tono = null;
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String accion = intent != null ? intent.getAction() : null;
        if (ACCION_APAGAR.equals(accion)) {
            Prefs.setPrendida(this, false);
            avisarBotonRapido(this);
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIF_ID, notificacion(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(NOTIF_ID, notificacion());
            }
        } catch (RuntimeException e) {
            // Android no deja prenderla desde atrás (ej. sin quitar el ahorro de batería).
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!Prefs.prendida(this)) Prefs.setPrendida(this, true);
        corriendo = true;
        tomarCandados();
        if (ACCION_RECONECTAR.equals(accion)) cortarConexion();
        if (hilo == null || !hilo.isAlive()) {
            seguir = true;
            hilo = new Thread(this::bucle, "voz-escuchar");
            hilo.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        seguir = false;
        corriendo = false;
        conectada = false;
        estado = "Apagada";
        cortarConexion();
        soltarCandados();
        if (tts != null) tts.shutdown();
        if (tono != null) tono.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---------- La notificación fija ----------
    private Notification notificacion() {
        PendingIntent abrir = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent apagar = PendingIntent.getService(this, 1,
                new Intent(this, VozService.class).setAction(ACCION_APAGAR), PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = new Notification.Builder(this, CANAL)
                .setSmallIcon(R.drawable.ic_voz)
                .setContentTitle("🔊 Voz Pedidos prendida")
                .setContentText(estado)
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(abrir)
                .addAction(new Notification.Action.Builder(null, "Apagar", apagar).build());
        if (Build.VERSION.SDK_INT >= 31) {
            b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return b.build();
    }

    private void setEstado(String texto, boolean ok) {
        estado = texto;
        conectada = ok;
        if (!seguir) return;
        try {
            getSystemService(NotificationManager.class).notify(NOTIF_ID, notificacion());
        } catch (RuntimeException ignorado) {
        }
    }

    // ---------- Que no se duerma ----------
    private void tomarCandados() {
        if (wakeLock == null) {
            PowerManager pm = getSystemService(PowerManager.class);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "VozPedidos:escuchar");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
        if (wifiLock == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "VozPedidos:wifi");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
            }
        }
        if (redCallback == null) {
            // Si vuelve el internet (o cambia de wifi a datos), se reconecta al toque.
            redCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    despertar();
                }

                @Override
                public void onLost(Network network) {
                    cortarConexion();
                }
            };
            try {
                getSystemService(ConnectivityManager.class).registerDefaultNetworkCallback(redCallback);
            } catch (RuntimeException e) {
                redCallback = null;
            }
        }
    }

    private void soltarCandados() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        wifiLock = null;
        if (redCallback != null) {
            try {
                getSystemService(ConnectivityManager.class).unregisterNetworkCallback(redCallback);
            } catch (RuntimeException ignorado) {
            }
            redCallback = null;
        }
    }

    // ---------- Escuchar al bot ----------
    private void bucle() {
        int intento = 0;
        while (seguir) {
            if (!Prefs.vinculada(this)) {
                setEstado("Falta vincular: en el panel del bot, menú → Leer en voz alta → botón 2", false);
                dormir(30_000);
                continue;
            }
            try {
                setEstado("Conectando…", false);
                int codigo = escuchar(Prefs.url(this), Prefs.llave(this));
                if (codigo == 401) {
                    setEstado("La llave no sirve: vuelve a vincular la app desde el panel", false);
                    dormir(60_000);
                    continue;
                }
                if (codigo != 200) throw new IOException("HTTP " + codigo);
                intento = 0; // se cortó después de andar bien (ej. el bot se reinició)
            } catch (Exception e) {
                if (!seguir) break;
                setEstado("Sin conexión, reintentando…", false);
            }
            intento++;
            dormir(Math.min(30_000L, 2_000L << Math.min(intento, 4)));
        }
    }

    /** Se queda leyendo hasta que se corta. Devuelve el código HTTP. */
    private int escuchar(String base, String llave) throws IOException {
        String dispositivo = (Build.MANUFACTURER + " " + Build.MODEL).trim();
        URL url = new URL(base + "/voz/stream?t=" + URLEncoder.encode(llave, "UTF-8")
                + "&d=" + URLEncoder.encode(dispositivo, "UTF-8"));
        HttpURLConnection con = (HttpURLConnection) url.openConnection();
        conexion = con;
        try {
            return LectorEventos.leer(con, Prefs.ultimoId(this), () -> seguir, new LectorEventos.Oyente() {
                @Override
                public void conectada() {
                    setEstado("Conectada ✅ escuchando tus grupos", true);
                }

                @Override
                public void evento(String id, String tipo, String datos) {
                    if ("leer".equals(tipo)) recibir(id, datos);
                }
            });
        } finally {
            conexion = null;
            con.disconnect();
        }
    }

    private void recibir(String id, String json) {
        try {
            String texto = new JSONObject(json).optString("texto", "").trim();
            if (id != null && !id.isEmpty()) Prefs.setUltimoId(this, id);
            if (!texto.isEmpty()) hablar(texto);
        } catch (Exception ignorado) {
        }
    }

    private void cortarConexion() {
        final HttpURLConnection con = conexion;
        if (con != null) new Thread(con::disconnect).start();
        despertar();
    }

    private void dormir(long ms) {
        synchronized (espera) {
            try {
                espera.wait(ms);
            } catch (InterruptedException ignorado) {
            }
        }
    }

    private void despertar() {
        synchronized (espera) {
            espera.notifyAll();
        }
    }

    // ---------- Hablar ----------
    private void hablar(String texto) {
        String hora = new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date());
        synchronized (ultimos) {
            ultimos.addFirst(hora + "  " + texto);
            while (ultimos.size() > MAX_ULTIMOS) ultimos.removeLast();
        }
        principal.post(() -> {
            if (!ttsListo) {
                porDecir.add(texto);
                return;
            }
            decir(texto);
        });
    }

    private void decir(String texto) {
        // Un "tin" corto antes, para despertar la atención, y una pausa.
        if (tono != null) {
            try {
                tono.startTone(ToneGenerator.TONE_PROP_BEEP2, 250);
            } catch (RuntimeException ignorado) {
            }
        }
        tts.playSilentUtterance(450, TextToSpeech.QUEUE_ADD, null);
        Bundle params = new Bundle();
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1f);
        tts.speak(texto, TextToSpeech.QUEUE_ADD, params, "voz-" + System.nanoTime());
    }

    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS) {
            setEstado("Tu celular no tiene lector de voz: instala \"Servicios de voz de Google\"", conectada);
            return;
        }
        configurarVoz(tts, atributos);
        ttsListo = true;
        for (String t : porDecir) decir(t);
        porDecir.clear();
    }

    /** Español (de Perú si está) y con el audio de la alarma. La usa también "Probar la voz". */
    static void configurarVoz(TextToSpeech tts, AudioAttributes atributos) {
        tts.setAudioAttributes(atributos);
        Locale[] idiomas = {new Locale("es", "PE"), new Locale("es", "US"), new Locale("es", "MX"),
                new Locale("es", "ES"), new Locale("es")};
        for (Locale l : idiomas) {
            int r = tts.isLanguageAvailable(l);
            if (r >= TextToSpeech.LANG_AVAILABLE) {
                tts.setLanguage(l);
                break;
            }
        }
        tts.setSpeechRate(0.95f);
    }
}
