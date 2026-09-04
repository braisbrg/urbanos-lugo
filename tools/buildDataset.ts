/**
 * Turns the scraped official data + snapped street geometry into the two files the
 * app actually reads: src/data/stops.json and src/data/lines.json. Its inputs live in
 * data/, outside src/, because nothing in the application imports them.
 *
 *   npx tsx tools/importOfficialData.ts   # fetch (slow, cached)
 *   npx tsx tools/buildDataset.ts         # shape (fast, offline)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDistanceMeters as haversine } from '../src/utils/geo';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '../src/data');
/** Build inputs, outside src/ because the application never imports them. */
const RAW = join(HERE, '../data');

const raw = JSON.parse(readFileSync(join(RAW, 'official-raw.json'), 'utf8'));
// Optional: written by tools/importStopAmenities.ts from OpenStreetMap surveys.
const amenitiesPath = join(RAW, 'stop-amenities.json');
const amenities: Record<string, { shelter: boolean | null; bench: boolean | null; tactilePaving: boolean | null }> =
  existsSync(amenitiesPath) ? JSON.parse(readFileSync(amenitiesPath, 'utf8')) : {};
const routes = JSON.parse(readFileSync(join(RAW, 'routes.json'), 'utf8'));
// Optional: written by tools/importOsmRoutes.ts. The real itineraries, surveyed.
const osmPath = join(RAW, 'osm-routes.json');
const osmRoutes: { ref: string; name: string; path: [number, number][] }[] = existsSync(osmPath)
  ? JSON.parse(readFileSync(osmPath, 'utf8'))
  : [];

/**
 * Colours the project already used, so existing screenshots and habits still hold —
 * except five that were unreadable.
 *
 * A line badge is white text on the line's colour at 10 px, and the number on it is the
 * single most important thing in the app. Five of the twenty-four failed WCAG AA for
 * small text: line 2 sat at 2.94:1 against the 4.5 needed. Each is darkened by the least
 * that clears the bar — 10% to 22%, keeping the hue — so the badge stays recognisable
 * and stays legible at a stop in daylight.
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
  // Anything far from every anchor is genuinely out of town.
  return bestD > 3000 ? 'Rural' : best.name;
}

/** Sum values[from..to) — used to merge legs whose intermediate stop was collapsed. */
/**
 * Which vertex of the drawn route each stop sits on, in route order.
 *
 * The match can only move forward. Taking the nearest vertex over the whole polyline
 * broke on any route that uses a street twice — three directions had a stop matched to
 * the wrong pass, so its index landed behind the previous stop's. A bus interpolating
 * between that pair travelled the polyline backwards and appeared to cross the city off
 * its own line.
 */
/** Metres along a polyline between two of its vertices. */
function pathLength(path: [number, number][], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to; i++) total += haversine(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
  return total;
}

/**
 * The route the bus really drives, preferring the itinerary mapped in OpenStreetMap.
 *
 * OSRM answers "how would a car drive between these points", which is a different
 * question. It sent lines 8, 9 and 12 the long way round the muralla — 2127 m for a
 * 372 m hop — because a car cannot enter the old town, and it drove line 5.1's return
 * out and back for 28 km against a real 10 km wherever a pole sat slightly out of order.
 *
 * An OSM relation is only taken if it plausibly describes THIS direction: right line
 * number, ends where this direction ends, every stop close to the line, and stops
 * falling along it in order. Anything short of that keeps the OSRM trace, which is at
 * least a real road.
 */
function realRoute(lineNumber: string, stops: any[]): { path: [number, number][]; order: number[] } | null {
  const candidates = osmRoutes.filter((r) => r.ref === lineNumber || r.ref === lineNumber.split('-')[0]);
  if (!candidates.length || stops.length < 2) return null;

  const first = stops[0];
  const last = stops[stops.length - 1];
  let best: { path: [number, number][]; ends: number } | null = null;
  for (const route of candidates) {
    const ends =
      haversine(route.path[0][0], route.path[0][1], first.lat, first.lng) +
      haversine(route.path[route.path.length - 1][0], route.path[route.path.length - 1][1], last.lat, last.lng);
    if (!best || ends < best.ends) best = { path: route.path, ends };
  }
  if (!best || best.ends > 600) return null; // that relation is some other branch

  const path = best.path;
  const inOrder = stops.map((_, i) => i);

  // Reading the stops in the operator's order has to walk forward along the route. A
  // relation drawn end-to-start would pass a distance test and then place everything
  // backwards, so this is checked before anything else is believed.
  // A published stop coordinate is the average of what the operator prints across pages,
  // so a couple sitting a few hundred metres from the surveyed line is ordinary. A stop
  // half a kilometre away, or many of them adrift at once, means this is the wrong route.
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

  // The operator's own page can list a stop in the wrong place. Line 5.1's return prints
  // Fonte dos Ranchos and Doutor Gasalla third and fifth, when the route passes them near
  // the end: both sit within 110 m of the surveyed line, just much later along it. Taken
  // literally that itinerary crosses the city four times for 28 km, against a real 10 km,
  // and no timetable printing 20 minutes for it could be true.
  //
  // So where the page order fails, try the order the surveyed route implies. It is only
  // accepted if it walks forward AND the itinerary gets dramatically shorter — a modest
  // gain would more likely mean this reader is wrong than the operator.
  const along = stops.map((stop, i) => {
    let bestVertex = 0;
    let bestDistance = Infinity;
    for (let k = 0; k < path.length; k++) {
      const d = (path[k][0] - stop.lat) ** 2 + (path[k][1] - stop.lng) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        bestVertex = k;
      }
    }
    return { i, vertex: bestVertex };
  });
  // Keep as much of the operator's order as can possibly stand, and never touch the two
  // ends. A direction's first stop is where the other direction left the bus standing —
  // 5.1 outbound finishes at HULA (Ent. Principal), so its return starts there, and any
  // reordering that says otherwise has the bus jumping 651 m backwards before it moves.
  // The surveyed line passes Ent. Personal before Ent. Principal because the relation
  // draws the hospital loop once, on the way in; the bus passes it again on the way out.
  //
  // Everything between the ends: the longest run that already reads forward along the
  // route stays where the page puts it, and only the stops that break it are lifted out
  // and dropped back where the route passes them, clamped inside the two termini.
  const finalIndex = along.length - 1;
  const interior = along.slice(1, finalIndex);

  const runs: number[][] = [];
  for (const item of interior) {
    let best: number[] = [];
    for (const run of runs) {
      const tail = interior.find((x) => x.i === run[run.length - 1])!;
      if (tail.vertex <= item.vertex && run.length > best.length) best = run;
    }
    runs.push([...best, item.i]);
  }
  const keep = runs.reduce((a, b) => (b.length > a.length ? b : a), []);
  const kept = new Set(keep);

  const displaced = interior.filter((x) => !kept.has(x.i)).sort((a, b) => a.vertex - b.vertex);
  const vertexOf = new Map(along.map((x) => [x.i, x.vertex]));

  const middle: number[] = [];
  let next = 0;
  for (const index of keep) {
    while (next < displaced.length && displaced[next].vertex <= vertexOf.get(index)!) {
      middle.push(displaced[next++].i);
    }
    middle.push(index);
  }
  while (next < displaced.length) middle.push(displaced[next++].i);

  const resorted = [along[0].i, ...middle, along[finalIndex].i];

  if (resorted.every((v, k) => v === inOrder[k])) return null;
  if (!walksForward(resorted)) return null;

  const span = (order: number[]) => {
    let total = 0;
    for (let k = 1; k < order.length; k++) {
      const a = stops[order[k - 1]];
      const b = stops[order[k]];
      total += haversine(a.lat, a.lng, b.lat, b.lng);
    }
    return total;
  };
  const before = span(inOrder);
  const after = span(resorted);
  if (after > before * 0.7) return null;

  console.log(
    `        ! ${lineNumber}: moved ${displaced.length} stop(s) the page lists out of place ` +
      `(${(before / 1000).toFixed(1)} km of zig-zag -> ${(after / 1000).toFixed(1)} km)`,
  );
  return { path, order: resorted };
}

function stopVertices(path: [number, number][], stops: any[]): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (const stop of stops) {
    let best = cursor;
    let bestD = Infinity;
    for (let k = cursor; k < path.length; k++) {
      const d = (path[k][0] - stop.lat) ** 2 + (path[k][1] - stop.lng) ** 2;
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

function sumRange(values: number[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to; i++) total += values[i] ?? 0;
  return Math.round(total);
}

function categoryFor(line: any): string {
  const text = `${line.id} ${line.name}`.toLowerCase();
  if (text.includes('hula')) return 'hospital';
  if (line.id.includes('-')) return 'rural';
  if (/nadela|p[ií]as|b[óo]veda|calde|santa comba|ramil/.test(text)) return 'rural';
  if (/campus|veterinaria|humanidades/.test(text)) return 'urbano';
  return 'urbano';
}

// ---- stops -------------------------------------------------------------------

const located = raw.stops.filter((s: any) => Array.isArray(s.coords));
const dropped = raw.stops.length - located.length;

// The operator numbers a stop once per line and per direction, so the same physical
// pole shows up under many `ps` ids: Sindicatos alone appears 20 times at one identical
// coordinate. Collapse them by position, or the app counts 1198 stops where the city
// has ~430, and every stop list, zone filter and nearest-stop search is skewed.
// The operator's live-panel token is the pole's real identity, so it groups first. For
// poles with no token, the same name within 80 m is the same pole: the published
// coordinates wobble by a few metres between pages, while genuinely opposite poles get
// distinct names ("... (enfte. ...)"). 80 m keeps the two apart.
const MERGE_RADIUS_M = 80;
const canonicalByPs = new Map<number, string>();
const clusters: any[] = [];
const byToken = new Map<string, any>();

for (const s of located) {
  const [lat, lng] = s.coords;

  let stop = s.token ? byToken.get(s.token) : undefined;
  if (!stop) {
    // Identical coordinates mean the same pole even when the label differs: the site
    // publishes some stops in Galician and Spanish ("Facultade" / "Facultad").
    // Two tokens that differ are two panels, so two poles. Anything else — one side
    // tokenless, or both — can still be the same pole listed twice, and it was: nine
    // poles shipped as eighteen stops because one entry carried a live-panel token and
    // its twin did not, at identical published coordinates under an identical name.
    const mergeable = (c: any) => !(c.officialToken && s.token);
    stop =
      clusters.find((c) => mergeable(c) && haversine(c.lat, c.lng, lat, lng) === 0) ||
      clusters.find(
        (c) => mergeable(c) && c.name === s.name && haversine(c.lat, c.lng, lat, lng) <= MERGE_RADIUS_M,
      );
  }

  if (!stop) {
    stop = {
      id: `s${s.ps}`, // the first ps seen at this pole becomes the stable id
      code: s.token || String(s.ps),
      /** Every operator id that points at this physical pole, so any QR link resolves. */
      officialIds: [] as number[],
      officialToken: s.token || null,
      name: s.name,
      /** Every other label the operator prints for this pole. */
      aliases: [] as string[],
      lat,
      lng,
      samples: 0,
      lines: [] as string[], // filled from the itineraries below: one source of truth
      zone: '',
      // null = nobody has surveyed it. The dataset used to claim every stop had step-free
      // access and no shelter, both invented.
      shelter: null as boolean | null,
      bench: null as boolean | null,
    };
    clusters.push(stop);
    if (s.token) byToken.set(s.token, stop);
  }

  // A pole with a live panel keeps that identity even when a tokenless twin reached the
  // cluster first: without this, merging cost five poles their scannable code and left
  // them under the twin's label — "As Pedreiras" became "Opuesto Piscina Pedreiras".
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

const stops = clusters.map((c) => {
  const { samples, ...rest } = c;
  const surveyed = amenities[c.id];
  return {
    ...rest,
    lat: Number(c.lat.toFixed(7)),
    lng: Number(c.lng.toFixed(7)),
    zone: zoneFor(c.lat, c.lng),
    shelter: surveyed?.shelter ?? null,
    bench: surveyed?.bench ?? null,
  };
});

// Nearest-anchor alone draws Voronoi cells that cut across streets, so consecutive
// stops on Avda. Magoi landed in "A Ponte" and "Campus USC". Two rounds of
// majority-vote smoothing over each stop's neighbours make the zones contiguous
// without inventing a street-to-district table.
for (let pass = 0; pass < 2; pass++) {
  const smoothed = stops.map((stop: any) => {
    const votes: Record<string, number> = {};
    stops
      .map((other: any) => ({ other, d: haversine(stop.lat, stop.lng, other.lat, other.lng) }))
      .sort((a: any, b: any) => a.d - b.d)
      .slice(0, 9)
      .forEach(({ other, d }: any) => {
        // Closer neighbours count for more; the stop itself dominates its own vote.
        votes[other.zone] = (votes[other.zone] || 0) + 1 / (1 + d / 100);
      });
    return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  });
  stops.forEach((stop: any, i: number) => (stop.zone = smoothed[i]));
}
const collapsed = located.length - stops.length;
const stopById = new Map(stops.map((s: any) => [s.id, s]));

// ---- lines -------------------------------------------------------------------

const routeKey = (lineId: string, dir: string) => `${lineId}|${dir}`;
const routeMap = new Map<string, any>(routes.map((r: any) => [routeKey(r.lineId, r.direction), r]));

let fallbackIdx = 0;
let osmCount = 0;
let osrmCount = 0;
const lines = raw.lines.map((line: any) => {
  const color = KNOWN_COLORS[line.id] || KNOWN_COLORS[line.number] || FALLBACK_COLORS[fallbackIdx++ % FALLBACK_COLORS.length];

  const directions = line.directions.map((dir: any, i: number) => {
    const dirId = i === 0 ? 'ida' : 'volta';
    const geo = routeMap.get(routeKey(line.id, dirId));

    // Map the itinerary's per-line ids onto the collapsed physical stops.
    //
    // The router was fed only the stops that had coordinates, so its arrays are indexed
    // against THAT subset, not against dir.stops. Walk the itinerary keeping a separate
    // counter for the router's indexing, or every leg lines up with the wrong pair of
    // stops further down the route.
    const kept: number[] = []; // positions in the router's arrays
    let stopIds: string[] = [];
    let geoPos = -1;
    dir.stops.forEach((ps: number) => {
      const canonical = canonicalByPs.get(ps);
      if (!canonical) return; // stop had no coordinates: the router never saw it either
      geoPos++;
      // A pole listed twice in one direction (a terminus loop) would break the leg
      // indices and every "how many stops away" count downstream.
      if (stopIds.includes(canonical)) return;
      kept.push(geoPos);
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

    // A repaired order changes which stop each of the router's legs belongs to, so those
    // legs are dropped rather than silently mismatched; the direction's own average speed
    // stands in for them.
    const reordered = Boolean(surveyed && surveyed.order.some((v, k) => v !== k));
    if (surveyed && reordered) {
      stopIds = surveyed.order.map((i: number) => stopIds[i]);
      dirStops = surveyed.order.map((i: number) => dirStops[i]);
    }

    // 5 decimals is ~1 m, plenty for a drawn polyline, and roughly halves the payload
    // every visitor downloads.
    const round = (p: [number, number][]) =>
      p.map(([lat, lng]) => [Number(lat.toFixed(5)), Number(lng.toFixed(5))] as [number, number]);

    const path: [number, number][] = surveyed
      ? round(surveyed.path)
      : geo
        ? round(geo.path)
        : dirStops.map((st: any) => [st.lat, st.lng] as [number, number]);

    const stopPathIndex = surveyed || geo ? stopVertices(path, dirStops) : [];

    // geo arrays are indexed by the original itinerary; re-slice them to the kept stops.
    const osrmMeters: number[] = geo
      ? kept.slice(0, -1).map((idx: number, k: number) => sumRange(geo.legMeters, idx, kept[k + 1]))
      : [];
    const osrmSeconds: number[] = geo
      ? kept.slice(0, -1).map((idx: number, k: number) => sumRange(geo.legSeconds, idx, kept[k + 1]))
      : [];

    // Distances follow whatever line is actually drawn, so what the app says and what it
    // shows agree. Times keep the speed OSRM measured on that corridor and apply it to
    // the real length: OSM maps where a bus goes, not how long it takes to get there.
    const legMeters: number[] = surveyed
      ? stopPathIndex.slice(0, -1).map((v, k) => Math.round(pathLength(path, v, stopPathIndex[k + 1])))
      : osrmMeters;
    const metresPerSecond =
      osrmSeconds.reduce((n, x) => n + x, 0) > 0
        ? osrmMeters.reduce((n, x) => n + x, 0) / osrmSeconds.reduce((n, x) => n + x, 0)
        : 6;
    const legSeconds: number[] = surveyed
      ? legMeters.map((m, k) =>
          !reordered && osrmMeters[k] > 0
            ? Math.round((osrmSeconds[k] * m) / osrmMeters[k])
            : Math.round(m / metresPerSecond),
        )
      : osrmSeconds;

    return {
      id: dirId,
      name: `Sentido ${dir.destination}`,
      origin: dir.origin,
      destination: dir.destination,
      stops: stopIds,
      /** Where the drawn line comes from: 'osm' is a surveyed itinerary, 'osrm' a guess. */
      geometrySource: surveyed ? 'osm' : geo ? 'osrm' : 'straight',
      pathCoordinates: path,
      stopPathIndex,
      legMeters,
      legSeconds,
      totalMeters: legMeters.reduce((n: number, m: number) => n + m, 0),
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

// Route geometry is 92% of the line data but is only needed once a map is on screen,
// so it ships as a separate file the app fetches on demand.
const geometry: Record<string, { path: [number, number][]; stopPathIndex: number[] }> = {};
const slimLines = lines.map((line: any) => ({
  ...line,
  directions: line.directions.map((dir: any) => {
    const { pathCoordinates, stopPathIndex, ...rest } = dir;
    if (stopPathIndex?.length) geometry[`${line.id}|${dir.id}`] = { path: pathCoordinates, stopPathIndex };
    return rest;
  }),
}));

// Refuse to replace good data with a bad scrape.
//
// Everything the app shows comes out of these files. A page that changed shape, a
// half-finished download, or a parse that silently matched nothing all arrive here as a
// much smaller dataset, and writing it destroys the working one before any test gets a
// chance to complain. A tenth of the stops or lines going missing is not a timetable
// change; it is a broken run.
const previousCount = (file: string): number => {
  const path = join(DATA, file);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown[]).length : 0;
};

for (const [file, built] of [['stops.json', served], ['lines.json', slimLines]] as const) {
  const before = previousCount(file);
  if (built.length < before * 0.9) {
    throw new Error(
      `${file}: built ${built.length}, previously ${before}. That is a broken run, not a ` +
        `timetable change — nothing written.`,
    );
  }
}

writeFileSync(join(DATA, 'stops.json'), JSON.stringify(served, null, 2) + '\n');
writeFileSync(join(DATA, 'lines.json'), JSON.stringify(slimLines, null, 2) + '\n');
writeFileSync(join(DATA, 'route-geometry.json'), JSON.stringify(geometry) + '\n');

console.log(`stops : ${served.length} physical poles written`);
console.log(`        ${collapsed} duplicate operator ids collapsed, ${dropped} without coordinates, ${orphaned} served by no line`);
console.log(`lines : ${lines.length} written`);
const geometryKb = (JSON.stringify(geometry).length / 1024).toFixed(0);
const linesKb = (JSON.stringify(slimLines).length / 1024).toFixed(0);
console.log(`routes: ${Object.keys(geometry).length} directions with street geometry`);
console.log(`        ${osmCount} drawn from the itinerary surveyed in OSM, ${osrmCount} from OSRM`);
console.log(`sizes : lines.json ${linesKb} KB (bundled) + route-geometry.json ${geometryKb} KB (lazy)`);
