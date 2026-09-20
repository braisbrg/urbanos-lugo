/**
 * Where to ask for `/api/…`: beside the page (`pnpm dev`, `pnpm start`), or at the Worker
 * named by VITE_API_ORIGIN. With neither, the request 404s and both callers fall back to
 * what the static build shows anyway.
 */
export function apiUrl(path: string): string {
  const origin = import.meta.env.VITE_API_ORIGIN;
  return origin ? `${origin.replace(/\/$/, '')}/api/${path}` : `${import.meta.env.BASE_URL}api/${path}`;
}
