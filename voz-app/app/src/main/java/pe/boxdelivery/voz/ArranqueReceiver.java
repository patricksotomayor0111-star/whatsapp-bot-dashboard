package pe.boxdelivery.voz;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Si el celular se reinicia (o la app se actualiza) con la voz prendida, la vuelve a prender. */
public class ArranqueReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String accion = intent != null ? intent.getAction() : null;
        if (!Intent.ACTION_BOOT_COMPLETED.equals(accion) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(accion)) return;
        if (!Prefs.prendida(context) || !Prefs.vinculada(context)) return;
        try {
            VozService.prender(context);
        } catch (RuntimeException ignorado) {
            // Sin permiso para prenderse sola: queda apagada hasta que la abras.
            Prefs.setPrendida(context, false);
        }
    }
}
