package pe.boxdelivery.voz;

import android.content.Context;
import android.content.SharedPreferences;

/** Lo que la app recuerda: a qué bot está vinculada, si está prendida y lo último que leyó. */
final class Prefs {
    private static final String ARCHIVO = "voz";

    private Prefs() {}

    private static SharedPreferences p(Context c) {
        return c.getApplicationContext().getSharedPreferences(ARCHIVO, Context.MODE_PRIVATE);
    }

    static String url(Context c) {
        return p(c).getString("url", "");
    }

    static String llave(Context c) {
        return p(c).getString("llave", "");
    }

    static boolean vinculada(Context c) {
        return !url(c).isEmpty() && !llave(c).isEmpty();
    }

    static void vincular(Context c, String url, String llave) {
        String limpia = url.trim();
        while (limpia.endsWith("/")) limpia = limpia.substring(0, limpia.length() - 1);
        p(c).edit().putString("url", limpia).putString("llave", llave.trim()).remove("ultimoId").apply();
    }

    static boolean prendida(Context c) {
        return p(c).getBoolean("prendida", false);
    }

    static void setPrendida(Context c, boolean valor) {
        p(c).edit().putBoolean("prendida", valor).apply();
    }

    /** El id del último mensaje recibido: al reconectar, el bot repite lo que se perdió. */
    static String ultimoId(Context c) {
        return p(c).getString("ultimoId", "");
    }

    static void setUltimoId(Context c, String id) {
        p(c).edit().putString("ultimoId", id).apply();
    }
}
