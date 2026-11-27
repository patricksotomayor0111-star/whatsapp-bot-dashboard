package pe.boxdelivery.voz;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.function.BooleanSupplier;

/**
 * Lee lo que manda el bot por /voz/stream (eventos "text/event-stream").
 * Está aparte, sin nada de Android, para poder probarlo en la computadora
 * contra el bot de verdad.
 */
final class LectorEventos {
    interface Oyente {
        void conectada();

        void evento(String id, String tipo, String datos);
    }

    private LectorEventos() {}

    /** Se queda leyendo hasta que se corta o seguir dice que no. Devuelve el código HTTP. */
    static int leer(HttpURLConnection con, String ultimoId, BooleanSupplier seguir, Oyente oyente) throws IOException {
        con.setConnectTimeout(15_000);
        // El bot manda algo cada 20 seg: si pasan 70 sin nada, la conexión murió.
        con.setReadTimeout(70_000);
        con.setRequestProperty("Accept", "text/event-stream");
        con.setUseCaches(false);
        if (ultimoId != null && !ultimoId.isEmpty()) con.setRequestProperty("Last-Event-ID", ultimoId);
        int codigo = con.getResponseCode();
        if (codigo != 200) return codigo;
        oyente.conectada();

        BufferedReader r = new BufferedReader(new InputStreamReader(con.getInputStream(), StandardCharsets.UTF_8));
        String linea;
        String id = null;
        String tipo = null;
        StringBuilder datos = new StringBuilder();
        while (seguir.getAsBoolean() && (linea = r.readLine()) != null) {
            if (linea.isEmpty()) {
                if (tipo != null && datos.length() > 0) oyente.evento(id, tipo, datos.toString());
                id = null;
                tipo = null;
                datos.setLength(0);
            } else if (linea.startsWith(":")) {
                // latido del bot: la conexión sigue viva
            } else if (linea.startsWith("id:")) {
                id = linea.substring(3).trim();
            } else if (linea.startsWith("event:")) {
                tipo = linea.substring(6).trim();
            } else if (linea.startsWith("data:")) {
                if (datos.length() > 0) datos.append('\n');
                datos.append(linea.substring(5).trim());
            }
        }
        return 200;
    }
}
