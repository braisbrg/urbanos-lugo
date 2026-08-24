import { useCallback, useState } from 'react';

const KEY = 'urbanos-lugo-recent-stops';

/** Enough to cover a commute and its variations, short enough to stay scannable. */
const LIMIT = 6;

/**
 * The last handful of stops you actually opened, most recent first.
 *
 * Saving a stop is a deliberate act and most people never do it; looking one up is what
 * everybody does. Keeping that history turns the second visit to a stop into no typing
 * at all, which is the single thing iTranvías does that this app was missing.
 *
 * Ids only — no timestamps and no counts. The list is here to save typing, not to build
 * a record of where somebody has been, and a stop id is meaningless without the dataset
 * it indexes into.
 */
export function useRecentStops(): [string[], (stopId: string) => void, () => void] {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]');
      return Array.isArray(stored) ? stored.filter((x) => typeof x === 'string').slice(0, LIMIT) : [];
    } catch {
      // A corrupt or absent entry is not worth an error path: start empty.
      return [];
    }
  });

  const remember = useCallback((stopId: string) => {
    setIds((prev) => {
      const next = [stopId, ...prev.filter((id) => id !== stopId)].slice(0, LIMIT);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private mode and full quotas both throw here; the list is a convenience, so
        // losing it between sessions is better than breaking the tap that caused it.
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setIds([]);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* see above */
    }
  }, []);

  return [ids, remember, clear];
}
