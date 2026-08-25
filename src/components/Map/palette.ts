/**
 * The map's colours, in one place, for both palettes.
 *
 * Everywhere else in the app a colour is a CSS custom property and the theme switch is
 * free. Leaflet resolves a colour once, when the layer is created, so `var(--c-ink)`
 * there freezes to whatever it meant at that moment and a later theme switch leaves the
 * map painted for the wrong one. That is why these are literals and why they live here:
 * the map has to choose in JavaScript, and the two versions of a colour should sit on
 * adjacent lines where anyone can compare them.
 *
 * The pairs are chosen against their own basemap, not against each other — a stop dot
 * that reads on CARTO Voyager is invisible on CARTO Dark Matter and the other way round.
 */
export interface MapColors {
  tiles: string;
  /** Stop circles: a dot with a ring, so both have to flip together. */
  stopFill: string;
  stopStroke: string;
  stopSelected: string;
  /** Where the reader is, when they allow it. */
  userFill: string;
  userStroke: string;
  /** Walking legs of a planned trip: the routed path, and the straight-line stand-in. */
  walkRouted: string;
  walkStraight: string;
  /** The A and B pins on a planned trip. */
  originPin: string;
  destinationPin: string;
}

const LIGHT: MapColors = {
  tiles: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  stopFill: '#0f172a',
  stopStroke: '#ffffff',
  stopSelected: '#2563eb',
  userFill: '#1e40af',
  userStroke: '#ffffff',
  walkRouted: '#334155',
  walkStraight: '#64748b',
  originPin: '#1e3a8a',
  destinationPin: '#047857',
};

const DARK: MapColors = {
  tiles: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  stopFill: '#e2e8f0',
  stopStroke: '#0f172a',
  stopSelected: '#60a5fa',
  userFill: '#60a5fa',
  userStroke: '#0f172a',
  walkRouted: '#cbd5e1',
  walkStraight: '#94a3b8',
  originPin: '#60a5fa',
  destinationPin: '#34d399',
};

export function mapColors(isDark: boolean): MapColors {
  return isDark ? DARK : LIGHT;
}

/** Both basemaps are CARTO over OpenStreetMap, so the credit does not change. */
export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';
