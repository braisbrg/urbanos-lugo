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
    const unhover = hoverableTooltips(instance);
    const unpan = panOnClick(instance);

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
      unhover();
      unpan();
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

/** How long a hover label waits for the pointer to cross from its marker onto it. */
export const HOVER_GRACE_MS = 300;

type TooltipOwner = L.Layer & { closeTooltip(): unknown; hoverable?: true };

/**
 * WCAG 1.4.13 for every label a map shows on hover: a stop's name, a line on a route, a walk.
 * Leaflet closes one the moment the pointer leaves its marker, so a reader who magnifies the
 * screen could never move onto it to read it, and it had no key to put it away. Here the
 * close waits HOVER_GRACE_MS, the label takes the pointer and holds itself open while it is
 * under it, and Escape closes the one that is open without the pointer moving.
 * `_source` is Leaflet's own name for the layer a tooltip belongs to (1.9).
 */
function hoverableTooltips(map: L.Map): () => void {
  let open: L.Tooltip | null = null;
  map.on('tooltipopen', (event) => {
    const tooltip = (event as L.TooltipEvent).tooltip;
    open = tooltip;
    const owner = (tooltip as unknown as { _source?: TooltipOwner })._source;
    const label = tooltip.getElement();
    if (!owner || !label || tooltip.options.permanent) return;
    label.style.pointerEvents = 'auto';
    if (owner.hoverable) return;
    owner.hoverable = true;
    let leaving = 0;
    const leave = () => {
      window.clearTimeout(leaving);
      leaving = window.setTimeout(() => owner.closeTooltip(), HOVER_GRACE_MS);
    };
    const stay = () => window.clearTimeout(leaving);
    owner.off('mouseout', owner.closeTooltip);
    owner.on('mouseout', leave);
    owner.on('mouseover', stay);
    label.addEventListener('mouseenter', stay);
    label.addEventListener('mouseleave', leave);
  });
  map.on('tooltipclose', (event) => {
    if ((event as L.TooltipEvent).tooltip === open) open = null;
  });
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) map.closeTooltip(open);
  };
  document.addEventListener('keydown', escape);
  return () => document.removeEventListener('keydown', escape);
}

/** Long enough for the second click of a double click, which zooms, to cancel the pan of the first. */
export const PAN_AFTER_CLICK_MS = 300;

/**
 * WCAG 2.5.7: the map moved only by dragging it, and a drag is the one gesture some hands
 * cannot make. A single click or tap on the map now brings that spot to the centre, so the
 * view goes anywhere one tap at a time. Not when the tap was a stop's (the stop layer marks
 * the event as claimed, for the same reason the route layer reads it), and not for the first
 * click of a double click, which zooms there. Unanimated under reduced motion.
 */
function panOnClick(map: L.Map): () => void {
  let pending = 0;
  const onClick = (event: L.LeafletMouseEvent) => {
    window.clearTimeout(pending);
    const original = event.originalEvent as MouseEvent & { _stopClaimed?: boolean };
    pending = window.setTimeout(() => {
      if (original?._stopClaimed) return;
      map.panTo(event.latlng, { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
    }, PAN_AFTER_CLICK_MS);
  };
  const onDouble = () => window.clearTimeout(pending);
  map.on('click', onClick);
  map.on('dblclick', onDouble);
  return () => {
    window.clearTimeout(pending);
    map.off('click', onClick);
    map.off('dblclick', onDouble);
  };
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
