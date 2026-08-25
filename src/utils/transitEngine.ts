import { BUS_STOPS, BUS_LINES, FARES } from '../data/transitData';
import { daysLabel } from './serviceLabels';
import { Lang, translations } from '../i18n';
import { BusStop, BusLine, StopArrival, ScheduledBus, RoutePlanResult, TripFare } from '../types';
import { matchesQuery, calculateRelevanceScore } from './searchUtils';
import { MINUTES_PER_DAY, anchorIndex, buildRuns, dayKind, formatMinutes, lineRunsOn, parseTimeToMinutes } from './schedule';

// Haversine distance in meters
export function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Offline fallback for how long a walk takes.
 *
 * Measured against 120 real pedestrian routes in Lugo (`npm run calibrate:walking`):
 * the detour over the straight line ranges from 1.03 to 2.38 with a median of 1.26, and
 * the router walks at 75 m/min. The spread is the point — the wall, the river and the
 * railway force detours no single number can predict, so the worst case is ~14 minutes
 * out whatever constant is chosen.
 *
 * 1.35 is therefore deliberately above the median: it over-states by 2 minutes on
 * average and leaves 24% of walks under-stated, against 51% at the median value. Being
 * told a walk is slightly longer than it is beats missing the bus.
 *
 * When there is a connection the app asks the real router instead — see
 * services/walkingPath.ts — and shows the true figure.
 */
const WALK_DETOUR_FACTOR = 1.35;
const WALK_METRES_PER_MINUTE = 75;

export function estimateWalk(straightLineMeters: number): { meters: number; minutes: number } {
  const meters = Math.round(straightLineMeters * WALK_DETOUR_FACTOR);
  return { meters, minutes: Math.max(1, Math.round(meters / WALK_METRES_PER_MINUTE)) };
}

// Calibrated Key Points of Interest / Streets in Lugo for intelligent geocoding like Moovit/Maps
export const LUGO_LANDMARKS = [
  { name: 'Praza Maior / Concello de Lugo', lat: 43.0098, lng: -7.5562, zone: 'Casco Histórico' },
  { name: 'Catedral de Lugo (Porta de Santiago)', lat: 43.0084, lng: -7.5583, zone: 'Casco Histórico' },
  { name: 'Praza de Santo Domingo', lat: 43.0112, lng: -7.5552, zone: 'Casco Histórico' },
  { name: 'Rúa da Raiña / Praza de España', lat: 43.0104, lng: -7.5568, zone: 'Casco Histórico' },
  { name: 'Estación de Autobuses de Lugo (Praza da Constitución)', lat: 43.00834, lng: -7.55342, zone: 'Centro' },
  { name: 'Estación de Ferrocarril Adif (Praza Conde Fontao)', lat: 43.0151, lng: -7.55216, zone: 'Estación Tren' },
  { name: 'Centro Comercial As Termas', lat: 43.03682, lng: -7.56956, zone: 'As Termas' },
  { name: 'Parque Rosalía de Castro', lat: 43.00581, lng: -7.55957, zone: 'Sur' },
  { name: 'Parque da Milagrosa', lat: 43.0205, lng: -7.5606, zone: 'A Milagrosa' },
  { name: 'Pazo de Feiras e Congresos de Lugo', lat: 43.00312, lng: -7.56828, zone: 'Ribeira Miño' },
  { name: 'Complexo Deportivo Palomar / Ancar', lat: 43.00391, lng: -7.57247, zone: 'Oeste' },
  { name: 'Piscina Municipal As Pedreiras', lat: 42.99154, lng: -7.54363, zone: 'Acea de Olga' },
  { name: 'Pazo Provincial dos Deportes (CB Breogán)', lat: 42.99125, lng: -7.54534, zone: 'Acea de Olga' },
  { name: 'Centro Comercial Abella (Antigo)', lat: 43.01502, lng: -7.57388, zone: 'Casás' },
  { name: 'Intercentros Campus Universitario USC', lat: 42.9935, lng: -7.5538, zone: 'Campus' },
  { name: 'Facultade de Veterinaria USC', lat: 42.9948, lng: -7.5463, zone: 'Campus' },
  { name: 'Hospital Lucus Augusti (HULA)', lat: 43.0197, lng: -7.5327, zone: 'HULA' },
  { name: 'Rolda das Fontiñas', lat: 43.0065, lng: -7.5428, zone: 'Fontiñas' },
  { name: 'Avenida da Coruña', lat: 43.0205, lng: -7.5606, zone: 'A Milagrosa' },
  { name: 'Avenida Ramón Ferreiro', lat: 43.0048, lng: -7.5528, zone: 'Sur' },
  { name: 'Avenida de Magoi', lat: 42.9982, lng: -7.5492, zone: 'Fingoi' },
  { name: 'Avenida das Américas', lat: 43.0118, lng: -7.5696, zone: 'Oeste' },
  { name: 'Fonte dos Ranchos', lat: 43.0135, lng: -7.5672, zone: 'Oeste' },
  { name: 'Barrio da Ponte / Ponte Romana', lat: 43.0012, lng: -7.5662, zone: 'A Ponte' },
  { name: 'A Piringalla (Rúa Lavandeira)', lat: 43.0265, lng: -7.5582, zone: 'A Piringalla' },
  { name: 'Polígono Industrial O Ceao (ITV)', lat: 43.0440, lng: -7.5692, zone: 'O Ceao' },
  { name: 'Polígono As Gándaras', lat: 43.0340, lng: -7.5551, zone: 'As Gándaras' },
  { name: 'Cemiterio Municipal San Froilán', lat: 42.9855, lng: -7.5807, zone: 'Cemiterio' },
];

/**
 * The handful of places most trips in Lugo are to or from, offered as one tap in the
 * planner.
 *
 * `query` has to be a name `resolveLocationQuery` actually finds — the label is short
 * enough to fit on a chip, the query is the full name in the data. They are kept here
 * rather than in the component so `npm test` can check every one of them still resolves,
 * and that no two point at the same place: "Rda. Muralla" quietly carried Praza Maior's
 * query for a while, so two differently-labelled buttons went to the same square.
 */
export const QUICK_DESTINATIONS: { label: string; query: string }[] = [
  { label: 'Hospital HULA', query: 'Hospital Lucus Augusti (HULA)' },
  { label: 'Campus USC', query: 'Intercentros Campus Universitario USC' },
  { label: 'Rda. Muralla', query: 'Rda. Muralla 56 (Sindicatos)' },
  { label: 'CC As Termas', query: 'Centro Comercial As Termas' },
  { label: 'Estación Adif', query: 'Estación de Ferrocarril Adif (Praza Conde Fontao)' },
  { label: 'Praza Maior', query: 'Praza Maior / Concello de Lugo' },
  { label: 'Polígono O Ceao', query: 'Polígono Industrial O Ceao (ITV)' },
  { label: 'Fonte dos Ranchos', query: 'Fonte dos Ranchos' },
];

interface LocationResolution {
  name: string;
  lat: number;
  lng: number;
  nearestStop: BusStop;
  walkMeters: number;
  walkMinutes: number;
  isCustomLocation: boolean;
}

/**
 * Nearest stop to a point, with how far it is to WALK there — not how far it is as the
 * crow flies. The field was called `distanceMeters`, which read as a measurement and was
 * printed as one; it has always been `estimateWalk()`, the straight line inflated by the
 * calibrated detour factor. The name now says which of the two it is.
 */
export function getNearestStopToCoords(lat: number, lng: number): { stop: BusStop; walkMeters: number; walkMinutes: number } {
  let closest = BUS_STOPS[0];
  let minDistance = Infinity;

  for (const stop of BUS_STOPS) {
    const dist = getDistanceMeters(lat, lng, stop.lat, stop.lng);
    if (dist < minDistance) {
      minDistance = dist;
      closest = stop;
    }
  }

  const walk = estimateWalk(minDistance);
  return { stop: closest, walkMeters: walk.meters, walkMinutes: walk.minutes };
}

// Resolve user input (which can be a stop ID, a stop code, a street name, or a landmark)
export function resolveLocationQuery(
  query: string,
  userGps?: [number, number],
  lang: Lang = 'gl',
): LocationResolution | null {
  const q = query.trim();

  // If query is "my_location" or "gps"
  if ((q === 'my_location' || q === 'gps' || matchesQuery(q, 'mi ubicacion') || matchesQuery(q, 'a mina localizacion')) && userGps) {
    const nearest = getNearestStopToCoords(userGps[0], userGps[1]);
    return {
      name: translations(lang).map.myLocation,
      lat: userGps[0],
      lng: userGps[1],
      nearestStop: nearest.stop,
      walkMeters: nearest.walkMeters,
      walkMinutes: nearest.walkMinutes,
      isCustomLocation: true,
    };
  }

  // Check if query contains an explicit code (e.g. "Cód. 605" or "101")
  const codeMatch = q.match(/\b(?:cód\.?|cod\.?|#)?\s*(\d{3})\b/i);
  if (codeMatch) {
    const code = codeMatch[1];
    const matchByCode = BUS_STOPS.find((s) => s.code === code);
    if (matchByCode) {
      return {
        name: matchByCode.name,
        lat: matchByCode.lat,
        lng: matchByCode.lng,
        nearestStop: matchByCode,
        walkMeters: 0,
        walkMinutes: 0,
        isCustomLocation: false,
      };
    }
  }

  // Rank all bus stops by relevance
  const stopCandidates = BUS_STOPS.map((s) => ({
    stop: s,
    score: Math.max(
      calculateRelevanceScore(s.name, s.code, s.id, q, s.address),
      ...(s.aliases ?? []).map((a) => calculateRelevanceScore(a, s.code, s.id, q, s.address)),
    ),
  })).filter((c) => c.score > 0).sort((a, b) => b.score - a.score);

  if (stopCandidates.length > 0 && stopCandidates[0].score >= 300) {
    const bestStop = stopCandidates[0].stop;
    return {
      name: bestStop.name,
      lat: bestStop.lat,
      lng: bestStop.lng,
      nearestStop: bestStop,
      walkMeters: 0,
      walkMinutes: 0,
      isCustomLocation: false,
    };
  }

  // Rank landmarks
  const landmarkCandidates = LUGO_LANDMARKS.map((lm) => ({
    landmark: lm,
    score: calculateRelevanceScore(lm.name, '', '', q, lm.zone),
  })).filter((c) => c.score > 0).sort((a, b) => b.score - a.score);

  if (landmarkCandidates.length > 0) {
    const lm = landmarkCandidates[0].landmark;
    const nearest = getNearestStopToCoords(lm.lat, lm.lng);
    return {
      name: lm.name,
      lat: lm.lat,
      lng: lm.lng,
      nearestStop: nearest.stop,
      walkMeters: nearest.walkMeters,
      walkMinutes: nearest.walkMinutes,
      isCustomLocation: true,
    };
  }

  if (stopCandidates.length > 0) {
    const bestStop = stopCandidates[0].stop;
    return {
      name: bestStop.name,
      lat: bestStop.lat,
      lng: bestStop.lng,
      nearestStop: bestStop,
      walkMeters: 0,
      walkMinutes: 0,
      isCustomLocation: false,
    };
  }

  // Last chance: match on words rather than on prefix score.
  //
  // `calculateRelevanceScore` ranks by how the query lines up with the start of a name,
  // which misses a query whose words are simply spread through it — "Campus USC" against
  // "Intercentros Campus Universitario USC" scores zero. Five of the eight quick
  // destinations in the planner failed exactly this way and, thanks to the old
  // BUS_STOPS[0] fallback, silently planned the trip from a stop nobody asked for.
  const byWords = LUGO_LANDMARKS.find((lm) => matchesQuery(lm.name, q) || matchesQuery(lm.zone, q));
  if (byWords) {
    const nearest = getNearestStopToCoords(byWords.lat, byWords.lng);
    return {
      name: byWords.name,
      lat: byWords.lat,
      lng: byWords.lng,
      nearestStop: nearest.stop,
      walkMeters: nearest.walkMeters,
      walkMinutes: nearest.walkMinutes,
      isCustomLocation: true,
    };
  }

  // Aliases count as the stop's own name: merging two listings into one pole must not
  // make a label the operator still prints unfindable.
  const stopByWords = BUS_STOPS.find(
    (stop) => matchesQuery(stop.name, q) || (stop.aliases ?? []).some((a) => matchesQuery(a, q)),
  );
  if (stopByWords) {
    return {
      name: stopByWords.name,
      lat: stopByWords.lat,
      lng: stopByWords.lng,
      nearestStop: stopByWords,
      walkMeters: 0,
      walkMinutes: 0,
      isCustomLocation: false,
    };
  }

  // Nothing matched.
  //
  // This used to return BUS_STOPS[0] — an arbitrary stop — while keeping whatever the
  // reader typed as the `name`, so a query the app did not understand came back as a
  // confident itinerary from a place nobody asked about. Saying "not found" is the only
  // honest answer, and the planner has a message for it.
  return null;
}

// Resolve a stop from an id, an official code/QR token, or free text.
export function findStop(query: string): BusStop | undefined {
  const q = query.trim();
  const lower = q.toLowerCase();

  const exact =
    BUS_STOPS.find((s) => s.id.toLowerCase() === lower) ||
    BUS_STOPS.find((s) => s.code.toLowerCase() === lower) ||
    BUS_STOPS.find((s) => s.officialIds?.some((id) => String(id) === q));
  if (exact) return exact;

  const ranked = BUS_STOPS.map((s) => ({
    stop: s,
    score: Math.max(
      calculateRelevanceScore(s.name, s.code, s.id, q, s.address),
      ...(s.aliases ?? []).map((a) => calculateRelevanceScore(a, s.code, s.id, q, s.address)),
    ),
  }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.stop;
}

/**
 * Expected crowding, from the time of day alone. There is no occupancy feed, so this is
 * a prior, not a measurement — every surface that shows it labels it as expected.
 */
function occupancyAt(minutes: number): 'low' | 'medium' | 'high' {
  const peak = (minutes >= 7 * 60 + 30 && minutes <= 9 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60) || (minutes >= 18 * 60 && minutes <= 20 * 60);
  const quiet = minutes < 7 * 60 + 30 || minutes > 21 * 60;
  return peak ? 'high' : quiet ? 'low' : 'medium';
}

/**
 * How far ahead a departure board looks. Past this the answer people want is
 * "first bus at 07:15", not "next bus in 195 min", so the board goes empty and the
 * view shows the service notice instead.
 */
const ARRIVALS_HORIZON_MINUTES = 120;

/**
 * Next arrivals at a stop, taken from the operator's published timetable.
 * Returns an empty board outside the service window instead of inventing buses.
 */
/**
 * How many stops the operator actually prints a time for, out of how many exist.
 *
 * The board tells a reader why their stop shows only estimates, and that sentence used
 * to carry "23 of the 429" as literal prose in three languages. Those are facts about
 * the dataset, so they are counted from it — a regenerated dataset can no longer leave
 * the explanation contradicting the screen above it.
 */
let timingPointCounts: { published: number; total: number } | null = null;

export function timingPointStopCount(): { published: number; total: number } {
  if (timingPointCounts) return timingPointCounts;

  const published = new Set<string>();
  for (const line of BUS_LINES) {
    for (const direction of line.directions) {
      const names = direction.stops.map((id) => BUS_STOPS.find((s) => s.id === id)?.name ?? id);
      for (const service of line.services) {
        for (const row of service.rows ?? []) {
          const index = anchorIndex(row.timingPoint, names);
          if (index >= 0) published.add(direction.stops[index]);
        }
      }
    }
  }

  timingPointCounts = { published: published.size, total: BUS_STOPS.length };
  return timingPointCounts;
}

export function getArrivalsForStop(
  stopIdOrCode: string,
  now: Date = new Date(),
): { stop: BusStop | undefined; arrivals: StopArrival[] } {
  const stop = findStop(stopIdOrCode);
  if (!stop) return { stop: undefined, arrivals: [] };

  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const today = dayKind(now);
  const arrivals: StopArrival[] = [];

  for (const lineId of stop.lines) {
    const line = BUS_LINES.find((l) => l.id === lineId);
    if (!line || !lineRunsOn(line, today)) continue;

    line.directions.forEach((direction, dirIndex) => {
      const stopIndex = direction.stops.indexOf(stop.id);
      if (stopIndex === -1) return;

      // The last stop of a direction is where the run ends. Those buses arrive here and
      // go out of service; listing them on a departure board offers a ride nobody can
      // take — and at a terminus like HULA it reads as "the 4.1 to HULA leaves in 10
      // min" to somebody already standing at HULA.
      if (stopIndex === direction.stops.length - 1) return;

      const runs = buildRuns(line, dirIndex, BUS_STOPS, today);
      const upcoming = runs
        .map((run) => ({
          minutes: run.minutesByStopIndex[stopIndex],
          // Per run, not per direction: the operator prints times for some runs of a
          // line and not others, and a headway-generated run passing a timing point has
          // no published time of its own to claim.
          published: run.publishedStopIndices.includes(stopIndex),
        }))
        .filter((r) => r.minutes !== undefined)
        // A run listed as 23:50 is still "next" at 00:05, so compare on the same day arc.
        .map((r) => ({ ...r, minutes: r.minutes < nowMinutes - 5 ? r.minutes + MINUTES_PER_DAY : r.minutes }))
        .filter((r) => r.minutes >= nowMinutes - 1 && r.minutes <= nowMinutes + ARRIVALS_HORIZON_MINUTES)
        .sort((a, b) => a.minutes - b.minutes)
        // Three, so the by-line view can show a line's next few departures and derive
        // a headway from them instead of asserting a frequency nobody measured.
        .slice(0, 3);

      upcoming.forEach(({ minutes, published }) => {
        arrivals.push({
          lineId: line.id,
          lineNumber: line.number,
          lineName: line.name,
          lineColor: line.color,
          destination: direction.destination,
          etaMinutes: Math.max(0, Math.round(minutes - nowMinutes)),
          etaTime: formatMinutes(Math.round(minutes)),
          precision: published ? 'published' : 'estimated',
        });
      });
    });
  }

  arrivals.sort((a, b) => a.etaMinutes - b.etaMinutes);
  return { stop, arrivals };
}

/**
 * When this stop next has a bus, looking past the arrivals horizon and past today.
 *
 * An empty board is the right answer at 03:00, but "no departures right now" is not what
 * someone standing there needs: they need to know whether to wait ten minutes or go home.
 * This is only ever asked when the board is empty, so it can afford to scan the day.
 */
export function nextServiceAtStop(
  stopIdOrCode: string,
  now: Date = new Date(),
): { lineNumber: string; destination: string; time: string; minutesAway: number } | null {
  const stop = findStop(stopIdOrCode);
  if (!stop) return null;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let best: { lineNumber: string; destination: string; time: string; minutesAway: number } | null = null;

  // Today first, then the next service day, so a Sunday night gets Monday's first bus.
  for (let dayAhead = 0; dayAhead < 7 && !best; dayAhead++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayAhead);
    const kind = dayKind(day);
    const offset = dayAhead * MINUTES_PER_DAY;

    for (const lineId of stop.lines) {
      const line = BUS_LINES.find((l) => l.id === lineId);
      if (!line || !lineRunsOn(line, kind)) continue;

      line.directions.forEach((direction, dirIndex) => {
        const stopIndex = direction.stops.indexOf(stop.id);
        if (stopIndex === -1) return;

        for (const run of buildRuns(line, dirIndex, BUS_STOPS, kind)) {
          const minutes = run.minutesByStopIndex[stopIndex];
          if (minutes === undefined) continue;
          const away = minutes + offset - nowMinutes;
          if (away <= 0) continue;
          if (!best || away < best.minutesAway) {
            best = {
              lineNumber: line.number,
              destination: direction.destination,
              time: formatMinutes(Math.round(minutes % MINUTES_PER_DAY)),
              minutesAway: Math.round(away),
            };
          }
        }
      });
    }
  }

  return best;
}

/**
 * Cumulative metres along a path, one entry per vertex, cached per path.
 *
 * Surveyed OSM geometry is spaced by shape, not by distance: across these 48 directions
 * the median segment is 8.9 m and the longest is 358 m, a 40:1 spread. Advancing a
 * vehicle one *vertex* per unit of time therefore crawls it around a roundabout and
 * flings it down a straight. Distances make the movement match the road.
 */
const pathDistanceCache = new WeakMap<[number, number][], number[]>();

function cumulativeMetres(path: [number, number][]): number[] {
  const cached = pathDistanceCache.get(path);
  if (cached) return cached;

  const out = [0];
  for (let i = 1; i < path.length; i++) {
    out.push(out[i - 1] + getDistanceMeters(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]));
  }
  pathDistanceCache.set(path, out);
  return out;
}

/** Vertex index whose cumulative distance brackets `metres`, by binary search. */
function vertexAtDistance(cum: number[], metres: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= metres) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Position along a direction's road geometry, given progress in [0, 1] of its length. */
function pointOnPath(
  path: [number, number][],
  progress: number,
): { lat: number; lng: number; bearing: number; segIndex: number } {
  const segments = path.length - 1;
  const cum = cumulativeMetres(path);
  const total = cum[segments];

  // A degenerate path (every vertex on one point) has no length to divide by; fall back
  // to index space so the caller still gets a valid point instead of NaN.
  let segIndex: number;
  let frac: number;
  if (total > 0) {
    const target = Math.min(Math.max(progress, 0), 0.9999) * total;
    segIndex = Math.min(vertexAtDistance(cum, target), segments - 1);
    const segLength = cum[segIndex + 1] - cum[segIndex];
    frac = segLength > 0 ? (target - cum[segIndex]) / segLength : 0;
  } else {
    const exact = Math.min(Math.max(progress, 0), 0.9999) * segments;
    segIndex = Math.min(Math.floor(exact), segments - 1);
    frac = exact - segIndex;
  }

  const [lat1, lng1] = path[segIndex];
  const [lat2, lng2] = path[segIndex + 1];

  const toRad = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * toRad) * Math.cos(lat2 * toRad);
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lng2 - lng1) * toRad);

  return {
    lat: lat1 + (lat2 - lat1) * frac,
    lng: lng1 + (lng2 - lng1) * frac,
    bearing: Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360),
    segIndex,
  };
}

/**
 * Vehicles currently on the road, derived from the timetable: one bus per run that has
 * departed but not yet finished. Outside service hours the fleet is empty, which is
 * what the network actually looks like at 23:00.
 */
export function getScheduledBuses(now: Date = new Date()): ScheduledBus[] {
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const today = dayKind(now);
  const buses: ScheduledBus[] = [];

  BUS_LINES.forEach((line) => {
    if (!lineRunsOn(line, today)) return;

    line.directions.forEach((direction, dirIndex) => {
      // Without the geometry chunk a bus still has a schedule and a next stop; it just
      // sits on that stop instead of between two of them. Map views load the geometry.
      const path = direction.pathCoordinates;
      const hasGeometry = path && path.length >= 2 && direction.stopPathIndex?.length === direction.stops.length;

      const runs = buildRuns(line, dirIndex, BUS_STOPS, today);

      runs.forEach((run, runIndex) => {
        const times = run.minutesByStopIndex;
        const start = times[0];
        const end = times[times.length - 1];
        if (start === undefined || end === undefined || end <= start) return;

        // Compare on the same day arc so a run that crosses midnight still counts.
        let t = nowMinutes;
        if (start > MINUTES_PER_DAY - 1 && t < start - MINUTES_PER_DAY / 2) t += MINUTES_PER_DAY;
        // Half-open on purpose: a run that has reached its last stop has arrived, and is
        // not on the road any more. Including it put two markers of the same line on one
        // point at every terminus — the bus pulling in and the bus pulling out are the
        // same vehicle turning around, and drawing both says the line runs twice the
        // service it does.
        if (t < start || t >= end) return;

        // Progress follows the scheduled passing times, so the bus slows where the
        // timetable says it does instead of sliding at a constant rate.
        let stopIndex = 0;
        while (stopIndex < times.length - 2 && times[stopIndex + 1] < t) stopIndex++;
        const legStart = times[stopIndex];
        const legEnd = times[stopIndex + 1];
        const legFrac = legEnd > legStart ? (t - legStart) / (legEnd - legStart) : 0;

        const nextStopId = direction.stops[Math.min(stopIndex + 1, direction.stops.length - 1)];
        const nextStop = BUS_STOPS.find((s) => s.id === nextStopId);

        let pos: { lat: number; lng: number; bearing: number };
        if (hasGeometry) {
          const idx = direction.stopPathIndex;
          const pathStart = idx[stopIndex] ?? 0;
          const pathEnd = idx[stopIndex + 1] ?? path.length - 1;
          // Progress through the leg is expressed in metres, not vertices: the two stops
          // bracket a stretch of road, and the bus is that fraction of its *length* along.
          const cum = cumulativeMetres(path);
          const total = cum[cum.length - 1];
          const metres = cum[pathStart] + (cum[pathEnd] - cum[pathStart]) * legFrac;
          pos = pointOnPath(path, total > 0 ? metres / total : 0);
        } else {
          const from = BUS_STOPS.find((s) => s.id === direction.stops[stopIndex]);
          const to = nextStop || from;
          if (!from || !to) return;
          pos = {
            lat: from.lat + (to.lat - from.lat) * legFrac,
            lng: from.lng + (to.lng - from.lng) * legFrac,
            bearing: 0,
          };
        }

        buses.push({
          id: `${line.id}-${direction.id}-${runIndex}`,
          lineId: line.id,
          lineNumber: line.number,
          lineColor: line.color,
          direction: direction.id,
          destination: direction.destination,
          currentLat: pos.lat,
          currentLng: pos.lng,
          bearing: pos.bearing,
          nextStopId,
          nextStopName: nextStop ? nextStop.name : direction.destination,
          occupancy: occupancyAt(t),
        });
      });
    });
  });

  return buses;
}


/**
 * When does the next bus of this line leave `stopId`, at or after `targetMinutes`?
 * Reads the published timetable; no synthetic slots.
 */
function getNextLineDeparture(
  lang: Lang,
  line: BusLine,
  directionId: string,
  stopId: string,
  targetMinutes: number,
  _nowMinutes: number,
  now: Date = new Date(),
  toStopId?: string,
): {
  departureMinutes: number;
  waitMinutes: number;
  delayMinutes: number;
  isServiceActive: boolean;
  serviceNotice?: string;
  /** 'published' when the operator prints this time for this stop. */
  precision: 'published' | 'estimated';
  /** When that same run reaches `toStopId`, and whether the operator prints it. */
  arrivalMinutes?: number;
  arrivalPrecision?: 'published' | 'estimated';
} {
  const dirIndex = Math.max(0, line.directions.findIndex((d) => d.id === directionId));
  const direction = line.directions[dirIndex];
  const stopIndex = Math.max(0, direction.stops.indexOf(stopId));
  const toIndex = toStopId ? direction.stops.indexOf(toStopId) : -1;

  const runsToday = lineRunsOn(line, dayKind(now));
  const runs = runsToday ? buildRuns(line, dirIndex, BUS_STOPS, dayKind(now)) : [];

  const candidates = runs
    .filter((r) => r.minutesByStopIndex[stopIndex] !== undefined)
    .sort((a, b) => a.minutesByStopIndex[stopIndex] - b.minutesByStopIndex[stopIndex]);

  // A timetable covers one day, but the caller may already be asking about tomorrow —
  // the second half of a transfer whose first leg rolled over. Ask the timetable about
  // the time of day, then put the answer back on the right date. Doing this by adding a
  // flat day to the first departure used to hand back a connecting bus that left before
  // the bus it connects from.
  const dayOffset = Math.floor(targetMinutes / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  const targetToday = targetMinutes - dayOffset;

  let run = candidates.find((r) => r.minutesByStopIndex[stopIndex] >= targetToday);
  let offset = dayOffset;
  if (!run && candidates.length) {
    run = candidates[0]; // nothing left today: the first run of the next service day
    offset += MINUTES_PER_DAY;
  }

  const published = runs.some((r) => r.publishedStopIndices.includes(stopIndex));

  if (run) {
    const departureMinutes = run.minutesByStopIndex[stopIndex] + offset;
    const rolled = offset > 0;
    return {
      departureMinutes: Math.round(departureMinutes),
      waitMinutes: Math.max(0, Math.round(departureMinutes - targetMinutes)),
      delayMinutes: 0,
      isServiceActive: !rolled,
      serviceNotice: rolled
        ? `Servizo finalizado por hoxe (última saída ás ${line.lastDeparture}). Primeira saída ás ${line.firstDeparture}.`
        : undefined,
      precision: published ? 'published' : 'estimated',
      // Read off the very run being boarded, on the same date, so the arrival honours
      // every printed timing point along the way instead of re-deriving it from road
      // times — and cannot land on a different day than its own boarding.
      arrivalMinutes:
        toIndex > stopIndex ? Math.round(run.minutesByStopIndex[toIndex] + offset) : undefined,
      arrivalPrecision: run.publishedStopIndices.includes(toIndex) ? 'published' : 'estimated',
    };
  }

  // The line has no run we can place at all: it does not serve this stop today.
  const fallback = parseTimeToMinutes(line.firstDeparture) + dayOffset + MINUTES_PER_DAY;
  return {
    departureMinutes: Math.round(fallback),
    waitMinutes: Math.max(0, Math.round(fallback - targetMinutes)),
    delayMinutes: 0,
    isServiceActive: false,
    serviceNotice: translations(lang).engine.notRunningToday(line.number, daysLabel(line, lang)),
    precision: published ? 'published' : 'estimated',
  };
}

/**
 * Real in-vehicle time and distance between two stops of one direction, summed from
 * the road legs measured for the route. Falls back to a flat estimate only when a
 * direction has no measured geometry.
 */
function rideBetween(
  direction: BusLine['directions'][number],
  fromIndex: number,
  toIndex: number,
): { minutes: number; meters: number; stopsCount: number } {
  const stopsCount = Math.max(1, toIndex - fromIndex);
  let seconds = 0;
  let meters = 0;
  for (let i = fromIndex; i < toIndex; i++) {
    seconds += (direction.legSeconds?.[i] ?? 90) + 20; // + dwell
    meters += direction.legMeters?.[i] ?? 400;
  }
  return { minutes: Math.max(1, Math.round(seconds / 60)), meters: Math.round(meters), stopsCount };
}

/**
 * Of every line serving both stops in the right order, the one that gets you there
 * soonest. The planner used to take `lines[0]`, so at a hub like Sindicatos with 14
 * lines it could pick one that had stopped running and then report the whole trip as
 * "servizo finalizado".
 */
function pickBestBoarding(
  lang: Lang,
  candidateLineIds: string[],
  fromStopId: string,
  toStopId: string,
  readyAtMinutes: number,
  now: Date,
): { line: BusLine; direction: BusLine['directions'][number]; departure: ReturnType<typeof getNextLineDeparture> } | null {
  let best: { line: BusLine; direction: BusLine['directions'][number]; departure: ReturnType<typeof getNextLineDeparture>; arrival: number } | null = null;

  for (const lineId of candidateLineIds) {
    const line = BUS_LINES.find((l) => l.id === lineId);
    if (!line) continue;

    for (const direction of line.directions) {
      const from = direction.stops.indexOf(fromStopId);
      const to = direction.stops.indexOf(toStopId);
      if (from === -1 || to === -1 || to <= from) continue;

      const departure = getNextLineDeparture(lang, line, direction.id, fromStopId, readyAtMinutes, readyAtMinutes, now, toStopId);
      const arrival = departure.arrivalMinutes ?? departure.departureMinutes + rideBetween(direction, from, to).minutes;

      // Prefer a line that is actually running, then the earliest arrival.
      const better =
        !best ||
        (departure.isServiceActive && !best.departure.isServiceActive) ||
        (departure.isServiceActive === best.departure.isServiceActive && arrival < best.arrival);
      if (better) best = { line, direction, departure, arrival };
    }
  }

  return best ? { line: best.line, direction: best.direction, departure: best.departure } : null;
}

/**
 * What the trip costs. A single ticket pays per boarding; the Tarxeta Cidadá pays once
 * as long as every transfer happens inside the window, which is exactly the thing worth
 * telling someone before they decide how to pay.
 */
function fareFor(segments: RoutePlanResult['segments']): TripFare {
  const boardings = segments
    .filter((s) => s.type === 'bus' && s.departureTime)
    .map((s) => parseTimeToMinutes(s.departureTime!));

  const busLegs = boardings.length;
  const transferSpanMinutes = busLegs > 1 ? Math.round(boardings[busLegs - 1] - boardings[0]) : 0;
  const transfersFree = busLegs <= 1 || transferSpanMinutes <= FARES.freeTransferWindowMinutes;

  return {
    busLegs,
    transfersFree,
    transferSpanMinutes,
    singleTicketEuros: Number((busLegs * FARES.singleTicket).toFixed(2)),
    citizenCardEuros: Number(((transfersFree ? 1 : busLegs) * FARES.citizenCard).toFixed(2)),
  };
}

/** One complete option the planner is considering. */
interface Itinerary {
  /** Arrival at the last bus stop, in minutes from midnight. */
  arrivalMinutes: number;
  /** Whether the operator prints that arrival, or we interpolated it. */
  arrivalPrecision: 'published' | 'estimated';
  segments: RoutePlanResult['segments'];
  totalWaitMinutes: number;
  isServiceActive: boolean;
  serviceNotice?: string;
}

/** Ride one line from `fromStop` to `toStop`, boarding no earlier than `readyAt`. */
function buildLeg(
  lang: Lang,
  candidateLineIds: string[],
  fromStop: BusStop,
  toStop: BusStop,
  readyAt: number,
  now: Date,
  hubLabel?: string,
): Itinerary | null {
  const option = pickBestBoarding(lang, candidateLineIds, fromStop.id, toStop.id, readyAt, now);
  if (!option) return null;

  const { line, direction, departure } = option;
  const ride = rideBetween(direction, direction.stops.indexOf(fromStop.id), direction.stops.indexOf(toStop.id));

  const segments: RoutePlanResult['segments'] = [];
  const waitMinutes = Math.max(0, departure.departureMinutes - readyAt);

  if (waitMinutes > 0) {
    segments.push({
      type: 'wait',
      fromStop,
      durationMinutes: waitMinutes,
      departureTime: formatMinutes(readyAt),
      arrivalTime: formatMinutes(departure.departureMinutes),
      instruction: hubLabel
        ? translations(lang).engine.transferAt(fromStop.name, line.number, formatMinutes(departure.departureMinutes), waitMinutes)
        : translations(lang).engine.waitAt(
            fromStop.name,
            formatMinutes(departure.departureMinutes),
            waitMinutes,
            line.number,
            direction.destination,
          ),
    });
  }

  const boardTime = departure.departureMinutes;
  const arriveTime = departure.arrivalMinutes ?? boardTime + ride.minutes;

  segments.push({
    type: 'bus',
    line,
    directionId: direction.id,
    precision: departure.precision,
    fromStop,
    toStop,
    durationMinutes: Math.max(1, Math.round(arriveTime - boardTime)),
    stopsCount: ride.stopsCount,
    departureTime: formatMinutes(boardTime),
    arrivalTime: formatMinutes(arriveTime),
    delayMinutes: departure.delayMinutes,
    instruction: translations(lang).engine.board(
      line.number,
      direction.name,
      formatMinutes(boardTime),
      toStop.name,
      ride.stopsCount,
      (ride.meters / 1000).toFixed(1),
      formatMinutes(arriveTime),
    ),
  });

  return {
    arrivalMinutes: arriveTime,
    arrivalPrecision: departure.arrivalPrecision ?? 'estimated',
    segments,
    totalWaitMinutes: waitMinutes,
    isServiceActive: departure.isServiceActive,
    serviceNotice: departure.serviceNotice,
  };
}

/**
 * Every stop you can reach from `stopId` without changing bus: each line serving it,
 * in the direction that actually goes onward from there.
 */
function reachableFrom(stopId: string, lines: string[]): Set<string> {
  const out = new Set<string>();
  for (const lineId of lines) {
    const line = BUS_LINES.find((l) => l.id === lineId);
    if (!line) continue;
    for (const direction of line.directions) {
      const from = direction.stops.indexOf(stopId);
      if (from === -1) continue;
      for (let i = from + 1; i < direction.stops.length; i++) out.add(direction.stops[i]);
    }
  }
  return out;
}

/** Every stop from which `stopId` is reachable without changing bus. */
function reachingInto(stopId: string, lines: string[]): Set<string> {
  const out = new Set<string>();
  for (const lineId of lines) {
    const line = BUS_LINES.find((l) => l.id === lineId);
    if (!line) continue;
    for (const direction of line.directions) {
      const to = direction.stops.indexOf(stopId);
      if (to === -1) continue;
      for (let i = 0; i < to; i++) out.add(direction.stops[i]);
    }
  }
  return out;
}

/**
 * How long to allow for changing bus.
 *
 * Two minutes covers walking between poles at an interchange, and is enough when the
 * operator prints the arrival: both sides then come from the same official table. When
 * the arrival is interpolated between timing points it can be a minute or so out, and a
 * missed connection costs a whole headway, so those get a wider margin. Erring wide only
 * pushes a suggestion to the next bus; erring narrow leaves someone on the pavement.
 */
/**
 * How far somebody will walk between one bus and the next.
 *
 * Three hundred metres is about four minutes at the calibrated pace: two streets, the
 * kind of change people already make without thinking of it as one. Much further and
 * the walk stops being a transfer and starts being the trip.
 */
const MAX_TRANSFER_WALK_M = 300;
/** Each candidate costs two timetable lookups; these caps keep a plan under 100 ms. */
const MAX_SAME_POLE_HUBS = 40;
const MAX_WALKING_HUBS = 20;

const TRANSFER_BUFFER_MIN = 2;
const TRANSFER_BUFFER_ESTIMATED_MIN = 4;

/** Chain two legs through one interchange, allowing time to change platform. */
function buildTransfer(
  lang: Lang,
  startStop: BusStop,
  endStop: BusStop,
  hubIn: BusStop,
  hubOut: BusStop,
  readyAt: number,
  now: Date,
): Itinerary | null {
  if (hubIn.id === startStop.id || hubOut.id === endStop.id) return null;

  const leg1Lines = startStop.lines.filter((l) => hubIn.lines.includes(l));
  const leg2Lines = endStop.lines.filter((l) => hubOut.lines.includes(l));
  if (!leg1Lines.length || !leg2Lines.length) return null;

  const first = buildLeg(lang, leg1Lines, startStop, hubIn, readyAt, now);
  if (!first) return null;

  const buffer = first.arrivalPrecision === 'published' ? TRANSFER_BUFFER_MIN : TRANSFER_BUFFER_ESTIMATED_MIN;

  // Getting off at one pole and on at another a couple of streets away is a normal
  // change, and it is how half the network connects: line 8 ends at Bolaño Ribadeneira
  // and the 1.x family runs along Ronda da Muralla, 275 m away. Requiring one shared
  // pole meant the planner walked people 700 m to a different line instead.
  const change: RoutePlanResult['segments'] = [];
  let boardAt = first.arrivalMinutes + buffer;
  if (hubIn.id !== hubOut.id) {
    const walk = estimateWalk(getDistanceMeters(hubIn.lat, hubIn.lng, hubOut.lat, hubOut.lng));
    change.push({
      type: 'walk',
      durationMinutes: walk.minutes,
      walkMeters: walk.meters,
      departureTime: formatMinutes(first.arrivalMinutes),
      arrivalTime: formatMinutes(first.arrivalMinutes + walk.minutes),
      instruction: translations(lang).engine.walkToStop(
        walk.meters,
        walk.minutes,
        hubIn.name,
        hubOut.name,
        hubOut.code,
      ),
    });
    boardAt = first.arrivalMinutes + walk.minutes + buffer;
  }

  const second = buildLeg(lang, leg2Lines, hubOut, endStop, boardAt, now, hubOut.name);
  if (!second) return null;

  // Getting off a bus to wait for the same line is never the answer. In the same
  // direction it is literally the bus you were already on, and the direct ride is
  // guaranteed to exist: the hub sits between origin and destination on that
  // direction, so the destination is reachable without moving. In the opposite
  // direction it means doubling back. Either way the passenger sees "5.1 -> 5.1".
  const rides = (it: Itinerary) => it.segments.find((s) => s.type === 'bus')?.line?.id;
  if (rides(first) === rides(second)) return null;

  return {
    arrivalMinutes: second.arrivalMinutes,
    arrivalPrecision: second.arrivalPrecision,
    segments: [...first.segments, ...change, ...second.segments],
    totalWaitMinutes: first.totalWaitMinutes + second.totalWaitMinutes,
    isServiceActive: first.isServiceActive && second.isServiceActive,
    serviceNotice: first.serviceNotice || second.serviceNotice,
  };
}

/**
 * Interchanges that genuinely connect these two stops: reachable onward from the
 * origin AND able to reach the destination. Six hardcoded "central" stops missed most
 * real connections, e.g. anything crossing town without touching Ronda da Muralla.
 */
function connectingHubs(startStop: BusStop, endStop: BusStop): [BusStop, BusStop][] {
  const forward = reachableFrom(startStop.id, startStop.lines);
  const backward = reachingInto(endStop.id, endStop.lines);

  const arrivals: BusStop[] = [];
  const departures: BusStop[] = [];
  for (const s of BUS_STOPS) {
    if (forward.has(s.id) && s.id !== endStop.id) arrivals.push(s);
    if (backward.has(s.id) && s.id !== startStop.id) departures.push(s);
  }

  // The same pole first: no walk, no risk, and it is most of the network.
  const same = arrivals
    .filter((s) => backward.has(s.id))
    .sort((a, b) => b.lines.length - a.lines.length)
    .slice(0, MAX_SAME_POLE_HUBS)
    .map((s): [BusStop, BusStop] => [s, s]);

  // Then pairs a short walk apart. Line 8 ends at Bolaño Ribadeneira and the 1.x
  // family runs along Ronda da Muralla, 275 m away; without this the planner cannot
  // see that change at all, and walks people 700 m to a different line instead.
  const pairs: { pair: [BusStop, BusStop]; walk: number }[] = [];
  for (const a of arrivals) {
    if (backward.has(a.id)) continue; // already covered as a same-pole hub
    for (const b of departures) {
      if (a.id === b.id) continue;
      const metres = getDistanceMeters(a.lat, a.lng, b.lat, b.lng);
      if (metres > MAX_TRANSFER_WALK_M) continue;
      pairs.push({ pair: [a, b], walk: metres });
    }
  }
  pairs.sort((x, y) => x.walk - y.walk);

  return [...same, ...pairs.slice(0, MAX_WALKING_HUBS).map((p) => p.pair)];
}

// Plan route between two locations/stops with smart multi-modal walking + bus optimization
interface PlanOptions {
  /**
   * Which language the itinerary sentences come back in.
   *
   * The engine writes prose — "get on Line 5.1 and get off after 25 stops" — so it has
   * to know. Passed explicitly rather than read from a module-level global: the
   * functions stay pure and the dependency is visible at every call site.
   */
  lang?: Lang;
  userLocation?: [number, number];
  now?: Date;
  /** Leave at this time instead of now, in minutes from midnight. */
  departAt?: number;
  /**
   * Be there by this time, in minutes from midnight. The planner returns the LATEST
   * departure that still makes it — the question people actually ask before a hospital
   * appointment or a class.
   */
  arriveBy?: number;
}

/** How far back to look for a departure that still arrives in time. */
const ARRIVE_BY_LOOKBACK_MIN = 180;
const ARRIVE_BY_STEP_MIN = 5;

/**
 * Every distinct way of making the trip, quickest first. Showing the alternatives lets
 * someone pick the one that suits them — a line they know, fewer changes, less walking —
 * instead of trusting a single answer.
 */
export function planTrips(fromQuery: string, toQuery: string, options: PlanOptions = {}): RoutePlanResult[] {
  const { userLocation, now = new Date(), lang = 'gl' } = options;

  if (options.arriveBy !== undefined) {
    return planArrivingBy(fromQuery, toQuery, options.arriveBy, options);
  }

  if (options.departAt !== undefined) {
    const at = new Date(now);
    at.setHours(Math.floor(options.departAt / 60), Math.round(options.departAt % 60), 0, 0);
    return planDeparting(lang, fromQuery, toQuery, userLocation, at);
  }

  return planDeparting(lang, fromQuery, toQuery, userLocation, now);
}

/** The single best option, for callers that only want an answer. */
export function planSmartTrip(
  fromQuery: string,
  toQuery: string,
  options: PlanOptions = {},
): RoutePlanResult | null {
  return planTrips(fromQuery, toQuery, options)[0] ?? null;
}

/**
 * Walk departure times backwards from the deadline and keep the last one that still
 * arrives in time. Each probe is a normal forward plan, so transfers and service hours
 * are handled exactly the same way.
 */
function planArrivingBy(
  fromQuery: string,
  toQuery: string,
  arriveBy: number,
  options: PlanOptions,
): RoutePlanResult[] {
  const now = options.now ?? new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const earliest = Math.max(nowMinutes, arriveBy - ARRIVE_BY_LOOKBACK_MIN);

  // Keep the latest departure per journey that still arrives in time.
  const byJourney = new Map<string, RoutePlanResult>();
  for (let depart = earliest; depart <= arriveBy; depart += ARRIVE_BY_STEP_MIN) {
    const at = new Date(now);
    at.setHours(Math.floor(depart / 60), depart % 60, 0, 0);
    for (const plan of planDeparting(options.lang ?? 'gl', fromQuery, toQuery, options.userLocation, at)) {
      if (!plan.isServiceActive) continue;
      if (parseTimeToMinutes(plan.arrivalTime) > arriveBy) continue;
      const key = plan.segments
        .filter((seg) => seg.type === 'bus')
        .map((seg) => `${seg.line?.id}/${seg.directionId}`)
        .join('>');
      // Later departure, same deadline: strictly better for the traveller.
      byJourney.set(key, plan);
    }
  }

  return [...byJourney.values()].sort(
    (a, b) => parseTimeToMinutes(b.departureTime) - parseTimeToMinutes(a.departureTime),
  );
}

function planDeparting(
  lang: Lang,
  fromQuery: string,
  toQuery: string,
  userLocation: [number, number] | undefined,
  now: Date,
): RoutePlanResult[] {
  const fromRes = resolveLocationQuery(fromQuery, userLocation, lang);
  const toRes = resolveLocationQuery(toQuery, userLocation, lang);
  // One of the two places is not in the dataset. No itinerary is better than one that
  // silently starts somewhere else.
  if (!fromRes || !toRes) return [];

  // Only ever considering the single closest stop meant a badly-served pole next door
  // could turn a 20-minute trip into a 12-hour wait, or into "no route at all". Walking
  // a few extra minutes to a better-served stop is what a person would do.
  const onFoot = walkingOnlyPlan(lang, fromRes, toRes, now);
  const starts = boardingCandidates(fromRes, onFoot.durationMinutes);
  const ends = boardingCandidates(toRes, onFoot.durationMinutes);

  const all: RoutePlanResult[] = [onFoot];
  for (const from of starts) {
    for (const to of ends) {
      if (from.stop.id === to.stop.id) continue;
      all.push(...planBetweenStops(lang, fromRes, toRes, from, to, now));
    }
  }

  // Two itineraries wearing the same badges are one journey to a passenger, whether they
  // differ by boarding pole, by direction of the same loop, or by rural branch — the four
  // services numbered 11 all show a "11". Offering the same card twice just burns a slot,
  // so key on what the card shows and keep the quickest.
  const byJourney = new Map<string, RoutePlanResult>();
  for (const plan of all) {
    const key =
      plan.segments
        .filter((seg) => seg.type === 'bus')
        .map((seg) => seg.line?.number)
        .join('>') || 'walk';
    const current = byJourney.get(key);
    if (!current || isBetterPlan(plan, current)) byJourney.set(key, plan);
  }

  return [...byJourney.values()].sort((a, b) => (isBetterPlan(a, b) ? -1 : 1));
}

/**
 * How much sooner a bus has to get you there before walking stops being the answer.
 *
 * This used to be an absolute ceiling: any walk over 45 minutes was pushed below every
 * bus plan. That is wrong whenever the buses are worse. On Avda. Américas to As Termas
 * at half past one, walking takes 55 minutes and the best bus itinerary takes 95 — and
 * the walk was ranked last, off the end of a four-card list, so the fastest way to get
 * there was the one option the reader never saw.
 *
 * What the old rule was really protecting against is a long walk edging out a bus by a
 * minute or two, which is a win on paper and a loss in the rain. So that is all this
 * says now: the bus takes the near-ties, and a walk that is genuinely quicker gets to
 * lead — whether it wins by six minutes on a 300 m hop or by forty on a crosstown trip.
 */
const WALK_MUST_BEAT_BUS_BY_MIN = 5;

/**
 * And past this, a walk stays in the list but stops leading it, however bad the bus is.
 *
 * Ranking on duration alone once put a 168-minute walk to Calde above a bus 285 minutes
 * out, because the rural branch runs twice a day. Both things are true at once: an
 * hour on foot that beats a five-hour wait is the honest answer, and three hours on
 * foot is not an answer at all. Seventy-five minutes is about 5.6 km at the calibrated
 * pace — a long walk somebody might choose, and the far edge of one they might not.
 */
const MAX_HEADLINE_WALK_MIN = 75;

const isWalkOnly = (p: RoutePlanResult) => !p.segments.some((seg) => seg.type === 'bus');

/**
 * A running service first, then whichever arrives sooner — except that an hours-long
 * walk never leads.
 *
 * Ranking on duration alone is arithmetically right and practically wrong on the rural
 * branches: a line that runs twice a day puts the next bus 285 minutes out, so a
 * 168-minute walk to Calde won the comparison and became the headline suggestion. No
 * map app answers "walk for two hours and forty-eight minutes". The walk is still
 * offered — somebody may genuinely prefer it — it just stops being the answer.
 */
const busLegCount = (p: RoutePlanResult) => p.segments.filter((s) => s.type === 'bus').length;

function isBetterPlan(a: RoutePlanResult, b: RoutePlanResult): boolean {
  if (a.isServiceActive !== b.isServiceActive) return a.isServiceActive;
  // A walk only leads when it wins clearly; a bus takes the near-ties.
  if (isWalkOnly(a) !== isWalkOnly(b)) {
    const walk = isWalkOnly(a) ? a : b;
    const bus = isWalkOnly(a) ? b : a;
    const walkWins =
      walk.durationMinutes <= MAX_HEADLINE_WALK_MIN &&
      walk.durationMinutes + WALK_MUST_BEAT_BUS_BY_MIN <= bus.durationMinutes;
    return isWalkOnly(a) ? walkWins : !walkWins;
  }
  if (a.durationMinutes !== b.durationMinutes) return a.durationMinutes < b.durationMinutes;
  // Same clock, so the tie goes to the simpler trip. Two ways of reaching HULA both
  // took 36 minutes: one rode line 9 for a single stop to reach the wall, the other
  // walked to the same place. A change you do not need is still a change you can miss.
  return busLegCount(a) < busLegCount(b);
}

interface BoardingCandidate {
  stop: BusStop;
  walkMeters: number;
  walkMinutes: number;
}

/**
 * How far to look for a stop worth walking to.
 *
 * Measured over 40 city trips: the median trip stops improving past 1.2 km, the mean
 * keeps falling to 2 km / 10 candidates (40 -> 37 min) and is flat beyond that, at a
 * cost of 4 ms per plan. So 2 km is where widening stops buying anything.
 *
 * A radius this wide would normally allow silly suggestions — walking 25 minutes to
 * catch a bus — but `boardingCandidates` refuses any approach walk longer than simply
 * walking the whole way, so the absurd cases cannot be produced at any radius.
 */
const MAX_BOARDING_WALK_M = 2000;
const MAX_BOARDING_CANDIDATES = 10;
/** The closest poles are the cheapest to reach, so they are tried whatever they serve. */
const ALWAYS_NEAREST = 4;

/**
 * The stops worth walking to — chosen for the lines they reach, not for being close.
 *
 * Taking the ten nearest looked reasonable and was not. From Fonte dos Ranchos the ten
 * nearest are all on the same corridor and between them serve eight lines; the twelfth,
 * Rda. Muralla (Obras Públicas) at 535 m, serves nine more, including every line on the
 * wall. So the planner could not see a one-bus trip to HULA and instead offered to ride
 * line 9 for a single stop — one minute on the bus after three waiting — just to reach
 * the stop a seven-minute walk would have reached anyway.
 *
 * The point of walking further is to reach a line you cannot reach nearer, so past the
 * nearest few a stop earns its place only by serving a line none of the closer ones do.
 * The candidate count is unchanged, so this costs nothing: the same ten slots, spent on
 * ten different answers instead of ten versions of one.
 */
function boardingCandidates(res: LocationResolution, directWalkMinutes: number): BoardingCandidate[] {
  const reachable = getNearbyStops(res.lat, res.lng).filter(
    (s) =>
      s.lines.length > 0 &&
      s.walkMeters <= MAX_BOARDING_WALK_M &&
      // Never walk further to reach the bus than to reach the destination.
      s.walkMinutes < directWalkMinutes,
  );

  const chosen: typeof reachable = [];
  const served = new Set<string>();
  for (const stop of reachable) {
    if (chosen.length >= MAX_BOARDING_CANDIDATES) break;
    const addsALine = stop.lines.some((id) => !served.has(id));
    if (chosen.length >= ALWAYS_NEAREST && !addsALine) continue;
    chosen.push(stop);
    stop.lines.forEach((id) => served.add(id));
  }

  return chosen.map((s) => ({ stop: s, walkMeters: s.walkMeters, walkMinutes: s.walkMinutes }));
}

/**
 * Just walking the whole way.
 *
 * Lugo is about an hour across on foot, so a 90-minute bus itinerary with two changes
 * is worse than walking and the app should say so rather than hide it. Always offered;
 * it sorts on duration like anything else, so it only leads when it deserves to.
 */
function walkingOnlyPlan(
  lang: Lang,
  fromRes: LocationResolution,
  toRes: LocationResolution,
  now: Date,
): RoutePlanResult {
  const walk = estimateWalk(getDistanceMeters(fromRes.lat, fromRes.lng, toRes.lat, toRes.lng));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const arrival = nowMinutes + walk.minutes;

  return {
    durationMinutes: walk.minutes,
    fare: { busLegs: 0, transfersFree: true, transferSpanMinutes: 0, singleTicketEuros: 0, citizenCardEuros: 0 },
    departureTime: formatMinutes(nowMinutes),
    leaveAt: formatMinutes(nowMinutes),
    arrivalTime: formatMinutes(arrival),
    totalWaitMinutes: 0,
    isServiceActive: true,
    walkToStartMeters: 0,
    walkFromEndMeters: 0,
    segments: [
      {
        type: 'walk',
        durationMinutes: walk.minutes,
        walkMeters: walk.meters,
        departureTime: formatMinutes(nowMinutes),
        arrivalTime: formatMinutes(arrival),
        instruction: translations(lang).engine.walkWholeWay(
          fromRes.name,
          toRes.name,
          walk.meters,
          walk.minutes,
        ),
      },
    ],
  };
}

function planBetweenStops(
  lang: Lang,
  fromRes: LocationResolution,
  toRes: LocationResolution,
  from: BoardingCandidate,
  to: BoardingCandidate,
  now: Date,
): RoutePlanResult[] {
  const startStop = from.stop;
  const endStop = to.stop;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const leadIn: RoutePlanResult['segments'] = [];
  let cursor = nowMinutes;

  // 1. Walk to the boarding stop.
  if (from.walkMinutes > 0 && from.walkMeters > 50) {
    const start = cursor;
    cursor += from.walkMinutes;
    leadIn.push({
      type: 'walk',
      durationMinutes: from.walkMinutes,
      walkMeters: from.walkMeters,
      departureTime: formatMinutes(start),
      arrivalTime: formatMinutes(cursor),
      instruction: translations(lang).engine.walkToStop(
        from.walkMeters,
        from.walkMinutes,
        fromRes.name,
        startStop.name,
        startStop.code,
      ),
    });
  }

  // 2. Compare a direct ride against every interchange, and take whichever gets there
  //    first. Taking the direct line unconditionally meant a 3-a-day line like 5ES made
  //    the planner propose a four-hour wait when a transfer would arrive in twenty
  //    minutes.
  const directLines = startStop.lines.filter((l) => endStop.lines.includes(l));
  const options = [
    buildLeg(lang, directLines, startStop, endStop, cursor, now),
    ...connectingHubs(startStop, endStop).map(([hubIn, hubOut]) =>
      buildTransfer(lang, startStop, endStop, hubIn, hubOut, cursor, now),
    ),
  ].filter((o): o is Itinerary => o !== null);

  // Every option becomes a full itinerary. The caller picks, or shows them all.
  return options.map((option) => buildResult(option));

  function buildResult(option: Itinerary): RoutePlanResult {
    const segments = [...leadIn, ...option.segments];
    let end = option.arrivalMinutes;

    // 3. Walk from the alighting stop to the destination.
    if (to.walkMinutes > 0 && to.walkMeters > 50) {
      const start = end;
      end += to.walkMinutes;
      segments.push({
        type: 'walk',
        durationMinutes: to.walkMinutes,
        walkMeters: to.walkMeters,
        departureTime: formatMinutes(start),
        arrivalTime: formatMinutes(end),
        instruction: translations(lang).engine.walkToDestination(
          to.walkMeters,
          to.walkMinutes,
          toRes.name,
          formatMinutes(end),
        ),
      });
    }

    // When to actually walk out of the door: the wait before the first bus is spent at
    // home, not at the stop. Showing only "53 min" counts standing around as travel.
    const firstWait = option.segments[0]?.type === 'wait' ? option.segments[0].durationMinutes ?? 0 : 0;

    return {
      durationMinutes: Math.round(end - nowMinutes),
      fare: fareFor(segments),
      departureTime: formatMinutes(nowMinutes),
      leaveAt: formatMinutes(nowMinutes + firstWait),
      arrivalTime: formatMinutes(end),
      totalWaitMinutes: option.totalWaitMinutes,
      isServiceActive: option.isServiceActive,
      serviceNotice: option.serviceNotice,
      walkToStartMeters: from.walkMeters,
      walkFromEndMeters: to.walkMeters,
      segments,
    };
  }
}

// Plan route between two stops (backwards compatibility)
export function planRouteBetweenStops(fromStopId: string, toStopId: string): RoutePlanResult | null {
  return planSmartTrip(fromStopId, toStopId);
}

/** Stops sorted by walking distance — an estimate, see getNearestStopToCoords. */
export function getNearbyStops(lat: number, lng: number): (BusStop & { walkMeters: number; walkMinutes: number })[] {
  return BUS_STOPS.map((stop) => {
    const walk = estimateWalk(getDistanceMeters(lat, lng, stop.lat, stop.lng));
    return { ...stop, walkMeters: walk.meters, walkMinutes: walk.minutes };
  }).sort((a, b) => a.walkMeters - b.walkMeters);
}

// Find lines that serve nearby stops within radius (e.g. 650 meters)
export function getNearbyLines(lat: number, lng: number, radiusMeters = 650): { line: BusLine; nearestStop: BusStop; walkMeters: number }[] {
  const nearbyStops = getNearbyStops(lat, lng).filter((s) => s.walkMeters <= radiusMeters);
  const seenLineIds = new Set<string>();
  const results: { line: BusLine; nearestStop: BusStop; walkMeters: number }[] = [];

  for (const s of nearbyStops) {
    for (const lineId of s.lines) {
      if (!seenLineIds.has(lineId)) {
        seenLineIds.add(lineId);
        const line = BUS_LINES.find((l) => l.id === lineId);
        if (line) {
          results.push({
            line,
            nearestStop: s,
            walkMeters: s.walkMeters,
          });
        }
      }
    }
  }

  return results;
}
