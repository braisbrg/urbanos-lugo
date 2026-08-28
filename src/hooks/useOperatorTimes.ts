import { useEffect, useState } from 'react';
import type { OperatorTimes } from '../services/operatorTimes';

/**
 * What the operator says is coming at this stop, when there is a server to ask.
 *
 * The operator sends no CORS header, so the browser cannot read their page itself; this
 * goes through our own `/api/paradas/:code/agora`. On the static build there is no such
 * endpoint, the request 404s, and this quietly returns nothing — the app then shows only
 * its own estimates, which is what it has always shown.
 *
 * Nothing here is called measured. It is what the operator says, and the view says so.
 */
export function useOperatorTimes(code: string | undefined): OperatorTimes | null {
  const [times, setTimes] = useState<OperatorTimes | null>(null);

  useEffect(() => {
    if (!code) {
      setTimes(null);
      return;
    }

    // A stop change must not leave the previous stop's minutes on screen for a moment.
    setTimes(null);
    let current = true;

    const ask = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/paradas/${encodeURIComponent(code)}/agora`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as OperatorTimes;
        if (current) setTimes(data);
      } catch {
        // No server, or the operator could not be read. Either way there is nothing to
        // show, and an empty list would be a claim that nothing is coming.
        if (current) setTimes(null);
      }
    };

    ask();
    // Their own page refreshes on this cadence; the server caches for twenty seconds, so
    // this costs one outbound request a minute at most however many people are looking.
    const timer = setInterval(ask, 30_000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [code]);

  return times;
}
