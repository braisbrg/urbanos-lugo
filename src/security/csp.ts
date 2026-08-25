/**
 * One Content Security Policy, used in both places it has to exist.
 *
 * The published build is served by GitHub Pages, and a static host sets no headers, so
 * the policy has to travel inside the page. Anyone self-hosting gets it from `server.ts`
 * as a real header instead. Writing it twice would mean maintaining it twice and finding
 * out on the day they disagreed.
 *
 * Every remote origin here is one the app actually uses: CARTO for the map tiles, Google
 * Fonts for the two typefaces, and OpenStreetMap's foot router for the measured walking
 * legs. buslugo.com is deliberately absent — only the server ever reaches it, because
 * CORS blocks the browser.
 *
 * Scripts are same-origin only, which the build allows: no inline script, no worker, no
 * wasm, and the QR scanner uses the browser's own BarcodeDetector rather than a library.
 * `unsafe-inline` under style-src is load-bearing — stop popups are built as HTML with
 * style attributes — and scripts do not get the same licence.
 */
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
  "img-src 'self' data: https://*.basemaps.cartocdn.com",
  "connect-src 'self' https://routing.openstreetmap.de",
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
