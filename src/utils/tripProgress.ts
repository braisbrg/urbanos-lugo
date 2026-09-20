/**
 * Where somebody is along a plan they said they were making.
 *
 * The one piece of the ride mode with no equivalent elsewhere, and the one that can be
 * wrong without looking wrong, so it is a pure function of a plan and a fix. Nothing here
 * is a bus position: the only measurement is the reader's own GPS, counted against the
 * plan's stop list.
 */
import { lineById, stopById, stopName } from '../data/transitData';
import { Lang } from '../i18n';
import { ALARM_RADIUS_M } from '../services/stopAlarm';
import { Precision, RoutePlanResult, TripSegment } from '../types';
import { getDistanceMeters } from './geo';
import { minutesNow, parseTimeToMinutes } from './schedule';
import { getNextLineDeparture } from './arrivals';

/**
 * How close counts as having reached a stop: wider than the vehicle, since a bus pulls in
 * beside the pole and a phone in a pocket is not a survey instrument. Ten of the 1,136
 * consecutive pairs sit closer than this; there the count can drop a stop early and
 * corrects itself at the next pole. The alert is untouched, it fires at ALARM_RADIUS_M.
 */
export const AT_STOP_RADIUS_M = 60;

export interface TripFix {
  lat: number;
  lng: number;
}

export interface TripPlace {
  name: string;
  lat: number;
  lng: number;
}

export interface TripStop {
  id: string;
  name: string;
  passed: boolean;
  isBoarding: boolean;
  isAlighting: boolean;
}

export interface TripProgress {
  /** Index into `plan.segments` of the leg the reader is on. */
  segmentIndex: number;
  /** The stops of the current bus leg, in order, with the ones already behind marked. */
  stops: TripStop[];
  stopsRemaining: number;
  /** Metres to the alighting stop, straight line. Null when there is no bus leg. */
  metresToAlighting: number | null;
  arrived: boolean;
}

/** Indices into `plan.segments` of the legs ridden on a bus, in order. */
const busLegs = (plan: RoutePlanResult): number[] => plan.segments.flatMap((segment, index) => (segment.type === 'bus' ? [index] : []));

/**
 * The first bus leg whose alighting stop has not been reached — which is what makes a
 * transfer work without a second code path — or the last leg past the end of the trip.
 * "Reached" means `seen` holds it, remembered from an earlier fix: judged on the fix
 * itself, standing at the transfer pole moved the cursor on before the alert rang.
 */
function currentBusLeg(plan: RoutePlanResult, seen: ReadonlySet<string>): number {
  const legs = busLegs(plan);
  if (!legs.length) return -1;
  for (const index of legs) {
    const to = plan.segments[index].toStop;
    if (!to || !seen.has(to.id)) return index;
  }
  return legs[legs.length - 1];
}

/** The stops of a bus leg, boarding to alighting, off the direction the plan rides; its two ends if that fails. */
function legStops(plan: RoutePlanResult, segmentIndex: number): { id: string; name: string }[] {
  const segment = plan.segments[segmentIndex];
  const from = segment?.fromStop;
  const to = segment?.toStop;
  if (!from || !to) return [];
  const direction = segment.line?.directions.find((d) => d.id === segment.directionId) ?? segment.line?.directions[0];
  const ids = direction?.stops ?? [];
  const start = ids.indexOf(from.id);
  const end = ids.indexOf(to.id);
  if (start === -1 || end === -1 || end <= start) return [from, to].map(({ id, name }) => ({ id, name }));
  return ids.slice(start, end + 1).map((id) => ({ id, name: stopName(id) }));
}

/**
 * What the mode is showing, from the plan and one GPS fix. A stop counts as passed once
 * the reader has been within `AT_STOP_RADIUS_M` of it, and once passed it stays passed
 * (`seen` is carried in), so a loop or a GPS jump cannot walk the count backwards.
 */
export function tripProgress(plan: RoutePlanResult, fix: TripFix | null, seen: ReadonlySet<string> = new Set()): TripProgress {
  const segmentIndex = currentBusLeg(plan, seen);
  const alighting = plan.segments[segmentIndex]?.toStop;
  const stops = legStops(plan, segmentIndex);

  // What was already behind before this fix.
  const before = stops.reduce((last, stop, i) => (seen.has(stop.id) ? i : last), -1);

  // The next stop in order that this fix is at — not the furthest one it is near. Six of
  // the 48 directions double back along their own avenue, so two stops far apart in the
  // list sit within the radius of each other; taking the furthest ticked nine at once.
  let furthest = before;
  if (fix) {
    for (let i = before + 1; i < stops.length; i++) {
      const known = stopById(stops[i].id);
      if (known && getDistanceMeters(fix.lat, fix.lng, known.lat, known.lng) <= AT_STOP_RADIUS_M) {
        furthest = i;
        break;
      }
    }
  }

  // Everything before the one reached is behind too: a phone does not report a fix at every pole.
  return {
    segmentIndex,
    stops: stops.map((stop, i) => ({ ...stop, passed: i <= furthest, isBoarding: i === 0, isAlighting: i === stops.length - 1 })),
    stopsRemaining: Math.max(0, stops.length - 1 - Math.max(furthest, 0)),
    metresToAlighting: alighting && fix ? getDistanceMeters(fix.lat, fix.lng, alighting.lat, alighting.lng) : null,
    arrived: furthest >= 0 && furthest === stops.length - 1,
  };
}

/** The ids to carry into the next fix, so a stop once reached stays reached. */
export function rememberPassed(progress: TripProgress, seen: ReadonlySet<string>): Set<string> {
  const next = new Set(seen);
  for (const stop of progress.stops) if (stop.passed) next.add(stop.id);
  return next;
}

/** The timetable's answer after a missed bus: the same leg, read again at the pole. `none` = that was the last one today. */
interface LegReplacement {
  leg: number;
  departureMinutes: number;
  arrivalMinutes: number | null;
  precision: Precision;
  arrivalPrecision: Precision;
  none: boolean;
}

export interface TripState {
  plan: RoutePlanResult;
  origin: TripPlace | null;
  destination: TripPlace | null;
  /** Stop ids already reached. */
  seen: string[];
  /** The highest bus leg the reader is known to be on (said so, or seen past its second stop); -1 before boarding. */
  boardedLeg: number;
  /** The leg whose alighting alert already rang. Once per leg. */
  alertedLeg: number;
  replacement: LegReplacement | null;
}

/** `walking` is the stretch after the last bus. There is no `done`: done is the trip being gone. */
export type TripPhase = 'waiting' | 'riding' | 'alighting' | 'walking';

/** Minutes past the printed departure before the mode asks whether the bus was caught. Asked, not guessed. */
export const MISSED_AFTER_MIN = 3;

/** How long before the first bus the way into the ride becomes the first thing on the screen. */
export const BOARDING_SOON_MIN = 10;

/**
 * Whether "Vou nesta" goes to the top of the answer: within ten minutes of the first bus
 * and not after it. A position only ever argues against it — the planner's fix may be
 * from home, so "not at the pole" is trusted and "at the pole" is never claimed from it.
 */
export function boardingIsNow(plan: RoutePlanResult, now: Date, position?: { lat: number; lng: number } | null): boolean {
  const first = plan.segments.find((segment) => segment.type === 'bus');
  if (!first?.departureTime || !first.fromStop) return false;
  const untilBus = parseTimeToMinutes(first.departureTime) - minutesNow(now);
  if (untilBus < 0 || untilBus > BOARDING_SOON_MIN) return false;
  return !position || getDistanceMeters(position.lat, position.lng, first.fromStop.lat, first.fromStop.lng) <= AT_STOP_RADIUS_M;
}

export const startTrip = (plan: RoutePlanResult, origin: TripPlace | null, destination: TripPlace | null): TripState => ({
  plan,
  origin,
  destination,
  seen: [],
  boardedLeg: -1,
  alertedLeg: -1,
  replacement: null,
});

/** The bus leg on screen: the one being ridden, or the one being waited for. */
export const currentLeg = (state: TripState, progress: TripProgress | null): number =>
  progress?.segmentIndex ?? currentBusLeg(state.plan, new Set(state.seen));

const isLastLeg = (plan: RoutePlanResult, leg: number): boolean => {
  const legs = busLegs(plan);
  return legs.length > 0 && leg === legs[legs.length - 1];
};

export function tripPhase(state: TripState, progress: TripProgress | null): TripPhase {
  const leg = currentLeg(state, progress);
  if (leg < 0 || (progress?.arrived && isLastLeg(state.plan, leg))) return 'walking';
  // On the bus once they said so, or once the phone has seen them past the second stop (the first is the pole).
  const passed = progress ? progress.stops.filter((s) => s.passed).length : 0;
  if (!(state.boardedLeg >= leg || passed > 1)) return 'waiting';
  const metres = progress?.metresToAlighting;
  return metres !== null && metres !== undefined && metres <= ALARM_RADIUS_M ? 'alighting' : 'riding';
}

/** The times the mode shows for a leg: the plan's, unless a missed bus replaced them. */
export function legTimes(state: TripState, leg: number): LegReplacement {
  const r = state.replacement;
  if (r && r.leg === leg) return r;
  const segment: TripSegment | undefined = state.plan.segments[leg];
  return {
    leg,
    departureMinutes: segment?.departureTime ? parseTimeToMinutes(segment.departureTime) : 0,
    arrivalMinutes: segment?.arrivalTime ? parseTimeToMinutes(segment.arrivalTime) : null,
    precision: segment?.precision ?? 'estimated',
    arrivalPrecision: segment?.arrivalPrecision ?? 'estimated',
    none: false,
  };
}

/** Whether to ask "did you catch it?": still waiting, the margin has gone by, and not already told there is no later bus. */
export function shouldAskIfMissed(state: TripState, progress: TripProgress | null, now: Date): boolean {
  if (tripPhase(state, progress) !== 'waiting') return false;
  const times = legTimes(state, currentLeg(state, progress));
  return !times.none && minutesNow(now) >= times.departureMinutes + MISSED_AFTER_MIN;
}

/** "Yes, I am on it": the leg is being ridden, whatever the phone thinks. */
export const confirmBoarded = (state: TripState, progress: TripProgress | null): TripState => ({
  ...state,
  boardedLeg: Math.max(state.boardedLeg, currentLeg(state, progress)),
});

/** "No, it left without me": the next run of that line from that pole, or the news that there is none. */
export function missedBus(state: TripState, progress: TripProgress | null, now: Date, lang: Lang): TripState {
  const leg = currentLeg(state, progress);
  const segment = state.plan.segments[leg];
  if (!segment?.line || !segment.fromStop) return state;
  const next = getNextLineDeparture(lang, segment.line, segment.directionId ?? segment.line.directions[0].id, segment.fromStop.id, minutesNow(now), now, segment.toStop?.id);
  return {
    ...state,
    replacement: {
      leg,
      departureMinutes: next.departureMinutes,
      arrivalMinutes: next.arrivalMinutes ?? null,
      precision: next.precision,
      arrivalPrecision: next.arrivalPrecision ?? 'estimated',
      none: !next.isServiceActive,
    },
  };
}

/**
 * One fix in: what changed, and whether to ring — once per leg, at ALARM_RADIUS_M or at
 * the pole itself if no fix came on the way in. Returns the same object when nothing moved.
 */
export function advanceTrip(state: TripState, progress: TripProgress): { state: TripState; ring: boolean } {
  const seen = rememberPassed(progress, new Set(state.seen));
  const passed = progress.stops.filter((s) => s.passed).length;
  const boardedLeg = passed > 1 ? Math.max(state.boardedLeg, progress.segmentIndex) : state.boardedLeg;

  let next: TripState = state;
  if (seen.size !== state.seen.length || boardedLeg !== state.boardedLeg) next = { ...state, seen: [...seen], boardedLeg };

  const phase = tripPhase(next, progress);
  const ring = state.alertedLeg < progress.segmentIndex && (phase === 'alighting' || progress.arrived);
  if (ring) next = { ...next, alertedLeg: progress.segmentIndex };
  return { state: next, ring };
}

/** The trip as text for sessionStorage, each line reduced to its id (a BusLine carries its whole timetable). */
export function packTrip(state: TripState): string {
  return JSON.stringify({
    ...state,
    plan: { ...state.plan, segments: state.plan.segments.map(({ line, ...rest }) => ({ ...rest, lineId: line?.id })) },
  });
}

export function unpackTrip(text: string | null): TripState | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text);
    if (!raw?.plan?.segments || !Array.isArray(raw.seen)) return null;
    const segments = raw.plan.segments.map(({ lineId, ...rest }: { lineId?: string }) => ({ ...rest, line: lineId ? lineById(lineId) : undefined }));
    // A line that no longer exists means the dataset changed under the trip: drop it.
    if (segments.some((s: TripSegment) => s.type === 'bus' && !s.line)) return null;
    return {
      plan: { ...raw.plan, segments },
      origin: raw.origin ?? null,
      destination: raw.destination ?? null,
      seen: raw.seen.filter((id: unknown) => typeof id === 'string'),
      boardedLeg: typeof raw.boardedLeg === 'number' ? raw.boardedLeg : -1,
      alertedLeg: typeof raw.alertedLeg === 'number' ? raw.alertedLeg : -1,
      replacement: raw.replacement ?? null,
    };
  } catch {
    return null;
  }
}
