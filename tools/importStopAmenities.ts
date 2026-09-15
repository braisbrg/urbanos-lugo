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
import { getDistanceMeters as haversine } from '../src/utils/geo';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '../src/data');
/** Build inputs, outside src/ because the application never imports them. */
const RAW = join(HERE, '../data');
const CACHE = join(HERE, '../.cache/osm-stops.json');

/** Same pole, allowing for survey imprecision on either side. */
const MATCH_RADIUS_M = 45;
/** Past this, a same-named pole is not "the other side of the road": one of the two is wrong. */
const DISAGREE_M = 300;

const yesNo = (value: string | undefined): boolean | null =>
  value === undefined ? null : value !== 'no';
/** Names compared without accents, case or doubled spaces: OSM and the operator differ in all three. */
const normalise = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

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

  const amenities: Record<
    string,
    { shelter: boolean | null; bench: boolean | null; tactilePaving: boolean | null; position?: [number, number]; osmNode?: number }
  > = {};
  let matched = 0;
  let disagree = 0;

  // OSM names its poles the way the operator prints them, so a name is a second way to
  // find the same pole -- and the one that survives a wrong pin.
  const sameName = (name: string) => osm.filter((node) => normalise(node.tags?.name || '') === normalise(name));

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

    // The surveyed pole under this exact name, when it is nowhere near the operator's
    // pin. Recorded, not applied: buildDataset.ts takes it only when the pin also
    // duplicates a neighbouring stop's, which is what a mis-entered coordinate looks
    // like. One stop as of September 2026, 1.1 km out.
    const named = sameName(stop.name)
      .map((node) => ({ node, d: haversine(stop.lat, stop.lng, node.lat, node.lon) }))
      .sort((a, b) => a.d - b.d)[0];
    const far = named && named.d > DISAGREE_M ? named.node : null;
    if (far) {
      disagree++;
      best = far; // and its amenities are that pole's, not the neighbour's
    } else if (!best || bestD > MATCH_RADIUS_M) continue;

    matched++;
    const tags = best.tags || {};
    amenities[stop.id] = {
      shelter: yesNo(tags.shelter),
      bench: yesNo(tags.bench),
      tactilePaving: yesNo(tags.tactile_paving),
      ...(far ? { position: [far.lat, far.lon] as [number, number], osmNode: far.id } : {}),
    };
  }

  writeFileSync(join(RAW, 'stop-amenities.json'), JSON.stringify(amenities, null, 2) + '\n');

  const withShelter = Object.values(amenities).filter((a) => a.shelter === true).length;
  const withTactile = Object.values(amenities).filter((a) => a.tactilePaving === true).length;
  console.log(`matched ${matched}/${(stops as any[]).length} stops within ${MATCH_RADIUS_M} m`);
  console.log(`  same-named pole more than ${DISAGREE_M} m from the operator's pin: ${disagree}`);
  console.log(`  with a shelter        : ${withShelter}`);
  console.log(`  with tactile paving   : ${withTactile}`);
  console.log(`  unsurveyed stay null and the UI says nothing about them`);
}

main();
