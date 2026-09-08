/**
 * Walking routes, computed here rather than asked of anybody.
 *
 * The network is `src/data/walk-network.json`, built from OpenStreetMap by
 * `tools/buildWalkGraph.ts`: 21.093 junctions and 29.489 edges of real pavement, with the
 * shape of each street kept beside its length. A* over that answers the question the app
 * has always had to guess at — how far it really is on foot, around the muralla and over
 * the river rather than through them.
 *
 * It replaces a request to a third party. That request sent the reader's own coordinates
 * off the device, which is the one thing this project promises does not happen without
 * asking; and it needed a connection, on a screen whose whole point is working without
 * one. Neither is true any more.
 */
import { metresBetween } from './geo';

/**
 * How fast a person walks, and what steps cost.
 *
 * 75 m/min is the figure the offline estimate has always used, kept here so the two agree
 * on everything except the route. The steps factor is a guess with a knob on it: a flight
 * of stairs is not half a street, and `tools/compareWalkRouter.ts` is where it gets
 * argued with. 203 of the 29.489 edges are steps, so it moves few answers and matters a
 * great deal on those.
 */
const METRES_PER_MINUTE = 75;
const STEPS_SPEED_FACTOR = 0.5;

/**
 * What a climb costs, which OpenStreetMap cannot tell us and the IGN can.
 *
 * Naismith's rule: a minute for every ten metres of ascent, on top of the time the
 * distance already costs. It is a century old, it was written for hillwalkers, and it is
 * the figure every later refinement is a correction to — so it is the honest starting
 * point and it is a named constant because it is the thing to tune if the comparison
 * against a second router ever says so.
 *
 * Descent is free. Naismith himself gave it nothing, later rules give a small credit on
 * gentle slopes and a penalty on steep ones, and Lugo has nothing steep enough for the
 * difference to survive being rounded to a minute.
 *
 * What is charged is the climb along the street's own profile, not the difference between
 * the heights of its two ends — see `climb` below for why that distinction is worth
 * 29.489 extra numbers in the file.
 */
const SECONDS_PER_METRE_CLIMBED = 6;

/** Bucket size for the index that finds the nearest street. Roughly 200 m. */
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
  /** Metres above sea level per junction, or null where the build had no terrain. */
  heights: Int32Array | null;
  /** Metres climbed walking each edge a→b, and the same walking it b→a. */
  up: Int32Array | null;
  down: Int32Array | null;
  /** Edge indices touching each junction. */
  adjacency: number[][];
  /** Cell key → edge indices whose shape passes through it. */
  grid: Map<string, number[]>;
}

const cell = (lat: number, lng: number) => `${Math.floor(lat / CELL_LAT)},${Math.floor(lng / CELL_LNG)}`;

let graph: Graph | null = null;
let inFlight: Promise<Graph> | null = null;

/**
 * Decode the flat integer arrays into something addressable.
 *
 * The file is written as runs of integers because that is what compresses; this is the
 * other end of that. Done once, lazily, and only when a walking route is first wanted —
 * the file is 412 KB gzipped and most visits never plan a trip.
 */
function decode(raw: {
  scale: number;
  junctions: number[];
  edges: number[];
  heights?: number[];
  up?: number[];
  down?: number[];
}): Graph {
  const { scale } = raw;
  const junctionCount = raw.junctions.length / 2;
  const lat = new Float64Array(junctionCount);
  const lng = new Float64Array(junctionCount);

  let runningLat = 0;
  let runningLng = 0;
  for (let i = 0; i < junctionCount; i++) {
    runningLat += raw.junctions[i * 2];
    runningLng += raw.junctions[i * 2 + 1];
    lat[i] = runningLat / scale;
    lng[i] = runningLng / scale;
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
    if (bucket) {
      if (bucket[bucket.length - 1] !== edge) bucket.push(edge);
    } else {
      grid.set(key, [edge]);
    }
  };

  let i = 0;
  while (i < raw.edges.length) {
    const a = raw.edges[i];
    const b = raw.edges[i + 1];
    const metres = raw.edges[i + 2];
    const steps = raw.edges[i + 3] === 1;
    const shapeLength = raw.edges[i + 4];
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
    edgeSeconds.push((metres / (METRES_PER_MINUTE * (steps ? STEPS_SPEED_FACTOR : 1))) * 60);
    edgeShape.push(shape);
    adjacency[a].push(index);
    adjacency[b].push(index);

    // Index by every cell the street passes through, ends included, so a point beside the
    // middle of a long street still finds it.
    for (const [pLat, pLng] of [[lat[a], lng[a]] as [number, number], ...shape, [lat[b], lng[b]] as [number, number]]) {
      addToGrid(cell(pLat, pLng), index);
    }
  }

  let heights: Int32Array | null = null;
  if (raw.heights?.length === junctionCount) {
    heights = new Int32Array(junctionCount);
    let running = 0;
    for (let i = 0; i < junctionCount; i++) {
      running += raw.heights[i];
      heights[i] = running;
    }
  }

  const edgeCount = edgeA.length;
  const up = raw.up?.length === edgeCount ? Int32Array.from(raw.up) : null;
  const down = raw.down?.length === edgeCount ? Int32Array.from(raw.down) : null;

  return {
    lat,
    lng,
    heights,
    up,
    down,
    edgeA: Int32Array.from(edgeA),
    edgeB: Int32Array.from(edgeB),
    edgeMetres: Float64Array.from(edgeMetres),
    edgeSeconds: Float64Array.from(edgeSeconds),
    edgeShape,
    adjacency,
    grid,
  };
}

export function loadWalkNetwork(): Promise<Graph> {
  if (graph) return Promise.resolve(graph);
  if (!inFlight) {
    inFlight = import('../data/walk-network.json')
      .then((module) => {
        graph = decode((module.default ?? module) as unknown as Parameters<typeof decode>[0]);
        return graph;
      })
      .catch((error) => {
        // A failed chunk load leaves the caller to its straight line rather than throwing
        // into a render. Reset so a later attempt can retry.
        inFlight = null;
        throw error;
      });
  }
  return inFlight;
}

/**
 * The point on segment a→b closest to p, and how far along it lies.
 *
 * Plain planar arithmetic in a local metric frame: at this latitude a degree of longitude
 * is 0.731 of a degree of latitude, and over the tens of metres a snap ever spans the
 * error from ignoring curvature is millimetres.
 */
const LNG_SCALE = Math.cos((43.01 * Math.PI) / 180);

function projectOnto(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): { lat: number; lng: number; t: number } {
  const ax = aLng * LNG_SCALE;
  const ay = aLat;
  const bx = bLng * LNG_SCALE;
  const by = bLat;
  const px = pLng * LNG_SCALE;
  const py = pLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { lat: aLat, lng: aLng, t: 0 };

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return { lat: ay + t * dy, lng: (ax + t * dx) / LNG_SCALE, t };
}

interface Snap {
  edge: number;
  /** Where on the edge, as metres from junction a. */
  metresFromA: number;
  lat: number;
  lng: number;
  awayMetres: number;
}

/** The nearest point on the network to an arbitrary coordinate. */
function snap(g: Graph, lat: number, lng: number): Snap | null {
  // Widen the search until something turns up: one ring covers the 200 m cell and its
  // neighbours, which is enough anywhere a person stands in Lugo, and the loop is what
  // keeps an answer coming for a point out in the parishes.
  for (let ring = 1; ring <= 12; ring++) {
    const candidates = new Set<number>();
    const baseLat = Math.floor(lat / CELL_LAT);
    const baseLng = Math.floor(lng / CELL_LNG);
    for (let dLat = -ring; dLat <= ring; dLat++) {
      for (let dLng = -ring; dLng <= ring; dLng++) {
        for (const edge of g.grid.get(`${baseLat + dLat},${baseLng + dLng}`) ?? []) candidates.add(edge);
      }
    }
    if (!candidates.size) continue;

    let best: Snap | null = null;
    for (const edge of candidates) {
      const points: [number, number][] = [
        [g.lat[g.edgeA[edge]], g.lng[g.edgeA[edge]]],
        ...g.edgeShape[edge],
        [g.lat[g.edgeB[edge]], g.lng[g.edgeB[edge]]],
      ];
      let travelled = 0;
      for (let k = 0; k + 1 < points.length; k++) {
        const segment = metresBetween(points[k][0], points[k][1], points[k + 1][0], points[k + 1][1]);
        const hit = projectOnto(lat, lng, points[k][0], points[k][1], points[k + 1][0], points[k + 1][1]);
        const away = metresBetween(lat, lng, hit.lat, hit.lng);
        if (!best || away < best.awayMetres) {
          best = { edge, metresFromA: travelled + segment * hit.t, lat: hit.lat, lng: hit.lng, awayMetres: away };
        }
        travelled += segment;
      }
    }
    if (best) return best;
  }
  return null;
}

/** A binary heap keyed on the A* estimate. Small, and there is no such thing in the box. */
class Queue {
  private items: { node: number; priority: number }[] = [];

  push(node: number, priority: number): void {
    this.items.push({ node, priority });
    let i = this.items.length - 1;
    while (i > 0) {
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
      let i = 0;
      for (;;) {
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
  const points: [number, number][] = [
    [g.lat[g.edgeA[edge]], g.lng[g.edgeA[edge]]],
    ...g.edgeShape[edge],
    [g.lat[g.edgeB[edge]], g.lng[g.edgeB[edge]]],
  ];
  const forward = toMetres >= fromMetres;
  const low = Math.min(fromMetres, toMetres);
  const high = Math.max(fromMetres, toMetres);

  const out: [number, number][] = [];
  let travelled = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const segment = metresBetween(points[k][0], points[k][1], points[k + 1][0], points[k + 1][1]);
    const start = travelled;
    const end = travelled + segment;
    if (end >= low && start <= high && segment > 0) {
      const enter = Math.max(0, (low - start) / segment);
      const leave = Math.min(1, (high - start) / segment);
      const at = (t: number): [number, number] => [
        points[k][0] + (points[k + 1][0] - points[k][0]) * t,
        points[k][1] + (points[k + 1][1] - points[k][1]) * t,
      ];
      out.push(at(enter), at(leave));
    }
    travelled = end;
  }
  return forward ? out : out.reverse();
}

/**
 * The walk from one coordinate to another, along real pavement.
 *
 * Returns null when either end is nowhere near the network or the two sit in different
 * pieces of it — 98,7% of the graph is one piece, and the rest are rural tracks. The
 * caller keeps its straight line, which is what it did before any of this existed.
 */
export async function routeOnFoot(
  from: [number, number],
  to: [number, number],
): Promise<WalkRoute | null> {
  const g = await loadWalkNetwork();

  const start = snap(g, from[0], from[1]);
  const finish = snap(g, to[0], to[1]);
  if (!start || !finish) return null;

  /**
   * The walk from where you are to where the network is, at both ends.
   *
   * A bus stop in a lay-by, or a place whose coordinate is inside a block, can sit tens
   * of metres from the nearest walkable way; one of the stops on the N-VI is 50 m off it.
   * The route between the two snapped points does not cover that ground, but the drawn
   * line does — it starts at the real coordinate — so leaving it out made the distance
   * disagree with its own polyline on 125 of 2.631 legs measured, by up to 101 m, and
   * produced the impossible: a 55 m walk between two points 72 m apart.
   *
   * Charged at the flat walking speed. Which way you cross those last metres is not in
   * OpenStreetMap, and pretending to route it would be inventing a path.
   */
  const offMetres = start.awayMetres + finish.awayMetres;
  const offSeconds = (offMetres / METRES_PER_MINUTE) * 60;

  const metresOf = (edge: number) => g.edgeMetres[edge];
  const secondsPerMetre = (edge: number) => g.edgeSeconds[edge] / (g.edgeMetres[edge] || 1);

  /**
   * What it costs to climb an edge, in seconds, in the direction it is being walked.
   *
   * This was the difference between the two junction heights, which reads a street that
   * rises and falls between them as flat. The build now walks each street's own profile
   * against the 5 m model and stores what it actually climbs each way, so an edge with
   * level ends and a hill in the middle costs the hill. 3.169 of the 29.489 edges hide
   * some climb that way and 287 hide ten metres or more, which is a minute; they are the
   * long ones, and the worst is 1.941 m of rural road that is level end to end and climbs
   * 77 m in between.
   *
   * Still charged at traversal rather than baked into the edge, because an edge is walked
   * both ways and only one of those is uphill.
   */
  const climb = (edge: number, towardsB: boolean): number =>
    g.up && g.down ? (towardsB ? g.up[edge] : g.down[edge]) * SECONDS_PER_METRE_CLIMBED : 0;

  /**
   * The same, for the part of an edge the walk actually covers at each end.
   *
   * A share of the edge's climb rather than the profile of that share: where on the
   * street the hill sits is not stored, only how much of it there is. It is the same
   * approximation the distance already makes at these two ends, over the same few tens of
   * metres.
   */
  const partialClimb = (edge: number, fromMetres: number, toMetres: number): number => {
    if (!g.up || !g.down) return 0;
    const share = Math.abs(toMetres - fromMetres) / (metresOf(edge) || 1);
    return (toMetres >= fromMetres ? g.up[edge] : g.down[edge]) * share * SECONDS_PER_METRE_CLIMBED;
  };

  // Both ends on the same street: no junction is involved and A* has nothing to search.
  if (start.edge === finish.edge) {
    const metres = Math.abs(finish.metresFromA - start.metresFromA);
    return {
      path: [[from[0], from[1]], ...slice(g, start.edge, start.metresFromA, finish.metresFromA), [to[0], to[1]]],
      meters: Math.round(metres + offMetres),
      minutes: Math.max(
        1,
        Math.round(
          (metres * secondsPerMetre(start.edge) +
            partialClimb(start.edge, start.metresFromA, finish.metresFromA) +
            offSeconds) /
            60,
        ),
      ),
    };
  }

  // Both junctions of the snapped edge are places the walk can begin, at the cost of
  // getting to them along that edge.
  const cameFrom = new Map<number, { previous: number; edge: number }>();
  const best = new Map<number, number>();
  const queue = new Queue();

  const heuristic = (node: number) =>
    metresBetween(g.lat[node], g.lng[node], finish.lat, finish.lng) * BEST_SECONDS_PER_METRE;

  for (const [junction, metres] of [
    [g.edgeA[start.edge], start.metresFromA],
    [g.edgeB[start.edge], metresOf(start.edge) - start.metresFromA],
  ] as const) {
    const seconds =
      metres * secondsPerMetre(start.edge) +
      partialClimb(start.edge, start.metresFromA, junction === g.edgeA[start.edge] ? 0 : metresOf(start.edge));
    if (!best.has(junction) || seconds < best.get(junction)!) {
      best.set(junction, seconds);
      queue.push(junction, seconds + heuristic(junction));
    }
  }

  const endA = g.edgeA[finish.edge];
  const endB = g.edgeB[finish.edge];
  const tailSeconds = (junction: number) =>
    (junction === endA ? finish.metresFromA : metresOf(finish.edge) - finish.metresFromA) *
    secondsPerMetre(finish.edge);

  let reached: number | null = null;
  let reachedSeconds = Infinity;
  const settled = new Set<number>();

  while (queue.size) {
    const node = queue.pop()!;
    if (settled.has(node)) continue;
    settled.add(node);
    const soFar = best.get(node)!;

    // Once the cheapest thing left to try already costs more than a finished answer,
    // nothing better remains.
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

  const path: [number, number][] = [[from[0], from[1]]];
  let metres = 0;
  let seconds = 0;

  // From where the walk starts, along the snapped edge, to that first junction.
  const toFirst =
    firstJunction === g.edgeA[start.edge] ? 0 : metresOf(start.edge);
  path.push(...slice(g, start.edge, start.metresFromA, toFirst));
  metres += Math.abs(toFirst - start.metresFromA);
  seconds += Math.abs(toFirst - start.metresFromA) * secondsPerMetre(start.edge);
  seconds += partialClimb(start.edge, start.metresFromA, toFirst);

  for (const step of chain) {
    const edge = step.edge;
    const forwards = g.edgeB[edge] === step.node;
    path.push(...slice(g, edge, forwards ? 0 : metresOf(edge), forwards ? metresOf(edge) : 0));
    metres += metresOf(edge);
    seconds += g.edgeSeconds[edge] + climb(edge, forwards);
  }

  // And along the last edge to where the walk ends.
  const fromLast = reached === endA ? 0 : metresOf(finish.edge);
  path.push(...slice(g, finish.edge, fromLast, finish.metresFromA));
  metres += Math.abs(finish.metresFromA - fromLast);
  seconds += Math.abs(finish.metresFromA - fromLast) * secondsPerMetre(finish.edge);
  seconds += partialClimb(finish.edge, fromLast, finish.metresFromA);
  path.push([to[0], to[1]]);

  return {
    path,
    meters: Math.round(metres + offMetres),
    minutes: Math.max(1, Math.round((seconds + offSeconds) / 60)),
  };
}
