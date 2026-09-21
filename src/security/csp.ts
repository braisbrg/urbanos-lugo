/**
 * One Content Security Policy, used in both places it has to exist: inside the page for
 * GitHub Pages, which sets no headers, and as a real header from `server.ts`.
 *
 * Every remote origin here is one the app uses: OpenFreeMap for the basemap, and
 * tile.openstreetmap.org as the raster fallback for a device with no WebGL2. Google Fonts
 * and OSM's foot router used to be here and are not; buslugo.com never was, only the
 * server reaches it. Scripts are same-origin plus exactly one hash, the theme script, which
 * admits one byte sequence and is computed here from the same export the page inlines.
 * `worker-src` stays at 'self' because Vite emits the map's worker as a same-origin
 * module: if that stops holding the map goes blank and the console says so.
 *
 * Only ever imported by Node (vite.config.ts, server.ts, the test suite), never the
 * browser, which is why `process.env` and `node:crypto` are fine here.
 */
import { createHash } from 'node:crypto';
import { THEME_INIT_SOURCE } from './themeInit';

/**
 * The Worker's address, when the static build is pointed at one: then the policy admits
 * exactly that origin. The origin alone, so a stray path or query cannot widen it.
 */
const apiOrigin = (() => {
  const raw = process.env.VITE_API_ORIGIN;
  if (!raw) return '';
  try {
    return ` ${new URL(raw).origin}`;
  } catch {
    return '';
  }
})();

/** The digest of the one inline script, in the form CSP wants. */
export const THEME_INIT_HASH = `sha256-${createHash('sha256').update(THEME_INIT_SOURCE, 'utf8').digest('base64')}`;

const DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  `script-src 'self' '${THEME_INIT_HASH}'`,
  "worker-src 'self'",
  "manifest-src 'self'",
  // 'unsafe-inline' is load-bearing: stop popups are built as HTML with style attributes.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  // blob: because the renderer decodes sprites and glyphs into object URLs before drawing.
  "img-src 'self' data: blob: https://tiles.openfreemap.org https://tile.openstreetmap.org",
  `connect-src 'self' https://tiles.openfreemap.org${apiOrigin}`,
  'upgrade-insecure-requests',
];

/** For the `<meta>` tag, which ignores `frame-ancestors` and would log an error for every visitor. */
export const CSP_META = DIRECTIVES.join('; ');

/** For the response header, where `frame-ancestors` is honoured. */
export const CSP_HEADER = [...DIRECTIVES.slice(0, 3), "frame-ancestors 'none'", ...DIRECTIVES.slice(3)].join('; ');
