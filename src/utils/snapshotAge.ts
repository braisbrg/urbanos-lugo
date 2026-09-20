/**
 * When a committed snapshot stops being evidence about now. The notices snapshot is
 * refreshed hourly; six hours is well past that, so it only reads as stale when the
 * refresh has actually stopped — and a stale snapshot must not keep asserting, in the
 * present tense, that the network is running normally.
 */
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/** True when a snapshot is too old to speak for the present, or its date makes no sense. */
export function isSnapshotStale(fetchedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!fetchedAt) return false; // a live answer, not a snapshot
  const taken = Date.parse(fetchedAt);
  return Number.isNaN(taken) || now.getTime() - taken > STALE_AFTER_MS;
}
