import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { CSP_META } from './src/security/csp';
import { SITE_PATHS, robotsTxt, siteUrl, sitemapXml, structuredData } from './src/seo';

// GitHub Pages project sites live under /<repo>/, so every asset URL needs that prefix.
// Set BASE_PATH in the workflow; locally and on a root domain it stays '/'.
const base = process.env.BASE_PATH || '/';

/**
 * The policy goes into the built page, not the source one.
 *
 * In the source page it also applied to `vite dev`, where it blocked the HMR
 * websocket -- `connect-src 'self'` does not cover ws://localhost:24678. Widening
 * the production policy to admit a development socket would be the wrong way
 * round, so the tag is added when building and never in dev.
 */
/**
 * Where this build will live, or null.
 *
 * Set by the workflow. A canonical or a sitemap carrying the wrong origin is worse than
 * having neither -- it points crawlers at pages that do not exist -- so a build without
 * it simply omits them rather than guessing from the base path.
 */
const site = siteUrl(process.env.SITE_URL);

/** Vite's default output directory, named once so the fallback copy does not guess. */
const outDir = 'dist';

/**
 * A copy of the page at 404.html.
 *
 * GitHub Pages serves that file for any path it does not have on disk, which is every
 * tab route -- /paradas, /mapa and the rest exist only in the browser. Without it a
 * direct visit or a refresh on any of them lands on GitHub's own 404 instead of the app.
 */
/**
 * A .gz and a .br beside every asset worth compressing.
 *
 * The entry chunk goes out at 544 KB and gzips to 139; the whole first load is 587 KB
 * where 148 would do. GitHub Pages compresses by itself, so the published site never had
 * the problem -- but `npm start` serves dist/ through express.static, which does not, and
 * that is the documented way to self-host.
 *
 * Done here rather than per request: a build can afford brotli's slowest setting, and a
 * server answering a phone at a bus stop should not be spending CPU on something that
 * never changes between requests.
 */
const emitCompressedAssets = {
  name: 'emit-compressed-assets',
  apply: 'build' as const,
  closeBundle() {
    // Below about a kilobyte the headers cost more than the saving.
    const FLOOR = 1024;
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry): string[] => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return /\.(js|css|html|svg|json|webmanifest|xml|txt)$/.test(entry.name) ? [full] : [];
      });

    let saved = 0;
    for (const file of walk(outDir)) {
      const body = readFileSync(file);
      if (body.length < FLOOR) continue;
      const gz = gzipSync(body, { level: 9 });
      const br = brotliCompressSync(body, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length },
      });
      writeFileSync(file + '.gz', gz);
      writeFileSync(file + '.br', br);
      saved += body.length - br.length;
    }
    console.log(`  compressed assets: ${(saved / 1024).toFixed(0)} KB saved if the client takes brotli`);
  },
};

/**
 * A real page at every tab's address, and 404.html behind them.
 *
 * The fallback alone was enough to *render* /paradas or /tarifas -- Pages serves 404.html
 * for a path it does not have -- but it sends 404 with it, and a 404 is not only a
 * rendering detail. sitemap.xml advertises all six of these paths, and a crawler drops a
 * listed URL that answers 404, which turned the SEO work into a list of dead links. The
 * app also has a "copy link" button on every stop, and the apps people paste those into
 * skip the preview on a 404 -- so the og: tags added *because* those links get shared
 * were being thrown away too.
 *
 * One 4.6 KB copy per tab fixes both: the six addresses answer 200, and 404.html stays
 * for everything else, which is what still catches an old link or a mistyped path.
 *
 * Runs before emit-compressed-assets in the plugin list on purpose, so the copies get
 * their .br and .gz like every other file.
 */
const emitSpaFallback = {
  name: 'emit-spa-fallback',
  apply: 'build' as const,
  closeBundle() {
    const built = path.resolve(outDir, 'index.html');
    if (!existsSync(built)) return;
    copyFileSync(built, path.resolve(outDir, '404.html'));
    for (const route of SITE_PATHS) {
      if (!route) continue; // the root is index.html itself
      const dir = path.resolve(outDir, route);
      mkdirSync(dir, { recursive: true });
      copyFileSync(built, path.join(dir, 'index.html'));
    }
  },
};

/** robots.txt and sitemap.xml, written beside the built page. */
const emitSeoFiles = {
  name: 'emit-seo-files',
  apply: 'build' as const,
  generateBundle() {
    if (!site) return;
    for (const [fileName, source] of [
      ['robots.txt', robotsTxt(site)],
      ['sitemap.xml', sitemapXml(site)],
    ] as const) {
      // @ts-expect-error -- `this` is Rollup's plugin context at build time.
      this.emitFile({ type: 'asset', fileName, source });
    }
  },
};

/** The canonical link and the structured data, which both need the real address. */
const injectSeoTags = {
  name: 'inject-seo-tags',
  apply: 'build' as const,
  transformIndexHtml(html: string) {
    if (!site) return html;
    const tags = [
      `<link rel="canonical" href="${site}" />`,
      `<script type="application/ld+json">${structuredData(site)}</script>`,
    ].join('\n    ');
    return html.replace('<meta name="theme-color"', `${tags}\n    <meta name="theme-color"`);
  },
};

const injectCsp = {
  name: 'inject-csp',
  apply: 'build' as const,
  transformIndexHtml(html: string) {
    return html.replace(
      '<meta name="theme-color"',
      `<meta http-equiv="Content-Security-Policy" content="${CSP_META}" />
    <meta name="theme-color"`,
    );
  },
};

export default defineConfig(() => {
  return {
    base,
    // The map renderer’s worker is an ES module. Vite’s default worker format is iife,
    // which would strip the imports it needs.
    worker: { format: 'es' as const },
    plugins: [
      injectCsp,
      injectSeoTags,
      emitSeoFiles,
      emitSpaFallback,
      emitCompressedAssets,
      react(),
      tailwindcss(),
      // Everything the app computes — timetables, arrivals, route planning — runs from
      // bundled data, so once the shell is cached it works with no connection at all.
      // That is the normal case at a bus stop: signal is worst exactly where you need
      // the departure time.
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Urbanos de Lugo',
          short_name: 'Bus Lugo',
          description: 'Liñas, paradas e tempos de paso do bus urbano de Lugo',
          lang: 'gl',
          theme_color: '#d81f26',
          // Dark is the default theme, so the splash has to be dark too -- this was
          // still the light surface and flashed white on every cold start.
          background_color: '#0d0e11',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            // PNG for the install prompt, SVG for everything that scales.
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
            { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        workbox: {
          // The geometry chunk is ~490 KB; the default 2 MB cap would drop it silently.
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [/\/api\//],
          runtimeCaching: [
            {
              // The typeface.
              //
              // Atkinson Hyperlegible is loaded from Google's CDN and was the one asset
              // with no caching rule, so a second visit with no signal fell back to the
              // system sans — losing the face chosen for legibility exactly where it
              // matters, at a shelter with no coverage. The stylesheet and the font
              // files live on different hosts, so both are covered.
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts',
                expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Map data: show what was seen before rather than grey squares offline.
              // Covers the vector tiles, the glyphs and the sprites, which all come from
              // the one host, and the raster fallback for a device with no WebGL2.
              urlPattern: /^https:\/\/(tiles\.openfreemap\.org|tile\.openstreetmap\.org)\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'map-tiles',
                expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Service alerts are the only genuinely live data; prefer the network but
              // fall back to the last answer instead of an error.
              urlPattern: /\/api\/alerts/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'service-alerts',
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 6 },
              },
            },
          ],
        },
      }),
    ],
  };
});
