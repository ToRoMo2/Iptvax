package com.iptvax.app;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.net.URI;
import java.util.Iterator;

/**
 * Téléchargement hors-ligne Android via le système {@link DownloadManager}.
 *
 * Voir CLAUDE.md §XI (téléchargements) et src/services/downloads/engine.ts +
 * src/native/capacitorDownloads.ts. On télécharge le fichier direct Xtream
 * COMPLET (MKV/MP4, toutes pistes embarquées) dans le dossier app-specific
 * (`getExternalFilesDir`, aucune permission runtime) ; ExoPlayer (Media3) lit
 * ensuite le fichier local hors-ligne, avec toutes ses pistes audio/sous-titres.
 *
 * DownloadManager gère le transfert en arrière-plan + la notification système +
 * la reprise réseau. Le registre de métadonnées est persisté en
 * SharedPreferences (device-local, jamais synchronisé). La liste complète est
 * ré-émise au JS (`downloadsChanged`) à chaque changement + par polling.
 *
 * ⚠ Limitation v1 : DownloadManager n'expose pas d'API pause/reprise partielle
 * → « Pause » annule le transfert (le fichier partiel est perdu) et « Reprendre »
 * relance depuis le début. À affiner si besoin (validation device requise).
 */
@CapacitorPlugin(name = "Downloader")
public class DownloaderPlugin extends Plugin {

    private static final String PREFS = "iptvax_downloads";
    private static final String KEY = "items";
    private static final String UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
            + "Chrome/124.0.0.0 Safari/537.36";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean polling = false;
    private BroadcastReceiver completeReceiver;

    @Override
    public void load() {
        completeReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                refreshAll();
                emit();
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(completeReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(completeReceiver, filter);
        }
    }

    @Override
    protected void handleOnDestroy() {
        try { getContext().unregisterReceiver(completeReceiver); } catch (Exception ignored) {}
    }

    // ── API plugin ─────────────────────────────────────────────────────────────

    @PluginMethod
    public void start(PluginCall call) {
        JSObject data = call.getData();
        String id = data.getString("id");
        if (id == null) { call.reject("missing id"); return; }
        JSONObject item = findItem(id);
        if (item == null) item = new JSONObject();
        try {
            // Copie les champs du descripteur (titre, poster, ext, sourceUrl…).
            Iterator<String> keys = data.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                item.put(k, data.get(k));
            }
            enqueue(item);
            upsert(item);
            emit();
            startPolling();
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void pause(PluginCall call) {
        String id = call.getString("id");
        JSONObject item = id == null ? null : findItem(id);
        if (item != null) {
            removeFromManager(item);
            try { item.put("status", "paused"); } catch (Exception ignored) {}
            upsert(item);
            emit();
        }
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        String id = call.getString("id");
        JSONObject item = id == null ? null : findItem(id);
        if (item != null) {
            try { enqueue(item); upsert(item); } catch (Exception ignored) {}
            emit();
            startPolling();
        }
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        removeItem(call.getString("id"));
        call.resolve();
    }

    @PluginMethod
    public void remove(PluginCall call) {
        removeItem(call.getString("id"));
        call.resolve();
    }

    @PluginMethod
    public void list(PluginCall call) {
        refreshAll();
        JSObject ret = new JSObject();
        ret.put("items", itemsArray());
        call.resolve(ret);
    }

    // ── DownloadManager ──────────────────────────────────────────────────────

    private DownloadManager dm() {
        return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
    }

    private void enqueue(JSONObject item) throws Exception {
        String id = item.getString("id");
        String src = item.getString("sourceUrl");
        String ext = item.optString("ext", "mkv");
        File dest = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES), id + "." + ext);

        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(src));
        req.addRequestHeader("User-Agent", UA);
        String origin = originOf(src);
        if (origin != null) {
            req.addRequestHeader("Referer", origin + "/");
            req.addRequestHeader("Origin", origin);
        }
        req.setDestinationUri(Uri.fromFile(dest));
        req.setAllowedOverMetered(true);
        req.setAllowedOverRoaming(true);
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
        req.setTitle(item.optString("title", id));

        long dmId = dm().enqueue(req);
        item.put("dmId", dmId);
        item.put("status", "downloading");
        item.put("fileUri", Uri.fromFile(dest).toString());
        if (!item.has("bytesDownloaded")) item.put("bytesDownloaded", 0);
        if (!item.has("bytesTotal")) item.put("bytesTotal", 0);
        if (!item.has("addedAt")) item.put("addedAt", System.currentTimeMillis());
    }

    private void removeFromManager(JSONObject item) {
        long dmId = item.optLong("dmId", -1);
        if (dmId >= 0) {
            try { dm().remove(dmId); } catch (Exception ignored) {}
        }
    }

    // Met à jour la progression / statut de tous les téléchargements actifs.
    private void refreshAll() {
        JSONArray items = readItems();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            long dmId = item.optLong("dmId", -1);
            if (dmId < 0 || "done".equals(item.optString("status"))) continue;
            Cursor c = null;
            try {
                c = dm().query(new DownloadManager.Query().setFilterById(dmId));
                if (c != null && c.moveToFirst()) {
                    int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    long sofar = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                    long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                    item.put("bytesDownloaded", Math.max(0, sofar));
                    if (total > 0) item.put("bytesTotal", total);
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        item.put("status", "done");
                    } else if (status == DownloadManager.STATUS_FAILED) {
                        item.put("status", "error");
                        item.put("error", "DownloadManager error");
                    } else if (status == DownloadManager.STATUS_PAUSED) {
                        item.put("status", "downloading");
                    } else {
                        item.put("status", "downloading");
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.close();
            }
        }
        writeItems(items);
    }

    private void startPolling() {
        if (polling) return;
        polling = true;
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                refreshAll();
                emit();
                if (hasActive()) {
                    handler.postDelayed(this, 1000);
                } else {
                    polling = false;
                }
            }
        }, 1000);
    }

    private boolean hasActive() {
        JSONArray items = readItems();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it != null) {
                String s = it.optString("status");
                if ("downloading".equals(s) || "queued".equals(s)) return true;
            }
        }
        return false;
    }

    // ── Registre (SharedPreferences) ───────────────────────────────────────────

    private JSONArray readItems() {
        String raw = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]");
        try { return new JSONArray(raw); } catch (Exception e) { return new JSONArray(); }
    }

    private void writeItems(JSONArray arr) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY, arr.toString()).apply();
    }

    private JSONObject findItem(String id) {
        if (id == null) return null;
        JSONArray items = readItems();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it != null && id.equals(it.optString("id"))) return it;
        }
        return null;
    }

    private void upsert(JSONObject item) {
        String id = item.optString("id");
        JSONArray items = readItems();
        JSONArray out = new JSONArray();
        boolean replaced = false;
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it != null && id.equals(it.optString("id"))) {
                out.put(item);
                replaced = true;
            } else {
                out.put(it);
            }
        }
        if (!replaced) out.put(item);
        writeItems(out);
    }

    private void removeItem(String id) {
        JSONObject item = findItem(id);
        if (item != null) {
            removeFromManager(item);
            // Supprime le fichier local (terminé ou partiel).
            try {
                String uri = item.optString("fileUri", null);
                if (uri != null) {
                    File f = new File(URI.create(uri));
                    if (f.exists()) f.delete();
                }
            } catch (Exception ignored) {}
        }
        JSONArray items = readItems();
        JSONArray out = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it != null && !id.equals(it.optString("id"))) out.put(it);
        }
        writeItems(out);
        emit();
    }

    private JSArray itemsArray() {
        JSArray arr = new JSArray();
        JSONArray items = readItems();
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it != null) arr.put(it);
        }
        return arr;
    }

    private void emit() {
        JSObject data = new JSObject();
        data.put("items", itemsArray());
        notifyListeners("downloadsChanged", data);
    }

    private static String originOf(String url) {
        try {
            URI u = new URI(url);
            if (u.getScheme() == null || u.getHost() == null) return null;
            String origin = u.getScheme() + "://" + u.getHost();
            if (u.getPort() != -1) origin += ":" + u.getPort();
            return origin;
        } catch (Exception e) {
            return null;
        }
    }
}
