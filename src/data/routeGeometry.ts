/**
 * Road geometry for every line direction, fetched only when a map needs it.
 *
 * It is 478 KB — about eleven times the rest of the line data — and nothing outside the
 * map views reads it, so bundling it made every visitor download the whole street
 * network just to look up a departure time.
 *
 * Once loaded it is written back onto BUS_LINES so the existing `dir.pathCoordinates`
 * accesses keep working. That is a deliberate one-time hydration, not shared mutable
 * state: the values never change afterwards.
 */
import { useEffect, useState } from 'react';
import { BUS_LINES } from './transitData';

type RawGeometry = Record<string, { path: [number, number][]; stopPathIndex: number[] }>;

let loaded = false;
let inFlight: Promise<void> | null = null;

function loadRouteGeometry(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!inFlight) {
    inFlight = import('./route-geometry.json')
      .then((module) => {
        const geometry = (module.default ?? module) as unknown as RawGeometry;
        for (const line of BUS_LINES) {
          for (const direction of line.directions) {
            const entry = geometry[`${line.id}|${direction.id}`];
            if (!entry) continue;
            direction.pathCoordinates = entry.path;
            direction.stopPathIndex = entry.stopPathIndex;
          }
        }
        loaded = true;
      })
      .catch((err) => {
        // The app still works without it: stop lists, timetables and arrival boards do
        // not touch geometry, and buses fall back to their next stop's position.
        console.error('Route geometry could not be loaded; maps will draw straight lines.', err);
        loaded = true;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** True once the geometry is in memory. Components render their layers on the flip. */
export function useRouteGeometry(): boolean {
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    if (ready) return;
    let active = true;
    loadRouteGeometry().then(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, [ready]);
  return ready;
}
