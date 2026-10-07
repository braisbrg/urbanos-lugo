import { useState, useEffect, useMemo, useReducer, useRef, lazy, Suspense } from 'react';
import { Navigation, MapPin, ArrowDownUp, Clock, Bus, Footprints, AlertCircle, ArrowRight, ChevronDown } from 'lucide-react';
import { useLang, useT } from '../i18n';
import { BusStop, BusLine, RoutePlanResult } from '../types';
import { planTrips } from '../utils/planner';
import { changesNow, pastTimetable, runsUntil, setsOff, underNotice, type NoticeChanges } from '../utils/noticeChanges';
import { stopById } from '../data/transitData';
import { resolveLocationQuery, QUICK_DESTINATIONS } from '../utils/places';
import { dayWord } from '../utils/serviceLabels';
import { walkHopKey, walkHopsOf, type Hop } from '../services/walkingPath';
import { useRecentRoutes } from '../hooks/useStoredList';
import { useWalkPaths } from '../hooks/useWalkPaths';
import { useClock } from '../hooks/useClock';
import { boardingIsNow, type TripPlace } from '../utils/tripProgress';
import { SectionLabel } from './ui/SectionLabel';
import { Segmented } from './ui/controls';
import { PlaceField, suggestionsFor, type Suggestion } from './planner/PlaceField';
import { TripOptions } from './planner/TripOptions';
import { Itinerary } from './planner/Itinerary';
import { correctionFor, formatKm, measuredWalkFor, rankMeasured, withMeasuredWalk, type Endpoints } from './planner/walkCorrection';
// Leaflet loads with the map, not with the app.
const RouteMap = lazy(() => import('./Map/RouteMap').then((m) => ({ default: m.RouteMap })));

const DEFAULT_ORIGIN = 'Fonte dos Ranchos';
const DEFAULT_DEST = 'Hospital Lucus Augusti (HULA)';
/** More than this and the alternatives stop helping and start being a wall. */
const MAX_OPTIONS = 4;

const toPoint = (r: { name: string; lat: number; lng: number } | null) => (r ? { name: r.name, lat: r.lat, lng: r.lng } : undefined);
/** The moment a question is planned from, as planTrips reads it: now, or today at the time asked to leave. */
const plannedFrom = (opts: { departAt?: number }): Date => {
  const at = new Date();
  if (opts.departAt !== undefined) at.setHours(Math.floor(opts.departAt / 60), Math.round(opts.departAt % 60), 0, 0);
  return at;
};
/** Once the frame already committed is on screen: the next animation frame, then a task after it. */
const afterPaint = (run: () => void) => requestAnimationFrame(() => setTimeout(run, 0));
const clockNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * The question, the form and the answer as one state with two moves: answering folds the
 * form to a one-line summary on a phone (found or not — the "no route" sentence lives in
 * the answer column), and `answered` counts the questions so focus moves to the answer.
 */
interface Asking {
  formOpen: boolean;
  asked: boolean;
  answered: number;
}
const asking = (state: Asking, action: 'answer' | 'toggleForm'): Asking =>
  action === 'answer' ? { formOpen: false, asked: true, answered: state.answered + 1 } : { ...state, formOpen: !state.formOpen };

interface RoutePlannerViewProps {
  onSelectStop: (stop: BusStop) => void;
  onSelectLine: (line: BusLine) => void;
  /** A place picked in the search box. The counter makes asking twice two requests. */
  destinationRequest?: { query: string; nonce: number } | null;
  /** "Vou nesta": hand the plan on screen to the trip companion. */
  onStartTrip: (plan: RoutePlanResult, origin: TripPlace | null, destination: TripPlace | null) => void;
  /** What the operator's notice changes: a stop it closes is never boarded or left, and a trip on a changed line says so. */
  changes?: NoticeChanges | null;
  onOpenAlerts?: () => void;
}

export function RoutePlannerView({ onSelectStop, onSelectLine, destinationRequest, onStartTrip, changes = null, onOpenAlerts }: RoutePlannerViewProps) {
  const t = useT();
  const lang = useLang();
  const [originQuery, setOriginQuery] = useState(DEFAULT_ORIGIN);
  const [destQuery, setDestQuery] = useState(DEFAULT_DEST);
  const [userLocation, setUserLocation] = useState<[number, number] | undefined>(undefined);
  const [isLocating, setIsLocating] = useState(false);
  /** The phone would not say where it is: told, rather than planned from somewhere else. */
  const [gpsRefused, setGpsRefused] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeInput, setActiveInput] = useState<'origin' | 'dest' | null>(null);
  const [timeMode, setTimeMode] = useState<'now' | 'depart' | 'arrive'>('now');
  const [timeValue, setTimeValue] = useState(clockNow);
  const [showMap, setShowMap] = useState(true);
  const [recentRoutes, rememberRoute, clearRecentRoutes] = useRecentRoutes();
  const [{ formOpen, asked, answered }, ask] = useReducer(asking, { formOpen: true, asked: false, answered: 0 });

  // Close the autocomplete when a click lands anywhere outside the two fields: on the click,
  // when the finger lifts, rather than on mousedown and touchstart (WCAG 2.5.2), and every
  // input path emits one.
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeInput) return;
    const onOutside = (e: Event) => {
      if (!formRef.current?.contains(e.target as Node)) setActiveInput(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveInput(null);
    };
    document.addEventListener('click', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [activeInput]);

  // Every viable way of making the trip, quickest first, plus which one is on screen.
  const [planOptions, setPlanOptions] = useState<RoutePlanResult[]>(() => underNotice(changes, new Date(), (skipsStop) => planTrips(DEFAULT_ORIGIN, DEFAULT_DEST, { lang, skipsStop })));
  /** The option the reader opened; null until they open one, and then the first row is the answer. */
  const [chosenOption, setChosenOption] = useState<number | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoints>(() => ({ origin: toPoint(resolveLocationQuery(DEFAULT_ORIGIN)), destination: toPoint(resolveLocationQuery(DEFAULT_DEST)) }));
  const shownOptions = useMemo(() => planOptions.slice(0, MAX_OPTIONS), [planOptions]);

  // Focus lands on the answer column after every question: the button folds away with the form.
  // Without preventScroll the page dropped onto the map the instant the fold started. The
  // view goes to the row that says what was asked instead: it sits above the fold, so it
  // does not move while the form closes under it, and the answer rises in right below.
  // Scrolling to the answer after the fold hid that row -- 76 px, the way back to the
  // fields. From lg up the row is not rendered, and scrolling to it does nothing.
  const answerRef = useRef<HTMLDivElement>(null);
  const askedRowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!answered) return;
    answerRef.current?.focus({ preventScroll: true });
    askedRowRef.current?.scrollIntoView({ block: 'start' });
  }, [answered]);
  /** The form is mid-fold: clipping stays on until the transition ends, not a child's. */
  const [folding, setFolding] = useState(false);
  /**
   * Counts the swaps: the arrow turns half a turn for each and the two fields, keyed on it,
   * fade in with their new text. Swaps only -- counted on every question, the arrow turned
   * on "Calcular" as if the ends had been exchanged, beside a desktop form that never folds.
   */
  const [swaps, setSwaps] = useState(0);
  /** Where the button on the map jumps to. */
  const stepsRef = useRef<HTMLDivElement>(null);

  /** A clock for the one thing here that changes on its own: whether the first bus is within ten minutes. */
  const now = useClock(30_000);

  // Every walked hop of every option on offer, not only the open one, so the four are compared like for like.
  const allWalkHops = useMemo(() => {
    const seen = new Map<string, Hop>();
    for (const option of shownOptions) for (const hop of walkHopsOf(option, endpoints.origin, endpoints.destination)) seen.set(walkHopKey(hop[0], hop[1]), hop);
    return [...seen.values()];
  }, [shownOptions, endpoints]);
  const walkPaths = useWalkPaths(allWalkHops);

  /**
   * The options worth offering. "Todo a pé" is built from the straight line and ranked
   * against bus options that were never estimates, so once the router says there is no
   * pedestrian route, the walk-only option is withdrawn rather than left standing.
   */
  const offeredOptions = useMemo(
    () =>
      shownOptions
        .map((option, idx) => ({ option, idx }))
        .filter(({ option }) => {
          if (option.segments.some((segment) => segment.type === 'bus')) return true;
          // Still waiting on the router is not the same as being told there is no route.
          return walkHopsOf(option, endpoints.origin, endpoints.destination).every(([a, b]) => walkPaths[walkHopKey(a, b)] !== null);
        }),
    [shownOptions, walkPaths, endpoints],
  );

  const correction = (plan: RoutePlanResult) => correctionFor(plan, endpoints, walkPaths);
  // In the order of what each row prints once its walks are measured, and the headline is the first of them.
  const ranked = useMemo(() => rankMeasured(offeredOptions, (plan) => correctionFor(plan, endpoints, walkPaths)), [offeredOptions, endpoints, walkPaths]);
  const chosen = chosenOption ?? ranked[0]?.idx ?? 0;
  const planResult = planOptions[chosen] ?? null;
  const measuredWalk = measuredWalkFor(planResult, endpoints, walkPaths);
  const shown = planResult && withMeasuredWalk(planResult, correction(planResult));

  /** The question the plans on screen are answering — not the fields, which the reader may be retyping. */
  const askedRef = useRef({ orig: DEFAULT_ORIGIN, dest: DEFAULT_DEST, opts: {} as { userLocation?: [number, number]; departAt?: number; arriveBy?: number } });
  /** One replan per question, and no more. */
  const replannedRef = useRef(false);

  /**
   * Ask again, once, when the measured walk has already cost the reader the bus: as if they
   * set off `missedBy` minutes later, with every walk the router has traced handed back
   * keyed by the stop it leads to (moving the clock alone picked a different wrong stop).
   * Once, because the new plan may board somewhere unmeasured and a second round can oscillate.
   */
  useEffect(() => {
    if (replannedRef.current || !planResult || !shown || shown.reachable) return;
    replannedRef.current = true;
    const known = new Map<string, number>();
    for (const option of shownOptions) {
      const boarding = option.segments.find((seg) => seg.type === 'bus')?.fromStop;
      const first = walkHopsOf(option, endpoints.origin, endpoints.destination)[0];
      const path = first && walkPaths[walkHopKey(first[0], first[1])];
      if (boarding && path) known.set(boarding.id, path.minutes);
    }
    const { orig, dest, opts } = askedRef.current;
    const again = underNotice(changes, plannedFrom(opts), (skipsStop) => planTrips(orig, dest, { ...opts, lang, measuredWalkToStop: (id) => known.get(id), skipsStop }));
    if (!again.length) return; // nothing better at the later time: keep what is on screen, marked
    setPlanOptions(again);
    setChosenOption(null);
  }, [planResult, shown?.reachable, lang]);

  const timeOptions = () => {
    const [h, m] = timeValue.split(':').map(Number);
    const minutes = (h || 0) * 60 + (m || 0);
    return timeMode === 'depart' ? { departAt: minutes } : timeMode === 'arrive' ? { arriveBy: minutes } : {};
  };

  const [questions, setQuestions] = useState(0);
  const [calculating, setCalculating] = useState(false);
  const calculatingRef = useRef(false);
  const calculate = (orig = originQuery, dest = destQuery, gps = userLocation, fold = true) => {
    if (!orig.trim() || !dest.trim() || calculatingRef.current) return;
    // The plan runs on this thread, and "arrive by" holds it for seconds on a slow phone
    // (5.0-6.4 s at 6x CPU), where the tap showed nothing until the answer. So the button
    // says «Calculando» in a frame of its own, and the plan starts once that frame is on
    // screen. A second tap meanwhile is the same question asked twice, and is dropped.
    calculatingRef.current = true;
    setCalculating(true);
    afterPaint(() => {
      try {
        setGpsRefused(false);
        const opts = { ...timeOptions(), userLocation: gps };
        askedRef.current = { orig, dest, opts };
        replannedRef.current = false;
        const plans = underNotice(changes, plannedFrom(opts), (skipsStop) => planTrips(orig, dest, { ...opts, lang, skipsStop }));
        setPlanOptions(plans);
        setChosenOption(null);
        setQuestions((n) => n + 1);
        if (fold) {
          setFolding(true);
          ask('answer');
        }
        if (plans.length) rememberRoute({ from: orig.trim(), to: dest.trim() });
        setEndpoints({ origin: toPoint(resolveLocationQuery(orig, gps)), destination: toPoint(resolveLocationQuery(dest, gps)) });
        setActiveInput(null);
      } finally {
        calculatingRef.current = false;
        setCalculating(false);
      }
    });
  };

  // A place chosen in the search box arrives as the destination, already planned from whatever origin is set.
  useEffect(() => {
    if (!destinationRequest) return;
    setDestQuery(destinationRequest.query);
    calculate(originQuery, destinationRequest.query);
  }, [destinationRequest?.nonce]);

  // Inverting must not fold the form under the finger that pressed it.
  const swap = () => {
    setSwaps((n) => n + 1);
    setOriginQuery(destQuery);
    setDestQuery(originQuery);
    calculate(destQuery, originQuery, userLocation, false);
  };

  /**
   * The phone's position, then a plan from it. Refused or missing, the reader is told and
   * nothing is planned: it fell back to Lugo's centre and planned from there under the label
   * "📍 Mi ubicación" -- the one thing the stops screen refuses to do with a location.
   */
  const withGps = (plan: (coords: [number, number]) => void) => {
    const refused = () => {
      setIsLocating(false);
      setGpsRefused(true);
    };
    if (!navigator.geolocation) return refused();
    setGpsRefused(false);
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserLocation(coords);
        setIsLocating(false);
        plan(coords);
      },
      refused,
      { timeout: 6000 },
    );
  };
  const useGps = () =>
    withGps((coords) => {
      setOriginQuery('my_location');
      calculate('my_location', destQuery, coords);
    });

  /** The GPS origin is a token, not a name: shown as what it means wherever a place is shown. */
  const placeLabel = (query: string) => (query === 'my_location' ? `📍 ${t.map.myLocation}` : query);

  const pick = (role: 'origin' | 'dest') => (name: string) => {
    setActiveInput(null);
    if (role === 'origin') {
      setOriginQuery(name);
      calculate(name, destQuery);
    } else {
      setDestQuery(name);
      calculate(originQuery, name);
    }
  };
  const fieldFor = (role: 'origin' | 'dest', value: string) => ({
    role,
    value,
    suggestions,
    open: activeInput === role,
    onChange: (next: string) => {
      (role === 'origin' ? setOriginQuery : setDestQuery)(next);
      setSuggestions(suggestionsFor(next));
    },
    onFocus: () => {
      setActiveInput(role);
      setSuggestions(suggestionsFor(value));
    },
    onPick: pick(role),
    onLeave: () => setActiveInput((current) => (current === role ? null : current)),
  });

  /** "Vou nesta": not for a walk, nor once the service is over; at headline size within ten minutes of the bus. */
  const canStart = planResult !== null && planResult.isServiceActive && planResult.segments.some((seg) => seg.type === 'bus');
  const boardingSoon = canStart && boardingIsNow(planResult, now, userLocation ? { lat: userLocation[0], lng: userLocation[1] } : null);
  const startTripButton = (prominent: boolean) => (
    <button
      type="button"
      onClick={() => planResult && onStartTrip(planResult, endpoints.origin ?? null, endpoints.destination ?? null)}
      className={`flex w-full items-center justify-center gap-2 rounded-control bg-accent px-4 font-semibold text-on-accent ${prominent ? 'anim-attention h-14 text-emph' : 'h-12 text-body'}`}
    >
      <Bus className={prominent ? 'h-5 w-5 shrink-0' : 'h-4.5 w-4.5 shrink-0'} strokeWidth={2} aria-hidden="true" />
      {t.companion.start}
    </button>
  );
  const folded = asked && !formOpen;

  return (
    <div className="mx-auto w-full max-w-7xl px-cap-3.5 py-4 lg:px-6">
      {/* The form stays put while the itinerary scrolls beside it from lg up; below, the two take turns. */}
      <div className="lg:grid lg:grid-cols-12 lg:gap-6">
        <div ref={formRef} className="space-y-4 lg:col-span-5 lg:sticky lg:top-4 lg:self-start">
          {/* What you asked for, in one line, and the way in and out of the fields. */}
          {asked && (
            <button
              ref={askedRowRef}
              type="button"
              onClick={() => {
                setFolding(true);
                ask('toggleForm');
              }}
              aria-expanded={formOpen}
              className="flex min-h-11 w-full scroll-mt-[1rem] flex-wrap items-center gap-x-2 text-left lg:hidden"
            >
              <Navigation className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              {/* A floor under the route, in rem: when the text is set large there is no room for
                  both, and the link goes to the next line instead of the route shrinking to nothing. */}
              <span title={`${placeLabel(originQuery)} → ${placeLabel(destQuery)}`} className="line-clamp-2 min-w-[min(8rem,100%)] flex-1 break-words text-label font-semibold text-ink">
                {placeLabel(originQuery)} → {placeLabel(destQuery)}
              </span>
              <span className="shrink-0 text-label font-semibold text-accent underline">{formOpen ? t.planner.backToAnswer : t.planner.editTrip}</span>
            </button>
          )}

          <div
            className={`fold fold-lg-open fold-clear ${folded ? 'fold-closed' : ''} ${folding ? 'fold-moving' : ''}`}
            onTransitionEnd={(e) => {
              if (e.target === e.currentTarget) setFolding(false);
            }}
          >
            {/* A bare wrapper: the row can only shrink to its item's padding and border, so the card itself as the item left a 30 px stub when folded. */}
            <div>
          <div className="bg-bg rounded-card py-3.5 px-cap-3.5 sm:p-6 shadow-sm border border-edge">
            <h2 className="sr-only">{t.planner.title}</h2>
            <div className="relative">
              <div className="relative rounded-card border border-edge bg-surface">
                <PlaceField
                  key={`origin-${swaps}`}
                  id="input-origin-query"
                  {...fieldFor('origin', originQuery)}
                  display={originQuery === 'my_location' ? placeLabel(originQuery) : undefined}
                  placeholder={t.planner.placeholderOrig}
                  label={t.planner.origin}
                  trailing={{ kind: 'gps', locating: isLocating, onClick: () => useGps() }}
                />
                {/* How many rows opened, for the ear; one line for both fields so the count is announced when it changes. */}
                <span role="status" className="sr-only">
                  {activeInput && suggestions.length > 0 ? t.planner.suggestionsCount(suggestions.length) : ''}
                </span>
                <div className="mx-3.5 border-t border-line" aria-hidden="true" />
                <PlaceField
                  key={`dest-${swaps}`}
                  id="input-dest-query"
                  {...fieldFor('dest', destQuery)}
                  // A swap carries the GPS origin over here, and it read "my_location".
                  display={destQuery === 'my_location' ? placeLabel(destQuery) : undefined}
                  placeholder={t.planner.placeholderDest}
                  label={t.planner.destination}
                  trailing={destQuery ? { kind: 'clear', onClick: () => setDestQuery('') } : null}
                />
                {/* One swap for both rows, on the edge where a thumb already is. */}
                <button
                  id="btn-swap-stops"
                  onClick={swap}
                  className="absolute left-1 top-1/2 flex h-11 w-11 -translate-x-1 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 before:absolute before:h-9 before:w-9 before:rounded-full before:border before:border-edge before:bg-bg before:shadow-xs"
                  aria-label={t.planner.swap}
                  title={t.planner.swap}
                >
                  {/* Turns with the swap, so the button shows what it just did to the fields. */}
                  <ArrowDownUp className="relative h-4 w-4 transition-transform duration-[240ms] ease-[cubic-bezier(0.2,0.7,0.2,1)]" style={{ transform: `rotate(${swaps * 180}deg)` }} />
                </button>
              </div>

              {gpsRefused && (
                <p role="alert" className="mt-2 text-label font-semibold text-warn-ink">
                  {t.map.locationDenied}
                </p>
              )}

              <div className="mt-3">
                <Segmented dense options={(['now', 'depart', 'arrive'] as const).map((mode) => ({ id: mode, label: t.planner.timeModes[mode] }))} value={timeMode} onChange={setTimeMode} />
                {timeMode !== 'now' && (
                  <label className="mt-2 flex items-center gap-2 text-label font-semibold text-ink-2">
                    <Clock className="w-3.5 h-3.5 text-accent shrink-0" />
                    <span className="shrink-0">{timeMode === 'arrive' ? t.planner.arriveByLabel : t.planner.departAtLabel}</span>
                    <input type="time" value={timeValue} onChange={(e) => setTimeValue(e.target.value)} className="px-2 py-1 rounded border border-edge bg-bg font-mono text-body" />
                  </label>
                )}
              </div>

              <button onClick={() => calculate()} aria-busy={calculating} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-control bg-accent px-4 text-body font-semibold text-on-accent transition-colors">
                {calculating ? (
                  <span>
                    {t.planner.calculating}
                    <span className="calc-dots" aria-hidden="true">
                      <span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </span>
                  </span>
                ) : (
                  <>
                    <span>{t.planner.calculate}</span>
                    <ArrowRight className="h-4.5 w-4.5" strokeWidth={2.5} aria-hidden="true" />
                  </>
                )}
              </button>
            </div>

            {/* Your own trips first, then everybody's. Folded with the form, and back when the form is. */}
            <div className={`mt-5 space-y-4 border-t border-line pt-4 ${folded ? 'hidden lg:block' : ''}`}>
              {recentRoutes.length > 0 && (
                <div>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="text-label font-bold uppercase tracking-wider text-ink-2">{t.planner.recentRoutes}</span>
                    <button type="button" onClick={clearRecentRoutes} className="inline-flex h-11 min-w-11 items-center justify-end text-label font-semibold text-accent underline">
                      {t.stopHome.clearRecent}
                    </button>
                  </div>
                  <div className="flex flex-col">
                    {recentRoutes.map((route, idx) => (
                      <button
                        key={`${route.from}>${route.to}`}
                        type="button"
                        onClick={() => {
                          setOriginQuery(route.from);
                          setDestQuery(route.to);
                          // From where you were is asked again from where you are: no position is
                          // kept, and without one the token resolves to nothing -- "no route".
                          if (route.from === 'my_location' || route.to === 'my_location') withGps((coords) => calculate(route.from, route.to, coords));
                          else calculate(route.from, route.to);
                        }}
                        className={`flex min-h-11 w-full items-center gap-2 py-1.5 text-left ${idx > 0 ? 'border-t border-t-line' : ''}`}
                      >
                        <Navigation className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden="true" />
                        <span className="line-clamp-2 min-w-0 flex-1 break-words text-label font-semibold text-ink">
                          {placeLabel(route.from)}
                          <span className="px-1 text-ink-3" aria-hidden="true">
                            →
                          </span>
                          {placeLabel(route.to)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <span className="text-label font-bold text-ink-2 uppercase tracking-wider block mb-2">{t.planner.quickDestinations}</span>
                {/* A rail on a phone, wrapping from sm: the right shape for a shortcut, where you see the one you wanted or you type. */}
                <div className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                  {QUICK_DESTINATIONS.map((qp) => (
                    <button
                      key={qp.query}
                      onClick={() => {
                        setDestQuery(qp.query);
                        calculate(originQuery, qp.query);
                      }}
                      className={`inline-flex h-11 shrink-0 snap-start items-center whitespace-nowrap rounded-full px-3.5 text-label font-semibold transition-colors ${
                        destQuery.includes(qp.label) || destQuery === qp.query ? 'bg-accent text-on-accent' : 'bg-surface text-ink-2'
                      }`}
                    >
                      {qp.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
            </div>
          </div>
        </div>

        <div ref={answerRef} tabIndex={-1} className={`anim-rise space-y-4 lg:animate-none lg:col-span-7 lg:block ${folded ? '' : 'hidden'}`}>
          {planResult && shown ? (
            /* The column owns the rhythm; the blocks say nothing about spacing. */
            <div className="space-y-4 bg-bg rounded-card py-4 px-cap-4 sm:p-6 shadow-sm border border-edge">
              {!planResult.isServiceActive && planResult.serviceNotice && (
                <div className="p-3.5 rounded-control bg-warn border border-warn text-warn-ink text-label font-bold flex items-start gap-2.5 shadow-xs">
                  <AlertCircle className="w-4 h-4 text-estimated shrink-0 mt-0.5" />
                  <div>
                    <div className="font-extrabold uppercase tracking-wide text-estimated">{t.planner.serviceNoticeTitle}</div>
                    <div className="mt-0.5 font-medium">{planResult.serviceNotice}</div>
                  </div>
                </div>
              )}

              {/* The operator's notice on the lines this trip takes: until when they run, which stops they skip (never proposed), and the traffic cuts.
                  Folded to one line above the answer, as on the board: open by day it pushed the trip 185 px down a phone. Once a line is past
                  its last printed call where the trip boards it, its end time and whose word it is come up into that line, as on the board. */}
              {(() => {
                // Two moments: the end times running now are tonight's, and the stops and cuts the trip meets are those of the night it sets off on.
                const now = new Date();
                const tonight = changesNow(changes, now);
                const onTheDay = changesNow(changes, setsOff(planResult, plannedFrom(askedRef.current.opts)));
                const used = new Set(planResult.segments.filter((seg) => seg.type === 'bus').map((seg) => seg.line?.number));
                const late = (tonight?.lines ?? [])
                  .filter((c) => used.has(c.line))
                  .flatMap((c) => {
                    const end = runsUntil(c, now);
                    const from = planResult.segments.find((seg) => seg.type === 'bus' && seg.line?.number === c.line)?.fromStop?.id;
                    return end ? [{ line: c.line, ...end, now: !!from && pastTimetable(c, from, now) }] : [];
                  });
                const stops = (onTheDay?.lines ?? []).filter((c) => used.has(c.line) && c.closed.length + c.moved.length > 0);
                const cuts = used.size > 0 && (onTheDay?.general.length ?? 0) > 0;
                const affected = [...new Set([...late.map((l) => l.line), ...stops.map((c) => c.line)])].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
                if (!affected.length && !cuts) return null;
                const lateNow = late.filter((l) => l.now);
                const lateLater = late.filter((l) => !l.now);
                return (
                  <details className="disclosure rounded-control border border-warn bg-warn text-label text-warn-ink">
                    <summary className="flex min-h-11 cursor-pointer items-start gap-2.5 p-3.5">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-estimated" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{affected.length > 0 ? t.planner.noticeOnTrip(affected) : t.arrivals.noticeGeneral}</span>
                        {lateNow.map((l) => (
                          <span key={l.line} className="mt-1 block font-semibold">
                            {t.arrivals.noticeRunsUntil(l.line, l.time, l.to)}
                          </span>
                        ))}
                        {lateNow.length > 0 && <span className="block">{t.arrivals.noticeNoDepartures}</span>}
                      </span>
                      <ChevronDown className="disclosure-chevron mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                    </summary>
                    <div className="px-3.5 pb-1 pl-10">
                      {lateLater.map((l) => (
                        <p key={l.line} className="mt-1 first:mt-0">
                          {t.arrivals.noticeRunsUntil(l.line, l.time, l.to)}
                        </p>
                      ))}
                      {lateLater.length > 0 && <p>{t.arrivals.noticeNoDepartures}</p>}
                      {stops.flatMap((c) => [
                        ...c.closed.map((s) => (
                          <p key={`closed-${c.line}-${s.stopId}`} className="mt-1 first:mt-0">
                            {c.line}: {t.lines.noticeClosedStop(stopById(s.stopId)?.name ?? s.stopId, s.instead)}
                          </p>
                        )),
                        ...c.moved.map((s) => (
                          <p key={`moved-${c.line}-${s.stopId}`} className="mt-1 first:mt-0">
                            {c.line}: {t.lines.noticeMovedStop(stopById(s.stopId)?.name ?? s.stopId, s.to)}
                          </p>
                        )),
                      ])}
                      {affected.length > 0 && cuts && <p className="mt-1 first:mt-0">{t.arrivals.noticeGeneral}</p>}
                      {onOpenAlerts && (
                        <button onClick={onOpenAlerts} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
                          {t.lines.seeFullNotice}
                        </button>
                      )}
                    </div>
                  </details>
                );
              })()}

              {canStart && boardingSoon && startTripButton(true)}

              {/* The three numbers that answer "should I do this trip", on one baseline: how long on the left, when on the right. */}
              <div key={answered} className="anim-rise flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-3">
                <span className="flex items-baseline gap-2">
                  <span className="tnum text-num font-bold tracking-[-0.025em]">{shown.durationMinutes}</span>
                  <span className="text-body text-ink-3">{t.common.min}</span>
                </span>
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="sr-only">{t.planner.departureLabel}</span>
                  {/* Past the last bus the answer is another day's: said beside the clock, where the eye goes. */}
                  {!!planResult.daysAhead && <span className="text-body font-semibold text-estimated">{dayWord(lang, planResult.daysAhead)}</span>}
                  <span className="tnum text-emph font-semibold">{shown.departure}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 self-center text-ink-3" strokeWidth={2} aria-hidden="true" />
                  <span className="sr-only">{t.planner.arrivalLabel}</span>
                  <span className="tnum text-emph font-semibold">~{shown.arrival}</span>
                </span>
                {/* These times are for a bus the measured walk no longer reaches, and the replan found nothing better. */}
                {!shown.reachable && (
                  <span className="flex w-full items-center gap-2 rounded-md border border-warn bg-warn px-2.5 py-1.5 text-label font-bold text-warn-ink">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-estimated" aria-hidden="true" />
                    {t.planner.unreachableWalk}
                  </span>
                )}
              </div>

              {canStart && !boardingSoon && startTripButton(false)}

              {/* The small print, folded: worth reading once, not on the way to the thing that was asked for. */}
              <details className="disclosure rounded-md border border-edge bg-surface/40">
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-label font-semibold text-ink-2">
                  <span className="sr-only">{t.planner.tripInfoTitle}</span>
                  <ChevronDown className="disclosure-chevron h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
                  <span className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-mono">
                    {measuredWalk && (
                      <span className="flex flex-wrap items-baseline gap-x-1.5 text-ink">
                        <span className="sr-only">{t.planner.measuredWalkTitle}: </span>
                        <Footprints className="h-3.5 w-3.5 shrink-0 self-center text-ink-3" aria-hidden="true" />
                        <span className="whitespace-nowrap">{measuredWalk.minutes} min ·</span>
                        <span className="whitespace-nowrap">{formatKm(measuredWalk.meters)} km</span>
                      </span>
                    )}
                    {/* The ordinary fare, not the card one: a visitor pays 0,64 €. */}
                    {planResult.fare && planResult.fare.busLegs > 0 && <span className="whitespace-nowrap font-black text-ink">{planResult.fare.singleTicketEuros.toFixed(2).replace('.', ',')} €</span>}
                  </span>
                </summary>
                <div className="px-3 pb-3">
                  {measuredWalk && (
                    <div className="mt-1 flex items-center justify-between gap-3 text-label text-ink">
                      <span className="text-label font-bold uppercase tracking-wider text-ink-2">{t.planner.measuredWalkTitle}</span>
                      <span className="font-mono font-black">
                        {measuredWalk.minutes} min · {formatKm(measuredWalk.meters)} km
                      </span>
                    </div>
                  )}
                  <p className="mt-2 text-label leading-relaxed text-ink-2">
                    <span className="font-bold uppercase tracking-wider text-ink-2">{t.planner.timeProvenanceTitle}</span> {measuredWalk ? t.planner.timeProvenanceMeasured : t.planner.timeProvenance}
                  </p>
                  {planResult.fare && planResult.fare.busLegs > 0 && (
                    <div className="mt-3 border-t border-line pt-2 text-label text-ink">
                      {/* Both fares, neither struck through: the ordinary one applies to everyone without a card. */}
                      <span className="mb-1 block text-label font-bold uppercase tracking-wider text-ink-2">{t.planner.fareTitle}</span>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-label text-ink">{t.planner.fareSingle}</span>
                        <span className="tnum text-body font-black text-ink">{planResult.fare.singleTicketEuros.toFixed(2).replace('.', ',')} €</span>
                      </div>
                      <div className="mt-1 flex items-baseline justify-between gap-3">
                        <span className="text-label text-ink-2">{t.planner.fareCard}</span>
                        <span className="tnum text-label font-semibold text-ink-2">{planResult.fare.citizenCardEuros.toFixed(2).replace('.', ',')} €</span>
                      </div>
                      {planResult.fare.busLegs > 1 && <span className="mt-1.5 block text-label text-estimated">{planResult.fare.transfersFree ? t.planner.fareTransferFree : t.planner.fareTransferPaid}</span>}
                    </div>
                  )}
                  {planResult.totalWaitMinutes > 0 && (
                    <div className="mt-2 flex items-center gap-2 text-label text-ink-2">
                      <Clock className="h-3.5 w-3.5 shrink-0 text-estimated" />
                      <span>{t.planner.includesWait(planResult.totalWaitMinutes)}</span>
                    </div>
                  )}
                </div>
              </details>

              {planOptions.length > 1 && <TripOptions options={ranked} chosen={chosen} onChoose={setChosenOption} correctionFor={correction} resetKey={questions} />}

              {/* Reading a list of streets is much harder than seeing the shape of the trip. */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-x-2 mb-2">
                  <SectionLabel icon={MapPin} className="">
                    {t.planner.routeMap}
                  </SectionLabel>
                  <button onClick={() => setShowMap((v) => !v)} className="text-label font-semibold text-accent h-11 inline-flex items-center underline">
                    {showMap ? t.planner.hideMap : t.planner.showMap}
                  </button>
                </div>
                <div className={`fold ${showMap ? '' : 'fold-closed'}`}>
                  <div className="relative">
                    <Suspense fallback={<div className="w-full h-[240px] sm:h-[280px] rounded-card bg-surface animate-pulse" />}>
                      <RouteMap plan={planResult} origin={endpoints.origin} destination={endpoints.destination} walkPaths={walkPaths} className="w-full h-[240px] sm:h-[280px] rounded-card overflow-hidden border border-edge z-0" />
                    </Suspense>
                    {/* The map ends at the fold on a phone, so the chip that says the trip is written out further down sits on it. */}
                    <button
                      type="button"
                      onClick={() => stepsRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })}
                      className="absolute left-1/2 top-0 z-[500] flex h-11 -translate-x-1/2 items-center px-2"
                    >
                      {/* One line: from the middle of the map it had half the width, and at 200% text
                          it broke into three and covered the route. */}
                      <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-accent bg-bg/90 px-3 py-1.5 text-label font-semibold text-ink shadow-sm backdrop-blur-sm">
                        {t.planner.stepByStepTitle}
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.5} aria-hidden="true" />
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              <div ref={stepsRef} className="scroll-mt-3">
                <span className="text-label font-bold text-ink-2 uppercase tracking-wider block mb-2">{t.planner.stepByStepTitle}</span>
                <Itinerary segments={planResult.segments} onSelectStop={onSelectStop} onSelectLine={onSelectLine} />
              </div>

              <div className="p-3 rounded-control bg-warn border border-warn flex items-start gap-2.5 text-label text-warn-ink font-medium">
                <AlertCircle className="w-4 h-4 text-estimated shrink-0 mt-0.5" />
                <span>{t.planner.transferFreeNotice}</span>
              </div>
            </div>
          ) : (
            <div className="bg-bg rounded-card py-8 px-cap-8 text-center border border-edge">
              <AlertCircle className="w-8 h-8 text-ink-3 mx-auto mb-2" />
              <p className="text-body text-ink-2 font-medium">{timeMode === 'arrive' ? t.planner.noArriveOption : t.planner.noRouteFound}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

