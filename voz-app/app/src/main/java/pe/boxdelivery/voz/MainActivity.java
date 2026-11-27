package pe.boxdelivery.voz;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;

/**
 * La pantalla de la app: el botón grande de prender/apagar, probar la voz,
 * el volumen, los permisos para que Xiaomi no la cierre en la noche, y con
 * qué bot está vinculada.
 */
public class MainActivity extends Activity {
    private static final int VERDE = Color.parseColor("#16A34A");
    private static final int GRIS = Color.parseColor("#64748B");
    private static final int TEXTO = Color.parseColor("#0F172A");
    private static final int SUAVE = Color.parseColor("#64748B");

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Button btnPrender;
    private TextView txtEstado;
    private TextView txtVinculo;
    private TextView txtUltimos;
    private Button btnNotificaciones;
    private Button btnBateria;
    private TextToSpeech ttsPrueba;

    private final Runnable refrescar = new Runnable() {
        @Override
        public void run() {
            pintar();
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(armarPantalla());
        getWindow().setStatusBarColor(VERDE);
        leerVinculo(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        leerVinculo(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(refrescar);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(refrescar);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (ttsPrueba != null) ttsPrueba.shutdown();
        super.onDestroy();
    }

    // ---------- Vincular (el botón 2 del panel abre vozpedidos://vincular?u=...&t=...) ----------
    private void leerVinculo(Intent intent) {
        Uri datos = intent != null ? intent.getData() : null;
        if (datos == null || !"vozpedidos".equals(datos.getScheme())) return;
        String url = datos.getQueryParameter("u");
        String llave = datos.getQueryParameter("t");
        if (!urlValida(url) || llave == null || llave.trim().isEmpty()) {
            Toast.makeText(this, "El link de vincular está incompleto. Usa \"Vincular a mano\".", Toast.LENGTH_LONG).show();
            return;
        }
        Prefs.vincular(this, url, llave);
        VozService.reconectar(this);
        Toast.makeText(this, "Vinculada ✅ Ahora toca el botón para prenderla.", Toast.LENGTH_LONG).show();
        pintar();
    }

    private static boolean urlValida(String url) {
        return url != null && (url.startsWith("https://") || url.startsWith("http://")) && url.length() > 10;
    }

    private void vincularAMano() {
        LinearLayout caja = new LinearLayout(this);
        caja.setOrientation(LinearLayout.VERTICAL);
        caja.setPadding(dp(20), dp(8), dp(20), 0);
        EditText url = new EditText(this);
        url.setHint("Dirección (https://…)");
        url.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        url.setText(Prefs.url(this));
        EditText llave = new EditText(this);
        llave.setHint("Llave");
        llave.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        llave.setText(Prefs.llave(this));
        caja.addView(url);
        caja.addView(llave);
        new AlertDialog.Builder(this)
                .setTitle("Vincular a mano")
                .setMessage("Copia los dos datos del panel del bot: menú → Leer en voz alta → \"Vincular a mano\".")
                .setView(caja)
                .setPositiveButton("Guardar", (d, w) -> {
                    String u = url.getText().toString().trim();
                    String t = llave.getText().toString().trim();
                    if (!urlValida(u) || t.isEmpty()) {
                        Toast.makeText(this, "Falta la dirección (https://…) o la llave.", Toast.LENGTH_LONG).show();
                        return;
                    }
                    Prefs.vincular(this, u, t);
                    VozService.reconectar(this);
                    Toast.makeText(this, "Vinculada ✅", Toast.LENGTH_SHORT).show();
                    pintar();
                })
                .setNegativeButton("Cancelar", null)
                .show();
    }

    // ---------- Prender / apagar ----------
    private void alternar() {
        if (Prefs.prendida(this)) {
            VozService.apagar(this);
        } else {
            if (!Prefs.vinculada(this)) {
                Toast.makeText(this, "Primero vincula la app (abajo).", Toast.LENGTH_LONG).show();
                return;
            }
            pedirNotificaciones();
            try {
                VozService.prender(this);
            } catch (RuntimeException e) {
                Prefs.setPrendida(this, false);
                Toast.makeText(this, "Android no la dejó prender: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
        pintar();
    }

    private void probarVoz() {
        AudioAttributes alarma = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
        String frase = "Así vas a escuchar tus pedidos. Artia: un motorizado por favor. Artia: Juan dijo voy.";
        if (ttsPrueba != null) {
            ttsPrueba.speak(frase, TextToSpeech.QUEUE_FLUSH, null, "prueba");
            return;
        }
        ttsPrueba = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) {
                Toast.makeText(this, "Tu celular no tiene lector de voz: instala \"Servicios de voz de Google\" desde Play Store.", Toast.LENGTH_LONG).show();
                return;
            }
            VozService.configurarVoz(ttsPrueba, alarma);
            ttsPrueba.speak(frase, TextToSpeech.QUEUE_FLUSH, null, "prueba");
        });
    }

    // ---------- Permisos para que no se apague ----------
    private boolean notificacionesPermitidas() {
        return Build.VERSION.SDK_INT < 33
                || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void pedirNotificaciones() {
        if (!notificacionesPermitidas()) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
    }

    private boolean sinAhorroDeBateria() {
        PowerManager pm = getSystemService(PowerManager.class);
        return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
    }

    private void quitarAhorroDeBateria() {
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName())));
        } catch (RuntimeException e) {
            abrirAjustesDeLaApp();
        }
    }

    private void inicioAutomaticoXiaomi() {
        Intent xiaomi = new Intent().setComponent(new ComponentName("com.miui.securitycenter",
                "com.miui.permcenter.autostart.AutoStartManagementActivity"));
        try {
            startActivity(xiaomi);
        } catch (RuntimeException e) {
            abrirAjustesDeLaApp();
        }
    }

    private void abrirAjustesDeLaApp() {
        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getPackageName())));
    }

    // ---------- Lo que se ve ----------
    private void pintar() {
        boolean prendida = Prefs.prendida(this);
        btnPrender.setText(prendida ? "🔊  PRENDIDA\ntoca para apagar" : "🔇  APAGADA\ntoca para prender");
        fondo(btnPrender, prendida ? VERDE : GRIS, 20);

        if (!prendida) {
            txtEstado.setText("No está leyendo nada.");
            txtEstado.setTextColor(SUAVE);
        } else {
            txtEstado.setText(VozService.corriendo ? VozService.estado : "Prendiendo…");
            txtEstado.setTextColor(VozService.conectada ? VERDE : Color.parseColor("#B45309"));
        }

        if (Prefs.vinculada(this)) {
            txtVinculo.setText("✅ Vinculada a " + Uri.parse(Prefs.url(this)).getHost());
            txtVinculo.setTextColor(VERDE);
        } else {
            txtVinculo.setText("Sin vincular. En el panel del bot: menú → Leer en voz alta → \"2. Vincular la app\" (ábrelo en este celular).");
            txtVinculo.setTextColor(Color.parseColor("#B91C1C"));
        }

        btnNotificaciones.setVisibility(notificacionesPermitidas() ? View.GONE : View.VISIBLE);
        btnBateria.setText(sinAhorroDeBateria() ? "✅ Ahorro de batería quitado" : "1. Quitar el ahorro de batería");

        List<String> lista = VozService.ultimos();
        txtUltimos.setText(lista.isEmpty() ? "Nada todavía." : String.join("\n\n", lista));
    }

    private View armarPantalla() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#F8FAFC"));
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(18), dp(20), dp(18), dp(32));
        scroll.addView(col);

        TextView titulo = texto("🔊 Voz Pedidos", 26, TEXTO);
        titulo.setTypeface(Typeface.DEFAULT_BOLD);
        col.addView(titulo);
        col.addView(texto("Dice en voz alta lo que escriben los restaurantes en tus grupos, y los \"voy\" de los demás. "
                + "Suena con el volumen de la alarma: se escucha con la pantalla apagada y en \"No molestar\".", 14, SUAVE), margen(4));

        btnPrender = new Button(this);
        btnPrender.setTextColor(Color.WHITE);
        btnPrender.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        btnPrender.setTypeface(Typeface.DEFAULT_BOLD);
        btnPrender.setAllCaps(false);
        btnPrender.setMinHeight(dp(110));
        btnPrender.setOnClickListener(v -> alternar());
        col.addView(btnPrender, margen(18));

        txtEstado = texto("", 15, SUAVE);
        txtEstado.setGravity(Gravity.CENTER);
        col.addView(txtEstado, margen(10));

        Button probar = boton("🔈  Probar la voz", Color.parseColor("#2563EB"));
        probar.setOnClickListener(v -> probarVoz());
        col.addView(probar, margen(16));

        col.addView(subtitulo("Volumen de la voz"), margen(22));
        col.addView(texto("Es el volumen de la alarma del celular.", 13, SUAVE));
        SeekBar volumen = new SeekBar(this);
        AudioManager am = getSystemService(AudioManager.class);
        volumen.setMax(am.getStreamMaxVolume(AudioManager.STREAM_ALARM));
        volumen.setProgress(am.getStreamVolume(AudioManager.STREAM_ALARM));
        volumen.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar s, int valor, boolean delUsuario) {
                if (!delUsuario) return;
                try {
                    am.setStreamVolume(AudioManager.STREAM_ALARM, Math.max(1, valor), 0);
                } catch (RuntimeException ignorado) {
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar s) {}

            @Override
            public void onStopTrackingTouch(SeekBar s) {}
        });
        col.addView(volumen, margen(8));

        col.addView(subtitulo("Para que no se apague en la noche"), margen(22));
        col.addView(texto("Xiaomi cierra las apps para ahorrar batería. Haz estos pasos una sola vez:", 13, SUAVE));
        btnNotificaciones = boton("Permitir el aviso de la app", GRIS);
        btnNotificaciones.setOnClickListener(v -> pedirNotificaciones());
        col.addView(btnNotificaciones, margen(8));
        btnBateria = boton("1. Quitar el ahorro de batería", GRIS);
        btnBateria.setOnClickListener(v -> quitarAhorroDeBateria());
        col.addView(btnBateria, margen(8));
        Button autoinicio = boton("2. Inicio automático (Xiaomi): actívalo", GRIS);
        autoinicio.setOnClickListener(v -> inicioAutomaticoXiaomi());
        col.addView(autoinicio, margen(8));
        Button ajustes = boton("3. Ahorro de batería de Xiaomi → \"Sin restricciones\"", GRIS);
        ajustes.setOnClickListener(v -> abrirAjustesDeLaApp());
        col.addView(ajustes, margen(8));
        col.addView(texto("4. Abre las apps recientes, mantén presionada Voz Pedidos y toca el candado 🔒.\n"
                + "También puedes prenderla y apagarla desde la cortina (donde está la linterna): edita los botones y agrega \"Voz pedidos\".",
                13, SUAVE), margen(8));

        col.addView(subtitulo("Vinculación con el bot"), margen(22));
        txtVinculo = texto("", 14, SUAVE);
        col.addView(txtVinculo, margen(4));
        Button aMano = boton("Vincular a mano", GRIS);
        aMano.setOnClickListener(v -> vincularAMano());
        col.addView(aMano, margen(8));

        col.addView(subtitulo("Lo último que leyó"), margen(22));
        txtUltimos = texto("", 14, TEXTO);
        col.addView(txtUltimos, margen(6));
        return scroll;
    }

    private TextView texto(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setLineSpacing(0, 1.15f);
        return t;
    }

    private TextView subtitulo(String s) {
        TextView t = texto(s, 17, TEXTO);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button boton(String s, int color) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        fondo(b, color, 12);
        return b;
    }

    private void fondo(View v, int color, int radioDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radioDp));
        v.setBackground(g);
    }

    private LinearLayout.LayoutParams margen(int arribaDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(arribaDp);
        return lp;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
