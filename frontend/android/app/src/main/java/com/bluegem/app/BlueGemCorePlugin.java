package com.bluegem.app;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Ядро BlueGem на Rust (server/src/android.rs) внутри приложения.
 *
 * Интерфейс отправляет сюда те же запросы к API, что на компьютере уходят
 * встроенному серверу по HTTP: метод, путь и тело. Здесь они передаются ядру
 * напрямую, без сети и без портов, а ответ возвращается как есть. Данные —
 * SQLite в личной папке приложения (files/bluegem.db).
 */
@CapacitorPlugin(name = "BlueGemCore")
public class BlueGemCorePlugin extends Plugin {
    private static final String TAG = "BlueGemCore";

    static {
        System.loadLibrary("bluegem_core");
    }

    private static native String nativeInit(String dbPath, String version);

    private static native String nativeRequest(String method, String path, String body);

    // Запросы — не в потоке интерфейса: работа с базой не должна задерживать кадры.
    private final ExecutorService pool = Executors.newFixedThreadPool(2);
    private String initError = "";

    @Override
    public void load() {
        String db = new File(getContext().getFilesDir(), "bluegem.db").getAbsolutePath();
        String version = "";
        try {
            version = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0).versionName;
        } catch (Exception ignored) {
            // версия нужна только для GET /api/
        }
        initError = nativeInit(db, version == null ? "" : version);
        if (!initError.isEmpty()) Log.e(TAG, "init failed: " + initError);
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject res = new JSObject();
        res.put("ready", initError.isEmpty());
        res.put("error", initError);
        call.resolve(res);
    }

    @PluginMethod
    public void request(PluginCall call) {
        final String method = call.getString("method", "GET");
        final String path = call.getString("path", "/api/");
        final String body = call.getString("body", "");
        pool.execute(() -> {
            try {
                call.resolve(new JSObject(nativeRequest(method, path, body)));
            } catch (Exception e) {
                call.reject("core request failed: " + e.getMessage());
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        pool.shutdown();
    }
}
