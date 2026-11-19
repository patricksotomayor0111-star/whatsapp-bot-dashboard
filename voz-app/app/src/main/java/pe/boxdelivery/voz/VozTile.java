package pe.boxdelivery.voz;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** El botón de la cortina (junto a la linterna) para prender y apagar la voz. */
public class VozTile extends TileService {
    @Override
    public void onStartListening() {
        pintar();
    }

    @Override
    public void onClick() {
        if (Prefs.prendida(this)) {
            VozService.apagar(this);
        } else if (!Prefs.vinculada(this)) {
            abrirApp();
            return;
        } else {
            try {
                VozService.prender(this);
            } catch (RuntimeException e) {
                // Android no la deja prender desde acá: se abre la app.
                Prefs.setPrendida(this, false);
                abrirApp();
                return;
            }
        }
        pintar();
    }

    private void pintar() {
        Tile tile = getQsTile();
        if (tile == null) return;
        boolean prendida = Prefs.prendida(this);
        tile.setState(prendida ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        tile.setLabel("Voz pedidos");
        if (Build.VERSION.SDK_INT >= 29) tile.setSubtitle(prendida ? "Prendida" : "Apagada");
        tile.updateTile();
    }

    // En Android 14+ se usa la versión con PendingIntent; la otra solo corre antes.
    @SuppressLint("StartActivityAndCollapseDeprecated")
    @SuppressWarnings("deprecation")
    private void abrirApp() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE));
        } else {
            startActivityAndCollapse(i);
        }
    }
}
