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

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Téléchargement hors-ligne Android — voir CLAUDE.md §XI (téléchargements) +
 * src/services/downloads/engine.ts + src/native/capacitorDownloads.ts.
 *
 * On télécharge le fichier direct Xtream COMPLET (MKV/MP4, toutes pistes
 * embarquées) dans le dossier app-specific ({@code getExternalFilesDir}, aucune
 * permission runtime) ; ExoPlayer (Media3) lit ensuite le fichier local
 * hors-ligne, avec toutes ses pistes audio/sous-titres.
 *
 * <p><b>Téléchargement SEGMENTÉ + PARALLÈLE</b> (aligné sur Electron,
 * {@code electron/downloads.cjs}) : les serveurs Xtream throttlent CHAQUE
 * connexion indépendamment (token-bucket par connexion : burst rapide puis
 * effondrement du débit). On récupère donc le fichier par tranches via en-tête
 * {@code Range}, et SURTOUT plusieurs tranches EN PARALLÈLE : chaque connexion a
 * son propre bucket → le débit total est multiplié par le nombre de connexions
 * (= ce que font les accélérateurs IDM/aria2 {@code -x}, et les apps IPTV
 * « rapides »). Chaque tranche reste courte donc dans la fenêtre de burst.
 *
 * <p>Écritures POSITIONNELLES : chaque worker ouvre son propre
 * {@code RandomAccessFile} et écrit sa tranche à son offset (régions disjointes
 * → sûr). La progression de reprise est tenue dans un manifeste annexe
 * ({@code .prog.json}) listant les tranches finies (la taille du {@code .part}
 * ne reflète plus la progression avec des écritures parallèles).
 *
 * <p><b>Pourquoi pas {@code DownloadManager}</b> (ancienne implémentation) :
 * restait fréquemment bloqué en {@code PENDING} sur les sources IPTV
 * (redirections inter-protocole), et pas de pause/reprise PARTIELLE (Range).
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
    // Connexions parallèles. Multiplie le débit sur les serveurs à throttle par
    // connexion. Surchargé par la variable d'env IPTVAX_DL_CONNECTIONS (au cas où
    // un fournisseur limite le nombre de connexions simultanées par compte).
    private static final int MAX_CONNECTIONS = resolveMaxConnections();
    private static final int CONNECT_TIMEOUT = 20000;
    private static final int READ_TIMEOUT = 20000; // sans octet → SocketTimeout → on rouvre la tranche
    private static final int MAX_RANGE_RETRIES = 5; // connexions consécutives SANS octet sur une tranche → on la remet en file
    private static final int MAX_NOPROGRESS = 20; // (repli sans Range) flux consécutifs sans progrès avant échec
    private static final long GLOBAL_STALL_MS = 60000; // AUCUN octet (toutes connexions) pendant ce délai → échec
    private static final int BUFFER = 64 * 1024;

    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, Task> active = new ConcurrentHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object lock = new Object(); // sérialise les lectures/écritures du registre
    private volatile long lastEmitAt = 0;

    /** Callback de progression (octets reçus, toutes connexions confondues). */
    private interface ProgressSink {
        void onBytes(long n);
    }

    /** État d'un transfert en cours (un jeu de fils de pool). */
    private static class Task {
        final String id;
        volatile boolean paused = false;
        volatile boolean cancelled = false;
        volatile boolean stalled = false; // watchdog global → échec
        volatile long lastProgress = 0;
        // Toutes les connexions/flux ouverts par les workers → fermables d'un coup
        // (pause / annulation / stall) pour débloquer les read() bloquants.
        final Set<HttpURLConnection> conns = Collections.synchronizedSet(new HashSet<HttpURLConnection>());
        final Set<InputStream> ins = Collections.synchronizedSet(new HashSet<InputStream>());
        Task(String id) { this.id = id; }
        boolean stopped() { return paused || cancelled; }
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
            interrupt(t); // débloque les read() en cours → les fils constatent la pause
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

    // ── Moteur de téléchargement ────────────────────────────────────────────────

    private void startTask(String id) {
        if (active.containsKey(id)) return; // déjà en cours
        Task t = new Task(id);
        active.put(id, t);
        pool.execute(() -> runTask(t));
    }

    private void runTask(Task t) {
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

            item.put("status", "downloading");
            item.put("fileUri", Uri.fromFile(dest).toString());
            item.remove("error");
            upsert(item);
            emit(true);

            // Sonde la source : taille totale + support des requêtes Range (206).
            long[] probe = probeSource(t, src, origin); // { rangeOk(0/1), total }
            if (t.stopped()) { finishStopped(t, item, part); return; }
            boolean rangeOk = probe[0] == 1;
            long total = probe[1];

            if (rangeOk && total > 0) {
                downloadParallel(t, item, src, origin, part, total);
            } else {
                downloadSingle(t, item, src, origin, part, total);
            }

            if (t.cancelled) {
                deletePartFiles(part);
            } else if (t.paused) {
                item.put("status", "paused");
                upsert(item);
                emit(true);
            } else {
                long finalTotal = item.optLong("bytesTotal", 0);
                if (finalTotal <= 0) {
                    finalTotal = item.optLong("bytesDownloaded", 0);
                    item.put("bytesTotal", finalTotal);
                }
                try { if (dest.exists()) dest.delete(); } catch (Exception ignored) {}
                if (!part.renameTo(dest)) throw new IOException("Renommage du fichier échoué");
                new File(part.getPath() + ".prog.json").delete();
                item.put("status", "done");
                item.put("bytesDownloaded", finalTotal);
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
            active.remove(t.id);
        }
    }

    /** Met à jour le statut/octets quand un transfert est interrompu (pause/annulation). */
    private void finishStopped(Task t, JSONObject item, File part) {
        try {
            if (t.cancelled) {
                deletePartFiles(part);
            } else {
                item.put("status", "paused");
                upsert(item);
                emit(true);
            }
        } catch (Exception ignored) {}
    }

    // ── Téléchargement PARALLÈLE par tranches Range (chemin nominal) ──────────────

    private void downloadParallel(Task t, JSONObject item, String src, String origin, File part, long total)
        throws Exception {
        item.put("bytesTotal", total);
        final int nChunks = (int) Math.max(1, (total + CHUNK_BYTES - 1) / CHUNK_BYTES);

        // Reprise seulement si le `.part` existe ENCORE (manifeste sans fichier =
        // incohérent → on repart de zéro pour ne pas « sauter » des tranches vides).
        boolean partExists = part.exists();
        final Set<Integer> done = Collections.synchronizedSet(
            partExists ? loadProg(part, total) : new HashSet<Integer>());

        // Le `.part` doit exister pour les écritures positionnelles.
        try { new RandomAccessFile(part, "rw").close(); } catch (Exception ignored) {}

        long resumed = 0;
        for (Integer i : done) resumed += chunkSize(i, total);
        final AtomicLong downloaded = new AtomicLong(resumed);
        item.put("bytesDownloaded", resumed);
        upsert(item);
        emit(true);

        // File de tâches : [index de tranche, prochain octet à récupérer]. `pos`
        // est conservé en cas de remise en file → aucune plage re-téléchargée 2×.
        final Deque<long[]> queue = new ConcurrentLinkedDeque<>();
        for (int i = 0; i < nChunks; i++) {
            if (!done.contains(i)) queue.add(new long[]{i, (long) i * CHUNK_BYTES});
        }

        t.lastProgress = System.currentTimeMillis();
        final long[] lastEmit = {0};
        final long[] lastSave = {0};
        final Object emitLock = new Object();

        // MONOTONE : ne décompte jamais (les octets écrits restent valides sur disque).
        final ProgressSink sink = (n) -> {
            long d = Math.min(downloaded.addAndGet(n), total);
            t.lastProgress = System.currentTimeMillis();
            long now = System.currentTimeMillis();
            synchronized (emitLock) {
                if (now - lastEmit[0] > 600) {
                    lastEmit[0] = now;
                    try { item.put("bytesDownloaded", d); } catch (Exception ignored) {}
                    upsert(item);
                    emit(false);
                }
            }
        };

        // Watchdog GLOBAL : si plus AUCUNE connexion ne progresse, on abandonne.
        final boolean[] running = {true};
        Thread watchdog = new Thread(() -> {
            while (running[0] && !t.stopped() && !t.stalled) {
                sleep(5000);
                if (running[0] && !t.stopped()
                        && System.currentTimeMillis() - t.lastProgress > GLOBAL_STALL_MS) {
                    t.stalled = true;
                    interrupt(t);
                    break;
                }
            }
        });
        watchdog.setDaemon(true);
        watchdog.start();

        Runnable worker = () -> {
            while (!t.stopped() && !t.stalled) {
                long[] job = queue.poll();
                if (job == null) break;
                int i = (int) job[0];
                long pos = job[1];
                long end = Math.min((long) i * CHUNK_BYTES + CHUNK_BYTES, total) - 1; // inclusif
                int fails = 0;
                // Remplit la tranche depuis `pos` via autant de connexions que
                // nécessaire (chacune peut être coupée tôt par le serveur).
                while (pos <= end && !t.stopped() && !t.stalled) {
                    long wrote = fetchRange(t, src, origin, part, pos, end, sink);
                    if (wrote > 0) {
                        pos += wrote;
                        fails = 0;
                    } else {
                        if (t.stopped() || t.stalled) break;
                        if (++fails > MAX_RANGE_RETRIES) break; // on remet la tranche en file
                        sleep(backoff(fails));
                    }
                }
                if (pos > end) {
                    done.add(i);
                    long now = System.currentTimeMillis();
                    synchronized (lastSave) {
                        if (now - lastSave[0] > 1000) {
                            lastSave[0] = now;
                            saveProg(part, total, done);
                        }
                    }
                } else if (t.stopped() || t.stalled) {
                    queue.offerFirst(new long[]{i, pos});
                    return;
                } else {
                    queue.offer(new long[]{i, pos}); // reprise plus tard, depuis la position atteinte
                    sleep(400);
                }
            }
        };

        int n = Math.min(MAX_CONNECTIONS, Math.max(1, queue.size()));
        List<Thread> workers = new ArrayList<>();
        for (int k = 0; k < n; k++) {
            Thread w = new Thread(worker);
            workers.add(w);
            w.start();
        }
        for (Thread w : workers) {
            try { w.join(); } catch (InterruptedException ignored) {}
        }
        running[0] = false;
        watchdog.interrupt();
        saveProg(part, total, done);

        item.put("bytesDownloaded", Math.min(downloaded.get(), total));

        if (t.stalled) throw new IOException("Connexion trop instable (téléchargement interrompu)");
        if (t.stopped()) return; // pause / annulation → géré par l'appelant
        if (done.size() < nChunks) throw new IOException("Téléchargement incomplet");
        item.put("bytesDownloaded", total);
    }

    /**
     * Télécharge UNE connexion pour la plage [start, end] et l'écrit à sa POSITION
     * dans {@code part}. Rend le NOMBRE d'octets effectivement écrits (peut être
     * &lt; plage demandée si le serveur ferme la connexion tôt — fréquent quand
     * plusieurs connexions se partagent la bande passante). Les octets écrits sont
     * VALIDES (positionnels) → l'appelant continue depuis {@code start + got},
     * sans jamais jeter ce qui a été reçu (progression monotone).
     */
    private long fetchRange(Task t, String src, String origin, File part, long start, long end, ProgressSink sink) {
        HttpURLConnection conn = null;
        InputStream in = null;
        RandomAccessFile raf = null;
        long got = 0;
        try {
            conn = openConnection(src, origin, "bytes=" + start + "-" + end);
            t.conns.add(conn);
            int code = conn.getResponseCode();
            // Mode parallèle = Range confirmé au probe → on EXIGE 206. Un 200
            // renverrait tout le fichier depuis 0 ; l'écrire à l'offset corromprait
            // le fichier → on abandonne cette connexion (la tranche sera rejouée).
            if (code != 206) return 0;
            in = conn.getInputStream();
            t.ins.add(in);
            raf = new RandomAccessFile(part, "rw");
            raf.seek(start);
            byte[] buf = new byte[BUFFER];
            int n;
            while ((n = in.read(buf)) != -1) {
                if (t.stopped() || t.stalled) break;
                raf.write(buf, 0, n);
                got += n;
                sink.onBytes(n);
            }
        } catch (IOException e) {
            // Stall (READ_TIMEOUT) / coupure / pause (interrupt) → progrès partiel
            // accepté ; l'appelant reprendra la tranche depuis la position atteinte.
        } finally {
            if (conn != null) t.conns.remove(conn);
            if (in != null) t.ins.remove(in);
            try { if (in != null) in.close(); } catch (Exception ignored) {}
            try { if (conn != null) conn.disconnect(); } catch (Exception ignored) {}
            try { if (raf != null) raf.close(); } catch (Exception ignored) {}
        }
        return got;
    }

    // ── Repli : serveur sans support Range → un seul flux depuis 0 ───────────────

    private void downloadSingle(Task t, JSONObject item, String src, String origin, File part, long total)
        throws Exception {
        int noProgress = 0;
        while (!t.stopped()) {
            HttpURLConnection conn = null;
            InputStream in = null;
            RandomAccessFile raf = null;
            try {
                conn = openConnection(src, origin, null);
                t.conns.add(conn);
                int code = conn.getResponseCode();
                if (code != 200 && code != 206) {
                    if (++noProgress > MAX_NOPROGRESS) throw new IOException("HTTP " + code);
                    sleep(backoff(noProgress));
                    continue;
                }
                long cl = parseLong(conn.getHeaderField("Content-Length"));
                if (cl > 0) { total = cl; item.put("bytesTotal", total); }

                in = conn.getInputStream();
                t.ins.add(in);
                raf = new RandomAccessFile(part, "rw");
                raf.setLength(0);
                raf.seek(0);

                long received = 0;
                long lastEmit = 0;
                boolean naturalEnd = false;
                byte[] buf = new byte[BUFFER];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (t.stopped()) break;
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

                if (t.stopped()) return;
                // Complet seulement si le flux est allé jusqu'au bout (sinon une
                // coupure précoce serait enregistrée comme un fichier tronqué).
                if (naturalEnd && received > 0 && (total <= 0 || received >= total)) {
                    item.put("bytesTotal", total > 0 ? total : received);
                    item.put("bytesDownloaded", received);
                    return;
                }
                if (++noProgress > MAX_NOPROGRESS) {
                    throw new IOException("Téléchargement bloqué (aucune donnée reçue)");
                }
                sleep(backoff(noProgress));
            } finally {
                if (conn != null) t.conns.remove(conn);
                if (in != null) t.ins.remove(in);
                try { if (in != null) in.close(); } catch (Exception ignored) {}
                try { if (conn != null) conn.disconnect(); } catch (Exception ignored) {}
                try { if (raf != null) raf.close(); } catch (Exception ignored) {}
            }
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

    /** Sonde la source : { rangeOk(0/1), total }. Réessaie quelques fois. */
    private long[] probeSource(Task t, String src, String origin) throws IOException {
        IOException last = null;
        for (int attempt = 0; attempt < 4 && !t.stopped(); attempt++) {
            HttpURLConnection conn = null;
            try {
                conn = openConnection(src, origin, "bytes=0-0");
                t.conns.add(conn);
                int code = conn.getResponseCode();
                String cr = conn.getHeaderField("Content-Range"); // bytes a-b/total
                long cl = parseLong(conn.getHeaderField("Content-Length"));
                if (code == 206 && cr != null) {
                    int slash = cr.lastIndexOf('/');
                    long tot = slash >= 0 ? parseLong(cr.substring(slash + 1)) : 0;
                    if (tot > 0) return new long[]{1, tot};
                }
                return new long[]{0, cl > 0 ? cl : 0};
            } catch (IOException e) {
                last = e;
                sleep(500L * (attempt + 1));
            } finally {
                if (conn != null) {
                    t.conns.remove(conn);
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }
        }
        if (last != null) throw last;
        throw new IOException("Source injoignable");
    }

    /** Ferme toutes les connexions/flux d'un transfert (pause / annulation / stall). */
    private void interrupt(Task t) {
        pool.execute(() -> {
            List<InputStream> ins;
            synchronized (t.ins) { ins = new ArrayList<>(t.ins); }
            for (InputStream in : ins) { try { in.close(); } catch (Exception ignored) {} }
            List<HttpURLConnection> conns;
            synchronized (t.conns) { conns = new ArrayList<>(t.conns); }
            for (HttpURLConnection c : conns) { try { c.disconnect(); } catch (Exception ignored) {} }
        });
    }

    private File destFile(String id, String ext) {
        File base = getContext().getExternalFilesDir(Environment.DIRECTORY_MOVIES);
        if (base == null) base = new File(getContext().getFilesDir(), "downloads");
        return new File(base, id + "." + ext);
    }

    private void deletePartFiles(File part) {
        try { if (part.exists()) part.delete(); } catch (Exception ignored) {}
        try { new File(part.getPath() + ".prog.json").delete(); } catch (Exception ignored) {}
    }

    private static long chunkSize(int i, long total) {
        return Math.min((long) (i + 1) * CHUNK_BYTES, total) - (long) i * CHUNK_BYTES;
    }

    private static long backoff(int tries) {
        return Math.min(500L * tries, 4000L);
    }

    private static long parseLong(String s) {
        if (s == null) return 0;
        try { return Long.parseLong(s.trim()); } catch (NumberFormatException e) { return 0; }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }

    private static int resolveMaxConnections() {
        try {
            String env = System.getenv("IPTVAX_DL_CONNECTIONS");
            if (env != null) {
                int v = Integer.parseInt(env.trim());
                if (v >= 1) return v;
            }
        } catch (Exception ignored) {}
        return 6;
    }

    // ── Manifeste de reprise (.prog.json) ────────────────────────────────────────

    private File progFile(File part) {
        return new File(part.getPath() + ".prog.json");
    }

    /** Charge le manifeste de reprise (tranches finies) si compatible. */
    private Set<Integer> loadProg(File part, long total) {
        Set<Integer> out = new HashSet<>();
        try {
            String raw = readFileString(progFile(part));
            JSONObject o = new JSONObject(raw);
            if (o.optLong("total") == total && o.optLong("chunk") == CHUNK_BYTES) {
                JSONArray arr = o.optJSONArray("done");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) out.add(arr.getInt(i));
                }
            }
        } catch (Exception ignored) { /* pas de manifeste / illisible */ }
        return out;
    }

    private void saveProg(File part, long total, Set<Integer> done) {
        try {
            JSONObject o = new JSONObject();
            o.put("total", total);
            o.put("chunk", CHUNK_BYTES);
            JSONArray arr = new JSONArray();
            synchronized (done) { for (Integer i : done) arr.put((int) i); }
            o.put("done", arr);
            writeFileString(progFile(part), o.toString());
        } catch (Exception ignored) {}
    }

    private static String readFileString(File f) throws IOException {
        try (FileInputStream fis = new FileInputStream(f)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] b = new byte[4096];
            int n;
            while ((n = fis.read(b)) != -1) bos.write(b, 0, n);
            return bos.toString("UTF-8");
        }
    }

    private static void writeFileString(File f, String s) throws IOException {
        try (FileOutputStream fos = new FileOutputStream(f)) {
            fos.write(s.getBytes("UTF-8"));
        }
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
            deletePartFiles(part);
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
