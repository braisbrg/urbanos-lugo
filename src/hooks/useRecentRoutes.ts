import { useCallback, useState } from 'react';

const KEY = 'urbanos-lugo-recent-routes';

/** Four fills the width of the form without pushing the fields off a phone. */
const LIMIT = 4;

interface RecentRoute {
  from: string;
  to: string;
}

/**
 * The last few trips you actually planned, most recent first.
 *
 * The same reasoning as the recent stops: the second time somebody makes a trip they
 * should not have to type it again, and a commute is by definition the trip they make
 * twice a day. The quick destinations beside this list are the same idea for everybody;
 * this one is the same idea for one person.
 *
 * Unlike the recent stops, this holds text somebody typed, and that text can be their
 * street. It never leaves the device and nothing here reads it back out — but that is a
 * promise `PRIVACY.md` makes in writing, and it lists this key for that reason.
 */
export function useRecentRoutes(): [RecentRoute[], (route: RecentRoute) => void, () => void] {
  const [routes, setRoutes] = useState<RecentRoute[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]');
      return Array.isArray(stored)
        ? stored
            .filter((r) => r && typeof r.from === 'string' && typeof r.to === 'string')
            .slice(0, LIMIT)
        : [];
    } catch {
      // A corrupt or absent entry is not worth an error path: start empty.
      return [];
    }
  });

  const remember = useCallback((route: RecentRoute) => {
    const from = route.from.trim();
    const to = route.to.trim();
    if (!from || !to) return;
    setRoutes((prev) => {
      const next = [{ from, to }, ...prev.filter((r) => r.from !== from || r.to !== to)].slice(0, LIMIT);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private mode and full quotas both throw here; the list is a convenience, so
        // losing it between sessions is better than breaking the search that caused it.
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setRoutes([]);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* see above */
    }
  }, []);

  return [routes, remember, clear];
}
