/**
 * Where things are: the walking estimate, the landmarks, what somebody typed resolved
 * to a place, and the stops and lines near a point.
 *
 * Pure functions over the shipped dataset, no React and no DOM. One of the four files
 * the old transitEngine.ts was split into, by subject.
 */
import { BUS_STOPS, BUS_LINES } from '../data/transitData';
import { Lang, translations } from '../i18n';
import { BusStop, BusLine } from '../types';
import { matchesQuery, calculateRelevanceScore } from './searchUtils';
import { getDistanceMeters } from './geo';

/**
 * The first guess at how long a walk takes, before the router answers.
 *
 * Calibrated against 120 pedestrian routes (`pnpm run calibrate:walking`) as a detour
 * over the straight line: 1.03 to 2.38, median 1.26, at 75 m/min. 1.35 was chosen
 * deliberately above that median, so it would over-state rather than under-state and
 * leave 24% of walks short instead of 51%. Being told a walk is longer than it is beats
 * missing the bus.
 *
 * **Re-measured against the network the app now carries, and it no longer does that.**
 * Over 1.022 hops of real plans — you to your first stop, the transfers, the last stop to
 * where you are going — the median detour is x1.36 and 1.35 leaves 51% of walks
 * under-stated, which is exactly the position the old comment described as the one to
 * avoid. The old figure was measured on a different and smaller sample; this one is every
 * hop of a few hundred plans, against a router that agrees with FOSSGIS to 1,2%.
 *
 * It is left at 1.35 on purpose rather than raised. Where this number reaches the reader
 * it is corrected within milliseconds — `src/utils/walkRouter.ts` routes every hop of
 * every option offered, on the device, and the planner replaces the estimate with what it
 * says. What is left uncorrected is "stops near me", which sorts by this, and the seven
 * stops the network cannot reach on foot. Raising it would make the corrected screens
 * flash a worse number on the way to the right one.
 *
 * The spread is the real point and no constant fixes it: the detour is x1.42 at the
 * median under 250 m and x1.33 over 750 m, and its p90 is x2.12. The wall, the river and
 * the railway force detours no single multiplier can predict, which is why the app stopped
 * relying on one.
 */
const WALK_DETOUR_FACTOR = 1.35;
const WALK_METRES_PER_MINUTE = 75;

export function estimateWalk(straightLineMeters: number): { meters: number; minutes: number } {
  const meters = Math.round(straightLineMeters * WALK_DETOUR_FACTOR);
  return { meters, minutes: Math.max(1, Math.round(meters / WALK_METRES_PER_MINUTE)) };
}

/**
 * The places people name instead of a stop, and where they are.
 *
 * These are written by hand — the comment here used to say "calibrated", which was a
 * claim nobody had checked. `pnpm check:landmarks` now checks it, asking Overpass for
 * anything in Lugo carrying each name and reporting how far our point is from it. The
 * first run found eight wrong by more than 150 m, the worst by 841 m — a longitude typo
 * that put A Piringalla the far side of the city — and two entries sharing one point,
 * so "Parque da Milagrosa" and "Avenida da Coruña" resolved to the same place.
 *
 * Each coordinate below is now the one OSM gives for that feature, and the distances are
 * in `design/REXISTRO-probas.md`. A street is long, so for those it is a point on the
 * way itself rather than a notional middle.
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
  /* The building, not the middle of the campus. `check:landmarks` moved this to the
     centroid of OSM's "Campus Terra" polygon, which is accurate about the campus and
     silent about the name: the nearest stop went from 67 m to 237 m and the one it found
     was the swimming pool. OSM has "Biblioteca Intercentros" as its own feature, which is
     what this entry says it is — 159 m from As Pedreiras, and true. */
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

export interface LocationResolution {
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
      calculateRelevanceScore(s.name, s.code, s.id, q, s.zone),
      ...(s.aliases ?? []).map((a) => calculateRelevanceScore(a, s.code, s.id, q, s.zone)),
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
/**
 * The stop a code names, or nothing.
 *
 * Deliberately exact. Every caller is resolving an identifier — a scanned QR, a
 * `?parada=` link, an API path — and none of them is searching. A ranked fallback used
 * to run when the exact match failed, which meant a damaged sticker or a mistyped link
 * produced somebody else's arrival board rather than an error: "../" and "." both came
 * back as one stop, "-1" and "NaN" as two others. A board that
 * is confidently wrong is worse than a board that says it does not know that code.
 *
 * A full name still resolves, exactly, because a shared link can carry one. What is
 * gone is the ranking: partial and approximate matching is a search box's job, and the
 * search field and the planner each do their own with the right shape for it.
 */
export function findStop(query: string): BusStop | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const lower = q.toLowerCase();

  return (
    BUS_STOPS.find((s) => s.id.toLowerCase() === lower) ||
    BUS_STOPS.find((s) => s.code.toLowerCase() === lower) ||
    // The operator's own stop number, which is what a `?ps=` link carries.
    BUS_STOPS.find((s) => s.officialIds?.some((id) => String(id) === q)) ||
    // A whole name, including one the operator still prints for a merged pole.
    BUS_STOPS.find(
      (s) =>
        s.name.toLowerCase() === lower ||
        (s.aliases ?? []).some((a) => a.toLowerCase() === lower),
    )
  );
}

/** Stops sorted by walking distance — an estimate, see getNearestStopToCoords. */
/**
 * How far away a stop can be and still answer "which stops are near me".
 *
 * The function below sorts every stop by distance and returns all of them, which is what
 * the planner and the line lists want. What it must not be is an answer to a person: from
 * Madrid it ranks Santa Comba first, 423 km away, and a list is a list — somebody reading
 * quickly sees five stops and not the units.
 *
 * Two kilometres, and the number comes from the network rather than from taste: the widest
 * gap between any stop and its nearest neighbour is 3.5 km, so nobody standing anywhere the
 * buses actually reach is more than about 1.8 km from one. Anything past that is not a walk
 * somebody is going to take to catch a bus, and saying so is more useful than ranking it.
 */
export const NEARBY_STOP_LIMIT_METRES = 2000;

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
