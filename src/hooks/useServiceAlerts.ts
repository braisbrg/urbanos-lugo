import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AlertSyncResult } from '../services/alertSyncService';
import type { ServiceAlert } from '../types';
import { isSnapshotStale } from '../utils/snapshotAge';
import { readNotice } from '../utils/operatorNotices';
import { noticeOver } from '../utils/noticeChanges';
import { apiUrl } from '../services/apiUrl';

/**
 * The operator's notices, fetched once for the whole app, so the navigation badge and the
 * Avisos screen cannot disagree (they did: a build-time file against a live request).
 */

const COOLDOWN_SECONDS = 30;
/** How long an unanswered first request keeps the screen empty before the snapshot shows. */
export const SNAPSHOT_AFTER_MS = 2000;

/** What public/alerts.json holds: the sync result plus the time the job took it. */
type Snapshot = AlertSyncResult & { fetchedAt?: string };

/**
 * An answer about notices, the snapshot's or the server's, narrowed at the one boundary
 * rather than cast: parsed JSON says nothing about its shape, and each notice goes through
 * readNotice. Only the snapshot was read this way; the live answer went to the screen as sent.
 */
export function readSnapshot(raw: unknown): Snapshot {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    lastSyncTime: text(r.lastSyncTime),
    sourceUrl: text(r.sourceUrl),
    message: text(r.message),
    fetchedAt: typeof r.fetchedAt === 'string' ? r.fetchedAt : undefined,
    status: r.status === 'active_incidents' ? 'active_incidents' : r.status === 'unreachable' ? 'unreachable' : 'operational_normal',
    alerts: Array.isArray(r.alerts) ? r.alerts.map(readNotice).filter((a): a is ServiceAlert => a !== null) : [],
  };
}

/**
 * The snapshot is a file beside the page, not an import: imported, the scheduled job that
 * rewrites it renamed the entry chunk and five more, half a megabyte gzipped, under pages
 * that were open. As a file it is one 1.4 KB request, precached so it answers offline.
 * Fetched once per page and remembered, including its failure: unreadable reads as
 * `unreachable`, which is the honest status when nothing could be read.
 */
let snapshot: Promise<Snapshot> | null = null;
function loadSnapshot(): Promise<Snapshot> {
  snapshot ??= fetch(`${import.meta.env.BASE_URL}alerts.json`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then(readSnapshot)
    .catch(() => readSnapshot({ status: 'unreachable' }));
  return snapshot;
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

export function useServiceAlerts(now: Date): ServiceAlerts {
  const [data, setData] = useState<AlertSyncResult | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const answered = useRef(false);

  const showSnapshot = async () => {
    const saved = await loadSnapshot();
    setData(saved);
    setSnapshotAt(saved.fetchedAt ?? null);
  };

  const refresh = useCallback(
    async (force = false) => {
      if (force && (cooldown > 0 || isSyncing)) return;
      setIsSyncing(true);
      try {
        // Thirty seconds is past the server's honest worst case (6 s for buslugo plus 4 s
        // for the feed). Optional call: AbortSignal.timeout is Safari 16 and the app still
        // works on 15.4, where undefined means what the line meant before it existed.
        const res = await fetch(apiUrl(`alerts${force ? '?refresh=true' : ''}`), { signal: AbortSignal.timeout?.(30_000) });
        if (!res.ok) throw new Error(String(res.status));
        setData(readSnapshot(await res.json()));
        setSnapshotAt(null);
      } catch {
        // No server (static hosting) or it is down: the dated snapshot, never passed off as live.
        await showSnapshot();
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
    const patience = setTimeout(async () => {
      if (answered.current) return;
      const saved = await loadSnapshot();
      // Checked again: the live answer may have landed while the file was being read.
      if (answered.current) return;
      setData(saved);
      setSnapshotAt(saved.fetchedAt ?? null);
    }, SNAPSHOT_AFTER_MS);
    return () => clearTimeout(patience);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((prev) => (prev <= 1 ? 0 : prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // A notice whose own days are all behind is over, however long the operator's page keeps
  // it: out of the badge, the boards, the lines, Route and Avisos alike, so the morning after
  // San Froilán the app is what it was before it.
  const current = useMemo(() => data && { ...data, alerts: data.alerts.filter((a) => !noticeOver(a, now)) }, [data, now]);

  // Only the operator's own notices count; a council press release is not "something is wrong with your journey".
  const announcedIncidents = current && !isSnapshotStale(snapshotAt) ? current.alerts.filter((a) => a.source !== 'concello').length : 0;

  return { data: current, snapshotAt, isSyncing, cooldown, announcedIncidents, refresh };
}
