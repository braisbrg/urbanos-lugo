import React, { useEffect, useRef, useState } from 'react';
import { Lang, translations } from '../../i18n';
import L from 'leaflet';
import { escapeHtml } from './escapeHtml';
import 'leaflet/dist/leaflet.css';
import { RoutePlanResult } from '../../types';
import { BUS_STOPS, LUGO_CENTER } from '../../data/transitData';
import { useRouteGeometry } from '../../data/routeGeometry';
import { WalkingPath, walkHopKey } from '../../services/walkingPath';
import { useIsDark } from '../../hooks/useIsDark';
import { createBasemap, type BasemapLayer } from './basemap';
import { mapColors } from './palette';

interface RouteMapProps {
  plan: RoutePlanResult | null;
  lang: Lang;
  /** Real pedestrian routes for the plan's walking hops, keyed by walkHopKey. */
  walkPaths?: Record<string, WalkingPath | null>;
  /** Where the trip starts and ends, for the walking legs at each end. */
  origin?: { lat: number; lng: number; name: string };
  destination?: { lat: number; lng: number; name: string };
  className?: string;
}

/* Map furniture is drawn over CARTO's tiles, which do not change with the app theme, so
   these colours are fixed rather than tokenised. Reading the theme here also baked the
   value at layer-creation time: switching to dark left light-on-light pins at 2.15:1. */
/** Rough relative luminance of a #rrggbb colour, enough to pick black or white ink. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35;
}

function pinIcon(color: string, label: string): L.DivIcon {
  // White on the dark palette's pins measured 2.54:1 and 1.92:1 — the pin colours are
  // light there so the letter has to be dark.
  const ink = isLight(color) ? '#191514' : '#ffffff';
  const ring = isLight(color) ? '#191514' : '#ffffff';
  return L.divIcon({
    className: 'route-map-pin',
    html: `
      <div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;
                  border-radius:50%;background:${color};color:${ink};font:700 12px/1 sans-serif;
                  box-shadow:0 1px 4px rgba(0,0,0,.4);border:2px solid ${ring};">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/**
 * Draws a planned trip: walking legs dashed, each bus leg in its line colour, sliced
 * from that direction's real road geometry between the two stops it actually rides.
 */
export const RouteMap: React.FC<RouteMapProps> = ({
  plan,
  lang,
  origin,
  destination,
  walkPaths = {},
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const geometryReady = useRouteGeometry();
  const tilesRef = useRef<BasemapLayer | null>(null);
  const isDark = useIsDark();
  const colors = mapColors(isDark);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // maxZoom used to come from the tile layer; the basemap layer has none to give.
    const instance = L.map(el, {
      center: LUGO_CENTER,
      zoom: 13,
      maxZoom: 19,
      zoomControl: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    tilesRef.current = createBasemap(isDark).addTo(instance) as BasemapLayer;
    setMap(instance);

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => instance.invalidateSize()) : null;
    observer?.observe(el);

    return () => {
      observer?.disconnect();
      instance.remove();
      setMap(null);
    };
  }, []);

  useEffect(() => {
    if (!map || !geometryReady) return;

    const group = L.layerGroup().addTo(map);
    const bounds = L.latLngBounds([]);
    const extend = (points: [number, number][]) => points.forEach((p) => bounds.extend(p));

    /** A real pavement route when we have fetched one, a straight hint otherwise. */
    const walkLine = (a: [number, number], b: [number, number]): L.Polyline => {
      const detailed = walkPaths[walkHopKey(a, b)];
      return detailed
        ? L.polyline(detailed.path, { color: colors.walkRouted, weight: 4, dashArray: '1 7', opacity: 0.9 }).bindTooltip(
            `A pé · ${detailed.meters} m · ${detailed.minutes} min`,
          )
        : L.polyline([a, b], { color: colors.walkStraight, weight: 3, dashArray: '4 6', opacity: 0.8 });
    };

    // Walking legs have no geometry of their own, so they join the previous point to
    // the next known one: origin -> first stop, last stop -> destination.
    let previous: [number, number] | null = origin ? [origin.lat, origin.lng] : null;
    if (origin) {
      group.addLayer(L.marker([origin.lat, origin.lng], { icon: pinIcon(colors.originPin, 'A') }).bindTooltip(escapeHtml(origin.name)));
      bounds.extend([origin.lat, origin.lng]);
    }

    (plan?.segments || []).forEach((segment) => {
      if (segment.type === 'bus' && segment.line && segment.fromStop && segment.toStop) {
        const direction =
          segment.line.directions.find((d) => d.id === segment.directionId) || segment.line.directions[0];
        const from = direction.stops.indexOf(segment.fromStop.id);
        const to = direction.stops.indexOf(segment.toStop.id);

        const start = direction.stopPathIndex?.[from];
        const end = direction.stopPathIndex?.[to];
        const slice =
          start !== undefined && end !== undefined && end > start
            ? direction.pathCoordinates.slice(start, end + 1)
            : ([
                [segment.fromStop.lat, segment.fromStop.lng],
                [segment.toStop.lat, segment.toStop.lng],
              ] as [number, number][]);

        if (previous) {
          // The hop from wherever we were to the boarding stop, joined stop to stop so
          // it matches the key the pedestrian route was fetched under.
          group.addLayer(walkLine(previous, [segment.fromStop.lat, segment.fromStop.lng]));
        }

        group.addLayer(
          L.polyline(slice, { color: segment.line.color, weight: 6, opacity: 0.95, lineJoin: 'round' }).bindTooltip(
            escapeHtml(translations(lang).planner.lineWithStops(segment.line.number, segment.stopsCount ?? 0)),
          ),
        );
        group.addLayer(
          L.marker(slice[0], { icon: pinIcon(segment.line.color, segment.line.number.slice(0, 3)) }).bindTooltip(
            `${escapeHtml(translations(lang).planner.board)} ${escapeHtml(segment.fromStop.name)}`,
          ),
        );

        // Where the ride actually calls. Drawn under the boarding pin so the two ends
        // still read as the ends, and small enough not to compete with the route.
        // Neutral, not the line's colour: an 8 px dot of the same colour on top of a
        // 6 px line of that colour is a bump in the line, not a stop. The same pair the
        // network map uses, so a stop looks like a stop wherever it is drawn.
        for (let i = from + 1; i < to; i++) {
          const stop = BUS_STOPS.find((s) => s.id === direction.stops[i]);
          if (!stop) continue;
          group.addLayer(
            L.circleMarker([stop.lat, stop.lng], {
              radius: 4,
              color: colors.stopStroke,
              weight: 2,
              fillColor: colors.stopFill,
              fillOpacity: 1,
            }).bindTooltip(escapeHtml(stop.name), { direction: 'top', offset: [0, -6] }),
          );
        }

        extend(slice);
        previous = [segment.toStop.lat, segment.toStop.lng];
      }
    });

    if (destination) {
      const end: [number, number] = [destination.lat, destination.lng];
      if (previous) {
        const line = walkLine(previous, end);
        group.addLayer(line);
        extend((line.getLatLngs() as L.LatLng[]).map((p) => [p.lat, p.lng]));
      }
      group.addLayer(L.marker(end, { icon: pinIcon(colors.destinationPin, 'B') }).bindTooltip(escapeHtml(destination.name)));
      bounds.extend(end);
    }

    if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });

    return () => {
      group.remove();
    };
  }, [map, geometryReady, plan, walkPaths, origin?.lat, origin?.lng, destination?.lat, destination?.lng, colors]);

  // Swap the basemap when the theme changes. The layer restyles in place, so the view
  // stays where the reader left it instead of snapping back to Lugo centre.
  useEffect(() => {
    tilesRef.current?.setBasemapTheme(isDark);
  }, [isDark]);

  return <div ref={containerRef} className={className} />;
};
