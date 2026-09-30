import { useEffect, useRef, useState } from 'react';

/**
 * The wall clock, re-read every `everyMs`. Minutes on a board drift against it and buses
 * move along their timetable; nothing is fetched, so there is no "last updated".
 *
 * `null` stops it: the map stays mounted behind `hidden` once opened, and its three-second
 * clock went on recomputing every scheduled bus for the length of a ride, screen held awake.
 * Started again, it reads the time at once rather than showing a stale one for a tick.
 */
export function useClock(everyMs: number | null): Date {
  const [now, setNow] = useState(() => new Date());
  const paused = useRef(false);
  useEffect(() => {
    if (everyMs === null) {
      paused.current = true;
      return;
    }
    if (paused.current) {
      paused.current = false;
      setNow(new Date());
    }
    const timer = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
