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
let terrainReader: { at(lat: number, lng: number): number | null } | null = null;

if (existsSync(TERRAIN_CACHE) && readdirSync(TERRAIN_CACHE).length) {
  const cells = new Map<string, Raster>();
  for (const name of readdirSync(TERRAIN_CACHE)) {
    if (!name.endsWith('.tif')) continue;
    cells.set(name.replace('.tif', ''), decodeTiff(readFileSync(join(TERRAIN_CACHE, name))));
  }
  const terrain = terrainFrom(cells);
  terrainReader = terrain;

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

/* ---------- how much climbing each edge actually costs ---------- */

/**
 * The rise along a street, not the difference between its ends.
 *
 * An edge's climb was h(b) - h(a), which reads a street that goes up and back down as
 * flat. Measured against the 5 m model over all 29.489 edges: in aggregate it barely
 * matters -- endpoints give 41.834 m of ascent against 42.086 m for the full profile at a
 * 3 m threshold, six parts in a thousand. But 3.169 edges hide some climb and 287 hide
 * ten metres or more, which is a whole minute of Naismith, and they are the long ones:
 * the worst is 1.941 m of rural road whose ends are level and which climbs 77 m in
 * between. A tail rather than a bias, and the tail is what happens to somebody walking it.
 *
 * The profile is sampled at the model's own 5 m, and rises below THRESHOLD_M are ignored
 * because the stored heights are whole metres and summing every wobble over half a
 * million samples turns quantisation into ascent nobody climbs: unfiltered it reports
 * 68.160 m, which is 27 m per kilometre and not a real city. Two metres keeps street
 * undulation and drops the noise; three collapses onto the endpoints again, five falls
 * below them.
 *
 * Both directions are stored rather than deriving one from the other. The identity
 * ascent(b→a) = ascent(a→b) − (h(b) − h(a)) holds for an unfiltered profile and only
 * approximately once a threshold is applied, and an approximation is not worth the four
 * bytes it saves.
 */
const SAMPLE_M = 5;
const THRESHOLD_M = 2;

function profileOf(points: [number, number][], terrain: { at(lat: number, lng: number): number | null }): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [aLat, aLng] = points[i];
    const [bLat, bLng] = points[i + 1];
    const steps = Math.max(1, Math.round(metresBetween(aLat, aLng, bLat, bLng) / SAMPLE_M));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const h = terrain.at(aLat + (bLat - aLat) * t, aLng + (bLng - aLng) * t);
      if (h !== null) out.push(h);
    }
  }
  const last = terrain.at(points[points.length - 1][0], points[points.length - 1][1]);
  if (last !== null) out.push(last);
  return out;
}

/** Total rise along a profile, ignoring anything under the threshold. */
function ascentOf(heights: number[]): number {
  let total = 0;
  let anchor = heights[0] ?? 0;
  for (const h of heights) {
    if (h - anchor >= THRESHOLD_M) {
      total += h - anchor;
      anchor = h;
    } else if (h < anchor) {
      anchor = h;
    }
  }
  return Math.round(total);
}

/** Ascent walking a→b, and ascent walking b→a. */
const ascents: [number, number][] = [];
if (terrainReader) {
  for (const edge of edges) {
    const points: [number, number][] = [
      junctionCoords[edge.a],
      ...edge.shape,
      junctionCoords[edge.b],
    ];
    const heights = profileOf(points, terrainReader);
    ascents.push([ascentOf(heights), ascentOf([...heights].reverse())]);
  }
  const up = ascents.reduce((n, [a]) => n + a, 0);
  const flatWay = edges.filter((_, i) => ascents[i][0] === 0 && ascents[i][1] === 0).length;
  console.log(`  ${up} m of ascent along the profiles, ${flatWay} edges genuinely flat both ways`);
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
// Ascent rides in its own pair of runs rather than inside the edge records, so a graph
// built with no terrain cached is byte for byte the file it always was.
const up = ascents.map(([forward]) => forward);
const down = ascents.map(([, backward]) => backward);

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

const out = JSON.stringify({
  scale: SCALE,
  junctions: j,
  edges: e,
  ...(h.length ? { heights: h, up, down } : {}),
});
writeFileSync('src/data/walk-network.json', out + '\n');

const totalKm = edges.reduce((n, edge) => n + edge.metres, 0) / 1000;
console.log(`  ${junctionCoords.length} junctions, ${edges.length} edges, ${Math.round(totalKm)} km of walkable way`);
console.log(`  ${edges.filter((x) => x.steps).length} edges are steps`);
console.log(`  ${componentSizes.length} connected components; the largest holds ${biggest} junctions (${((biggest / junctionCoords.length) * 100).toFixed(1)}%)`);
console.log(`\n  src/data/walk-network.json: ${(out.length / 1024 / 1024).toFixed(2)} MB raw, ${(gzipSync(Buffer.from(out)).length / 1024).toFixed(0)} KB gzipped`);
