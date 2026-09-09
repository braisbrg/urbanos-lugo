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
  Check,
  ChevronDown,
} from 'lucide-react';
import { BusStop, BusLine, RoutePlanResult } from '../types';
import { BUS_STOPS } from '../data/transitData';
import { formatMinutes, parseTimeToMinutes } from '../utils/schedule';
import { planTrips, resolveLocationQuery, estimateWalk, LONG_WAIT_MIN, LUGO_LANDMARKS, QUICK_DESTINATIONS } from '../utils/transitEngine';
import { getDistanceMeters } from '../utils/geo';
import { fetchWalkingPath, walkHopKey, walkHopsOf, WalkingPath } from '../services/walkingPath';
import { useRecentRoutes } from '../hooks/useRecentRoutes';
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

/** Move an "HH:MM" label by a signed number of minutes, wrapping past midnight. */
function shiftClock(hhmm: string, deltaMinutes: number): string {
  if (!deltaMinutes) return hhmm;
  // The wrap past midnight and the zero padding both already live in formatMinutes —
  // same `((n % 1440) + 1440) % 1440`, same padStart — and parsing is what
  // parseTimeToMinutes is for. This had its own copy of all three.
  return formatMinutes(parseTimeToMinutes(hhmm) + deltaMinutes);
}

/**
 * How far out the estimated walk was, split by whether it can cost you the bus.
 *
 * `before` is the walk to the first stop; `after` is every other walked hop, which
 * happens once the first bus has been boarded. Both are minutes, and either can be
 * negative when the real pavement turns out shorter than the straight line suggested.
 */
interface WalkCorrection {
  before: number;
  after: number;
}

const NO_CORRECTION: WalkCorrection = { before: 0, after: 0 };

/**
 * The plan, once the pedestrian router has said how long the walk really is.
 *
 * The bus leaves when it leaves, so a walk that turns out longer than the estimate does
 * not delay the arrival — it delays *you*, and the only thing it can eat is the cushion
 * the plan already handed back as a later departure. This used to add the whole
 * correction to the arrival, which put the reader at HULA two minutes after a bus that
 * gets there at 09:50 whatever anybody walks.
 *
 * A shorter walk is the same fact the other way round: set off later, land at the same
 * minute. Only a correction bigger than the cushion can move the arrival, and then it
 * moves it because the bus has gone.
 */
function withMeasuredWalk(plan: RoutePlanResult, fix: WalkCorrection) {
  /*
   * Only the walk before the bus can spend the cushion.
   *
   * The cushion is the minutes between now and when the plan says to set off, and it
   * exists because the bus is not there yet. A walk that turns out longer eats into it —
   * but only a walk you do *before* boarding. The one after you get off cannot make you
   * miss anything; it just lands you later.
   *
   * This charged the whole correction against it, which is a category error: measured
   * over 1.015 options with a bus in them, 330 were judged to have eaten the cushion and
   * only 239 of those had done it with the walk that could. The other ninety were flagged
   * for a stroll they take after the bus has already gone.
   */
  const absorbed = Math.min(fix.before, plan.slackMinutes);
  /*
   * What the cushion could not absorb is not lateness. It is a missed bus.
   *
   * Setting off `fix.before` minutes earlier than the plan says is only possible while
   * there is cushion to spend. Past that the departure would be before now, which has
   * already happened -- so the reader does not board that bus at all, and the arrival it
   * would have given is a time nobody can reach. Measured over 1,017 options with a bus,
   * 180 of them (18%) were showing exactly that.
   *
   * So the arrival is left alone and the option says what is true: with the walk as
   * measured, this one is gone. The view replans once from the real walk before it
   * settles for saying so.
   */
  const missedBy = fix.before - absorbed;
  return {
    reachable: missedBy <= 0,
    missedBy,
    departure: shiftClock(plan.departureTime, -absorbed),
    arrival: shiftClock(plan.arrivalTime, fix.after),
    durationMinutes: plan.durationMinutes + absorbed + fix.after,
  };
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
  /** A place picked in the search box. The counter makes asking twice two requests. */
  destinationRequest?: { query: string; nonce: number } | null;
  lang: Lang;
}

export const RoutePlannerView: React.FC<RoutePlannerViewProps> = ({
  onSelectStop,
  onSelectLine,
  destinationRequest,
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

  const [recentRoutes, rememberRoute, clearRecentRoutes] = useRecentRoutes();

  const [showMap, setShowMap] = useState(true);
  /** Where the button on the map jumps to. */
  const stepsRef = useRef<HTMLDivElement>(null);
  /*
   * There is no longer a question to ask.
   *
   * This was a button, and before it a promise the code was not keeping. Asking the
   * reader's permission was right while a walking route meant sending one end of it —
   * often their own GPS fix — to somebody else's server. The app carries the pedestrian
   * network of Lugo now and works the route out here, so nothing leaves, nothing is
   * asked, and every plan is measured rather than estimated.
   */
  const [walkPaths, setWalkPaths] = useState<Record<string, WalkingPath | null>>({});

  // Fetch the real pedestrian route for each walked hop of the chosen plan. The times
  // it returns replace the offline estimate, which is off by up to 14 minutes on the
  // awkward crossings (see WALK_DETOUR_FACTOR).
  const walkHops = React.useMemo(
    () => walkHopsOf(planResult, endpoints.origin, endpoints.destination),
    [planResult, endpoints],
  );

  /**
   * The same hops for every option on offer, not just the open one.
   *
   * Correcting only the chosen plan put two totals for one trip on one screen -- a card
   * reading 41 min above a detail reading 52 -- and, worse, made the four options
   * comparable only by their estimates. Options share endpoints, so most hops are the
   * same string and the session cache answers them without a request.
   */
  const shownOptions = React.useMemo(() => planOptions.slice(0, MAX_OPTIONS), [planOptions]);

  const allWalkHops = React.useMemo(() => {
    const seen = new Map<string, [number, number][]>();
    for (const option of shownOptions) {
      for (const hop of walkHopsOf(option, endpoints.origin, endpoints.destination)) {
        seen.set(walkHopKey(hop[0], hop[1]), hop);
      }
    }
    return [...seen.values()];
  }, [shownOptions, endpoints]);

  /**
   * The real pedestrian route for every walked hop of every option on offer.
   *
   * No guard and no connection check any more: the router is in the bundle, so this runs
   * on every plan and works with the radio off. What it can still return is null, and
   * that means there is no pedestrian route at all — not that the answer is unknown.
   */
  useEffect(() => {
    if (!allWalkHops.length) return;
    const controller = new AbortController();
    // Each leg lands as it is worked out. This was a queue at one request a second,
    // because that is what FOSSGIS asked of anyone using their server; a four-option
    // plan took nine seconds to fill in. It now takes about six milliseconds.
    for (const [a, b] of allWalkHops) {
      fetchWalkingPath(a, b, controller.signal)
        .then((path) => {
          if (controller.signal.aborted) return;
          setWalkPaths((prev) => ({ ...prev, [walkHopKey(a, b)]: path }));
        })
        .catch(() => {
          // Aborted, or the router is unreachable. The estimate is already on screen.
        });
    }
    return () => controller.abort();
  }, [allWalkHops]);

  /**
   * The options worth offering, which is not always all of them.
   *
   * "Todo a pé" is built from the straight line between the two ends, and it is ranked on
   * `durationMinutes` against bus options whose times come from the operator's timetable.
   * So when it is wrong it does not merely print a wrong number: it can put walking at the
   * top of the list. Once the router has answered, a walk-only option it could not route
   * is withdrawn rather than left standing on the estimate — for the N-VI stops out at
   * Ombreiro that estimate is a six-kilometre stroll across fields, and there is no
   * pavement there at all. Every other option keeps its bus legs, which were never
   * estimates, so only this one can disappear.
   */
  const offeredOptions = React.useMemo(() => {
    return shownOptions
      .map((option, idx) => ({ option, idx }))
      .filter(({ option }) => {
        const walksTheWholeWay = !option.segments.some((segment) => segment.type === 'bus');
        if (!walksTheWholeWay) return true;
        const hops = walkHopsOf(option, endpoints.origin, endpoints.destination);
        // Still waiting on the router is not the same as being told there is no route.
        return hops.every(([a, b]) => {
          const key = walkHopKey(a, b);
          return !(key in walkPaths) || walkPaths[key] !== null;
        });
      });
  }, [shownOptions, walkPaths, endpoints]);

  /**
   * How many alternatives stand on the screen before you ask for the rest.
   *
   * Four rows were 183 px of a 674 px column to answer a question most readers do not
   * have: the first option is the answer and the second is the alternative somebody
   * would actually weigh. The third and fourth are there for the person who knows the
   * network and wants a particular line, and that person will press a button.
   */
  const VISIBLE_OPTIONS = 2;
  const [showAllOptions, setShowAllOptions] = useState(false);
  // Never fold away the row that is currently open: it would take the reader's own
  // choice off the screen and leave the detail below it unexplained.
  const optionsExpanded = showAllOptions || chosenOption >= VISIBLE_OPTIONS;
  const visibleOptions = optionsExpanded ? offeredOptions : offeredOptions.slice(0, VISIBLE_OPTIONS);

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
  const correctionFor = React.useCallback(
    (plan: RoutePlanResult | null) => {
      if (!plan) return NO_CORRECTION;
      const hops = walkHopsOf(plan, endpoints.origin, endpoints.destination);
      const measured = hops.map(([a, b]) => walkPaths[walkHopKey(a, b)]);
      // All or nothing: half-measured totals would be neither the estimate nor the truth.
      if (!hops.length || measured.some((w) => !w)) return NO_CORRECTION;

      /*
       * The estimate for the same hops, not the plan's walk segments.
       *
       * Those are not the same set. A transfer between two different stops is walked --
       * `walkHopsOf` returns a hop for it and the router answers it -- but the itinerary
       * has no walk segment for that hop, only a gap in the clock between getting off at
       * 16:52 and the next wait starting at 16:56. Subtracting the segments from the hops
       * therefore counted the whole transfer walk as if it were new: measured over 563
       * options with a transfer, 105 walked a hop they had no segment for and the
       * correction came out 1 min too big at the median and 2 at the worst.
       *
       * `estimateWalk` on each hop is what the planner used to build those minutes in the
       * first place, so this compares like with like whatever the segments happen to say,
       * and stays right if the itinerary ever grows the missing leg.
       */
      /*
       * Split, because the two halves do different things.
       *
       * `walkHopsOf` puts the walk to the first stop first and everything else after it,
       * so the first hop is the only one taken before boarding — and the only one that
       * can cost the reader the bus. See `withMeasuredWalk`.
       *
       * A plan with no bus in it has nothing to miss, so all of its correction is "after"
       * and the cushion is left alone.
       */
      const ridesABus = plan.segments.some((s) => s.type === 'bus');
      // What the plan itself allowed for the walk to the first stop. Usually the estimate,
      // because that is all the planner had -- but once a measured walk has been handed
      // back to `planTrips`, the plan is already built on the real one and charging the
      // difference a second time would move a departure that is already right.
      const planned = plan.segments[0]?.type === 'walk' ? plan.segments[0].durationMinutes : undefined;
      let before = 0;
      let after = 0;
      hops.forEach(([a, b], i) => {
        const estimate =
          i === 0 && planned !== undefined
            ? planned
            : estimateWalk(getDistanceMeters(a[0], a[1], b[0], b[1])).minutes;
        const diff = (measured[i] as WalkingPath).minutes - estimate;
        if (i === 0 && ridesABus) before += diff;
        else after += diff;
      });
      return { before, after };
    },
    [walkPaths, endpoints],
  );

  const walkCorrection = correctionFor(planResult);

  /**
   * Ask again when the measured walk has already cost the reader the bus.
   *
   * The plan is built from the estimated walk (straight line x 1.35) and the router then
   * measures the real pavement. When the walk to the first stop turns out longer than the
   * cushion the plan handed back as a later departure, setting off in time would mean
   * setting off before now — the bus is gone. Measured over 1,017 options with a bus in
   * them, 180 were being shown with an arrival on a bus the reader could not catch.
   *
   * Patching the clock is the wrong answer: it would print a time that exists nowhere. So
   * the question is asked again as if the reader set off `missedBy` minutes later, which
   * is exactly the debt the estimate ran up. Every plan that comes back then departs late
   * enough for the same walk to fit.
   *
   * Once, and only once. The new plan may board somewhere else, whose walk is measured
   * again and can be wrong in its own way; going round a second time can oscillate
   * between two boarding points forever. If the second answer still does not reach, the
   * option says so — see `withMeasuredWalk`.
   */
  useEffect(() => {
    if (replannedRef.current || !planResult) return;
    const shown = withMeasuredWalk(planResult, walkCorrection);
    if (shown.reachable) return;
    replannedRef.current = true;
    const { orig, dest, opts } = askedRef.current;
    /*
     * Hand back every walk the router has already traced, keyed by the stop it leads to.
     *
     * Shifting the clock instead was the first attempt and it barely moved: asked again
     * at a later minute the planner still ranks its boarding stops on the straight-line
     * estimate, so it picks a different wrong stop. Measured over 312 questions, the
     * answer on screen was unreachable in 47 of them; moving the clock left 39, handing
     * the measurements over leaves 34. What is left boards somewhere nobody has measured
     * yet, and it says so rather than guessing again.
     */
    const known = new Map<string, number>();
    for (const option of shownOptions) {
      const boarding = option.segments.find((seg) => seg.type === 'bus')?.fromStop;
      const first = walkHopsOf(option, endpoints.origin, endpoints.destination)[0];
      if (!boarding || !first) continue;
      const path = walkPaths[walkHopKey(first[0], first[1])];
      if (path) known.set(boarding.id, path.minutes);
    }
    const again = planTrips(orig, dest, {
      ...opts,
      lang,
      measuredWalkToStop: (id) => known.get(id),
    });
    // Nothing better exists at the later time: keep what is on screen, marked.
    if (!again.length) return;
    setPlanOptions(again);
    setChosenOption(0);
  }, [planResult, walkCorrection, lang]);

  /**
   * On a phone the form is 352 px and the quick destinations another 235, so the
   * answer to what you just asked started below the second screenful. Once there is
   * a plan the form folds to a one-line summary; it is still sticky and always open
   * from `lg` up, where there is room for both.
   */
  const [formOpen, setFormOpen] = useState(true);

  /**
   * Whether the reader has asked for anything yet.
   *
   * The screen opens on a worked example -- Fonte dos Ranchos to HULA, already
   * planned -- which shows a desktop visitor what the tool answers with. On a phone
   * it put 2,200 px of somebody else's trip between you and the two fields you came
   * to fill in, so there it waits until you have asked something.
   */
  const [asked, setAsked] = useState(false);

  // "Now" is the common case, but the question before an appointment is the other one.
  const [timeMode, setTimeMode] = useState<'now' | 'depart' | 'arrive'>('now');
  const [timeValue, setTimeValue] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });

  const t = translations(lang);

  // Recalculate route whenever queries or user location change
  /**
   * The question the plans on screen are answering.
   *
   * Not the fields: somebody can type a new origin without pressing the button, and a
   * replan that used those would silently answer a question nobody asked.
   */
  const askedRef = useRef({
    orig: 'Fonte dos Ranchos',
    dest: 'Hospital Lucus Augusti (HULA)',
    gps: undefined as [number, number] | undefined,
    opts: {} as { userLocation?: [number, number]; departAt?: number; arriveBy?: number },
  });
  /** One replan per question, and no more. See the effect that uses it. */
  const replannedRef = useRef(false);

  const timeOptions = () => {
    const [h, m] = timeValue.split(':').map(Number);
    const minutes = (h || 0) * 60 + (m || 0);
    if (timeMode === 'depart') return { userLocation, departAt: minutes };
    if (timeMode === 'arrive') return { userLocation, arriveBy: minutes };
    return { userLocation };
  };

  const handleCalculate = (orig = originQuery, dest = destQuery, gps = userLocation) => {
    if (!orig.trim() || !dest.trim()) return;
    const opts = { ...timeOptions(), userLocation: gps };
    askedRef.current = { orig, dest, gps, opts };
    replannedRef.current = false;
    const plans = planTrips(orig, dest, { ...opts, lang });
    setPlanOptions(plans);
    setChosenOption(0);
    // A new question gets the short list again.
    setShowAllOptions(false);
    // Answering is what folds the form away. A search that found nothing leaves it
    // open, because the next thing to do is change what you asked for.
    setAsked(true);
    if (plans.length) {
      setFormOpen(false);
      rememberRoute({ from: orig, to: dest });
    }
    setEndpoints({
      origin: toPoint(resolveLocationQuery(orig, gps)),
      destination: toPoint(resolveLocationQuery(dest, gps)),
    });
    setActiveInput(null);
  };

  /**
   * A place chosen in the search box arrives here as the destination, already planned.
   *
   * Landing on the form with the field filled and no answer would make the search feel
   * like it had lost the thing you asked for, so the trip is calculated on arrival — from
   * whatever origin is already set, which the reader can then change.
   */
  useEffect(() => {
    if (!destinationRequest) return;
    setDestQuery(destinationRequest.query);
    handleCalculate(originQuery, destinationRequest.query);
    // Only when a new request arrives: `originQuery` changing is the reader typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationRequest?.nonce]);

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
      score: calculateRelevanceScore(s.name, s.code, s.id, q, s.zone),
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
          {/* What you asked for, in one line, and the way in and out of the fields.
              A line, not a card. It was a bordered box with its own fill and shadow,
              which is the same weight the answer below it carries and twice what a
              breadcrumb needs -- it read as a second panel rather than as the heading of
              the one underneath. The chrome is gone and the row keeps its 44 px target.

              It used to disappear the moment the fields opened, which left the screen
              with no way back: `setFormOpen(false)` only ran on a successful search, so
              somebody who opened the fields to look and changed their mind had to run
              another search to get out. Now the row stays, and it closes what it opened. */}
          {asked && (
            <button
              type="button"
              onClick={() => setFormOpen(!formOpen)}
              aria-expanded={formOpen}
              className="flex min-h-11 w-full items-center gap-2 px-1 text-left lg:hidden"
            >
              <Navigation className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <span
                title={`${originQuery} → ${destQuery}`}
                className="min-w-0 flex-1 truncate text-label font-semibold text-ink"
              >
                {originQuery} → {destQuery}
              </span>
              <span className="shrink-0 text-label font-semibold text-accent underline">
                {formOpen ? t.planner.backToAnswer : t.planner.editTrip}
              </span>
            </button>
          )}

          <div
            className={`bg-bg rounded-xl p-3.5 sm:p-6 shadow-sm border border-edge ${
              asked && !formOpen ? 'hidden lg:block' : ''
            }`}
          >
            {/* You got here by pressing a tab called "Ruta", so a heading and a sentence
                explaining the screen are furniture on the screen they explain. Measured on
                a 375x812 the whole form needs 762 px and has 619 to live in, so the
                furniture is what goes. The heading stays for the document outline and for
                anyone arriving by screen reader, which is the only thing it was doing. */}
            <h2 className="sr-only">{t.planner.title}</h2>

            {/* Where from, where to: one control, not two forms with a button between.
                It was a label row, a GPS button of its own, a field, a centred swap, a
                second label row and a second field -- 194 px of the 762 the form needs,
                before any of it was the thing you came to type. The labels are still here
                for a screen reader; the dot and the ring say the same thing to an eye, and
                the placeholders already carry "street, place or stop". */}
            <div className="relative">
              <div className="relative rounded-xl border border-edge bg-surface">
                {/* Origin Input */}
                <div className="relative">
                  <label htmlFor="input-origin-query" className="sr-only">
                    {t.planner.origin}
                  </label>
                  <span
                    className="pointer-events-none absolute left-5 top-0 flex h-12 items-center text-ink-2"
                    aria-hidden="true"
                  >
                    <span className="h-2 w-2 rounded-full bg-ink-2" />
                  </span>
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
                    className="h-12 w-full bg-transparent pl-11 pr-12 text-body font-semibold text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent focus:rounded-t-xl"
                  />
                  {/* The GPS is one way of filling this field, not a peer of "calculate",
                      so it sits in the field like the clear button rather than above it. */}
                  <button
                    onClick={handleUseGpsForOrigin}
                    aria-label={isLocating ? t.planner.locating : t.planner.useMyLocation}
                    title={isLocating ? t.planner.locating : t.planner.useMyLocation}
                    className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-accent"
                  >
                    <LocateFixed className={`h-[18px] w-[18px] ${isLocating ? 'animate-pulse' : ''}`} />
                  </button>

                  {/* Origin Autocomplete Suggestions */}
                  {activeInput === 'origin' && originSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-bg border border-edge rounded-lg shadow-lg z-30 divide-y divide-line max-h-56 overflow-y-auto">
                      {originSuggestions.map((sug) => (
                        <button
                          key={sug.id || sug.name}
                          type="button"
                          onClick={() => {
                            setOriginQuery(sug.name);
                            setActiveInput(null);
                            handleCalculate(sug.name, destQuery);
                          }}
                          className="w-full p-2.5 text-label hover:bg-surface cursor-pointer flex items-center justify-between gap-2 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <MapPin className="w-3.5 h-3.5 text-accent shrink-0" />
                            <span className="truncate font-bold text-ink" title={sug.name}>{sug.name}</span>
                          </div>
                          {sug.code && (
                            <span className="text-label font-mono font-bold bg-surface text-ink-2 px-1.5 py-0.5 rounded shrink-0">
                              #{sug.code}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mx-3.5 border-t border-line" aria-hidden="true" />

                {/* Destination Input */}
                <div className="relative">
                  <label htmlFor="input-dest-query" className="sr-only">
                    {t.planner.destination}
                  </label>
                  <span
                    className="pointer-events-none absolute left-5 top-0 flex h-12 items-center text-ink-2"
                    aria-hidden="true"
                  >
                    <span className="h-2 w-2 rounded-full border-2 border-ink-2" />
                  </span>
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
                    className="h-12 w-full bg-transparent pl-11 pr-12 text-body font-semibold text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent focus:rounded-b-xl"
                  />
                  {destQuery && (
                    <button
                      onClick={() => setDestQuery('')}
                      aria-label={t.search.clear}
                      className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-label text-ink-3"
                    >
                      ✕
                    </button>
                  )}

                  {/* Dest Autocomplete Suggestions */}
                  {activeInput === 'dest' && destSuggestions.length > 0 && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-bg border border-edge rounded-lg shadow-lg z-30 divide-y divide-line max-h-56 overflow-y-auto">
                      {destSuggestions.map((sug) => (
                        <button
                          key={sug.id || sug.name}
                          type="button"
                          onClick={() => {
                            setDestQuery(sug.name);
                            setActiveInput(null);
                            handleCalculate(originQuery, sug.name);
                          }}
                          className="w-full p-2.5 text-label hover:bg-surface cursor-pointer flex items-center justify-between gap-2 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <MapPin className="w-3.5 h-3.5 text-warn-ink shrink-0" />
                            <span className="truncate font-bold text-ink" title={sug.name}>{sug.name}</span>
                          </div>
                          {sug.code && (
                            <span className="text-label font-mono font-bold bg-surface text-ink-2 px-1.5 py-0.5 rounded shrink-0">
                              #{sug.code}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* One swap for both rows, on the edge where a thumb already is. */}
                <button
                  id="btn-swap-stops"
                  onClick={handleSwap}
                  className="absolute left-1 top-1/2 flex h-11 w-11 -translate-x-1 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 before:absolute before:h-9 before:w-9 before:rounded-full before:border before:border-edge before:bg-bg before:shadow-xs"
                  aria-label={t.planner.swap}
                  title={t.planner.swap}
                >
                  {/* Above the disc the pseudo-element draws, not under it. */}
                  <ArrowDownUp className="relative h-4 w-4" />
                </button>
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
              {/* No sparkle. Nothing here is magic: it reads a printed timetable and does
                  arithmetic, and a wand over that button promises a different kind of
                  answer than the one this app gives. */}
              <button
                onClick={() => handleCalculate()}
                className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-accent px-4 text-body font-semibold text-on-accent transition-colors"
              >
                <span>{t.planner.calculate}</span>
                <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>

            {/* Quick Destinations. Gone from the phone once there is a plan: eight
                chips of "where to?" under an answer to that very question. */}
            {/* Folded away with the form, and back when the form is.
                This hid on `asked` alone, so after the first search the shortcuts never
                returned on a phone even with the fields reopened — which is exactly when
                somebody wants them, and the only moment the list of your own trips is any
                use at all. The form itself has always used this rule. */}
            <div
              className={`mt-5 space-y-4 border-t border-line pt-4 ${
                asked && !formOpen ? 'hidden lg:block' : ''
              }`}
            >
              {/* Your own trips first, then everybody's.
                  The shortcuts below are the places most people in Lugo ask for; this is
                  the one trip you ask for twice a day. It only appears once there is one,
                  so a first visit sees exactly what it saw before. */}
              {recentRoutes.length > 0 && (
                <div>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="text-label font-bold uppercase tracking-wider text-ink-2">
                      {t.planner.recentRoutes}
                    </span>
                    <button
                      type="button"
                      onClick={clearRecentRoutes}
                      className="inline-flex h-11 items-center text-label font-semibold text-accent underline"
                    >
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
                          handleCalculate(route.from, route.to);
                        }}
                        className={`flex min-h-11 w-full items-center gap-2 py-1.5 text-left ${
                          idx > 0 ? 'border-t border-t-line' : ''
                        }`}
                      >
                        <Navigation className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-label font-semibold text-ink">
                          {route.from}
                          <span className="px-1 text-ink-3" aria-hidden="true">→</span>
                          {route.to}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
              <span className="text-label font-bold text-ink-2 uppercase tracking-wider block mb-2">{t.planner.quickDestinations}</span>
              {/* A rail on a phone, wrapping from sm: up.
                  Six pills of 44 px in two columns measured 194 px on a 375x812 -- a
                  quarter of a form that already did not fit. A rail is the right shape for
                  a shortcut, where you either see the one you wanted or you type; it would
                  be the wrong shape for the alternatives further down, which are the answer
                  and have to be seen whole. Same pattern as the line rail on the map. */}
              <div className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                {quickPicks.map((qp, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setDestQuery(qp.query);
                      handleCalculate(originQuery, qp.query);
                    }}
                    className={`inline-flex h-11 shrink-0 snap-start items-center whitespace-nowrap rounded-full px-3.5 text-label font-semibold transition-colors ${
                      destQuery.includes(qp.label) || destQuery === qp.query
                        ? 'bg-accent text-on-accent'
                        : 'bg-surface text-ink-2'
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

        {/* Right Column: Route Result & Step by Step Itinerary */}
        {/* The fields and the answer take turns on a phone.
            Reopening the fields used to leave the previous answer underneath them: the
            trip you were still editing pushed 410 px down the page, behind the fields,
            your recent trips and the shortcuts, at 0.60 of a screen instead of 0.09. The
            row above keeps the trip in sight while you edit, so nothing is lost by
            standing the detail down until there is a new answer. From `lg` up both fit
            side by side and neither hides. */}
        <div className={`space-y-4 lg:col-span-7 lg:block ${asked && !formOpen ? '' : 'hidden'}`}>
          {planResult ? (
            /* One rhythm, declared once.
               Every block in here carried its own bottom margin -- mb-4, mb-5, mt-3, mt-6
               -- and they drifted: measured down the column the gaps ran 20, 0, 20, 20, 24
               px, so the alternatives sat flush against the folded box above them while
               everything else breathed. Nobody can keep six numbers in step by hand. The
               column owns the spacing now, the way every other view in this app already
               does, and the blocks say nothing about it. */
            <div className="space-y-4 bg-bg rounded-xl p-6 shadow-sm border border-edge">
              {/* Out of service notice */}
              {!planResult.isServiceActive && planResult.serviceNotice && (
                <div className="p-3.5 rounded-lg bg-warn border border-warn text-warn-ink text-label font-bold flex items-start gap-2.5 shadow-xs">
                  <AlertCircle className="w-4 h-4 text-estimated shrink-0 mt-0.5" />
                  <div>
                    <div className="font-extrabold uppercase tracking-wide text-estimated">{t.planner.serviceNoticeTitle}</div>
                    <div className="mt-0.5 font-medium">{planResult.serviceNotice}</div>
                  </div>
                </div>
              )}

              {/* The three numbers that answer "should I do this trip": how long it
                  takes, when to leave, when you land. On the page ground rather than a
                  solid slab — a coloured block here fought the provenance chips, which
                  are the only things on this screen that should read as badges. */}
              {/* One line, not two.
                  The same three numbers used to take 82 px across two rows, with "Salida"
                  and "Llegada" spelling out what an arrow between two clocks already says.
                  They sit on one baseline now: how long on the left, when on the right.
                  The two words stay for a screen reader, which gets "16:48 17:31" and no
                  arrow to read. */}
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-3">
                <span className="flex items-baseline gap-2">
                  <span className="tnum text-num font-bold tracking-[-0.025em]">
                    {withMeasuredWalk(planResult, walkCorrection).durationMinutes}
                  </span>
                  <span className="text-body text-ink-3">{t.common.min}</span>
                </span>

                <span className="flex items-baseline gap-2">
                  <span className="sr-only">{t.planner.departureLabel}</span>
                  <span className="tnum text-emph font-semibold">
                    {withMeasuredWalk(planResult, walkCorrection).departure}
                  </span>
                  <ArrowRight className="h-[15px] w-[15px] shrink-0 self-center text-ink-3" strokeWidth={2} aria-hidden="true" />
                  <span className="sr-only">{t.planner.arrivalLabel}</span>
                  <span className="tnum text-emph font-semibold">
                    ~{withMeasuredWalk(planResult, walkCorrection).arrival}
                  </span>
                </span>
                {/* The one thing that must not be quiet: these times are for a bus the
                    measured walk no longer reaches. The planner already asked again from
                    the real walk; this is what is left when that found nothing better. */}
                {!withMeasuredWalk(planResult, walkCorrection).reachable && (
                  <span className="flex w-full items-center gap-2 rounded-md border border-warn bg-warn px-2.5 py-1.5 text-label font-bold text-warn-ink">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-estimated" aria-hidden="true" />
                    {t.planner.unreachableWalk}
                  </span>
                )}
              </div>

                {/* The small print, folded.
                    Four boxes -- the walk, where the times come from, the fare, the waiting
                    -- used to sit between the answer and the alternatives, which on a phone
                    pushed both the alternatives and the map off the bottom of the screen.
                    They are worth reading once, not on the way to the thing that was asked
                    for. The summary keeps the two figures people actually scan for, so
                    folded is still an answer rather than a locked drawer. */}
                <details className="rounded-md border border-edge bg-surface/40">
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-label font-semibold text-ink-2">
                    {/* The label was the least informative word on the line, and adding the
                        footprint to say what the figures were pushed the row onto two
                        lines. What is left says it without it: a footprint, a walk, a fare.
                        The word stays for a screen reader, which has no icon to read. */}
                    <span className="sr-only">{t.planner.tripInfoTitle}</span>
                    <ChevronDown className="h-[15px] w-[15px] shrink-0 text-ink-3" strokeWidth={2} aria-hidden="true" />
                    {/* Spread, not flushed right. Both figures were pushed to the right
                        edge, which left the whole middle of a 44 px row empty and the
                        chevron stranded on its own at the far left. They are two separate
                        facts — the walk and the fare — so they take the two ends. */}
                    <span className="flex flex-1 items-baseline justify-between gap-3 font-mono">
                      {/* Say what the numbers are.
                          The folded line read "Información  10 min · 0,5 km  0,64 €", and
                          the pair in the middle could have been anything -- the trip, the
                          bus, the wait. It is the walking, and a summary you have to open
                          to understand is not doing the job a summary is for. The footprint
                          says it in the width the line has; the label under it says it in
                          words for a screen reader. */}
                      {measuredWalk && (
                        <span
                          className="flex items-baseline gap-1.5 text-ink"
                          aria-label={`${t.planner.measuredWalkTitle}: ${measuredWalk.minutes} min, ${(measuredWalk.meters / 1000).toFixed(1).replace('.', ',')} km`}
                        >
                          <Footprints className="h-[13px] w-[13px] shrink-0 self-center text-ink-3" aria-hidden="true" />
                          {measuredWalk.minutes} min · {(measuredWalk.meters / 1000).toFixed(1).replace('.', ',')} km
                        </span>
                      )}
                      {/* The ordinary fare, not the card one.
                          This showed 0,45 € -- the Tarxeta Cidadá price -- as the price of
                          the trip, which assumes the reader has a card issued by Lugo city
                          council. Somebody visiting pays 0,64 € and was told otherwise by
                          the only number on the summary line. The discount is real and it
                          is one line below; it is not the default. */}
                      {planResult.fare && planResult.fare.busLegs > 0 && (
                        <span className="font-black text-ink">
                          {planResult.fare.singleTicketEuros.toFixed(2).replace('.', ',')} €
                        </span>
                      )}
                    </span>
                  </summary>

                  <div className="px-3 pb-3">
                    {measuredWalk && (
                      <div className="mt-1 flex items-center justify-between gap-3 text-label text-ink">
                        <span className="text-label font-bold uppercase tracking-wider text-ink-2">
                          {t.planner.measuredWalkTitle}
                        </span>
                        <span className="font-mono font-black">
                          {measuredWalk.minutes} min · {(measuredWalk.meters / 1000).toFixed(1).replace('.', ',')} km
                        </span>
                      </div>
                    )}

                    {/* Say plainly where these numbers come from. The departure can be a
                        published time; everything after it is computed. */}
                    <p className="mt-2 text-label leading-relaxed text-ink-2">
                      <span className="font-bold uppercase tracking-wider text-ink-2">
                        {t.planner.timeProvenanceTitle}
                      </span>{' '}
                      {measuredWalk ? t.planner.timeProvenanceMeasured : t.planner.timeProvenance}
                    </p>

                    {planResult.fare && planResult.fare.busLegs > 0 && (
                      <div className="mt-3 border-t border-line pt-2 text-label text-ink">
                        {/* Both fares, neither struck through.
                            The ordinary one was crossed out beside the card price, which is
                            the idiom of a shop sale: it reads as "this price no longer
                            applies". It applies to everyone without a Tarxeta Cidadá, which
                            is every visitor. Two rows, each labelled, and the one anybody
                            pays comes first. */}
                        <span className="mb-1 block text-label font-bold uppercase tracking-wider text-ink-2">
                          {t.planner.fareTitle}
                        </span>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-label text-ink">{t.planner.fareSingle}</span>
                          <span className="tnum text-body font-black text-ink">
                            {planResult.fare.singleTicketEuros.toFixed(2).replace('.', ',')} €
                          </span>
                        </div>
                        <div className="mt-1 flex items-baseline justify-between gap-3">
                          <span className="text-label text-ink-2">{t.planner.fareCard}</span>
                          <span className="tnum text-label font-semibold text-ink-2">
                            {planResult.fare.citizenCardEuros.toFixed(2).replace('.', ',')} €
                          </span>
                        </div>
                        {planResult.fare.busLegs > 1 && (
                          <span className="mt-1.5 block text-label text-estimated">
                            {planResult.fare.transfersFree ? t.planner.fareTransferFree : t.planner.fareTransferPaid}
                          </span>
                        )}
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

              {/* Alternatives. One answer hides the fact that there is usually more than
                  one way, and people have reasons to prefer a line they know. */}
              {planOptions.length > 1 && (
                <div>
                  <span className="text-label font-bold text-ink-2 uppercase tracking-wider block mb-2">
                    {t.planner.optionsTitle}
                  </span>
                  {/* Rows, not cards, and not a carousel.
                      The carousel went first: measured on a 375x812 the strip was 305 px
                      wide holding 887 px of cards, so two of the four options sat off the
                      screen with nothing but a clipped edge to say so. The cards that
                      replaced it were readable but expensive -- four of them ran to 274 px,
                      39% of the 706 px that scroll, to carry three figures each. A border,
                      a radius and a fill on every row say "four separate objects" when what
                      is actually being read is one column of four comparable lines.
                      So the chrome goes and the alignment does the work: badges, clock and
                      duration land in the same place on every row, which is what makes them
                      comparable at a glance. The rows keep a 44 px target because they are
                      still buttons on a phone. */}
                  <div className="border-y border-line">
                    {visibleOptions.map(({ option, idx }) => {
                      const busLegs = option.segments.filter((seg) => seg.type === 'bus');
                      // Same correction the detail applies, so the row you open agrees
                      // with what opens, and the four are compared like for like.
                      const fix = correctionFor(option);
                      const shown = withMeasuredWalk(option, fix);
                      // The row draws the change: "6 → 4.2" is one transfer and there is
                      // no other way to read it. Spelling it out again cost the two rows
                      // that had one 18 px each, because the wider badge column pushed
                      // "4 min de espera · 1 transbordo" onto a second line. The words
                      // stay for a screen reader, which is read the badges as bare
                      // numbers and cannot see the arrow between them.
                      const notes = shown.reachable
                        ? [
                            option.totalWaitMinutes > 0 && option.totalWaitMinutes <= LONG_WAIT_MIN
                              ? t.planner.waitShort(option.totalWaitMinutes)
                              : '',
                            busLegs.length === 0 ? t.planner.noWaitNoFare : '',
                          ].filter(Boolean)
                        : [];
                      return (
                        <button
                          key={idx}
                          onClick={() => setChosenOption(idx)}
                          aria-pressed={idx === chosenOption}
                          className={`grid min-h-11 w-full grid-cols-[auto_1fr_auto] items-center gap-2.5 border-l-[3px] py-1.5 pl-2 pr-1 text-left transition-colors ${
                            idx > 0 ? 'border-t border-t-line' : ''
                          } ${
                            idx === chosenOption
                              ? 'border-l-ink bg-surface text-ink'
                              : 'border-l-transparent text-ink'
                          }`}
                        >
                          <span className="flex items-center gap-1">
                            {busLegs.length === 0 ? (
                              <span className="flex items-center gap-1 text-label font-bold">
                                <Footprints className="h-3.5 w-3.5" />
                                {t.planner.walkOnly}
                              </span>
                            ) : (
                              busLegs.map((seg, k) => (
                                <React.Fragment key={k}>
                                  {k > 0 && <span className="text-label text-ink-3">→</span>}
                                  <span
                                    className="rounded px-1.5 text-label font-black text-white"
                                    style={{ backgroundColor: seg.line?.color }}
                                  >
                                    {seg.line?.number}
                                  </span>
                                </React.Fragment>
                              ))
                            )}
                          </span>
                          <span className="min-w-0">
                            {/* The clock leads the row, not the duration.
                                Once the departure stopped being "now" for every option it
                                became the thing that distinguishes them, and reading
                                "16:48 → ~17:31" places the trip in the day faster than
                                "43 min" does. Both are at body size; the clock is first
                                and the duration is the consequence. */}
                            <span className="tnum block font-mono text-label font-semibold text-ink">
                              {shown.departure} → ~{shown.arrival}
                            </span>
                            {notes.length > 0 && (
                              <span className="block text-label text-ink-3">{notes.join(' · ')}</span>
                            )}
                            {!shown.reachable && (
                              <span className="block truncate text-label font-semibold text-warn-ink">
                                {t.planner.unreachableWalk}
                              </span>
                            )}
                            {busLegs.length > 1 && (
                              <span className="sr-only">{t.planner.transfersShort(busLegs.length - 1)}</span>
                            )}
                          </span>
                          <span
                            className={`tnum shrink-0 font-mono text-body ${
                              idx === chosenOption ? 'font-black' : 'font-bold text-ink-2'
                            }`}
                          >
                            {shown.durationMinutes} min
                          </span>
                        </button>
                      );
                    })}
                    {/* The rest, on request. It sits inside the same bordered block and
                        below the last divider, so it reads as the end of the list rather
                        than as a separate control floating under it. */}
                    {offeredOptions.length > VISIBLE_OPTIONS && chosenOption < VISIBLE_OPTIONS && (
                      <button
                        type="button"
                        onClick={() => setShowAllOptions(!showAllOptions)}
                        aria-expanded={optionsExpanded}
                        className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-t-line text-label font-semibold text-ink-3"
                      >
                        {optionsExpanded
                          ? t.planner.fewerOptions
                          : t.planner.moreOptions(offeredOptions.length - VISIBLE_OPTIONS)}
                        <ChevronDown
                          className={`h-3.5 w-3.5 shrink-0 ${optionsExpanded ? 'rotate-180' : ''}`}
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Route map. Reading a list of streets is much harder than seeing the shape
                  of the trip, so it is shown by default and can be folded away. */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-label font-bold text-ink-2 uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-accent" />
                    {t.planner.routeMap}
                  </span>
                  <span className="flex items-center gap-3">
                    {/* "Ver camiño a pé" stood here. It bought a drawn pavement route in
                        exchange for sending both ends of every walking leg to a third
                        party, which is why it had to be asked for. The route is worked
                        out on the device now, so it is simply drawn. */}
                    <button
                      onClick={() => setShowMap((v) => !v)}
                      className="text-label font-semibold text-accent h-11 inline-flex items-center underline"
                    >
                      {showMap ? t.planner.hideMap : t.planner.showMap}
                    </button>
                  </span>
                </div>
                {showMap && (
                  <div className="relative">
                    <Suspense
                      fallback={<div className="w-full h-[240px] sm:h-[280px] rounded-xl bg-surface animate-pulse" />}
                    >
                      <RouteMap
                        plan={planResult}
                        lang={lang}
                        origin={endpoints.origin}
                        destination={endpoints.destination}
                        /* Every leg the router answered for; the ones it could not are
                           drawn as the straight dashed hint they always were. */
                        walkPaths={walkPaths}
                        className="w-full h-[240px] sm:h-[280px] rounded-xl overflow-hidden border border-edge z-0"
                      />
                    </Suspense>
                    {/* Say that the trip is written out further down.
                        The map ends within a few pixels of the fold on a 375x812, so the
                        heading below it is never seen and nothing on screen suggests the
                        page continues. This sits on the map rather than under it for that
                        exact reason -- a row below the map would be below the fold too.
                        At the top rather than the bottom: it is the one part of the map
                        guaranteed to be on screen whatever the map's height, and it is
                        clear of the attribution line and the zoom buttons without having
                        to be placed around them. */}
                    <button
                      type="button"
                      onClick={() => {
                        stepsRef.current?.scrollIntoView({
                          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                            ? 'auto'
                            : 'smooth',
                          block: 'start',
                        });
                      }}
                      className="absolute left-1/2 top-0 z-[500] flex h-11 -translate-x-1/2 items-center px-2"
                    >
                      <span className="flex items-center gap-1.5 rounded-full border border-accent bg-bg/90 px-3 py-1.5 text-label font-semibold text-ink shadow-sm backdrop-blur-sm">
                        {t.planner.stepByStepTitle}
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.5} aria-hidden="true" />
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* Step by step.
                  It had no heading, alone among the three blocks in this column, and it
                  lives below a map -- so on a phone the reader reached the bottom of the
                  map and had no reason to believe anything followed. The heading names it
                  and, with the map an inch shorter, sits above the fold: what tells you to
                  keep scrolling is seeing the start of the next thing, not being told to. */}
              <div ref={stepsRef} className="scroll-mt-3">
                <span className="text-label font-bold text-ink-2 uppercase tracking-wider block mb-2">
                  {t.planner.stepByStepTitle}
                </span>
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
                              {/* Where this bus is going, not what the line is called.
                                  The line's own name is "Rda. Muralla 56 (Sindicatos) -
                                  HULA (Ent. Principal)" — 355 px of it in a 103 px slot,
                                  so 29% of it showed and it broke off mid-word. It is also
                                  the wrong fact: the row below already says where you get
                                  on, and what is missing is which way it runs. The full
                                  name stays on the badge's tooltip. */}
                              <span
                                className="min-w-0 flex-1 truncate text-body font-semibold"
                                title={seg.line.name}
                                aria-label={t.service.towards(
                                  seg.line.directions.find((d) => d.id === seg.directionId)?.destination ??
                                    seg.line.name,
                                )}
                              >
                                <span aria-hidden="true" className="text-ink-3">→ </span>
                                {seg.line.directions.find((d) => d.id === seg.directionId)?.destination ??
                                  seg.line.name}
                              </span>
                              <span className="tnum shrink-0 text-emph font-bold">
                                {seg.durationMinutes} min
                              </span>
                            </div>

                            {/* The label and the time move off the name's line.
                                "Sube en" plus a clock left 132 px for "Rda. Muralla (Obras
                                Publicas)", which needs 204 -- so the stop you have to walk
                                to and recognise was the thing being cut. Nothing here is
                                worth truncating a stop name for. */}
                            <div className="mt-3">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-label text-ink-3">{t.planner.board}</span>
                                <span className="tnum shrink-0 text-body font-semibold">
                                  {seg.departureTime}
                                </span>
                              </div>
                              <button
                                onClick={() => seg.fromStop && onSelectStop(seg.fromStop)}
                                title={seg.fromStop?.name}
                                className="flex min-h-11 w-full items-center text-left text-body font-semibold underline underline-offset-2"
                              >
                                {seg.fromStop?.name}
                              </button>
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
                                    {between.map((id) => {
                                      const viaName = BUS_STOPS.find((x) => x.id === id)?.name ?? id;
                                      return (
                                        <li
                                          key={id}
                                          title={viaName}
                                          className="truncate py-1 text-label text-ink-3"
                                        >
                                          {viaName}
                                        </li>
                                      );
                                    })}
                                  </ol>
                                </details>
                              );
                            })()}

                            <div>
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-label text-ink-3">{t.planner.alight}</span>
                                <span className="tnum shrink-0 text-body font-semibold">
                                  {seg.arrivalTime}
                                </span>
                              </div>
                              <button
                                onClick={() => seg.toStop && onSelectStop(seg.toStop)}
                                title={seg.toStop?.name}
                                className="flex min-h-11 w-full items-center text-left text-body font-semibold underline underline-offset-2"
                              >
                                {seg.toStop?.name}
                              </button>
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
              </div>

              {/* Notice */}
              <div className="p-3 rounded-lg bg-warn border border-warn flex items-start gap-2.5 text-label text-warn-ink font-medium">
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
