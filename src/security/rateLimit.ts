import type { NextFunction, Request, Response } from 'express';

/**
 * A ceiling on how fast one address can ask.
 *
 * Nothing here is expensive on its own — the timetable is in memory and the alert sync
 * has its own thirty-minute cache and sixty-second outbound cooldown, so buslugo.com is
 * never the thing being hammered. What this protects is the process: a loop over
 * `/api/plan` costs about 24 ms of planning each, which one client can turn into a busy
 * CPU for everybody else.
 *
 * Deliberately in memory and per process. That means a restart forgets, and two
 * instances behind a load balancer allow twice this. Both are fine for a single small
 * server; if this ever runs replicated, the counter belongs in something shared and this
 * comment is the place that said so.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
/** Planning is the one endpoint whose cost is measured in tens of milliseconds. */
const MAX_PLANS_PER_WINDOW = 30;

interface Bucket {
  count: number;
  plans: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Old buckets are dropped as they are met, so an idle key cannot leak for ever. */
function bucketFor(key: string, now: number): Bucket {
  const found = buckets.get(key);
  if (found && found.resetAt > now) return found;
  const fresh = { count: 0, plans: 0, resetAt: now + WINDOW_MS };
  buckets.set(key, fresh);
  return fresh;
}

/**
 * Sweeps whatever the traffic did not touch.
 *
 * Without this a burst from many addresses leaves an entry each, for ever. Runs on a
 * timer rather than on every request so a busy server does not pay for it per call.
 */
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}, WINDOW_MS);
sweep.unref?.();

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  // `req.ip` is undefined without a trust-proxy setting on some deployments; the socket
  // address is the honest fallback, and an empty key would put everyone in one bucket.
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = bucketFor(key, now);

  const planning = req.path.startsWith('/plan');
  bucket.count += 1;
  if (planning) bucket.plans += 1;

  const over = bucket.count > MAX_PER_WINDOW || (planning && bucket.plans > MAX_PLANS_PER_WINDOW);
  if (over) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Too many requests', retryAfterSeconds: retryAfter });
    return;
  }

  const remaining = Math.max(0, MAX_PER_WINDOW - bucket.count);
  res.setHeader('RateLimit-Limit', String(MAX_PER_WINDOW));
  res.setHeader('RateLimit-Remaining', String(remaining));
  res.setHeader('RateLimit-Reset', String(Math.ceil((bucket.resetAt - now) / 1000)));
  next();
}

