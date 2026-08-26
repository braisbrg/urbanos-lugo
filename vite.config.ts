import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { CSP_META } from './src/security/csp';
import { robotsTxt, siteUrl, sitemapXml, structuredData } from './src/seo';

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
    plugins: [
      injectCsp,
      injectSeoTags,
      emitSeoFiles,
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
          theme_color: '#1e3a8a',
          background_color: '#f1f5f9',
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
              // Map tiles: show what was seen before rather than grey squares offline.
              urlPattern: /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/.*/i,
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
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
