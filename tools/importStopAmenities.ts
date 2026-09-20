/**
 * Stop amenities (shelter, bench, tactile paving) from OpenStreetMap, which has surveyed
 * these poles while the operator publishes neither; anything unsurveyed stays `null`.
 * `npx tsx tools/importStopAmenities.ts` writes data/stop-amenities.json for buildDataset.ts.
 */
import stops from '../src/data/stops.json';
import { getDistanceMeters as haversine } from '../src/utils/geo';
import { at, cached, fold, writeJson } from './lib';

const CACHE = at('.cache', 'osm-stops.json');
/** Same pole, allowing for survey imprecision on either side. */
const MATCH_RADIUS_M = 45;
/** Past this, a same-named pole is not "the other side of the road": one of the two is wrong. */
const DISAGREE_M = 300;

const yesNo = (value: string | undefined): boolean | null => (value === undefined ? null : value !== 'no');

const fetchOsmStops = (): Promise<any[]> =>
  cached(CACHE, async () => {
    const query = '[out:json][timeout:90];node(42.90,-7.70,43.10,-7.40)[highway=bus_stop];out body;';
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'UrbanosLugoOpenData/1.0' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    return ((await res.json()) as any).elements;
  });

/** The node closest to the stop (the first one on a tie), `null` at Infinity when there is none. */
function nearest(nodes: any[], stop: { lat: number; lng: number }): { node: any; d: number } {
  let best = { node: null as any, d: Infinity };
  for (const node of nodes) {
    const d = haversine(stop.lat, stop.lng, node.lat, node.lon);
    if (d < best.d) best = { node, d };
  }
  return best;
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

  for (const stop of stops as any[]) {
    // OSM names poles as the operator prints them, so the name survives a wrong pin. A same-named
    // pole far from the pin is recorded, not applied: buildDataset.ts decides when the pin is wrong.
    const name = fold(stop.name);
    const named = nearest(osm.filter((node) => fold(node.tags?.name || '') === name), stop);
    const far = named.node && named.d > DISAGREE_M ? named.node : null;
    let best = far;
    if (far) disagree++;
    else {
      const near = nearest(osm, stop);
      if (near.d > MATCH_RADIUS_M) continue;
      best = near.node;
    }

    matched++;
    const tags = best.tags || {};
    amenities[stop.id] = {
      shelter: yesNo(tags.shelter),
      bench: yesNo(tags.bench),
      tactilePaving: yesNo(tags.tactile_paving),
      ...(far ? { position: [far.lat, far.lon] as [number, number], osmNode: far.id } : {}),
    };
  }

  writeJson(at('data', 'stop-amenities.json'), amenities);

  const count = (key: 'shelter' | 'tactilePaving') => Object.values(amenities).filter((a) => a[key] === true).length;
  console.log(`matched ${matched}/${(stops as any[]).length} stops within ${MATCH_RADIUS_M} m`);
  console.log(`  same-named pole more than ${DISAGREE_M} m from the operator's pin: ${disagree}`);
  console.log(`  with a shelter        : ${count('shelter')}`);
  console.log(`  with tactile paving   : ${count('tactilePaving')}`);
  console.log(`  unsurveyed stay null and the UI says nothing about them`);
}

main();
