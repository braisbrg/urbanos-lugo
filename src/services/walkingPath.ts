/**
 * The shape of a walked leg and where a plan does its walking. The answering is
 * `src/utils/walkRouter.ts`, on the device: nothing leaves the phone and nothing waits.
 */
import { routeOnFoot, WalkRoute } from '../utils/walkRouter';

type Point = { lat: number; lng: number };
export type Hop = [[number, number], [number, number]];

/** The hops a plan walks: origin to first stop, between legs, last stop to destination. */
export function walkHopsOf(plan: { segments: { type: string; fromStop?: Point; toStop?: Point }[] } | null, origin?: Point, destination?: Point): Hop[] {
  if (!plan || !origin || !destination) return [];
  const hops: Hop[] = [];
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

export type WalkingPath = WalkRoute;
/** Real pedestrian routes for a plan's walking hops, keyed by walkHopKey; null where there is no pedestrian route. */
export type WalkPaths = Record<string, WalkingPath | null>;

/** Identifies a walked hop. The routing and the drawing must agree on it. */
export const walkHopKey = (from: [number, number], to: [number, number]): string =>
  `${from[0].toFixed(5)},${from[1].toFixed(5)}>${to[0].toFixed(5)},${to[1].toFixed(5)}`;

/**
 * The walk between two points along real pavement. Null means there is no pedestrian route
 * (true for seven stops on the N-VI, where a straight line would be a stroll across fields),
 * or the network chunk could not load; the caller keeps its straight line either way.
 */
export async function fetchWalkingPath(from: [number, number], to: [number, number], signal?: AbortSignal): Promise<WalkingPath | null> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  try {
    return await routeOnFoot(from, to);
  } catch {
    return null;
  }
}
