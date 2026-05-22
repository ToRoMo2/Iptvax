package com.iptvax.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin du lecteur natif libVLC (Phase 2c — voir docs/native-port.md).
        registerPlugin(VlcPlayerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
