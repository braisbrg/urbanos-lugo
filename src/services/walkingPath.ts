/**
 * Real pedestrian geometry for a walking leg.
 *
 * This used to be a request to OSM's public foot router at routing.openstreetmap.de. The
 * app now carries the pedestrian network of Lugo and works the route out itself, in about
 * 0,7 ms, so what is left here is the shape of a walked leg and where a plan does its
 * walking — the answering is `src/utils/walkRouter.ts`.
 *
 * Three things went away with the request, and each was a real cost:
 *
 *  - **A coordinate left the device.** One end of the first leg is the reader's own GPS
 *    fix, and it went to a third party with their IP attached. That was behind a button
 *    for exactly that reason, and the button is gone because there is nothing left to
 *    consent to.
 *  - **It needed a connection**, on a screen whose whole point is working without one.
 *  - **It needed somebody else's server to be up**, and to keep tolerating us: FOSSGIS
 *    ask for one request a second, so a four-option plan spent nine seconds trickling
 *    its legs out one at a time.
 *
 * The signature is unchanged so that nothing above here had to be rewritten to notice.
 */
import { routeOnFoot } from '../utils/walkRouter';

/** The hops a plan walks: origin to first stop, between legs, last stop to destination. */
export function walkHopsOf(
  plan: { segments: { type: string; fromStop?: { lat: number; lng: number }; toStop?: { lat: number; lng: number } }[] } | null,
  origin?: { lat: number; lng: number },
  destination?: { lat: number; lng: number },
): [number, number][][] {
  if (!plan || !origin || !destination) return [];
  const hops: [number, number][][] = [];
  let previous: [number, number] = [origin.lat, origin.lng];
  for (const segment of plan.segments) {
    if (segment.type === 'bus' && segment.fromStop && segment.toStop) {
      hops.push([previous, [segment.fromStop.lat, segment.fromStop.lng]]);
      previous = [segment.toStop.lat, segment.toStop.lng];
    }
  }
  hops.push([previous, [destination.lat, destination.lng]]);
  return hops.filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]);
}

export interface WalkingPath {
  path: [number, number][];
  meters: number;
  minutes: number;
}

/** Identifies a walked hop. Both the routing and the drawing must agree on it. */
export const walkHopKey = (from: [number, number], to: [number, number]): string =>
  `${from[0].toFixed(5)},${from[1].toFixed(5)}>${to[0].toFixed(5)},${to[1].toFixed(5)}`;

/**
 * The walk between two points, along real pavement.
 *
 * Null means there is no pedestrian route, which for seven of the 417 stops is the true
 * answer rather than a failure: the N-VI stops out at Ombreiro and Bagueixos have
 * walkable ways within tens of metres, and nothing but a trunk road with no pavement
 * joining them to the city. A caller that turns null back into a straight line is
 * claiming a six-kilometre stroll across fields, so callers do not.
 *
 * The `signal` is kept because the caller aborts on every plan change and it costs
 * nothing to honour, though there is no longer a request in flight to abort.
 */
export async function fetchWalkingPath(
  from: [number, number],
  to: [number, number],
  signal?: AbortSignal,
): Promise<WalkingPath | null> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  try {
    return await routeOnFoot(from, to);
  } catch {
    // The network file failed to load — an offline first visit, or a chunk that never
    // arrived. The caller keeps its straight line, which is what it did before any of
    // this existed.
    return null;
  }
}
