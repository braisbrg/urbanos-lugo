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
 * This is that something, small enough to be free and stateless enough to be boring. The
 * handlers below are the same two `server.ts` exposes, calling the same functions in
 * `src/services/`, which use nothing but `fetch`, `Response`, `ReadableStream` and
 * `TextDecoder` — all of which a Worker has. Self-hosting `server.ts` remains the other
 * way to get the same endpoints; this is not a replacement for it.
 *
 * Deploying it is written up in the README under "Despregue".
 */
import { syncOfficialAlerts } from '../src/services/alertSyncService';
import { operatorTimesForStop } from '../src/services/operatorTimes';
import { poleCode } from '../src/data/transitData';
import { findStop } from '../src/utils/transitEngine';

interface Env {
  /**
   * The one site allowed to call this, e.g. `https://braisbrg.github.io`. Set with
   * `wrangler secret put` or in the dashboard; there is no default on purpose, because a
   * wildcard would let any page on the internet spend this Worker's free requests.
   */
  ALLOWED_ORIGIN?: string;
}

/**
 * How long the edge keeps an answer.
 *
 * The services in src/services/ already hold their own cache, but that one lives in a
 * module and a Worker may be running in many isolates at once — so it bounds nothing on
 * its own. Cloudflare's cache sits in front of all of them and is what actually keeps the
 * outbound request count near one per window, which is the promise this project makes to
 * two free services it does not own.
 */
const EDGE_SECONDS = { alerts: 30 * 60, operator: 20 };

const json = (body: unknown, status: number, origin: string, maxAge: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      // `Vary` because the header above depends on nothing else here, but a shared cache
      // that ever sees a second origin must not hand one site's answer to another.
      vary: 'Origin',
      'cache-control': `public, max-age=${maxAge}`,
      'x-content-type-options': 'nosniff',
    },
  });

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN ?? '';
    const url = new URL(request.url);

    if (request.method !== 'GET') {
      return json({ error: 'Only GET' }, 405, origin, 0);
    }

    // The edge cache. `?refresh=true` is a different URL, so the reader pressing the
    // button skips it without a special case.
    //
    // The allowed origin goes in the key because it goes in the response: change it and
    // every cached answer still carries the old one, so the site that is now allowed gets
    // refused by its own browser for up to half an hour, with nothing in any log saying
    // why. Found exactly that way. `Vary: Origin` does not help -- the header comes from
    // configuration, not from the request.
    // `caches.open(name)` and not Cloudflare's `caches.default`, which is the same thing
    // by a name only Cloudflare knows. Everything else in this file is the interface every
    // edge runtime implements -- a default export with fetch(request, env, ctx) -- so with
    // this line standard too, the whole Worker moves to another host by changing how it is
    // deployed and nothing about what it does.
    const cache = await caches.open('urbanos-lugo-api');
    const cacheKey = new Request(
      `${url.origin}${url.pathname}${url.search}${url.search ? '&' : '?'}__origin=${encodeURIComponent(origin)}`,
    );
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const respond = (body: unknown, status: number, maxAge: number): Response => {
      const res = json(body, status, origin, maxAge);
      // Only cache a real answer. An error cached for half an hour is half an hour of
      // the same error, and both upstreams fail in ways that pass.
      if (status === 200 && maxAge > 0) ctx.waitUntil(cache.put(cacheKey, res.clone()));
      return res;
    };

    if (url.pathname === '/api/alerts') {
      const force = url.searchParams.get('refresh') === 'true';
      const data = await syncOfficialAlerts(force);
      return respond(data, 200, force ? 0 : EDGE_SECONDS.alerts);
    }

    const stopMatch = url.pathname.match(/^\/api\/paradas\/([^/]+)\/agora$/);
    if (stopMatch) {
      // Only stops this app knows about. Without it anybody could use this Worker to fire
      // arbitrary codes at the operator's site, which is both rude and pointless: a code
      // we cannot resolve is a code they cannot either.
      const stop = findStop(decodeURIComponent(stopMatch[1]));
      if (!stop) return respond({ error: 'Unknown stop' }, 404, 0);
      const code = poleCode(stop);
      if (!code) return respond({ error: 'That stop has no operator code' }, 404, 0);

      const times = await operatorTimesForStop(code);
      // Null means their page could not be read, which is not the same as no buses
      // coming. 502 rather than an empty list, and the app shows only its own estimates.
      if (!times) return respond({ error: 'The operator could not be read' }, 502, 0);
      return respond(times, 200, EDGE_SECONDS.operator);
    }

    return respond({ error: 'Unknown endpoint' }, 404, 0);
  },
};
