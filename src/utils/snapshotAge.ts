/**
 * When a committed snapshot stops being evidence about now. The notices snapshot is
 * refreshed by a schedule that says hourly and that GitHub runs when it can: four times a
 * day on 7 and 8 October 2026, with gaps of up to eight hours, so at six the copy went
 * stale between two good runs. Twelve hours is past every gap measured, so it only reads as
 * stale when the refresh has actually stopped — and a stale snapshot must not keep
 * asserting, in the present tense, that the network is running normally.
 */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/** True when a snapshot is too old to speak for the present, or its date makes no sense. */
export function isSnapshotStale(fetchedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!fetchedAt) return false; // a live answer, not a snapshot
  const taken = Date.parse(fetchedAt);
  return Number.isNaN(taken) || now.getTime() - taken > STALE_AFTER_MS;
}
