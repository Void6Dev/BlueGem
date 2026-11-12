package com.bluegem.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Свой плагин регистрируется до создания моста: ядро на Rust должно
        // быть готово к первому запросу интерфейса.
        registerPlugin(BlueGemCorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
