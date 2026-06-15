package com.iptvax.app;

import android.content.Context;
import android.net.Uri;
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
import java.io.InputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Téléchargement hors-ligne Android — voir CLAUDE.md §XI (téléchargements) +
 * src/services/downloads/engine.ts + src/native/capacitorDownloads.ts.
 *
 * On télécharge le fichier direct Xtream COMPLET (MKV/MP4, toutes pistes
 * embarquées) dans le dossier app-specific ({@code getExternalFilesDir}, aucune
 * permission runtime) ; ExoPlayer (Media3) lit ensuite le fichier local
 * hors-ligne, avec toutes ses pistes audio/sous-titres.
 *
 * <p><b>Pourquoi pas {@code DownloadManager}</b> (ancienne implémentation) : sur
 * les sources IPTV, {@code DownloadManager} restait fréquemment bloqué en
 * {@code PENDING} indéfiniment (redirections inter-protocole http↔https,
 * heuristiques opaques) → le téléchargement « ne démarrait jamais », et il ne
 * sait pas faire de pause/reprise PARTIELLE (Range). On le remplace par un
 * téléchargeur en-process déterministe (un fil par transfert), aligné sur la
 * version Electron : téléchargement SEGMENTÉ par tranches {@code Range}.
 *
 * <p><b>Anti-étranglement</b> : les serveurs Xtream throttlent une connexion
 * unique de longue durée (burst rapide puis effondrement du débit). On récupère
 * donc le fichier par tranches : chaque tranche est une connexion COURTE qui
 * reste dans la fenêtre de burst → débit constant, plus de gel.
 *
 * <p>Le registre de métadonnées est persisté en SharedPreferences (device-local,
 * jamais synchronisé). La liste complète est ré-émise au JS
 * ({@code downloadsChanged}) à chaque changement + relue par polling.
 */
@CapacitorPlugin(name = "Downloader")
public class DownloaderPlugin extends Plugin {

    private static final String PREFS = "iptvax_downloads";
    private static final String KEY = "items";
    private static final String UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
            + "Chrome/124.0.0.0 Safari/537.36";

    private static final long CHUNK_BYTES = 8L * 1024 * 1024; // taille d'une tranche Range
    private static final int CONNECT_TIMEOUT = 20000;
    private static final int READ_TIMEOUT = 20000; // sans octet → SocketTimeout → on rouvre
    private static final int MAX_NOPROGRESS = 20; // tranches consécutives sans progrès → échec
    private static final int BUFFER = 64 * 1024;

    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, Task> active = new ConcurrentHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object lock = new Object(); // sérialise les lectures/écritures du registre
    private volatile long lastEmitAt = 0;

    /** État d'un transfert en cours (un fil de pool). */
    private static class Task {
        final String id;
        volatile boolean paused = false;
        volatile boolean cancelled = false;
        volatile HttpURLConnection conn;
        volatile InputStream in;
        Task(String id) { this.id = id; }
    }

    @Override
    public void load() {
        // Un transfert « downloading »/« queued » au dernier arrêt n'a pas de fil
        // actif → on le repasse en « paused » (l'utilisateur le relance).
        reconcile();
    }

    // ── API plugin ─────────────────────────────────────────────────────────────

    @PluginMethod
    public void start(PluginCall call) {
        JSObject data = call.getData();
        String id = data.getString("id");
        if (id == null) { call.reject("missing id"); return; }
        try {
            JSONObject item = findItem(id);
            if (item == null) item = new JSONObject();
            // Copie les champs du descripteur (titre, poster, ext, sourceUrl…).
            Iterator<String> keys = data.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                item.put(k, data.get(k));
            }
            if (!item.has("bytesDownloaded")) item.put("bytesDownloaded", 0);
            if (!item.has("bytesTotal")) item.put("bytesTotal", 0);
            if (!item.has("addedAt")) item.put("addedAt", System.currentTimeMillis());
            item.put("status", "queued");
            item.remove("error");
            upsert(item);
            emit(true);
            startTask(id);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void pause(PluginCall call) {
        String id = call.getString("id");
        Task t = id == null ? null : active.get(id);
        if (t != null) {
            t.paused = true;
            interrupt(t); // débloque le read() en cours → le fil constate la pause
        } else {
            JSONObject item = id == null ? null : findItem(id);
            if (item != null && !"done".equals(item.optString("status"))) {
                try { item.put("status", "paused"); } catch (Exception ignored) {}
                upsert(item);
                emit(true);
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        String id = call.getString("id");
        JSONObject item = id == null ? null : findItem(id);
        if (item != null && !"done".equals(item.optString("status"))) {
            startTask(id);
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
        reconcile();
        JSObject ret = new JSObject();
        ret.put("items", itemsArray());
        call.resolve(ret);
    }

    // ── Moteur de téléchargement (un fil par transfert) ─────────────────────────

    private void startTask(String id) {
        if (active.containsKey(id)) return; // déjà en cours
        Task t = new Task(id);
        active.put(id, t);
        pool.execute(() -> runTask(t));
    }

    private void runTask(Task t) {
        RandomAccessFile raf = null;
        try {
            JSONObject item = findItem(t.id);
            if (item == null) return;
            String src = item.optString("sourceUrl", null);
            if (src == null || src.isEmpty()) throw new IOException("URL source manquante");
            String ext = item.optString("ext", "mkv");
            String origin = originOf(src);

            File dest = destFile(t.id, ext);
            File part = new File(dest.getPath() + ".part");
            File parent = dest.getParentFile();
            if (parent != null) parent.mkdirs();

            long received = part.exists() ? part.length() : 0;
            long total = item.optLong("bytesTotal", 0);

            item.put("status", "downloading");
            item.put("fileUri", Uri.fromFile(dest).toString());
            item.put("bytesDownloaded", received);
            item.remove("error");
            upsert(item);
            emit(true);

            raf = new RandomAccessFile(part, "rw");
            raf.seek(received);

            boolean rangeOk = true; // le serveur honore-t-il Range (206) ?
            int noProgress = 0;
            byte[] buf = new byte[BUFFER];

            while (true) {
                if (t.cancelled || t.paused) break;
                if (total > 0 && received >= total) break;

                long startAt = received;
                long endAt = total > 0
                    ? Math.min(startAt + CHUNK_BYTES, total) - 1
                    : startAt + CHUNK_BYTES - 1;
                String range = rangeOk ? ("bytes=" + startAt + "-" + endAt) : null;

                HttpURLConnection conn;
                try {
                    conn = openConnection(src, origin, range);
                } catch (IOException e) {
                    if (t.cancelled || t.paused) break;
                    if (++noProgress > MAX_NOPROGRESS) throw e;
                    sleep(backoff(noProgress));
                    continue;
                }
                t.conn = conn;
                int code = conn.getResponseCode();

                boolean fromZero = false;
                if (code == 200) {
                    // Range ignoré : le serveur renvoie tout depuis 0.
                    rangeOk = false;
                    if (startAt > 0) { received = 0; raf.setLength(0); raf.seek(0); fromZero = true; }
                    long cl = parseLong(conn.getHeaderField("Content-Length")); // API 23-safe (>2 Go)
                    if (cl > 0) total = cl;
                } else if (code == 206) {
                    rangeOk = true;
                    String cr = conn.getHeaderField("Content-Range"); // bytes a-b/total
                    if (cr != null) {
                        int slash = cr.lastIndexOf('/');
                        if (slash >= 0) {
                            try { total = Long.parseLong(cr.substring(slash + 1).trim()); }
                            catch (NumberFormatException ignored) {}
                        }
                    }
                } else {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                    t.conn = null;
                    if (t.cancelled || t.paused) break;
                    if (++noProgress > MAX_NOPROGRESS) throw new IOException("HTTP " + code);
                    sleep(backoff(noProgress));
                    continue;
                }
                if (total > 0) item.put("bytesTotal", total);
                if (fromZero) { item.put("bytesDownloaded", 0); upsert(item); emit(true); }

                long segStart = received;
                boolean naturalEnd = false;
                long lastEmit = 0;
                InputStream in = null;
                try {
                    in = conn.getInputStream();
                    t.in = in;
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        if (t.cancelled || t.paused) break;
                        raf.write(buf, 0, n);
                        received += n;
                        item.put("bytesDownloaded", received);
                        long now = System.currentTimeMillis();
                        if (now - lastEmit > 600) {
                            lastEmit = now;
                            upsert(item);
                            emit(false);
                        }
                    }
                    if (n == -1) naturalEnd = true;
                } catch (IOException io) {
                    // Stall (READ_TIMEOUT) / coupure réseau / pause (interrupt) →
                    // on rouvrira une tranche fraîche depuis `received` (Range).
                } finally {
                    try { if (in != null) in.close(); } catch (Exception ignored) {}
                    try { conn.disconnect(); } catch (Exception ignored) {}
                    t.in = null;
                    t.conn = null;
                }

                if (t.cancelled || t.paused) break;

                if (received > segStart) {
                    noProgress = 0;
                } else if (++noProgress > MAX_NOPROGRESS) {
                    throw new IOException("Téléchargement bloqué (aucune donnée reçue)");
                } else {
                    sleep(backoff(noProgress));
                }

                if (!rangeOk) {
                    if (naturalEnd) { if (total <= 0) total = received; break; } // 200 complet
                    // Serveur sans Range coupé en cours → impossible de reprendre.
                    received = 0; raf.setLength(0); raf.seek(0); item.put("bytesDownloaded", 0);
                }
            }

            raf.close();
            raf = null;

            if (t.cancelled) {
                try { if (part.exists()) part.delete(); } catch (Exception ignored) {}
            } else if (t.paused) {
                item.put("status", "paused");
                item.put("bytesDownloaded", received);
                upsert(item);
                emit(true);
            } else {
                if (total <= 0) total = received;
                try { if (dest.exists()) dest.delete(); } catch (Exception ignored) {}
                if (!part.renameTo(dest)) throw new IOException("Renommage du fichier échoué");
                item.put("status", "done");
                item.put("bytesTotal", total);
                item.put("bytesDownloaded", received);
                item.put("fileUri", Uri.fromFile(dest).toString());
                upsert(item);
                emit(true);
            }
        } catch (Exception e) {
            JSONObject item = findItem(t.id);
            if (item != null && !t.cancelled) {
                try {
                    item.put("status", "error");
                    item.put("error", e.getMessage() != null ? e.getMessage() : "Échec du téléchargement");
                } catch (Exception ignored) {}
                upsert(item);
                emit(true);
            }
        } finally {
            try { if (raf != null) raf.close(); } catch (Exception ignored) {}
            active.remove(t.id);
        }
    }

    /** Ouvre une connexion GET en suivant les redirections (y compris http↔https). */
    private HttpURLConnection openConnection(String url, String origin, String range) throws IOException {
        String current = url;
        for (int redirects = 0; redirects <= 6; redirects++) {
            URL u = new URL(current);
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setInstanceFollowRedirects(false); // on suit à la main (cross-protocole)
            c.setConnectTimeout(CONNECT_TIMEOUT);
            c.setReadTimeout(READ_TIMEOUT);
            c.setRequestProperty("User-Agent", UA);
            if (origin != null) {
                c.setRequestProperty("Referer", origin + "/");
                c.setRequestProperty("Origin", origin);
            }
            if (range != null) c.setRequestProperty("Range", range);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                try { c.disconnect(); } catch (Exception ignored) {}
                if (loc == null) throw new IOException("Redirection sans Location");
                current = new URL(u, loc).toString();
                continue;
            }
            return c; // getResponseCode() est mis en cache pour l'appelant
        }
        throw new IOException("Trop de redirections");
    }

    /** Débloque un read() bloquant (pause / annulation) en fermant le flux. */
    private void interrupt(Task t) {
        pool.execute(() -> {
            try { if (t.in != null) t.in.close(); } catch (Exception ignored) {}
            try { if (t.conn != null) t.conn.disconnect(); } catch (Exception ignored) {}
        });
    }

    private File destFile(String id, String ext) {
        File base = getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        if (base == null) base = new File(getContext().getFilesDir(), "downloads");
        return new File(base, id + "." + ext);
    }

    private static long backoff(int tries) {
        return Math.min(750L * tries, 5000L);
    }

    private static long parseLong(String s) {
        if (s == null) return 0;
        try { return Long.parseLong(s.trim()); } catch (NumberFormatException e) { return 0; }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }

    // ── Registre (SharedPreferences) ───────────────────────────────────────────

    /** Repasse en « paused » les transferts sans fil actif (reliquat d'un arrêt). */
    private void reconcile() {
        synchronized (lock) {
            JSONArray items = readItems();
            boolean changed = false;
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null) continue;
                String s = it.optString("status");
                if (("downloading".equals(s) || "queued".equals(s)) && !active.containsKey(it.optString("id"))) {
                    try { it.put("status", "paused"); changed = true; } catch (Exception ignored) {}
                }
            }
            if (changed) writeItems(items);
        }
    }

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
        synchronized (lock) {
            JSONArray items = readItems();
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it != null && id.equals(it.optString("id"))) return it;
            }
        }
        return null;
    }

    /** Lecture-modification-écriture atomique : remplace l'entrée du même id. */
    private void upsert(JSONObject item) {
        String id = item.optString("id");
        synchronized (lock) {
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
    }

    private void removeItem(String id) {
        if (id == null) return;
        Task t = active.get(id);
        if (t != null) { t.cancelled = true; interrupt(t); }
        JSONObject item = findItem(id);
        if (item != null) {
            String ext = item.optString("ext", "mkv");
            File dest = destFile(id, ext);
            File part = new File(dest.getPath() + ".part");
            try { if (dest.exists()) dest.delete(); } catch (Exception ignored) {}
            try { if (part.exists()) part.delete(); } catch (Exception ignored) {}
        }
        synchronized (lock) {
            JSONArray items = readItems();
            JSONArray out = new JSONArray();
            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it != null && !id.equals(it.optString("id"))) out.put(it);
            }
            writeItems(out);
        }
        emit(true);
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

    /** Ré-émet la liste au JS (sur le thread principal). {@code force=false} = throttle. */
    private void emit(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastEmitAt < 600) return;
        lastEmitAt = now;
        main.post(() -> {
            JSObject data = new JSObject();
            data.put("items", itemsArray());
            notifyListeners("downloadsChanged", data);
        });
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
