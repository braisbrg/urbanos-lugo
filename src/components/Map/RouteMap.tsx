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
import { useMapChrome } from '../../hooks/useMapChrome';
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
  /**
   * Index into `plan.segments` of the leg being made right now, for the trip companion.
   * That leg is drawn in full and framed; the rest of the plan stays, faint, so the
   * shape of the trip is still there without competing with the part that matters.
   */
  focusSegment?: number;
  /** The reader's own position, when the screen has one: drawn, and kept in view. */
  position?: { lat: number; lng: number } | null;
  className?: string;
}

/* Map furniture is drawn over CARTO's tiles, which do not change with the app theme, so
   these colours are fixed rather than tokenised. Reading the theme here also baked the
   value at layer-creation time: switching to dark left light-on-light pins at 2.15:1. */
/**
 * Room the fit leaves around the trip, as Leaflet wants it: [x, y].
 *
 * More at the top than anywhere else, because the "Paso a paso" chip sits up there and a
 * route fitted to the whole box runs underneath it. Twenty-eight is the margin that keeps
 * a pin off the edge; the top gets the chip's height on top of that.
 */
const FIT_TOP_LEFT: [number, number] = [28, 56];
const FIT_BOTTOM_RIGHT: [number, number] = [28, 28];

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
                  border-radius:50%;background:${color};color:${ink};font:700 12px/1 var(--font-sans);
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
  focusSegment,
  position = null,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  /**
   * The trip this map is meant to be showing, kept so the view can be put back.
   *
   * `fitBounds` fits the container as it is at that instant, and this map is built inside
   * a column that is `display: none` on a phone until the reader asks for a plan, then
   * revealed, then resized again when the browser chrome slides away. Leaflet's answer to
   * a resize is `invalidateSize`, which restores the size and leaves the view where it
   * was -- so the map keeps a zoom worked out for a box that no longer exists and clips
   * the trip down to a couple of streets. Caught on a 375x812: the route drawn 118x288
   * inside a 297x240 map, three of its twenty-nine pieces still on screen.
   */
  const shownRef = useRef<L.LatLngBounds | null>(null);
  const geometryReady = useRouteGeometry();
  const tilesRef = useRef<BasemapLayer | null>(null);
  const isDark = useIsDark();
  const t = translations(lang);
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
      // A small map inside a scrolling page, the same as the stop mini map: flicking past
      // it should scroll the itinerary, not zoom the city.
      scrollWheelZoom: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(instance);
    tilesRef.current = createBasemap(isDark).addTo(instance) as BasemapLayer;
    setMap(instance);

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            instance.invalidateSize();
            // Only when the trip has actually fallen off the map. A reader who zoomed in
            // on their own keeps their view; a box that changed under them does not.
            const want = shownRef.current;
            if (want?.isValid() && !instance.getBounds().contains(want)) {
              instance.fitBounds(want, { paddingTopLeft: FIT_TOP_LEFT, paddingBottomRight: FIT_BOTTOM_RIGHT, maxZoom: 16 });
            }
          })
        : null;
    observer?.observe(el);

    return () => {
      observer?.disconnect();
      instance.remove();
      setMap(null);
    };
  }, []);

  /**
   * FOSSGIS were credited here, for running the pedestrian router this map used to ask.
   * There is no longer a request to credit: the walk is worked out on the device from a
   * network built out of OpenStreetMap, and OSM is credited where it always was, in the
   * basemap's own line, under the same ODbL that covers the route geometry.
   */
  useEffect(() => {
    if (!map || !geometryReady) return;

    const group = L.layerGroup().addTo(map);
    const bounds = L.latLngBounds([]);
    const extend = (points: [number, number][]) => points.forEach((p) => bounds.extend(p));

    /**
     * A real pavement route where the router answered, a straight hint where it did not.
     *
     * The tooltip was Galician written into this file, which is the one thing the i18n
     * rule forbids: a reader on Spanish or English got "A pé" on every walked leg of
     * their itinerary. It only ever showed on a routed leg, and until the network shipped
     * a routed leg was rare, which is how it lasted.
     */
    /**
     * Which parts are the reader's now, when a screen says so.
     *
     * The focused leg is drawn as always and is what the map frames. Everything else
     * drops to a quarter opacity: still the shape of the trip, no longer competing with
     * the leg being ridden. A walk is focused through the bus leg it leads into, since
     * walks are drawn as the join between stops rather than as segments of their own.
     */
    const segments = plan?.segments || [];
    const focused = focusSegment !== undefined && segments[focusSegment] !== undefined;
    /** The walk segment just before bus leg `index`, skipping a wait; -1 when there is none. */
    const walkBefore = (index: number): number => {
      for (let i = index - 1; i >= 0; i--) {
        if (segments[i].type === 'bus') return -1;
        if (segments[i].type === 'walk') return i;
      }
      return -1;
    };
    const legIsFocused = (index: number) => !focused || index === focusSegment;
    const walkIntoIsFocused = (index: number) => !focused || walkBefore(index) === focusSegment;
    const lastIndex = segments.length - 1;
    const finalWalkIsFocused = !focused || (segments[lastIndex]?.type === 'walk' && focusSegment === lastIndex);
    const faint = 0.25;

    const walkLine = (a: [number, number], b: [number, number], emphasised = true): L.Polyline => {
      const detailed = walkPaths[walkHopKey(a, b)];
      return detailed
        ? L.polyline(detailed.path, { color: colors.walkRouted, weight: 4, dashArray: '1 7', opacity: emphasised ? 0.9 : faint }).bindTooltip(
            escapeHtml(t.planner.walkLeg(detailed.meters, detailed.minutes)),
          )
        : L.polyline([a, b], { color: colors.walkStraight, weight: 3, dashArray: '4 6', opacity: emphasised ? 0.8 : faint });
    };

    // Walking legs have no geometry of their own, so they join the previous point to
    // the next known one: origin -> first stop, last stop -> destination.
    let previous: [number, number] | null = origin ? [origin.lat, origin.lng] : null;
    if (origin) {
      const firstLeg = segments.findIndex((seg) => seg.type === 'bus');
      const emphasised = firstLeg === -1 ? finalWalkIsFocused : walkIntoIsFocused(firstLeg);
      group.addLayer(
        L.marker([origin.lat, origin.lng], { icon: pinIcon(colors.originPin, 'A'), opacity: emphasised ? 1 : faint }).bindTooltip(escapeHtml(origin.name)),
      );
      if (emphasised) bounds.extend([origin.lat, origin.lng]);
    }

    segments.forEach((segment, index) => {
      if (segment.type === 'bus' && segment.line && segment.fromStop && segment.toStop) {
        const emphasised = legIsFocused(index);
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
          const walkEmphasised = walkIntoIsFocused(index);
          const walk = walkLine(previous, [segment.fromStop.lat, segment.fromStop.lng], walkEmphasised);
          group.addLayer(walk);
          if (walkEmphasised && focused) extend((walk.getLatLngs() as L.LatLng[]).map((p) => [p.lat, p.lng]));
        }

        group.addLayer(
          L.polyline(slice, { color: segment.line.color, weight: emphasised ? 6 : 4, opacity: emphasised ? 0.95 : faint, lineJoin: 'round' }).bindTooltip(
            escapeHtml(t.planner.lineWithStops(segment.line.number, segment.stopsCount ?? 0)),
          ),
        );
        group.addLayer(
          L.marker(slice[0], { icon: pinIcon(segment.line.color, segment.line.number.slice(0, 3)), opacity: emphasised ? 1 : faint }).bindTooltip(
            `${escapeHtml(t.planner.board)} ${escapeHtml(segment.fromStop.name)}`,
          ),
        );

        // Where the ride actually calls. Drawn under the boarding pin so the two ends
        // still read as the ends, and small enough not to compete with the route.
        // Neutral, not the line's colour: an 8 px dot of the same colour on top of a
        // 6 px line of that colour is a bump in the line, not a stop. The same pair the
        // network map uses, so a stop looks like a stop wherever it is drawn.
        for (let i = from + 1; i < to && emphasised; i++) {
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

        if (emphasised) extend(slice);
        previous = [segment.toStop.lat, segment.toStop.lng];
      }
    });

    if (destination) {
      const end: [number, number] = [destination.lat, destination.lng];
      if (previous) {
        const line = walkLine(previous, end, finalWalkIsFocused);
        group.addLayer(line);
        if (finalWalkIsFocused) extend((line.getLatLngs() as L.LatLng[]).map((p) => [p.lat, p.lng]));
      }
      group.addLayer(
        L.marker(end, { icon: pinIcon(colors.destinationPin, 'B'), opacity: finalWalkIsFocused ? 1 : faint }).bindTooltip(escapeHtml(destination.name)),
      );
      if (finalWalkIsFocused) bounds.extend(end);
    }

    if (bounds.isValid()) {
      shownRef.current = bounds;
      map.fitBounds(bounds, { paddingTopLeft: FIT_TOP_LEFT, paddingBottomRight: FIT_BOTTOM_RIGHT, maxZoom: 16 });
    }

    return () => {
      group.remove();
    };
  }, [map, geometryReady, plan, walkPaths, origin?.lat, origin?.lng, destination?.lat, destination?.lng, colors, focusSegment]);

  /**
   * The reader, on the map.
   *
   * Its own layer rather than part of the group above, so a fix every few seconds moves a
   * dot instead of redrawing the trip. Kept in view with the smallest pan that brings it
   * back inside the box -- not a recentre on every fix, which would fight anyone who had
   * just zoomed in on their stop, and not a refit to route-plus-reader, which one GPS jump
   * across town would turn into a map of all of Lugo.
   */
  const positionRef = useRef<L.CircleMarker | null>(null);
  useEffect(() => {
    if (!map) return;
    if (!position) {
      positionRef.current?.remove();
      positionRef.current = null;
      return;
    }
    const at: [number, number] = [position.lat, position.lng];
    if (positionRef.current) {
      positionRef.current.setLatLng(at);
    } else {
      positionRef.current = L.circleMarker(at, {
        radius: 8,
        fillColor: colors.userFill,
        color: colors.userStroke,
        weight: 3,
        opacity: 1,
        fillOpacity: 0.95,
        interactive: false,
      }).addTo(map);
    }
    map.panInside(at, { padding: [40, 40] });
  }, [map, position?.lat, position?.lng, colors]);

  // Swap the basemap when the theme changes. The layer restyles in place, so the view
  // stays where the reader left it instead of snapping back to Lugo centre.
  useEffect(() => {
    tilesRef.current?.setBasemapTheme(isDark);
  }, [isDark]);

  // The third map got the chrome last: the network map and the stop mini map were
  // named and translated, and this one still said "Zoom in" under a Galician itinerary.
  useMapChrome(map ? containerRef.current : null, {
    region: t.planner.routeMap,
    zoomIn: t.map.zoomIn,
    zoomOut: t.map.zoomOut,
  });

  return <div ref={containerRef} className={className} />;
};
