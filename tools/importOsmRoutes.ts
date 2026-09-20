/**
 * The real itineraries, as mapped in OpenStreetMap (`npm run data:osm`), written to
 * data/osm-routes.json. OSRM answers "fastest way a car could go", which is not where the
 * bus goes; an OSM route relation is a survey of that, so it wins where one exists.
 */
import { at, writeJson } from './lib';
import { ROUTE_QUERY, fetchWayTags, overpass, restrictedMeters, stitch } from './osm';

async function main() {
  console.log('Asking Overpass for the mapped bus routes...');
  const json = await overpass(ROUTE_QUERY);
  if (!json) throw new Error('Overpass would not answer; nothing written.');

  // `out geom` on a relation gives shapes, not tags, and without tags a route drawn down
  // a footpath goes unnoticed.
  const wayTags = await fetchWayTags();
  if (!wayTags.size) throw new Error('No way tags came back; access would go unchecked, so nothing written.');

  const routes = json.elements
    .map((relation: any) => ({
      ref: relation.tags?.ref ?? '',
      name: relation.tags?.name ?? '',
      from: relation.tags?.from ?? '',
      to: relation.tags?.to ?? '',
      // A relation says where the bus goes; the streets' access tags are a separate survey,
      // and where they disagree open data cannot say who is right, so measure, don't judge.
      restrictedMeters: restrictedMeters(relation.members || [], wayTags),
      // 5 decimals is ~1 m, the precision the drawn polylines ship at.
      path: stitch(relation.members || []).map(([lat, lng]) => [Number(lat.toFixed(5)), Number(lng.toFixed(5))]),
    }))
    .filter((r: any) => r.ref && r.path.length > 10);

  writeJson(at('data', 'osm-routes.json'), routes, false);

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
