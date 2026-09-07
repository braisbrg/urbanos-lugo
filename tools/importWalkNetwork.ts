/**
 * Every way in Lugo you can walk along, from OpenStreetMap.
 *
 * The app has never had a pedestrian network. Walking times are a straight line inflated
 * by a calibrated detour factor, which cannot know about the muralla, the Miño or the
 * railway — and the "walk the whole way" option is ranked against bus options whose times
 * come from the operator's timetable, so a bad estimate does not just print a wrong
 * number, it can tell you walking is the best way when it is not.
 *
 * The alternative in use until now was asking a third party at request time, which sends
 * the reader's own coordinates off the device. With the network in the bundle, neither is
 * necessary: the answer is computed on the phone, offline, and nothing leaves it.
 *
 * Writes data/osm-walk-network.json; `tools/buildWalkGraph.ts` turns that into the graph
 * that ships. Network, cached, and run by hand:
 *   pnpm run data:walk
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BBOX, overpass } from './osm';

const RAW = 'data';
const CACHE = '.cache/walk-network-osm.json';

/**
 * What counts as walkable, and what does not.
 *
 * `motorway` and `trunk` are excluded outright: the N-VI through Nadela carries stops, so
 * the bus network touches roads nobody should be sent along on foot. Everything else in
 * the list is a way a person can legally and sensibly walk, including `steps`, which the
 * graph keeps flagged because they cost more and rule out anyone on wheels.
 *
 * `track` is in because the rural parishes — Bóveda, Muxa, Nadela — are served by lines
 * 11 and 12 and their footways are tracks or nothing at all.
 */
const WALKABLE = [
  'footway',
  'path',
  'pedestrian',
  'steps',
  'living_street',
  'residential',
  'service',
  'unclassified',
  'tertiary',
  'tertiary_link',
  'secondary',
  'secondary_link',
  'primary',
  'primary_link',
  'track',
  'cycleway',
  'road',
];

const QUERY = `[out:json][timeout:300];
way["highway"~"^(${WALKABLE.join('|')})$"](${BBOX});
out geom;`;

interface RawWay {
  id: number;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

/**
 * Whether a way is closed to people on foot.
 *
 * Tag order matters: an explicit `foot=yes` on a private service road is the owner saying
 * you may walk it, and it beats the `access` tag it sits next to. Getting this backwards
 * would route people through car parks and building yards.
 */
function closedToWalkers(tags: Record<string, string>): boolean {
  const foot = tags.foot;
  if (foot === 'no') return true;
  if (foot === 'yes' || foot === 'designated' || foot === 'permissive' || foot === 'official') return false;
  const access = tags.access;
  return access === 'no' || access === 'private';
}

async function main() {
  mkdirSync(dirname(CACHE), { recursive: true });
  let ways: RawWay[];

  if (existsSync(CACHE)) {
    ways = JSON.parse(readFileSync(CACHE, 'utf8'));
    console.log(`${ways.length} ways read from ${CACHE} — delete it to ask Overpass again.`);
  } else {
    console.log('Asking Overpass for the walkable network. This is one large query.');
    const json = await overpass(QUERY);
    if (!json?.elements) {
      console.error('Overpass returned nothing. Nothing written.');
      process.exit(1);
    }
    ways = json.elements as RawWay[];
    writeFileSync(CACHE, JSON.stringify(ways));
    console.log(`${ways.length} ways, cached to ${CACHE}.`);
  }

  const kept: {
    id: number;
    nodes: number[];
    geometry: [number, number][];
    steps: boolean;
    name?: string;
  }[] = [];

  let dropped = 0;
  let areas = 0;
  for (const way of ways) {
    const tags = way.tags ?? {};
    if (closedToWalkers(tags)) {
      dropped++;
      continue;
    }
    // A pedestrian square is drawn as a closed area, and routing across the middle of one
    // needs a mesh rather than a line. Its edges are still walkable and still in the
    // graph, so a square is skirted rather than crossed. Worth revisiting if it ever
    // shows: the Praza Maior is the obvious case.
    if (tags.area === 'yes') {
      areas++;
      continue;
    }
    if (!way.nodes?.length || way.nodes.length !== way.geometry?.length) continue;

    kept.push({
      id: way.id,
      nodes: way.nodes,
      geometry: way.geometry.map((p) => [p.lat, p.lon] as [number, number]),
      steps: tags.highway === 'steps',
      name: tags.name,
    });
  }

  const nodeCount = kept.reduce((n, w) => n + w.nodes.length, 0);
  const stepWays = kept.filter((w) => w.steps).length;

  console.log(`\n  ${kept.length} walkable ways, ${nodeCount} node references`);
  console.log(`  ${stepWays} of them are steps`);
  console.log(`  ${dropped} dropped as closed to walkers, ${areas} skipped as areas`);

  mkdirSync(RAW, { recursive: true });
  writeFileSync(join(RAW, 'osm-walk-network.json'), JSON.stringify(kept) + '\n');
  console.log(`\nWrote ${join(RAW, 'osm-walk-network.json')}.`);
}

main();
