import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertSyncResult } from '../services/alertSyncService';
import alertSnapshot from '../data/alerts.json';
import { isSnapshotStale } from '../utils/snapshotAge';
import { apiUrl } from '../services/apiUrl';

/**
 * The operator's notices, fetched once for the whole app, so the navigation badge and the
 * Avisos screen cannot disagree (they did: a build-time file against a live request).
 */

const COOLDOWN_SECONDS = 30;
/** How long an unanswered first request keeps the screen empty before the snapshot shows. */
export const SNAPSHOT_AFTER_MS = 2000;

/** The committed snapshot, narrowed at the one boundary rather than cast. */
function readSnapshot(raw: typeof alertSnapshot): AlertSyncResult {
  return {
    ...raw,
    status: raw.status === 'active_incidents' ? 'active_incidents' : raw.status === 'unreachable' ? 'unreachable' : 'operational_normal',
    alerts: (raw.alerts ?? []) as AlertSyncResult['alerts'],
  };
}

export interface ServiceAlerts {
  data: AlertSyncResult | null;
  /** Set when the notices came from the committed snapshot rather than from the server. */
  snapshotAt: string | null;
  isSyncing: boolean;
  cooldown: number;
  /** What the badge shows: the operator's own notices, and nothing from a stale snapshot. */
  announcedIncidents: number;
  refresh: (force?: boolean) => void;
}

export function useServiceAlerts(): ServiceAlerts {
  const [data, setData] = useState<AlertSyncResult | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const answered = useRef(false);

  const showSnapshot = () => {
    setData(readSnapshot(alertSnapshot));
    setSnapshotAt(alertSnapshot.fetchedAt ?? null);
  };

  const refresh = useCallback(
    async (force = false) => {
      if (force && (cooldown > 0 || isSyncing)) return;
      setIsSyncing(true);
      try {
        // Thirty seconds is past the server's honest worst case (6 s for buslugo plus 15 s
        // for the feed). Optional call: AbortSignal.timeout is Safari 16 and the app still
        // works on 15.4, where undefined means what the line meant before it existed.
        const res = await fetch(apiUrl(`alerts${force ? '?refresh=true' : ''}`), { signal: AbortSignal.timeout?.(30_000) });
        if (!res.ok) throw new Error(String(res.status));
        setData(await res.json());
        setSnapshotAt(null);
      } catch {
        // No server (static hosting) or it is down: the dated snapshot, never passed off as live.
        showSnapshot();
      } finally {
        answered.current = true;
        if (force) setCooldown(COOLDOWN_SECONDS);
        setIsSyncing(false);
      }
    },
    [cooldown, isSyncing],
  );

  // A server that neither answers nor fails left an empty list, which reads as "no incidents".
  useEffect(() => {
    refresh(false);
    const patience = setTimeout(() => {
      if (!answered.current) showSnapshot();
    }, SNAPSHOT_AFTER_MS);
    return () => clearTimeout(patience);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((prev) => (prev <= 1 ? 0 : prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Only the operator's own notices count; a council press release is not "something is wrong with your journey".
  const announcedIncidents = data && !isSnapshotStale(snapshotAt) ? data.alerts.filter((a) => a.source !== 'concello').length : 0;

  return { data, snapshotAt, isSyncing, cooldown, announcedIncidents, refresh };
}
