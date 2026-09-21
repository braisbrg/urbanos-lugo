/**
 * Every way in Lugo you can walk along, from OpenStreetMap.
 *
 * With the network in the bundle the walk is computed on the phone, offline, and the
 * reader's coordinates never leave it; a straight line with a detour factor cannot know
 * about the muralla, the Miño or the railway, and can rank walking above a bus it is not.
 *
 * Writes data/osm-walk-network.json; `tools/buildWalkGraph.ts` turns that into the graph
 * that ships. Network, cached, and run by hand:
 *   pnpm run data:walk
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cached } from './lib';
import { BBOX, overpass } from './osm';

const RAW = 'data';
const CACHE = '.cache/walk-network-osm.json';

/**
 * `motorway` and `trunk` are excluded outright: the N-VI carries stops, so the bus network
 * touches roads nobody should be sent along on foot. `steps` stays, flagged, because it
 * costs more and rules out wheels; `track` is in because the rural parishes' footways are
 * tracks or nothing at all.
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

/** An explicit `foot=yes` on a private service road beats the `access` tag beside it. */
function closedToWalkers(tags: Record<string, string>): boolean {
  if (tags.foot === 'no') return true;
  if (['yes', 'designated', 'permissive', 'official'].includes(tags.foot)) return false;
  return tags.access === 'no' || tags.access === 'private';
}

async function main() {
  const fromCache = existsSync(CACHE);
  const ways = await cached<RawWay[]>(CACHE, async () => {
    console.log('Asking Overpass for the walkable network. This is one large query.');
    const json = await overpass(QUERY);
    if (!json?.elements) {
      console.error('Overpass returned nothing. Nothing written.');
      process.exit(1);
    }
    return json.elements as RawWay[];
  });
  console.log(fromCache ? `${ways.length} ways read from ${CACHE} — delete it to ask Overpass again.` : `${ways.length} ways, cached to ${CACHE}.`);

  const kept: { id: number; nodes: number[]; geometry: [number, number][]; steps: boolean; name?: string }[] = [];
  let dropped = 0;
  let areas = 0;
  for (const way of ways) {
    const tags = way.tags ?? {};
    if (closedToWalkers(tags)) {
      dropped++;
      continue;
    }
    // A pedestrian square is a closed area, and crossing the middle of one needs a mesh
    // rather than a line; its edges are still in the graph, so a square is skirted.
    if (tags.area === 'yes') {
      areas++;
      continue;
    }
    if (!way.nodes?.length || way.nodes.length !== way.geometry?.length) continue;
    kept.push({ id: way.id, nodes: way.nodes, geometry: way.geometry.map((p) => [p.lat, p.lon]), steps: tags.highway === 'steps', name: tags.name });
  }

  console.log(`\n  ${kept.length} walkable ways, ${kept.reduce((n, w) => n + w.nodes.length, 0)} node references`);
  console.log(`  ${kept.filter((w) => w.steps).length} of them are steps`);
  console.log(`  ${dropped} dropped as closed to walkers, ${areas} skipped as areas`);

  mkdirSync(RAW, { recursive: true });
  writeFileSync(join(RAW, 'osm-walk-network.json'), JSON.stringify(kept) + '\n');
  console.log(`\nWrote ${join(RAW, 'osm-walk-network.json')}.`);
}

main();
