import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useIptvProfile } from './IptvProfileContext';
import { useSubscription } from './SubscriptionContext';
import { isDownloadCapable } from '../lib/platform';
import { downloadEngine } from '../services/downloads/engine';
import type { DownloadItem, DownloadRequest } from '../types/download.types';

interface DownloadsContextValue {
  /** `true` si la plateforme sait télécharger (Android/Windows). */
  available: boolean;
  /** `true` si l'utilisateur a le droit de télécharger (Premium). */
  allowed: boolean;
  /** Téléchargements du profil actif (device-local, jamais synchronisés). */
  items: DownloadItem[];
  /** Démarre un téléchargement (Premium requis). `profileId` injecté ici. */
  download: (req: Omit<DownloadRequest, 'profileId'>) => Promise<void>;
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => void;
  remove: (id: string) => void;
  /** Entrée du registre pour un `historyId`/`id` donné (ou undefined). */
  byId: (id: string) => DownloadItem | undefined;
}

const DownloadsContext = createContext<DownloadsContextValue | null>(null);

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const { activeProfile } = useIptvProfile();
  const { isPremium } = useSubscription();
  const profileId = activeProfile?.id ?? null;

  const available = isDownloadCapable && downloadEngine.available();
  const allowed = available && isPremium;

  const [allItems, setAllItems] = useState<DownloadItem[]>([]);

  // Reflet du registre du moteur (source unique de vérité). Initial list +
  // abonnement aux changements (progression / statut ré-émis par le moteur).
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    downloadEngine.list().then((items) => {
      if (!cancelled) setAllItems(items);
    });
    const unsub = downloadEngine.subscribe((items) => {
      if (!cancelled) setAllItems(items);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [available]);

  // Isolation par profil (comme la bibliothèque). Les fichiers sont
  // device-local mais le registre porte le `profileId` propriétaire.
  const items = useMemo(
    () => allItems.filter((it) => !profileId || it.profileId === profileId),
    [allItems, profileId],
  );

  const download = useCallback(
    async (req: Omit<DownloadRequest, 'profileId'>) => {
      if (!allowed || !profileId) return;
      await downloadEngine.enqueue({ ...req, profileId });
    },
    [allowed, profileId],
  );

  const pause = useCallback((id: string) => void downloadEngine.pause(id), []);
  const resume = useCallback((id: string) => void downloadEngine.resume(id), []);
  const cancel = useCallback((id: string) => void downloadEngine.cancel(id), []);
  const remove = useCallback((id: string) => void downloadEngine.remove(id), []);

  const byId = useCallback(
    (id: string) => items.find((it) => it.id === id),
    [items],
  );

  const value = useMemo(
    () => ({ available, allowed, items, download, pause, resume, cancel, remove, byId }),
    [available, allowed, items, download, pause, resume, cancel, remove, byId],
  );

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export function useDownloads(): DownloadsContextValue {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error('useDownloads doit être utilisé dans DownloadsProvider');
  return ctx;
}
