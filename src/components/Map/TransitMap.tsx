import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { LocateFixed, SlidersHorizontal } from 'lucide-react';
import { useT } from '../../i18n';
import { BusStop, BusLine } from '../../types';
import { BUS_STOPS, BUS_LINES, LUGO_CENTER, lineById, poleCode } from '../../data/transitData';
import { getScheduledBuses } from '../../utils/vehicles';
import { getNearbyLines, NearbyLine } from '../../utils/places';
import { useIsDark } from '../../hooks/useIsDark';
import { useDialog } from '../../hooks/useDialog';
import { useLeafletMap } from '../../hooks/useLeafletMap';
import { useClock } from '../../hooks/useClock';
import { useRouteGeometry } from '../../data/routeGeometry';
import { mapColors } from './palette';
import { RouteLayer } from './RouteLayer';
import { StopLayer } from './StopLayer';
import { StopSheet } from './StopSheet';
import { VehicleLayer } from './VehicleLayer';
import { LineChips } from './LineChips';
import { AROUND_STOP_RADIUS_M, MapControls, NEARBY_RADIUS_M, type Layer, type Preset } from './MapControls';
import { useFollowMe } from './useFollowMe';

/**
 * How many of the nearby lines the map draws: the network converges on the muralla, so
 * from the centre 23 of the 24 lines are within 750 m and no radius can separate them. The
 * list arrives sorted by walk, so the first six are the six you could actually catch.
 */
const NEARBY_SCOPE_LIMIT = 6;

/** Whether this page load has already decided how the map opens. */
let openedOnNearby = false;

/** Each shortcut's centre is where the buses stop: HULA's own main-entrance stop, not a field near the hospital. */
const PRESET_CENTERS: Partial<Record<Preset, [number, number]>> = {
  hula: [43.01965, -7.53274],
  campus: [42.9935, -7.5538],
  ceao: [43.044, -7.5692],
};

const fitLines = (map: L.Map, ids: string[]) => {
  const bounds = L.latLngBounds([]);
  for (const id of ids) for (const direction of lineById(id)?.directions ?? []) for (const point of direction.pathCoordinates ?? []) bounds.extend(point);
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
};

interface TransitMapProps {
  selectedStop?: BusStop;
  /** What the reader asked to see, so the map does not have to guess between the two. */
  focus?: 'stop' | 'line';
  selectedLine?: BusLine | null;
  onSelectStop: (stop: BusStop) => void;
  onSelectLine: (line: BusLine) => void;
  /** Leave the map for a line's own page. Selecting a line only filters the map. */
  onOpenLine: (line: BusLine) => void;
}

export function TransitMap({ selectedStop, focus = 'line', selectedLine, onSelectStop, onSelectLine, onOpenLine }: TransitMapProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const colors = mapColors(useIsDark());
  const map = useLeafletMap(containerRef, {
    center: selectedStop ? [selectedStop.lat, selectedStop.lng] : LUGO_CENTER,
    zoom: selectedStop ? 16 : 14,
    region: t.map.networkRegion,
  });
  // Street geometry arrives as its own chunk; until then the stop layer still works.
  const geometryReady = useRouteGeometry();

  /** The lines the reader has picked out (toggled, so two can be compared), or none for "everything in scope". */
  const [pickedLineIds, setPickedLineIds] = useState<string[]>(selectedLine ? [selectedLine.id] : []);
  const [preset, setPreset] = useState<Preset>('all');
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ stops: true, buses: true, routes: true });
  const now = useClock(3000);
  const buses = useMemo(() => getScheduledBuses(now), [now]);
  const [nearbyLines, setNearbyLines] = useState<NearbyLine[]>([]);
  /** The stop whose neighbourhood is on show — the one whose sheet asked, not whichever screen selected one. */
  const [aroundStop, setAroundStop] = useState<BusStop | null>(null);
  /** The stop whose board is open over the map. */
  const [tappedStop, setTappedStop] = useState<BusStop | null>(null);
  /** The controls pulled up over the map; only means anything below `lg`. */
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const sheetRef = useDialog(sheetOpen, closeSheet);

  const stopsWithQr = useMemo(() => BUS_STOPS.filter((s) => poleCode(s)).length, []);

  const drawNearbyWhenReady = useRef(false);
  const follow = useFollowMe(map, colors, (lat, lng) => {
    setNearbyLines(getNearbyLines(lat, lng, NEARBY_RADIUS_M));
    setPreset('nearby');
    setPickedLineIds([]);
    // If this fix is the one the screen opened on, the lines to draw exist only now.
    if (drawNearbyWhenReady.current) {
      drawNearbyWhenReady.current = false;
      setLayers((l) => ({ ...l, routes: true }));
    }
  });

  // What the current scope is about: every line, or the set a preset narrowed to.
  const aroundStopLineIds = useMemo(
    () => (aroundStop ? [...new Set([...aroundStop.lines, ...getNearbyLines(aroundStop.lat, aroundStop.lng, AROUND_STOP_RADIUS_M).map((n) => n.line.id)])] : []),
    [aroundStop],
  );
  // No count cap for a destination, unlike "near me": nine lines really do serve the hospital.
  const presetAreaLineIds = useMemo(() => {
    const centre = PRESET_CENTERS[preset];
    return centre ? getNearbyLines(centre[0], centre[1], NEARBY_RADIUS_M).map((n) => n.line.id) : [];
  }, [preset]);
  const scopeLineIds =
    preset === 'stop' && aroundStopLineIds.length ? aroundStopLineIds
    : preset === 'nearby' && nearbyLines.length ? nearbyLines.slice(0, NEARBY_SCOPE_LIMIT).map((n) => n.line.id)
    : presetAreaLineIds.length ? presetAreaLineIds
    : null;
  const visibleLineIds = pickedLineIds.length ? pickedLineIds : scopeLineIds;
  // The list has to agree with the map: offering all twenty-four while drawing four read as the filter doing nothing.
  const listedLines = scopeLineIds ? BUS_LINES.filter((l) => scopeLineIds.includes(l.id)) : BUS_LINES;


  // A line chosen somewhere else becomes the only one on the map; one picked here must not (onSelectLine reports every pick upward).
  useEffect(() => {
    if (focus === 'stop' || !selectedLine || pickedLineIds.includes(selectedLine.id)) return;
    setPickedLineIds([selectedLine.id]);
    setPreset('all');
    if (map) fitLines(map, [selectedLine.id]);
  }, [selectedLine, map, focus]);

  // Centre on the stop the reader asked for, and drop the line filter, or the stop arrives on somebody else's route.
  useEffect(() => {
    if (!selectedStop || !map) return;
    if (focus === 'stop') {
      setPickedLineIds([]);
      setPreset('all');
      setAroundStop(null);
    }
    map.setView([selectedStop.lat, selectedStop.lng], 16, { animate: true });
    map.invalidateSize();
  }, [selectedStop, map, focus]);

  const handleSelectLine = (line: BusLine) => {
    const adding = !pickedLineIds.includes(line.id);
    const next = adding ? [...pickedLineIds, line.id] : pickedLineIds.filter((id) => id !== line.id);
    setPickedLineIds(next);
    // Only a line taken up is reported: firing on a deselect made the sync effect put it straight back.
    if (adding) onSelectLine(line);
    // Asking for a line is asking to see it, and for whatever covers the map to get out of its way.
    setLayers((l) => ({ ...l, routes: true }));
    setSheetOpen(false);
    // Frame everything picked: two lines up is a comparison.
    if (map && next.length) fitLines(map, next);
  };

  const handlePreset = (next: Preset) => {
    setPreset(next);
    setSheetOpen(false); // every one of these moves or redraws the map, which is behind the sheet
    setPickedLineIds([]);
    if (next !== 'stop') setAroundStop(null);
    const centre = PRESET_CENTERS[next];
    if (centre) map?.setView(centre, 15, { animate: true });
    if (next === 'nearby' && !nearbyLines.length) follow.start();
  };

  /** From a stop's own sheet: keep the map, drop every line that does not serve it. */
  const showLinesHere = (stop: BusStop) => {
    setAroundStop(stop);
    setPreset('stop');
    setPickedLineIds([]);
    map?.setView([stop.lat, stop.lng], 15, { animate: true });
  };

  // Open on the lines near you — only for someone who has already agreed to be located,
  // since asking the instant a screen loads is the prompt everybody refuses. Once per page
  // load, not per mount: coming back after choosing a line must not throw that away.
  useEffect(() => {
    if (openedOnNearby || !navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        // Claimed on success: StrictMode mounts twice, and claiming up front made the second pass bail.
        if (openedOnNearby || status.state !== 'granted') return;
        openedOnNearby = true;
        drawNearbyWhenReady.current = true;
        handlePreset('nearby');
      })
      .catch(() => {}); // Firefox once threw for an unknown descriptor
  }, []);

  const locateLabel = follow.isLocating ? t.map.locating : follow.isFollowing ? t.map.stopFollowing : t.map.myLocation;

  return (
    // No page padding on a phone: the map is the screen there, edge to edge.
    <div className="h-full sm:h-auto max-w-7xl mx-auto px-0 py-0 sm:px-6 sm:py-5 lg:px-8">
      <div className="h-full sm:h-auto grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* The scrim: a button, because closing is an action and this is the target most people reach for first. */}
        {sheetOpen && <button type="button" aria-label={t.map.closeControls} onClick={closeSheet} className="fixed inset-0 z-[500] bg-scrim lg:hidden" />}

        <MapControls
          sheetRef={sheetRef}
          sheetOpen={sheetOpen}
          onCloseSheet={closeSheet}
          busCount={buses.length}
          stopCount={BUS_STOPS.length}
          stopsWithQr={stopsWithQr}
          locate={follow}
          onCenterLugo={() => map?.setView(LUGO_CENTER, 14, { animate: true })}
          preset={preset}
          onPreset={handlePreset}
          aroundStop={aroundStop}
          nearbyLines={nearbyLines}
          layers={layers}
          onToggleLayer={(layer) => setLayers((l) => ({ ...l, [layer]: !l[layer] }))}
          listedLines={listedLines}
          pickedLineIds={pickedLineIds}
          onSelectLine={handleSelectLine}
          onOpenLine={onOpenLine}
        />

        <div className="h-full sm:h-auto order-1 lg:order-none lg:col-span-8">
          {/* The map is the screen on a phone; the card, the border and the fixed height come back at `lg`. */}
          <div className="h-map-viewport relative z-0 w-full overflow-hidden bg-surface sm:rounded-card sm:border sm:border-edge sm:shadow-sm">
            <div ref={containerRef} className="w-full h-full" />

            {/* The scope, not the one line picked out of it: the layer keeps the rest faint underneath. The stops narrow to the pick: 417 dots is clutter. */}
            <RouteLayer
              map={geometryReady ? map : null}
              visibleLineIds={scopeLineIds}
              emphasisLineIds={pickedLineIds}
              lines={BUS_LINES}
              showRoutes={layers.routes}
              onSelectLine={(line) => {
                onSelectLine(line);
                setPickedLineIds((prev) => (prev.includes(line.id) ? prev.filter((x) => x !== line.id) : [...prev, line.id]));
              }}
              onOpenLine={onOpenLine}
            />
            {/* The big dot follows what the reader is looking at: the stop whose sheet is open, else the one whose board they came from. */}
            <StopLayer map={map} visibleLineIds={visibleLineIds} stops={BUS_STOPS} selectedStop={tappedStop ?? selectedStop} showStops={layers.stops} onTapStop={setTappedStop} />
            {tappedStop && (
              <StopSheet
                stop={tappedStop}
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
              buses={buses}
              showBuses={layers.buses}
              onOpenLine={(lineId) => {
                const line = lineById(lineId);
                if (line) onOpenLine(line);
              }}
            />

            {/* Two controls cannot wait a viewport away on a phone: which line, and where you are. They ride over the map below `lg`. */}
            <LineChips listed={listedLines} picked={pickedLineIds} onToggle={handleSelectLine} onAll={() => handlePreset('all')} />

            {/* Orientation, one thumb's reach from the bottom corner; the zoom control has the other. */}
            <button
              type="button"
              onClick={follow.toggle}
              disabled={follow.isLocating}
              aria-pressed={follow.isFollowing}
              aria-label={locateLabel}
              title={locateLabel}
              className={`pointer-events-auto absolute bottom-5 left-3 z-[400] flex h-12 w-12 items-center justify-center rounded-full border shadow-md backdrop-blur-xs disabled:opacity-50 lg:hidden ${
                follow.isFollowing ? 'border-accent bg-bg/95 text-accent' : 'border-edge bg-bg/95 text-ink-2'
              }`}
            >
              <LocateFixed className="h-5 w-5" aria-hidden="true" />
            </button>
            {/* The way to everything the sidebar holds, without leaving the map. */}
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
}
