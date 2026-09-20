/**
 * Turn the walkable ways into a graph the phone can route on.
 *
 * OSM gives ways, not a graph: two ways that share a node are connected, two that merely
 * cross on screen are not (a footbridge over a road). A node used by two or more ways is
 * a junction, and so is either end of a way; the nodes between only describe the shape
 * of the street, so each run collapses into one edge carrying its length and polyline.
 *
 * Offline and fast. Reads data/osm-walk-network.json, writes src/data/walk-network.json:
 *   pnpm run data:walkgraph
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { metresBetween } from '../src/utils/geo';
import { decodeTiff, terrainFrom, type Raster, type Terrain } from './terrain';

interface KeptWay {
  id: number;
  nodes: number[];
  geometry: [number, number][];
  steps: boolean;
  name?: string;
}

interface Edge {
  a: number;
  b: number;
  metres: number;
  steps: boolean;
  /** The shape between the two junctions, ends excluded. */
  shape: [number, number][];
}

/**
 * Coordinates as integers at 1e-5 degrees, about 1.1 m: a pavement is two metres wide and
 * the phone's fix is good to five. Deltas at this scale are one or two digits, which is
 * what makes the file compress.
 */
const SCALE = 100_000;
const TERRAIN_CACHE = '.cache/mdt';
/** The profile is sampled at the model's own 5 m. */
const SAMPLE_M = 5;
/**
 * Rises under this are ignored: heights are whole metres, and summing every wobble over
 * half a million samples turns quantisation into ascent nobody climbs. Two metres keeps
 * street undulation and drops the noise; three collapses onto the endpoints again.
 */
const THRESHOLD_M = 2;

const ways: KeptWay[] = JSON.parse(readFileSync('data/osm-walk-network.json', 'utf8'));

const uses = new Map<number, number>();
for (const way of ways) for (const node of way.nodes) uses.set(node, (uses.get(node) ?? 0) + 1);
const isJunction = (way: KeptWay, index: number) => index === 0 || index === way.nodes.length - 1 || (uses.get(way.nodes[index]) ?? 0) > 1;

// Junctions in first-seen order, then every way split into edges between them.
const junctionIndex = new Map<number, number>();
const junctionCoords: [number, number][] = [];
for (const way of ways) {
  way.nodes.forEach((nodeId, i) => {
    if (!isJunction(way, i) || junctionIndex.has(nodeId)) return;
    junctionIndex.set(nodeId, junctionCoords.length);
    junctionCoords.push(way.geometry[i]);
  });
}

const edges: Edge[] = [];
for (const way of ways) {
  let start = 0;
  for (let i = 1; i < way.nodes.length; i++) {
    if (!isJunction(way, i)) continue;
    const a = junctionIndex.get(way.nodes[start])!;
    const b = junctionIndex.get(way.nodes[i])!;
    // A way can list the same node twice, which would make a zero-length self-loop.
    if (a !== b) {
      let metres = 0;
      for (let k = start; k < i; k++) metres += metresBetween(way.geometry[k][0], way.geometry[k][1], way.geometry[k + 1][0], way.geometry[k + 1][1]);
      edges.push({ a, b, metres: Math.round(metres), steps: way.steps, shape: way.geometry.slice(start + 1, i) });
    }
    start = i;
  }
}

// Connected components, to say how much of the graph the largest one holds.
const neighbours: number[][] = junctionCoords.map(() => []);
edges.forEach((edge, i) => {
  neighbours[edge.a].push(i);
  neighbours[edge.b].push(i);
});
const component = new Int32Array(junctionCoords.length).fill(-1);
const componentSizes: number[] = [];
for (let start = 0; start < junctionCoords.length; start++) {
  if (component[start] !== -1) continue;
  const id = componentSizes.length;
  const stack = [start];
  component[start] = id;
  let size = 0;
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

/**
 * A metre of height per junction, from the IGN's 5 m model where it is cached: OSM
 * carries no elevation, and Lugo has the Miño at the bottom and a walled hill on top.
 * Optional on purpose: without `pnpm run data:elevation` the graph builds as it always
 * did and the router charges nothing for a slope.
 */
let terrain: Terrain | null = null;
let elevations: number[] = [];
if (existsSync(TERRAIN_CACHE) && readdirSync(TERRAIN_CACHE).length) {
  const cells = new Map<string, Raster>();
  for (const name of readdirSync(TERRAIN_CACHE)) {
    if (name.endsWith('.tif')) cells.set(name.replace('.tif', ''), decodeTiff(readFileSync(join(TERRAIN_CACHE, name))));
  }
  terrain = terrainFrom(cells);
  const known: number[] = [];
  elevations = junctionCoords.map(([lat, lng]) => {
    const metres = terrain!.at(lat, lng);
    if (metres !== null) known.push(metres);
    return metres ?? 0;
  });
  console.log(`  ${cells.size} terrain cells; ${known.length} junctions placed between ${Math.min(...known)} m and ${Math.max(...known)} m, ${elevations.length - known.length} off the coverage`);
} else {
  console.log('  no terrain cached (pnpm run data:elevation) — the graph will carry no heights');
}

/** Heights sampled every SAMPLE_M along the polyline. */
function profileOf(points: [number, number][], terrain: Terrain): number[] {
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
    } else if (h < anchor) anchor = h;
  }
  return Math.round(total);
}

/**
 * The rise along a street, not the difference between its ends: a street that goes up
 * and back down is not flat, and the long rural edges hide tens of metres that way. Both
 * directions are stored, because the identity between them only holds unfiltered.
 */
const ascents: [number, number][] = [];
if (terrain) {
  for (const edge of edges) {
    const heights = profileOf([junctionCoords[edge.a], ...edge.shape, junctionCoords[edge.b]], terrain);
    ascents.push([ascentOf(heights), ascentOf([...heights].reverse())]);
  }
  const up = ascents.reduce((n, [a]) => n + a, 0);
  const flat = ascents.filter(([a, b]) => a === 0 && b === 0).length;
  console.log(`  ${up} m of ascent along the profiles, ${flat} edges genuinely flat both ways`);
}

// Flat integer arrays, delta-coded, which is what gzip likes.
const deltas = (points: [number, number][], from: [number, number] = [0, 0]): number[] => {
  const out: number[] = [];
  let [lat, lng] = from.map((v) => Math.round(v * SCALE));
  for (const [pLat, pLng] of points) {
    const a = Math.round(pLat * SCALE);
    const b = Math.round(pLng * SCALE);
    out.push(a - lat, b - lng);
    lat = a;
    lng = b;
  }
  return out;
};

// One flat run per edge: a, b, metres, steps, shape point count, then the shape as deltas
// from the previous point, starting at junction a. Ascent rides in its own pair of runs,
// so a graph built with no terrain cached is byte for byte the file it always was.
const e = edges.flatMap((edge) => [edge.a, edge.b, edge.metres, edge.steps ? 1 : 0, edge.shape.length, ...deltas(edge.shape, junctionCoords[edge.a])]);
const h = elevations.map((metres, i) => metres - (elevations[i - 1] ?? 0));

const out = JSON.stringify({
  scale: SCALE,
  junctions: deltas(junctionCoords),
  edges: e,
  ...(h.length ? { heights: h, up: ascents.map(([up]) => up), down: ascents.map(([, down]) => down) } : {}),
});
writeFileSync('src/data/walk-network.json', out + '\n');

const totalKm = edges.reduce((n, edge) => n + edge.metres, 0) / 1000;
console.log(`  ${junctionCoords.length} junctions, ${edges.length} edges, ${Math.round(totalKm)} km of walkable way`);
console.log(`  ${edges.filter((x) => x.steps).length} edges are steps`);
console.log(`  ${componentSizes.length} connected components; the largest holds ${biggest} junctions (${((biggest / junctionCoords.length) * 100).toFixed(1)}%)`);
console.log(`\n  src/data/walk-network.json: ${(out.length / 1024 / 1024).toFixed(2)} MB raw, ${(gzipSync(Buffer.from(out)).length / 1024).toFixed(0)} KB gzipped`);
