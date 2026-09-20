/**
 * The two things GitHub Pages cannot do, and nothing else: the operator's service notices
 * and the minutes their page shows behind the QR sticker. Neither site sends a CORS header,
 * so something with a server has to ask on the browser's behalf. On Deno Deploy, written
 * with web standards only, so the same handlers `server.ts` exposes run here unchanged.
 */
import { syncOfficialAlerts } from '../src/services/alertSyncService';
import { operatorTimesResponse } from '../src/services/operatorTimes';

/**
 * How long the edge keeps an answer. The services' own caches live in a module, and an
 * edge runtime may run many isolates; the Cache API in front is what actually keeps the
 * outbound request count near one per window. A failed read is held for a minute, not thirty.
 */
const EDGE_SECONDS = { alerts: 30 * 60, unreachable: 60, operator: 20 };

/** The one site allowed to call this. No default on purpose: unset, the response carries no allow-origin and a browser refuses it. */
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '';
/** The commit this deployment was built from; null when run by hand. */
const DEPLOY_SHA = Deno.env.get('DEPLOY_SHA') ?? null;

/** Never store an answer no browser will accept: an answer without a usable allow-origin is not stale, it is unusable. */
const cacheableFor = (maxAge: number): number => (ALLOWED_ORIGIN ? maxAge : 0);

const json = (body: unknown, status: number, maxAge: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': ALLOWED_ORIGIN,
      vary: 'Origin',
      'cache-control': cacheableFor(maxAge) > 0 ? `public, max-age=${cacheableFor(maxAge)}` : 'no-store',
      // When this answer was made, so a read can tell a fresh one from a three-day-old one whatever the runtime computes for `age`.
      'x-stored-at': String(Date.now()),
      'x-content-type-options': 'nosniff',
    },
  });

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET') return json({ error: 'Only GET' }, 405, 0);

  // `caches.open(name)` is the web standard; the allowed origin goes in the key because it goes in the response.
  const cache = await caches.open('urbanos-lugo-api');
  const cacheKey = new Request(`${url.origin}${url.pathname}${url.search}${url.search ? '&' : '?'}__origin=${encodeURIComponent(ALLOWED_ORIGIN)}`);

  // `cache.match` does not read `cache-control` — a half-hour answer was served for three
  // days — so both freshness and the allow-origin are checked on the way out.
  const hit = await cache.match(cacheKey);
  if (hit) {
    const storedAt = Number(hit.headers.get('x-stored-at'));
    const maxAge = Number(/max-age=(\d+)/.exec(hit.headers.get('cache-control') ?? '')?.[1] ?? 0);
    const fresh = Number.isFinite(storedAt) && storedAt > 0 && (Date.now() - storedAt) / 1000 < maxAge;
    const usable = (hit.headers.get('access-control-allow-origin') ?? '') === ALLOWED_ORIGIN;
    if (fresh && usable) return hit;
    await cache.delete(cacheKey);
  }

  const respond = async (body: unknown, status: number, maxAge: number): Promise<Response> => {
    const res = json(body, status, maxAge);
    // Only a real answer is cached: an error cached for half an hour is half an hour of the same error.
    if (status === 200 && cacheableFor(maxAge) > 0) await cache.put(cacheKey, res.clone());
    return res;
  };

  // Which commit is answering: the only way to tell a fresh deployment from an edge cache still serving the last one.
  if (url.pathname === '/api/version') return respond({ sha: DEPLOY_SHA }, 200, 0);

  if (url.pathname === '/api/alerts') {
    const force = url.searchParams.get('refresh') === 'true';
    const data = await syncOfficialAlerts(force);
    return respond(data, 200, force ? 0 : data.status === 'unreachable' ? EDGE_SECONDS.unreachable : EDGE_SECONDS.alerts);
  }

  const stopMatch = url.pathname.match(/^\/api\/paradas\/([^/]+)\/agora$/);
  if (stopMatch) {
    const { status, body } = await operatorTimesResponse(decodeURIComponent(stopMatch[1]));
    return respond(body, status, status === 200 ? EDGE_SECONDS.operator : 0);
  }

  return respond({ error: 'Unknown endpoint' }, 404, 0);
}

export default { fetch: handle };
