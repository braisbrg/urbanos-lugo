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
// A failed read is held for a minute, not thirty: it says what happened at one moment,
// and the service memory keeps the outbound cooldown whatever the edge does.
const EDGE_SECONDS = { alerts: 30 * 60, unreachable: 60, operator: 20 };

/**
 * The one site allowed to call this, e.g. `https://braisbrg.github.io`. Set in the
 * deployment's environment; there is no default on purpose, because a wildcard would let
 * any page on the internet spend this deployment's free requests. Unset, the response
 * carries no allow-origin header at all and a browser refuses it — failing closed.
 */
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '';
/** The commit this deployment was built from, set by the deploy workflow; null when run by hand. */
const DEPLOY_SHA = Deno.env.get('DEPLOY_SHA') ?? null;

/**
 * Never store an answer no browser will accept.
 *
 * There are two caches in front of this, and only one of them is ours. The cache below is
 * keyed with ALLOWED_ORIGIN in the key, precisely so that changing it cannot serve an
 * answer carrying the old one. Deno's own edge cache is the other, it obeys the
 * `cache-control` header written here, and it keys on the request URL — which has no
 * origin in it. So the careful key protected nothing at the layer that mattered.
 *
 * It showed up the first time the app went live against this worker: the deployment had
 * run once with ALLOWED_ORIGIN unset, that answer went out with an empty allow-origin
 * header, and the edge held it for the full half hour. Measured on the published site —
 * the plain URL came back `age: 151` with no allow-origin at all, while the same URL with
 * a cache-buster came back correct.
 *
 * `Vary: Origin` does not help: the requests were identical, and what differed was this
 * deployment's configuration. So the rule is simpler than a cache key — an answer that
 * cannot be read by the site it is for is not worth keeping, anywhere.
 */
const cacheableFor = (maxAge: number): number => (ALLOWED_ORIGIN ? maxAge : 0);

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
      // no-store, not a short max-age: an answer without a usable allow-origin is not
      // stale, it is unusable, and the point is that nothing keeps it at all.
      'cache-control': cacheableFor(maxAge) > 0 ? `public, max-age=${cacheableFor(maxAge)}` : 'no-store',
      // When this answer was made, so the read above can tell a fresh one from a
      // three-day-old one without depending on the runtime to compute `age`.
      'x-stored-at': String(Date.now()),
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
  /*
   * A stored answer is served only while it is still the answer.
   *
   * `cache.match` does not read `cache-control`. It returns whatever was put there, for
   * as long as the store keeps it, and nothing here was checking. Measured against the
   * live worker: `age: 259156` on a response that declares `max-age=1800` — three days
   * on a half-hour answer, a hundred and forty times past its own stated freshness. The
   * comment below says a bad answer lasts "up to half an hour". It lasted until someone
   * noticed.
   *
   * That is also how a response with no `access-control-allow-origin` came to be served
   * to the published site three days after whatever deployment produced it, which is the
   * bug that got reported: the browser refused it, the log said the header was missing,
   * and nothing upstream was wrong any more.
   *
   * So both halves are checked on the way out, not only on the way in. The age comes from
   * a stamp written at store time rather than from the `age` header, because that header
   * is the runtime's to set and this file runs in more than one. And an answer whose
   * allow-origin is not the one this deployment would send is discarded whatever its age:
   * the same rule `cacheableFor` applies when storing, applied when reading.
   */
  const hit = await cache.match(cacheKey);
  if (hit) {
    const storedAt = Number(hit.headers.get('x-stored-at'));
    const maxAge = Number(/max-age=(\d+)/.exec(hit.headers.get('cache-control') ?? '')?.[1] ?? 0);
    const fresh = Number.isFinite(storedAt) && storedAt > 0 && (Date.now() - storedAt) / 1000 < maxAge;
    const usable = (hit.headers.get('access-control-allow-origin') ?? '') === ALLOWED_ORIGIN;
    if (fresh && usable) return hit;
    // Take it out rather than leaving it to be re-read and re-rejected on every request.
    await cache.delete(cacheKey);
  }

  const respond = async (body: unknown, status: number, maxAge: number): Promise<Response> => {
    const res = json(body, status, maxAge);
    // Only cache a real answer. An error cached for half an hour is half an hour of the
    // same error, and both upstreams fail in ways that pass. Awaited rather than deferred
    // to a runtime-specific waitUntil: it is a local write, and correctness beats the
    // millisecond.
    if (status === 200 && cacheableFor(maxAge) > 0) await cache.put(cacheKey, res.clone());
    return res;
  };

  // Which commit is answering. It is the deploy checklist's first question, and the only
  // way to tell a fresh deployment from an edge cache still serving the last one: the
  // worker ran nine days without a CORS header before anyone could say which code it was.
  if (url.pathname === '/api/version') return respond({ sha: DEPLOY_SHA }, 200, 0);

  if (url.pathname === '/api/alerts') {
    const force = url.searchParams.get('refresh') === 'true';
    const data = await syncOfficialAlerts(force);
    return respond(data, 200, force ? 0 : data.status === 'unreachable' ? EDGE_SECONDS.unreachable : EDGE_SECONDS.alerts);
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
