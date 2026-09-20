/** The tabs the shell can show. `info` and `fares` are reached from the menu, not the bar. */
export type Tab = 'stops' | 'lines' | 'map' | 'plan' | 'info' | 'fares';

/**
 * One slug per tab, and the only list of them: the router reads them out of the address
 * bar, sitemap.xml advertises them, and the build writes a page at each one. No other
 * import, because vite.config.ts reads this in Node. Galician, like the app.
 */
export const PATHS: Record<Tab, string> = {
  stops: 'paradas',
  lines: 'linhas',
  map: 'mapa',
  plan: 'ruta',
  info: 'avisos',
  fares: 'tarifas',
};
