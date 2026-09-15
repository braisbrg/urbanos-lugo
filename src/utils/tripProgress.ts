import { BUS_LINES, BUS_STOPS } from '../data/transitData';
import { Lang } from '../i18n';
import { ALARM_RADIUS_M } from '../services/stopAlarm';
import { RoutePlanResult } from '../types';
import { getDistanceMeters } from './geo';
import { minutesNow, parseTimeToMinutes } from './schedule';
import { getNextLineDeparture } from './arrivals';

/**
 * Where somebody is along a plan they said they were making.
 *
 * This is the one piece of the trip-companion mode that has no equivalent anywhere in the
 * app, and the one that can be wrong without anything looking wrong: a stop counter that
 * slips does not throw, it just shows a plausible number of stops that is not yours. So
 * it lives here, apart from the screen, and it is a pure function of a plan and a fix.
 *
 * Nothing in here is a bus position. The network publishes none, and none is guessed: the
 * only measurement is the reader's own GPS, and everything else is the plan's own stop
 * list. "Which stops have I passed" is counting against a list, not estimating.
 */

/**
 * How close counts as having reached a stop.
 *
 * A bus pulls in beside the pole, not onto it, and a phone in a pocket on a moving bus is
 * not a survey instrument, so this has to be wider than the vehicle: sixty metres covers
 * the width of a road and a bay.
 *
 * It is wide enough to touch two of the operator's published points at once. Ten of the
 * 1,136 consecutive pairs sit closer than sixty metres, and the tightest reads five —
 * Avda. Américas 88 to Estda. Nova Santiago (Monte Segade), on line 11.
 *
 * That five is not stop spacing, and it should not be read as if it were. The figure was
 * chased down: the arithmetic is right (0.001° of latitude measures 111.0 m here), the
 * coordinates come byte for byte from the operator's own published ones, and the
 * clustering in the dataset generator leaves them apart on purpose because the names
 * differ. What the operator publishes around that junction is three differently-named
 * stops inside a 30 m circle and then nothing for 87 m, and the only one of the three
 * without a printed pole code is the one named after a road it is not on. It looks like a
 * placeholder at a junction rather than a pole, and OSM has nothing by that name to check
 * it against.
 *
 * So the radius has to survive points that are not where a pole is. It does: on those ten
 * pairs the count can drop by one a stop early and corrects itself at the next pole, and
 * the alert is untouched because it fires at 300 m (`ALARM_RADIUS_M`).
 */
export const AT_STOP_RADIUS_M = 60;

export interface TripFix {
  lat: number;
  lng: number;
}

interface TripProgress {
  /** Index into `plan.segments` of the leg the reader is on. */
  segmentIndex: number;
  /** The stops of the current bus leg, in order, with the ones already behind marked. */
  stops: { id: string; name: string; passed: boolean; isBoarding: boolean; isAlighting: boolean }[];
  /** How many stops are still to come before the one they get off at. */
  stopsRemaining: number;
  /** Metres to the alighting stop, straight line. Null when there is no bus leg. */
  metresToAlighting: number | null;
  /** True once the reader is at or past the stop they leave the bus at. */
  arrived: boolean;
}

/** Indices into `plan.segments` of the legs ridden on a bus, in order. */
function busLegs(plan: RoutePlanResult): number[] {
  return plan.segments.flatMap((segment, index) => (segment.type === 'bus' ? [index] : []));
}

/** The bus leg the reader is riding, or the one they are waiting for. */
function currentBusLeg(plan: RoutePlanResult, seen: ReadonlySet<string>): number {
  const legs = busLegs(plan);
  if (!legs.length) return -1;

  /*
   * The first leg whose alighting stop has not been reached.
   *
   * Walking the legs in order and taking the first one not yet finished is what makes a
   * plan with a transfer work without a second code path: get off the 6, and the leg
   * whose end is still ahead becomes the 5.2. The last leg is the fallback, so somebody
   * past the end of the trip stays on the last one rather than falling off the list.
   *
   * Finished means `seen` holds its alighting stop -- remembered from an earlier fix, not
   * measured from this one. Judged on the fix itself, standing at the pole you get off at
   * moved the cursor to the next bus in the same breath, so the first leg was never seen
   * to arrive and its alert never rang; and once off, walking seventy metres towards the
   * next pole moved it back. The fix marks the arrival; the next call acts on it.
   *
   * A ride with no fix at all at the transfer pole leaves the cursor on the
   * first bus while the second is being ridden. The "yes, I am on it" answer is the way
   * out if that turns up in use.
   */
  for (const index of legs) {
    const to = plan.segments[index].toStop;
    if (!to || !seen.has(to.id)) return index;
  }
  return legs[legs.length - 1];
}

/**
 * The stops of a bus leg, from the one boarded to the one left at.
 *
 * Read off the direction the plan says it rides, not off the line: a line has two of
 * them and they are not each other reversed. When the plan's own stops cannot be found in
 * that direction the leg still answers with its two ends, which is worse than the full
 * list and better than an empty screen.
 */
function legStops(plan: RoutePlanResult, segmentIndex: number): { id: string; name: string }[] {
  const segment = plan.segments[segmentIndex];
  const from = segment?.fromStop;
  const to = segment?.toStop;
  if (!from || !to) return [];

  const direction =
    segment.line?.directions.find((d) => d.id === segment.directionId) ?? segment.line?.directions[0];
  const ids = direction?.stops ?? [];
  const start = ids.indexOf(from.id);
  const end = ids.indexOf(to.id);
  if (start === -1 || end === -1 || end <= start) {
    return [
      { id: from.id, name: from.name },
      { id: to.id, name: to.name },
    ];
  }

  return ids.slice(start, end + 1).map((id) => {
    const stop = BUS_STOPS.find((s) => s.id === id);
    return { id, name: stop?.name ?? id };
  });
}

/**
 * What the mode is showing, from the plan and one GPS fix.
 *
 * A stop counts as passed once the reader has been within `AT_STOP_RADIUS_M` of it — and
 * once passed it stays passed, which is why `seen` is carried in rather than derived. A
 * bus that loops back past an earlier pole, or a fix that jumps, must not walk the count
 * backwards while somebody is watching it.
 */
export function tripProgress(
  plan: RoutePlanResult,
  fix: TripFix | null,
  seen: ReadonlySet<string> = new Set(),
): TripProgress {
  const segmentIndex = currentBusLeg(plan, seen);
  const segment = plan.segments[segmentIndex];
  const stops = legStops(plan, segmentIndex);
  const alighting = segment?.toStop;

  // What was already behind before this fix. No fix yet -- the phone is still asking, or
  // was told no -- shows what is remembered and nothing more. The list is still the
  // list; only the ticks need a position.
  const before = stops.reduce((last, stop, i) => (seen.has(stop.id) ? i : last), -1);

  /*
   * The next stop in order that this fix is at -- not the furthest one it happens to be
   * near.
   *
   * The first version took the furthest, and the reason it is wrong is measured rather
   * than imagined: six of the 48 directions double back along their own avenue, so two
   * stops far apart in the list sit within the radius of each other on the ground. The
   * worst is the 4.1 outbound, where stop 20 (N-640, Taller López y Vázquez) and stop 29
   * (Rotonda Rda. Norte) are 38 m apart; the 4.1 return has its Pista Muxa poles 15 m
   * apart in the two directions, and the 5.2 and 5DS do the same on Ramón Ferreiro.
   * Standing at stop 20 marked stop 29 reached, ticked 21 to 29 in one go, and -- because
   * a stop once passed stays passed -- never came back: nine stops gone from the count and
   * the alert nine stops early.
   *
   * Walking forward from the last stop reached and taking the first one within the radius
   * cannot make that jump. It can still skip stops the phone gave no fix at, because the
   * scan runs on to whatever is actually in range; what it refuses to do is pass a pole
   * that is in range to reach one further on. The failure it leaves is the harmless one:
   * a fix that genuinely arrives at stop 29 after a long silence is read as stop 20 and
   * corrected at stop 30, one stop later.
   */
  let furthest = before;
  if (fix) {
    for (let i = before + 1; i < stops.length; i++) {
      const known = BUS_STOPS.find((s) => s.id === stops[i].id);
      if (!known) continue;
      if (getDistanceMeters(fix.lat, fix.lng, known.lat, known.lng) <= AT_STOP_RADIUS_M) {
        furthest = i;
        break;
      }
    }
  }

  /*
   * Everything before the one reached is behind you too.
   *
   * A phone does not report a fix at every pole — the bus does not stop at all of them,
   * and a fix can be a minute apart. Marking only what was within sixty metres left gaps
   * in the middle of the list, so the reader saw stop 3 ticked, 4 and 5 not, and 6 ticked.
   * The bus does not skip backwards: reaching one means every earlier one is done.
   */
  const marked = stops.map((stop, i) => ({
    id: stop.id,
    name: stop.name,
    passed: i <= furthest,
    isBoarding: i === 0,
    isAlighting: i === stops.length - 1,
  }));

  return {
    segmentIndex,
    stops: marked,
    stopsRemaining: Math.max(0, stops.length - 1 - Math.max(furthest, 0)),
    metresToAlighting:
      alighting && fix ? Math.round(getDistanceMeters(fix.lat, fix.lng, alighting.lat, alighting.lng)) : null,
    arrived: furthest >= 0 && furthest === stops.length - 1,
  };
}

/** The ids to carry into the next fix, so a stop once reached stays reached. */
export function rememberPassed(progress: TripProgress, seen: ReadonlySet<string>): Set<string> {
  const next = new Set(seen);
  for (const stop of progress.stops) if (stop.passed) next.add(stop.id);
  return next;
}

/* ------------------------------------------------------------------------------------
 * The trip itself: what the mode remembers between two fixes, and across a reload.
 * ---------------------------------------------------------------------------------- */

export interface TripPlace {
  name: string;
  lat: number;
  lng: number;
}

/**
 * The timetable's answer after a missed bus: the same leg, read again at the pole.
 *
 * Not a new plan. Recomputing from a moving position is expensive and imprecise, and the
 * stops are still right -- only the times moved, by one whole headway. `none` is the
 * honest end of that road: the bus that was missed was the last one today, and the mode
 * says so rather than printing tomorrow's first departure as if it were tonight's.
 */
interface LegReplacement {
  leg: number;
  departureMinutes: number;
  arrivalMinutes: number | null;
  precision: 'published' | 'estimated';
  arrivalPrecision: 'published' | 'estimated';
  none: boolean;
}

export interface TripState {
  plan: RoutePlanResult;
  origin: TripPlace | null;
  destination: TripPlace | null;
  /** Stop ids already reached, so a stop once passed stays passed. */
  seen: string[];
  /**
   * The highest bus leg the reader is known to be on: they said so, or the phone saw
   * them past its second stop. -1 before boarding anything. Boarding is never inferred
   * from speed -- a bus at a red light and a brisk walk look the same to a GPS.
   */
  boardedLeg: number;
  /** The leg whose alighting alert already rang. Once per leg, never twice. */
  alertedLeg: number;
  replacement: LegReplacement | null;
}

/**
 * Where the mode is. `walking` is the stretch after the last bus: to the door, on foot,
 * with the button that ends the trip. There is no `done`: done is the trip being gone.
 */
type TripPhase = 'waiting' | 'riding' | 'alighting' | 'walking';

/**
 * Minutes past the printed departure before the mode asks whether the bus was caught.
 *
 * Asked, not guessed: the median gap to the next run of the same line at the same pole
 * is 30 minutes and the p90 is 90, so a wrong guess is a screen of wrong times for the
 * rest of the trip. Three minutes is the late bus that still comes; after it the
 * question costs one tap and the wrong answer costs nothing, because it is a question.
 */
export const MISSED_AFTER_MIN = 3;

/** How long before the first bus the way into the ride becomes the first thing on the screen. */
export const BOARDING_SOON_MIN = 10;

/**
 * Whether "Vou nesta" is the thing to press right now.
 *
 * The button is always there; this decides when it goes to the top of the answer at
 * headline size. Ten minutes before the first bus and not after it -- past the printed
 * time the plan is stale and the planner's own replan is what should speak. A position
 * only ever argues against it: the planner's fix is the one the reader asked for with the
 * GPS button, taken once and possibly from home, so "not at the pole" is trusted and "at
 * the pole" is never claimed from it. No fix at all is the ordinary case, and then the
 * clock decides on its own.
 */
export function boardingIsNow(
  plan: RoutePlanResult,
  now: Date,
  position?: { lat: number; lng: number } | null,
): boolean {
  const first = plan.segments.find((segment) => segment.type === 'bus');
  if (!first?.departureTime || !first.fromStop) return false;
  const untilBus = parseTimeToMinutes(first.departureTime) - minutesNow(now);
  if (untilBus < 0 || untilBus > BOARDING_SOON_MIN) return false;
  if (!position) return true;
  return getDistanceMeters(position.lat, position.lng, first.fromStop.lat, first.fromStop.lng) <= AT_STOP_RADIUS_M;
}

export function startTrip(
  plan: RoutePlanResult,
  origin: TripPlace | null,
  destination: TripPlace | null,
): TripState {
  return { plan, origin, destination, seen: [], boardedLeg: -1, alertedLeg: -1, replacement: null };
}

/** The bus leg on screen: the one being ridden, or the one being waited for. */
export function currentLeg(state: TripState, progress: TripProgress | null): number {
  return progress?.segmentIndex ?? currentBusLeg(state.plan, new Set(state.seen));
}

/** Whether `leg` is the plan's last ride. */
function isLastLeg(plan: RoutePlanResult, leg: number): boolean {
  const legs = busLegs(plan);
  return legs.length > 0 && leg === legs[legs.length - 1];
}

export function tripPhase(state: TripState, progress: TripProgress | null): TripPhase {
  const leg = currentLeg(state, progress);
  if (leg < 0) return 'walking';
  if (progress?.arrived && isLastLeg(state.plan, leg)) return 'walking';

  // On the bus once they said so, or once the phone has seen them past the second stop
  // of the leg -- the first is the pole they were standing at.
  const passed = progress ? progress.stops.filter((s) => s.passed).length : 0;
  const riding = state.boardedLeg >= leg || passed > 1;
  if (!riding) return 'waiting';

  const metres = progress?.metresToAlighting;
  return metres !== null && metres !== undefined && metres <= ALARM_RADIUS_M ? 'alighting' : 'riding';
}

/** The times the mode shows for a leg: the plan's, unless a missed bus replaced them. */
export function legTimes(state: TripState, leg: number): LegReplacement {
  const r = state.replacement;
  if (r && r.leg === leg) return r;
  const segment = state.plan.segments[leg];
  return {
    leg,
    departureMinutes: segment?.departureTime ? parseTimeToMinutes(segment.departureTime) : 0,
    arrivalMinutes: segment?.arrivalTime ? parseTimeToMinutes(segment.arrivalTime) : null,
    precision: segment?.precision ?? 'estimated',
    arrivalPrecision: segment?.arrivalPrecision ?? 'estimated',
    none: false,
  };
}

/**
 * Whether to ask "did you catch it?": still waiting, the printed departure plus the
 * margin has gone by, and nothing has said otherwise. Not asked again once the answer
 * was that there is no later bus.
 */
export function shouldAskIfMissed(state: TripState, progress: TripProgress | null, now: Date): boolean {
  if (tripPhase(state, progress) !== 'waiting') return false;
  const times = legTimes(state, currentLeg(state, progress));
  if (times.none) return false;
  return minutesNow(now) >= times.departureMinutes + MISSED_AFTER_MIN;
}

/** "Yes, I am on it": the leg is being ridden, whatever the phone thinks. */
export function confirmBoarded(state: TripState, progress: TripProgress | null): TripState {
  return { ...state, boardedLeg: Math.max(state.boardedLeg, currentLeg(state, progress)) };
}

/** "No, it left without me": the next run of that line from that pole, or the news that there is none. */
export function missedBus(state: TripState, progress: TripProgress | null, now: Date, lang: Lang): TripState {
  const leg = currentLeg(state, progress);
  const segment = state.plan.segments[leg];
  if (!segment?.line || !segment.fromStop) return state;

  const minutes = minutesNow(now);
  const next = getNextLineDeparture(
    lang,
    segment.line,
    segment.directionId ?? segment.line.directions[0].id,
    segment.fromStop.id,
    minutes,
    minutes,
    now,
    segment.toStop?.id,
  );
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
 * One fix in: what changed, and whether to ring.
 *
 * The alert is the board's alarm at the board's radius, for the stop this leg ends at,
 * and it rings once per leg -- at 300 m, or at the pole itself if the phone gave no fix
 * on the way in. Returns the same object when nothing moved, so a screen waiting on it
 * does not redraw on every fix.
 */
export function advanceTrip(state: TripState, progress: TripProgress): { state: TripState; ring: boolean } {
  const seen = rememberPassed(progress, new Set(state.seen));
  const passed = progress.stops.filter((s) => s.passed).length;
  const boardedLeg = passed > 1 ? Math.max(state.boardedLeg, progress.segmentIndex) : state.boardedLeg;

  let next: TripState = state;
  if (seen.size !== state.seen.length || boardedLeg !== state.boardedLeg) {
    next = { ...state, seen: [...seen], boardedLeg };
  }

  const phase = tripPhase(next, progress);
  const ring =
    state.alertedLeg < progress.segmentIndex && (phase === 'alighting' || progress.arrived);
  if (ring) next = { ...next, alertedLeg: progress.segmentIndex };
  return { state: next, ring };
}

/* ------------------------------------------------------------------------------------
 * Surviving a reload. A locked phone in a pocket is where this mode lives, and Safari
 * discards a background tab freely; a mode that cannot come back from that is no mode.
 * ---------------------------------------------------------------------------------- */

/**
 * The trip as text, with each line reduced to its id.
 *
 * A `BusLine` carries its whole timetable and both direction geometries, and a plan
 * holds one per bus leg; the id is enough to get it back from the dataset the app
 * already ships. Stops stay inline -- a few hundred bytes each -- so the text says
 * plainly what it holds: the stops, lines and times of one trip.
 */
export function packTrip(state: TripState): string {
  return JSON.stringify({
    ...state,
    plan: {
      ...state.plan,
      segments: state.plan.segments.map(({ line, ...rest }) => ({ ...rest, lineId: line?.id })),
    },
  });
}

export function unpackTrip(text: string | null): TripState | null {
  if (!text) return null;
  try {
    const raw = JSON.parse(text);
    if (!raw?.plan?.segments || !Array.isArray(raw.seen)) return null;
    const segments = raw.plan.segments.map(({ lineId, ...rest }: { lineId?: string }) => ({
      ...rest,
      line: lineId ? BUS_LINES.find((l) => l.id === lineId) : undefined,
    }));
    // A line that no longer exists means the dataset changed under the trip: drop it.
    if (segments.some((s: { type: string; line?: unknown }) => s.type === 'bus' && !s.line)) return null;
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
