import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Lang, translations } from '../i18n';
import {
  Navigation,
  MapPin,
  ArrowDownUp,
  Clock,
  Bus,
  Footprints,
  AlertCircle,
  ArrowRight,
  LocateFixed,
  Sparkles,
  Check,
  ChevronDown,
} from 'lucide-react';
import { BusStop, BusLine, RoutePlanResult } from '../types';
import { BUS_STOPS } from '../data/transitData';
import { planTrips, resolveLocationQuery, LUGO_LANDMARKS, QUICK_DESTINATIONS } from '../utils/transitEngine';
import { fetchWalkingPath, walkHopKey, walkHopsOf, WalkingPath } from '../services/walkingPath';
// Same reason as the map tab: Leaflet loads with the map, not with the app.
const RouteMap = lazy(() => import('./Map/RouteMap').then((m) => ({ default: m.RouteMap })));
import { MAX_QUERY_LENGTH, calculateRelevanceScore } from '../utils/searchUtils';

/**
 * A resolved place, or nothing. `resolveLocationQuery` returns null for a query it does
 * not recognise rather than quietly substituting an arbitrary stop, so the map simply
 * has no endpoint to draw.
 */
const toPoint = (r: { name: string; lat: number; lng: number } | null) =>
  r ? { name: r.name, lat: r.lat, lng: r.lng } : undefined;

/** More than this and the alternatives stop helping and start being a wall. */
/**
 * Above this a wait stops being a wait. "302 min de espera" beside "sae ás 14:32" says
 * the same thing twice, and the countdown is the useless half: nobody stands at a pole
 * for five hours, they come back at half past two.
 */
const LONG_WAIT_MIN = 90;

/** Move an "HH:MM" label by a signed number of minutes, wrapping past midnight. */
function shiftClock(hhmm: string, deltaMinutes: number): string {
  if (!deltaMinutes) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const total = (((h * 60 + m + deltaMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const MAX_OPTIONS = 4;

/** One row of the origin/destination autocomplete: a real stop, or a named place. */
interface Suggestion {
  id: string;
  name: string;
  code?: string;
  zone?: string;
  type: 'stop' | 'landmark';
  score: number;
}

interface RoutePlannerViewProps {
  onSelectStop: (stop: BusStop) => void;
  onSelectLine: (line: BusLine) => void;
  lang: Lang;
}

export const RoutePlannerView: React.FC<RoutePlannerViewProps> = ({
  onSelectStop,
  onSelectLine,
  lang,
}) => {
  const [originQuery, setOriginQuery] = useState<string>('Fonte dos Ranchos');
  const [destQuery, setDestQuery] = useState<string>('Hospital Lucus Augusti (HULA)');
  const [userLocation, setUserLocation] = useState<[number, number] | undefined>(undefined);
  const [isLocating, setIsLocating] = useState(false);

  const [originSuggestions, setOriginSuggestions] = useState<Suggestion[]>([]);
  const [destSuggestions, setDestSuggestions] = useState<Suggestion[]>([]);
  const [activeInput, setActiveInput] = useState<'origin' | 'dest' | null>(null);

  // Close the autocomplete when the click lands anywhere outside the two fields.
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeInput) return;
    // mousedown + touchstart rather than pointerdown: pointer events are not emitted
    // by every input path, and this must close on any outside interaction.
    const onOutside = (e: Event) => {
      if (!formRef.current?.contains(e.target as Node)) setActiveInput(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveInput(null);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [activeInput]);

  // Every viable way of making the trip, quickest first, plus which one is on screen.
  const [planOptions, setPlanOptions] = useState<RoutePlanResult[]>(() =>
    planTrips('Fonte dos Ranchos', 'Hospital Lucus Augusti (HULA)', { lang }),
  );
  const [chosenOption, setChosenOption] = useState(0);
  const planResult = planOptions[chosenOption] ?? null;

  const [endpoints, setEndpoints] = useState(() => ({
    origin: toPoint(resolveLocationQuery('Fonte dos Ranchos')),
    destination: toPoint(resolveLocationQuery('Hospital Lucus Augusti (HULA)')),
  }));

  const [showMap, setShowMap] = useState(true);
  // Off by default: real pavement routes need a third-party router, and the app is
  // meant to work with no connection.
  const [detailedWalking, setDetailedWalking] = useState(false);
  const [walkPaths, setWalkPaths] = useState<Record<string, WalkingPath | null>>({});

  // Fetch the real pedestrian route for each walked hop of the chosen plan. The times
  // it returns replace the offline estimate, which is off by up to 14 minutes on the
  // awkward crossings (see WALK_DETOUR_FACTOR).
  const walkHops = React.useMemo(
    () => walkHopsOf(planResult, endpoints.origin, endpoints.destination),
    [planResult, endpoints],
  );

  /**
   * Fetched whenever there is a connection, not only when the map path is asked for.
   *
   * Accurate walking times and a drawn walking path were the same switch, which meant
   * the headline duration was the 1.35 detour estimate unless somebody happened to open
   * the map — off by up to 14 minutes on the awkward crossings. Those are two different
   * questions: how long the walk takes should be as good as we can get it every time,
   * and only the drawing is worth putting behind a toggle.
   *
   * Offline the estimate stands and the app keeps working, which is the point of it.
   */
  useEffect(() => {
    if (!walkHops.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const controller = new AbortController();
    Promise.all(
      walkHops.map(async ([a, b]) => [walkHopKey(a, b), await fetchWalkingPath(a, b, controller.signal)] as const),
    )
      .then((entries) => setWalkPaths(Object.fromEntries(entries)))
      .catch(() => {
        // Aborted, or the router is unreachable. The estimate is already on screen.
      });
    return () => controller.abort();
  }, [walkHops]);

  /** Real walking totals, once fetched: what the trip actually costs on foot. */
  const measuredWalk = React.useMemo(() => {
    const found = walkHops.map(([a, b]) => walkPaths[walkHopKey(a, b)]).filter(Boolean) as WalkingPath[];
    if (!found.length || found.length !== walkHops.length) return null;
    return {
      minutes: found.reduce((n, w) => n + w.minutes, 0),
      meters: found.reduce((n, w) => n + w.meters, 0),
    };
  }, [walkHops, walkPaths]);

  /**
   * The trip total, corrected once the real walks are known.
   *
   * The plan is built offline from estimated walks, so its duration and arrival carry
   * that error. Rather than rebuild the plan, the difference between the estimate and
   * the measurement is applied to the totals — the bus legs are untouched, because
   * those come from the timetable and were never estimates in the first place.
   */
  const walkCorrection = React.useMemo(() => {
    if (!planResult || !measuredWalk) return 0;
    const estimated = planResult.segments
      .filter((seg) => seg.type === 'walk')
      .reduce((n, seg) => n + (seg.durationMinutes ?? 0), 0);
    return measuredWalk.minutes - estimated;
  }, [planResult, measuredWalk]);

  // "Now" is the common case, but the question before an appointment is the other one.
  const [timeMode, setTimeMode] = useState<'now' | 'depart' | 'arrive'>('now');
  const [timeValue, setTimeValue] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  const t = translations(lang);

  // Recalculate route whenever queries or user location change
  const timeOptions = () => {
    const [h, m] = timeValue.split(':').map(Number);
    const minutes = (h || 0) * 60 + (m || 0);
    if (timeMode === 'depart') return { userLocation, departAt: minutes };
    if (timeMode === 'arrive') return { userLocation, arriveBy: minutes };
    return { userLocation };
  };

  const handleCalculate = (orig = originQuery, dest = destQuery, gps = userLocation) => {
    if (!orig.trim() || !dest.trim()) return;
    setPlanOptions(planTrips(orig, dest, { ...timeOptions(), userLocation: gps, lang }));
    setChosenOption(0);
    setEndpoints({
      origin: toPoint(resolveLocationQuery(orig, gps)),
      destination: toPoint(resolveLocationQuery(dest, gps)),
    });
    setActiveInput(null);
  };

  const handleSwap = () => {
    const temp = originQuery;
    setOriginQuery(destQuery);
    setDestQuery(temp);
    handleCalculate(destQuery, temp);
  };

  const handleUseGpsForOrigin = () => {
    setIsLocating(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          setUserLocation(coords);
          setOriginQuery('my_location');
          setIsLocating(false);
          handleCalculate('my_location', destQuery, coords);
        },
        () => {
          // fallback location in Lugo center
          const coords: [number, number] = [43.0125, -7.5558];
          setUserLocation(coords);
          setOriginQuery('my_location');
          setIsLocating(false);
          handleCalculate('my_location', destQuery, coords);
        },
        { timeout: 6000 }
      );
    } else {
      const coords: [number, number] = [43.0125, -7.5558];
      setUserLocation(coords);
      setOriginQuery('my_location');
      setIsLocating(false);
      handleCalculate('my_location', destQuery, coords);
    }
  };

  // Generate suggestions for freeform input using relevance scoring
  const getSuggestions = (query: string): Suggestion[] => {
    const q = query.trim();
    if (!q || q === 'my_location') return [];

    const stopMatches = BUS_STOPS.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      zone: s.zone,
      type: 'stop' as const,
      score: calculateRelevanceScore(s.name, s.code, s.id, q, s.address),
    })).filter((item) => item.score > 0);

    const landmarkMatches = LUGO_LANDMARKS.map((lm, idx) => ({
      id: `lm-${idx}`,
      name: lm.name,
      code: undefined,
      zone: lm.zone,
      type: 'landmark' as const,
      score: calculateRelevanceScore(lm.name, '', '', q, lm.zone),
    })).filter((item) => item.score > 0);

    return [...stopMatches, ...landmarkMatches]
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  };

  const quickPicks = QUICK_DESTINATIONS;

  return (
    <div className="mx-auto w-full max-w-7xl px-3.5 py-4 lg:px-6">
      {/* The form stays put while the itinerary scrolls beside it — on a desktop there
          is no reason to lose sight of where you asked to go. */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-6">
        {/* Left Column: Origin & Destination Inputs */}
        <div ref={formRef} className="space-y-4 lg:col-span-5 lg:sticky lg:top-4 lg:self-start">
          <div className="bg-bg rounded-xl p-6 shadow-sm border border-edge">
            <div className="mb-4">
              <h2 className="font-bold text-ink text-body uppercase tracking-wider flex items-center gap-2">
                <Navigation className="w-4 h-4 text-accent" />
                {t.planner.title}
              </h2>
              <p className="text-label text-ink-3 mt-0.5">{t.planner.subtitle}</p>
            </div>

            {/* Inputs Container */}
            <div className="space-y-3 relative">
              {/* Origin Input */}
              <div className="relative">
                {/* The label and the GPS button shared a row, and on a phone the label
                    lost: it wrapped to two lines beside a button that did not. */}
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="input-origin-query"
                    className="text-label font-bold text-ink-2 flex items-center gap-1.5 uppercase tracking-wide"
                  >
                    <span className="w-2 h-2 rounded-full bg-official" />
                    {t.planner.origin}
                  </label>

                  <button
                    onClick={handleUseGpsForOrigin}
                    className="text-label font-semibold text-accent h-11 flex items-center gap-1 bg-surface px-2 py-0.5 rounded border border-edge transition-colors"
                  >
                    <LocateFixed className="w-3 h-3" />
                    <span>{isLocating ? t.planner.locating : t.planner.useMyLocation}</span>
                  </button>
                </div>

                <div className="relative">
                  <input
                    id="input-origin-query"
                    maxLength={MAX_QUERY_LENGTH}
                    type="text"
                    value={originQuery === 'my_location' ? `📍 ${t.map.myLocation}` : originQuery}
                    onChange={(e) => {
                      setOriginQuery(e.target.value);
                      setOriginSuggestions(getSuggestions(e.target.value));
                    }}
                    onFocus={() => {
                      setActiveInput('origin');
                      setOriginSuggestions(getSuggestions(originQuery));
                    }}
                    placeholder={t.planner.placeholderOrig}
                    className="h-11 w-full px-3.5 bg-surface border border-edge rounded-[9px] text-body font-semibold text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent focus:bg-bg"
                  />
                  {originQuery && (
                    <button
                      onClick={() => setOriginQuery('')}
                      className="absolute right-0 top-0 h-11 w-11 flex items-center justify-center text-label text-ink-3 hover:text-ink-2"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Origin Autocomplete Suggestions */}
                {activeInput === 'origin' && originSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-bg border border-edge rounded-lg shadow-lg z-30 divide-y divide-line max-h-56 overflow-y-auto">
                    {originSuggestions.map((sug) => (
                      <div
                        key={sug.id || sug.name}
                        onClick={() => {
                          setOriginQuery(sug.name);
                          setActiveInput(null);
                          handleCalculate(sug.name, destQuery);
                        }}
                        className="p-2.5 text-label hover:bg-surface cursor-pointer flex items-center justify-between gap-2 transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <MapPin className="w-3.5 h-3.5 text-accent shrink-0" />
                          <span className="font-bold text-ink truncate">{sug.name}</span>
                        </div>
                        {sug.code && (
                          <span className="text-label font-mono font-bold bg-surface text-ink-2 px-1.5 py-0.5 rounded shrink-0">
                            #{sug.code}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Swap Button */}
              <div className="flex justify-center -my-1">
                <button
                  id="btn-swap-stops"
                  onClick={handleSwap}
                  className="h-11 w-11 flex items-center justify-center rounded-[9px] bg-surface border border-edge text-ink-2 transition-colors shadow-xs"
                  aria-label={t.planner.swap}
                  title={t.planner.swap}
                >
                  <ArrowDownUp className="w-4 h-4" />
                </button>
              </div>

              {/* Destination Input */}
              <div className="relative">
                <label
                  htmlFor="input-dest-query"
                  className="block text-label font-bold text-ink-2 mb-1 flex items-center gap-1.5 uppercase tracking-wide"
                >
                  <span className="w-2 h-2 rounded-full bg-warn-ink" />
                  {t.planner.destination}
                </label>
                <div className="relative">
                  <input
                    id="input-dest-query"
                    maxLength={MAX_QUERY_LENGTH}
                    type="text"
                    value={destQuery}
                    onChange={(e) => {
                      setDestQuery(e.target.value);
                      setDestSuggestions(getSuggestions(e.target.value));
                    }}
                    onFocus={() => {
                      setActiveInput('dest');
                      setDestSuggestions(getSuggestions(destQuery));
                    }}
                    placeholder={t.planner.placeholderDest}
                    className="h-11 w-full px-3.5 bg-surface border border-edge rounded-[9px] text-body font-semibold text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent focus:bg-bg"
                  />
                  {destQuery && (
                    <button
                      onClick={() => setDestQuery('')}
                      className="absolute right-0 top-0 h-11 w-11 flex items-center justify-center text-label text-ink-3 hover:text-ink-2"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Dest Autocomplete Suggestions */}
                {activeInput === 'dest' && destSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-bg border border-edge rounded-lg shadow-lg z-30 divide-y divide-line max-h-56 overflow-y-auto">
                    {destSuggestions.map((sug) => (
                      <div
                        key={sug.id || sug.name}
                        onClick={() => {
                          setDestQuery(sug.name);
                          setActiveInput(null);
                          handleCalculate(originQuery, sug.name);
                        }}
                        className="p-2.5 text-label hover:bg-surface cursor-pointer flex items-center justify-between gap-2 transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <MapPin className="w-3.5 h-3.5 text-warn-ink shrink-0" />
                          <span className="font-bold text-ink truncate">{sug.name}</span>
                        </div>
                        {sug.code && (
                          <span className="text-label font-mono font-bold bg-surface text-ink-2 px-1.5 py-0.5 rounded shrink-0">
                            #{sug.code}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* When to travel */}
              <div className="mt-3">
                <div className="grid grid-cols-3 gap-1 bg-surface p-1 rounded-md">
                  {(['now', 'depart', 'arrive'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setTimeMode(mode)}
                      aria-pressed={timeMode === mode}
                      className={`h-11 rounded-[9px] text-label font-semibold ${
                        timeMode === mode ? 'bg-bg text-ink shadow-xs' : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      {t.planner.timeModes[mode]}
                    </button>
                  ))}
                </div>
                {timeMode !== 'now' && (
                  <label className="mt-2 flex items-center gap-2 text-label font-semibold text-ink-2">
                    <Clock className="w-3.5 h-3.5 text-accent shrink-0" />
                    <span className="shrink-0">{timeMode === 'arrive' ? t.planner.arriveByLabel : t.planner.departAtLabel}</span>
                    <input
                      type="time"
                      value={timeValue}
                      onChange={(e) => setTimeValue(e.target.value)}
                      className="px-2 py-1 rounded border border-edge bg-bg font-mono text-body"
                    />
                  </label>
                )}
              </div>

              {/* Calculate Button */}
              <button
                onClick={() => handleCalculate()}
                className="w-full mt-2 h-12 px-4 bg-accent text-on-accent font-bold text-label uppercase tracking-wider rounded-md shadow-xs transition-colors flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4 text-ink-2" />
                <span>{t.planner.calculate}</span>
              </button>
            </div>

            {/* Quick Destinations */}
            <div className="mt-5 pt-4 border-t border-line">
              <span className="text-label font-bold text-ink-2 uppercase tracking-wider block mb-2">{t.planner.quickDestinations}</span>
              <div className="flex flex-wrap gap-1.5">
                {quickPicks.map((qp, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setDestQuery(qp.query);
                      handleCalculate(originQuery, qp.query);
                    }}
                    className={`h-11 px-3.5 rounded-[9px] text-label font-semibold border inline-flex items-center transition-colors ${
                      destQuery.includes(qp.label) || destQuery === qp.query
                        ? 'bg-accent text-on-accent border-edge'
                        : 'bg-surface border-edge text-ink-2 hover:bg-surface'
                    }`}
                  >
                    {qp.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Route Result & Step by Step Itinerary */}
        <div className="lg:col-span-7 space-y-4">
          {planResult ? (
            <div className="bg-bg rounded-xl p-6 shadow-sm border border-edge">
              {/* Out of service notice */}
              {!planResult.isServiceActive && planResult.serviceNotice && (
                <div className="mb-4 p-3.5 rounded-lg bg-warn border border-warn text-warn-ink text-label font-bold flex items-start gap-2.5 shadow-xs">
                  <AlertCircle className="w-4 h-4 text-estimated shrink-0 mt-0.5" />
                  <div>
                    <div className="font-extrabold uppercase tracking-wide text-estimated">{t.planner.serviceNoticeTitle}</div>
                    <div className="mt-0.5 font-medium">{planResult.serviceNotice}</div>
                  </div>
                </div>
              )}

              {/* Alternatives. One answer hides the fact that there is usually more than
                  one way, and people have reasons to prefer a line they know. */}
              {planOptions.length > 1 && (
                <div className="mb-5">
                  <span className="text-label font-bold text-ink-2 uppercase tracking-wider block mb-2">
                    {t.planner.optionsTitle(Math.min(planOptions.length, MAX_OPTIONS), planOptions.length)}
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {planOptions.slice(0, MAX_OPTIONS).map((option, idx) => {
                      const busLegs = option.segments.filter((seg) => seg.type === 'bus');
                      return (
                        <button
                          key={idx}
                          onClick={() => setChosenOption(idx)}
                          aria-pressed={idx === chosenOption}
                          className={`p-2.5 rounded-lg border text-left transition-colors ${
                            idx === chosenOption
                              ? 'border-ink bg-ink text-bg'
                              : 'border-edge bg-bg text-ink'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1 flex-wrap">
                              {busLegs.length === 0 ? (
                                <span className="flex items-center gap-1 font-bold text-label">
                                  <Footprints className="w-3.5 h-3.5" />
                                  {t.planner.walkOnly}
                                </span>
                              ) : (
                                busLegs.map((seg, k) => (
                                  <React.Fragment key={k}>
                                    {k > 0 && <span className="opacity-60 text-label">→</span>}
                                    <span
                                      className="px-1.5 rounded text-label font-black text-white"
                                      style={{ backgroundColor: seg.line?.color }}
                                    >
                                      {seg.line?.number}
                                    </span>
                                  </React.Fragment>
                                ))
                              )}
                            </span>
                            <span className="font-mono font-black text-body shrink-0">
                              {option.durationMinutes} min
                            </span>
                          </div>
                          <div
                            className={`mt-1 text-label font-medium ${
                              idx === chosenOption ? 'opacity-85' : 'text-ink-3'
                            }`}
                          >
                            {option.leaveAt !== option.departureTime
                              ? t.planner.leaveAtShort(option.leaveAt)
                              : option.departureTime}{' '}
                            → ~{option.arrivalTime}
                            {option.totalWaitMinutes > 0 &&
                              option.totalWaitMinutes <= LONG_WAIT_MIN &&
                              ` · ${t.planner.waitShort(option.totalWaitMinutes)}`}
                            {busLegs.length > 1 && ` · ${t.planner.transfersShort(busLegs.length - 1)}`}
                            {busLegs.length === 0 && ` · ${t.planner.noWaitNoFare}`}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Route map. Reading a list of streets is much harder than seeing the shape
                  of the trip, so it is shown by default and can be folded away. */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-label font-bold text-ink-2 uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-accent" />
                    {t.planner.routeMap}
                  </span>
                  <span className="flex items-center gap-3">
                    {showMap && (
                      <button
                        onClick={() => setDetailedWalking((v) => !v)}
                        className="text-label font-semibold text-accent h-11 inline-flex items-center underline"
                        title={t.planner.walkingPathHint}
                      >
                        {detailedWalking ? t.planner.hideWalkingPath : t.planner.showWalkingPath}
                      </button>
                    )}
                    <button
                      onClick={() => setShowMap((v) => !v)}
                      className="text-label font-semibold text-accent h-11 inline-flex items-center underline"
                    >
                      {showMap ? t.planner.hideMap : t.planner.showMap}
                    </button>
                  </span>
                </div>
                {showMap && (
                  <Suspense
                    fallback={<div className="w-full h-[280px] rounded-xl bg-surface animate-pulse" />}
                  >
                    <RouteMap
                      plan={planResult}
                      lang={lang}
                      origin={endpoints.origin}
                      destination={endpoints.destination}
                      walkPaths={walkPaths}
                      className="w-full h-[280px] rounded-xl overflow-hidden border border-edge z-0"
                    />
                  </Suspense>
                )}
              </div>

              {/* The three numbers that answer "should I do this trip": how long it
                  takes, when to leave, when you land. On the page ground rather than a
                  solid slab — a coloured block here fought the provenance chips, which
                  are the only things on this screen that should read as badges. */}
              <div className="mb-5 border-b border-line pb-4">
                <div className="flex items-baseline gap-2">
                  <span className="tnum text-num font-bold tracking-[-0.025em]">
                    {planResult.durationMinutes + walkCorrection}
                  </span>
                  <span className="text-body text-ink-3">{t.common.min}</span>
                </div>

                <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                  <span className="text-label text-ink-3">{t.planner.departureLabel}</span>
                  <span className="tnum text-emph font-semibold">{planResult.departureTime}</span>
                  <ArrowRight className="h-[15px] w-[15px] shrink-0 self-center text-ink-3" strokeWidth={2} aria-hidden="true" />
                  <span className="text-label text-ink-3">{t.planner.arrivalLabel}</span>
                  <span className="tnum text-emph font-semibold">
                    ~{shiftClock(planResult.arrivalTime, walkCorrection)}
                  </span>
                </div>
              </div>

                {/* Wait time notification badge */}
                {/* Say plainly where these numbers come from. The departure can be a
                    published time; everything after it is computed. */}
                {measuredWalk && (
                  <div className="mt-3 text-label bg-surface/60 text-ink px-3 py-2 rounded-md border border-edge flex items-center justify-between gap-3">
                    <span className="font-bold uppercase tracking-wider text-label text-ink-2">
                      {t.planner.measuredWalkTitle}
                    </span>
                    <span className="font-mono font-black">
                      {measuredWalk.minutes} min · {(measuredWalk.meters / 1000).toFixed(1)} km
                    </span>
                  </div>
                )}

                <div className="mt-3 text-label leading-relaxed text-ink-2 bg-surface/40 px-3 py-2 rounded-md border border-edge">
                  {measuredWalk ? t.planner.timeProvenanceMeasured : t.planner.timeProvenance}
                </div>

                {planResult.fare && planResult.fare.busLegs > 0 && (
                  <div className="mt-3 text-label bg-surface/60 text-ink px-3 py-2 rounded-md border border-edge">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-bold uppercase tracking-wider text-label text-ink-2">
                        {t.planner.fareTitle}
                      </span>
                      <span className="flex items-baseline gap-3 font-mono">
                        <span className="text-estimated font-black text-body">
                          {planResult.fare.citizenCardEuros.toFixed(2).replace('.', ',')} €
                        </span>
                        <span className="text-ink-2 line-through">
                          {planResult.fare.singleTicketEuros.toFixed(2).replace('.', ',')} €
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 text-label text-ink-2">
                      {t.planner.fareCard} &bull; {t.planner.fareSingle}:{' '}
                      {planResult.fare.singleTicketEuros.toFixed(2).replace('.', ',')} €
                      {planResult.fare.busLegs > 1 && (
                        <span className="block mt-0.5 text-estimated">
                          {planResult.fare.transfersFree ? t.planner.fareTransferFree : t.planner.fareTransferPaid}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {planResult.totalWaitMinutes > 0 && (
                  <div className="mt-3 text-label bg-surface/60 text-ink-2 px-3 py-1.5 rounded-md border border-edge flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-estimated shrink-0" />
                    <span>
                      {t.planner.includesWait(planResult.totalWaitMinutes)}
                    </span>
                  </div>
                )}

              {/* Step by Step Timeline */}
              <div className="space-y-4 relative pl-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-surface">
                {planResult.segments.map((seg, idx) => {
                  const isBus = seg.type === 'bus';
                  const isWait = seg.type === 'wait';

                  return (
                    <div key={idx} className="relative">
                      {/* Node circle */}
                      <div
                        className={`absolute -left-6 top-1.5 w-5 h-5 rounded-full border-2 border-white shadow-xs flex items-center justify-center ${
                          isBus
                            ? 'bg-accent text-on-accent'
                            : isWait
                            ? 'bg-warn text-warn-ink'
                            : 'bg-ink text-on-accent'
                        }`}
                      >
                        {isBus ? (
                          <Bus className="w-3 h-3" />
                        ) : isWait ? (
                          <Clock className="w-3 h-3" />
                        ) : (
                          <Footprints className="w-3 h-3" />
                        )}
                      </div>

                      <div className={`p-4 rounded-xl border transition-all ${
                        isBus
                          ? 'border-edge bg-surface/30'
                          : isWait
                          ? 'border-warn bg-warn/40'
                          : 'border-edge bg-surface/60'
                      }`}>
                        {isBus && seg.line ? (
                          <div>
                            <div className="flex items-center gap-2.5">
                              <button
                                onClick={() => seg.line && onSelectLine(seg.line)}
                                title={seg.line.name}
                                className="tnum flex h-11 w-11 shrink-0 items-center justify-center rounded-[7px] text-body font-bold text-white"
                                style={{ backgroundColor: seg.line.color }}
                              >
                                {seg.line.number}
                              </button>
                              <span className="min-w-0 flex-1 truncate text-body font-semibold">
                                {seg.line.name}
                              </span>
                              <span className="tnum shrink-0 text-emph font-bold">
                                {seg.durationMinutes} min
                              </span>
                            </div>

                            <div className="mt-3 flex items-baseline gap-2">
                              <span className="text-label text-ink-3">{t.planner.board}</span>
                              <button
                                onClick={() => seg.fromStop && onSelectStop(seg.fromStop)}
                                className="flex min-h-11 min-w-0 flex-1 items-center truncate text-left text-body font-semibold underline underline-offset-2"
                              >
                                {seg.fromStop?.name}
                              </button>
                              <span className="tnum shrink-0 text-body font-semibold">
                                {seg.departureTime}
                              </span>
                            </div>

                            {/* What you actually pass through. Collapsed by default because
                                the question is normally "how long", and open in one tap for
                                the times it is "wait, is my stop on this?" — the same shape
                                Google and Moovit use, and for the same reason. */}
                            {(() => {
                              const direction = seg.line.directions.find((d) => d.id === seg.directionId);
                              const all = direction?.stops ?? [];
                              const from = all.indexOf(seg.fromStop?.id ?? '');
                              const to = all.indexOf(seg.toStop?.id ?? '');
                              const between =
                                from >= 0 && to > from ? all.slice(from + 1, to) : [];
                              const count = seg.stopsCount ?? between.length + 1;

                              if (between.length === 0) {
                                return (
                                  <p className="mt-1.5 border-l-2 border-line py-1.5 pl-3 text-label text-ink-3">
                                    {t.planner.ride(count, seg.durationMinutes)}
                                  </p>
                                );
                              }
                              return (
                                <details className="mt-1.5 border-l-2 border-line pl-3">
                                  <summary className="flex h-11 cursor-pointer items-center gap-1.5 text-label text-ink-2">
                                    <ChevronDown className="h-[15px] w-[15px] shrink-0" strokeWidth={2} aria-hidden="true" />
                                    {t.planner.ride(count, seg.durationMinutes)}
                                  </summary>
                                  <ol className="pb-2 pl-[21px]" aria-label={t.planner.viaStops}>
                                    {between.map((id) => (
                                      <li key={id} className="truncate py-1 text-label text-ink-3">
                                        {BUS_STOPS.find((x) => x.id === id)?.name ?? id}
                                      </li>
                                    ))}
                                  </ol>
                                </details>
                              );
                            })()}

                            <div className="flex items-baseline gap-2">
                              <span className="text-label text-ink-3">{t.planner.alight}</span>
                              <button
                                onClick={() => seg.toStop && onSelectStop(seg.toStop)}
                                className="flex min-h-11 min-w-0 flex-1 items-center truncate text-left text-body font-semibold underline underline-offset-2"
                              >
                                {seg.toStop?.name}
                              </button>
                              <span className="tnum shrink-0 text-body font-semibold">
                                {seg.arrivalTime}
                              </span>
                            </div>

                            {/* Where the boarding time came from, in the same two shapes the
                                stop board uses — solid for published, dashed for derived. */}
                            <div className="mt-2.5">
                              {seg.precision === 'published' ? (
                                <span className="inline-flex items-center gap-1.5 rounded bg-official px-2 py-1 text-on-official">
                                  <Check className="h-2.5 w-2.5 shrink-0" strokeWidth={3.4} aria-hidden="true" />
                                  <span className="tnum text-label font-semibold tracking-[0.05em]">
                                    {t.common.officialBadge}
                                  </span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 rounded border-[1.5px] border-dashed border-estimated-line px-[7px] py-[3px] text-estimated">
                                  <span className="tnum text-label font-semibold tracking-[0.05em]">
                                    {t.common.estimatedBadge}
                                  </span>
                                </span>
                              )}
                            </div>
                          </div>
                        ) : isWait ? (
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                              <span className="text-label font-bold text-warn-ink flex items-center gap-1.5 uppercase tracking-wide">
                                <Clock className="w-3.5 h-3.5 text-estimated" />
                                {t.planner.scheduledWait}
                              </span>

                              <div className="flex items-center gap-2">
                                {seg.departureTime && seg.arrivalTime && (
                                  <span className="px-2 py-0.5 rounded bg-warn text-warn-ink font-mono font-bold text-label border border-warn">
                                    {seg.departureTime} &rarr; {seg.arrivalTime}
                                  </span>
                                )}
                                <span className="text-body font-black text-warn-ink font-mono">
                                  {seg.durationMinutes} min
                                </span>
                              </div>
                            </div>
                            <p className="text-label text-warn-ink font-medium bg-bg/80 p-2.5 rounded-lg border border-warn">
                              {seg.instruction}
                            </p>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                              <span className="text-label font-bold text-ink flex items-center gap-1.5">
                                <Footprints className="w-3.5 h-3.5 text-ink-2" />
                                {seg.walkMeters ? t.planner.walkMetres(seg.walkMeters) : t.planner.walkConnection}
                              </span>

                              <div className="flex items-center gap-2">
                                {seg.departureTime && seg.arrivalTime && (
                                  <span className="px-2 py-0.5 rounded bg-surface text-ink font-mono font-bold text-label">
                                    {seg.departureTime} &rarr; {seg.arrivalTime}
                                  </span>
                                )}
                                <span className="text-body font-black text-ink font-mono">
                                  {seg.durationMinutes} min
                                </span>
                              </div>
                            </div>
                            <p className="text-label text-ink-2 mt-1">{seg.instruction}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Notice */}
              <div className="mt-6 p-3 rounded-lg bg-warn border border-warn flex items-start gap-2.5 text-label text-warn-ink font-medium">
                <AlertCircle className="w-4 h-4 text-estimated shrink-0 mt-0.5" />
                <span>{t.planner.transferFreeNotice}</span>
              </div>
            </div>
          ) : (
            <div className="bg-bg rounded-xl p-8 text-center border border-edge">
              <AlertCircle className="w-8 h-8 text-ink-3 mx-auto mb-2" />
              <p className="text-body text-ink-2 font-medium">
                {timeMode === 'arrive' ? t.planner.noArriveOption : t.planner.noRouteFound}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
