package com.iptvax.app;

import android.database.ContentObserver;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Contrôle du volume média système (STREAM_MUSIC) depuis le lecteur web.
 *
 * Trois opérations :
 *   - getMediaVolume() → volume courant (0.0–1.0)
 *   - setMediaVolume({ volume }) → change le volume STREAM_MUSIC
 *   - event "volumeChange" → émis quand les boutons physiques changent le volume
 *
 * Côté JS : src/native/volumeControl.ts
 */
@CapacitorPlugin(name = "VolumeControl")
public class VolumeControlPlugin extends Plugin {

    private ContentObserver volumeObserver;
    private double lastVolume = -1.0;

    /* ── Lifecycle ──────────────────────────────────────────────────── */

    @Override
    protected void handleOnStart() {
        super.handleOnStart();
        volumeObserver = new ContentObserver(new Handler(Looper.getMainLooper())) {
            @Override
            public void onChange(boolean selfChange) {
                super.onChange(selfChange);
                checkAndNotify();
            }
        };
        getContext().getContentResolver().registerContentObserver(
            android.provider.Settings.System.CONTENT_URI,
            true,
            volumeObserver
        );
        // Initialise lastVolume pour éviter une fausse notification au démarrage.
        lastVolume = readVolume();
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        if (volumeObserver != null) {
            getContext().getContentResolver().unregisterContentObserver(volumeObserver);
            volumeObserver = null;
        }
    }

    /* ── Méthodes exposées au JS ────────────────────────────────────── */

    @PluginMethod
    public void getMediaVolume(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("volume", readVolume());
        call.resolve(ret);
    }

    @PluginMethod
    public void setMediaVolume(PluginCall call) {
        Double volume = call.getDouble("volume");
        if (volume == null) { call.reject("volume required"); return; }
        AudioManager am = (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
        if (am == null) { call.reject("AudioManager unavailable"); return; }
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int target = (int) Math.round(Math.max(0.0, Math.min(1.0, volume)) * max);
        am.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0);
        lastVolume = (double) target / max;
        call.resolve();
    }

    /* ── Interne ────────────────────────────────────────────────────── */

    private double readVolume() {
        AudioManager am = (AudioManager) getContext().getSystemService(android.content.Context.AUDIO_SERVICE);
        if (am == null) return 1.0;
        int current = am.getStreamVolume(AudioManager.STREAM_MUSIC);
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        return max > 0 ? (double) current / max : 1.0;
    }

    private void checkAndNotify() {
        double current = readVolume();
        if (Math.abs(current - lastVolume) < 0.005) return;
        lastVolume = current;
        JSObject data = new JSObject();
        data.put("volume", current);
        notifyListeners("volumeChange", data);
    }
}
