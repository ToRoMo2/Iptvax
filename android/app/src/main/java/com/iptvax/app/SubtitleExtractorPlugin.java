package com.iptvax.app;

import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Extraction ON-DEVICE des sous-titres TEXTE via android.media.MediaExtractor.
 *
 * But : permettre au lecteur natif Android (libVLC) de DÉLÉGUER le rendu des
 * sous-titres texte à l'overlay React (comme le web) → restyle taille/couleur/
 * fond instantané sans rechargement du flux (libVLC 3.x ne sait pas restyler à
 * chaud). libVLC garde la vidéo + l'audio + les sous-titres IMAGE (PGS/DVB).
 *
 * Pendant inverse de /api/subtitle (ffmpeg côté web) : extraction FENÊTRÉE
 * (seekTo + lecture d'une tranche) pour éviter de télécharger tout le fichier
 * et de monopoliser la connexion fournisseur (garde-fou §IV-1). Un MediaExtractor
 * est mis en cache par (url, piste) et RÉUTILISÉ entre fenêtres (un seul flux de
 * sous-titres ouvert, on ne fait que re-seek).
 *
 * ⚠ Best-effort : MediaExtractor n'expose pas toujours les pistes sous-titres
 * d'un MKV (dépend de l'appareil/codec). En cas d'échec, on renvoie des listes
 * vides → la couche JS (useNativePlayer) retombe sur le rendu libVLC natif.
 *
 * Tout le travail réseau tourne sur un thread dédié (NetworkOnMainThread sinon).
 */
@CapacitorPlugin(name = "SubtitleExtractor")
public class SubtitleExtractorPlugin extends Plugin {

    private static final String TAG = "SubtitleExtractor";

    // UA navigateur — certains fournisseurs rejettent l'UA par défaut sur les
    // fichiers VOD (cf. §IV-8 ; l'UA VLC est réservé au live).
    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    // Durée max d'affichage d'une cue quand la fin n'est pas connue (la cue
    // suivante coupe l'affichage avant, en pratique).
    private static final long MAX_CUE_MS = 8000;

    private final ExecutorService exec = Executors.newSingleThreadExecutor();

    // Extracteur mis en cache (réutilisé entre fenêtres de la même piste).
    private MediaExtractor cached;
    private String cachedUrl;
    private int cachedTrack = -1;

    private static final Pattern ASS_OVERRIDE = Pattern.compile("\\{[^}]*\\}");

    private static Map<String, String> headers() {
        Map<String, String> h = new HashMap<>();
        h.put("User-Agent", UA);
        return h;
    }

    private static boolean isTextSubtitle(String mime) {
        if (mime == null) return false;
        return mime.equals(MediaFormat.MIMETYPE_TEXT_SUBRIP)        // application/x-subrip
                || mime.equals("text/x-ssa")                        // ASS/SSA
                || mime.equals("text/vtt")
                || mime.equals(MediaFormat.MIMETYPE_TEXT_VTT)
                || mime.equals("application/ttml+xml")
                || mime.startsWith("text/");
        // NB : les sous-titres IMAGE (application/pgs, dvbsubs, vobsub…) ne
        // matchent pas → exclus (rendus par libVLC).
    }

    @PluginMethod
    public void probe(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("url manquante"); return; }
        exec.execute(() -> {
            MediaExtractor ex = new MediaExtractor();
            JSArray tracks = new JSArray();
            try {
                ex.setDataSource(url, headers());
                int n = ex.getTrackCount();
                for (int i = 0; i < n; i++) {
                    MediaFormat fmt = ex.getTrackFormat(i);
                    String mime = fmt.getString(MediaFormat.KEY_MIME);
                    if (!isTextSubtitle(mime)) continue;
                    String lang = fmt.containsKey(MediaFormat.KEY_LANGUAGE)
                            ? fmt.getString(MediaFormat.KEY_LANGUAGE) : "";
                    if (lang == null || lang.equals("und")) lang = "";
                    JSObject t = new JSObject();
                    t.put("trackIndex", i);
                    t.put("language", lang);
                    t.put("mime", mime);
                    tracks.put(t);
                }
            } catch (Exception e) {
                Log.w(TAG, "probe failed: " + e.getMessage());
                // tracks reste vide → repli libVLC côté JS.
            } finally {
                try { ex.release(); } catch (Exception ignored) {}
            }
            JSObject ret = new JSObject();
            ret.put("tracks", tracks);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void extract(final PluginCall call) {
        final String url = call.getString("url");
        final int trackIndex = call.getInt("trackIndex", -1);
        final long startMs = call.getInt("startMs", 0).longValue();
        final long durationMs = call.getInt("durationMs", 0).longValue();
        if (url == null || url.isEmpty() || trackIndex < 0) {
            call.reject("paramètres invalides");
            return;
        }
        exec.execute(() -> {
            JSArray cues = new JSArray();
            try {
                MediaExtractor ex = ensureExtractor(url, trackIndex);
                if (ex == null) { resolveCues(call, cues); return; }

                final long startUs = Math.max(0, startMs) * 1000L;
                final long endUs = (startMs + durationMs) * 1000L;
                ex.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC);

                // Le seek sur une piste sous-titre peut atterrir AVANT la fenêtre
                // (pas de sync sample) → on saute en avant (sans décoder) jusqu'au
                // début de fenêtre, pour ne pas saturer le plafond de samples sur
                // les fenêtres lointaines.
                int skipGuard = 0;
                while (skipGuard++ < 50_000) {
                    long t = ex.getSampleTime();
                    if (t < 0 || t >= startUs) break;
                    if (!ex.advance()) break;
                }

                String mime = ex.getTrackFormat(trackIndex).getString(MediaFormat.KEY_MIME);
                ByteBuffer buf = ByteBuffer.allocate(256 * 1024);

                ArrayList<Long> times = new ArrayList<>();
                ArrayList<String> texts = new ArrayList<>();
                int guard = 0;
                while (guard++ < 5000) {
                    long t = ex.getSampleTime();
                    if (t < 0) break;                 // fin de piste
                    if (t > endUs) break;             // sorti de la fenêtre
                    int size = ex.readSampleData(buf, 0);
                    if (size <= 0) { if (!ex.advance()) break; else continue; }
                    byte[] b = new byte[size];
                    buf.position(0);
                    buf.get(b, 0, size);
                    String text = decodeCue(b, mime);
                    if (text != null && !text.isEmpty()) {
                        times.add(t);
                        texts.add(text);
                    }
                    if (!ex.advance()) break;
                }

                // Fin de chaque cue = début de la suivante (sous-titres texte non
                // chevauchants), plafonné à MAX_CUE_MS.
                int count = times.size();
                for (int i = 0; i < count; i++) {
                    long s = times.get(i) / 1000L;
                    long e = (i + 1 < count)
                            ? Math.min(times.get(i + 1) / 1000L, s + MAX_CUE_MS)
                            : s + MAX_CUE_MS;
                    if (e <= s) e = s + MAX_CUE_MS;
                    JSObject c = new JSObject();
                    c.put("start", s);
                    c.put("end", e);
                    c.put("text", texts.get(i));
                    cues.put(c);
                }
            } catch (Exception e) {
                Log.w(TAG, "extract failed: " + e.getMessage());
                releaseCached();
            }
            resolveCues(call, cues);
        });
    }

    @PluginMethod
    public void release(final PluginCall call) {
        exec.execute(() -> { releaseCached(); call.resolve(); });
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    /** Retourne (en réutilisant le cache) un MediaExtractor positionné sur la
     *  piste demandée, ou null en cas d'échec. */
    private MediaExtractor ensureExtractor(String url, int trackIndex) {
        if (cached != null && url.equals(cachedUrl) && trackIndex == cachedTrack) {
            return cached;
        }
        releaseCached();
        try {
            MediaExtractor ex = new MediaExtractor();
            ex.setDataSource(url, headers());
            ex.selectTrack(trackIndex);
            cached = ex;
            cachedUrl = url;
            cachedTrack = trackIndex;
            return ex;
        } catch (Exception e) {
            Log.w(TAG, "ensureExtractor failed: " + e.getMessage());
            releaseCached();
            return null;
        }
    }

    private void releaseCached() {
        if (cached != null) {
            try { cached.release(); } catch (Exception ignored) {}
        }
        cached = null;
        cachedUrl = null;
        cachedTrack = -1;
    }

    private void resolveCues(PluginCall call, JSArray cues) {
        JSObject ret = new JSObject();
        ret.put("cues", cues);
        call.resolve(ret);
    }

    /** Décode l'octet d'un échantillon en texte d'affichage selon le codec. */
    private String decodeCue(byte[] bytes, String mime) {
        String raw = new String(bytes, StandardCharsets.UTF_8).trim();
        if (raw.isEmpty()) return null;
        if ("text/x-ssa".equals(mime)) {
            // MKV stocke l'ASS comme les champs du Dialogue à partir de ReadOrder :
            // "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text".
            // Le texte est le 9e champ (le reste peut contenir des virgules).
            String[] parts = raw.split(",", 9);
            String text = parts.length == 9 ? parts[8] : raw;
            text = ASS_OVERRIDE.matcher(text).replaceAll("");   // retire {\...}
            text = text.replace("\\N", "\n").replace("\\n", "\n");
            return text.trim();
        }
        // SubRip / VTT / TTML / texte : on garde tel quel (les balises <i>… sont
        // rendues par l'overlay React via dangerouslySetInnerHTML).
        // TTML : retrait grossier des balises XML.
        if ("application/ttml+xml".equals(mime)) {
            raw = raw.replaceAll("<[^>]+>", "").trim();
        }
        return raw;
    }

    @Override
    protected void handleOnDestroy() {
        releaseCached();
        exec.shutdownNow();
    }
}
