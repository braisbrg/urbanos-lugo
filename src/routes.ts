import type { Tab } from './components/navSections';

/**
 * One slug per tab, and the only list of them.
 *
 * Three things need these words: the router reads them out of the address bar, sitemap.xml
 * advertises them, and the build writes a page at each one so it answers 200 rather than
 * 404. They were three separate lists, which is the same drift that had already cost the
 * fares screen its heading when one screen became two.
 *
 * It lives here, and not beside the router or the `Tab` type, because the build reads it
 * too: `vite.config.ts` runs in Node, where `import.meta.env` does not exist and pulling
 * in the icon library to reach a string would be absurd. Nothing in this file runs -- the
 * only import is a type, which the compiler erases.
 *
 * Galician, because that is the language the app is written in.
 */
export const PATHS: Record<Tab, string> = {
  stops: 'paradas',
  lines: 'linhas',
  map: 'mapa',
  plan: 'ruta',
  info: 'avisos',
  fares: 'tarifas',
};
