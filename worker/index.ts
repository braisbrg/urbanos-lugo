/**
 * The two things GitHub Pages cannot do, and nothing else.
 *
 * The app computes every time in the browser, so a static host serves it whole. Two
 * pieces of information are the exception, and only because of CORS: the operator's
 * service notices and the minutes their own page shows behind the QR sticker on a pole.
 * Neither site sends an `Access-Control-Allow-Origin` header, so a browser is refused and
 * something with a server has to ask on its behalf. On Pages there is nothing, and the
 * app says so — it falls back to the committed snapshot and shows its date.
 *
 * This is that something. It reimplements nothing: the handlers below are the same two
 * `server.ts` exposes, calling the same functions in `src/services/`, which use nothing
 * but `fetch`, `Response`, `ReadableStream` and `TextDecoder`. Self-hosting `server.ts`
 * remains the other way to get the same endpoints; this is not a replacement for it.
 *
 * It runs on Deno Deploy. It was written for Cloudflare Workers first, and moving it took
 * three lines — the environment, the deferred cache write, and the entry point — because
 * everything that matters here is web-standard. Which is the point: if this has to move
 * again, what changes is the deployment and not what it does. Written up in the README
 * under "Despregue".
 */
import { syncOfficialAlerts } from '../src/services/alertSyncService';
import { operatorTimesResponse } from '../src/services/operatorTimesRoute';

/**
 * How long the edge keeps an answer.
 *
 * The services in src/services/ already hold their own cache, but that one lives in a
 * module and an edge runtime may be running many isolates at once — so it bounds nothing
 * on its own. The Cache API sits in front of all of them and is what actually keeps the
 * outbound request count near one per window, which is the promise this project makes to
 * two free services it does not own.
 */
const EDGE_SECONDS = { alerts: 30 * 60, operator: 20 };

/**
 * The one site allowed to call this, e.g. `https://braisbrg.github.io`. Set in the
 * deployment's environment; there is no default on purpose, because a wildcard would let
 * any page on the internet spend this deployment's free requests. Unset, the response
 * carries no allow-origin header at all and a browser refuses it — failing closed.
 */
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '';

const json = (body: unknown, status: number, maxAge: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': ALLOWED_ORIGIN,
      // The header above comes from configuration rather than from the request, so this
      // promises nothing today. It is here for the day somebody echoes the request's
      // Origin instead, when its absence would be a cache-poisoning bug.
      vary: 'Origin',
      'cache-control': `public, max-age=${maxAge}`,
      'x-content-type-options': 'nosniff',
    },
  });

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method !== 'GET') return json({ error: 'Only GET' }, 405, 0);

  // `caches.open(name)` is the web standard; Cloudflare's `caches.default` is the same
  // shared cache under a name only Cloudflare knows, and using it was the single line
  // that would have tied this file to one host.
  //
  // The allowed origin goes in the key because it goes in the response: change it and
  // every cached answer still carries the old one, so the site that is now allowed gets
  // refused by its own browser for up to half an hour, with nothing in any log saying
  // why. Found exactly that way. `Vary: Origin` does not help here, for the reason above.
  const cache = await caches.open('urbanos-lugo-api');
  const cacheKey = new Request(
    `${url.origin}${url.pathname}${url.search}${url.search ? '&' : '?'}__origin=${encodeURIComponent(ALLOWED_ORIGIN)}`,
  );
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const respond = async (body: unknown, status: number, maxAge: number): Promise<Response> => {
    const res = json(body, status, maxAge);
    // Only cache a real answer. An error cached for half an hour is half an hour of the
    // same error, and both upstreams fail in ways that pass. Awaited rather than deferred
    // to a runtime-specific waitUntil: it is a local write, and correctness beats the
    // millisecond.
    if (status === 200 && maxAge > 0) await cache.put(cacheKey, res.clone());
    return res;
  };

  if (url.pathname === '/api/alerts') {
    const force = url.searchParams.get('refresh') === 'true';
    const data = await syncOfficialAlerts(force);
    return respond(data, 200, force ? 0 : EDGE_SECONDS.alerts);
  }

  const stopMatch = url.pathname.match(/^\/api\/paradas\/([^/]+)\/agora$/);
  if (stopMatch) {
    // Shared with the express server, which serves the same endpoint. Only the caching
    // differs: an answer is worth holding at the edge, an error is not.
    const { status, body } = await operatorTimesResponse(decodeURIComponent(stopMatch[1]));
    return respond(body, status, status === 200 ? EDGE_SECONDS.operator : 0);
  }

  return respond({ error: 'Unknown endpoint' }, 404, 0);
}

export default { fetch: handle };
