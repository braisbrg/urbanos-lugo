/**
 * Talking to OpenStreetMap: what the importer and the weekly check both need. One
 * `stitch` rather than two, so the two answers to "how long is this route" are comparable.
 */
import { metresBetween } from '../src/utils/geo';
import { sleep } from './lib';

/** Lugo and its parishes, wide enough for the 11's runs out to Bóveda and Santa Comba. */
export const BBOX = '42.95,-7.68,43.10,-7.45';

/** Every mapped bus route of this network, with the geometry of each way member. */
export const ROUTE_QUERY = `[out:json][timeout:180];
relation["type"="route"]["route"="bus"]["network"~"Lugo"](${BBOX});
out geom;`;

/** Every way used by those relations, with its tags, for the access survey. */
const WAY_TAG_QUERY = `[out:json][timeout:180];
relation["type"="route"]["route"="bus"]["network"~"Lugo"](${BBOX})->.r;
way(r.r);
out tags geom;`;

/** Unrounded on purpose: summed along a polyline, rounded segments would not add up. */
export const distance = (a: [number, number], b: [number, number]): number => metresBetween(a[0], a[1], b[0], b[1]);

/**
 * One ordered polyline from a relation's way members. A relation lists ways in travel
 * order but each way keeps its own drawing direction, so every way is appended by
 * whichever end touches what came before.
 */
export function stitch(members: any[]): [number, number][] {
  const path: [number, number][] = [];
  for (const member of members) {
    if (member.type !== 'way' || !member.geometry) continue;
    const way: [number, number][] = member.geometry.map((p: any) => [p.lat, p.lon]);
    if (!path.length) {
      path.push(...way);
      continue;
    }
    const tail = path[path.length - 1];
    path.push(...(distance(tail, way[way.length - 1]) < distance(tail, way[0]) ? [...way].reverse() : way));
  }
  return path;
}

/** Metres along a polyline. */
export function pathMeters(path: [number, number][]): number {
  let metres = 0;
  for (let i = 1; i < path.length; i++) metres += distance(path[i - 1], path[i]);
  return metres;
}

/** Overpass is a free shared service and answers 429/504 under load; give it a second go. */
export async function overpass(query: string, attempts = 3): Promise<any | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'UrbanosLugoOpenData/1.0' },
    });
    if (res.ok) return res.json();
    if (attempt === attempts) {
      console.warn(`  ! Overpass answered ${res.status} after ${attempts} tries`);
      return null;
    }
    await sleep(attempt * 20_000);
  }
  return null;
}

/**
 * Closed to motor vehicles, with no exception for buses recorded. A relation says where a
 * mapper believes the bus goes; these tags are a different survey of the same street, and
 * where they disagree (the historic-centre terminus, and one rural track) it is measured
 * and reported rather than decided: the README has the streets and the metres, and the
 * missing `psv=yes` belongs upstream in OSM.
 */
export function closedToBuses(tags: any): boolean {
  if (['yes', 'designated'].includes(tags.bus) || ['yes', 'designated'].includes(tags.psv)) return false;
  return (
    ['pedestrian', 'footway', 'path', 'steps', 'cycleway', 'track'].includes(tags.highway) ||
    ['no', 'private'].includes(tags.access) ||
    ['no', 'private'].includes(tags.motor_vehicle)
  );
}

/** Metres of one relation that fall on ways closed to buses. */
export function restrictedMeters(members: any[], wayTags: Map<number, any>): number {
  let metres = 0;
  for (const member of members) {
    if (member.type !== 'way' || !member.geometry) continue;
    const tags = wayTags.get(member.ref);
    if (!tags || !closedToBuses(tags)) continue;
    metres += pathMeters(member.geometry.map((p: any) => [p.lat, p.lon]));
  }
  return Math.round(metres);
}

/** The way tags of every route way, keyed by way id. Empty when Overpass will not answer. */
export async function fetchWayTags(): Promise<Map<number, any>> {
  const json = await overpass(WAY_TAG_QUERY);
  return new Map((json?.elements ?? []).map((way: any) => [way.id, way.tags || {}]));
}
