/**
 * Road geometry for every line direction, fetched only when a map needs it: 478 KB, about
 * eleven times the rest of the line data, and nothing outside the map views reads it.
 * Once loaded it is written back onto BUS_LINES so `dir.pathCoordinates` keeps working:
 * a deliberate one-time hydration, never changed afterwards.
 */
import { useEffect, useState } from 'react';
import { BUS_LINES } from './transitData';

export type RouteGeometry = Record<string, { path: [number, number][]; stopPathIndex: number[] }>;

/** Put the street geometry onto the lines. The tools call this too, since Node loads no lazy chunk. */
export function applyRouteGeometry(geometry: RouteGeometry): void {
  for (const line of BUS_LINES) {
    for (const direction of line.directions) {
      const entry = geometry[`${line.id}|${direction.id}`];
      if (!entry) continue;
      direction.pathCoordinates = entry.path;
      direction.stopPathIndex = entry.stopPathIndex;
    }
  }
}

let loaded = false;
let inFlight: Promise<void> | null = null;

function loadRouteGeometry(): Promise<void> {
  if (loaded) return Promise.resolve();
  inFlight ??= import('./route-geometry.json')
    .then((module) => applyRouteGeometry((module.default ?? module) as unknown as RouteGeometry))
    // The app still works without it: lists, timetables and boards do not touch geometry.
    .catch((err) => console.error('Route geometry could not be loaded; maps will draw straight lines.', err))
    .finally(() => {
      loaded = true;
      inFlight = null;
    });
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
