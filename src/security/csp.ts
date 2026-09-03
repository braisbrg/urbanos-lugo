/**
 * One Content Security Policy, used in both places it has to exist.
 *
 * The published build is served by GitHub Pages, and a static host sets no headers, so
 * the policy has to travel inside the page. Anyone self-hosting gets it from `server.ts`
 * as a real header instead. Writing it twice would mean maintaining it twice and finding
 * out on the day they disagreed.
 *
 * Every remote origin here is one the app actually uses: OpenFreeMap for the basemap,
 * Google Fonts for the two typefaces, and OpenStreetMap's foot router for the measured
 * walking legs. tile.openstreetmap.org is the raster fallback for a device with no
 * WebGL2. buslugo.com is deliberately absent — only the server ever reaches it, because
 * CORS blocks the browser.
 *
 * Scripts are same-origin only, which the build allows: no inline script, no wasm, and
 * the QR scanner uses the browser's own BarcodeDetector rather than a library. The map
 * renderer runs a worker, but Vite emits it as a same-origin module, so `worker-src`
 * stays at 'self' rather than opening up to blob:. If that ever stops holding the map
 * goes blank and the console says so — do not widen the directive without checking that
 * the bundler has genuinely stopped emitting a same-origin worker.
 *
 * `unsafe-inline` under style-src is load-bearing — stop popups are built as HTML with
 * style attributes — and scripts do not get the same licence.
 */
/**
 * The Worker's address, when the build has one.
 *
 * `connect-src 'self'` covers the endpoints while a server serves them beside the page.
 * The published static build has no server, so it can be pointed at a Cloudflare Worker
 * instead — and then the policy has to admit exactly that origin and no other. Read from
 * the environment rather than written here because it belongs to whoever deploys it.
 *
 * `process.env` and not `import.meta.env`: this file is only ever imported by Node —
 * vite.config.ts, server.ts and the test suite — and never reaches the browser.
 */
const apiOrigin = (() => {
  const raw = process.env.VITE_API_ORIGIN;
  if (!raw) return '';
  try {
    // The origin alone, so a stray path or query cannot widen the directive.
    return ` ${new URL(raw).origin}`;
  } catch {
    return '';
  }
})();

const DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // blob: because the renderer decodes sprites and glyphs into object URLs before
  // drawing them; it never fetches an image from an origin not named here.
  "img-src 'self' data: blob: https://tiles.openfreemap.org https://tile.openstreetmap.org",
  `connect-src 'self' https://tiles.openfreemap.org https://routing.openstreetmap.de${apiOrigin}`,
  'upgrade-insecure-requests',
];

/**
 * For the `<meta>` tag.
 *
 * `frame-ancestors` is left out because a policy delivered in a meta element ignores it
 * and logs an error for every visitor. The header below carries it, and self-hosting
 * also sends `X-Frame-Options: DENY`.
 */
export const CSP_META = DIRECTIVES.join('; ');

/** For the response header, where `frame-ancestors` is honoured. */
export const CSP_HEADER = [...DIRECTIVES.slice(0, 3), "frame-ancestors 'none'", ...DIRECTIVES.slice(3)].join('; ');
