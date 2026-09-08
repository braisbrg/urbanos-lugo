/**
 * One Content Security Policy, used in both places it has to exist.
 *
 * The published build is served by GitHub Pages, and a static host sets no headers, so
 * the policy has to travel inside the page. Anyone self-hosting gets it from `server.ts`
 * as a real header instead. Writing it twice would mean maintaining it twice and finding
 * out on the day they disagreed.
 *
 * Every remote origin here is one the app actually uses, and the list has only ever got
 * shorter: OpenFreeMap for the basemap, and tile.openstreetmap.org as the raster fallback
 * for a device with no WebGL2. That is all of them.
 *
 * Two used to be here and are not. Google Fonts went when the typefaces moved to this
 * site (`tools/importFonts.ts`), so `font-src` is a bare 'self'. OpenStreetMap's foot
 * router went when the pedestrian network moved into the bundle and the walk started
 * being routed on the device. buslugo.com was never here — only the server reaches it,
 * because CORS blocks the browser.
 *
 * Scripts are same-origin only plus exactly one hash: no wasm, and the QR scanner uses the
 * browser's own BarcodeDetector rather than a library. The map renderer runs a worker, but
 * Vite emits it as a same-origin module, so `worker-src` stays at 'self' rather than
 * opening up to blob:. If that ever stops holding the map goes blank and the console says
 * so — do not widen the directive without checking that the bundler has genuinely stopped
 * emitting a same-origin worker.
 *
 * The hash is the theme script, which has to run before the first paint and cost a whole
 * round trip while it was a file. `'sha256-…'` is not `'unsafe-inline'`: it admits one byte
 * sequence, which makes it narrower than the `'self'` beside it, and it is computed here
 * from the same export the page inlines so the two cannot disagree. Adding a second hash
 * would be a real widening; adding `'unsafe-inline'` would throw the whole directive away,
 * and tools/test.ts refuses both.
 *
 * `unsafe-inline` under style-src is load-bearing — stop popups are built as HTML with
 * style attributes — and scripts do not get the same licence.
 */
import { createHash } from 'node:crypto';
import { THEME_INIT_SOURCE } from './themeInit';

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

/**
 * The digest of the one inline script, in the form CSP wants.
 *
 * Computed from the export the page inlines, at module load, in Node — this file is only
 * ever imported by vite.config.ts, server.ts and the test suite, never by the browser.
 */
export const THEME_INIT_HASH = `sha256-${createHash('sha256').update(THEME_INIT_SOURCE, 'utf8').digest('base64')}`;

const DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  `script-src 'self' '${THEME_INIT_HASH}'`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // No CDN: the typeface is served from this origin. See tools/importFonts.ts.
  "font-src 'self'",
  // blob: because the renderer decodes sprites and glyphs into object URLs before
  // drawing them; it never fetches an image from an origin not named here.
  "img-src 'self' data: blob: https://tiles.openfreemap.org https://tile.openstreetmap.org",
  // The pedestrian router used to be here too. The app carries the network and routes
  // on the device now, so the policy is one origin smaller than it was.
  `connect-src 'self' https://tiles.openfreemap.org${apiOrigin}`,
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
