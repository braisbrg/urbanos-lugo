import { BUS_LINES } from '../src/data/transitData';
import { at, readJson } from './lib';

/**
 * Put the street geometry onto the lines, the way the browser does.
 *
 * The app loads `route-geometry.json` as a lazy chunk; Node does not, so a tool that just
 * imports BUS_LINES gets directions with no `pathCoordinates` — and a geometry check
 * against an empty dataset passes without testing anything.
 */
export function hydrateGeometry(): void {
  const geometry = readJson<Record<string, { path: [number, number][]; stopPathIndex: number[] }>>(
    at('src/data/route-geometry.json'),
  );
  for (const line of BUS_LINES) {
    for (const direction of line.directions) {
      const entry = geometry[`${line.id}|${direction.id}`];
      if (!entry) continue;
      direction.pathCoordinates = entry.path;
      direction.stopPathIndex = entry.stopPathIndex;
    }
  }
}
