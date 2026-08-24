/**
 * Adds real stop amenities (shelter, bench, tactile paving) from OpenStreetMap.
 *
 *   npx tsx tools/importStopAmenities.ts
 *
 * The dataset previously marked every stop `wheelchair: true, shelter: false` because
 * the operator publishes neither. OSM contributors have surveyed these poles, so the
 * honest options were to drop the fields or to source them — this sources them, and
 * leaves anything unsurveyed as `null` rather than guessing.
 *
 * Writes src/data/stop-amenities.json, which buildDataset.ts merges in.
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import stops from '../src/data/stops.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '../src/data');
const CACHE = join(HERE, '../.cache/osm-stops.json');

/** Same pole, allowing for survey imprecision on either side. */
const MATCH_RADIUS_M = 45;

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371e3;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLng - aLng) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

const yesNo = (value: string | undefined): boolean | null =>
  value === undefined ? null : value !== 'no';

async function fetchOsmStops(): Promise<any[]> {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'));

  const query = '[out:json][timeout:90];node(42.90,-7.70,43.10,-7.40)[highway=bus_stop];out body;';
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'UrbanosLugoOpenData/1.0',
    },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const json: any = await res.json();
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(json.elements));
  return json.elements;
}

async function main() {
  const osm = await fetchOsmStops();
  console.log(`OSM bus stops in the Lugo box: ${osm.length}`);

  const amenities: Record<string, { shelter: boolean | null; bench: boolean | null; tactilePaving: boolean | null }> = {};
  let matched = 0;

  for (const stop of stops as any[]) {
    let best: any = null;
    let bestD = Infinity;
    for (const node of osm) {
      const d = haversine(stop.lat, stop.lng, node.lat, node.lon);
      if (d < bestD) {
        bestD = d;
        best = node;
      }
    }
    if (!best || bestD > MATCH_RADIUS_M) continue;

    matched++;
    const tags = best.tags || {};
    amenities[stop.id] = {
      shelter: yesNo(tags.shelter),
      bench: yesNo(tags.bench),
      tactilePaving: yesNo(tags.tactile_paving),
    };
  }

  writeFileSync(join(DATA, 'stop-amenities.json'), JSON.stringify(amenities, null, 2) + '\n');

  const withShelter = Object.values(amenities).filter((a) => a.shelter === true).length;
  const withTactile = Object.values(amenities).filter((a) => a.tactilePaving === true).length;
  console.log(`matched ${matched}/${(stops as any[]).length} stops within ${MATCH_RADIUS_M} m`);
  console.log(`  with a shelter        : ${withShelter}`);
  console.log(`  with tactile paving   : ${withTactile}`);
  console.log(`  unsurveyed stay null and the UI says nothing about them`);
}

main();
