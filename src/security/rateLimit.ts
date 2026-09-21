import type { NextFunction, Request, Response } from 'express';

/**
 * A ceiling on how fast one address can ask. What it protects is the process: a loop
 * over `/api/plan` costs real CPU each time (tools/stressEngine.ts: median 25 ms, p95
 * 67 ms, worst 82 ms over 72 pairs), so at the worst case the plan cap is 2.5 seconds of
 * CPU a minute per address. In memory and per process on purpose: a restart forgets, and
 * two instances behind a load balancer allow twice this, both fine for one small server.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
const MAX_PLANS_PER_WINDOW = 30;

interface Bucket {
  count: number;
  plans: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function bucketFor(key: string, now: number): Bucket {
  const found = buckets.get(key);
  if (found && found.resetAt > now) return found;
  const fresh = { count: 0, plans: 0, resetAt: now + WINDOW_MS };
  buckets.set(key, fresh);
  return fresh;
}

// Sweeps what the traffic did not touch, on a timer rather than per request, so a burst
// from many addresses does not leave an entry each for ever.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}, WINDOW_MS);
sweep.unref?.();

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  // `req.ip` is undefined without a trust-proxy setting on some deployments, and an empty
  // key would put everyone in one bucket.
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = bucketFor(key, now);
  const planning = req.path.startsWith('/plan');
  bucket.count += 1;
  if (planning) bucket.plans += 1;

  const reset = Math.ceil((bucket.resetAt - now) / 1000);
  if (bucket.count > MAX_PER_WINDOW || (planning && bucket.plans > MAX_PLANS_PER_WINDOW)) {
    const retryAfter = Math.max(1, reset);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Too many requests', retryAfterSeconds: retryAfter });
    return;
  }
  res.setHeader('RateLimit-Limit', String(MAX_PER_WINDOW));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, MAX_PER_WINDOW - bucket.count)));
  res.setHeader('RateLimit-Reset', String(reset));
  next();
}
