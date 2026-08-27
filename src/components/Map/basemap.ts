import L from 'leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-leaflet';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

// The renderer works out where its worker lives at runtime -- new URL() against its own
// module URL -- which no bundler can see, so the file is never emitted, the request falls
// through to the single-page fallback, and the map draws nothing while the console blames
// the MIME type. Naming the file as a worker entry makes Vite bundle and emit it here.
//
// It has to be the vendor file itself and not a wrapper importing it: a bare side-effect
// import gets tree-shaken and the emitted worker comes out empty, which fails later and
// more quietly. Same origin is also what lets the policy keep worker-src at self -- given
// a cross-origin URL the renderer wraps the worker in a blob instead.
setWorkerUrl(maplibreWorkerUrl);

/**
 * The map underneath everything else.
 *
 * This used to be CARTO's raster basemaps, Voyager and Dark Matter, and it was chosen for
 * the pair rather than for CARTO: at eleven at night the map had been a white rectangle in
 * a dark app. In August 2026 CARTO began stamping "API KEY REQUIRED" diagonally across
 * every unauthenticated tile — baked into the PNG, so nothing on this side could fix it —
 * and said the raster basemaps are being retired. A free key exists, but it cannot be
 * restricted to a domain, and this repository is public: the key would be scraped the week
 * it shipped.
 *
 * OpenFreeMap serves Positron Bright and Dark, which are the same Positron design lineage
 * the old pair came from, with no key, no account and no stated request limit. Its terms
 * ask only that the attribution stay visible. It is one person's project running on
 * donations with no SLA, which is the honest trade for owing nobody an account.
 *
 * Vector rather than raster, so the phone draws the map from coordinates instead of
 * downloading pictures of it: sharp at any zoom and any pixel density, and the style
 * becomes ours to change. The price is a renderer in the bundle and a WebGL2 requirement,
 * which is why the fallback below exists.
 */

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

// Tiles, glyphs and sprites all come from that one host, which is what keeps the policy
// in src/security/csp.ts down to a single extra origin.

const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org/">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * The fallback, for a device with no WebGL2.
 *
 * Roughly anything older than 2017. A bus app that shows no map at all on an old phone
 * fails the people most likely to be waiting at the shelter, so it drops back to raster.
 * OpenStreetMap's own tiles are the only unkeyed raster service whose terms plainly allow
 * this; they have no dark style, so the fallback is light in both themes. That is a worse
 * map, not a broken one, and it is what the alternative is being compared against.
 *
 * Their policy forbids bulk downloading and prefetching, which this app does not do: tiles
 * are fetched as the reader pans, and cached, which the policy asks for.
 */
const OSM_FALLBACK_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Whether this browser can run the vector renderer.
 *
 * Asked once and remembered: creating a probe context per map would leak contexts, and
 * browsers cap how many exist at a time.
 */
let webgl2: boolean | null = null;
function hasWebGL2(): boolean {
  if (webgl2 !== null) return webgl2;
  try {
    webgl2 = !!document.createElement('canvas').getContext('webgl2');
  } catch {
    webgl2 = false;
  }
  return webgl2;
}

/** A Leaflet layer either way, so the callers do not have to know which one they got. */
export type BasemapLayer = L.Layer & { setBasemapTheme(isDark: boolean): void };

export function createBasemap(isDark: boolean): BasemapLayer {
  if (!hasWebGL2()) {
    const raster = L.tileLayer(OSM_FALLBACK_TILES, {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 19,
    }) as L.TileLayer & { setBasemapTheme(isDark: boolean): void };
    // There is only one style to fall back to, so the theme has nothing to switch.
    raster.setBasemapTheme = () => {};
    return raster;
  }

  const layer = L.maplibreGL({
    style: isDark ? STYLES.dark : STYLES.light,
    // The renderer ships its own attribution control, which would sit inside the canvas
    // and credit the same people a second time. Leaflet's control does it, as it always
    // has, through getAttribution below.
    attributionControl: false,
  }) as ReturnType<typeof L.maplibreGL> & { setBasemapTheme(isDark: boolean): void };

  layer.getAttribution = () => OPENFREEMAP_ATTRIBUTION;

  layer.setBasemapTheme = (dark: boolean) => {
    // Restyling in place rather than rebuilding the layer, so the view stays where the
    // reader left it instead of snapping back to Lugo centre.
    layer.getMaplibreMap()?.setStyle(dark ? STYLES.dark : STYLES.light);
  };

  return layer;
}
