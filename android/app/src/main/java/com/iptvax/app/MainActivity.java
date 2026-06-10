package com.iptvax.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Lecteur natif AndroidX Media3 / ExoPlayer (voir docs/native-port.md).
        // Remplace libVLC : émet les cues sous-titres en direct → rendu React.
        registerPlugin(MediaPlayerPlugin.class);
        // Plugin de détection TV vs téléphone (Phase 2f — onboarding QR code).
        registerPlugin(TvDetectPlugin.class);
        // Plugin de contrôle du volume média système (Chantier 4 — slider volume lecteur).
        registerPlugin(VolumeControlPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
