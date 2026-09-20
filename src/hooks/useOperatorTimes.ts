import { useEffect, useState } from 'react';
import type { OperatorTimes } from '../services/operatorTimes';
import { apiUrl } from '../services/apiUrl';

/**
 * What the operator says is coming at this stop, when there is a server to ask (the
 * operator sends no CORS header). On the static build the request 404s and this returns
 * nothing; the app then shows only its own estimates, as it always has.
 */
export function useOperatorTimes(code: string | undefined): OperatorTimes | null {
  const [times, setTimes] = useState<OperatorTimes | null>(null);

  useEffect(() => {
    setTimes(null); // a stop change must not leave the previous stop's minutes on screen
    if (!code) return;
    let current = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const ask = async () => {
      try {
        // Twelve seconds: past the server's own eight-second cap, and under the interval below
        // so a stalled connection cannot stack requests. Optional: AbortSignal.timeout is Safari 16.
        const res = await fetch(apiUrl(`paradas/${encodeURIComponent(code)}/agora`), { signal: AbortSignal.timeout?.(12_000) });
        // A 404 is permanent (static build, or a stop with no code on their site); a 502 is the operator being unreadable now.
        if (res.status === 404) clearInterval(timer);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as OperatorTimes;
        if (current) setTimes(data);
      } catch {
        if (current) setTimes(null);
      }
    };

    ask();
    // Their own page refreshes on this cadence; the server caches for twenty seconds.
    timer = setInterval(ask, 30_000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [code]);

  return times;
}
