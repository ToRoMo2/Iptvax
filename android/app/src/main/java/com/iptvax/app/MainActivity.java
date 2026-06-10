package com.iptvax.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin du lecteur natif libVLC (Phase 2c — voir docs/native-port.md).
        registerPlugin(VlcPlayerPlugin.class);
        // Plugin de détection TV vs téléphone (Phase 2f — onboarding QR code).
        registerPlugin(TvDetectPlugin.class);
        // Plugin de contrôle du volume média système (Chantier 4 — slider volume lecteur).
        registerPlugin(VolumeControlPlugin.class);
        // Extraction on-device des sous-titres texte (rendu React, restyle instantané).
        registerPlugin(SubtitleExtractorPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
