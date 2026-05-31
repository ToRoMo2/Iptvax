import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { isCapacitor } from '../lib/platform';

/**
 * Contrôle du volume média système (STREAM_MUSIC) sur Android Capacitor.
 *
 * Sur toute autre plateforme (web, Electron, Tizen, webOS), les méthodes
 * renvoient des valeurs neutres sans appel natif.
 *
 * Plugin natif : android/.../VolumeControlPlugin.java
 */
interface VolumeControlPlugin {
  getMediaVolume(): Promise<{ volume: number }>;
  setMediaVolume(options: { volume: number }): Promise<void>;
  addListener(
    event: 'volumeChange',
    handler: (data: { volume: number }) => void,
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
}

const VolumeControlNative = registerPlugin<VolumeControlPlugin>('VolumeControl');

export const volumeControl = {
  async getMediaVolume(): Promise<number> {
    if (!isCapacitor) return 1.0;
    try {
      const { volume } = await VolumeControlNative.getMediaVolume();
      return volume;
    } catch {
      return 1.0;
    }
  },

  async setMediaVolume(volume: number): Promise<void> {
    if (!isCapacitor) return;
    try {
      await VolumeControlNative.setMediaVolume({ volume });
    } catch { /* ignore */ }
  },

  onVolumeChange(handler: (volume: number) => void): () => void {
    if (!isCapacitor) return () => {};
    const handlePromise = VolumeControlNative.addListener(
      'volumeChange',
      ({ volume }) => handler(volume),
    );
    return () => { handlePromise.then((h) => h.remove()).catch(() => {}); };
  },
};
