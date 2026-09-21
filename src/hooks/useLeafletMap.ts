import { useEffect, useRef, useState, type RefObject } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createBasemap, type BasemapLayer } from '../components/Map/basemap';
import { useIsDark } from './useIsDark';
import { useT } from '../i18n';

interface MapOptions {
  center: [number, number];
  zoom: number;
  /** A small map inside a scrolling page should scroll the page, not zoom the city. */
  scrollWheelZoom?: boolean;
  /** What this map is, for a reader who will never see it. */
  region: string;
  /** Runs after Leaflet has been told about a resize. */
  onResize?: (map: L.Map) => void;
}

/**
 * One Leaflet map on a container: the basemap, the zoom control, the theme switch, the
 * resize observer and the accessible chrome — the same forty lines the three maps used
 * to carry each. Returns the map once it exists, so layers can mount.
 */
export function useLeafletMap(containerRef: RefObject<HTMLDivElement | null>, { center, zoom, scrollWheelZoom = true, region, onResize }: MapOptions): L.Map | null {
  const [map, setMap] = useState<L.Map | null>(null);
  const tilesRef = useRef<BasemapLayer | null>(null);
  const isDark = useIsDark();
  const t = useT();
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const instance = L.map(el, {
      center,
      zoom,
      zoomControl: false,
      scrollWheelZoom,
      // Stops and routes are vector layers; one canvas beats hundreds of DOM nodes.
      preferCanvas: true,
      // The basemap layer has no maxZoom to give; without this the map zooms past any data.
      maxZoom: 19,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    tilesRef.current = createBasemap(isDark).addTo(instance) as BasemapLayer;
    setMap(instance);

    // The container is often 0 px tall on first paint (tab switch, flex layout).
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            instance.invalidateSize();
            onResizeRef.current?.(instance);
          })
        : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      instance.remove();
      setMap(null);
    };
    // Built once: a later centre moves the view rather than rebuilding the map.
  }, []);

  // The layer restyles in place, so the view stays where the reader left it.
  useEffect(() => {
    tilesRef.current?.setBasemapTheme(isDark);
  }, [isDark]);

  // Leaflet gives its container no accessible name and writes its control titles in
  // English once; both are set from an effect so a language switch relabels a live map.
  useEffect(() => {
    const el = map && containerRef.current;
    if (!el) return;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', region);
    for (const [selector, text] of [
      ['.leaflet-control-zoom-in', t.map.zoomIn],
      ['.leaflet-control-zoom-out', t.map.zoomOut],
    ]) {
      const node = el.querySelector(selector);
      node?.setAttribute('title', text);
      node?.setAttribute('aria-label', text);
    }
  }, [map, containerRef, region, t]);

  return map;
}

/** The map's zoom, read at the end of each gesture: fractional, since the basemap lets the map settle at any zoom. */
export function useMapZoom(map: L.Map | null): number {
  const [zoom, setZoom] = useState(() => map?.getZoom() ?? 14);
  useEffect(() => {
    if (!map) return;
    const sync = () => setZoom(map.getZoom());
    sync();
    map.on('zoomend', sync);
    return () => {
      map.off('zoomend', sync);
    };
  }, [map]);
  return zoom;
}
