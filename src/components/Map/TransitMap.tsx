import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lang, translations } from '../../i18n';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Bus,
  MapPin,
  Navigation,
  Layers,
  LocateFixed,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
} from 'lucide-react';
import { BusStop, BusLine, ScheduledBus } from '../../types';
import { BUS_STOPS, BUS_LINES, LUGO_CENTER, poleCode } from '../../data/transitData';
import {
  getScheduledBuses,
  getNearbyLines,
  getNearbyStops,
  NEARBY_STOP_LIMIT_METRES,
} from '../../utils/transitEngine';
import { getDistanceMeters } from '../../utils/geo';

/** Matches the stop board: what somebody standing there could reasonably walk to. */
const AROUND_STOP_RADIUS_M = 400;
import { useIsDark } from '../../hooks/useIsDark';
import { useDialog } from '../../hooks/useDialog';
import { useMapChrome } from '../../hooks/useMapChrome';
import { createBasemap, type BasemapLayer } from './basemap';
import { mapColors } from './palette';
import { useRouteGeometry } from '../../data/routeGeometry';
import { RouteLayer } from './RouteLayer';
import { StopLayer } from './StopLayer';
import { StopSheet } from './StopSheet';
import { VehicleLayer } from './VehicleLayer';

/** How far someone will walk to a different line. Also used by the nearby-lines panel. */
const NEARBY_RADIUS_M = 750;

/**
 * How many of the nearby lines the *map* draws. The panel still lists them all.
 *
 * "Near me" narrows nothing in the middle of Lugo, and the numbers are stark. Counting
 * distinct lines with a stop inside a radius: from the walled centre it is 14 within
 * 200 m and 23 of the 24 within 750 m. From O Ceao it is 1 and 4; from the campus, 1 and
 * 17. The network converges on the muralla, so anybody standing there is near almost
 * every line, and a radius — any radius — cannot separate them.
 *
 * A count can. The list arrives sorted by how far you would walk to reach each line, so
 * the first six are the six you could actually catch: all of them out in O Ceao, the
 * nearest six of twenty-three in the centre. Without this the "nearby" filter would draw
 * the whole network for a reader in the middle of town, which is the exact thing the
 * filter exists to prevent.
 */
const NEARBY_SCOPE_LIMIT = 6;

/**
 * Whether this page load has already decided how the map opens.
 *
 * Module scope on purpose: a ref resets with the component, and the map unmounts every
 * time somebody visits another tab. Opening on the nearby lines is a thing that happens
 * once, when the app is opened — not something that reasserts itself over a line the
 * reader chose two taps ago.
 */
let openedOnNearby = false;

const PRESET_CENTERS: Record<'hula' | 'campus' | 'ceao', [number, number]> = {
  hula: [43.0298, -7.5274],
  campus: [42.9935, -7.5538],
  ceao: [43.044, -7.5692],
};

interface TransitMapProps {
  selectedStop?: BusStop;
  /** What the reader asked to see. Without it the map has to guess between the two. */
  focus?: 'stop' | 'line';
  selectedLine?: BusLine | null;
  onSelectStop: (stop: BusStop) => void;
  onSelectLine: (line: BusLine) => void;
  /** Leave the map for a line's own page. Selecting a line only filters the map. */
  onOpenLine: (line: BusLine) => void;
  lang: Lang;
}

export const TransitMap: React.FC<TransitMapProps> = ({
  selectedStop,
  focus = 'line',
  selectedLine,
  onSelectStop,
  onSelectLine,
  onOpenLine,
  lang,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const tilesRef = useRef<BasemapLayer | null>(null);
  const isDark = useIsDark();
  const colors = mapColors(isDark);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  /**
   * The circle showing how sure the phone is.
   *
   * A dot on its own says "you are here" with the same confidence whether the fix came
   * from GPS outdoors or from wifi indoors, where it can be five hundred metres out. On a
   * map whose whole job is telling you if you can make the stop, that is the same kind of
   * claim this app refuses to make about times.
   */
  const accuracyRef = useRef<L.Circle | null>(null);
  const watchIdRef = useRef<number | null>(null);
  /** Where the nearby-lines list was last computed, so walking a few metres does not redo it. */
  const lastFixRef = useRef<[number, number] | null>(null);

  const [activeLineId, setActiveLineId] = useState<string>(selectedLine?.id || 'all');
  const [filterPreset, setFilterPreset] = useState<
    'all' | 'nearby' | 'stop' | 'hula' | 'campus' | 'ceao'
  >('all');
  const [showStops, setShowStops] = useState(true);
  const [showBuses, setShowBuses] = useState(true);
  /**
   * Every line at once is not a map of a network, it is a picture of string.
   *
   * Twenty-four routes over one small city means the centre is a knot of overlapping
   * polylines, and the stops underneath — the thing this screen exists to show — get read
   * through it.
   *
   * What stops that happening is not this flag. The app always has a line selected — it
   * starts on the first one — so `selectedLine` is set on a cold open and this is `true`
   * every time in practice; the guard only earns its keep if a caller ever passes null.
   * The map is quiet because of how the routes are drawn: the chosen line in full, the
   * rest of the network as thin faint threads behind it, which is context rather than
   * competition. Twenty-four equal traces is what was wrong, not twenty-four traces.
   */
  const [showRoutes, setShowRoutes] = useState(Boolean(selectedLine));
  const [liveBuses, setScheduledBuses] = useState<ScheduledBus[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [nearbyLinesList, setNearbyLinesList] = useState<{ line: BusLine; nearestStop: BusStop; walkMeters: number }[]>([]);
  const [isLocating, setIsLocating] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  /**
   * Whether the controls are pulled up over the map.
   *
   * Only means anything below `lg`. Making the map the whole screen on a phone had a
   * consequence I had not paid for: the quick filters, the layer switches, the line list
   * and the telemetry all still lived in the column beside the map, and on a phone that
   * column is *under* the map — a full viewport of scrolling away, past a element that
   * swallows the gesture. Reachable in principle and unreachable in practice.
   *
   * So on a phone that column is a sheet you pull up over the map instead of a column you
   * scroll to. It is the same markup either way: at `lg` the classes below hand it back to
   * being an ordinary sidebar and this state stops mattering.
   */
  const [sheetOpen, setSheetOpen] = useState(false);
  /**
   * Whether the line chips are unfolded into a grid.
   *
   * A single row that scrolls sideways is the wrong shape for twenty-four things you
   * are trying to *find*: about five fit on a 375 px screen, the other nineteen are
   * reached by swiping blind, and that swipe is the same gesture the map underneath
   * wants for panning. It is a fine shape for the two or three you switch between,
   * which is what it stays until you ask for the rest.
   *
   * Unfolded it wraps into a grid — every line visible at once, scannable, no gesture
   * needed. The full list with names still lives in the sheet; this is the quick way
   * to the one you can recognise by its badge.
   */
  const [linesExpanded, setLinesExpanded] = useState(false);
  /** The stop whose board is open over the map. Null when nobody has tapped one. */
  const [tappedStop, setTappedStop] = useState<BusStop | null>(null);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  // Escape closes it and focus moves into it, the same as the menu and the QR reader.
  // The hook no-ops while `sheetOpen` is false, which is what it always is at `lg`, where
  // this is a column and not a dialog at all.
  const sheetRef = useDialog(sheetOpen, closeSheet);

  const stops = BUS_STOPS;
  /**
   * Only the poles the operator actually publishes a QR token for.
   *
   * This line used to quote the whole network, when most of those poles have no
   * token at all and show no code anywhere else in the app. Counting the ones that do
   * keeps the number and the claim the same size, whatever a rebuild does to the total.
   */
  const stopsWithQr = useMemo(() => BUS_STOPS.filter((s) => poleCode(s)).length, []);

  // One line selected wins; otherwise "nearby" narrows to the walkable set; otherwise all.
  // The stop whose neighbourhood is on show. It has to be the stop whose popup asked
  // for it: reading `selectedStop` instead meant the filter answered for a stop chosen
  // on another screen -- or, with nothing selected, silently for no stop at all.
  const [linesHereStop, setLinesHereStop] = useState<BusStop | null>(null);

  const aroundStopLineIds = useMemo(
    () =>
      linesHereStop
        ? [
            ...new Set([
              ...linesHereStop.lines,
              ...getNearbyLines(linesHereStop.lat, linesHereStop.lng, AROUND_STOP_RADIUS_M).map(
                (n) => n.line.id,
              ),
            ]),
          ]
        : [],
    [linesHereStop],
  );

  /** From a stop's own popup: keep the map, drop every line that does not serve it. */
  const showLinesHere = (stop: BusStop) => {
    setLinesHereStop(stop);
    setFilterPreset('stop');
    setActiveLineId('all');
    map?.setView([stop.lat, stop.lng], 15, { animate: true });
  };

  /**
   * What the current scope is about: every line, or the set a preset narrowed us to.
   * Kept apart from `visibleLineIds` because picking one line should narrow the map
   * without emptying the list you picked it from.
   */
  const scopeLineIds =
    filterPreset === 'stop' && aroundStopLineIds.length
      ? aroundStopLineIds
      : filterPreset === 'nearby' && nearbyLinesList.length
        ? nearbyLinesList.slice(0, NEARBY_SCOPE_LIMIT).map((n) => n.line.id)
        : null;

  const visibleLineIds = activeLineId !== 'all' ? [activeLineId] : scopeLineIds;
  // Street geometry arrives as its own chunk; until then the stop layer still works.
  const geometryReady = useRouteGeometry();
  const lines = BUS_LINES;
  // What colour the legend's bus and route swatches should be: the colour the map is
  // actually drawing them in, which is the line's own. With every line shown at once
  // there is no single answer, so they go neutral and the shape carries the meaning.
  /**
   * One shape for the five quick filters.
   *
   * They had grown five different treatments — an amber HULA, a red-lettered Campus, an
   * inked O Ceao — and an emoji each, which is what made the block read as assembled
   * rather than designed and what stopped the labels fitting: the widest of them wrapped
   * to two lines inside a fixed 44 px box and spilled out of it. The label says which
   * place; the colour only has to say which one is on.
   */
  const presetButtonClass = (active: boolean) =>
    `flex min-h-11 items-center justify-center rounded-[9px] px-2.5 py-1.5 text-center text-label font-semibold ${
      active ? 'bg-accent text-on-accent shadow-xs' : 'border border-edge bg-surface text-ink-2'
    }`;
  // The list has to agree with the banner above it. It used to offer all twenty-four
  // while the map drew four, which read as the filter having done nothing.
  const listedLines = scopeLineIds ? lines.filter((l) => scopeLineIds.includes(l.id)) : lines;

  /**
   * The numbers that more than one line answers to.
   *
   * Four of the twenty-four are numbered 11 — Pías, Igrexa de Bóveda, Calde and Santa
   * Comba — and the operator paints all four the same brown. In the sidebar rows that
   * is fine: the row carries the full name beside the badge. On a chip, which is the
   * badge and nothing else, it came out as four identical brown 11s in a row, asking
   * the reader to memorise that the third one is Calde.
   *
   * Derived rather than written down, so a branch added or dropped upstream keeps up.
   */
  const sharedNumbers = useMemo(() => {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const line of lines) (seen.has(line.number) ? shared : seen).add(line.number);
    return shared;
  }, [lines]);

  /**
   * The far end of a line's name — "Ramón Ferreiro (Feminino) - Calde (Hospital)" — cut
   * down to the part that tells one branch from another.
   *
   * Two trims, both from what the chips actually rendered. Line 11's own name ends in its
   * number, so beside a badge that already says 11 it came out as "11 Pías 11". And the
   * parenthetical names the stop rather than the branch — it is "Calde (Hospital)" because
   * that is which Calde, not because the branch is the hospital — so it was spending the
   * chip's width on the one part nobody needs and pushing "Santa Comba (Calfensa)" into
   * an ellipsis.
   */
  const destinationOf = (line: BusLine) => {
    let end = line.name.split(' - ').pop()?.trim() ?? '';
    const numberSuffix = ` ${line.number}`;
    if (end.endsWith(numberSuffix)) end = end.slice(0, -numberSuffix.length).trim();
    const paren = end.indexOf(' (');
    return paren > 0 ? end.slice(0, paren) : end;
  };

  const t = translations(lang);

  useMapChrome(map ? mapContainerRef.current : null, {
    region: t.map.networkRegion,
    zoomIn: t.map.zoomIn,
    zoomOut: t.map.zoomOut,
  });

  // Initialize the Leaflet map once, then publish it to state so the layers can mount.
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const instance = L.map(container, {
      center: selectedStop ? [selectedStop.lat, selectedStop.lng] : LUGO_CENTER,
      zoom: selectedStop ? 16 : 14,
      zoomControl: false,
      // Stops and routes are vector layers; one canvas beats hundreds of SVG/DOM nodes.
      preferCanvas: true,
      // This used to come from the tile layer's own maxZoom; the basemap layer has none
      // to give, so without it here the map would zoom past where there is any data.
      maxZoom: 19,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(instance);

    /**
     * Drop Leaflet's own "Leaflet" prefix.
     *
     * Nobody is owed it: the terms that bind this map are OpenFreeMap's, OpenMapTiles'
     * and OpenStreetMap's, and all three stay exactly as they are. The prefix is what
     * made the line too long — measured on a 375 px screen it wrapped to two lines,
     * 34 px tall, and the second line was cut off by the tab bar below the map while
     * the first sat under the locate button. An attribution that is covered is not a
     * visible attribution, so the shortest honest line is also the compliant one.
     */
    instance.attributionControl?.setPrefix(false);

    tilesRef.current = createBasemap(isDark).addTo(instance) as BasemapLayer;

    setMap(instance);

    // The container is often still 0px tall on the first paint (tab switch, flex layout),
    // which is what leaves the tiles offset. One observer covers every case a timer would.
    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => instance.invalidateSize())
        : null;
    resizeObserver?.observe(container);

    return () => {
      resizeObserver?.disconnect();
      instance.remove();
      setMap(null);
    };
  }, []);

  // Swap the basemap when the theme changes. The layer restyles in place, so the view
  // stays where the reader left it instead of snapping back to Lugo centre.
  useEffect(() => {
    tilesRef.current?.setBasemapTheme(isDark);
  }, [isDark]);

  // Sync selectedLine prop into activeLineId & zoom into line
  useEffect(() => {
    if (focus === 'stop') return;
    if (selectedLine) {
      setActiveLineId(selectedLine.id);
      setFilterPreset('all');

      if (map && selectedLine.directions[0]?.pathCoordinates?.length) {
        const poly = L.polyline(selectedLine.directions[0].pathCoordinates);
        const bounds = poly.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
        }
      }
    }
  }, [selectedLine, map, focus]);

  // Centre on the stop the reader asked for — and drop the line filter, or the stop
  // arrives on a map showing somebody else's route and possibly not showing it at all.
  useEffect(() => {
    if (selectedStop && map) {
      if (focus === 'stop') {
        setActiveLineId('all');
        setFilterPreset('all');
        setLinesHereStop(null);
      }
      map.setView([selectedStop.lat, selectedStop.lng], 16, { animate: true });
      map.invalidateSize();
    }
  }, [selectedStop, map, focus]);

  // Periodic vehicle update
  useEffect(() => {
    const update = () => {
      setScheduledBuses(getScheduledBuses());
    };
    update();
    const interval = setInterval(update, 3000);
    return () => clearInterval(interval);
  }, []);

  // Locate user GPS position
  /** Stop following, and take the dot and its circle off the map. */
  const stopFollowing = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (map) {
      if (userMarkerRef.current) map.removeLayer(userMarkerRef.current);
      if (accuracyRef.current) map.removeLayer(accuracyRef.current);
    }
    userMarkerRef.current = null;
    accuracyRef.current = null;
    lastFixRef.current = null;
    setIsFollowing(false);
  }, [map]);

  /**
   * Follow the phone, rather than photograph it once.
   *
   * This used to be `getCurrentPosition`: one reading, a dot dropped where you were at
   * that moment, and it never moved again. Walk two hundred metres towards the stop and
   * the map still showed you where you started — on the one screen whose job is telling
   * you whether you will make it. `watchPosition` keeps it honest, and pressing the
   * button again stops it, because a watch nobody turned off is a radio nobody turned off.
   */
  const handleLocateUser = () => {
    if (isFollowing) {
      stopFollowing();
      return;
    }
    if (!navigator.geolocation) {
      setLocationError(t.map.geolocationUnavailable);
      return;
    }

    setIsLocating(true);
    setLocationError(null);
    let centred = false;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setIsLocating(false);
        setIsFollowing(true);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accuracy = Math.max(pos.coords.accuracy ?? 0, 0);

        // The same courtesy the saved-stops screen learned: outside the network there is
        // nothing to look at, so do not fly to another province to show an empty map.
        if (!getNearbyStops(lat, lng).some((s) => s.walkMeters <= NEARBY_STOP_LIMIT_METRES)) {
          stopFollowing();
          setLocationError(t.map.outOfArea);
          return;
        }

        if (map) {
          // Centre on the first fix, then leave the map where the reader put it — one
          // that recentres every few seconds cannot be panned, and panning is how you
          // look at the stop you are walking towards. The exception is walking off the
          // edge: losing your own dot is worse than a map that moved.
          if (!centred) {
            map.setView([lat, lng], 16, { animate: true });
            centred = true;
          } else if (!map.getBounds().pad(-0.15).contains([lat, lng])) {
            map.panTo([lat, lng], { animate: true });
          }

          if (accuracyRef.current) {
            accuracyRef.current.setLatLng([lat, lng]).setRadius(accuracy);
          } else {
            accuracyRef.current = L.circle([lat, lng], {
              radius: accuracy,
              color: colors.userStroke,
              fillColor: colors.userFill,
              weight: 1,
              opacity: 0.35,
              fillOpacity: 0.12,
              interactive: false,
            }).addTo(map);
          }

          if (userMarkerRef.current) {
            userMarkerRef.current.setLatLng([lat, lng]);
          } else {
            userMarkerRef.current = L.circleMarker([lat, lng], {
              radius: 8,
              fillColor: colors.userFill,
              color: colors.userStroke,
              weight: 3,
              opacity: 1,
              fillOpacity: 0.95,
            }).addTo(map);
          }
          userMarkerRef.current.bindPopup(t.map.yourPositionAccurate(Math.round(accuracy)));
        }

        // Recomputing the nearby list on every tick would redo it for a metre of drift.
        // Fifty metres is about when a different stop starts being the closest one.
        const moved =
          !lastFixRef.current ||
          getDistanceMeters(lastFixRef.current[0], lastFixRef.current[1], lat, lng) > 50;
        if (moved) {
          lastFixRef.current = [lat, lng];
          setNearbyLinesList(getNearbyLines(lat, lng, NEARBY_RADIUS_M));
          setFilterPreset('nearby');
          // Show them all. Picking nearby[0] made "preto de min" display a single line
          // and hide the other seven you could equally walk to.
          setActiveLineId('all');
        }
      },
      () => {
        // Refused or unavailable. This used to fall back to the centre of Lugo and then
        // show "lines near me" measured from there — distances from a place the phone
        // never reported, presented as if they were the reader's. Say what happened
        // instead; the same fallback was removed from the saved-stops screen.
        stopFollowing();
        setIsLocating(false);
        setLocationError(t.map.locationDenied);
      },
      { timeout: 8000, enableHighAccuracy: true, maximumAge: 5000 },
    );
  };

  // A watch outlives the screen unless somebody stops it, and this one is reading the GPS.
  useEffect(() => stopFollowing, [stopFollowing]);

  const handleCenterLugo = () => {
    map?.setView(LUGO_CENTER, 14, { animate: true });
  };

  const handleSelectLine = (line: BusLine) => {
    setActiveLineId(line.id);
    onSelectLine(line);
    // Asking for a line is asking to see it. The map opens with no trazados drawn, so
    // without this the first pick would frame the route and then draw nothing in it.
    setShowRoutes(true);
    // And asking to see it is asking for whatever is covering the map to get out of the
    // way of it — the sheet, and the unfolded grid of chips.
    setSheetOpen(false);
    setLinesExpanded(false);

    if (map && line.directions[0]?.pathCoordinates?.length) {
      const bounds = L.polyline(line.directions[0].pathCoordinates).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      }
    }
  };

  const handlePresetFilter = (preset: 'all' | 'nearby' | 'stop' | 'hula' | 'campus' | 'ceao') => {
    setFilterPreset(preset);
    // Every one of these moves or redraws the map, which is behind the sheet.
    setSheetOpen(false);
    if (preset !== 'stop') setLinesHereStop(null);
    if (preset === 'all') {
      setActiveLineId('all');
    } else if (preset === 'hula' || preset === 'campus' || preset === 'ceao') {
      // Frame the area and keep every line that reaches it, instead of silently
      // pinning the map to one hardcoded line ('campus' and 'ceao' both used 1.1).
      const [lat, lng] = PRESET_CENTERS[preset];
      setActiveLineId('all');
      map?.setView([lat, lng], 15, { animate: true });
    } else if (preset === 'nearby') {
      setActiveLineId('all');
      if (!nearbyLinesList.length) handleLocateUser();
    }
  };

  /**
   * Open on the lines that pass near you — but only for someone who has already agreed
   * to be located.
   *
   * The map used to open with all twenty-four routes over the city, which is a picture of
   * string; it now opens with none, which is quiet but tells you nothing. What was agreed
   * is neither: the lines near you, with the rest added when you ask for them.
   *
   * The catch is that "near you" needs the GPS, and asking for it the instant a screen
   * loads is the permission prompt everybody refuses on reflex — and refusing it here
   * would cost the locate button too, for the whole origin. So the Permissions API is
   * asked first, and this only runs on `granted`: a reader who has already said yes, on
   * this site, gets the map they agreed to. Everybody else gets the quiet one and an
   * obvious button. `prompt` and `denied` both mean "do not ask now".
   *
   * Once per page load, not once per mount, and the difference is the whole rule. This
   * is about how the screen *opens*; coming back to it after choosing a line must not
   * throw that choice away. The first attempt guarded on `selectedLine` being unset
   * instead, which never fires at all: the app starts with the first line selected, so
   * that condition is true on the coldest of opens and the whole thing was dead code.
   * Testing found that; the compiler could not.
   */
  const drawNearbyWhenReady = useRef(false);
  useEffect(() => {
    if (openedOnNearby || !navigator.geolocation || !navigator.permissions?.query) return;
    openedOnNearby = true;
    let cancelled = false;
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (cancelled || status.state !== 'granted') return;
        drawNearbyWhenReady.current = true;
        handlePresetFilter('nearby');
      })
      // Firefox once threw for an unknown descriptor rather than resolving. A map that
      // opens quiet is the fallback, which is exactly what happens if this never runs.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Once, on mount: this is about how the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Draw them, once there is actually something to draw.
   *
   * Turning the trazados on at the same time as asking for the fix would draw all
   * twenty-four for as long as the GPS took to answer — and for good, if it answered from
   * outside Lugo, where the nearby list comes back empty and the scope falls back to every
   * line. So routes wait for the list.
   */
  useEffect(() => {
    if (!drawNearbyWhenReady.current) return;
    if (filterPreset === 'nearby' && nearbyLinesList.length) {
      setShowRoutes(true);
      drawNearbyWhenReady.current = false;
    }
  }, [filterPreset, nearbyLinesList.length]);

  return (
    /* No page padding on a phone: the map is the screen there, edge to edge. The padded
       page comes back at `sm`, where the two-column layout starts to make sense. */
    <div className="max-w-7xl mx-auto px-0 py-0 sm:px-6 sm:py-5 lg:px-8">
      {/* 2-Column Responsive Layout: Options on Left, Map on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* The scrim, so it is obvious the map is behind and not gone, and so tapping
            anywhere off the sheet closes it. A button and not a div: closing is an action,
            and this is the target most people reach for first. */}
        {sheetOpen && (
          <button
            type="button"
            aria-label={t.map.closeControls}
            onClick={() => setSheetOpen(false)}
            className="fixed inset-0 z-[500] bg-scrim lg:hidden"
          />
        )}

        {/* Left Column: Controls & Filters (Geometric Balance Sidebar).
            A sheet over the map below `lg`, an ordinary sidebar from `lg` up — one set of
            markup, because two would drift apart the first time either was edited.
            `invisible` when closed and not merely translated off: a panel parked below the
            fold still takes keyboard focus, so tabbing would walk into a list of
            twenty-four lines nobody can see. */}
        <div
          ref={sheetRef}
          role={sheetOpen ? 'dialog' : undefined}
          aria-modal={sheetOpen ? true : undefined}
          aria-label={sheetOpen ? t.map.controls : undefined}
          className={`order-2 flex flex-col gap-3.5 lg:order-none lg:col-span-4 fixed inset-x-0 bottom-0 z-[510] max-h-[78dvh] overflow-y-auto rounded-t-2xl border-t border-edge bg-surface p-3.5 shadow-2xl transition-transform duration-200 motion-reduce:transition-none lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:visible lg:translate-y-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none ${
            sheetOpen ? 'translate-y-0' : 'invisible translate-y-full'
          }`}
        >
          {/* The handle. It says which way the sheet goes and gives the sheet its own way
              out, for anyone who does not think to tap the map behind it. Gone at `lg`,
              where the sheet is a column and closing it means nothing. */}
          {/* `order-first` as well, because the quick-filters panel below carries it and
              would otherwise sit above the sheet's own title and close button. Two
              children with the same order fall back to document order, and this one is
              written first. */}
          <div className="order-first -mt-1 flex items-center justify-between gap-2 lg:hidden">
            <span className="text-label font-bold uppercase tracking-widest text-ink-3">
              {t.map.controls}
            </span>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              aria-label={t.map.closeControls}
              className="flex h-11 w-11 items-center justify-center rounded-full text-ink-2"
            >
              <ChevronDown className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Header Card with Telemetry */}
          <div className="bg-bg rounded-xl p-4 shadow-sm border border-edge">
            <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-line">
              <div>
                <h2 className="font-bold text-ink text-body uppercase tracking-wider flex items-center gap-1.5">
                  <Navigation className="w-4 h-4 text-accent" />
                  {t.map.mapTitle}
                </h2>
                <p className="text-label text-ink-3 font-medium">{t.map.subtitle}</p>
              </div>

              <div className="text-right">
                <span className="flex items-center gap-1 text-label font-black text-estimated">
                  <Bus className="w-3.5 h-3.5 text-estimated" aria-hidden="true" />
                  {liveBuses.length} {t.map.liveBusesCount}
                </span>
                <span className="text-label text-ink-3 font-medium">
                  {t.map.stopsCount(stops.length, stopsWithQr)}
                </span>
              </div>
            </div>

            {/* Quick Action Location Buttons */}
            <div className="grid grid-cols-2 gap-2 mt-2.5">
              <button
                id="btn-map-locate"
                onClick={handleLocateUser}
                disabled={isLocating}
                aria-pressed={isFollowing}
                className={`flex h-11 items-center justify-center gap-1.5 rounded-[9px] px-3.5 text-label font-bold shadow-xs transition-colors disabled:opacity-50 ${
                  isFollowing ? 'bg-surface text-ink border border-accent' : 'bg-accent text-on-accent'
                }`}
              >
                <LocateFixed className="w-3.5 h-3.5" />
                {/* Three states, because it is a switch now and not a one-shot: asking,
                    following — where pressing again turns the GPS off — and idle. */}
                <span>
                  {isLocating ? t.map.locating : isFollowing ? t.map.stopFollowing : t.map.myLocation}
                </span>
              </button>

              <button
                id="btn-map-center"
                onClick={handleCenterLugo}
                className="flex h-11 items-center justify-center gap-1.5 rounded-[9px] px-3.5 bg-surface text-label font-bold text-ink-2 border border-edge transition-colors"
              >
                {t.map.centerLugo}
              </button>
            </div>
            {locationError && (
              <p role="alert" className="mt-2 text-label leading-relaxed text-ink-2">
                {locationError}
              </p>
            )}
          </div>

          {/* Filter Presets Panel. First of the panels on a phone, so the map has its
              own controls directly under it rather than past the telemetry card. */}
          <div className="order-first bg-bg rounded-xl p-3.5 shadow-sm border border-edge lg:order-none">
            <span className="text-label font-bold text-ink-3 uppercase tracking-widest block mb-2">
              {t.map.quickFilters}
            </span>
            {/* One scrolling row, not a three-row grid.
                Five 44 px buttons stacked two across took about 150 px out of a sheet
                whose entire job is to not cover the map; the row does the same work in
                44. It is also the shape the reader has already met once — the line chips
                over the map scroll exactly like this — rather than a second, different
                arrangement of the same idea. Five near-identical button blocks collapse
                into the list they always were. */}
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
              {(
                [
                  ['all', t.map.allLines],
                  ['nearby', t.map.nearbyFilter],
                  ['hula', t.map.filterHula],
                  ['campus', t.map.filterCampus],
                  ['ceao', t.map.filterCeao],
                ] as const
              ).map(([preset, label]) => (
                <button
                  key={preset}
                  onClick={() => handlePresetFilter(preset)}
                  aria-pressed={filterPreset === preset}
                  className={`shrink-0 whitespace-nowrap ${presetButtonClass(filterPreset === preset)}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {filterPreset === 'stop' && linesHereStop && (
              <div className="mt-2.5 rounded-[10px] border border-accent bg-accent/10 p-3">
                <p className="text-label leading-relaxed text-ink">
                  {t.map.aroundStopActive(linesHereStop.name, AROUND_STOP_RADIUS_M)}
                </p>
                <button
                  onClick={() => handlePresetFilter('all')}
                  className="mt-2 flex h-9 items-center rounded-[8px] border border-edge bg-bg px-3 text-label font-semibold text-ink-2"
                >
                  {t.map.aroundStopClear}
                </button>
              </div>
            )}
          </div>

          {/* Which lines are actually within walking distance. This was computed and
              then thrown away, so "preto de min" gave no way to see what was nearby. */}
          {filterPreset === 'nearby' && nearbyLinesList.length > 0 && (
            <div className="bg-bg rounded-xl p-3.5 shadow-sm border border-edge">
              <span className="text-label font-bold text-ink-3 uppercase tracking-widest block mb-2">
                {t.map.nearbyTitle(NEARBY_RADIUS_M)}
              </span>
              <div className="space-y-1 max-h-[150px] overflow-y-auto pr-1">
                {nearbyLinesList.map(({ line, nearestStop, walkMeters }) => (
                  <button
                    key={line.id}
                    onClick={() => handleSelectLine(line)}
                    className="w-full p-2 rounded-md text-left flex items-center gap-2 text-label bg-surface border border-line hover:bg-surface transition-colors"
                  >
                    <span
                      className="w-6 h-6 rounded flex items-center justify-center text-label font-black text-white shrink-0"
                      style={{ backgroundColor: line.color }}
                    >
                      {line.number}
                    </span>
                    <span title={nearestStop.name} className="truncate flex-1 text-ink-2">
                      {nearestStop.name}
                    </span>
                    <span className="tnum shrink-0 font-semibold text-ink-3">~{walkMeters} m</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Layer Toggles */}
          <div className="bg-bg rounded-xl p-3.5 shadow-sm border border-edge">
            <span className="text-label font-bold text-ink-3 uppercase tracking-widest block mb-2">
              {t.map.layers}
            </span>
            <div className="grid grid-cols-3 gap-1 bg-surface p-1 rounded-md text-label">
              <button
                onClick={() => setShowStops(!showStops)}
                aria-pressed={showStops}
                className={`h-11 rounded-[9px] font-semibold flex items-center justify-center gap-1 transition-all ${
                  showStops ? 'bg-bg text-ink shadow-xs' : 'text-ink-3'
                }`}
              >
                <MapPin className="w-3 h-3 text-accent" />
                <span>{t.map.layerStops}</span>
              </button>

              <button
                onClick={() => setShowBuses(!showBuses)}
                aria-pressed={showBuses}
                className={`h-11 rounded-[9px] font-semibold flex items-center justify-center gap-1 transition-all ${
                  showBuses ? 'bg-bg text-ink shadow-xs' : 'text-ink-3'
                }`}
              >
                <Bus className="w-3 h-3 text-estimated" />
                <span>{t.map.layerBuses}</span>
              </button>

              <button
                onClick={() => setShowRoutes(!showRoutes)}
                aria-pressed={showRoutes}
                className={`h-11 rounded-[9px] font-semibold flex items-center justify-center gap-1 transition-all ${
                  showRoutes ? 'bg-bg text-ink shadow-xs' : 'text-ink-3'
                }`}
              >
                <Layers className="w-3 h-3 text-accent" />
                <span>{t.map.layerRoutes}</span>
              </button>
            </div>
          </div>

          {/* Lines Selector List */}
          <div className="bg-bg rounded-xl p-3.5 shadow-sm border border-edge">
            <div className="flex items-center justify-between mb-2">
              <span className="text-label font-bold text-ink-3 uppercase tracking-widest">
                {t.map.linesList}
              </span>
              <button
                onClick={() => {
                  setActiveLineId('all');
                  setFilterPreset('all');
                }}
                aria-pressed={activeLineId === 'all'}
                className={`flex h-11 min-w-11 items-center justify-center rounded-[9px] px-3 text-label font-semibold ${
                  activeLineId === 'all'
                    ? 'bg-surface text-accent'
                    : 'text-ink-3 hover:text-ink'
                }`}
              >
                {t.map.allLines}
              </button>
            </div>

            <div className="space-y-1 max-h-[175px] overflow-y-auto pr-1">
              {listedLines.map((line) => {
                const isSelected = activeLineId === line.id;
                return (
                  <div
                    key={line.id}
                    className={`flex items-stretch gap-1 rounded-[9px] text-label transition-all border ${
                      isSelected
                        ? 'bg-surface border-accent font-bold shadow-xs'
                        : 'bg-surface border-line text-ink-2'
                    }`}
                  >
                    {/* Drawing the route and reading the timetable are two different
                        errands. The row did the first and the arrow only looked like it
                        offered the second. */}
                    <button
                      onClick={() => handleSelectLine(line)}
                      aria-pressed={isSelected}
                      className="flex min-h-11 flex-1 items-center gap-2 truncate p-2.5 text-left"
                    >
                      <span
                        className="w-6 h-6 rounded flex items-center justify-center text-label font-black text-white shrink-0"
                        style={{ backgroundColor: line.color }}
                      >
                        {line.number}
                      </span>
                      <span className="truncate" title={line.name}>
                        {line.name}
                      </span>
                    </button>

                    <button
                      onClick={() => onOpenLine(line)}
                      title={t.map.openLineInfo}
                      aria-label={`${t.map.openLineInfo}: ${line.number}`}
                      className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-r-[8px]"
                    >
                      <ChevronRight
                        className={`w-4 h-4 shrink-0 ${isSelected ? 'text-accent' : 'text-ink-3'}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Interactive Map Canvas */}
        <div className="order-1 lg:order-none lg:col-span-8">
          {/* The map is the screen on a phone.
              It used to be a 62vh card with a filter row peeking underneath, which meant
              the tab called "Mapa" showed rather less than half a map, and the half it
              showed was in a rounded box with a border and a shadow — three devices that
              say "this is one object among several on a page". It is not: it is the page.
              Everything else on this screen floats over it or waits below the fold.
              `dvh` and not `vh` so a phone's collapsing address bar does not cut it, with
              a `vh` line first for anything too old to know the unit. The card, the
              border and the fixed height all come back at `lg`, where there is room for
              a genuine two-column layout. */}
          <div className="h-map-viewport relative z-0 w-full overflow-hidden bg-surface sm:rounded-xl sm:border sm:border-edge sm:shadow-sm">
            <div ref={mapContainerRef} className="w-full h-full" />

            {/* Route, Stop, and Vehicle Layers */}
            <RouteLayer
              map={geometryReady ? map : null}
              /* The scope, not the one line picked out of it. Choosing a line used to
                 leave the map holding a single route and nothing else, which answers
                 "where does the 6 go" and destroys the answer to "and where does that
                 leave me". The layer keeps the rest faint underneath and paints the
                 chosen one over them. The stops still narrow to `visibleLineIds`: a
                 backdrop of routes is context, 417 dots is clutter. */
              visibleLineIds={scopeLineIds}
              emphasisLineId={activeLineId !== 'all' ? activeLineId : null}
              lines={lines}
              showRoutes={showRoutes}
              lang={lang}
              onSelectLine={(line) => {
                onSelectLine(line);
                setActiveLineId(line.id);
              }}
              onOpenLine={onOpenLine}
            />

            <StopLayer
              map={map}
              visibleLineIds={visibleLineIds}
              stops={stops}
              lines={lines}
              selectedStop={selectedStop}
              showStops={showStops}
              onTapStop={setTappedStop}
              lang={lang}
            />

            {/* The stop, opened where it was tapped, with the map still behind it. */}
            {tappedStop && (
              <StopSheet
                stop={tappedStop}
                lines={lines}
                lang={lang}
                onClose={() => setTappedStop(null)}
                onOpenLine={(line) => {
                  setTappedStop(null);
                  onOpenLine(line);
                }}
                onShowLinesHere={(stop) => {
                  setTappedStop(null);
                  showLinesHere(stop);
                }}
                onOpenFullBoard={(stop) => {
                  setTappedStop(null);
                  onSelectStop(stop);
                }}
              />
            )}

            <VehicleLayer
              map={geometryReady ? map : null}
              visibleLineIds={visibleLineIds}
              buses={liveBuses}
              showBuses={showBuses}
              lang={lang}
              onOpenLine={(lineId) => {
                const line = lines.find((l) => l.id === lineId);
                if (line) onOpenLine(line);
              }}
            />

            {/* The map is the whole screen on a phone now, and that put every control in
                the column below it a full viewport out of reach. Two of them cannot wait
                that long: which line you are looking at, and where you are standing. They
                ride over the map below `lg` and hand back to the sidebar above it.

                This corner is where the legend used to float, and the legend is not
                coming back: it named stops, buses and trazados, which is exactly what the
                three layer buttons in the sidebar already name, each with its own icon in
                its own colour. A second copy of those three words, sitting on top of the
                map and covering it, was the redundant one. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[400] lg:hidden">
              <div
                className={`no-scrollbar flex gap-1.5 px-3 py-2.5 ${
                  linesExpanded ? 'max-h-[45dvh] flex-wrap overflow-y-auto' : 'overflow-x-auto'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handlePresetFilter('all')}
                  aria-pressed={activeLineId === 'all'}
                  className={`pointer-events-auto flex h-11 shrink-0 items-center rounded-full border px-4 text-label font-semibold shadow-sm backdrop-blur-xs ${
                    activeLineId === 'all'
                      ? 'border-accent bg-accent text-on-accent'
                      : 'border-edge bg-bg/95 text-ink-2'
                  }`}
                >
                  {t.map.allLines}
                </button>

                {/* Second, not last. At the end of a row that scrolls, the control for
                    "stop making me scroll" is itself only reachable by scrolling. */}
                <button
                  type="button"
                  onClick={() => setLinesExpanded((v) => !v)}
                  aria-expanded={linesExpanded}
                  aria-label={linesExpanded ? t.map.collapseLines : t.map.expandLines}
                  title={linesExpanded ? t.map.collapseLines : t.map.expandLines}
                  className="pointer-events-auto flex h-11 shrink-0 items-center gap-1 rounded-full border border-edge bg-bg/95 px-3.5 text-label font-bold text-ink-2 shadow-sm backdrop-blur-xs"
                >
                  <span className="tnum">{listedLines.length}</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform motion-reduce:transition-none ${
                      linesExpanded ? 'rotate-180' : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>

                {/* The number is the chip. A line's colour is how it is drawn on the map
                    and printed on the pole, so a coloured badge is the shortest thing that
                    still says which line it is — and twenty-four of them scroll in a strip
                    where twenty-four names would not fit at all. The name goes to the
                    accessible name, since the badge alone reads as a bare number. */}
                {listedLines.map((line) => {
                  const isSelected = activeLineId === line.id;
                  // Only where the number cannot stand alone, so twenty of the chips stay
                  // the width of their number and only the four 11s pay for the ambiguity.
                  const branch = sharedNumbers.has(line.number) ? destinationOf(line) : '';
                  return (
                    <button
                      key={line.id}
                      type="button"
                      onClick={() => handleSelectLine(line)}
                      aria-pressed={isSelected}
                      aria-label={line.name}
                      title={line.name}
                      className={`pointer-events-auto flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-label font-black text-white shadow-sm ${
                        isSelected ? 'ring-2 ring-ink ring-offset-2 ring-offset-bg' : ''
                      }`}
                      style={{ backgroundColor: line.color }}
                    >
                      <span>{line.number}</span>
                      {branch && (
                        <span className="max-w-28 truncate font-semibold opacity-90">{branch}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Orientation is the one thing a map owes you before anything else, and on a
                phone it is one thumb's reach from the bottom corner. Left, because the
                zoom control has the right one. No `id` here: the sidebar's own locate
                button keeps `btn-map-locate`, and both are in the DOM at once. */}
            <button
              type="button"
              onClick={handleLocateUser}
              disabled={isLocating}
              aria-pressed={isFollowing}
              aria-label={
                isLocating ? t.map.locating : isFollowing ? t.map.stopFollowing : t.map.myLocation
              }
              title={
                isLocating ? t.map.locating : isFollowing ? t.map.stopFollowing : t.map.myLocation
              }
              className={`pointer-events-auto absolute bottom-5 left-3 z-[400] flex h-12 w-12 items-center justify-center rounded-full border shadow-md backdrop-blur-xs disabled:opacity-50 lg:hidden ${
                isFollowing ? 'border-accent bg-bg/95 text-accent' : 'border-edge bg-bg/95 text-ink-2'
              }`}
            >
              <LocateFixed className="h-5 w-5" aria-hidden="true" />
            </button>

            {/* The way to everything the sidebar holds — the quick filters, the layer
                switches, the whole line list, the telemetry — without leaving the map.
                Centre-bottom, because the two corners are already taken by locate and
                zoom, and because it is the widest target of the three and this is the one
                with a word on it. */}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-expanded={sheetOpen}
              className="pointer-events-auto absolute bottom-5 left-1/2 z-[400] flex h-12 -translate-x-1/2 items-center gap-2 rounded-full border border-edge bg-bg/95 px-4 text-label font-bold text-ink shadow-md backdrop-blur-xs lg:hidden"
            >
              <SlidersHorizontal className="h-4 w-4 text-accent" aria-hidden="true" />
              {t.map.controls}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
