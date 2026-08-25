import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Lang, translations } from '../../i18n';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Bus, MapPin, Navigation, Layers, Radio, LocateFixed, ChevronRight } from 'lucide-react';
import { BusStop, BusLine, ScheduledBus } from '../../types';
import { BUS_STOPS, BUS_LINES, LUGO_CENTER, poleCode } from '../../data/transitData';
import { getScheduledBuses, getNearbyLines } from '../../utils/transitEngine';

/** Matches the stop board: what somebody standing there could reasonably walk to. */
const AROUND_STOP_RADIUS_M = 400;
import { useIsDark } from '../../hooks/useIsDark';
import { useMapChrome } from '../../hooks/useMapChrome';
import { mapColors, TILE_ATTRIBUTION } from './palette';
import { useRouteGeometry } from '../../data/routeGeometry';
import { RouteLayer } from './RouteLayer';
import { StopLayer } from './StopLayer';
import { VehicleLayer } from './VehicleLayer';

/** How far someone will walk to a different line. Also used by the nearby-lines panel. */
const NEARBY_RADIUS_M = 750;

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
  const tilesRef = useRef<L.TileLayer | null>(null);
  const isDark = useIsDark();
  const colors = mapColors(isDark);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);

  const [activeLineId, setActiveLineId] = useState<string>(selectedLine?.id || 'all');
  const [filterPreset, setFilterPreset] = useState<
    'all' | 'nearby' | 'stop' | 'hula' | 'campus' | 'ceao'
  >('all');
  const [showStops, setShowStops] = useState(true);
  const [showBuses, setShowBuses] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [liveBuses, setScheduledBuses] = useState<ScheduledBus[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [nearbyLinesList, setNearbyLinesList] = useState<{ line: BusLine; nearestStop: BusStop; walkMeters: number }[]>([]);
  const [isLocating, setIsLocating] = useState(false);

  const stops = BUS_STOPS;
  /**
   * Only the poles the operator actually publishes a QR token for.
   *
   * This line read "429 paradas con QR" — the whole network — while 158 of those
   * stops have no token at all and show no code anywhere else in the app. The count
   * has to match the claim.
   */
  const stopsWithQr = useMemo(() => BUS_STOPS.filter((s) => poleCode(s)).length, []);

  // One line selected wins; otherwise "nearby" narrows to the walkable set; otherwise all.
  const aroundStopLineIds = useMemo(
    () =>
      selectedStop
        ? [
            ...new Set([
              ...selectedStop.lines,
              ...getNearbyLines(selectedStop.lat, selectedStop.lng, AROUND_STOP_RADIUS_M).map(
                (n) => n.line.id,
              ),
            ]),
          ]
        : [],
    [selectedStop],
  );

  const visibleLineIds =
    activeLineId !== 'all'
      ? [activeLineId]
      : filterPreset === 'stop' && aroundStopLineIds.length
        ? aroundStopLineIds
        : filterPreset === 'nearby' && nearbyLinesList.length
          ? nearbyLinesList.map((n) => n.line.id)
          : null;
  // Street geometry arrives as its own chunk; until then the stop layer still works.
  const geometryReady = useRouteGeometry();
  const lines = BUS_LINES;

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
    });

    L.control.zoom({ position: 'bottomright' }).addTo(instance);

    tilesRef.current = L.tileLayer(colors.tiles, {
      attribution: TILE_ATTRIBUTION,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(instance);

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

  // Swap the basemap when the theme changes. setUrl reuses the layer, so the view
  // stays where the reader left it instead of snapping back to Lugo centre.
  useEffect(() => {
    tilesRef.current?.setUrl(colors.tiles);
  }, [colors.tiles]);

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
  const handleLocateUser = () => {
    if (!navigator.geolocation) {
      alert(t.map.geolocationUnavailable);
      return;
    }

    setIsLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        if (map) {
          map.setView([lat, lng], 16, { animate: true });

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
            })
              .addTo(map)
              .bindPopup(t.map.yourPosition);
          }
        }

        const nearby = getNearbyLines(lat, lng, NEARBY_RADIUS_M);
        setNearbyLinesList(nearby);
        setFilterPreset('nearby');
        // Show them all. Picking nearby[0] made "preto de min" display a single line
        // and hide the other seven you could equally walk to.
        setActiveLineId('all');
      },
      () => {
        // Refused or unavailable. This used to fall back to the centre of Lugo and then
        // show "lines near me" measured from there — distances from a place the phone
        // never reported, presented as if they were the reader's. Say what happened
        // instead; the same fallback was removed from the saved-stops screen.
        setIsLocating(false);
        setLocationError(t.map.locationDenied);
      },
      { timeout: 8000 }
    );
  };

  const handleCenterLugo = () => {
    map?.setView(LUGO_CENTER, 14, { animate: true });
  };

  const handleSelectLine = (line: BusLine) => {
    setActiveLineId(line.id);
    onSelectLine(line);

    if (map && line.directions[0]?.pathCoordinates?.length) {
      const bounds = L.polyline(line.directions[0].pathCoordinates).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      }
    }
  };

  const handlePresetFilter = (preset: 'all' | 'nearby' | 'stop' | 'hula' | 'campus' | 'ceao') => {
    setFilterPreset(preset);
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
    } else if (preset === 'stop') {
      setActiveLineId('all');
      if (selectedStop) map?.setView([selectedStop.lat, selectedStop.lng], 15, { animate: true });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
      {/* 2-Column Responsive Layout: Options on Left, Map on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Controls & Filters (Geometric Balance Sidebar) */}
        <div className="lg:col-span-4 space-y-3.5">
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
                <span className="flex items-center gap-1 text-label font-black text-official">
                  <Radio className="w-3.5 h-3.5 animate-pulse text-official" />
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
                className="flex h-11 items-center justify-center gap-1.5 rounded-[9px] px-3.5 bg-accent text-label font-bold text-on-accent shadow-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <LocateFixed className="w-3.5 h-3.5" />
                <span>{isLocating ? t.map.locating : t.map.myLocation}</span>
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

          {/* Filter Presets Panel */}
          <div className="bg-bg rounded-xl p-3.5 shadow-sm border border-edge">
            <span className="text-label font-bold text-ink-3 uppercase tracking-widest block mb-2">
              {t.map.quickFilters}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => handlePresetFilter('all')}
                aria-pressed={filterPreset === 'all'}
                className={`flex h-11 items-center rounded-[9px] px-3.5 text-label font-semibold ${
                  filterPreset === 'all'
                    ? 'bg-accent text-on-accent shadow-xs'
                    : 'bg-surface text-ink-2 border border-edge hover:bg-surface'
                }`}
              >
                {t.map.allLines}
              </button>
              <button
                onClick={() => handlePresetFilter('nearby')}
                aria-pressed={filterPreset === 'nearby'}
                className={`flex h-11 items-center rounded-[9px] px-3.5 text-label font-semibold ${
                  filterPreset === 'nearby'
                    ? 'bg-accent text-on-accent shadow-xs'
                    : 'bg-surface text-ink-2 border border-edge hover:bg-surface'
                }`}
              >
                📍 {t.map.nearbyFilter}
              </button>
              {selectedStop && (
                <button
                  onClick={() => handlePresetFilter('stop')}
                  aria-pressed={filterPreset === 'stop'}
                  title={selectedStop.name}
                  className={`flex h-11 items-center gap-1 whitespace-nowrap rounded-[9px] px-3.5 text-label font-semibold ${
                    filterPreset === 'stop'
                      ? 'bg-accent text-on-accent shadow-xs'
                      : 'bg-surface text-ink-2 border border-edge'
                  }`}
                >
                  🚏 {t.map.aroundStopFilter}
                </button>
              )}
              <button
                onClick={() => handlePresetFilter('hula')}
                aria-pressed={filterPreset === 'hula'}
                className={`flex h-11 items-center rounded-[9px] px-3.5 text-label font-semibold ${
                  filterPreset === 'hula'
                    ? 'bg-warn-ink text-bg shadow-xs'
                    : 'bg-warn text-warn-ink border border-warn hover:bg-warn'
                }`}
              >
                🏥 {t.map.filterHula}
              </button>
              <button
                onClick={() => handlePresetFilter('campus')}
                aria-pressed={filterPreset === 'campus'}
                className={`flex h-11 items-center rounded-[9px] px-3.5 text-label font-semibold ${
                  filterPreset === 'campus'
                    ? 'bg-accent text-on-accent shadow-xs'
                    : 'bg-surface text-accent border border-edge hover:bg-surface'
                }`}
              >
                🎓 {t.map.filterCampus}
              </button>
              <button
                onClick={() => handlePresetFilter('ceao')}
                aria-pressed={filterPreset === 'ceao'}
                className={`flex h-11 items-center rounded-[9px] px-3.5 text-label font-semibold col-span-2 ${
                  filterPreset === 'ceao'
                    ? 'bg-ink text-bg'
                    : 'border border-edge text-ink-2'
                }`}
              >
                🏭 {t.map.filterCeao}
              </button>
            </div>
            {filterPreset === 'stop' && selectedStop && (
              <p className="mt-2 text-label leading-relaxed text-ink-2">
                {t.map.aroundStopActive(selectedStop.name, AROUND_STOP_RADIUS_M)}
              </p>
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
                    <span className="truncate flex-1 text-ink-2">{nearestStop.name}</span>
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
                <Bus className="w-3 h-3 text-official" />
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
              {lines.map((line) => {
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
        <div className="lg:col-span-8">
          <div className="relative z-0 w-full h-[540px] rounded-xl overflow-hidden shadow-sm border border-edge bg-surface">
            <div ref={mapContainerRef} className="w-full h-full" />

            {/* Route, Stop, and Vehicle Layers */}
            <RouteLayer
              map={geometryReady ? map : null}
              visibleLineIds={visibleLineIds}
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
              onSelectStop={onSelectStop}
              onOpenLine={onOpenLine}
              lang={lang}
            />

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

            {/* Floating Map Legend */}
            <div className="absolute bottom-3 left-3 z-[400] bg-bg/95 backdrop-blur-xs p-2.5 rounded-lg shadow-md border border-edge text-label space-y-1 pointer-events-auto font-medium">
              {/* 9 px and 7 px were below the floor this app sets for itself, and a legend
                  is exactly the thing someone squints at. The swatch carries the meaning;
                  the letter inside it was never legible anyway. */}
              <div className="mb-1 text-label font-semibold uppercase tracking-[0.08em] text-ink">
                {t.map.legend}
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3.5 w-3.5 rounded bg-ink ring-1 ring-bg"></div>
                <span className="text-ink-2">{t.map.stop}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 rounded bg-accent ring-2 ring-official"></div>
                <span className="text-ink-2">{t.map.busLive}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-1 bg-accent rounded-full"></div>
                <span className="text-ink-2">{t.map.route}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
