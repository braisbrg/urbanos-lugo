import type L from 'leaflet';

/**
 * The map's colours, for both palettes. Leaflet resolves a colour once, when a layer is
 * created, so `var(--c-ink)` would freeze to whatever it meant at that moment; the map
 * has to choose in JavaScript, and the two versions of a colour sit on adjacent lines.
 *
 * The greys are the app's neutrals and the blues its official blue. The accent red stays
 * off the map: several route lines are red and a red marker would vanish on its own line.
 * Stop discs are 8.4:1 over their ground — crisp, but no longer shouting over the route,
 * which at 1.9–3.9:1 is the shape the map is for.
 */
export interface MapColors {
  stopFill: string;
  stopStroke: string;
  stopSelected: string;
  /** The names written beside the dots from zoom 16: the app's ink, haloed in its ground. */
  nameInk: string;
  nameHalo: string;
  userFill: string;
  userStroke: string;
  /** Walking legs of a planned trip: the routed path, and the straight-line stand-in. */
  walkRouted: string;
  walkStraight: string;
  originPin: string;
  destinationPin: string;
}

const LIGHT: MapColors = {
  stopFill: '#4d4541',
  stopStroke: '#ffffff',
  stopSelected: '#0c72cb',
  nameInk: '#1e1917',
  nameHalo: '#fefdfd',
  userFill: '#08569a',
  userStroke: '#ffffff',
  walkRouted: '#534b48',
  walkStraight: '#817875',
  originPin: '#014e8e',
  destinationPin: '#047857',
};

const DARK: MapColors = {
  stopFill: '#b9b3af',
  stopStroke: '#191514',
  stopSelected: '#57a8ff',
  nameInk: '#eeeae9',
  nameHalo: '#110d0d',
  userFill: '#82bcfc',
  userStroke: '#191514',
  walkRouted: '#d0c9c7',
  walkStraight: '#9e9694',
  originPin: '#3c95f0',
  destinationPin: '#34d399',
};

export const mapColors = (isDark: boolean): MapColors => (isDark ? DARK : LIGHT);

/** The Leaflet options for a stop dot, the same pair on every map so a stop looks like a stop wherever it is drawn. */
export const stopDotStyle = (colors: MapColors, radius: number, selected = false): L.CircleMarkerOptions => ({
  radius: selected ? 9 : radius,
  color: colors.stopStroke,
  weight: selected ? 3 : 2,
  fillColor: selected ? colors.stopSelected : colors.stopFill,
  fillOpacity: 1,
});

/** The reader's own position. */
export const userDotStyle = (colors: MapColors): L.CircleMarkerOptions => ({
  radius: 8,
  fillColor: colors.userFill,
  color: colors.userStroke,
  weight: 3,
  opacity: 1,
  fillOpacity: 0.95,
});
