import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useT } from '../../i18n';
import { escapeHtml } from '../../utils/html';
import { RoutePlanResult, TripSegment } from '../../types';
import { LUGO_CENTER, stopById } from '../../data/transitData';
import { useRouteGeometry } from '../../data/routeGeometry';
import { WalkPaths, walkHopKey } from '../../services/walkingPath';
import { useIsDark } from '../../hooks/useIsDark';
import { useLeafletMap } from '../../hooks/useLeafletMap';
import { mapColors, stopDotStyle, userDotStyle } from './palette';

interface Place {
  lat: number;
  lng: number;
  name: string;
}

interface RouteMapProps {
  plan: RoutePlanResult | null;
  walkPaths?: WalkPaths;
  origin?: Place;
  destination?: Place;
  /** Index of the leg being made right now (trip companion): drawn in full and framed, the rest faint. */
  focusSegment?: number;
  /** The reader's own position, drawn and kept in view. */
  position?: { lat: number; lng: number } | null;
  className?: string;
}

/** Room the fit leaves around the trip: more at the top, where the "Paso a paso" chip sits. */
const FIT = { paddingTopLeft: [28, 56] as [number, number], paddingBottomRight: [28, 28] as [number, number], maxZoom: 16 };
const FAINT = 0.25;

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
  const ink = isLight(color) ? '#191514' : '#ffffff';
  return L.divIcon({
    className: 'route-map-pin',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:${color};color:${ink};font:700 12px/1 var(--font-sans);box-shadow:0 1px 4px rgba(0,0,0,.4);border:2px solid ${ink};">${label}</div>`,
  });
}

/** The walk segment just before bus leg `index`, skipping a wait; -1 when there is none. */
function walkBefore(segments: TripSegment[], index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (segments[i].type === 'bus') return -1;
    if (segments[i].type === 'walk') return i;
  }
  return -1;
}

/**
 * A planned trip, drawn: walking legs dashed (the real pavement where the router answered,
 * a straight hint where it did not), each bus leg in its line colour sliced from that
 * direction's real road geometry between the two stops it rides.
 */
export function RouteMap({ plan, origin, destination, walkPaths = {}, focusSegment, position = null, className }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useT();
  const colors = mapColors(useIsDark());
  const geometryReady = useRouteGeometry();
  /**
   * The bounds this map is meant to show, so a resize can put the view back: the map is
   * built inside a column that is `display: none` on a phone until there is a plan, and a
   * fit worked out for a box that no longer exists clipped the trip to a couple of streets.
   */
  const shownRef = useRef<L.LatLngBounds | null>(null);
  const map = useLeafletMap(containerRef, {
    center: LUGO_CENTER,
    zoom: 13,
    scrollWheelZoom: false,
    region: t.planner.routeMap,
    onResize: (instance) => {
      // Only when the trip has actually fallen off the map: a reader who zoomed in keeps their view.
      const want = shownRef.current;
      if (want?.isValid() && !instance.getBounds().contains(want)) instance.fitBounds(want, FIT);
    },
  });

  useEffect(() => {
    if (!map || !geometryReady) return;
    const group = L.layerGroup().addTo(map);
    const bounds = L.latLngBounds([]);
    const extend = (points: [number, number][]) => points.forEach((p) => bounds.extend(p));
    const latLngs = (line: L.Polyline) => (line.getLatLngs() as L.LatLng[]).map((p): [number, number] => [p.lat, p.lng]);

    // Which parts are the reader's now: the focused leg is drawn as always and framed; the
    // rest drops to a quarter opacity. A walk is focused through the bus leg it leads into.
    const segments = plan?.segments || [];
    const focused = focusSegment !== undefined && segments[focusSegment] !== undefined;
    const legIsFocused = (index: number) => !focused || index === focusSegment;
    const walkIntoIsFocused = (index: number) => !focused || walkBefore(segments, index) === focusSegment;
    const lastIndex = segments.length - 1;
    const finalWalkIsFocused = !focused || (segments[lastIndex]?.type === 'walk' && focusSegment === lastIndex);

    const walkLine = (a: [number, number], b: [number, number], emphasised: boolean): L.Polyline => {
      const detailed = walkPaths[walkHopKey(a, b)];
      return detailed
        ? L.polyline(detailed.path, { color: colors.walkRouted, weight: 4, dashArray: '1 7', opacity: emphasised ? 0.9 : FAINT }).bindTooltip(escapeHtml(t.planner.walkLeg(detailed.meters, detailed.minutes)))
        : L.polyline([a, b], { color: colors.walkStraight, weight: 3, dashArray: '4 6', opacity: emphasised ? 0.8 : FAINT });
    };
    const pin = (at: [number, number], color: string, label: string, tooltip: string, emphasised: boolean) =>
      group.addLayer(L.marker(at, { icon: pinIcon(color, label), opacity: emphasised ? 1 : FAINT }).bindTooltip(escapeHtml(tooltip)));

    // Walking legs join the previous point to the next known one: origin -> first stop, last stop -> destination.
    let previous: [number, number] | null = origin ? [origin.lat, origin.lng] : null;
    if (origin) {
      const firstLeg = segments.findIndex((seg) => seg.type === 'bus');
      const emphasised = firstLeg === -1 ? finalWalkIsFocused : walkIntoIsFocused(firstLeg);
      pin([origin.lat, origin.lng], colors.originPin, 'A', origin.name, emphasised);
      if (emphasised) bounds.extend([origin.lat, origin.lng]);
    }

    segments.forEach((segment, index) => {
      if (segment.type !== 'bus' || !segment.line || !segment.fromStop || !segment.toStop) return;
      const emphasised = legIsFocused(index);
      const direction = segment.line.directions.find((d) => d.id === segment.directionId) || segment.line.directions[0];
      const from = direction.stops.indexOf(segment.fromStop.id);
      const to = direction.stops.indexOf(segment.toStop.id);
      const start = direction.stopPathIndex?.[from];
      const end = direction.stopPathIndex?.[to];
      const slice: [number, number][] =
        start !== undefined && end !== undefined && end > start
          ? direction.pathCoordinates.slice(start, end + 1)
          : [
              [segment.fromStop.lat, segment.fromStop.lng],
              [segment.toStop.lat, segment.toStop.lng],
            ];

      if (previous) {
        const walkEmphasised = walkIntoIsFocused(index);
        const walk = walkLine(previous, [segment.fromStop.lat, segment.fromStop.lng], walkEmphasised);
        group.addLayer(walk);
        if (walkEmphasised && focused) extend(latLngs(walk));
      }

      group.addLayer(
        L.polyline(slice, { color: segment.line.color, weight: emphasised ? 6 : 4, opacity: emphasised ? 0.95 : FAINT, lineJoin: 'round' }).bindTooltip(
          escapeHtml(t.planner.lineWithStops(segment.line.number, segment.stopsCount ?? 0)),
        ),
      );
      pin(slice[0], segment.line.color, segment.line.number.slice(0, 3), `${t.planner.board} ${segment.fromStop.name}`, emphasised);

      // Where the ride calls, as the neutral stop dot every map uses: a dot in the line's colour on a line of that colour is a bump, not a stop.
      for (let i = from + 1; i < to && emphasised; i++) {
        const stop = stopById(direction.stops[i]);
        if (stop) group.addLayer(L.circleMarker([stop.lat, stop.lng], stopDotStyle(colors, 4)).bindTooltip(escapeHtml(stop.name), { direction: 'top', offset: [0, -6] }));
      }

      if (emphasised) extend(slice);
      previous = [segment.toStop.lat, segment.toStop.lng];
    });

    if (destination) {
      const end: [number, number] = [destination.lat, destination.lng];
      if (previous) {
        const line = walkLine(previous, end, finalWalkIsFocused);
        group.addLayer(line);
        if (finalWalkIsFocused) extend(latLngs(line));
      }
      pin(end, colors.destinationPin, 'B', destination.name, finalWalkIsFocused);
      if (finalWalkIsFocused) bounds.extend(end);
    }

    if (bounds.isValid()) {
      shownRef.current = bounds;
      map.fitBounds(bounds, FIT);
    }
    return () => {
      group.remove();
    };
  }, [map, geometryReady, plan, walkPaths, origin?.lat, origin?.lng, destination?.lat, destination?.lng, colors, focusSegment]);

  // The reader, on its own layer so a fix every few seconds moves a dot instead of redrawing
  // the trip, and kept in view with the smallest pan rather than a recentre on every fix.
  const positionRef = useRef<L.CircleMarker | null>(null);
  useEffect(() => {
    if (!map) return;
    if (!position) {
      positionRef.current?.remove();
      positionRef.current = null;
      return;
    }
    const at: [number, number] = [position.lat, position.lng];
    if (positionRef.current) positionRef.current.setLatLng(at);
    else positionRef.current = L.circleMarker(at, { ...userDotStyle(colors), interactive: false }).addTo(map);
    map.panInside(at, { padding: [40, 40] });
  }, [map, position?.lat, position?.lng, colors]);

  return <div ref={containerRef} className={className} />;
}
