package com.iptvax.app;

import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.SurfaceView;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Format;
import androidx.media3.common.Tracks;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.text.Cue;
import androidx.media3.common.text.CueGroup;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Lecteur natif AndroidX Media3 (ExoPlayer) — implémentation Android du contrat
 * PlayerController (remplace libVLC, voir docs/native-port.md).
 *
 * Pourquoi Media3 plutôt que libVLC : ExoPlayer émet les cues sous-titres TEXTE
 * en direct via {@link Player.Listener#onCues} (décodées par le même pipeline
 * que la vidéo, une seule connexion). On les renvoie au JS pour les afficher
 * dans l'overlay React → restyle taille/couleur/fond + changement de piste
 * INSTANTANÉS (libVLC 3.x devait reconstruire le moteur). On NE rattache donc
 * AUCUN SubtitleView natif : Media3 décode, React rend.
 *
 * La vidéo est rendue sur une SurfaceView insérée DERRIÈRE la WebView Capacitor
 * (rendue transparente pendant la lecture) → les contrôles React s'affichent
 * par-dessus. Mêmes plombings que l'ancien lecteur libVLC (surface index 0,
 * WebView transparente, classe iptvax-native-playback côté web).
 *
 * Côté JS : src/native/nativePlayer.ts (interface) + src/hooks/useNativePlayer.ts.
 */
@OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "NativePlayer")
public class MediaPlayerPlugin extends Plugin {

    private static final String TAG = "NativePlayer";

    private ExoPlayer player;
    private SurfaceView surfaceView;

    // Référentiels de pistes pour la sélection (l'index UI → TrackGroup + piste).
    // Reconstruits à chaque onTracksChanged.
    private final List<TrackRef> audioRefs = new ArrayList<>();
    private final List<TrackRef> textRefs = new ArrayList<>();
    private final List<TrackRef> videoRefs = new ArrayList<>();

    // Sonde de position : ExoPlayer ne pousse pas d'event de temps → on poll.
    private final Handler timeHandler = new Handler(Looper.getMainLooper());
    private Runnable timeTick;

    // Orientation de l'activité avant le passage forcé en paysage.
    private int previousOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private boolean orientationForced = false;

    /** Une piste sélectionnable : son groupe Media3 + son index dans le groupe. */
    private static final class TrackRef {
        final TrackGroup group;
        final int trackIndex;
        TrackRef(TrackGroup g, int i) { group = g; trackIndex = i; }
    }

    // ── Cycle de vie du moteur ────────────────────────────────────────────────

    private void ensurePlayer() {
        if (player == null) {
            // EXTENSION_RENDERER_MODE_PREFER : si l'extension FFmpeg de Media3 est
            // présente (audio Dolby AC3/EAC3/DTS — cf. build.gradle), elle est
            // préférée aux décodeurs matériels. Sans elle → décodeurs HW seuls.
            DefaultRenderersFactory renderers = new DefaultRenderersFactory(getContext())
                    .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);

            player = new ExoPlayer.Builder(getContext())
                    .setRenderersFactory(renderers)
                    .build();
            player.addListener(new PlayerListener());
            player.setVideoSurfaceView(surfaceView);
            startTimeTicker();
        }
    }

    /** Crée la SurfaceView vidéo derrière la WebView (une seule fois). */
    private void ensureSurface() {
        if (surfaceView == null) {
            surfaceView = new SurfaceView(getContext());
            ViewGroup parent = (ViewGroup) getBridge().getWebView().getParent();
            // Index 0 → la surface vidéo est composée DERRIÈRE la WebView.
            parent.addView(surfaceView, 0, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
        }
    }

    private void startTimeTicker() {
        if (timeTick != null) return;
        timeTick = new Runnable() {
            @Override public void run() {
                emitTime();
                timeHandler.postDelayed(this, 500);
            }
        };
        timeHandler.post(timeTick);
    }

    private void stopTimeTicker() {
        if (timeTick != null) { timeHandler.removeCallbacks(timeTick); timeTick = null; }
    }

    // ── Construction du DataSource / MediaSource (headers par type de flux) ─────

    /**
     * MediaSource.Factory avec les en-têtes HTTP alignés sur le proxy (§IV-8) :
     * - live  → UA VLC, sans Referer/Origin (un vrai lecteur n'en envoie pas) ;
     * - VOD/série → UA navigateur + Referer/Origin de l'upstream (certains
     *   fournisseurs rejettent l'UA par défaut sur les fichiers directs).
     * DefaultMediaSourceFactory choisit seul HLS (si .m3u8) vs progressif
     * (MKV/MP4/TS via DefaultExtractorsFactory) selon l'URL.
     */
    private DefaultMediaSourceFactory buildMediaSourceFactory(String url, boolean isLive) {
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15_000)
                .setReadTimeoutMs(15_000);

        if (isLive) {
            http.setUserAgent("VLC/3.0.20 LibVLC/3.0.20");
        } else {
            http.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
            String origin = originOf(url);
            if (origin != null) {
                Map<String, String> headers = new HashMap<>();
                headers.put("Referer", origin + "/");
                headers.put("Origin", origin);
                http.setDefaultRequestProperties(headers);
            }
        }
        return new DefaultMediaSourceFactory(getContext()).setDataSourceFactory(http);
    }

    private static String originOf(String url) {
        try {
            android.net.Uri u = android.net.Uri.parse(url);
            String scheme = u.getScheme();
            String authority = u.getAuthority();
            if (scheme == null || authority == null) return null;
            return scheme + "://" + authority;
        } catch (Exception e) {
            return null;
        }
    }

    // ── Méthodes exposées au JS ───────────────────────────────────────────────

    @PluginMethod
    public void load(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("url manquante"); return; }
        final boolean isLive = Boolean.TRUE.equals(call.getBoolean("isLive", false));
        getActivity().runOnUiThread(() -> {
            try {
                Log.d(TAG, "load (live=" + isLive + "): " + url);
                ensureSurface();
                ensurePlayer();

                // Force le paysage le temps de la lecture (restauré dans stop()).
                if (!orientationForced) {
                    previousOrientation = getActivity().getRequestedOrientation();
                    orientationForced = true;
                }
                getActivity().setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

                // Plein écran immersif (masque barres système).
                setImmersive(true);
                // Empêche la veille pendant la lecture (vidéo sur SurfaceView, pas
                // sur le <video> de la WebView → Android ne détecte pas de média).
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

                // WebView transparente → la vidéo ExoPlayer apparaît derrière.
                getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
                surfaceView.setVisibility(View.VISIBLE);

                // Les en-têtes HTTP dépendent du type de flux (§IV-8) → on
                // construit le MediaSource par chargement (le factory du moteur
                // est figé à la construction, d'où setMediaSource ici).
                player.setMediaSource(
                        buildMediaSourceFactory(url, isLive).createMediaSource(MediaItem.fromUri(url)));
                player.prepare();
                player.setPlayWhenReady(true);
                call.resolve();
            } catch (Exception e) {
                Log.e(TAG, "load failed", e);
                emitState("error", "Échec du chargement : " + e.getMessage());
                call.reject("Échec du chargement : " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void play(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) player.play();
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) player.pause();
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (player != null) player.stop();
            if (surfaceView != null) surfaceView.setVisibility(View.GONE);
            // WebView de nouveau opaque (noir → pas de flash blanc).
            getBridge().getWebView().setBackgroundColor(Color.BLACK);
            setImmersive(false);
            getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (orientationForced) {
                getActivity().setRequestedOrientation(previousOrientation);
                orientationForced = false;
            }
            call.resolve();
        });
    }

    private void setImmersive(boolean immersive) {
        Window window = getActivity().getWindow();
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
        WindowCompat.setDecorFitsSystemWindows(window, !immersive);
        if (immersive) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    @PluginMethod
    public void seek(final PluginCall call) {
        final double position = call.getDouble("position", 0.0);
        getActivity().runOnUiThread(() -> {
            if (player != null) player.seekTo((long) (position * 1000));
            emitTime();
            call.resolve();
        });
    }

    @PluginMethod
    public void setAudioTrack(final PluginCall call) {
        final int index = call.getInt("index", -1);
        getActivity().runOnUiThread(() -> {
            selectTrack(C.TRACK_TYPE_AUDIO, audioRefs, index);
            call.resolve();
        });
    }

    /**
     * Sélectionne (ou désactive) une piste sous-titre TEXTE. Comme on rend les
     * cues en React, « sélectionner » = activer l'émission onCues de cette piste ;
     * index < 0 = désactiver (texte vidé côté JS).
     */
    @PluginMethod
    public void setSubtitleTrack(final PluginCall call) {
        final int index = call.getInt("index", -1);
        getActivity().runOnUiThread(() -> {
            selectTrack(C.TRACK_TYPE_TEXT, textRefs, index);
            call.resolve();
        });
    }

    /** Verrouille un niveau de qualité vidéo (HLS) ; index < 0 = auto (ABR). */
    @PluginMethod
    public void setVideoQuality(final PluginCall call) {
        final int index = call.getInt("index", -1);
        getActivity().runOnUiThread(() -> {
            selectTrack(C.TRACK_TYPE_VIDEO, videoRefs, index);
            call.resolve();
        });
    }

    @PluginMethod
    public void setVolume(final PluginCall call) {
        final double volume = call.getDouble("volume", 1.0);
        getActivity().runOnUiThread(() -> {
            if (player != null) player.setVolume((float) Math.max(0, Math.min(1, volume)));
            call.resolve();
        });
    }

    /**
     * Applique une override de sélection. Pour TEXT, index < 0 = désactiver le
     * type (aucune piste, aucun onCues). Pour AUDIO/VIDEO, index < 0 = auto.
     */
    private void selectTrack(int trackType, List<TrackRef> refs, int index) {
        if (player == null) return;
        TrackSelectionParameters.Builder b = player.getTrackSelectionParameters().buildUpon();
        b.clearOverridesOfType(trackType);
        if (index < 0) {
            b.setTrackTypeDisabled(trackType, trackType == C.TRACK_TYPE_TEXT);
        } else if (index < refs.size()) {
            TrackRef ref = refs.get(index);
            b.setTrackTypeDisabled(trackType, false);
            b.addOverride(new TrackSelectionOverride(ref.group, ref.trackIndex));
        }
        player.setTrackSelectionParameters(b.build());
    }

    // ── Évènements ExoPlayer → JS ─────────────────────────────────────────────

    private final class PlayerListener implements Player.Listener {
        @Override
        public void onPlaybackStateChanged(int state) {
            switch (state) {
                case Player.STATE_BUFFERING:
                    emitState("buffering", null);
                    break;
                case Player.STATE_READY:
                    emitState(player != null && player.getPlayWhenReady() ? "playing" : "paused", null);
                    updateKeepScreenOn();
                    break;
                case Player.STATE_ENDED:
                    emitState("ended", null);
                    updateKeepScreenOn();
                    break;
                case Player.STATE_IDLE:
                default:
                    break;
            }
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            // Reflète pause/reprise réelle (y compris underrun → buffering géré
            // par onPlaybackStateChanged). On n'émet « playing/paused » ici que
            // si le player est prêt, pour ne pas masquer un buffering en cours.
            if (player == null) return;
            if (player.getPlaybackState() == Player.STATE_READY) {
                emitState(isPlaying ? "playing" : "paused", null);
            }
            updateKeepScreenOn();
        }

        @Override
        public void onPlayerError(@NonNull PlaybackException error) {
            Log.e(TAG, "player error: " + error.getErrorCodeName(), error);
            emitState("error", errorMessage(error));
            updateKeepScreenOn();
        }

        @Override
        public void onTracksChanged(@NonNull Tracks tracks) {
            rebuildTrackRefs(tracks);
        }

        @Override
        public void onCues(@NonNull CueGroup cueGroup) {
            emitCues(cueGroup);
        }
    }

    private String errorMessage(PlaybackException error) {
        int code = error.errorCode;
        // Audio non décodable (typiquement Dolby AC3/EAC3/DTS sans extension
        // FFmpeg) → message explicite plutôt qu'un code opaque.
        if (code == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED
                || code == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED) {
            return "Format audio/vidéo non supporté par cet appareil (codec Dolby ?).";
        }
        if (code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
                || code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
                || code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS) {
            return "Source injoignable ou refusée par le fournisseur.";
        }
        return "Erreur de lecture (" + error.getErrorCodeName() + ").";
    }

    /** Reconstruit audioRefs/textRefs/videoRefs + émet la liste de pistes au JS. */
    private void rebuildTrackRefs(Tracks tracks) {
        audioRefs.clear();
        textRefs.clear();
        videoRefs.clear();
        JSArray audio = new JSArray();
        JSArray subtitle = new JSArray();
        JSArray levels = new JSArray();
        int currentAudio = -1, currentSubtitle = -1, currentLevel = -1;

        for (Tracks.Group group : tracks.getGroups()) {
            int type = group.getType();
            TrackGroup tg = group.getMediaTrackGroup();
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSupported(i)) {
                    // Piste non décodable (codec absent) — on la liste quand même
                    // côté audio pour que l'UI ne « perde » pas une piste, mais on
                    // ne pourra pas la sélectionner. Pour la vidéo/texte on saute.
                    if (type != C.TRACK_TYPE_AUDIO) continue;
                }
                Format f = group.getTrackFormat(i);
                boolean selected = group.isTrackSelected(i);
                if (type == C.TRACK_TYPE_AUDIO) {
                    JSObject t = new JSObject();
                    t.put("index", audioRefs.size());
                    t.put("name", audioLabel(f, audioRefs.size()));
                    t.put("language", f.language != null ? f.language : "");
                    audio.put(t);
                    if (selected) currentAudio = audioRefs.size();
                    audioRefs.add(new TrackRef(tg, i));
                } else if (type == C.TRACK_TYPE_TEXT) {
                    // Sous-titres IMAGE (PGS/DVB/VobSub) : pas de cues texte → on
                    // ne peut pas les rendre en React. On les saute (rares).
                    if (!isTextSubtitle(f.sampleMimeType)) continue;
                    JSObject t = new JSObject();
                    t.put("index", textRefs.size());
                    t.put("name", subLabel(f, textRefs.size()));
                    t.put("language", f.language != null ? f.language : "");
                    subtitle.put(t);
                    if (selected) currentSubtitle = textRefs.size();
                    textRefs.add(new TrackRef(tg, i));
                } else if (type == C.TRACK_TYPE_VIDEO) {
                    JSObject t = new JSObject();
                    t.put("index", videoRefs.size());
                    t.put("label", f.height > 0 ? (f.height + "p")
                            : (f.bitrate > 0 ? (Math.round(f.bitrate / 1000.0) + " kbps") : "Auto"));
                    t.put("bitrate", f.bitrate > 0 ? f.bitrate : 0);
                    levels.put(t);
                    if (selected) currentLevel = videoRefs.size();
                    videoRefs.add(new TrackRef(tg, i));
                }
            }
        }

        JSObject data = new JSObject();
        data.put("audio", audio);
        data.put("subtitle", subtitle);
        data.put("levels", levels);
        data.put("currentAudio", currentAudio);
        data.put("currentSubtitle", currentSubtitle);
        data.put("currentLevel", currentLevel);
        notifyListeners("tracks", data);
    }

    /** `true` pour les sous-titres TEXTE (rendables en React via onCues). Les
     *  sous-titres IMAGE (PGS/DVB/VobSub) n'émettent pas de cue texte → exclus. */
    private static boolean isTextSubtitle(String mime) {
        if (mime == null) return false;
        return mime.equals(androidx.media3.common.MimeTypes.TEXT_VTT)
                || mime.equals(androidx.media3.common.MimeTypes.APPLICATION_SUBRIP)
                || mime.equals(androidx.media3.common.MimeTypes.TEXT_SSA)
                || mime.equals(androidx.media3.common.MimeTypes.APPLICATION_TTML)
                || mime.startsWith("text/")
                || mime.startsWith("application/x-subrip");
    }

    private static String audioLabel(Format f, int i) {
        if (f.label != null && !f.label.isEmpty()) return f.label;
        if (f.language != null && !f.language.isEmpty() && !f.language.equals("und"))
            return f.language.toUpperCase();
        return "Audio " + (i + 1);
    }

    private static String subLabel(Format f, int i) {
        if (f.label != null && !f.label.isEmpty()) return f.label;
        if (f.language != null && !f.language.isEmpty() && !f.language.equals("und"))
            return f.language.toUpperCase();
        return "Sous-titres " + (i + 1);
    }

    /**
     * Émet le groupe de cues courant vers le JS. Le texte (avec balises HTML
     * basiques converties) + le temps de présentation → bufferisés et rendus par
     * l'overlay React (offset utilisateur appliqué côté JS).
     */
    private void emitCues(CueGroup cueGroup) {
        long timeMs = cueGroup.presentationTimeUs >= 0 ? cueGroup.presentationTimeUs / 1000 : -1;
        StringBuilder sb = new StringBuilder();
        for (Cue cue : cueGroup.cues) {
            if (cue.text == null) continue; // cue image/bitmap → ignorée (rare)
            if (sb.length() > 0) sb.append('\n');
            sb.append(cue.text.toString());
        }
        JSObject data = new JSObject();
        data.put("startMs", timeMs);
        data.put("text", sb.toString());
        notifyListeners("cues", data);
    }

    private void updateKeepScreenOn() {
        if (getActivity() == null) return;
        final boolean keepOn = player != null && player.isPlaying();
        getActivity().runOnUiThread(() -> {
            if (getActivity() == null) return;
            Window w = getActivity().getWindow();
            if (keepOn) w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else w.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    private void emitState(String state, String error) {
        Log.d(TAG, "state: " + state + (error != null ? " (" + error + ")" : ""));
        JSObject data = new JSObject();
        data.put("state", state);
        if (error != null) data.put("error", error);
        notifyListeners("state", data);
    }

    private void emitTime() {
        if (player == null) return;
        long pos = Math.max(0, player.getCurrentPosition());
        long dur = player.getDuration();
        long buffered = Math.max(0, player.getBufferedPosition());
        JSObject data = new JSObject();
        data.put("position", pos / 1000.0);
        data.put("duration", dur > 0 ? dur / 1000.0 : 0);
        data.put("buffered", buffered / 1000.0);
        notifyListeners("time", data);
    }

    // ── Cycle de vie de l'activité ────────────────────────────────────────────

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        // ExoPlayer + SurfaceView gèrent la destruction/recréation de surface
        // automatiquement (SurfaceHolder callback). On se contente de mettre en
        // pause (coupe le son en arrière-plan) et d'autoriser la veille.
        if (player != null && player.isPlaying()) player.pause();
        if (getActivity() != null) {
            getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // La surface est ré-attachée automatiquement par ExoPlayer ; rien à faire.
        // Reprise manuelle (pas d'auto-play) — cohérent avec l'ancien lecteur.
    }

    @Override
    protected void handleOnDestroy() {
        stopTimeTicker();
        if (player != null) {
            player.release();
            player = null;
        }
    }
}
