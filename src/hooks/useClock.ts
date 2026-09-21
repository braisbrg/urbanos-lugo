import { useEffect, useState } from 'react';

/**
 * The wall clock, re-read every `everyMs`. Minutes on a board drift against it and buses
 * move along their timetable; nothing is fetched, so there is no "last updated".
 */
export function useClock(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
