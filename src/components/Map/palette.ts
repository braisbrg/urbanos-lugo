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
 * The greys are the app's own neutrals and the blues are the app's official blue, so
 * the map belongs to the same palette as everything around it. The accent red is the
 * one system colour that stays off the map: route lines carry each line's own colour
 * and several of those are red, so a red marker would vanish on the very route it
 * marks. Green stays on the B pin, where arrival is the whole meaning.
 *
 * The pairs are chosen against their own basemap, not against each other — a stop dot
 * that reads on the light basemap is invisible on the dark one and the other way round.
 * Which basemap that is lives in basemap.ts; this file only says what to draw on top.
 */
export interface MapColors {
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
  stopFill: '#27201d',      // the ink, warmed to match the app
  stopStroke: '#ffffff',
  stopSelected: '#0c72cb',  // the official blue, lifted to carry on Voyager
  userFill: '#08569a',      // the same blue, darker: this one is you
  userStroke: '#ffffff',
  walkRouted: '#534b48',
  walkStraight: '#817875',
  originPin: '#014e8e',     // the official blue exactly; white A on it, 8.5:1
  destinationPin: '#047857',
};

const DARK: MapColors = {
  stopFill: '#e2dddb',
  stopStroke: '#191514',
  stopSelected: '#57a8ff',  // the dark theme's official blue
  userFill: '#82bcfc',      // lighter than the selection, so the two separate
  userStroke: '#191514',
  walkRouted: '#d0c9c7',
  walkStraight: '#9e9694',
  originPin: '#3c95f0',     // dark ink on it, so it stays a shade deeper
  destinationPin: '#34d399',
};

export function mapColors(isDark: boolean): MapColors {
  return isDark ? DARK : LIGHT;
}

