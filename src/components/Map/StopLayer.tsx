import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { escapeHtml } from '../../utils/html';
import { BusStop } from '../../types';
import { poleCode } from '../../data/transitData';
import { useIsDark } from '../../hooks/useIsDark';
import { mapColors, stopDotStyle } from './palette';
import { stopNamesLayer } from './StopNames';

interface StopLayerProps {
  map: L.Map | null;
  stops: BusStop[];
  /** Lines to draw; null means every line. */
  visibleLineIds: string[] | null;
  selectedStop?: BusStop;
  showStops: boolean;
  /** A stop was tapped. The board for it rises over the map; this layer only reports it. */
  onTapStop: (stop: BusStop) => void;
}

/**
 * How big a dot is drawn at each zoom, and from where the names are written beside them
 * (a phone has no hover, so without that no stop ever told you its name).
 */
const ZOOM_LADDER: { from: number; radius: number; label: boolean }[] = [
  { from: 16, radius: 7, label: true },
  { from: 15, radius: 6, label: false },
  { from: 14, radius: 5, label: false },
  { from: 0, radius: 4, label: false },
];
const rungFor = (zoom: number) => ZOOM_LADDER.find((r) => zoom >= r.from) ?? ZOOM_LADDER[ZOOM_LADDER.length - 1];

/** The room a stop keeps around itself in the overview, centre to centre, in pixels at the rung's zoom. */
const SPREAD_PX = 24;
/** A set this small is built whole; above it, only the part in view, the rest on demand. */
const BUILD_ALL_UP_TO = 120;

/**
 * The stops, as circle markers on the shared canvas (a DOM node each was 417 nodes). The
 * rung, not the zoom, is what the rebuild follows: four thresholds instead of every notch.
 */
export function StopLayer({ map, stops, visibleLineIds, selectedStop, showStops, onTapStop }: StopLayerProps) {
  const teardownRef = useRef<(() => void) | null>(null);
  const markersRef = useRef<Record<string, L.CircleMarker>>({});
  const colors = mapColors(useIsDark());
  // Refs so a fresh arrow or a new selection does not rebuild every marker.
  const onTapStopRef = useRef(onTapStop);
  onTapStopRef.current = onTapStop;
  const selectedIdRef = useRef(selectedStop?.id);
  selectedIdRef.current = selectedStop?.id;

  const [rung, setRung] = useState(() => rungFor(map?.getZoom() ?? 14));
  /** Bumped when a stop selected at a thinning zoom has no dot yet. */
  const [thinnedIn, setThinnedIn] = useState(0);
  useEffect(() => {
    if (!map) return;
    const sync = () => setRung(rungFor(map.getZoom()));
    sync();
    map.on('zoomend', sync);
    return () => {
      map.off('zoomend', sync);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup().addTo(map);
    markersRef.current = {};

    if (showStops) {
      const onLine = visibleLineIds === null ? stops : stops.filter((s) => s.lines.some((l) => visibleLineIds.includes(l)));
      // A filtered set is sparse enough to show whole. The overview keeps the stops that
      // fit: most-served first, each kept if no kept stop is within SPREAD_PX of it at the
      // rung's own zoom, so the set does not churn as you pinch inside a rung.
      const detailed = visibleLineIds !== null;
      let visible = onLine;
      if (!detailed && !rung.label) {
        const at = Math.max(rung.from, 12);
        const kept: L.Point[] = [];
        visible = [...onLine]
          .sort((a, b) => Number(b.id === selectedIdRef.current) - Number(a.id === selectedIdRef.current) || b.lines.length - a.lines.length || a.name.localeCompare(b.name))
          .filter((s) => {
            const p = map.project([s.lat, s.lng], at);
            if (kept.some((k) => k.distanceTo(p) < SPREAD_PX)) return false;
            kept.push(p);
            return true;
          });
      }

      const placed: Record<string, BusStop> = {};
      const names = rung.label ? stopNamesLayer({ ink: colors.nameInk, halo: colors.nameHalo, radius: rung.radius }).addTo(map) : null;

      // Only the stops in view are built now (one redraw), the rest as a pan brings them
      // within the margin: all 417 at once was the freeze felt when panning after a zoom.
      const drawBounds = map.getBounds().pad(0.3);
      const pending = new Map<string, BusStop>();

      const place = (stop: BusStop) => {
        const selected = stop.id === selectedIdRef.current;
        const marker = L.circleMarker([stop.lat, stop.lng], stopDotStyle(colors, rung.radius, selected));
        const code = poleCode(stop);
        marker.bindTooltip(
          `<div style="font-family: var(--font-sans); font-size: 12px; font-weight: 600; color: var(--c-ink); padding: 3px 5px;">${code ? `<span style="color: var(--c-accent); margin-right: 5px;">${escapeHtml(code)}</span>` : ''}${escapeHtml(stop.name)}</div>`,
          { direction: 'top', offset: [0, -8], opacity: 0.95, className: 'stop-hover-tooltip' },
        );
        // Claim the click: the route layer answers map clicks within twenty pixels of a
        // line, and Leaflet runs layer handlers before the map's own.
        marker.on('click', (e: L.LeafletMouseEvent) => {
          (e.originalEvent as MouseEvent & { _stopClaimed?: boolean })._stopClaimed = true;
          onTapStopRef.current(stop);
        });
        placed[stop.id] = stop;
        group.addLayer(marker);
        markersRef.current[stop.id] = marker;
        if (selected) marker.bringToFront();
      };

      for (const stop of visible) {
        if (visible.length <= BUILD_ALL_UP_TO || drawBounds.contains([stop.lat, stop.lng])) place(stop);
        else pending.set(stop.id, stop);
      }
      names?.setStops(Object.values(placed));

      const arrive = () => {
        if (!pending.size) return;
        const reach = map.getBounds().pad(0.3);
        let any = false;
        for (const [id, stop] of pending) {
          if (!reach.contains([stop.lat, stop.lng])) continue;
          pending.delete(id);
          place(stop);
          any = true;
        }
        if (any) names?.setStops(Object.values(placed));
      };
      map.on('moveend', arrive);
      teardownRef.current = () => {
        map.off('moveend', arrive);
        names?.remove();
      };
    }

    return () => {
      teardownRef.current?.();
      teardownRef.current = null;
      group.remove();
      markersRef.current = {};
    };
    // Not the selection: it used to be here, so every tap on a stop rebuilt all 417.
  }, [map, stops, visibleLineIds, showStops, rung, colors, thinnedIn]);

  // Selection restyles one marker rather than rebuilding the layer; the others go back to the rung's radius.
  useEffect(() => {
    const selectedId = selectedStop?.id;
    // At a thinning zoom the selected stop is kept only when the layer is built; selected afterwards, it may have no dot.
    if (selectedId && !markersRef.current[selectedId] && !rung.label) {
      setThinnedIn((n) => n + 1);
      return;
    }
    for (const [id, marker] of Object.entries(markersRef.current)) {
      marker.setStyle(stopDotStyle(colors, rung.radius, id === selectedId));
      if (id === selectedId) marker.bringToFront();
    }
  }, [selectedStop?.id, rung, colors]);

  return null;
}
