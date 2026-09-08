/**
 * Turn the walkable ways into a graph the phone can route on.
 *
 * OSM gives ways, not a graph. Two ways that share a node are connected; two that merely
 * cross on screen are not, which is the whole difference between a footbridge and a road
 * that passes underneath it. `out geom` returns the node ids alongside the coordinates
 * and index-aligned with them, so the connections are in the data and only have to be
 * read out.
 *
 * A node used by two or more ways is a junction, and so is either end of a way. Between
 * junctions the remaining nodes only describe the shape of the street, so each run is
 * collapsed into one edge that carries its length and its polyline: the router walks
 * junctions, the map draws polylines, and neither pays for the other.
 *
 * Offline and fast. Reads data/osm-walk-network.json, writes src/data/walk-network.json:
 *   pnpm run data:walkgraph
 */
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { metresBetween } from '../src/utils/geo';
import { type Raster, decodeTiff, terrainFrom } from './terrain';

interface KeptWay {
  id: number;
  nodes: number[];
  geometry: [number, number][];
  steps: boolean;
  name?: string;
}

/**
 * Coordinates are stored as integers at 1e-5 degrees, which is about 1.1 m.
 *
 * 1e-6 was the first choice, at 11 cm, and it cost 99 KB gzipped for precision nobody can
 * stand in: a pavement is two metres wide and the phone's own fix is good to five on a
 * clear day. Deltas at this scale are one or two digits for most shape points, which is
 * what makes the file compress.
 */
const SCALE = 100_000;

const ways: KeptWay[] = JSON.parse(readFileSync('data/osm-walk-network.json', 'utf8'));

/* ---------- which nodes are junctions ---------- */

const seen = new Map<number, number>();
for (const way of ways) {
  for (const node of way.nodes) seen.set(node, (seen.get(node) ?? 0) + 1);
}

const isJunction = (nodeId: number, way: KeptWay, index: number) =>
  index === 0 || index === way.nodes.length - 1 || (seen.get(nodeId) ?? 0) > 1;

/* ---------- collect the junctions, in first-seen order ---------- */

const junctionIndex = new Map<number, number>();
const junctionCoords: [number, number][] = [];

for (const way of ways) {
  way.nodes.forEach((nodeId, i) => {
    if (!isJunction(nodeId, way, i)) return;
    if (junctionIndex.has(nodeId)) return;
    junctionIndex.set(nodeId, junctionCoords.length);
    junctionCoords.push(way.geometry[i]);
  });
}

/* ---------- split every way into edges between junctions ---------- */

interface Edge {
  a: number;
  b: number;
  metres: number;
  steps: boolean;
  /** The shape between the two junctions, ends excluded. */
  shape: [number, number][];
}

const edges: Edge[] = [];

for (const way of ways) {
  let startIdx = 0;
  for (let i = 1; i < way.nodes.length; i++) {
    if (!isJunction(way.nodes[i], way, i)) continue;

    const a = junctionIndex.get(way.nodes[startIdx]);
    const b = junctionIndex.get(way.nodes[i]);
    // A way whose first node is not a junction cannot happen — index 0 always is — but a
    // way can list the same node twice, which would make a zero-length self-loop.
    if (a === undefined || b === undefined || a === b) {
      startIdx = i;
      continue;
    }

    let metres = 0;
    for (let k = startIdx; k < i; k++) {
      metres += metresBetween(
        way.geometry[k][0],
        way.geometry[k][1],
        way.geometry[k + 1][0],
        way.geometry[k + 1][1],
      );
    }

    edges.push({
      a,
      b,
      metres: Math.round(metres),
      steps: way.steps,
      shape: way.geometry.slice(startIdx + 1, i),
    });
    startIdx = i;
  }
}

/* ---------- how connected is it? ---------- */

const neighbours: number[][] = Array.from({ length: junctionCoords.length }, () => []);
for (let i = 0; i < edges.length; i++) {
  neighbours[edges[i].a].push(i);
  neighbours[edges[i].b].push(i);
}

const component = new Int32Array(junctionCoords.length).fill(-1);
const componentSizes: number[] = [];
for (let start = 0; start < junctionCoords.length; start++) {
  if (component[start] !== -1) continue;
  const id = componentSizes.length;
  let size = 0;
  const stack = [start];
  component[start] = id;
  while (stack.length) {
    const node = stack.pop()!;
    size++;
    for (const e of neighbours[node]) {
      const other = edges[e].a === node ? edges[e].b : edges[e].a;
      if (component[other] === -1) {
        component[other] = id;
        stack.push(other);
      }
    }
  }
  componentSizes.push(size);
}
const biggest = Math.max(...componentSizes);

/* ---------- how high each junction is ---------- */

/**
 * A metre of height per junction, from the IGN's 5 m model where it is cached.
 *
 * OpenStreetMap carries no elevation, so without this the router is right about the
 * pavement and silent about the climb — and Lugo has the Miño at the bottom and a walled
 * hill on top. One height per junction rather than a grid: 21.093 numbers, and it is the
 * only place the router ever asks.
 *
 * What that costs is the hump in the middle of a long edge. An edge's climb is the
 * difference between its two ends, so a street that goes up and back down reads as flat.
 * Between junctions that is tens of metres of street, and in a city junctions are close
 * together — but it is a real limitation and not a rounding error.
 *
 * Optional on purpose. Without `pnpm run data:elevation` the graph builds exactly as it
 * did and the router charges nothing for a slope, rather than the build failing over a
 * cache nobody has filled.
 */
const TERRAIN_CACHE = '.cache/mdt';
let elevations: number[] = [];

if (existsSync(TERRAIN_CACHE) && readdirSync(TERRAIN_CACHE).length) {
  const cells = new Map<string, Raster>();
  for (const name of readdirSync(TERRAIN_CACHE)) {
    if (!name.endsWith('.tif')) continue;
    cells.set(name.replace('.tif', ''), decodeTiff(readFileSync(join(TERRAIN_CACHE, name))));
  }
  const terrain = terrainFrom(cells);

  let missing = 0;
  const known: number[] = [];
  elevations = junctionCoords.map(([lat, lng]) => {
    const metres = terrain.at(lat, lng);
    if (metres === null) {
      missing++;
      return 0;
    }
    known.push(metres);
    return metres;
  });

  console.log(
    `  ${cells.size} terrain cells; ${known.length} junctions placed between ${Math.min(...known)} m and ${Math.max(...known)} m, ${missing} off the coverage`,
  );
} else {
  console.log('  no terrain cached (pnpm run data:elevation) — the graph will carry no heights');
}

/* ---------- write it as flat integer arrays, which is what gzip likes ---------- */

const j: number[] = [];
let lastLat = 0;
let lastLng = 0;
for (const [lat, lng] of junctionCoords) {
  const a = Math.round(lat * SCALE);
  const b = Math.round(lng * SCALE);
  j.push(a - lastLat, b - lastLng);
  lastLat = a;
  lastLng = b;
}

// One flat run per edge: a, b, metres, steps, shape point count, then the shape as
// deltas from the previous point, starting at junction a.
const e: number[] = [];
for (const edge of edges) {
  e.push(edge.a, edge.b, edge.metres, edge.steps ? 1 : 0, edge.shape.length);
  let lat = Math.round(junctionCoords[edge.a][0] * SCALE);
  let lng = Math.round(junctionCoords[edge.a][1] * SCALE);
  for (const [pLat, pLng] of edge.shape) {
    const a = Math.round(pLat * SCALE);
    const b = Math.round(pLng * SCALE);
    e.push(a - lat, b - lng);
    lat = a;
    lng = b;
  }
}

// Heights are delta-coded like everything else here: neighbouring junctions are usually
// within a metre or two of each other, so the deltas are one digit and compress away.
const h: number[] = [];
let lastHeight = 0;
for (const metres of elevations) {
  h.push(metres - lastHeight);
  lastHeight = metres;
}

const out = JSON.stringify({ scale: SCALE, junctions: j, edges: e, ...(h.length ? { heights: h } : {}) });
writeFileSync('src/data/walk-network.json', out + '\n');

const totalKm = edges.reduce((n, edge) => n + edge.metres, 0) / 1000;
console.log(`  ${junctionCoords.length} junctions, ${edges.length} edges, ${Math.round(totalKm)} km of walkable way`);
console.log(`  ${edges.filter((x) => x.steps).length} edges are steps`);
console.log(`  ${componentSizes.length} connected components; the largest holds ${biggest} junctions (${((biggest / junctionCoords.length) * 100).toFixed(1)}%)`);
console.log(`\n  src/data/walk-network.json: ${(out.length / 1024 / 1024).toFixed(2)} MB raw, ${(gzipSync(Buffer.from(out)).length / 1024).toFixed(0)} KB gzipped`);
