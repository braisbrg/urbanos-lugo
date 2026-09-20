/**
 * Walking routes, computed on the device rather than asked of anybody.
 *
 * The network is `src/data/walk-network.json`, built from OpenStreetMap by
 * `tools/buildWalkGraph.ts`: 21,093 junctions and 29,489 edges of real pavement, with the
 * shape of each street kept beside its length. A* over that replaces a request that sent
 * the reader's own coordinates to a third party and needed a connection.
 */
import { metresBetween } from './geo';

/** 75 m/min is the figure the offline estimate uses; steps are walked at half speed. */
const METRES_PER_MINUTE = 75;
const STEPS_SPEED_FACTOR = 0.5;

/**
 * Naismith's rule: a minute for every ten metres climbed, on top of the distance. Descent
 * is free; Lugo has nothing steep enough for a descent penalty to survive rounding.
 */
const SECONDS_PER_METRE_CLIMBED = 6;

/** Bucket size for the index that finds the nearest street, roughly 200 m. */
const CELL_LAT = 0.002;
const CELL_LNG = 0.0025;

export interface WalkRoute {
  path: [number, number][];
  meters: number;
  minutes: number;
}

interface Graph {
  lat: Float64Array;
  lng: Float64Array;
  edgeA: Int32Array;
  edgeB: Int32Array;
  edgeMetres: Float64Array;
  edgeSeconds: Float64Array;
  /** The street between the two junctions, ends excluded, in drawing order a → b. */
  edgeShape: [number, number][][];
  /** Metres climbed walking each edge a→b, and b→a; null where the build had no terrain. */
  up: Int32Array | null;
  down: Int32Array | null;
  adjacency: number[][];
  /** Cell key → edge indices whose shape passes through it. */
  grid: Map<string, number[]>;
}

interface RawNetwork {
  scale: number;
  junctions: number[];
  edges: number[];
  up?: number[];
  down?: number[];
}

const cell = (lat: number, lng: number) => `${Math.floor(lat / CELL_LAT)},${Math.floor(lng / CELL_LNG)}`;

let graph: Graph | null = null;
let inFlight: Promise<Graph> | null = null;

/** Decode the flat delta-encoded integer arrays (what compresses) into something addressable. Once, lazily. */
function decode(raw: RawNetwork): Graph {
  const { scale } = raw;
  const junctionCount = raw.junctions.length / 2;
  const lat = new Float64Array(junctionCount);
  const lng = new Float64Array(junctionCount);
  for (let i = 0, runLat = 0, runLng = 0; i < junctionCount; i++) {
    runLat += raw.junctions[i * 2];
    runLng += raw.junctions[i * 2 + 1];
    lat[i] = runLat / scale;
    lng[i] = runLng / scale;
  }

  const edgeA: number[] = [];
  const edgeB: number[] = [];
  const edgeMetres: number[] = [];
  const edgeSeconds: number[] = [];
  const edgeShape: [number, number][][] = [];
  const adjacency: number[][] = Array.from({ length: junctionCount }, () => []);
  const grid = new Map<string, number[]>();
  const addToGrid = (key: string, edge: number) => {
    const bucket = grid.get(key);
    if (!bucket) grid.set(key, [edge]);
    else if (bucket[bucket.length - 1] !== edge) bucket.push(edge);
  };

  for (let i = 0; i < raw.edges.length; ) {
    const [a, b, metres, stepsFlag, shapeLength] = raw.edges.slice(i, i + 5);
    i += 5;
    const shape: [number, number][] = [];
    let pointLat = Math.round(lat[a] * scale);
    let pointLng = Math.round(lng[a] * scale);
    for (let k = 0; k < shapeLength; k++) {
      pointLat += raw.edges[i + k * 2];
      pointLng += raw.edges[i + k * 2 + 1];
      shape.push([pointLat / scale, pointLng / scale]);
    }
    i += shapeLength * 2;

    const index = edgeA.length;
    edgeA.push(a);
    edgeB.push(b);
    edgeMetres.push(metres);
    edgeSeconds.push((metres / (METRES_PER_MINUTE * (stepsFlag === 1 ? STEPS_SPEED_FACTOR : 1))) * 60);
    edgeShape.push(shape);
    adjacency[a].push(index);
    adjacency[b].push(index);
    // Every cell the street passes through, ends included, so a point beside the middle of a long street finds it.
    for (const [pLat, pLng] of [[lat[a], lng[a]] as [number, number], ...shape, [lat[b], lng[b]] as [number, number]]) addToGrid(cell(pLat, pLng), index);
  }

  const edgeCount = edgeA.length;
  return {
    lat,
    lng,
    up: raw.up?.length === edgeCount ? Int32Array.from(raw.up) : null,
    down: raw.down?.length === edgeCount ? Int32Array.from(raw.down) : null,
    edgeA: Int32Array.from(edgeA),
    edgeB: Int32Array.from(edgeB),
    edgeMetres: Float64Array.from(edgeMetres),
    edgeSeconds: Float64Array.from(edgeSeconds),
    edgeShape,
    adjacency,
    grid,
  };
}

function loadWalkNetwork(): Promise<Graph> {
  if (graph) return Promise.resolve(graph);
  if (!inFlight) {
    inFlight = import('../data/walk-network.json')
      .then((module) => (graph = decode((module.default ?? module) as unknown as RawNetwork)))
      .catch((error) => {
        inFlight = null; // so a later attempt can retry
        throw error;
      });
  }
  return inFlight;
}

/** At this latitude a degree of longitude is 0.731 of a degree of latitude; planar arithmetic is fine over tens of metres. */
const LNG_SCALE = Math.cos((43.01 * Math.PI) / 180);

/** The point on segment a→b closest to p, and how far along it lies. */
function projectOnto(pLat: number, pLng: number, aLat: number, aLng: number, bLat: number, bLng: number): { lat: number; lng: number; t: number } {
  const ax = aLng * LNG_SCALE;
  const bx = bLng * LNG_SCALE;
  const px = pLng * LNG_SCALE;
  const dx = bx - ax;
  const dy = bLat - aLat;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { lat: aLat, lng: aLng, t: 0 };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pLat - aLat) * dy) / lengthSquared));
  return { lat: aLat + t * dy, lng: (ax + t * dx) / LNG_SCALE, t };
}

/** An edge's vertices, junction to junction. */
const edgePoints = (g: Graph, edge: number): [number, number][] => [
  [g.lat[g.edgeA[edge]], g.lng[g.edgeA[edge]]],
  ...g.edgeShape[edge],
  [g.lat[g.edgeB[edge]], g.lng[g.edgeB[edge]]],
];

interface Snap {
  edge: number;
  /** Where on the edge, as metres from junction a. */
  metresFromA: number;
  lat: number;
  lng: number;
  awayMetres: number;
}

/** The nearest point on the network to a coordinate, widening the search ring until something turns up. */
function snap(g: Graph, lat: number, lng: number): Snap | null {
  const baseLat = Math.floor(lat / CELL_LAT);
  const baseLng = Math.floor(lng / CELL_LNG);
  for (let ring = 1; ring <= 12; ring++) {
    const candidates = new Set<number>();
    for (let dLat = -ring; dLat <= ring; dLat++) {
      for (let dLng = -ring; dLng <= ring; dLng++) {
        for (const edge of g.grid.get(`${baseLat + dLat},${baseLng + dLng}`) ?? []) candidates.add(edge);
      }
    }
    let best: Snap | null = null;
    for (const edge of candidates) {
      const points = edgePoints(g, edge);
      let travelled = 0;
      for (let k = 0; k + 1 < points.length; k++) {
        const segment = metresBetween(points[k][0], points[k][1], points[k + 1][0], points[k + 1][1]);
        const hit = projectOnto(lat, lng, points[k][0], points[k][1], points[k + 1][0], points[k + 1][1]);
        const away = metresBetween(lat, lng, hit.lat, hit.lng);
        if (!best || away < best.awayMetres) best = { edge, metresFromA: travelled + segment * hit.t, lat: hit.lat, lng: hit.lng, awayMetres: away };
        travelled += segment;
      }
    }
    if (best) return best;
  }
  return null;
}

/** A binary heap keyed on the A* estimate. */
class Queue {
  private items: { node: number; priority: number }[] = [];

  push(node: number, priority: number): void {
    this.items.push({ node, priority });
    for (let i = this.items.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop(): number | undefined {
    if (!this.items.length) return undefined;
    const top = this.items[0].node;
    const last = this.items.pop()!;
    if (this.items.length) {
      this.items[0] = last;
      for (let i = 0; ; ) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
        if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top;
  }

  get size(): number {
    return this.items.length;
  }
}

/** The fastest anyone moves on this network, which is what makes the heuristic admissible. */
const BEST_SECONDS_PER_METRE = 60 / METRES_PER_MINUTE;

/** Part of an edge, walked from one end towards the other. */
function slice(g: Graph, edge: number, fromMetres: number, toMetres: number): [number, number][] {
  const points = edgePoints(g, edge);
  const low = Math.min(fromMetres, toMetres);
  const high = Math.max(fromMetres, toMetres);
  const out: [number, number][] = [];
  let travelled = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const segment = metresBetween(points[k][0], points[k][1], points[k + 1][0], points[k + 1][1]);
    const start = travelled;
    const end = travelled + segment;
    if (end >= low && start <= high && segment > 0) {
      const at = (t: number): [number, number] => [points[k][0] + (points[k + 1][0] - points[k][0]) * t, points[k][1] + (points[k + 1][1] - points[k][1]) * t];
      out.push(at(Math.max(0, (low - start) / segment)), at(Math.min(1, (high - start) / segment)));
    }
    travelled = end;
  }
  return toMetres >= fromMetres ? out : out.reverse();
}

/**
 * The walk between two coordinates, along real pavement. Null when either end is nowhere
 * near the network or the two sit in different pieces of it (98.7% of the graph is one
 * piece; the rest are rural tracks) — the caller keeps its straight line.
 */
export async function routeOnFoot(from: [number, number], to: [number, number]): Promise<WalkRoute | null> {
  const g = await loadWalkNetwork();
  const start = snap(g, from[0], from[1]);
  const finish = snap(g, to[0], to[1]);
  if (!start || !finish) return null;

  // The walk from where you are to where the network is, at both ends, at the flat speed:
  // a stop in a lay-by can sit tens of metres off the nearest way, and the drawn line
  // starts at the real coordinate, so the distance has to as well.
  const offMetres = start.awayMetres + finish.awayMetres;
  const offSeconds = (offMetres / METRES_PER_MINUTE) * 60;

  const metresOf = (edge: number) => g.edgeMetres[edge];
  const secondsPerMetre = (edge: number) => g.edgeSeconds[edge] / (g.edgeMetres[edge] || 1);
  // What a climb costs, in the direction walked: the build stores what each street
  // actually climbs each way along its own profile, not the difference of its ends.
  const climb = (edge: number, towardsB: boolean): number => (g.up && g.down ? (towardsB ? g.up[edge] : g.down[edge]) * SECONDS_PER_METRE_CLIMBED : 0);
  // A share of the edge's climb for the part covered at each end; where the hill sits is not stored.
  const partialClimb = (edge: number, fromMetres: number, toMetres: number): number => {
    if (!g.up || !g.down) return 0;
    const share = Math.abs(toMetres - fromMetres) / (metresOf(edge) || 1);
    return (toMetres >= fromMetres ? g.up[edge] : g.down[edge]) * share * SECONDS_PER_METRE_CLIMBED;
  };

  // Both ends on the same street: no junction is involved and A* has nothing to search.
  if (start.edge === finish.edge) {
    const metres = Math.abs(finish.metresFromA - start.metresFromA);
    const seconds = metres * secondsPerMetre(start.edge) + partialClimb(start.edge, start.metresFromA, finish.metresFromA) + offSeconds;
    return {
      path: [from, ...slice(g, start.edge, start.metresFromA, finish.metresFromA), to],
      meters: Math.round(metres + offMetres),
      minutes: Math.max(1, Math.round(seconds / 60)),
    };
  }

  const cameFrom = new Map<number, { previous: number; edge: number }>();
  const best = new Map<number, number>();
  const queue = new Queue();
  const heuristic = (node: number) => metresBetween(g.lat[node], g.lng[node], finish.lat, finish.lng) * BEST_SECONDS_PER_METRE;

  // Both junctions of the snapped edge are places the walk can begin, at the cost of getting to them.
  for (const [junction, metres] of [
    [g.edgeA[start.edge], start.metresFromA],
    [g.edgeB[start.edge], metresOf(start.edge) - start.metresFromA],
  ] as const) {
    const seconds = metres * secondsPerMetre(start.edge) + partialClimb(start.edge, start.metresFromA, junction === g.edgeA[start.edge] ? 0 : metresOf(start.edge));
    if (!best.has(junction) || seconds < best.get(junction)!) {
      best.set(junction, seconds);
      queue.push(junction, seconds + heuristic(junction));
    }
  }

  const endA = g.edgeA[finish.edge];
  const endB = g.edgeB[finish.edge];
  const tailSeconds = (junction: number) => (junction === endA ? finish.metresFromA : metresOf(finish.edge) - finish.metresFromA) * secondsPerMetre(finish.edge);

  let reached: number | null = null;
  let reachedSeconds = Infinity;
  const settled = new Set<number>();
  while (queue.size) {
    const node = queue.pop()!;
    if (settled.has(node)) continue;
    settled.add(node);
    const soFar = best.get(node)!;
    // Once the cheapest thing left already costs more than a finished answer, nothing better remains.
    if (soFar + heuristic(node) >= reachedSeconds) break;
    if (node === endA || node === endB) {
      const total = soFar + tailSeconds(node);
      if (total < reachedSeconds) {
        reachedSeconds = total;
        reached = node;
      }
    }
    for (const edge of g.adjacency[node]) {
      const other = g.edgeA[edge] === node ? g.edgeB[edge] : g.edgeA[edge];
      const next = soFar + g.edgeSeconds[edge] + climb(edge, g.edgeA[edge] === node);
      if (best.has(other) && best.get(other)! <= next) continue;
      best.set(other, next);
      cameFrom.set(other, { previous: node, edge });
      queue.push(other, next + heuristic(other));
    }
  }
  if (reached === null) return null;

  // Walk the chain back to whichever junction of the starting edge it began at.
  const chain: { node: number; edge: number }[] = [];
  let node = reached;
  while (cameFrom.has(node)) {
    const step = cameFrom.get(node)!;
    chain.push({ node, edge: step.edge });
    node = step.previous;
  }
  chain.reverse();
  const firstJunction = node;

  const path: [number, number][] = [from];
  let metres = 0;
  let seconds = 0;
  const toFirst = firstJunction === g.edgeA[start.edge] ? 0 : metresOf(start.edge);
  path.push(...slice(g, start.edge, start.metresFromA, toFirst));
  metres += Math.abs(toFirst - start.metresFromA);
  seconds += Math.abs(toFirst - start.metresFromA) * secondsPerMetre(start.edge) + partialClimb(start.edge, start.metresFromA, toFirst);

  for (const step of chain) {
    const forwards = g.edgeB[step.edge] === step.node;
    path.push(...slice(g, step.edge, forwards ? 0 : metresOf(step.edge), forwards ? metresOf(step.edge) : 0));
    metres += metresOf(step.edge);
    seconds += g.edgeSeconds[step.edge] + climb(step.edge, forwards);
  }

  const fromLast = reached === endA ? 0 : metresOf(finish.edge);
  path.push(...slice(g, finish.edge, fromLast, finish.metresFromA));
  metres += Math.abs(finish.metresFromA - fromLast);
  seconds += Math.abs(finish.metresFromA - fromLast) * secondsPerMetre(finish.edge) + partialClimb(finish.edge, fromLast, finish.metresFromA);
  path.push(to);

  return { path, meters: Math.round(metres + offMetres), minutes: Math.max(1, Math.round((seconds + offSeconds) / 60)) };
}
