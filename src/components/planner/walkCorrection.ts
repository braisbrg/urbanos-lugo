import type { RoutePlanResult } from '../../types';
import { formatMinutes, parseTimeToMinutes } from '../../utils/schedule';
import { estimateWalk } from '../../utils/places';
import { getDistanceMeters } from '../../utils/geo';
import { WalkingPath, walkHopKey, walkHopsOf } from '../../services/walkingPath';

export type Point = { lat: number; lng: number; name: string };
export type WalkPaths = Record<string, WalkingPath | null>;
export interface Endpoints {
  origin?: Point;
  destination?: Point;
}

/** Move an "HH:MM" label by a signed number of minutes, wrapping past midnight. */
export const shiftClock = (hhmm: string, deltaMinutes: number): string => (deltaMinutes ? formatMinutes(parseTimeToMinutes(hhmm) + deltaMinutes) : hhmm);

/**
 * How far out the estimated walk was, split by whether it can cost you the bus: `before`
 * is the walk to the first stop, `after` every other walked hop. Either can be negative.
 */
export interface WalkCorrection {
  before: number;
  after: number;
}

export const NO_CORRECTION: WalkCorrection = { before: 0, after: 0 };

/**
 * The plan, once the router has said how long the walk really is. The bus leaves when
 * it leaves: a longer walk delays *you*, and the only thing it can eat is the cushion the
 * plan handed back as a later departure (`slackMinutes`). Past the cushion the departure
 * would be before now — the bus is gone — so the arrival is left alone and the option
 * says so (`reachable: false`). A shorter walk sets off later and lands at the same minute.
 */
export function withMeasuredWalk(plan: RoutePlanResult, fix: WalkCorrection) {
  const absorbed = Math.min(fix.before, plan.slackMinutes);
  const missedBy = fix.before - absorbed;
  return {
    reachable: missedBy <= 0,
    missedBy,
    departure: shiftClock(plan.departureTime, -absorbed),
    arrival: shiftClock(plan.arrivalTime, fix.after),
    durationMinutes: plan.durationMinutes + absorbed + fix.after,
  };
}

/**
 * The difference between the estimated and the measured walk for a plan, all or nothing
 * (half-measured totals would be neither the estimate nor the truth). Measured against
 * `estimateWalk` on each hop rather than the plan's walk segments: a transfer between two
 * poles is walked but has no segment, only a gap in the clock. The first hop is the only
 * one taken before boarding; a plan with no bus has nothing to miss, so it is all `after`.
 */
export function correctionFor(plan: RoutePlanResult | null, endpoints: Endpoints, walkPaths: WalkPaths): WalkCorrection {
  if (!plan) return NO_CORRECTION;
  const hops = walkHopsOf(plan, endpoints.origin, endpoints.destination);
  const measured = hops.map(([a, b]) => walkPaths[walkHopKey(a, b)]);
  if (!hops.length || measured.some((w) => !w)) return NO_CORRECTION;

  const ridesABus = plan.segments.some((s) => s.type === 'bus');
  // Once a measured walk has been handed back to `planTrips`, the plan is already built on it.
  const planned = plan.segments[0]?.type === 'walk' ? plan.segments[0].durationMinutes : undefined;
  let before = 0;
  let after = 0;
  hops.forEach(([a, b], i) => {
    const estimate = i === 0 && planned !== undefined ? planned : estimateWalk(getDistanceMeters(a[0], a[1], b[0], b[1])).minutes;
    const diff = (measured[i] as WalkingPath).minutes - estimate;
    if (i === 0 && ridesABus) before += diff;
    else after += diff;
  });
  return { before, after };
}

/** Real walking totals for a plan, once every hop has been routed; null while any is missing. */
export function measuredWalkFor(plan: RoutePlanResult | null, endpoints: Endpoints, walkPaths: WalkPaths): { minutes: number; meters: number } | null {
  const hops = walkHopsOf(plan, endpoints.origin, endpoints.destination);
  const found = hops.map(([a, b]) => walkPaths[walkHopKey(a, b)]).filter((w): w is WalkingPath => !!w);
  if (!found.length || found.length !== hops.length) return null;
  return { minutes: found.reduce((n, w) => n + w.minutes, 0), meters: found.reduce((n, w) => n + w.meters, 0) };
}

/** "0,5 km" — the way a distance is printed on this screen. */
export const formatKm = (meters: number): string => (meters / 1000).toFixed(1).replace('.', ',');
