import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bus, Check, Footprints, MapPin } from 'lucide-react';
import { Provenance } from './ui/Provenance';
import { LineBadge } from './ui/LineBadge';
import { SectionLabel } from './ui/SectionLabel';
import { useT } from '../i18n';
import { TripCompanion, useTripPosition } from '../hooks/useTripCompanion';
import { ALARM_RADIUS_M } from '../services/stopAlarm';
import { walkHopsOf } from '../services/walkingPath';
import { useWalkPaths } from '../hooks/useWalkPaths';
import { useClock } from '../hooks/useClock';
import { formatMinutes, minutesNow } from '../utils/schedule';
import { currentLeg, legTimes, shouldAskIfMissed, tripPhase, tripProgress } from '../utils/tripProgress';

const RouteMap = lazy(() => import('./Map/RouteMap').then((m) => ({ default: m.RouteMap })));

/** As tall as the answer above it: 37vh is 300 on a 375x812, held so a short phone and a tall desktop both get a map. */
const MAP_HEIGHT = 'h-[37vh] min-h-[280px] max-h-[420px] lg:min-h-[360px]';
const TICK_MS = 15_000;
const label = 'text-label font-bold uppercase tracking-wider text-ink-2';
const headline = 'mt-1 text-title font-bold leading-tight text-ink';

/**
 * "Vou no bus": the screen for the ride itself, glanced at one-handed on a moving bus. One
 * big answer at the top and nothing to fill in. The only measurement is the reader's own
 * GPS, counted against the plan's stop list; every time is the timetable's and says so.
 * The mode never guesses that somebody boarded, missed a bus or arrived: it asks, or it counts.
 */
export function TripCompanionView({ companion }: { companion: TripCompanion }) {
  const t = useT();
  const { trip } = companion;
  // The position comes from its own store, so a fix redraws this screen and nothing above it.
  const { fix, gpsError } = useTripPosition();
  const now = useClock(TICK_MS);
  const progress = useMemo(() => (trip ? tripProgress(trip.plan, fix, new Set(trip.seen)) : null), [trip, fix]);

  // The real pavement for every walked hop, routed on the device and not carried in the stored trip.
  const hops = useMemo(() => walkHopsOf(trip?.plan ?? null, trip?.origin ?? undefined, trip?.destination ?? undefined), [trip?.plan, trip?.origin, trip?.destination]);
  const walkPaths = useWalkPaths(hops);

  // Focusable so the mode's arrival is announced; start at the top, which is where the answer is.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const active = trip !== null;
  useEffect(() => {
    if (!active) return;
    headingRef.current?.focus();
    headingRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, [active]);

  if (!trip) return null;

  const phase = tripPhase(trip, progress);
  const leg = currentLeg(trip, progress);
  const segment = trip.plan.segments[leg];
  const times = legTimes(trip, leg);
  const asking = shouldAskIfMissed(trip, progress, now);
  const finalWalk = [...trip.plan.segments].reverse().find((s) => s.type === 'walk');
  // What the map frames: the leg being made, or the walk to the door once the last bus is behind you.
  const lastSegment = trip.plan.segments.length - 1;
  const focusSegment = phase === 'walking' && trip.plan.segments[lastSegment]?.type === 'walk' ? lastSegment : leg;
  const minutesToAlighting = times.arrivalMinutes !== null ? Math.round(times.arrivalMinutes - minutesNow(now)) : null;
  const minutesToDeparture = Math.round(times.departureMinutes - minutesNow(now));
  // Ticks mean "the bus took you past this"; while waiting the list is plain.
  const riding = phase === 'riding' || phase === 'alighting';
  const nextStop = riding ? progress?.stops.find((s) => !s.passed) : undefined;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-3.5 pt-4 lg:px-6">
      <h2 ref={headingRef} tabIndex={-1} className="sr-only">
        {t.companion.title}
      </h2>

      {/* The one thing that matters, first and biggest. While the alert stands the whole card turns. */}
      <div className={`space-y-4 rounded-card border p-6 shadow-sm ${phase === 'alighting' ? 'border-warn bg-warn/40' : 'border-edge bg-bg'}`}>
        {phase === 'alighting' && segment?.toStop && (
          <p role="alert" className="rounded-md border border-warn bg-warn px-3 py-2.5 text-body font-semibold text-warn-ink">
            {t.arrivals.alarmFired(segment.toStop.name)}
          </p>
        )}

        {phase === 'walking' ? (
          <div>
            <span className={label}>{trip.destination && finalWalk ? t.companion.walkTo : t.companion.arrived}</span>
            <p className={headline}>{trip.destination && finalWalk ? trip.destination.name : segment?.toStop?.name}</p>
            {finalWalk && trip.destination && (
              <p className="mt-2 flex items-center gap-2 text-body text-ink-2">
                <Footprints className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                {t.planner.walkLeg(finalWalk.walkMeters ?? 0, finalWalk.durationMinutes)}
              </p>
            )}
          </div>
        ) : phase === 'waiting' ? (
          <div>
            <span className={label}>{t.planner.board}</span>
            <p className={headline}>{segment?.fromStop?.name}</p>
            {segment?.line && (
              <>
                <div className="mt-3 flex items-center gap-2.5">
                  <LineBadge number={segment.line.number} color={segment.line.color} size="md" />
                  <span className="sr-only">{t.planner.departureLabel}</span>
                  <span className="tnum text-emph font-semibold text-ink">{times.none ? '—' : formatMinutes(times.departureMinutes)}</span>
                  {!times.none && minutesToDeparture >= 0 && <span className="tnum text-body text-ink-3">{t.companion.inMinutes(minutesToDeparture)}</span>}
                </div>
                {!times.none && (
                  <div className="mt-2">
                    <Provenance precision={times.precision} />
                  </div>
                )}
              </>
            )}
            {times.none && <p className="mt-2 text-body font-semibold text-warn-ink">{t.companion.lastOneGone}</p>}
          </div>
        ) : (
          <div>
            <span className={label}>{t.planner.alight}</span>
            <p className={headline}>{segment?.toStop?.name}</p>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
              <span className="flex items-baseline gap-2">
                <span className="tnum text-num font-bold tracking-[-0.025em] text-ink">{progress?.stopsRemaining ?? '—'}</span>
                <span className="text-body text-ink-3">{t.companion.stops(progress?.stopsRemaining ?? 0)}</span>
              </span>
              {minutesToAlighting !== null && (
                <span className="flex items-baseline gap-2">
                  <span className="tnum text-emph font-semibold text-ink">{minutesToAlighting >= 0 ? `~${minutesToAlighting} ${t.common.min}` : t.common.overdue(-minutesToAlighting)}</span>
                  <span className="text-ink-3" aria-hidden="true">
                    ·
                  </span>
                  <span className="tnum text-body text-ink-3">{formatMinutes(times.arrivalMinutes ?? 0)}</span>
                  <Provenance precision={times.arrivalPrecision} />
                </span>
              )}
            </div>
            {nextStop && !nextStop.isAlighting && (
              <p className="mt-3">
                <span className="block text-label font-bold uppercase tracking-wider text-ink-3">{t.map.nextStop}</span>
                <span className="block text-body font-semibold text-ink">{nextStop.name}</span>
              </p>
            )}
          </div>
        )}

        {/* Asked, not guessed: the printed departure plus three minutes has gone by and the phone has not seen the bus move. */}
        {asking && segment?.line && (
          <div role="group" aria-live="polite" className="space-y-2 rounded-md border border-warn bg-warn/40 p-3">
            <p className="text-body font-semibold text-ink">{t.companion.caughtIt(segment.line.number, formatMinutes(times.departureMinutes))}</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={companion.boarded} className="flex min-h-11 items-center justify-center rounded-control bg-accent px-3 text-body font-semibold text-on-accent">
                {t.companion.yesOnIt}
              </button>
              <button type="button" onClick={companion.missed} className="flex min-h-11 items-center justify-center rounded-control border border-edge bg-bg px-3 text-body font-semibold text-ink">
                {t.companion.noMissedIt}
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <SectionLabel icon={MapPin}>{t.planner.routeMap}</SectionLabel>
        <Suspense fallback={<div className={`${MAP_HEIGHT} w-full animate-pulse rounded-card bg-surface`} />}>
          <RouteMap
            plan={trip.plan}
            origin={trip.origin ?? undefined}
            destination={trip.destination ?? undefined}
            focusSegment={focusSegment}
            position={fix}
            walkPaths={walkPaths}
            className={`z-0 ${MAP_HEIGHT} w-full overflow-hidden rounded-card border border-edge`}
          />
        </Suspense>
      </div>

      {/* The phone, not the trip: whether it has a position and whether it will stay awake. */}
      {phase !== 'walking' && (
        <div className="space-y-2 px-1">
          <p className="text-label text-ink-3">
            {gpsError === 'denied' ? t.arrivals.alarmDenied : gpsError === 'unavailable' ? t.arrivals.alarmUnavailable : !fix ? t.planner.locating : `${t.companion.watching(ALARM_RADIUS_M)} ${t.arrivals.alarmForeground}`}
          </p>
          {/* A locked phone stops getting positions; the switch keeps the screen on. Off by default because it costs battery; absent where the browser has no such thing. */}
          {companion.keepAwake && (
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-accent" checked={companion.keepAwake.on} onChange={(e) => companion.keepAwake?.set(e.target.checked)} />
              <span className="text-body">
                {t.companion.keepAwake}
                <span className="block text-label text-ink-3">{t.companion.keepAwakeCost}</span>
              </span>
            </label>
          )}
        </div>
      )}

      {/* The stops still to come, ticked against the GPS, never against the clock. */}
      {progress && progress.stops.length > 0 && phase !== 'walking' && (
        <div>
          <SectionLabel icon={Bus}>{t.planner.viaStops}</SectionLabel>
          <ol className="divide-y divide-line rounded-card border border-edge bg-bg">
            {progress.stops.map((stop) => {
              const passed = riding && stop.passed;
              const isNext = stop.id === nextStop?.id;
              return (
                <li key={stop.id} aria-current={isNext ? 'step' : undefined} className={`flex min-h-11 items-center gap-3 px-3 py-2 ${passed ? 'text-ink-3' : 'text-ink'}`}>
                  <span className="flex w-4 shrink-0 justify-center" aria-hidden="true">
                    {passed ? <Check className="h-4 w-4 text-official" strokeWidth={2.6} /> : isNext ? <ArrowRight className="h-4 w-4 text-accent" strokeWidth={2.6} /> : <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />}
                  </span>
                  <span className={`min-w-0 flex-1 text-body ${passed ? 'line-through' : 'font-semibold'}`}>{stop.name}</span>
                  <span className="shrink-0 text-label font-semibold text-ink-2">{stop.isAlighting ? t.companion.alightHere : passed ? t.companion.passed : isNext ? t.companion.next : ''}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Always in reach: the mode ends when the reader says so, never on its own. */}
      <div className="sticky bottom-0 z-10 -mx-3.5 border-t border-line bg-bg/95 px-3.5 py-3 backdrop-blur-sm lg:-mx-6 lg:px-6">
        <button type="button" onClick={companion.finish} className={`flex min-h-12 w-full items-center justify-center rounded-control px-4 text-body font-semibold ${phase === 'walking' ? 'bg-accent text-on-accent' : 'border border-edge bg-bg text-ink'}`}>
          {phase === 'walking' ? t.companion.arrivedDone : t.companion.finish}
        </button>
      </div>
    </div>
  );
}
