/**
 * Turns the scraped official data + snapped street geometry into the two files the app
 * reads: src/data/stops.json and src/data/lines.json. Inputs live in data/, outside src/.
 *
 *   npx tsx tools/importOfficialData.ts   # fetch (slow, cached)
 *   npx tsx tools/buildDataset.ts         # shape (fast, offline)
 */
import { existsSync } from 'node:fs';
import { getDistanceMeters as haversine } from '../src/utils/geo';
import { at, readJson, writeJson } from './lib';

const raw = readJson(at('data', 'official-raw.json'));
// Optional: written by tools/importStopAmenities.ts from OpenStreetMap surveys.
const amenitiesPath = at('data', 'stop-amenities.json');
const amenities: Record<string, { shelter: boolean | null; bench: boolean | null; tactilePaving: boolean | null; position?: [number, number]; osmNode?: number }> =
  existsSync(amenitiesPath) ? readJson(amenitiesPath) : {};
const routes = readJson(at('data', 'routes.json'));
// Optional: written by tools/importOsmRoutes.ts. The real itineraries, surveyed.
const osmPath = at('data', 'osm-routes.json');
const osmRoutes: { ref: string; name: string; path: [number, number][] }[] = existsSync(osmPath) ? readJson(osmPath) : [];

/**
 * The project's line colours. Five were darkened by the least that clears WCAG AA for
 * the white 10 px number on the badge (line 2 sat at 2.94:1), keeping the hue.
 */
const KNOWN_COLORS: Record<string, string> = {
  '1.1': '#2563eb', '1.2': '#0c857a', '1.3': '#7c3aed', '1.4': '#07819e',
  '2': '#9e6c03', '3.1': '#dc2626', '3.2': '#cc4d0a', '4.1': '#be123c',
  '4.2': '#9f1239', '5.1': '#15803d', '5.2': '#166534', '5DS': '#4d7c0f',
  '5ES': '#52840b', '6': '#1d4ed8', '7': '#7e22ce', '8': '#a21caf',
  '9': '#c026d3', '10': '#475569', '11': '#78350f', '12': '#0369a1', '13': '#1e40af',
};
const FALLBACK_COLORS = ['#334155', '#b45309', '#047857', '#6d28d9', '#b91c1c', '#0f766e'];

/** Anchors used only to give each stop a coarse, filterable zone label. */
const ZONES: { name: string; lat: number; lng: number }[] = [
  { name: 'Centro / Muralla', lat: 43.0121, lng: -7.5559 },
  { name: 'Casco Histórico', lat: 43.0098, lng: -7.5562 },
  { name: 'Estación', lat: 43.0185, lng: -7.5512 },
  { name: 'A Milagrosa', lat: 43.0205, lng: -7.5606 },
  { name: 'Garabolos', lat: 43.0288, lng: -7.5721 },
  { name: 'O Ceao', lat: 43.0385, lng: -7.5671 },
  { name: 'As Gándaras', lat: 43.0395, lng: -7.546 },
  { name: 'HULA', lat: 43.0195, lng: -7.5332 },
  { name: 'Fontiñas', lat: 43.0065, lng: -7.5428 },
  { name: 'A Tolda / Montirón', lat: 43.0018, lng: -7.5401 },
  { name: 'Campus USC', lat: 42.9935, lng: -7.5538 },
  { name: 'Fingoi', lat: 42.9982, lng: -7.5492 },
  { name: 'Acea de Olga', lat: 42.9885, lng: -7.5495 },
  { name: 'Sur / Ramón Ferreiro', lat: 43.0048, lng: -7.5528 },
  { name: 'Oeste / Américas', lat: 43.0118, lng: -7.5696 },
  { name: 'Fonte dos Ranchos', lat: 43.0135, lng: -7.5672 },
  { name: 'A Piringalla', lat: 43.0265, lng: -7.5582 },
  { name: 'Casás / Abella', lat: 43.0218, lng: -7.5684 },
  { name: 'A Ponte', lat: 43.0012, lng: -7.5662 },
  { name: 'A Cheda', lat: 42.9975, lng: -7.5741 },
  { name: 'Cemiterio', lat: 43.0325, lng: -7.5812 },
  { name: 'Rural', lat: 42.95, lng: -7.5 },
];

function zoneFor(lat: number, lng: number): string {
  let best = ZONES[0];
  let bestD = Infinity;
  for (const z of ZONES) {
    const d = haversine(lat, lng, z.lat, z.lng);
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return bestD > 3000 ? 'Rural' : best.name; // far from every anchor is genuinely out of town
}

/** Metres along a polyline between two of its vertices. */
function pathLength(path: [number, number][], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to; i++) total += haversine(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
  return total;
}

/** Squared degrees to a vertex — enough to pick the nearest one. */
const near2 = (v: [number, number], stop: { lat: number; lng: number }) => (v[0] - stop.lat) ** 2 + (v[1] - stop.lng) ** 2;

/**
 * Which vertex of the drawn route each stop sits on, in route order. The match can only
 * move forward: the nearest vertex over the whole polyline matched the other pass on a
 * route that uses a street twice, and the bus was drawn backwards across the city.
 */
function stopVertices(path: [number, number][], stops: any[]): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (const stop of stops) {
    let best = cursor;
    let bestD = Infinity;
    for (let k = cursor; k < path.length; k++) {
      const d = near2(path[k], stop);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    out.push(best);
    cursor = best;
  }
  return out;
}

/**
 * The route the bus really drives, preferring the itinerary mapped in OpenStreetMap:
 * OSRM answers how a car would drive, which sent three lines the long way round the old
 * town it cannot enter. A relation is taken only if it plausibly describes THIS direction:
 * right number, right ends, every stop close to the line and falling along it in order.
 */
function realRoute(lineNumber: string, stops: any[]): { path: [number, number][]; order: number[] } | null {
  const candidates = osmRoutes.filter((r) => r.ref === lineNumber || r.ref === lineNumber.split('-')[0]);
  if (!candidates.length || stops.length < 2) return null;

  const first = stops[0];
  const last = stops[stops.length - 1];
  let best: { path: [number, number][]; ends: number } | null = null;
  for (const route of candidates) {
    const tail = route.path[route.path.length - 1];
    const ends = haversine(route.path[0][0], route.path[0][1], first.lat, first.lng) + haversine(tail[0], tail[1], last.lat, last.lng);
    if (!best || ends < best.ends) best = { path: route.path, ends };
  }
  if (!best || best.ends > 600) return null; // that relation is some other branch

  const path = best.path;
  const inOrder = stops.map((_, i) => i);

  // Reading the stops in the given order has to walk forward along the route. A published
  // coordinate is an average across pages, so a couple a few hundred metres off is ordinary;
  // a stop half a kilometre away, or many adrift at once, means this is the wrong route.
  const walksForward = (order: number[]) => {
    const vertices = stopVertices(path, order.map((i) => stops[i]));
    let adrift = 0;
    for (let k = 0; k < order.length; k++) {
      const v = path[vertices[k]];
      const off = haversine(v[0], v[1], stops[order[k]].lat, stops[order[k]].lng);
      if (off > 400) return null;
      if (off > 150) adrift++;
    }
    return adrift <= 2 ? vertices : null;
  };
  if (walksForward(inOrder)) return { path, order: inOrder };

  // The operator's page can list a stop in the wrong place (one return prints two stops
  // early that the route passes near the end, an itinerary that crosses the city four
  // times). Try the order the surveyed route implies, accepted only if it walks forward AND
  // gets dramatically shorter: the two ends never move, because a direction starts where
  // the other left the bus; the longest run already reading forward stays where the page
  // puts it, and only the stops that break it are dropped back where the route passes them.
  const along = stops.map((stop, i) => {
    let vertex = 0;
    let bestDistance = Infinity;
    for (let k = 0; k < path.length; k++) {
      const d = near2(path[k], stop);
      if (d < bestDistance) {
        bestDistance = d;
        vertex = k;
      }
    }
    return { i, vertex };
  });
  const finalIndex = along.length - 1;
  const interior = along.slice(1, finalIndex);

  const runs: number[][] = [];
  for (const item of interior) {
    let longest: number[] = [];
    for (const run of runs) {
      const tail = interior.find((x) => x.i === run[run.length - 1])!;
      if (tail.vertex <= item.vertex && run.length > longest.length) longest = run;
    }
    runs.push([...longest, item.i]);
  }
  const keep = runs.reduce((a, b) => (b.length > a.length ? b : a), []);
  const kept = new Set(keep);
  const displaced = interior.filter((x) => !kept.has(x.i)).sort((a, b) => a.vertex - b.vertex);
  const vertexOf = new Map(along.map((x) => [x.i, x.vertex]));

  const middle: number[] = [];
  let next = 0;
  for (const index of keep) {
    while (next < displaced.length && displaced[next].vertex <= vertexOf.get(index)!) middle.push(displaced[next++].i);
    middle.push(index);
  }
  while (next < displaced.length) middle.push(displaced[next++].i);
  const resorted = [along[0].i, ...middle, along[finalIndex].i];

  if (resorted.every((v, k) => v === inOrder[k]) || !walksForward(resorted)) return null;
  const span = (order: number[]) => {
    let total = 0;
    for (let k = 1; k < order.length; k++) total += haversine(stops[order[k - 1]].lat, stops[order[k - 1]].lng, stops[order[k]].lat, stops[order[k]].lng);
    return total;
  };
  const before = span(inOrder);
  const after = span(resorted);
  if (after > before * 0.7) return null;

  console.log(`        ! ${lineNumber}: moved ${displaced.length} stop(s) the page lists out of place (${(before / 1000).toFixed(1)} km of zig-zag -> ${(after / 1000).toFixed(1)} km)`);
  return { path, order: resorted };
}

/** Sum values[from..to), rounded — merges legs whose intermediate stop was collapsed. */
function sumRange(values: number[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to; i++) total += values[i] ?? 0;
  return Math.round(total);
}

function categoryFor(line: any): string {
  const text = `${line.id} ${line.name}`.toLowerCase();
  if (text.includes('hula')) return 'hospital';
  if (line.id.includes('-') || /nadela|p[ií]as|b[óo]veda|calde|santa comba|ramil/.test(text)) return 'rural';
  return 'urbano';
}

// ---- stops -------------------------------------------------------------------

const located = raw.stops.filter((s: any) => Array.isArray(s.coords));
const dropped = raw.stops.length - located.length;

// The operator numbers a stop once per line and direction, so one pole shows up under many
// `ps` ids (one interchange appears 20 times). Collapse by identity: the live-panel token
// first, then the same name within 80 m — published coordinates wobble a few metres between
// pages, while genuinely opposite poles get distinct names.
const MERGE_RADIUS_M = 80;
const canonicalByPs = new Map<number, string>();
const clusters: any[] = [];
const byToken = new Map<string, any>();

for (const s of located) {
  const [lat, lng] = s.coords;
  let stop = s.token ? byToken.get(s.token) : undefined;
  if (!stop) {
    // Identical coordinates mean the same pole even under another label (Galician and
    // Spanish spellings). Two different tokens are two panels; one side tokenless, or both,
    // can still be the same pole listed twice — nine poles once shipped as eighteen stops.
    const mergeable = (c: any) => !(c.officialToken && s.token);
    stop =
      clusters.find((c) => mergeable(c) && haversine(c.lat, c.lng, lat, lng) === 0) ||
      clusters.find((c) => mergeable(c) && c.name === s.name && haversine(c.lat, c.lng, lat, lng) <= MERGE_RADIUS_M);
  }
  if (!stop) {
    stop = {
      id: `s${s.ps}`, // the first ps seen at this pole becomes the stable id
      code: s.token || String(s.ps),
      officialIds: [] as number[],
      officialToken: s.token || null,
      name: s.name,
      aliases: [] as string[],
      lat,
      lng,
      samples: 0,
      lines: [] as string[], // filled from the itineraries below: one source of truth
      zone: '',
      // null = nobody has surveyed it. The dataset used to invent step-free access and no shelter.
      shelter: null as boolean | null,
      bench: null as boolean | null,
    };
    clusters.push(stop);
    if (s.token) byToken.set(s.token, stop);
  }

  // A pole with a live panel keeps that identity even when a tokenless twin reached the
  // cluster first; without this five poles lost their scannable code and their own label.
  if (s.token && !stop.officialToken) {
    stop.officialToken = s.token;
    stop.code = s.token;
    if (stop.name !== s.name) stop.aliases.push(stop.name);
    stop.name = s.name;
    byToken.set(s.token, stop);
  }

  // Average the published coordinates instead of trusting whichever page came first.
  stop.lat = (stop.lat * stop.samples + lat) / (stop.samples + 1);
  stop.lng = (stop.lng * stop.samples + lng) / (stop.samples + 1);
  stop.samples++;
  if (s.name !== stop.name && !stop.aliases.includes(s.name)) stop.aliases.push(s.name);
  stop.officialIds.push(s.ps);
  canonicalByPs.set(s.ps, stop.id);
}

/**
 * Poles published with no coordinates but with a live-panel token that a clustered pole
 * already carries are that pole listed again on another itinerary. Dropping all twelve
 * such listings cost line 13's return the busiest interchange in the city. Only the token
 * match is safe; the rest have no position and no known identity. tools/test.ts pins the count.
 */
const RECOVERED_BY_TOKEN = new Set<number>();
for (const s of raw.stops) {
  if (Array.isArray(s.coords) || !s.token) continue;
  const pole = byToken.get(s.token);
  if (!pole) continue;
  pole.officialIds.push(s.ps);
  canonicalByPs.set(s.ps, pole.id);
  RECOVERED_BY_TOKEN.add(s.ps);
}

// ---- the operator's pin against the surveyed pole ------------------------------------

/**
 * Coordinates are the operator's, with one exception the data itself proves: two
 * consecutive stops of one direction cannot be six metres apart, so a pin that duplicates
 * its neighbour's is a mis-entered coordinate. When a stop is in such a pair AND the OSM
 * importer recorded where the same-named pole is, that position is used and the stop says
 * so (`positionSource: 'osm'`). Either condition alone is only reported.
 */
const DUPLICATE_PIN_M = 30;
const clusterById = new Map<string, any>(clusters.map((c: any) => [c.id, c]));
const duplicatePairs: [string, string, number][] = [];
for (const line of raw.lines) {
  for (const dir of line.directions) {
    const ids = dir.stops.map((ps: number) => canonicalByPs.get(ps)).filter(Boolean) as string[];
    for (let i = 1; i < ids.length; i++) {
      const a = clusterById.get(ids[i - 1]);
      const b = clusterById.get(ids[i]);
      if (!a || !b || a === b) continue;
      const m = haversine(a.lat, a.lng, b.lat, b.lng);
      if (m < DUPLICATE_PIN_M && !duplicatePairs.some(([x, y]) => x === a.id && y === b.id)) duplicatePairs.push([a.id, b.id, m]);
    }
  }
}
const suspects = new Set(duplicatePairs.flatMap(([a, b]) => [a, b]));
const repositioned: string[] = [];

const stops = clusters.map((c) => {
  const { samples, ...rest } = c;
  const surveyed = amenities[c.id];
  const moved = suspects.has(c.id) && surveyed?.position ? surveyed.position : null;
  if (moved) repositioned.push(c.id);
  const lat = moved ? moved[0] : c.lat;
  const lng = moved ? moved[1] : c.lng;
  return {
    ...rest,
    lat: Number(lat.toFixed(7)),
    lng: Number(lng.toFixed(7)),
    ...(moved ? { positionSource: 'osm' as const } : {}),
    zone: zoneFor(lat, lng),
    shelter: surveyed?.shelter ?? null,
    bench: surveyed?.bench ?? null,
  };
});

// Nearest-anchor alone draws Voronoi cells that cut across streets; two rounds of
// majority-vote smoothing over each stop's neighbours make the zones contiguous.
for (let pass = 0; pass < 2; pass++) {
  const smoothed = stops.map((stop: any) => {
    const votes: Record<string, number> = {};
    stops
      .map((other: any) => ({ other, d: haversine(stop.lat, stop.lng, other.lat, other.lng) }))
      .sort((a: any, b: any) => a.d - b.d)
      .slice(0, 9)
      .forEach(({ other, d }: any) => {
        votes[other.zone] = (votes[other.zone] || 0) + 1 / (1 + d / 100); // closer neighbours count for more
      });
    return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  });
  stops.forEach((stop: any, i: number) => (stop.zone = smoothed[i]));
}
const collapsed = located.length - stops.length;
const stopById = new Map(stops.map((s: any) => [s.id, s]));

// ---- lines -------------------------------------------------------------------

const routeMap = new Map<string, any>(routes.map((r: any) => [`${r.lineId}|${r.direction}`, r]));
/** 5 decimals is ~1 m, plenty for a drawn polyline, and roughly halves the payload. */
const round = (p: [number, number][]) => p.map(([lat, lng]) => [Number(lat.toFixed(5)), Number(lng.toFixed(5))] as [number, number]);
const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

let fallbackIdx = 0;
let osmCount = 0;
let osrmCount = 0;
const lines = raw.lines.map((line: any) => {
  const color = KNOWN_COLORS[line.id] || KNOWN_COLORS[line.number] || FALLBACK_COLORS[fallbackIdx++ % FALLBACK_COLORS.length];

  const directions = line.directions.map((dir: any, i: number) => {
    const dirId = i === 0 ? 'ida' : 'volta';
    const geo = routeMap.get(`${line.id}|${dirId}`);

    // Map the itinerary's per-line ids onto the collapsed physical stops. The router was
    // fed only the stops that had coordinates, so its arrays are indexed against THAT
    // subset: `geoPos` walks it separately, and a pole recovered by its token (never sent
    // to the router) must not advance it.
    const kept: number[] = []; // positions in the router's arrays
    let stopIds: string[] = [];
    let geoPos = -1;
    let recovered = false;
    dir.stops.forEach((ps: number) => {
      const canonical = canonicalByPs.get(ps);
      if (!canonical) return; // no coordinates: the router never saw it either
      const routed = !RECOVERED_BY_TOKEN.has(ps);
      if (routed) geoPos++;
      if (stopIds.includes(canonical)) return; // a pole listed twice (a terminus loop) would break the leg indices
      if (routed) kept.push(geoPos);
      else recovered = true;
      stopIds.push(canonical);
    });

    stopIds.forEach((sid: string) => {
      const stop: any = stopById.get(sid);
      if (stop && !stop.lines.includes(line.id)) stop.lines.push(line.id);
    });

    let dirStops = stopIds.map((sid: string) => stopById.get(sid));
    const surveyed = realRoute(line.number, dirStops);
    if (surveyed) osmCount++;
    else if (geo) osrmCount++;

    // A repaired order, or a recovered stop the router never saw, means the router's legs
    // no longer line up one-for-one: they are dropped rather than silently mismatched, and
    // the direction's own average speed stands in.
    const reordered = Boolean(surveyed && surveyed.order.some((v, k) => v !== k)) || recovered;
    if (surveyed && reordered) {
      stopIds = surveyed.order.map((i: number) => stopIds[i]);
      dirStops = surveyed.order.map((i: number) => dirStops[i]);
    }

    const path: [number, number][] = surveyed ? round(surveyed.path) : geo ? round(geo.path) : dirStops.map((st: any) => [st.lat, st.lng] as [number, number]);
    const stopPathIndex = surveyed || geo ? stopVertices(path, dirStops) : [];

    // geo arrays are indexed by the original itinerary; re-slice them to the kept stops.
    const osrmMeters: number[] = geo ? kept.slice(0, -1).map((idx: number, k: number) => sumRange(geo.legMeters, idx, kept[k + 1])) : [];
    const osrmSeconds: number[] = geo ? kept.slice(0, -1).map((idx: number, k: number) => sumRange(geo.legSeconds, idx, kept[k + 1])) : [];

    // Distances follow whatever line is drawn; times keep the speed OSRM measured on that
    // corridor and apply it to the real length. OSM maps where a bus goes, not how long it takes.
    const legMeters: number[] = surveyed ? stopPathIndex.slice(0, -1).map((v, k) => Math.round(pathLength(path, v, stopPathIndex[k + 1]))) : osrmMeters;
    const metresPerSecond = sum(osrmSeconds) > 0 ? sum(osrmMeters) / sum(osrmSeconds) : 6;
    const legSeconds: number[] = surveyed
      ? legMeters.map((m, k) => (!reordered && osrmMeters[k] > 0 ? Math.round((osrmSeconds[k] * m) / osrmMeters[k]) : Math.round(m / metresPerSecond)))
      : osrmSeconds;

    return {
      id: dirId,
      name: `Sentido ${dir.destination}`,
      origin: dir.origin,
      destination: dir.destination,
      stops: stopIds,
      geometrySource: surveyed ? 'osm' : geo ? 'osrm' : 'straight',
      pathCoordinates: path,
      stopPathIndex,
      legMeters,
      legSeconds,
      totalMeters: sum(legMeters),
    };
  });

  return {
    id: line.id,
    number: line.number,
    name: line.name,
    color,
    textColor: '#ffffff',
    category: categoryFor(line),
    days: line.days,
    frequency: line.frequency,
    firstDeparture: line.firstDeparture,
    lastDeparture: line.lastDeparture,
    description: `${line.name}. ${line.days}. ${line.frequency}.`,
    services: line.services || [],
    directions,
  };
});

// A stop nothing serves is dead weight in every list and filter.
const served = stops.filter((s: any) => s.lines.length > 0);
const orphaned = stops.length - served.length;

// Route geometry is 92% of the line data and only needed once a map is on screen, so it ships as its own file.
const geometry: Record<string, { path: [number, number][]; stopPathIndex: number[] }> = {};
const slimLines = lines.map((line: any) => ({
  ...line,
  directions: line.directions.map((dir: any) => {
    const { pathCoordinates, stopPathIndex, ...rest } = dir;
    if (stopPathIndex?.length) geometry[`${line.id}|${dir.id}`] = { path: pathCoordinates, stopPathIndex };
    return rest;
  }),
}));

// Refuse to replace good data with a bad scrape: a tenth of the stops or lines going missing
// is a broken run, not a timetable change, and writing it would destroy the working files.
for (const [file, built] of [['stops.json', served], ['lines.json', slimLines]] as const) {
  const path = at('src', 'data', file);
  const before = existsSync(path) ? (readJson<unknown[]>(path)).length : 0;
  if (built.length < before * 0.9) throw new Error(`${file}: built ${built.length}, previously ${before}. That is a broken run, not a timetable change — nothing written.`);
}

writeJson(at('src', 'data', 'stops.json'), served);
writeJson(at('src', 'data', 'lines.json'), slimLines);
writeJson(at('src', 'data', 'route-geometry.json'), geometry, false);

console.log(`stops : ${served.length} physical poles written`);
console.log(`        ${collapsed} duplicate operator ids collapsed, ${dropped} without coordinates, ${orphaned} served by no line`);
console.log(`        ${repositioned.length} placed at the pole OSM surveys under the same name, the operator's pin duplicating a neighbour's: ${repositioned.join(', ') || 'none'}`);
for (const [a, b, m] of duplicatePairs) {
  if (!repositioned.includes(a) && !repositioned.includes(b)) console.log(`        left as published: ${a} and ${b} are ${Math.round(m)} m apart in one direction`);
}
console.log(`lines : ${lines.length} written`);
console.log(`routes: ${Object.keys(geometry).length} directions with street geometry`);
console.log(`        ${osmCount} drawn from the itinerary surveyed in OSM, ${osrmCount} from OSRM`);
console.log(`sizes : lines.json ${(JSON.stringify(slimLines).length / 1024).toFixed(0)} KB (bundled) + route-geometry.json ${(JSON.stringify(geometry).length / 1024).toFixed(0)} KB (lazy)`);
