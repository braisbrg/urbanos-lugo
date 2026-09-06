/**
 * Real pedestrian geometry for a walking leg.
 *
 * We cannot precompute this: the endpoints are wherever the user asked for. It needs a
 * routing engine at request time, and the public OSRM demo only carries the driving
 * profile — it answered a 3.5 km walk in "10 minutes", following one-way streets and
 * ignoring the pedestrianised old town. OSM's own foot router gives the real thing.
 *
 * So this is opt-in, fetched only when the user asks to see the path, and cached for the
 * session. The map draws a straight dashed line until then, which keeps the app working
 * with no connection at all.
 */

const FOOT_ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';

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

const cache = new Map<string, WalkingPath | null>();

/**
 * One request a second, because that is what the people paying for the server ask for.
 *
 * FOSSGIS run this router for nothing and state the terms plainly: "One request per
 * second max. No scraping, no heavy usage." A plan has up to nine walked hops once its
 * alternatives are counted, and they all went out together in a single `Promise.all`
 * burst — nine times the rate asked for, from every reader at once. They queue now, a
 * second apart, and the caller draws each leg as it lands instead of waiting for the
 * set. Cached hops never reach the queue, which is most of them: the options share
 * endpoints.
 */
const MIN_GAP_MS = 1000;
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function queued<T>(job: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const run = queue.then(async () => {
    // Nothing to slow down for if the caller has already walked away.
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();
    return job();
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Identifies a walked hop. Both the fetch and the drawing must agree on it. */
export const walkHopKey = (from: [number, number], to: [number, number]): string =>
  `${from[0].toFixed(5)},${from[1].toFixed(5)}>${to[0].toFixed(5)},${to[1].toFixed(5)}`;

export async function fetchWalkingPath(
  from: [number, number],
  to: [number, number],
  signal?: AbortSignal,
): Promise<WalkingPath | null> {
  const id = walkHopKey(from, to);
  if (cache.has(id)) return cache.get(id)!;

  try {
    const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`;
    const res = await queued(
      () => fetch(`${FOOT_ROUTER}/${coords}?overview=full&geometries=geojson`, { signal }),
      signal,
    );
    if (!res.ok) throw new Error(String(res.status));

    const json = await res.json();
    if (json.code !== 'Ok' || !json.routes?.length) throw new Error(json.code || 'no route');

    const route = json.routes[0];
    const result: WalkingPath = {
      path: route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]),
      meters: Math.round(route.distance),
      minutes: Math.round(route.duration / 60),
    };
    cache.set(id, result);
    return result;
  } catch (error) {
    // An abort is not an answer. The effect that calls this aborts on every plan change
    // and twice on mount under StrictMode, and caching null here retired the hop for the
    // rest of the session — the straight line came back and never left.
    if ((error as Error)?.name === 'AbortError') throw error;
    // Offline, blocked, or the router is down: the caller keeps its straight line.
    cache.set(id, null);
    return null;
  }
}
