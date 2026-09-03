/**
 * Where to ask for `/api/…`.
 *
 * Two shapes, one slash apart, which is why this is a function and not an expression
 * written twice. Beside the page — `pnpm dev`, `pnpm start` — the base already ends in a
 * slash and the path follows it. Pointed at a Worker, the origin has no trailing slash
 * and the path needs its own.
 *
 * With neither, the request simply 404s and both callers fall back to what they show on
 * the static build anyway: the committed snapshot of the notices, and nothing at all for
 * the operator's minutes.
 */
export function apiUrl(path: string): string {
  const origin = import.meta.env.VITE_API_ORIGIN;
  return origin ? `${origin.replace(/\/$/, '')}/api/${path}` : `${import.meta.env.BASE_URL}api/${path}`;
}
