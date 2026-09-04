import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUS_LINES } from '../src/data/transitData';

/**
 * Put the street geometry onto the lines, the way the browser does.
 *
 * The app loads `route-geometry.json` as its own lazy chunk, because it is far larger
 * than everything else in `src/data` put together and most screens never draw a route.
 * Node has no lazy chunk loading, so a tool that just imports BUS_LINES gets directions
 * with no `pathCoordinates` at all — and a geometry check against an empty dataset passes
 * without testing anything, which is the failure this exists to prevent.
 *
 * Shared because it was written twice, verbatim, in test.ts and fullAudit.ts. Two copies
 * of the thing that decides whether the geometry checks are real is the last place to let
 * them drift.
 */
export function hydrateGeometry(): void {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../src/data/route-geometry.json');
  const geometry = JSON.parse(readFileSync(file, 'utf8')) as Record<
    string,
    { path: [number, number][]; stopPathIndex: number[] }
  >;
  for (const line of BUS_LINES) {
    for (const direction of line.directions) {
      const entry = geometry[`${line.id}|${direction.id}`];
      if (!entry) continue;
      direction.pathCoordinates = entry.path;
      direction.stopPathIndex = entry.stopPathIndex;
    }
  }
}
