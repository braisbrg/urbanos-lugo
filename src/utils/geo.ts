/**
 * Great-circle distance, in one place: the same Haversine used to be written out six times.
 * Two functions because the copies differed in one respect — the polyline accumulators
 * need unrounded metres, everything in the app wants whole ones.
 */

const EARTH_RADIUS_M = 6371e3;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Metres between two points, unrounded. */
export function metresBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** The same, rounded to the metre. */
export const getDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number =>
  Math.round(metresBetween(lat1, lon1, lat2, lon2));
