/**
 * Where the buses are, derived from the timetable. Nobody publishes positions for this
 * network, so every one of these is an estimate and is labelled as one on screen.
 *
 * Pure functions over the shipped dataset, no React and no DOM. One of the four files
 * the old transitEngine.ts was split into, by subject.
 */
import { BUS_STOPS, BUS_LINES } from '../data/transitData';
import { ScheduledBus } from '../types';
import { getDistanceMeters } from './geo';
import { MINUTES_PER_DAY, buildRuns, dayKind, handoverMinutes, lineRunsOn } from './schedule';
import { occupancyAt } from './arrivals';

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
 * departed and not yet handed over to its own return leg (`handoverMinutes`) or
 * arrived. Outside service hours the fleet is empty, which is what the network actually
 * looks like at 23:00.
 */
export function getScheduledBuses(now: Date = new Date()): ScheduledBus[] {
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const today = dayKind(now);
  const buses: ScheduledBus[] = [];

  BUS_LINES.forEach((line) => {
    if (!lineRunsOn(line, today)) return;
    const handover = handoverMinutes(line, BUS_STOPS, today);

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
        // service it does. The handover is the same turnaround seen from the other side:
        // once the return leg this run feeds has left, this marker is that bus's past.
        // The times below are still the run's own, so the bus sits where the timetable
        // says right up to the minute it stops being drawn.
        const drawnUntil = handover.get(`${dirIndex}|${runIndex}`) ?? end;
        if (t < start || t >= drawnUntil) return;

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

