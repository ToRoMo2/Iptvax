package com.iptvax.app;

import android.app.UiModeManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.Configuration;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Détection du type d'appareil : box Android TV (leanback) vs téléphone.
 *
 * Le même APK s'installe sur les deux (docs/native-port.md §4, Phase 2d) → la
 * distinction se fait au RUNTIME. Sert à l'onboarding TV par QR code
 * (Phase 2f) : sur une TV, l'app affiche un QR d'appairage au lieu du
 * formulaire de connexion (saisie texte pénible à la télécommande).
 *
 * Côté JS : src/native/tvDetect.ts.
 */
@CapacitorPlugin(name = "TvDetect")
public class TvDetectPlugin extends Plugin {

    @PluginMethod
    public void isTv(final PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isTv", detectTv());
        call.resolve(ret);
    }

    private boolean detectTv() {
        Context ctx = getContext();

        UiModeManager uiMode = (UiModeManager) ctx.getSystemService(Context.UI_MODE_SERVICE);
        if (uiMode != null
                && uiMode.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
            return true;
        }

        // Repli : certains constructeurs ne renseignent pas UI_MODE → on se
        // rabat sur la présence des fonctionnalités leanback / télévision.
        PackageManager pm = ctx.getPackageManager();
        return pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
                || pm.hasSystemFeature("android.hardware.type.television");
    }
}
