import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bus, Check, Footprints, MapPin } from 'lucide-react';
import { Provenance } from './ui/Provenance';
import { LineBadge } from './ui/LineBadge';
import { SectionLabel } from './ui/SectionLabel';
import { Lang, translations } from '../i18n';
import { TripCompanion, useTripPosition } from '../hooks/useTripCompanion';
import { ALARM_RADIUS_M } from '../services/stopAlarm';
import { fetchWalkingPath, walkHopKey, walkHopsOf, WalkingPath } from '../services/walkingPath';
import { formatMinutes, minutesNow } from '../utils/schedule';
import { currentLeg, legTimes, shouldAskIfMissed, tripPhase, tripProgress } from '../utils/tripProgress';

// Same reason as the planner: Leaflet loads with the map, not with the app.
const RouteMap = lazy(() => import('./Map/RouteMap').then((m) => ({ default: m.RouteMap })));

/** See the map block below for the numbers. */
const MAP_HEIGHT = 'h-[37vh] min-h-[280px] max-h-[420px] lg:min-h-[360px]';

/** How often the minutes in the header are recounted against the clock. */
const TICK_MS = 15_000;

interface TripCompanionViewProps {
  companion: TripCompanion;
  lang: Lang;
}


/**
 * "Vou no bus": the screen for the ride itself.
 *
 * Meant to be glanced at, one-handed, standing, on a moving bus -- so one big answer at
 * the top and nothing to fill in. The only measurement on it is the reader's own GPS,
 * counted against the plan's stop list; every time is the timetable's and says so.
 * The mode never guesses that somebody boarded, missed a bus or arrived: it asks, or it
 * counts.
 */
export const TripCompanionView: React.FC<TripCompanionViewProps> = ({ companion, lang }) => {
  const t = translations(lang);
  const { trip } = companion;
  // The position comes from its own store, so a fix redraws this screen and nothing
  // above it; the clock is this screen's too, for "~ 11 min" to count down without one.
  const { fix, gpsError } = useTripPosition();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(tick);
  }, []);
  const progress = useMemo(
    () => (trip ? tripProgress(trip.plan, fix, new Set(trip.seen)) : null),
    [trip, fix],
  );

  /*
   * The real pavement for every walked hop, so the walk to the door is drawn along
   * streets rather than as a straight hint. Worked out on the device by the same router
   * the planner uses -- about six milliseconds a hop -- and not carried in the stored
   * trip, which stays the stops, lines and times PRIVACY.md says it is.
   */
  const [walkPaths, setWalkPaths] = useState<Record<string, WalkingPath | null>>({});
  const hops = useMemo(
    () => walkHopsOf(trip?.plan ?? null, trip?.origin ?? undefined, trip?.destination ?? undefined),
    [trip?.plan, trip?.origin, trip?.destination],
  );
  useEffect(() => {
    if (!hops.length) return;
    const controller = new AbortController();
    for (const [a, b] of hops) {
      fetchWalkingPath(a, b, controller.signal)
        .then((path) => {
          if (!controller.signal.aborted) setWalkPaths((prev) => ({ ...prev, [walkHopKey(a, b)]: path }));
        })
        .catch(() => {
          // Aborted: the straight hint stays.
        });
    }
    return () => controller.abort();
  }, [hops]);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const active = trip !== null;
  useEffect(() => {
    if (!active) return;
    headingRef.current?.focus();
    // The planner scrolls its column to the answer before this screen replaces it, and
    // the scroll position carries over: the ride opened 76 px down, with the stop name
    // cut off at the top. Start at the top, which is where the answer is.
    headingRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, [active]);

  if (!trip) return null;

  const phase = tripPhase(trip, progress);
  const leg = currentLeg(trip, progress);
  const segment = trip.plan.segments[leg];
  const times = legTimes(trip, leg);
  const asking = shouldAskIfMissed(trip, progress, now);

  // The walk after the last bus, if the plan has one, for the last screen of the trip.
  const finalWalk = [...trip.plan.segments].reverse().find((s) => s.type === 'walk');
  // What the map frames: the leg being made, or the walk to the door once the last bus
  // is behind you -- the walk is the last segment when the plan ends on foot.
  const lastSegment = trip.plan.segments.length - 1;
  const focusSegment =
    phase === 'walking' && trip.plan.segments[lastSegment]?.type === 'walk' ? lastSegment : leg;
  const minutesToAlighting =
    times.arrivalMinutes !== null ? Math.round(times.arrivalMinutes - minutesNow(now)) : null;
  // The same arithmetic for the bus being waited for. Past the printed minute it says
  // nothing: the "did you catch it?" prompt is what speaks then.
  const minutesToDeparture = Math.round(times.departureMinutes - minutesNow(now));

  // Ticks mean "the bus took you past this"; standing at the boarding pole is not that,
  // so while waiting the list is plain and only the alighting stop is marked.
  const riding = phase === 'riding' || phase === 'alighting';
  const nextStop = riding ? progress?.stops.find((s) => !s.passed) : undefined;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-3.5 pt-4 lg:px-6">
      {/* Focusable so the mode's arrival is announced: the planner's button is gone and
          this heading is what the cursor lands on. Not in the tab order otherwise. */}
      <h2 ref={headingRef} tabIndex={-1} className="sr-only">
        {t.companion.title}
      </h2>

      {/* The one thing that matters, first and biggest: where you get off, and how far
          that is in stops -- counted -- and in minutes -- the timetable's, labelled.
          While the alert stands the whole card turns: it is the one moment this screen
          has to be read from across the aisle, and a strip between two rows was not. */}
      <div
        className={`space-y-4 rounded-card border p-6 shadow-sm ${
          phase === 'alighting' ? 'border-warn bg-warn/40' : 'border-edge bg-bg'
        }`}
      >
        {/* The alert, in words, when it has rung. The same sentence the board uses. */}
        {phase === 'alighting' && segment?.toStop && (
          <p role="alert" className="rounded-md border border-warn bg-warn px-3 py-2.5 text-body font-semibold text-warn-ink">
            {t.arrivals.alarmFired(segment.toStop.name)}
          </p>
        )}

        {phase === 'walking' ? (
          <div>
            <span className="text-label font-bold uppercase tracking-wider text-ink-2">
              {trip.destination && finalWalk ? t.companion.walkTo : t.companion.arrived}
            </span>
            <p className="mt-1 text-title font-bold leading-tight text-ink">
              {trip.destination && finalWalk ? trip.destination.name : segment?.toStop?.name}
            </p>
            {finalWalk && trip.destination && (
              <p className="mt-2 flex items-center gap-2 text-body text-ink-2">
                <Footprints className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                {t.planner.walkLeg(finalWalk.walkMeters ?? 0, finalWalk.durationMinutes)}
              </p>
            )}
          </div>
        ) : phase === 'waiting' ? (
          <div>
            <span className="text-label font-bold uppercase tracking-wider text-ink-2">{t.planner.board}</span>
            <p className="mt-1 text-title font-bold leading-tight text-ink">{segment?.fromStop?.name}</p>
            {segment?.line && (
              <>
                {/* One line for the line, the clock and how far off it is; the chip on its
                    own line under them. Everything on one wrapping row put the badge alone
                    on a line and folded the chip in two, at 375 px wide. */}
                <div className="mt-3 flex items-center gap-2.5">
                  <LineBadge number={segment.line.number} color={segment.line.color} size="md" />
                  <span className="sr-only">{t.planner.departureLabel}</span>
                  <span className="tnum text-emph font-semibold text-ink">
                    {times.none ? '—' : formatMinutes(times.departureMinutes)}
                  </span>
                  {/* How long that is from now, so nobody subtracts against the clock. */}
                  {!times.none && minutesToDeparture >= 0 && (
                    <span className="tnum text-body text-ink-3">{t.companion.inMinutes(minutesToDeparture)}</span>
                  )}
                </div>
                {!times.none && (
                  <div className="mt-2">
                    <Provenance precision={times.precision} lang={lang} />
                  </div>
                )}
              </>
            )}
            {times.none && <p className="mt-2 text-body font-semibold text-warn-ink">{t.companion.lastOneGone}</p>}
          </div>
        ) : (
          <div>
            <span className="text-label font-bold uppercase tracking-wider text-ink-2">{t.planner.alight}</span>
            <p className="mt-1 text-title font-bold leading-tight text-ink">{segment?.toStop?.name}</p>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
              <span className="flex items-baseline gap-2">
                <span className="tnum text-num font-bold tracking-[-0.025em] text-ink">{progress?.stopsRemaining ?? '—'}</span>
                <span className="text-body text-ink-3">{t.companion.stops(progress?.stopsRemaining ?? 0)}</span>
              </span>
              {minutesToAlighting !== null && (
                <span className="flex items-baseline gap-2">
                  <span className="tnum text-emph font-semibold text-ink">
                    {minutesToAlighting >= 0
                      ? `~${minutesToAlighting} ${t.common.min}`
                      : t.common.overdue(-minutesToAlighting)}
                  </span>
                  <span className="text-ink-3" aria-hidden="true">·</span>
                  <span className="tnum text-body text-ink-3">{formatMinutes(times.arrivalMinutes ?? 0)}</span>
                  <Provenance precision={times.arrivalPrecision} lang={lang} />
                </span>
              )}
            </div>
            {/* The next pole, here as well as in the list: on a 375x812 the list starts
                703 px down, and this is the one row of it that gets looked for. */}
            {nextStop && !nextStop.isAlighting && (
              <p className="mt-3">
                <span className="block text-label font-bold uppercase tracking-wider text-ink-3">{t.map.nextStop}</span>
                <span className="block text-body font-semibold text-ink">{nextStop.name}</span>
              </p>
            )}
          </div>
        )}

        {/* Asked, not guessed: the printed departure plus three minutes has gone by and the
            phone has not seen the bus move. Either answer is one tap. */}
        {asking && segment?.line && (
          <div role="group" aria-live="polite" className="space-y-2 rounded-md border border-warn bg-warn/40 p-3">
            <p className="text-body font-semibold text-ink">
              {t.companion.caughtIt(segment.line.number, formatMinutes(times.departureMinutes))}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={companion.boarded}
                className="flex min-h-11 items-center justify-center rounded-control bg-accent px-3 text-body font-semibold text-on-accent"
              >
                {t.companion.yesOnIt}
              </button>
              <button
                type="button"
                onClick={companion.missed}
                className="flex min-h-11 items-center justify-center rounded-control border border-edge bg-bg px-3 text-body font-semibold text-ink"
              >
                {t.companion.noMissedIt}
              </button>
            </div>
          </div>
        )}

      </div>

      {/* The plan, drawn, framed on the leg being made, with the reader on it.
          As tall as the answer above it: at 200 px it was the smallest block on a screen
          where it carries as much as the others -- 37vh is 300 on a 375x812, held between
          280 and 420 so a short phone and a tall desktop both get a map and not a strip. */}
      <div>
        <SectionLabel icon={MapPin}>{t.planner.routeMap}</SectionLabel>
        <Suspense fallback={<div className={`${MAP_HEIGHT} w-full animate-pulse rounded-card bg-surface`} />}>
          <RouteMap
            plan={trip.plan}
            lang={lang}
            origin={trip.origin ?? undefined}
            destination={trip.destination ?? undefined}
            focusSegment={focusSegment}
            position={fix}
            walkPaths={walkPaths}
            className={`z-0 ${MAP_HEIGHT} w-full overflow-hidden rounded-card border border-edge`}
          />
        </Suspense>
      </div>

      {/* The phone, not the trip: whether it has a position and whether it will stay
          awake. These sat inside the card above and read as part of the answer -- three
          lines of small print between the count and the map. Under the map they are what
          they are, the instrument's state beside the thing it draws, and the card is only
          the answer. Nothing to watch for once the last bus is behind you. */}
      {phase !== 'walking' && (
        <div className="space-y-2 px-1">
          {/* The position is the only measurement here, so its absence is said, not hidden. */}
          <p className="text-label text-ink-3">
            {gpsError === 'denied'
              ? t.arrivals.alarmDenied
              : gpsError === 'unavailable'
                ? t.arrivals.alarmUnavailable
                : !fix
                  ? t.planner.locating
                  : `${t.companion.watching(ALARM_RADIUS_M)} ${t.arrivals.alarmForeground}`}
          </p>
          {/* The one answer to "the phone in the pocket": a locked phone stops getting
              positions, so the switch keeps the screen on for the ride. Off by default
              because it costs battery, said in as many words; absent, not disabled, where
              the browser has no such thing. Written from the reader's side -- the words
              "wake lock" appear nowhere. */}
          {companion.keepAwake && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-accent"
                checked={companion.keepAwake.on}
                onChange={(e) => companion.keepAwake?.set(e.target.checked)}
              />
              <span className="text-body">
                {t.companion.keepAwake}
                <span className="block text-label text-ink-3">{t.companion.keepAwakeCost}</span>
              </span>
            </label>
          )}
        </div>
      )}

      {/* The stops still to come, which is the part that replaces looking out of the
          window. Ticked against the GPS, never against the clock. */}
      {progress && progress.stops.length > 0 && phase !== 'walking' && (
        <div>
          <SectionLabel icon={Bus}>{t.planner.viaStops}</SectionLabel>
          <ol className="divide-y divide-line rounded-card border border-edge bg-bg">
            {progress.stops.map((stop) => {
              const passed = riding && stop.passed;
              const isNext = stop.id === nextStop?.id;
              return (
                <li
                  key={stop.id}
                  aria-current={isNext ? 'step' : undefined}
                  className={`flex min-h-11 items-center gap-3 px-3 py-2 ${passed ? 'text-ink-3' : 'text-ink'}`}
                >
                  <span className="flex w-4 shrink-0 justify-center" aria-hidden="true">
                    {passed ? (
                      <Check className="h-4 w-4 text-official" strokeWidth={2.6} />
                    ) : isNext ? (
                      <ArrowRight className="h-4 w-4 text-accent" strokeWidth={2.6} />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />
                    )}
                  </span>
                  <span className={`min-w-0 flex-1 text-body ${passed ? 'line-through' : 'font-semibold'}`}>
                    {stop.name}
                  </span>
                  <span className="shrink-0 text-label font-semibold text-ink-2">
                    {stop.isAlighting ? t.companion.alightHere : passed ? t.companion.passed : isNext ? t.companion.next : ''}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Always in reach. The mode ends when the reader says so, never on its own, and an
          alert nobody asked for is never left running -- so the way out is pinned to the
          foot of the screen rather than left under seventeen stops of list, where on a
          375x812 it sat 1.348 px down, two screens below the fold. Quiet until the last
          bus is behind you; then it is the one thing left to press. */}
      <div className="sticky bottom-0 z-10 -mx-3.5 border-t border-line bg-bg/95 px-3.5 py-3 backdrop-blur-sm lg:-mx-6 lg:px-6">
        <button
          type="button"
          onClick={companion.finish}
          className={`flex min-h-12 w-full items-center justify-center rounded-control px-4 text-body font-semibold ${
            phase === 'walking' ? 'bg-accent text-on-accent' : 'border border-edge bg-bg text-ink'
          }`}
        >
          {phase === 'walking' ? t.companion.arrivedDone : t.companion.finish}
        </button>
      </div>
    </div>
  );
};
