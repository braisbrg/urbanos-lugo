/**
 * Great-circle distance, in one place.
 *
 * The same Haversine, with the same earth radius, was written out six times: once in the
 * engine and five times across the tools. Nothing had drifted -- they were character for
 * character the same arithmetic -- but a formula that five files each keep their own copy
 * of is five chances for one of them to be edited alone, and this project already learned
 * that lesson with the HTML escaper and with the OSM stitcher.
 *
 * Two functions rather than one because the copies genuinely differed in one respect: the
 * engine and three of the tools round to the metre, while the OSM stitcher and the
 * reconciler accumulate unrounded metres along a polyline and would come out different if
 * each segment were rounded first. Rounding stays at the call site that wanted it.
 */

/** Metres between two points, unrounded. */
export function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/** The same, rounded to the metre. What every caller in the app wants. */
export function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return Math.round(metresBetween(lat1, lon1, lat2, lon2));
}
