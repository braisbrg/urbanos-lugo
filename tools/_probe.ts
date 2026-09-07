/**
 * Which ways, exactly, does OSM say a bus may not use?
 *
 * checkOsmGeometry reports the total per route -- "9 route(s) still run on ways closed to
 * buses" -- which is enough to notice a change and not enough to decide anything. Four of
 * those nine share the same two lengths to the metre (230 m and 385 m on lines 7, 8, 9 and
 * 12), which says they are the same streets seen from four itineraries rather than nine
 * separate problems. This names them, so the question "is the route wrong or is the tagging
 * wrong" can be answered about a street instead of about a number.
 *
 * One pair of Overpass requests, run by hand. See the network block in CLAUDE.md.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ROUTE_QUERY, closedToBuses, fetchWayTags, overpass } from './osm';
import { getDistanceMeters } from '../src/utils/geo';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '../data');
const committed: { ref: string; name: string; restrictedMeters: number }[] = JSON.parse(
  readFileSync(join(RAW, 'osm-routes.json'), 'utf8'),
);

const carrying = new Set(committed.filter((r) => r.restrictedMeters > 0).map((r) => `${r.ref} ${r.name}`));

const json = await overpass(ROUTE_QUERY);
if (!json) {
  console.log('Overpass would not answer. Nothing checked, nothing claimed.');
  process.exit(0);
}
const wayTags = await fetchWayTags();
if (!wayTags.size) {
  console.log('No way tags came back. Nothing checked, nothing claimed.');
  process.exit(0);
}

/** way id -> { metres, the routes that use it } */
const offenders = new Map<number, { metres: number; tags: Record<string, string>; routes: Set<string> }>();

for (const relation of json.elements ?? []) {
  const ref = relation.tags?.ref ?? '';
  const name = relation.tags?.name ?? '';
  if (!ref || !carrying.has(`${ref} ${name}`)) continue;

  for (const member of relation.members ?? []) {
    if (member.type !== 'way' || !member.geometry) continue;
    const tags = wayTags.get(member.ref);
    if (!tags || !closedToBuses(tags)) continue;

    let metres = 0;
    for (let i = 1; i < member.geometry.length; i++) {
      metres += getDistanceMeters(
        member.geometry[i - 1].lat,
        member.geometry[i - 1].lon,
        member.geometry[i].lat,
        member.geometry[i].lon,
      );
    }
    const found = offenders.get(member.ref) ?? { metres: 0, tags, routes: new Set<string>() };
    found.metres = Math.round(metres);
    found.routes.add(`${ref} ${name.slice(0, 34)}`);
    offenders.set(member.ref, found);
  }
}

console.log(`${offenders.size} distinct way(s) carry the ${carrying.size} flagged route(s)\n`);
for (const [id, o] of [...offenders].sort((a, b) => b[1].metres - a[1].metres)) {
  const relevant = ['highway', 'access', 'motor_vehicle', 'bus', 'psv', 'name', 'oneway']
    .filter((k) => o.tags[k] !== undefined)
    .map((k) => `${k}=${o.tags[k]}`)
    .join('  ');
  console.log(`  way ${id}   ${String(o.metres).padStart(4)} m   ${relevant}`);
  console.log(`      used by: ${[...o.routes].join(' | ')}`);
  console.log(`      https://www.openstreetmap.org/way/${id}`);
}
