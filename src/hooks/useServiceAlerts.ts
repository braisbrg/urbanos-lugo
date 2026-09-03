import { useCallback, useEffect, useState } from 'react';
import type { AlertSyncResult } from '../services/alertSyncService';
import alertSnapshot from '../data/alerts.json';
import { isSnapshotStale } from '../utils/snapshotAge';
import { apiUrl } from '../services/apiUrl';

/**
 * The operator's notices, fetched once for the whole app.
 *
 * There used to be two answers to "are there any incidents". The badge in the navigation
 * counted the snapshot compiled into the bundle; the Avisos screen fetched `/api/alerts`
 * from the server and showed that. On a static host the two agree by accident — there is
 * no API, the fetch fails, and both fall back to the same file. Anywhere the server is
 * actually running they are a build-time file and a live request, and they disagree: the
 * bar said one incident while the page underneath said the network was running normally.
 *
 * One fetch, one state, both readers. A disagreement between the two is now impossible
 * rather than unlikely.
 */

const COOLDOWN_SECONDS = 30;

/**
 * The committed snapshot, narrowed rather than asserted.
 *
 * A JSON import widens `status` to `string`, and a cast would swallow a genuinely
 * malformed file just as happily as a well-formed one. One check at the one boundary.
 */
function readSnapshot(raw: typeof alertSnapshot): AlertSyncResult {
  return {
    ...raw,
    status:
      raw.status === 'active_incidents'
        ? 'active_incidents'
        : raw.status === 'unreachable'
          ? 'unreachable'
          : 'operational_normal',
    alerts: (raw.alerts ?? []) as AlertSyncResult['alerts'],
  };
}

export interface ServiceAlerts {
  data: AlertSyncResult | null;
  /** Set when the notices came from the committed snapshot rather than from the server. */
  snapshotAt: string | null;
  isSyncing: boolean;
  cooldown: number;
  /**
   * What the navigation badge shows.
   *
   * The night closure is not an incident — the banner already says that in a sentence —
   * and a snapshot too old to speak for the present does not get to claim there are none
   * either, so it counts nothing at all.
   */
  announcedIncidents: number;
  refresh: (force?: boolean) => void;
}

export function useServiceAlerts(): ServiceAlerts {
  const [data, setData] = useState<AlertSyncResult | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const refresh = useCallback(
    async (force = false) => {
      if (force && (cooldown > 0 || isSyncing)) return;
      setIsSyncing(true);
      try {
        // Only a server can reach buslugo.com; the browser is blocked by CORS.
        //
        // With a deadline, because `?refresh=true` makes the server go and read three
        // council feeds and the operator's home page, and a slow upstream is exactly the
        // day somebody presses the button. Without one the spinner turns for as long as
        // the browser's own patience, which is minutes. Thirty seconds is past the
        // server's honest worst case -- 6 s for buslugo plus 15 s for the feeds, which
        // run together -- so a legitimate slow sync still lands, and anything longer
        // falls into the catch below and shows the committed snapshot with its date.
        // Optional call on purpose: AbortSignal.timeout is Safari 16, and this app carries
        // an sRGB fallback so it still works on Safari 15.4. Calling it outright would
        // throw there, be swallowed by the catch below, and quietly show the snapshot for
        // ever. Undefined is a fine signal -- it means what it meant before this line.
        const res = await fetch(apiUrl(`alerts${force ? '?refresh=true' : ''}`), {
          signal: AbortSignal.timeout?.(30_000),
        });
        if (!res.ok) throw new Error(String(res.status));
        setData(await res.json());
        setSnapshotAt(null);
      } catch {
        // No server (static hosting) or it is down: use the snapshot a scheduled job
        // committed, and say when it was taken rather than passing it off as live.
        setData(readSnapshot(alertSnapshot));
        setSnapshotAt(alertSnapshot.fetchedAt ?? null);
      } finally {
        if (force) setCooldown(COOLDOWN_SECONDS);
        setIsSyncing(false);
      }
    },
    [cooldown, isSyncing],
  );

  useEffect(() => {
    refresh(false);
    // Once, on mount. Later refreshes are the reader asking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((prev) => (prev <= 1 ? 0 : prev - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Before the first response there is nothing to count, and the compiled-in snapshot is
  // not an answer yet: claiming zero incidents at that moment would be a claim, not a
  // silence.
  //
  // Only the operator's own notices count. The council's feeds are press releases about
  // the city that sometimes mention the buses; a badge on the navigation says "something
  // is wrong with your journey", and a story about resurfacing works does not say that.
  const announcedIncidents =
    data && !isSnapshotStale(snapshotAt)
      ? data.alerts.filter((a) => a.source !== 'concello').length
      : 0;

  return { data, snapshotAt, isSyncing, cooldown, announcedIncidents, refresh };
}
