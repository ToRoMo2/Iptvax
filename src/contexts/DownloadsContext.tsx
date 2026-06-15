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

  // Items réels du moteur (source de vérité une fois confirmés).
  const [engineItems, setEngineItems] = useState<DownloadItem[]>([]);
  // Items OPTIMISTES : posés dès le clic « Télécharger » pour un retour visuel
  // immédiat (le moteur peut mettre un instant à confirmer, ou échouer). Dès que
  // le moteur émet une entrée du même id, l'optimiste est retiré (le moteur
  // gagne). Si l'enqueue échoue, l'optimiste passe en `error` → visible.
  const [optimistic, setOptimistic] = useState<Record<string, DownloadItem>>({});

  // Applique un snapshot du moteur : le moteur fait foi → on remplace les items
  // et on purge les optimistes qu'il connaît désormais.
  const applyList = useCallback((list: DownloadItem[]) => {
    setEngineItems(list);
    setOptimistic((prev) => {
      const ids = new Set(list.map((i) => i.id));
      let changed = false;
      const next: Record<string, DownloadItem> = {};
      for (const [id, it] of Object.entries(prev)) {
        if (ids.has(id)) changed = true;
        else next[id] = it;
      }
      return changed ? next : prev;
    });
  }, []);

  // Reflet du registre du moteur (initial list + abonnement aux changements).
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    const apply = (list: DownloadItem[]) => {
      if (cancelled) return;
      applyList(list);
    };
    downloadEngine.list().then(apply);
    const unsub = downloadEngine.subscribe(apply);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [available, applyList]);

  // Y a-t-il un transfert en cours (réel ou optimiste pas encore confirmé) ?
  const hasActiveTransfers = useMemo(
    () =>
      engineItems.some((i) => i.status === 'downloading' || i.status === 'queued') ||
      Object.keys(optimistic).length > 0,
    [engineItems, optimistic],
  );

  // Filet de sécurité — réconciliation par POLLING tant qu'un transfert est
  // actif. L'abonnement push (`downloadsChanged`) suffit sur Electron (IPC
  // fiable) mais sur Android le bridge Capacitor peut « avaler » des
  // `notifyListeners` → l'optimiste « queued » resterait à tourner indéfiniment
  // alors que le DownloadManager télécharge bel et bien en arrière-plan. On
  // re-`list()` donc périodiquement pour aligner l'UI sur la réalité du moteur
  // (purge l'optimiste, met à jour la progression). S'arrête dès qu'il n'y a
  // plus rien d'actif (dépendance sur le booléen, pas sur chaque tick de %).
  useEffect(() => {
    if (!available || !hasActiveTransfers) return;
    let cancelled = false;
    const tick = () => {
      downloadEngine
        .list()
        .then((list) => {
          if (!cancelled) applyList(list);
        })
        .catch(() => {});
    };
    const interval = window.setInterval(tick, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [available, hasActiveTransfers, applyList]);

  // Fusion moteur + optimiste (le moteur prime), puis isolation par profil.
  const items = useMemo(() => {
    const byId = new Map<string, DownloadItem>();
    for (const it of engineItems) byId.set(it.id, it);
    for (const [id, it] of Object.entries(optimistic)) {
      if (!byId.has(id)) byId.set(id, it);
    }
    return Array.from(byId.values())
      .filter((it) => !profileId || it.profileId === profileId)
      .sort((a, b) => b.addedAt - a.addedAt);
  }, [engineItems, optimistic, profileId]);

  const download = useCallback(
    async (req: Omit<DownloadRequest, 'profileId'>) => {
      if (!allowed || !profileId) return;
      // Feedback immédiat : on affiche l'entrée « en attente » tout de suite.
      const optimisticItem: DownloadItem = {
        ...req,
        profileId,
        status: 'queued',
        bytesDownloaded: 0,
        bytesTotal: req.bytesTotal ?? 0,
        addedAt: Date.now(),
      };
      setOptimistic((prev) => ({ ...prev, [req.id]: optimisticItem }));
      try {
        await downloadEngine.enqueue({ ...req, profileId });
      } catch (e) {
        // Échec d'enqueue (ex. plugin natif absent) → on le rend visible.
        console.warn('[downloads] enqueue échoué', e);
        setOptimistic((prev) => ({
          ...prev,
          [req.id]: {
            ...optimisticItem,
            status: 'error',
            error: e instanceof Error ? e.message : String(e),
          },
        }));
      }
    },
    [allowed, profileId],
  );

  // Retire aussi l'éventuel optimiste (annulation avant confirmation moteur).
  const dropOptimistic = useCallback((id: string) => {
    setOptimistic((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const pause = useCallback((id: string) => void downloadEngine.pause(id), []);
  const resume = useCallback((id: string) => void downloadEngine.resume(id), []);
  const cancel = useCallback(
    (id: string) => {
      dropOptimistic(id);
      void downloadEngine.cancel(id);
    },
    [dropOptimistic],
  );
  const remove = useCallback(
    (id: string) => {
      dropOptimistic(id);
      void downloadEngine.remove(id);
    },
    [dropOptimistic],
  );

  const byId = useCallback((id: string) => items.find((it) => it.id === id), [items]);

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
