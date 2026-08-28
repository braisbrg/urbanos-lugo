/**
 * The real itineraries, as mapped in OpenStreetMap.
 *
 *   npm run data:osm
 *
 * The route drawn on the map used to come from asking OSRM to drive between consecutive
 * stops. That answers "what is the fastest way a car could go", which is not the same
 * question. Two failures showed up when it was checked against OSM:
 *
 *  - Bolaño Ribadeneira sits inside the walls. A car cannot get there directly, so OSRM
 *    routed lines 8, 9 and 12 around the whole muralla: 2127 m for a hop of 372 m. The
 *    bus is allowed through and does not do that.
 *  - Where a stop list has a pole slightly out of order, OSRM dutifully drives out and
 *    back. Line 5.1's return came out 28 km long against a real 10 km.
 *
 * OSM has these lines mapped as route relations, both directions, tagged with the
 * operator. That is a survey of what the bus actually does, so it wins. OSRM stays as
 * the fallback for any direction OSM does not cover.
 *
 * What OSM does NOT settle is whether a bus is allowed somewhere. A relation is a
 * mapper's account of where the bus goes; the access tags on the streets are a separate
 * survey, and the two disagree at the historic-centre terminus of lines 7, 8, 9 and 12,
 * where the operator publishes stops on streets tagged `highway=pedestrian` with no bus
 * exception. Nothing in open data resolves that, so this measures it and says so rather
 * than picking a story. `restrictedMeters` is that number, per route.
 *
 * Writes src/data/osm-routes.json; `npm run data:build` decides which source to use.
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BBOX, ROUTE_QUERY, fetchWayTags, overpass, restrictedMeters, stitch } from './osm';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../src/data');

async function main() {
  console.log('Asking Overpass for the mapped bus routes...');
  const json = await overpass(ROUTE_QUERY);
  if (!json) throw new Error('Overpass would not answer; nothing written.');

  // Second pass for the way tags: `out geom` on a relation gives shapes, not tags, and
  // without tags there is no way to notice a route that has been drawn down a footpath.
  const wayTags = await fetchWayTags();
  if (!wayTags.size) throw new Error('No way tags came back; access would go unchecked, so nothing written.');

  const routes = json.elements
    .map((relation: any) => ({
      ref: relation.tags?.ref ?? '',
      name: relation.tags?.name ?? '',
      from: relation.tags?.from ?? '',
      to: relation.tags?.to ?? '',
      /** Metres of this route on ways closed to motor vehicles with no bus exception. */
      restrictedMeters: restrictedMeters(relation.members || [], wayTags),
      // 5 decimals is ~1 m, the same precision the drawn polylines ship at.
      path: stitch(relation.members || []).map(([lat, lng]) => [
        Number(lat.toFixed(5)),
        Number(lng.toFixed(5)),
      ]),
    }))
    .filter((r: any) => r.ref && r.path.length > 10);

  writeFileSync(join(DATA, 'osm-routes.json'), JSON.stringify(routes) + '\n');

  const byRef = new Map<string, number>();
  for (const r of routes) byRef.set(r.ref, (byRef.get(r.ref) ?? 0) + 1);
  console.log(`${routes.length} routes for ${byRef.size} line numbers`);
  console.log('  ' + [...byRef.entries()].map(([ref, n]) => `${ref}x${n}`).join('  '));

  const restricted = routes.filter((r: any) => r.restrictedMeters > 0);
  if (restricted.length) {
    console.log('');
    console.log('  Routes drawn over ways closed to motor vehicles, longest first.');
    console.log('  OSM records no bus exception on these. It may simply be untagged, or the');
    console.log('  bus may stop short — open data does not say which, so treat them as unproven:');
    for (const r of restricted.sort((a: any, b: any) => b.restrictedMeters - a.restrictedMeters)) {
      console.log(`    ${String(r.restrictedMeters).padStart(4)} m  ref ${r.ref.padEnd(5)} ${r.name.slice(0, 58)}`);
    }
  }
}

main();
