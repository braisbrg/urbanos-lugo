import L from 'leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-leaflet';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { StyleSpecification } from 'maplibre-gl';
import darkStyle from '../../data/map-style-dark.json';
import lightStyle from '../../data/map-style-light.json';

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
  light: lightStyle as unknown as StyleSpecification,
  dark: darkStyle as unknown as StyleSpecification,
};

// The colours are ours; the tiles, glyphs and sprites the style names are still served by
// OpenFreeMap, which is what keeps the policy in src/security/csp.ts down to one extra
// origin. See tools/buildMapStyle.ts for what was changed and why, and for why these are
// files here rather than adjustments applied at runtime to a style fetched from them.

/**
 * Three parties are owed a credit here, and on a phone they have one line to share.
 *
 * "OpenStreetMap contributors" spelled out made the line 347 px wide on a 375 px phone,
 * which fits and then wraps to two lines on anything narrower — a 320 px screen broke it
 * again, and the second line lands under the tab bar where nobody reads it.
 *
 * The OSMF attribution guidelines settle it: "The historical forms of attribution
 * '© OpenStreetMap contributors' or '© OSM' are acceptable." So OSM is abbreviated and
 * keeps its link to the copyright page, which is where the licence itself lives; the
 * other two names stay whole, because their terms ask for those names and neither is
 * what made the line too long.
 */
const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org/">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';

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

  // Tell the renderer when its container changed size.
  //
  // Nobody else does. The app already calls Leaflet's invalidateSize from a ResizeObserver,
  // because these containers are routinely 0 px tall on first paint, and the glue layer
  // does resize the div it draws into — but neither calls resize() on the renderer, so it
  // keeps painting at whatever size it was born at. Opening the Mapa tab gave a small
  // rectangle of map adrift in Leaflet's grey. It looked self-healing if the window was
  // resized, because that is the one event the renderer listens for on its own.
  //
  // Watching the container rather than Leaflet's resize event, because the glue defers its
  // own work to the next animation frame: a handler on the event runs first and measures
  // the size the container is about to stop having. A ResizeObserver fires after layout,
  // whenever the box actually changed, whoever changed it and whenever they got round to
  // it — which is the thing that has to be true, rather than a guess about ordering.
  const baseOnAdd = layer.onAdd.bind(layer);
  const baseOnRemove = layer.onRemove.bind(layer);
  let observer: ResizeObserver | null = null;
  let onVisible: (() => void) | null = null;
  let attached: L.Map | null = null;

  /**
   * Put the renderer back in step with Leaflet.
   *
   * Two separate things go wrong and both are fixed here. The renderer keeps painting at
   * whatever size it was born at, so it needs telling; and once resized it is still
   * looking wherever it was looking, so the basemap sits offset under the stops drawn on
   * top of it. The glue re-aligns the two on any Leaflet movement, so announce one — on
   * the next frame, because the glue defers its own handling by a frame and a movement
   * announced before that lands is computed against the size the container is about to
   * stop having.
   */
  const resync = () => {
    const gl = layer.getMaplibreMap();
    if (!gl) return;
    // The map stays mounted between tab visits, so its container spends time at 0x0
    // behind display:none. Resizing to nothing and back is work with a visible cost and
    // no benefit: wait until there is something to draw into.
    const box = layer.getContainer();
    if (box && (box.clientWidth === 0 || box.clientHeight === 0)) return;
    gl.resize();
    /*
     * Announced twice, on purpose, and this is the whole of a bug that looked like the
     * tiles failing to load.
     *
     * requestAnimationFrame does not run while a page is not being painted — a
     * backgrounded tab, an occluded window, a phone with the screen locked. So resize()
     * ran and the move that re-aligns and repaints never did, leaving a map that had
     * every byte it needed and had drawn none of it: the routes and stops were there on
     * Leaflet's own canvas and the streets underneath were missing. Measured — six
     * requests to OpenFreeMap before, six after, and a single resize event painted the
     * whole basemap without fetching anything.
     *
     * The timeout is the half that survives a page nobody is looking at. Firing move
     * twice costs a re-align Leaflet does constantly anyway.
     */
    requestAnimationFrame(() => attached?.fire('move'));
    setTimeout(() => attached?.fire('move'), 0);
  };

  layer.onAdd = (map: L.Map) => {
    const added = baseOnAdd(map);
    attached = map;

    /**
     * Drop Leaflet's own "Leaflet" prefix, on every map that uses this basemap.
     *
     * Nobody is owed it: the terms that bind this map are OpenFreeMap's, OpenMapTiles'
     * and OpenStreetMap's, and all three stay exactly as they are. The prefix is what
     * made the line too long -- measured on a 375 px screen it wrapped to two lines,
     * 34 px tall, and the second line was cut off by whatever sat below the map. An
     * attribution that is covered is not a visible attribution, so the shortest honest
     * line is also the compliant one.
     *
     * It lived in TransitMap, which is why the route map and the stop mini map still
     * printed "Leaflet |" while the big map did not. It belongs here, in the one place
     * all three of them go through, so a fourth map cannot be born with the old line.
     */
    map.attributionControl?.setPrefix(false);

    /**
     * Fit to the box, not to the nearest whole zoom level.
     *
     * `fitBounds` picks the largest whole zoom whose scale still contains what it was
     * given, so it lands anywhere between half the map and all of it. Measured on a
     * 375x812 phone, where the route map is 297x240: the default Fonte dos Ranchos ->
     * HULA trip was drawn 120x110 inside 241x184 of usable box -- 46% -- and the reader
     * got a patch of street map with a squiggle in the middle of it. Tapping a different
     * option jumped it to 67% for no reason visible from the outside, because those
     * bounds happened to round better. Fractional: 76%, and it stays there.
     *
     * Here rather than in the three maps for the reason above it: the justification is a
     * property of this basemap. It is vector, so it draws at any zoom and there is
     * nothing to buy by rounding. A raster basemap would want its whole levels back.
     */
    map.options.zoomSnap = 0;

    // The first paint is its own case. The layer is built inside a container that is still
    // settling, and the renderer works out what to draw before the style has arrived, so
    // it lands on an empty view and has no reason to revisit it: the Mapa tab opened to a
    // dark rectangle that came right the moment anything was touched. Once is enough —
    // after this the observer below covers every later change.
    layer.getMaplibreMap()?.once('load', resync);

    /*
     * Watch Leaflet's own container, not the renderer's.
     *
     * This observed layer.getContainer() — the canvas wrapper the glue owns — and traced
     * it: two callbacks, both reporting 0x0, both bailing on the zero-size guard, and
     * never a third. The element is absolutely positioned inside a pane, so it does not
     * report a size change the observer can see; the net that exists to catch a map that
     * has not painted was itself never firing after the first frame.
     *
     * The map's own container is the div this app renders and sizes, so it is the box
     * that actually changes when the tab opens, the banner appears or the phone rotates.
     */
    const container = map.getContainer();
    if (container && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resync);
      observer.observe(container);
    }

    /*
     * Coming back to a page that was left open.
     *
     * A phone locked for a while and unlocked again is the case this is for: nothing
     * resized, so the observer above has nothing to say, and the page may be restored
     * straight out of the back/forward cache, where not a single frame was ever rendered
     * in between. Both events are cheap and resync does nothing when the container has no
     * size, so asking twice costs nothing and covers the browsers that only send one.
     */
    onVisible = () => {
      if (document.visibilityState === 'visible') resync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return added;
  };

  layer.onRemove = (map: L.Map) => {
    observer?.disconnect();
    observer = null;
    if (onVisible) {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      onVisible = null;
    }
    attached = null;
    return baseOnRemove(map);
  };

  layer.setBasemapTheme = (dark: boolean) => {
    // Restyling in place rather than rebuilding the layer, so the view stays where the
    // reader left it instead of snapping back to Lugo centre.
    layer.getMaplibreMap()?.setStyle(dark ? STYLES.dark : STYLES.light);
  };

  return layer;
}
