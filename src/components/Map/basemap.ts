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

/**
 * Fewer labels where our own take over.
 *
 * From zoom 16 the map writes a name beside every stop — a dozen on a phone screen — and
 * the basemap is writing street names into the same space at the same time. Two sets of
 * text competing is how a map stops being readable, and only one of them answers the
 * question this screen is for.
 *
 * So the street names fade out exactly where the stop names arrive, rather than being
 * removed outright: below 15 they are the only thing telling you where you are, and there
 * are no stop labels yet to take over. Applies to both styles — this is about density,
 * not about the dark one being dark.
 */
const LABEL_TUNING: readonly [layer: string, property: string, value: unknown][] = [
  ['highway_name_other', 'text-opacity', ['interpolate', ['linear'], ['zoom'], 15, 1, 16.5, 0]],
  ['highway_name_motorway', 'text-opacity', ['interpolate', ['linear'], ['zoom'], 15, 1, 16.5, 0]],
];

/**
 * Give the dark map somewhere to be.
 *
 * As published it puts everything inside seventeen levels of black: the ground is
 * rgb(12,12,12), water is rgb(27,27,29) and buildings are rgb(10,10,10) — darker than the
 * ground they stand on. Nothing has a hierarchy, and the app's own background is #110d0d,
 * so the map does not even separate from the chrome around it. That flatness is what
 * reads as cheap; it is not the absence of detail, the detail is all there and all the
 * same colour.
 *
 * The order matters more than any single value: ground at the bottom, blocks a step up,
 * streets brightest of all. Raising only the ground inverts that — the published streets
 * are #181818, and against a #171a1f ground they stop being bright lines and become dark
 * ones. So everything above the ground moves with it.
 *
 * Contrast is set for a phone in daylight, not for a dark room. Dark mode here is a
 * preference, not a time of day: somebody reads this at a sunlit shelter at two in the
 * afternoon, and seventeen levels of near-black is unreadable long before the screen is.
 *
 * Water goes the other way, darker and actually blue, so the Miño reads as a river
 * instead of a slightly different rectangle.
 *
 * Buildings keep their mass and lose their linework. Every building outlined individually
 * is detail a bus app never uses — nobody is navigating by the shape of a block — and it
 * is drawn underneath the thing the screen is actually for. Matching the outline to the
 * fill leaves a soft mass that still says "built up here" without drawing each one.
 *
 * The light style is left alone. Positron's rgb(242,243,240) already separates from the
 * app's #fefdfd and its layers already differ from one another.
 *
 * Tried and rejected: swapping the whole style for `fiord`, OpenFreeMap's designed dark.
 * Its ground is #45516E, which rendered as a pale blue slab inside a near-black app —
 * the route line dissolved into it and the white stop dots disappeared.
 */
const DARK_TUNING: readonly [layer: string, property: string, value: string][] = [
  ['background', 'background-color', '#171a1f'],
  ['water', 'fill-color', '#0e151d'],
  ['building', 'fill-color', '#1c2027'],
  ['building', 'fill-outline-color', '#1c2027'],
  ['highway_minor', 'line-color', '#2b3038'],
  ['highway_major_inner', 'line-color', '#39404b'],
  ['highway_motorway_inner', 'line-color', '#39404b'],
];

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
  let attached: L.Map | null = null;
  /** Which of the two styles is loaded. Asked by the tuning below, which only fits one. */
  let darkStyle = isDark;

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
    requestAnimationFrame(() => attached?.fire('move'));
  };

  /**
   * Apply the tuning above, every time a style finishes loading.
   *
   * On `styledata` rather than `load`, because switching theme calls setStyle and the new
   * style arrives with the published colours again — a one-shot on first load would be
   * correct until the first time somebody changed theme.
   *
   * Each property is set on its own and forgiven on its own: these are layer ids in
   * somebody else's style, and a rename upstream should cost that one adjustment, not the
   * map.
   */
  const tuneStyle = () => {
    const gl = layer.getMaplibreMap();
    if (!gl?.getLayer) return;
    // Density first, and for both styles.
    for (const [id, property, value] of LABEL_TUNING) {
      try {
        if (gl.getLayer(id)) {
          (gl.setPaintProperty as (l: string, p: string, v: unknown) => void)(id, property, value);
        }
      } catch {
        /* upstream renamed or dropped it; the published labels stand. */
      }
    }
    if (!darkStyle) return;
    for (const [id, property, value] of DARK_TUNING) {
      try {
        // The renderer types the property name as a union of every paint property it
        // knows, keyed to the layer's type, which it cannot check for a name held in a
        // variable. The pairs in the table above are checked by eye against the published
        // style and by the map in front of you; this cast is the loop, not the values.
        if (gl.getLayer(id)) {
          (gl.setPaintProperty as (l: string, p: string, v: unknown) => void)(id, property, value);
        }
      } catch {
        /* upstream renamed or dropped it; the published colour stands. */
      }
    }
  };

  layer.onAdd = (map: L.Map) => {
    const added = baseOnAdd(map);
    attached = map;
    layer.getMaplibreMap()?.on('styledata', tuneStyle);

    // The first paint is its own case. The layer is built inside a container that is still
    // settling, and the renderer works out what to draw before the style has arrived, so
    // it lands on an empty view and has no reason to revisit it: the Mapa tab opened to a
    // dark rectangle that came right the moment anything was touched. Once is enough —
    // after this the observer below covers every later change.
    layer.getMaplibreMap()?.once('load', resync);

    const container = layer.getContainer();
    if (container && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resync);
      observer.observe(container);
    }
    return added;
  };

  layer.onRemove = (map: L.Map) => {
    observer?.disconnect();
    observer = null;
    attached = null;
    return baseOnRemove(map);
  };

  layer.setBasemapTheme = (dark: boolean) => {
    // Recorded before the style is asked for, so the styledata handler that fires when it
    // arrives already knows which of the two it is looking at.
    darkStyle = dark;
    // Restyling in place rather than rebuilding the layer, so the view stays where the
    // reader left it instead of snapping back to Lugo centre.
    layer.getMaplibreMap()?.setStyle(dark ? STYLES.dark : STYLES.light);
  };

  return layer;
}
