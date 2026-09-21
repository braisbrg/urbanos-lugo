import L from 'leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@maplibre/maplibre-gl-leaflet';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { StyleSpecification } from 'maplibre-gl';
import darkStyle from '../../data/map-style-dark.json';
import lightStyle from '../../data/map-style-light.json';

// The renderer works out where its worker lives at runtime, which no bundler can see, so
// the file is never emitted and the map draws nothing. Naming the vendor file itself as a
// worker entry makes Vite emit it same-origin, which is what keeps worker-src at 'self'.
setWorkerUrl(maplibreWorkerUrl);

/**
 * The map underneath everything else: OpenFreeMap's vector tiles, drawn with a style of
 * our own (tools/buildMapStyle.ts) so the phone draws the map from coordinates — sharp at
 * any zoom, and dark at eleven at night. No key, no account; the terms ask only that the
 * attribution stay visible. The price is a WebGL2 requirement, hence the fallback below.
 */
const STYLES = { light: lightStyle as unknown as StyleSpecification, dark: darkStyle as unknown as StyleSpecification };

/** Three parties on one phone-width line: OSM abbreviated as the OSMF guidelines allow, the other two whole as their terms ask. */
const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';

/** For a device with no WebGL2 (roughly pre-2017): OSM's own raster tiles, the only unkeyed service whose terms plainly allow it. Light in both themes. */
const OSM_FALLBACK_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * How long a lost WebGL context is given to come back. "WebGL context lost" was seen in
 * a production console; forced (WEBGL_lose_context), the basemap goes blank with no word
 * to the reader while the routes and stops, on Leaflet's own canvas, stay. The renderer
 * handles the loss and the return itself; what it does not do is notice that the return
 * never came. A browser that restores a context does so within a second or two, so five
 * is past that and still a hiccup rather than a screen. Counted only while the page is
 * visible: a phone that hands the context back on return must not come back to a worse map.
 */
const CONTEXT_GRACE_MS = 5_000;

/** Asked once: a probe context per map would leak contexts, and browsers cap how many exist. */
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
    const raster = L.tileLayer(OSM_FALLBACK_TILES, { attribution: OSM_ATTRIBUTION, maxZoom: 19 }) as L.TileLayer & { setBasemapTheme(isDark: boolean): void };
    raster.setBasemapTheme = () => {}; // one style to fall back to, nothing to switch
    // The "Leaflet" prefix goes on this path too, or a map born raster prints the two-line credit.
    const baseOnAdd = raster.onAdd.bind(raster);
    raster.onAdd = (map: L.Map) => {
      map.attributionControl?.setPrefix(false);
      return baseOnAdd(map);
    };
    return raster;
  }

  // The renderer's own attribution control would credit the same people a second time; Leaflet's does it.
  const layer = L.maplibreGL({ style: isDark ? STYLES.dark : STYLES.light, attributionControl: false }) as ReturnType<typeof L.maplibreGL> & {
    setBasemapTheme(isDark: boolean): void;
  };
  layer.getAttribution = () => OPENFREEMAP_ATTRIBUTION;

  const baseOnAdd = layer.onAdd.bind(layer);
  const baseOnRemove = layer.onRemove.bind(layer);
  let observer: ResizeObserver | null = null;
  let onVisible: (() => void) | null = null;
  let attached: L.Map | null = null;
  /** The theme the renderer was given: a second setStyle while the first is loading rebuilds the whole style. */
  let shown = isDark;

  /**
   * A context that was lost and not given back: swap this layer for the raster fallback
   * on the same map, and remember it for the session, because a device whose context went
   * away once is not a device to keep asking. The callers keep their handle to this layer,
   * and setBasemapTheme on a removed layer has no renderer to restyle, so they need not know.
   */
  let lost = false;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const armGrace = () => {
    clearTimeout(grace);
    grace = setTimeout(() => {
      // Hidden: onVisible arms it again, once there is a reader to give up in front of.
      if (!lost || !attached || document.visibilityState !== 'visible') return;
      const map = attached;
      webgl2 = false;
      map.removeLayer(layer);
      map.options.zoomSnap = 1; // raster tiles at a fractional zoom are scaled, and blurry
      createBasemap(shown).addTo(map);
    }, CONTEXT_GRACE_MS);
  };

  /**
   * Put the renderer back in step with Leaflet. Nobody else tells it the container
   * changed size, so it kept painting at whatever size it was born at; and once resized it
   * needs a move to re-align. Announced twice: requestAnimationFrame does not run on a page
   * that is not being painted (a locked phone), and the timeout is the half that survives.
   */
  const resync = () => {
    const gl = layer.getMaplibreMap();
    if (!gl) return;
    // The map stays mounted between tab visits, at 0x0 behind display:none: wait for a box to draw into.
    const box = layer.getContainer();
    if (box && (box.clientWidth === 0 || box.clientHeight === 0)) return;
    gl.resize();
    requestAnimationFrame(() => attached?.fire('move'));
    setTimeout(() => attached?.fire('move'), 0);
  };

  layer.onAdd = (map: L.Map) => {
    const added = baseOnAdd(map);
    attached = map;
    // Nobody is owed the "Leaflet" prefix, and with it the credit wrapped to two lines on a phone.
    map.attributionControl?.setPrefix(false);
    // Fit to the box, not to the nearest whole zoom: vector draws at any zoom, and whole
    // levels left the default trip at 46% of its box.
    map.options.zoomSnap = 0;
    // The first paint lands on an empty view before the style has arrived; once is enough.
    const gl = layer.getMaplibreMap();
    gl?.once('load', resync);
    gl?.on('webglcontextlost', () => {
      lost = true;
      if (document.visibilityState === 'visible') armGrace();
    });
    gl?.on('webglcontextrestored', () => {
      lost = false;
      clearTimeout(grace);
    });
    // Leaflet's own container, not the renderer's: the canvas wrapper is absolutely
    // positioned inside a pane and never reports a size change.
    const container = map.getContainer();
    if (container && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resync);
      observer.observe(container);
    }
    // A phone unlocked again, or a page restored from the back/forward cache: nothing resized.
    onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      resync();
      if (lost) armGrace();
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
    clearTimeout(grace);
    attached = null;
    return baseOnRemove(map);
  };

  layer.setBasemapTheme = (dark: boolean) => {
    if (dark === shown) return;
    shown = dark;
    // Restyled in place, so the view stays where the reader left it.
    layer.getMaplibreMap()?.setStyle(dark ? STYLES.dark : STYLES.light);
  };

  return layer;
}
