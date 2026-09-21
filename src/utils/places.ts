/**
 * Where things are: the walking estimate, the landmarks, what somebody typed resolved to
 * a place, and the stops and lines near a point. Pure functions, no React.
 */
import { BUS_STOPS, lineById } from '../data/transitData';
import { Lang, translations } from '../i18n';
import { BusStop, BusLine } from '../types';
import { matchesQuery, calculateRelevanceScore } from './searchUtils';
import { getDistanceMeters } from './geo';

/**
 * The first guess at a walk, before the router answers: straight line x 1.35 at 75 m/min.
 * Re-measured over 1,022 real hops the median detour is x1.36, so this under-states half
 * of them; it stays because every screen that shows it is corrected by `walkRouter` within
 * milliseconds, and raising it would flash a worse number on the way to the right one.
 */
const WALK_DETOUR_FACTOR = 1.35;
const WALK_METRES_PER_MINUTE = 75;

export function estimateWalk(straightLineMeters: number): { meters: number; minutes: number } {
  const meters = Math.round(straightLineMeters * WALK_DETOUR_FACTOR);
  return { meters, minutes: Math.max(1, Math.round(meters / WALK_METRES_PER_MINUTE)) };
}

/**
 * The places people name instead of a stop. Each coordinate is the one OSM gives for the
 * feature (`pnpm run check:landmarks` checks it); for a street it is a point on the way.
 */
export const LUGO_LANDMARKS = [
  { name: 'Praza Maior / Concello de Lugo', lat: 43.0098, lng: -7.5562, zone: 'Casco Histórico' },
  { name: 'Catedral de Lugo (Porta de Santiago)', lat: 43.0084, lng: -7.5583, zone: 'Casco Histórico' },
  { name: 'Praza de Santo Domingo', lat: 43.0112, lng: -7.5552, zone: 'Casco Histórico' },
  { name: 'Rúa da Raiña / Praza de España', lat: 43.0104, lng: -7.5568, zone: 'Casco Histórico' },
  { name: 'Estación de Autobuses de Lugo (Praza da Constitución)', lat: 43.00834, lng: -7.55342, zone: 'Centro' },
  { name: 'Estación de Ferrocarril Adif (Praza Conde Fontao)', lat: 43.0151, lng: -7.55216, zone: 'Estación Tren' },
  { name: 'Centro Comercial As Termas', lat: 43.03682, lng: -7.56956, zone: 'As Termas' },
  { name: 'Parque Rosalía de Castro', lat: 43.00581, lng: -7.55957, zone: 'Sur' },
  { name: 'Parque da Milagrosa', lat: 43.02229, lng: -7.56328, zone: 'A Milagrosa' },
  { name: 'Pazo de Feiras e Congresos de Lugo', lat: 43.00312, lng: -7.56828, zone: 'Ribeira Miño' },
  { name: 'Complexo Deportivo Palomar / Ancar', lat: 43.00391, lng: -7.57247, zone: 'Oeste' },
  { name: 'Piscina Municipal As Pedreiras', lat: 42.99154, lng: -7.54363, zone: 'Acea de Olga' },
  { name: 'Pazo Provincial dos Deportes (CB Breogán)', lat: 42.99125, lng: -7.54534, zone: 'Acea de Olga' },
  { name: 'Centro Comercial Abella (Antigo)', lat: 43.01502, lng: -7.57388, zone: 'Casás' },
  // The library building, not the centroid of the campus polygon, which is 237 m from any stop.
  { name: 'Intercentros Campus Universitario USC', lat: 42.99234, lng: -7.54545, zone: 'Campus' },
  { name: 'Facultade de Veterinaria USC', lat: 42.9948, lng: -7.5463, zone: 'Campus' },
  { name: 'Hospital Lucus Augusti (HULA)', lat: 43.0197, lng: -7.5327, zone: 'HULA' },
  { name: 'Rolda das Fontiñas', lat: 43.00688, lng: -7.54715, zone: 'Fontiñas' },
  { name: 'Avenida da Coruña', lat: 43.01974, lng: -7.56259, zone: 'A Milagrosa' },
  { name: 'Avenida Ramón Ferreiro', lat: 43.0048, lng: -7.5528, zone: 'Sur' },
  { name: 'Avenida de Magoi', lat: 42.99478, lng: -7.55032, zone: 'Fingoi' },
  { name: 'Avenida das Américas', lat: 43.01099, lng: -7.56763, zone: 'Oeste' },
  { name: 'Fonte dos Ranchos', lat: 43.0135, lng: -7.5672, zone: 'Oeste' },
  { name: 'Barrio da Ponte / Ponte Romana', lat: 43.0012, lng: -7.5662, zone: 'A Ponte' },
  { name: 'A Piringalla (Rúa Lavandeira)', lat: 43.02649, lng: -7.56855, zone: 'A Piringalla' },
  { name: 'Polígono Industrial O Ceao (ITV)', lat: 43.04672, lng: -7.56771, zone: 'O Ceao' },
  { name: 'Polígono As Gándaras', lat: 43.0340, lng: -7.5551, zone: 'As Gándaras' },
  { name: 'Cemiterio Municipal San Froilán', lat: 42.9855, lng: -7.5807, zone: 'Cemiterio' },
];

export type Landmark = (typeof LUGO_LANDMARKS)[number];

/**
 * The places most trips are to or from, one tap in the planner. `query` must be a name
 * `resolveLocationQuery` finds; tools/test.ts checks each resolves to a distinct place.
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

export interface LocationResolution {
  name: string;
  lat: number;
  lng: number;
  nearestStop: BusStop;
  walkMeters: number;
  walkMinutes: number;
  isCustomLocation: boolean;
}

/** Nearest stop to a point, with the estimated WALK there — not the crow's distance. */
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

const atStop = (stop: BusStop): LocationResolution => ({
  name: stop.name,
  lat: stop.lat,
  lng: stop.lng,
  nearestStop: stop,
  walkMeters: 0,
  walkMinutes: 0,
  isCustomLocation: false,
});

const atPlace = (name: string, lat: number, lng: number): LocationResolution => {
  const nearest = getNearestStopToCoords(lat, lng);
  return { name, lat, lng, nearestStop: nearest.stop, walkMeters: nearest.walkMeters, walkMinutes: nearest.walkMinutes, isCustomLocation: true };
};

const scoreStop = (s: BusStop, q: string) =>
  Math.max(calculateRelevanceScore(s.name, s.code, s.id, q, s.zone), ...(s.aliases ?? []).map((a) => calculateRelevanceScore(a, s.code, s.id, q, s.zone)));

/** Stops ranked by relevance to a query, best first, aliases included. */
export function rankStops(q: string): { stop: BusStop; score: number }[] {
  return BUS_STOPS.map((stop) => ({ stop, score: scoreStop(stop, q) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Landmarks ranked by relevance to a query, best first. */
export function rankLandmarks(q: string): { landmark: Landmark; score: number }[] {
  return LUGO_LANDMARKS.map((landmark) => ({ landmark, score: calculateRelevanceScore(landmark.name, '', '', q, landmark.zone) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * What somebody typed (a stop id or code, a street, a landmark, "my location") as a place,
 * or null when nothing matches: an arbitrary stop instead would plan a confident itinerary from a place nobody asked about.
 */
export function resolveLocationQuery(query: string, userGps?: [number, number], lang: Lang = 'gl'): LocationResolution | null {
  const q = query.trim();

  if ((q === 'my_location' || q === 'gps' || matchesQuery(q, 'mi ubicacion') || matchesQuery(q, 'a mina localizacion')) && userGps) {
    return atPlace(translations(lang).map.myLocation, userGps[0], userGps[1]);
  }

  // An explicit code (e.g. "Cód. 605" or "101").
  const code = q.match(/\b(?:cód\.?|cod\.?|#)?\s*(\d{3})\b/i)?.[1];
  const byCode = code && BUS_STOPS.find((s) => s.code === code);
  if (byCode) return atStop(byCode);

  const stops = rankStops(q);
  if (stops.length > 0 && stops[0].score >= 300) return atStop(stops[0].stop);

  const landmarks = rankLandmarks(q);
  if (landmarks.length > 0) return atPlace(landmarks[0].landmark.name, landmarks[0].landmark.lat, landmarks[0].landmark.lng);
  if (stops.length > 0) return atStop(stops[0].stop);

  // Last chance: match on words rather than prefix score — "Campus USC" against
  // "Intercentros Campus Universitario USC" scores zero above.
  const byWords = LUGO_LANDMARKS.find((lm) => matchesQuery(lm.name, q) || matchesQuery(lm.zone, q));
  if (byWords) return atPlace(byWords.name, byWords.lat, byWords.lng);
  const stopByWords = BUS_STOPS.find((stop) => matchesQuery(stop.name, q) || (stop.aliases ?? []).some((a) => matchesQuery(a, q)));
  return stopByWords ? atStop(stopByWords) : null;
}

/**
 * The stop a code names, or nothing. Deliberately exact: every caller is resolving an
 * identifier (a scanned QR, a `?parada=` link), and a ranked fallback once turned a
 * damaged sticker into somebody else's board.
 */
export function findStop(query: string): BusStop | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const lower = q.toLowerCase();
  return (
    BUS_STOPS.find((s) => s.id.toLowerCase() === lower) ||
    BUS_STOPS.find((s) => s.code.toLowerCase() === lower) ||
    BUS_STOPS.find((s) => s.officialIds?.some((id) => String(id) === q)) ||
    BUS_STOPS.find((s) => s.name.toLowerCase() === lower || (s.aliases ?? []).some((a) => a.toLowerCase() === lower))
  );
}

/**
 * How far a stop can be and still answer "which stops are near me": nobody the buses
 * reach is more than about 1.8 km from one, and a list read quickly hides the units.
 */
export const NEARBY_STOP_LIMIT_METRES = 2000;

export type NearbyStop = BusStop & { walkMeters: number; walkMinutes: number };

/** Every stop sorted by estimated walking distance. */
export function getNearbyStops(lat: number, lng: number): NearbyStop[] {
  return BUS_STOPS.map((stop) => {
    const walk = estimateWalk(getDistanceMeters(lat, lng, stop.lat, stop.lng));
    return { ...stop, walkMeters: walk.meters, walkMinutes: walk.minutes };
  }).sort((a, b) => a.walkMeters - b.walkMeters);
}

export interface NearbyLine {
  line: BusLine;
  nearestStop: BusStop;
  walkMeters: number;
}

/** Lines with a stop within `radiusMeters`, nearest stop first. */
export function getNearbyLines(lat: number, lng: number, radiusMeters = 650): NearbyLine[] {
  const seen = new Set<string>();
  const results: NearbyLine[] = [];
  for (const s of getNearbyStops(lat, lng).filter((s) => s.walkMeters <= radiusMeters)) {
    for (const lineId of s.lines) {
      const line = lineById(lineId);
      if (seen.has(lineId) || !line) continue;
      seen.add(lineId);
      results.push({ line, nearestStop: s, walkMeters: s.walkMeters });
    }
  }
  return results;
}
