import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { CSP_META } from './src/security/csp';
import { THEME_INIT_SOURCE } from './src/security/themeInit';
import { SITE_PATHS, pageHtml, robotsTxt, siteUrl, sitemapXml, structuredData } from './src/seo';

// GitHub Pages project sites live under /<repo>/, so every asset URL needs that prefix.
// Set BASE_PATH in the workflow; locally and on a root domain it stays '/'.
const base = process.env.BASE_PATH || '/';

// Where this build will live, set by the workflow. A canonical or a sitemap carrying the
// wrong origin points crawlers at pages that do not exist, so without it they are omitted.
const site = siteUrl(process.env.SITE_URL);

const outDir = 'dist';

/** Every build-time head edit goes in front of the theme-color meta. */
const beforeThemeColor = (html: string, tags: string) => html.replace('<meta name="theme-color"', `${tags}\n    <meta name="theme-color"`);

/**
 * A .gz and a .br beside every asset worth compressing. GitHub Pages compresses by
 * itself; `npm start` serves dist/ through express.static, which does not, and a build
 * can afford brotli's slowest setting where a server answering a phone should not.
 */
const emitCompressedAssets: Plugin = {
  name: 'emit-compressed-assets',
  apply: 'build',
  closeBundle() {
    const FLOOR = 1024; // below about a kilobyte the headers cost more than the saving
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
      const br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } });
      writeFileSync(file + '.gz', gzipSync(body, { level: 9 }));
      writeFileSync(file + '.br', br);
      saved += body.length - br.length;
    }
    console.log(`  compressed assets: ${(saved / 1024).toFixed(0)} KB saved if the client takes brotli`);
  },
};

/**
 * A real page at every tab's address, and 404.html behind them. Pages serves 404.html for
 * any path it does not have, which renders the app but with a 404 status: crawlers drop a
 * listed URL that answers 404, and the apps a stop link is pasted into skip the preview.
 * One copy per tab, each with its own title and canonical (seven identical heads read as
 * one page listed seven times), and 404.html still catches a mistyped path. Runs before
 * emit-compressed-assets on purpose, so the copies get their .br and .gz too.
 */
const emitSpaFallback: Plugin = {
  name: 'emit-spa-fallback',
  apply: 'build',
  closeBundle() {
    const built = path.resolve(outDir, 'index.html');
    if (!existsSync(built)) return;
    copyFileSync(built, path.resolve(outDir, '404.html'));
    const html = readFileSync(built, 'utf8');
    for (const route of SITE_PATHS) {
      if (!route) continue; // the root is index.html itself
      const dir = path.resolve(outDir, route);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'index.html'), pageHtml(html, route, site));
    }
  },
};

/** robots.txt and sitemap.xml, written beside the built page. */
const emitSeoFiles: Plugin = {
  name: 'emit-seo-files',
  apply: 'build',
  generateBundle() {
    if (!site) return;
    this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(site) });
    this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(site) });
  },
};

/**
 * The canonical link, the preview image and the structured data, which all need the real
 * address. The image is absolute because the apps that unfurl a pasted link do not
 * resolve a relative one.
 */
const injectSeoTags: Plugin = {
  name: 'inject-seo-tags',
  apply: 'build',
  transformIndexHtml(html) {
    if (!site) return html;
    return beforeThemeColor(
      html,
      [
        `<link rel="canonical" href="${site}" />`,
        `<meta property="og:image" content="${site}icon-512.png" />`,
        `<meta property="og:image:width" content="512" />`,
        `<meta property="og:image:height" content="512" />`,
        `<script type="application/ld+json">${structuredData(site)}</script>`,
      ].join('\n    '),
    );
  },
};

/** Which commit the page is, when a workflow built it: the same answer the worker gives at /api/version. */
const stampBuild: Plugin = {
  name: 'stamp-build',
  apply: 'build',
  transformIndexHtml(html) {
    const sha = process.env.GITHUB_SHA;
    return sha ? beforeThemeColor(html, `<meta name="build" content="${sha.slice(0, 7)}" />`) : html;
  },
};

/**
 * The theme script inlined: it has to run before the first paint, and as a file it cost
 * a round trip on the critical path. `script-src` carries the SHA-256 of these exact
 * bytes, computed by security/csp.ts from the same export, so the page and the policy
 * cannot disagree. No `apply`, so it runs in dev too: there is no file left to serve.
 */
const inlineThemeInit: Plugin = {
  name: 'inline-theme-init',
  transformIndexHtml(html) {
    const tag = /<script src="[^"]*theme-init\.js"><\/script>/;
    if (!tag.test(html)) throw new Error('the theme-init tag is gone; inline-theme-init has nothing to replace');
    return html.replace(tag, `<script>${THEME_INIT_SOURCE}</script>`);
  },
};

/** The policy goes into the built page only: in the source page it also applied to `vite dev`, where it blocked the HMR websocket. */
const injectCsp: Plugin = {
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return beforeThemeColor(html, `<meta http-equiv="Content-Security-Policy" content="${CSP_META}" />`);
  },
};

export default defineConfig({
  base,
  // The map renderer's worker is an ES module; Vite's default iife would strip its imports.
  worker: { format: 'es' },
  plugins: [
    inlineThemeInit,
    injectCsp,
    injectSeoTags,
    stampBuild,
    emitSeoFiles,
    emitSpaFallback,
    emitCompressedAssets,
    react(),
    tailwindcss(),
    // Everything the app computes runs from bundled data, so once the shell is cached it
    // works with no connection at all, which is the normal case at a bus stop.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Urbanos de Lugo',
        // The home-screen label: twelve characters is the most a launcher shows whole.
        short_name: 'Urbanos Lugo',
        description: 'Non oficial. Liñas, paradas e tempos de paso do autobús urbano de Lugo',
        lang: 'gl',
        theme_color: '#d81f26',
        // Dark is the default theme, so the splash has to be dark too.
        background_color: '#0d0e11',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          // 192 for the launcher, 512 for the splash Android draws while the app starts.
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // A launcher crops the maskable icon to its own shape and only the middle 80%
          // survives, so this is the mark scaled into the safe zone on full-bleed red.
          // A PNG: SVG here is not handled dependably by Android.
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // The geometry chunk is ~490 KB; the default 2 MB cap would drop it silently.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // The typeface is served from this origin, so it is precached with everything else.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/\/api\//],
        runtimeCaching: [
          {
            // Map data: show what was seen before rather than grey squares offline. The
            // vector tiles, glyphs and sprites come from the one host; the raster is the
            // fallback for a device with no WebGL2.
            urlPattern: /^https:\/\/(tiles\.openfreemap\.org|tile\.openstreetmap\.org)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Service alerts are the only genuinely live data: prefer the network, fall
            // back to the last answer instead of an error.
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
});
