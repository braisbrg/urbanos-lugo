/**
 * When a committed snapshot stops being evidence about now.
 *
 * On static hosting there is no server to ask, so the service notices always come from
 * the snapshot a scheduled job commits hourly. While that job runs, the snapshot is
 * minutes old and quoting it is fair. If it stops — or the reader is offline on a build
 * cached days ago — the same snapshot keeps asserting that the network is running
 * normally, in the present tense, long after anyone checked.
 *
 * Six hours is well past the hourly refresh, so a snapshot only reads as stale when the
 * refresh has actually stopped.
 */
export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** True when a snapshot is too old to speak for the present, or its date makes no sense. */
export function isSnapshotStale(fetchedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!fetchedAt) return false; // a live answer, not a snapshot
  const taken = Date.parse(fetchedAt);
  if (Number.isNaN(taken)) return true; // an unreadable date is not a fresh one
  return now.getTime() - taken > STALE_AFTER_MS;
}
