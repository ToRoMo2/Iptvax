package com.iptvax.app;

import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.util.ArrayList;

/**
 * Lecteur natif libVLC — implémentation Android du contrat PlayerController
 * (Phase 2c, voir docs/native-port.md).
 *
 * Le moteur VLC lit le flux DIRECTEMENT depuis l'appareil (MKV/HEVC/MPEG-TS,
 * sous-titres embarqués) et le rend dans une VLCVideoLayout (SurfaceView)
 * insérée DERRIÈRE la WebView Capacitor. La WebView est rendue transparente
 * pendant la lecture → les contrôles React s'affichent par-dessus la vidéo.
 *
 * Côté JS : src/native/vlcPlayer.ts (interface) + src/hooks/useNativePlayer.ts.
 */
@CapacitorPlugin(name = "VlcPlayer")
public class VlcPlayerPlugin extends Plugin {

    private static final String TAG = "VlcPlayer";

    private LibVLC libVLC;
    private MediaPlayer mediaPlayer;
    private VLCVideoLayout videoLayout;
    private boolean viewsAttached = false;
    // `true` une fois qu'un évènement Playing a été reçu pour le média courant.
    // Sert à distinguer une vraie fin de lecture (EndReached après lecture)
    // d'un flux illisible/injoignable (EndReached sans avoir jamais joué).
    private boolean hasPlayed = false;
    // Orientation de l'activité avant le passage forcé en paysage.
    private int previousOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private boolean orientationForced = false;

    // ── Style des sous-titres (rendus par libVLC, pas l'overlay React) ──────────
    private String currentUrl = null;
    private int subScale = 100;          // sub-text-scale (%)
    private long subColor = 0xFFFFFF;    // freetype-color (RGB)
    private int subBgOpacity = 0;        // freetype-background-opacity (0-255)
    // Marge fixe pour remonter les sous-titres au-dessus de la barre de contrôles.
    // ⚠ Valeur à ajuster sur device : le sens/échelle de sub-margin dépend du vout.
    private static final int SUB_MARGIN = 60;
    // Après un reload (changement de style), on réapplique les pistes choisies.
    private boolean restoreTracksPending = false;
    private int pendingAudioId = -999;
    private int pendingSpuId = -999;
    // Style avec lequel l'instance LibVLC courante a été construite (pour savoir
    // s'il faut reconstruire le moteur quand le style change).
    private int engScale = -1;
    private long engColor = -1;
    private int engBgOpacity = -1;

    // ── Cycle de vie du moteur ────────────────────────────────────────────────

    /**
     * Construit l'instance LibVLC + le MediaPlayer.
     *
     * ⚠ Les options de rendu des sous-titres (`sub-text-scale`, `freetype-*`,
     * `sub-margin`) DOIVENT être passées ICI, au constructeur de LibVLC : ce
     * sont des options de MODULE (niveau moteur), pas des options d'input. En
     * tant qu'options média (`:option`) elles sont silencieusement ignorées.
     * Changer le style impose donc de reconstruire le moteur (cf. rebuildEngine).
     */
    private void buildEngine() {
        ArrayList<String> options = new ArrayList<>();
        options.add("--no-drop-late-frames");
        options.add("--no-skip-frames");
        options.add("--network-caching=1500");
        options.add("--sub-text-scale=" + subScale);
        options.add("--freetype-color=" + subColor);
        options.add("--freetype-background-opacity=" + subBgOpacity);
        options.add("--freetype-background-color=0");
        options.add("--sub-margin=" + SUB_MARGIN);
        // Gras + ombre portée pour coller au rendu de la preview React
        // (fontWeight 700 + text-shadow). Améliore aussi la lisibilité.
        options.add("--freetype-bold");
        options.add("--freetype-shadow-opacity=180");
        libVLC = new LibVLC(getContext(), options);
        mediaPlayer = new MediaPlayer(libVLC);
        mediaPlayer.setEventListener(this::onVlcEvent);
        engScale = subScale;
        engColor = subColor;
        engBgOpacity = subBgOpacity;
    }

    private void ensurePlayer() {
        if (libVLC == null) buildEngine();
        if (videoLayout == null) {
            videoLayout = new VLCVideoLayout(getContext());
            ViewGroup parent = (ViewGroup) getBridge().getWebView().getParent();
            // Index 0 → la surface vidéo est composée DERRIÈRE la WebView.
            parent.addView(videoLayout, 0, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
        }
        if (!viewsAttached) {
            mediaPlayer.attachViews(videoLayout, null, true, false);
            viewsAttached = true;
        }
    }

    /** Détruit et reconstruit le moteur (videoLayout conservé) — pour appliquer
     *  un nouveau style de sous-titres (options niveau moteur). */
    private void rebuildEngine() {
        if (mediaPlayer != null) {
            mediaPlayer.stop();
            if (viewsAttached) { mediaPlayer.detachViews(); viewsAttached = false; }
            mediaPlayer.release();
            mediaPlayer = null;
        }
        if (libVLC != null) { libVLC.release(); libVLC = null; }
        ensurePlayer(); // reconstruit le moteur avec le style courant + ré-attache
    }

    /** `true` si le style courant diffère de celui du moteur construit. */
    private boolean styleChanged() {
        return subScale != engScale || subColor != engColor || subBgOpacity != engBgOpacity;
    }

    // ── Méthodes exposées au JS ───────────────────────────────────────────────

    /**
     * Construit un Media. Le style des sous-titres est porté par l'instance
     * LibVLC (cf. buildEngine) ; ici on ne pose que le décodage HW et,
     * optionnellement, une position de départ (reload sans coupure).
     */
    private Media buildMedia(String url, long startTimeMs) {
        Media media = new Media(libVLC, Uri.parse(url));
        media.setHWDecoderEnabled(true, false);
        if (startTimeMs > 0) {
            media.addOption(":start-time=" + (startTimeMs / 1000.0));
        }
        return media;
    }

    /** Applique un objet de style (scale/color/bgOpacity) aux champs courants. */
    private void applySubStyle(JSObject style) {
        if (style == null) return;
        subScale = style.optInt("scale", subScale);
        subColor = style.optLong("color", subColor);
        subBgOpacity = style.optInt("bgOpacity", subBgOpacity);
    }

    @PluginMethod
    public void load(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url manquante");
            return;
        }
        applySubStyle(call.getObject("subStyle"));
        getActivity().runOnUiThread(() -> {
            try {
                Log.d(TAG, "load: " + url);
                ensurePlayer();
                // Moteur déjà présent mais style obsolète (prefs changées hors
                // lecture) → on le reconstruit avec le style courant.
                if (styleChanged()) rebuildEngine();
                hasPlayed = false;
                currentUrl = url;
                restoreTracksPending = false;

                // Force le paysage le temps de la lecture (restauré dans stop()).
                if (!orientationForced) {
                    previousOrientation = getActivity().getRequestedOrientation();
                    orientationForced = true;
                }
                getActivity().setRequestedOrientation(
                        ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

                // Masque les barres système (statut + navigation) → lecture
                // plein écran immersif, sans chevauchement avec les contrôles.
                setImmersive(true);

                // Empêche la mise en veille de l'écran pendant la lecture (la
                // vidéo est rendue par libVLC sur une SurfaceView, pas par le
                // <video> de la WebView → Android ne détecte pas de média actif).
                getActivity().getWindow().addFlags(
                        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

                // Rend la WebView transparente → la vidéo libVLC apparaît derrière
                // les contrôles React.
                getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
                videoLayout.setVisibility(View.VISIBLE);

                mediaPlayer.stop();
                Media media = buildMedia(url, 0);
                mediaPlayer.setMedia(media);
                media.release();
                mediaPlayer.play();
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
            if (mediaPlayer != null) mediaPlayer.play();
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (mediaPlayer != null) mediaPlayer.pause();
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(final PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (mediaPlayer != null) mediaPlayer.stop();
            if (videoLayout != null) videoLayout.setVisibility(View.GONE);
            // Rend la WebView de nouveau opaque (noir → pas de flash blanc).
            getBridge().getWebView().setBackgroundColor(Color.BLACK);
            // Restaure les barres système et l'orientation d'avant la lecture.
            setImmersive(false);
            // Réautorise la mise en veille de l'écran hors lecture.
            getActivity().getWindow().clearFlags(
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (orientationForced) {
                getActivity().setRequestedOrientation(previousOrientation);
                orientationForced = false;
            }
            call.resolve();
        });
    }

    /**
     * Plein écran immersif : masque (ou restaure) les barres système Android.
     * En mode immersif, un balayage depuis le bord les ré-affiche temporairement.
     */
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
            if (mediaPlayer != null) mediaPlayer.setTime((long) (position * 1000));
            call.resolve();
        });
    }

    @PluginMethod
    public void setAudioTrack(final PluginCall call) {
        final int id = call.getInt("id", -1);
        getActivity().runOnUiThread(() -> {
            if (mediaPlayer != null) mediaPlayer.setAudioTrack(id);
            call.resolve();
        });
    }

    @PluginMethod
    public void setSubtitleTrack(final PluginCall call) {
        final int id = call.getInt("id", -1);
        getActivity().runOnUiThread(() -> {
            if (mediaPlayer != null) mediaPlayer.setSpuTrack(id);
            call.resolve();
        });
    }

    @PluginMethod
    public void setVolume(final PluginCall call) {
        final double volume = call.getDouble("volume", 1.0);
        getActivity().runOnUiThread(() -> {
            if (mediaPlayer != null) {
                int v = (int) Math.round(Math.max(0, Math.min(1, volume)) * 100);
                mediaPlayer.setVolume(v);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setSubtitleDelay(final PluginCall call) {
        // delay en secondes ; positif = sous-titres en avance (convention web).
        // libVLC attend des microsecondes avec la convention inverse.
        final double delay = call.getDouble("delay", 0.0);
        getActivity().runOnUiThread(() -> {
            if (mediaPlayer != null) mediaPlayer.setSpuDelay((long) (-delay * 1_000_000));
            call.resolve();
        });
    }

    @PluginMethod
    public void setSubtitleStyle(final PluginCall call) {
        // ⚠ Le JS envoie { scale, color, bgOpacity } au PREMIER niveau (pas
        // imbriqué sous "subStyle" comme dans load) → on lit call.getData().
        applySubStyle(call.getData());
        getActivity().runOnUiThread(() -> {
            if (mediaPlayer == null || currentUrl == null) { call.resolve(); return; }
            if (!styleChanged()) { call.resolve(); return; }
            // Les options de style sont au niveau MOTEUR (cf. buildEngine) → on
            // RECONSTRUIT le moteur puis recharge le média au même point, en
            // préservant les pistes audio/CC (réappliquées dans l'event Playing).
            long time = mediaPlayer.getTime();
            pendingAudioId = mediaPlayer.getAudioTrack();
            pendingSpuId = mediaPlayer.getSpuTrack();
            restoreTracksPending = true;
            rebuildEngine();
            Media media = buildMedia(currentUrl, time);
            mediaPlayer.setMedia(media);
            media.release();
            mediaPlayer.play();
            call.resolve();
        });
    }

    // ── Évènements libVLC → JS ────────────────────────────────────────────────

    private void onVlcEvent(MediaPlayer.Event event) {
        switch (event.type) {
            case MediaPlayer.Event.Opening:
                emitState("loading", null);
                break;
            case MediaPlayer.Event.Buffering:
                if (event.getBuffering() < 100f) {
                    emitState("buffering", null);
                } else if (mediaPlayer != null && mediaPlayer.isPlaying()) {
                    emitState("playing", null);
                }
                break;
            case MediaPlayer.Event.Playing:
                hasPlayed = true;
                // Après un reload de restyle : réapplique les pistes choisies.
                if (restoreTracksPending && mediaPlayer != null) {
                    restoreTracksPending = false;
                    if (pendingAudioId != -999) mediaPlayer.setAudioTrack(pendingAudioId);
                    if (pendingSpuId != -999) mediaPlayer.setSpuTrack(pendingSpuId);
                }
                emitState("playing", null);
                emitTracks();
                break;
            case MediaPlayer.Event.Paused:
                emitState("paused", null);
                break;
            case MediaPlayer.Event.Stopped:
                emitState("idle", null);
                break;
            case MediaPlayer.Event.EndReached:
                // EndReached sans jamais avoir joué = flux illisible/injoignable
                // (l'erreur n'est pas toujours remontée comme EncounteredError).
                if (hasPlayed) {
                    emitState("ended", null);
                } else {
                    Log.e(TAG, "EndReached sans lecture — flux illisible");
                    emitState("error", "Flux illisible ou injoignable");
                }
                break;
            case MediaPlayer.Event.EncounteredError:
                Log.e(TAG, "EncounteredError");
                emitState("error", "Erreur de lecture");
                break;
            case MediaPlayer.Event.TimeChanged:
            case MediaPlayer.Event.LengthChanged:
                emitTime();
                break;
            case MediaPlayer.Event.ESAdded:
            case MediaPlayer.Event.ESDeleted:
            case MediaPlayer.Event.ESSelected:
                emitTracks();
                break;
            default:
                break;
        }
    }

    private void emitState(String state, String error) {
        Log.d(TAG, "state: " + state + (error != null ? " (" + error + ")" : ""));
        JSObject data = new JSObject();
        data.put("state", state);
        if (error != null) data.put("error", error);
        notifyListeners("state", data);
    }

    private void emitTime() {
        if (mediaPlayer == null) return;
        long time = mediaPlayer.getTime();
        long length = mediaPlayer.getLength();
        JSObject data = new JSObject();
        data.put("position", time / 1000.0);
        data.put("duration", length > 0 ? length / 1000.0 : 0);
        notifyListeners("time", data);
    }

    private void emitTracks() {
        if (mediaPlayer == null) return;
        JSObject data = new JSObject();
        data.put("audio", trackArray(mediaPlayer.getAudioTracks()));
        data.put("subtitle", trackArray(mediaPlayer.getSpuTracks()));
        data.put("currentAudio", mediaPlayer.getAudioTrack());
        data.put("currentSubtitle", mediaPlayer.getSpuTrack());
        notifyListeners("tracks", data);
    }

    private JSArray trackArray(MediaPlayer.TrackDescription[] tracks) {
        JSArray array = new JSArray();
        if (tracks != null) {
            for (MediaPlayer.TrackDescription td : tracks) {
                // libVLC inclut une piste "Disable" (id -1) — l'UI gère le « off »
                // via sa propre option, on ne la liste donc pas.
                if (td.id < 0) continue;
                JSObject t = new JSObject();
                t.put("id", td.id);
                t.put("name", td.name);
                array.put(t);
            }
        }
        return array;
    }

    /**
     * Mise en arrière-plan (écran éteint, retour accueil, app switcher) : on met
     * la lecture en pause pour couper le son et figer la vidéo. libVLC émet
     * l'évènement Paused → l'UI React affiche le bouton lecture. L'utilisateur
     * reprend manuellement au retour (pas de reprise auto).
     */
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (mediaPlayer != null && mediaPlayer.isPlaying()) {
            mediaPlayer.pause();
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (mediaPlayer != null) {
            mediaPlayer.stop();
            if (viewsAttached) mediaPlayer.detachViews();
            mediaPlayer.release();
            mediaPlayer = null;
        }
        if (libVLC != null) {
            libVLC.release();
            libVLC = null;
        }
        viewsAttached = false;
    }
}
