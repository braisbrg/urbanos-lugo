/**
 * The trip planner: direct rides, one transfer, walking, and the ranking between them.
 *
 * Pure functions over the shipped dataset, no React and no DOM. One of the four files
 * the old transitEngine.ts was split into, by subject.
 */
import { BUS_STOPS, BUS_LINES, FARES } from '../data/transitData';
import { directionLabel } from './serviceLabels';
import { Lang, translations } from '../i18n';
import { BusStop, BusLine, RoutePlanResult, TripFare } from '../types';
import { getDistanceMeters } from './geo';
import { formatMinutes, parseTimeToMinutes } from './schedule';
import { LocationResolution, estimateWalk, getNearbyStops, resolveLocationQuery } from './places';
import { getNextLineDeparture } from './arrivals';

/**
 * Real in-vehicle time and distance between two stops of one direction, summed from
 * the road legs measured for the route. Falls back to a flat estimate only when a
 * direction has no measured geometry.
 */
function rideBetween(
  direction: BusLine['directions'][number],
  fromIndex: number,
  toIndex: number,
): { minutes: number; meters: number; stopsCount: number } {
  const stopsCount = Math.max(1, toIndex - fromIndex);
  let seconds = 0;
  let meters = 0;
  for (let i = fromIndex; i < toIndex; i++) {
    seconds += (direction.legSeconds?.[i] ?? 90) + 20; // + dwell
    meters += direction.legMeters?.[i] ?? 400;
  }
  return { minutes: Math.max(1, Math.round(seconds / 60)), meters: Math.round(meters), stopsCount };
}

/**
 * Of every line serving both stops in the right order, the one that gets you there
 * soonest. The planner used to take `lines[0]`, so at a hub with fourteen lines it
 * could pick one that had stopped running and then report the whole trip as
 * "servizo finalizado".
 */
function pickBestBoarding(
  lang: Lang,
  candidateLineIds: string[],
  fromStopId: string,
  toStopId: string,
  readyAtMinutes: number,
  now: Date,
): { line: BusLine; direction: BusLine['directions'][number]; departure: ReturnType<typeof getNextLineDeparture> } | null {
  let best: { line: BusLine; direction: BusLine['directions'][number]; departure: ReturnType<typeof getNextLineDeparture>; arrival: number } | null = null;

  for (const lineId of candidateLineIds) {
    const line = BUS_LINES.find((l) => l.id === lineId);
    if (!line) continue;

    for (const direction of line.directions) {
      const from = direction.stops.indexOf(fromStopId);
      const to = direction.stops.indexOf(toStopId);
      if (from === -1 || to === -1 || to <= from) continue;

      const departure = getNextLineDeparture(lang, line, direction.id, fromStopId, readyAtMinutes, readyAtMinutes, now, toStopId);
      const arrival = departure.arrivalMinutes ?? departure.departureMinutes + rideBetween(direction, from, to).minutes;

      // Prefer a line that is actually running, then the earliest arrival.
      const better =
        !best ||
        (departure.isServiceActive && !best.departure.isServiceActive) ||
        (departure.isServiceActive === best.departure.isServiceActive && arrival < best.arrival);
      if (better) best = { line, direction, departure, arrival };
    }
  }

  return best ? { line: best.line, direction: best.direction, departure: best.departure } : null;
}

/**
 * What the trip costs. A single ticket pays per boarding; the Tarxeta Cidadá pays once
 * as long as every transfer happens inside the window, which is exactly the thing worth
 * telling someone before they decide how to pay.
 */
function fareFor(segments: RoutePlanResult['segments']): TripFare {
  const boardings = segments
    .filter((s) => s.type === 'bus' && s.departureTime)
    .map((s) => parseTimeToMinutes(s.departureTime!));

  const busLegs = boardings.length;
  const transferSpanMinutes = busLegs > 1 ? Math.round(boardings[busLegs - 1] - boardings[0]) : 0;
  const transfersFree = busLegs <= 1 || transferSpanMinutes <= FARES.freeTransferWindowMinutes;

  return {
    busLegs,
    transfersFree,
    transferSpanMinutes,
    singleTicketEuros: Number((busLegs * FARES.singleTicket).toFixed(2)),
    citizenCardEuros: Number(((transfersFree ? 1 : busLegs) * FARES.citizenCard).toFixed(2)),
  };
}

/** One complete option the planner is considering. */
interface Itinerary {
  /** Arrival at the last bus stop, in minutes from midnight. */
  arrivalMinutes: number;
  /** Whether the operator prints that arrival, or we interpolated it. */
  arrivalPrecision: 'published' | 'estimated';
  segments: RoutePlanResult['segments'];
  totalWaitMinutes: number;
  isServiceActive: boolean;
  serviceNotice?: string;
}

/** Ride one line from `fromStop` to `toStop`, boarding no earlier than `readyAt`. */
/**
 * A one-stop ride is never offered.
 *
 * Measured over 2,254 legs at midday, a one-stop ride averages 1.2 minutes of riding
 * after 5.3 spent waiting, against a 5-minute walk between the same two poles: it
 * costs what the walk costs. The nine that did beat the walk saved between one and
 * three minutes over walks of 170 to 520 metres -- across the whole network not one
 * saved four. A saving that small does not survive a bus running late, and unlike the
 * walk it is not yours to control, so the app does not suggest standing at a pole for
 * it. Two stops is a truer tie (2.3 after 8.8, against 11 on foot) and some of those
 * legs cross a river or a dual carriageway, so the rule stops at one.
 */
const isNotWorthBoarding = (stopsCount: number) => stopsCount <= 1;

function buildLeg(
  lang: Lang,
  candidateLineIds: string[],
  fromStop: BusStop,
  toStop: BusStop,
  readyAt: number,
  now: Date,
  hubLabel?: string,
  /**
   * When the standing about actually begins, if that is earlier than `readyAt`.
   *
   * These two are the same everywhere except at a transfer, where `readyAt` carries a
   * safety buffer — two minutes on a published connecting time, four on an estimated
   * one — so that a slightly late bus does not cost the connection. That buffer is time
   * spent at the stop, but it was not in any segment: the itinerary showed a bus arriving
   * at 16:52 and a wait beginning at 16:56, with four minutes belonging to nothing.
   * Measured over 1.550 planned options, 857 of them had exactly that gap.
   *
   * The buffer still decides which departure can be caught. It just stops being invisible:
   * somebody standing on the pavement from 16:52 waits nine minutes, not five.
   */
  waitingFrom?: number,
): Itinerary | null {
  const option = pickBestBoarding(lang, candidateLineIds, fromStop.id, toStop.id, readyAt, now);
  if (!option) return null;

  const { line, direction, departure } = option;
  const ride = rideBetween(direction, direction.stops.indexOf(fromStop.id), direction.stops.indexOf(toStop.id));

  const segments: RoutePlanResult['segments'] = [];
  const waitStart = Math.min(readyAt, waitingFrom ?? readyAt);
  const waitMinutes = Math.max(0, departure.departureMinutes - waitStart);

  // Callers already read a null leg as "no itinerary this way", and the walking plan is
  // always offered, so refusing one here never leaves a trip without an answer.
  if (isNotWorthBoarding(ride.stopsCount)) return null;

  if (waitMinutes > 0) {
    segments.push({
      type: 'wait',
      fromStop,
      durationMinutes: waitMinutes,
      departureTime: formatMinutes(waitStart),
      arrivalTime: formatMinutes(departure.departureMinutes),
      instruction: hubLabel
        ? translations(lang).engine.transferAt(fromStop.name, line.number)
        : translations(lang).engine.waitAt(fromStop.name, line.number, direction.destination),
    });
  }

  const boardTime = departure.departureMinutes;
  const arriveTime = departure.arrivalMinutes ?? boardTime + ride.minutes;

  /*
   * The duration and the two times printed beside it have to be the same number.
   *
   * They were not. `formatMinutes` rounds each end to a whole minute; this rounded the
   * gap between the ends instead, which can differ by one in either direction, and then
   * floored the answer at 1. Where the operator's timetable puts two stops in the same
   * minute -- adjacent poles on one street, which happens -- the leg printed "07:36 ->
   * 07:36" above "1 min": a minute that was in the segment and in no part of the clock.
   * Measured on one pair, 40 of its 4.320 options across the day had it, always that
   * shape, and it is the same family of defect as the transfer buffer that belonged to
   * nothing.
   *
   * So the duration is read off the printed ends, and a hop the timetable finishes inside
   * one minute is allowed to say so. Pushing the arrival to the next minute instead would
   * have contradicted a published time, which is the one thing this app does not do.
   */
  const shownBoard = Math.round(boardTime);
  const shownArrive = Math.round(arriveTime);

  segments.push({
    type: 'bus',
    line,
    directionId: direction.id,
    precision: departure.precision,
    arrivalPrecision: departure.arrivalPrecision ?? 'estimated',
    fromStop,
    toStop,
    durationMinutes: shownArrive - shownBoard,
    stopsCount: ride.stopsCount,
    departureTime: formatMinutes(boardTime),
    arrivalTime: formatMinutes(arriveTime),
    instruction: translations(lang).engine.board(
      line.number,
      directionLabel(direction, lang),
      formatMinutes(boardTime),
      toStop.name,
      ride.stopsCount,
      (ride.meters / 1000).toFixed(1),
      formatMinutes(arriveTime),
    ),
  });

  return {
    arrivalMinutes: arriveTime,
    arrivalPrecision: departure.arrivalPrecision ?? 'estimated',
    segments,
    totalWaitMinutes: waitMinutes,
    isServiceActive: departure.isServiceActive,
    serviceNotice: departure.serviceNotice,
  };
}

/**
 * Every stop you can reach from `stopId` without changing bus: each line serving it,
 * in the direction that actually goes onward from there.
 */
function reachableFrom(stopId: string, lines: string[]): Set<string> {
  const out = new Set<string>();
  for (const lineId of lines) {
    const line = BUS_LINES.find((l) => l.id === lineId);
    if (!line) continue;
    for (const direction of line.directions) {
      const from = direction.stops.indexOf(stopId);
      if (from === -1) continue;
      for (let i = from + 1; i < direction.stops.length; i++) out.add(direction.stops[i]);
    }
  }
  return out;
}

/** Every stop from which `stopId` is reachable without changing bus. */
function reachingInto(stopId: string, lines: string[]): Set<string> {
  const out = new Set<string>();
  for (const lineId of lines) {
    const line = BUS_LINES.find((l) => l.id === lineId);
    if (!line) continue;
    for (const direction of line.directions) {
      const to = direction.stops.indexOf(stopId);
      if (to === -1) continue;
      for (let i = 0; i < to; i++) out.add(direction.stops[i]);
    }
  }
  return out;
}

/**
 * How long to allow for changing bus.
 *
 * Two minutes covers walking between poles at an interchange, and is enough when the
 * operator prints the arrival: both sides then come from the same official table. When
 * the arrival is interpolated between timing points it can be a minute or so out, and a
 * missed connection costs a whole headway, so those get a wider margin. Erring wide only
 * pushes a suggestion to the next bus; erring narrow leaves someone on the pavement.
 */
/**
 * How far somebody will walk between one bus and the next.
 *
 * Three hundred metres is about four minutes at the calibrated pace: two streets, the
 * kind of change people already make without thinking of it as one. Much further and
 * the walk stops being a transfer and starts being the trip.
 */
const MAX_TRANSFER_WALK_M = 300;
/** Each candidate costs two timetable lookups; these caps keep a plan under 100 ms. */
const MAX_SAME_POLE_HUBS = 40;
const MAX_WALKING_HUBS = 20;

const TRANSFER_BUFFER_MIN = 2;
export const TRANSFER_BUFFER_ESTIMATED_MIN = 4;

/**
 * Above this a wait stops being a wait, for the purpose of wording it.
 *
 * "302 min de espera" beside "sae ás 14:32" says the same thing twice, and the countdown
 * is the useless half: nobody stands at a pole for five hours, they come back at half past
 * two. This is a presentation threshold and nothing is refused because of it.
 */
export const LONG_WAIT_MIN = 90;

/**
 * Above this a wait stops being a connection, and the transfer is not offered.
 *
 * Counted over 33.661 transfer waits at four times of day: 85% are under 90 minutes and
 * 60% under 30, then a thin tail out to six hours, and then a cluster of 2.254 sitting
 * between twelve hours and two days. That cluster is not a connection — it is the next
 * morning, and the clock renders it as the same hour, so a bus arriving at 08:59 and one
 * leaving at 09:00 read as a one-minute change when they are a day apart.
 *
 * Three hours, because the largest headway the operator publishes is 60 minutes: that
 * leaves room for a rural line with an irregular timetable to miss two windows and still
 * be a connection somebody would make. Capping at the 90 above instead was tried and
 * refused 2.940 waits between 90 minutes and six hours, which cost two rural Sunday pairs
 * the only bus answer they had.
 *
 * Refusing costs nothing structural: the direct rides and the walking option are always
 * offered, and every other interchange is still tried.
 */
const MAX_TRANSFER_WAIT_MIN = 180;

/** Chain two legs through one interchange, allowing time to change platform. */
function buildTransfer(
  lang: Lang,
  startStop: BusStop,
  endStop: BusStop,
  hubIn: BusStop,
  hubOut: BusStop,
  readyAt: number,
  now: Date,
): Itinerary | null {
  if (hubIn.id === startStop.id || hubOut.id === endStop.id) return null;

  const leg1Lines = startStop.lines.filter((l) => hubIn.lines.includes(l));
  const leg2Lines = endStop.lines.filter((l) => hubOut.lines.includes(l));
  if (!leg1Lines.length || !leg2Lines.length) return null;

  const first = buildLeg(lang, leg1Lines, startStop, hubIn, readyAt, now);
  if (!first) return null;

  const buffer = first.arrivalPrecision === 'published' ? TRANSFER_BUFFER_MIN : TRANSFER_BUFFER_ESTIMATED_MIN;

  // Getting off at one pole and on at another a couple of streets away is a normal
  // change, and it is how half the network connects: one line ends inside the walls
  // and a whole family of lines runs along the ring road 275 m away. Requiring one
  // shared pole meant the planner walked people 700 m to a different line instead.
  const change: RoutePlanResult['segments'] = [];
  let boardAt = first.arrivalMinutes + buffer;
  if (hubIn.id !== hubOut.id) {
    const walk = estimateWalk(getDistanceMeters(hubIn.lat, hubIn.lng, hubOut.lat, hubOut.lng));
    change.push({
      type: 'walk',
      durationMinutes: walk.minutes,
      walkMeters: walk.meters,
      departureTime: formatMinutes(first.arrivalMinutes),
      arrivalTime: formatMinutes(first.arrivalMinutes + walk.minutes),
      instruction: translations(lang).engine.walkToStop(hubIn.name, hubOut.name, hubOut.code),
    });
    boardAt = first.arrivalMinutes + walk.minutes + buffer;
  }

  // The buffer decides which departure can be caught; it is not time spent anywhere else,
  // so the wait is shown from the moment the reader is standing at the pole.
  const freeAt = change.length ? first.arrivalMinutes + (change[0].durationMinutes ?? 0) : first.arrivalMinutes;
  const second = buildLeg(lang, leg2Lines, hubOut, endStop, boardAt, now, hubOut.name, freeAt);
  if (!second) return null;

  /**
   * A connection you would have to sleep through is not a connection.
   *
   * `buildLeg` answers "the next departure at or after this minute", and when the last bus
   * of the day has gone that is tomorrow morning. The transfer was built anyway: a 1.441
   * minute wait, printed as a bus arriving at 08:59 and the next leaving at 09:00, because
   * the clock renders a day later as the same hour. It read as a one-minute change.
   *
   * It hid because the wait segment used to start at the buffered boarding minute, which
   * put its two ends in the wrong order -- 09:06 to 09:00 -- and the check that walks a
   * plan's timeline treats a step backwards as midnight and added a day, so the gap came
   * out as 1.441 minutes and passed. Making the itinerary continuous took the disguise
   * away, which is how a check that had been passing for the wrong reason started failing
   * for the right one.
   *
   * The cap is the one the planner already uses to decide a wait has stopped being a wait.
   * Refusing here costs nothing: the direct rides and the walking option are always
   * offered, and any other interchange is still tried.
   */
  const changeWait = second.segments.find((s) => s.type === 'wait')?.durationMinutes ?? 0;
  if (changeWait > MAX_TRANSFER_WAIT_MIN) return null;

  // Getting off a bus to wait for the same line is never the answer. In the same
  // direction it is literally the bus you were already on, and the direct ride is
  // guaranteed to exist: the hub sits between origin and destination on that
  // direction, so the destination is reachable without moving. In the opposite
  // direction it means doubling back. Either way the passenger sees "5.1 -> 5.1".
  const rides = (it: Itinerary) => it.segments.find((s) => s.type === 'bus')?.line?.id;
  if (rides(first) === rides(second)) return null;

  return {
    arrivalMinutes: second.arrivalMinutes,
    arrivalPrecision: second.arrivalPrecision,
    segments: [...first.segments, ...change, ...second.segments],
    totalWaitMinutes: first.totalWaitMinutes + second.totalWaitMinutes,
    isServiceActive: first.isServiceActive && second.isServiceActive,
    serviceNotice: first.serviceNotice || second.serviceNotice,
  };
}

/**
 * Interchanges that genuinely connect these two stops: reachable onward from the
 * origin AND able to reach the destination. Six hardcoded "central" stops missed most
 * real connections, e.g. anything crossing town without touching the ring road.
 */
function connectingHubs(startStop: BusStop, endStop: BusStop): [BusStop, BusStop][] {
  const forward = reachableFrom(startStop.id, startStop.lines);
  const backward = reachingInto(endStop.id, endStop.lines);

  const arrivals: BusStop[] = [];
  const departures: BusStop[] = [];
  for (const s of BUS_STOPS) {
    if (forward.has(s.id) && s.id !== endStop.id) arrivals.push(s);
    if (backward.has(s.id) && s.id !== startStop.id) departures.push(s);
  }

  // The same pole first: no walk, no risk, and it is most of the network.
  const same = arrivals
    .filter((s) => backward.has(s.id))
    .sort((a, b) => b.lines.length - a.lines.length)
    .slice(0, MAX_SAME_POLE_HUBS)
    .map((s): [BusStop, BusStop] => [s, s]);

  // Then pairs a short walk apart. One line ends inside the walls and a whole family
  // of lines runs along the ring road 275 m away; without this the planner cannot see
  // that change at all, and walks people 700 m to a different line instead.
  const pairs: { pair: [BusStop, BusStop]; walk: number }[] = [];
  for (const a of arrivals) {
    if (backward.has(a.id)) continue; // already covered as a same-pole hub
    for (const b of departures) {
      if (a.id === b.id) continue;
      const metres = getDistanceMeters(a.lat, a.lng, b.lat, b.lng);
      if (metres > MAX_TRANSFER_WALK_M) continue;
      pairs.push({ pair: [a, b], walk: metres });
    }
  }
  pairs.sort((x, y) => x.walk - y.walk);

  return [...same, ...pairs.slice(0, MAX_WALKING_HUBS).map((p) => p.pair)];
}

// Plan route between two locations/stops with smart multi-modal walking + bus optimization
interface PlanOptions {
  /**
   * Which language the itinerary sentences come back in.
   *
   * The engine writes prose — "get on Line 5.1 and get off after 25 stops" — so it has
   * to know. Passed explicitly rather than read from a module-level global: the
   * functions stay pure and the dependency is visible at every call site.
   */
  lang?: Lang;
  userLocation?: [number, number];
  now?: Date;
  /** Leave at this time instead of now, in minutes from midnight. */
  departAt?: number;
  /**
   * Be there by this time, in minutes from midnight. The planner returns the LATEST
   * departure that still makes it — the question people actually ask before a hospital
   * appointment or a class.
   */
  arriveBy?: number;
  /**
   * How long the walk to a stop really takes, when somebody has measured it.
   *
   * Every walk in here is otherwise the straight line times 1.35, which is a good enough
   * guess to build a plan from and a bad one to promise a bus on. Once `walkRouter` has
   * traced the pavement, the caller can hand the answer back: minutes from the origin to
   * that stop, or undefined for a stop nobody has measured yet.
   *
   * It matters twice. The candidate list is filtered and ranked on this walk, so a stop
   * that is really twelve minutes away stops passing for five; and `readyAt` for the
   * first bus is computed from it, so the boarding time is one the reader can keep.
   */
  measuredWalkToStop?: (stopId: string) => number | undefined;
}

/** How far back to look for a departure that still arrives in time. */
const ARRIVE_BY_LOOKBACK_MIN = 180;
const ARRIVE_BY_STEP_MIN = 5;

/**
 * Every distinct way of making the trip, quickest first. Showing the alternatives lets
 * someone pick the one that suits them — a line they know, fewer changes, less walking —
 * instead of trusting a single answer.
 */
export function planTrips(fromQuery: string, toQuery: string, options: PlanOptions = {}): RoutePlanResult[] {
  const { userLocation, now = new Date(), lang = 'gl', measuredWalkToStop } = options;

  if (options.arriveBy !== undefined) {
    return planArrivingBy(fromQuery, toQuery, options.arriveBy, options);
  }

  if (options.departAt !== undefined) {
    const at = new Date(now);
    at.setHours(Math.floor(options.departAt / 60), Math.round(options.departAt % 60), 0, 0);
    return planDeparting(lang, fromQuery, toQuery, userLocation, at, options.measuredWalkToStop);
  }

  return planDeparting(lang, fromQuery, toQuery, userLocation, now, options.measuredWalkToStop);
}

/** The single best option, for callers that only want an answer. */
export function planSmartTrip(
  fromQuery: string,
  toQuery: string,
  options: PlanOptions = {},
): RoutePlanResult | null {
  return planTrips(fromQuery, toQuery, options)[0] ?? null;
}

/**
 * Walk departure times backwards from the deadline and keep the last one that still
 * arrives in time. Each probe is a normal forward plan, so transfers and service hours
 * are handled exactly the same way.
 */
function planArrivingBy(
  fromQuery: string,
  toQuery: string,
  arriveBy: number,
  options: PlanOptions,
): RoutePlanResult[] {
  const now = options.now ?? new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const earliest = Math.max(nowMinutes, arriveBy - ARRIVE_BY_LOOKBACK_MIN);

  // Keep the latest departure per journey that still arrives in time.
  const byJourney = new Map<string, RoutePlanResult>();
  for (let depart = earliest; depart <= arriveBy; depart += ARRIVE_BY_STEP_MIN) {
    const at = new Date(now);
    at.setHours(Math.floor(depart / 60), depart % 60, 0, 0);
    for (const plan of planDeparting(options.lang ?? 'gl', fromQuery, toQuery, options.userLocation, at, options.measuredWalkToStop)) {
      if (!plan.isServiceActive) continue;
      if (parseTimeToMinutes(plan.arrivalTime) > arriveBy) continue;
      const key = plan.segments
        .filter((seg) => seg.type === 'bus')
        .map((seg) => `${seg.line?.id}/${seg.directionId}`)
        .join('>');
      // Later departure, same deadline: strictly better for the traveller.
      byJourney.set(key, plan);
    }
  }

  return [...byJourney.values()].sort(
    (a, b) => parseTimeToMinutes(b.departureTime) - parseTimeToMinutes(a.departureTime),
  );
}

function planDeparting(
  lang: Lang,
  fromQuery: string,
  toQuery: string,
  userLocation: [number, number] | undefined,
  now: Date,
  measuredWalkToStop?: (stopId: string) => number | undefined,
): RoutePlanResult[] {
  const fromRes = resolveLocationQuery(fromQuery, userLocation, lang);
  const toRes = resolveLocationQuery(toQuery, userLocation, lang);
  // One of the two places is not in the dataset. No itinerary is better than one that
  // silently starts somewhere else.
  if (!fromRes || !toRes) return [];

  // Only ever considering the single closest stop meant a badly-served pole next door
  // could turn a 20-minute trip into a 12-hour wait, or into "no route at all". Walking
  // a few extra minutes to a better-served stop is what a person would do.
  const onFoot = walkingOnlyPlan(lang, fromRes, toRes, now);
  const starts = boardingCandidates(fromRes, onFoot.durationMinutes, measuredWalkToStop);
  const ends = boardingCandidates(toRes, onFoot.durationMinutes);

  const all: RoutePlanResult[] = [onFoot];
  for (const from of starts) {
    for (const to of ends) {
      if (from.stop.id === to.stop.id) continue;
      all.push(...planBetweenStops(lang, fromRes, toRes, from, to, now));
    }
  }

  // Two itineraries wearing the same badges are one journey to a passenger, whether they
  // differ by boarding pole, by direction of the same loop, or by rural branch — the four
  // services numbered 11 all show a "11". Offering the same card twice just burns a slot,
  // so key on what the card shows and keep the quickest.
  const byJourney = new Map<string, RoutePlanResult>();
  for (const plan of all) {
    const key =
      plan.segments
        .filter((seg) => seg.type === 'bus')
        .map((seg) => seg.line?.number)
        .join('>') || 'walk';
    const current = byJourney.get(key);
    if (!current || isBetterPlan(plan, current)) byJourney.set(key, plan);
  }

  return [...byJourney.values()].sort((a, b) => (isBetterPlan(a, b) ? -1 : 1));
}

/**
 * How much sooner a bus has to get you there before walking stops being the answer.
 *
 * This used to be an absolute ceiling: any walk over 45 minutes was pushed below every
 * bus plan. That is wrong whenever the buses are worse. On one cross-town pair at half
 * past one, walking takes 55 minutes and the best bus itinerary takes 95 — and
 * the walk was ranked last, off the end of a four-card list, so the fastest way to get
 * there was the one option the reader never saw.
 *
 * What the old rule was really protecting against is a long walk edging out a bus by a
 * minute or two, which is a win on paper and a loss in the rain. So that is all this
 * says now: the bus takes the near-ties, and a walk that is genuinely quicker gets to
 * lead — whether it wins by six minutes on a 300 m hop or by forty on a crosstown trip.
 */
export const WALK_MUST_BEAT_BUS_BY_MIN = 5;

/**
 * And past this, a walk stays in the list but stops leading it, however bad the bus is.
 *
 * Ranking on duration alone once put a 168-minute walk to a rural terminus above a bus
 * 285 minutes out, because that branch runs twice a day. Both things are true at once: an
 * hour on foot that beats a five-hour wait is the honest answer, and three hours on
 * foot is not an answer at all. Seventy-five minutes is about 5.6 km at the calibrated
 * pace — a long walk somebody might choose, and the far edge of one they might not.
 */
const MAX_HEADLINE_WALK_MIN = 75;

const isWalkOnly = (p: RoutePlanResult) => !p.segments.some((seg) => seg.type === 'bus');

/**
 * A running service first, then whichever arrives sooner — except that an hours-long
 * walk never leads.
 *
 * Ranking on duration alone is arithmetically right and practically wrong on the rural
 * branches: a line that runs twice a day puts the next bus 285 minutes out, so a
 * 168-minute walk won the comparison and became the headline suggestion. No
 * map app answers "walk for two hours and forty-eight minutes". The walk is still
 * offered — somebody may genuinely prefer it — it just stops being the answer.
 */
const busLegCount = (p: RoutePlanResult) => p.segments.filter((s) => s.type === 'bus').length;

/**
 * When this plan puts you there, counted from the moment the question was asked.
 *
 * Not the same as its duration any more. A plan sets off at `now + slackMinutes`, so a
 * short ride that leaves in five hours is short and useless: at 09:00 the fastest ride
 * on the clock for one pair was a 22-minute one that departs at 14:08. Ranking on duration
 * put it first. This is what the reader is actually choosing between.
 */
const reachedAt = (p: RoutePlanResult): number => p.slackMinutes + p.durationMinutes;

function isBetterPlan(a: RoutePlanResult, b: RoutePlanResult): boolean {
  if (a.isServiceActive !== b.isServiceActive) return a.isServiceActive;
  // A walk only leads when it wins clearly; a bus takes the near-ties.
  if (isWalkOnly(a) !== isWalkOnly(b)) {
    const walk = isWalkOnly(a) ? a : b;
    const bus = isWalkOnly(a) ? b : a;
    const walkWins =
      walk.durationMinutes <= MAX_HEADLINE_WALK_MIN &&
      walk.durationMinutes + WALK_MUST_BEAT_BUS_BY_MIN <= reachedAt(bus);
    return isWalkOnly(a) ? walkWins : !walkWins;
  }
  if (reachedAt(a) !== reachedAt(b)) return reachedAt(a) < reachedAt(b);
  // There at the same minute, so the tie goes to the one that costs less of your day:
  // leaving later for the same arrival is strictly better than waiting at the pole.
  if (a.durationMinutes !== b.durationMinutes) return a.durationMinutes < b.durationMinutes;
  // Still level, so the tie goes to the simpler trip. Two ways of making one trip both
  // took 36 minutes: one rode a bus for a single stop to reach the wall, the other
  // walked to the same place. A change you do not need is still a change you can miss.
  return busLegCount(a) < busLegCount(b);
}

interface BoardingCandidate {
  stop: BusStop;
  walkMeters: number;
  walkMinutes: number;
}

/**
 * How far to look for a stop worth walking to.
 *
 * Measured over 40 city trips: the median trip stops improving past 1.2 km, the mean
 * keeps falling to 2 km / 10 candidates (40 -> 37 min) and is flat beyond that, at a
 * cost of 4 ms per plan. So 2 km is where widening stops buying anything.
 *
 * A radius this wide would normally allow silly suggestions — walking 25 minutes to
 * catch a bus — but `boardingCandidates` refuses any approach walk longer than simply
 * walking the whole way, so the absurd cases cannot be produced at any radius.
 */
const MAX_BOARDING_WALK_M = 2000;
const MAX_BOARDING_CANDIDATES = 10;
/** The closest poles are the cheapest to reach, so they are tried whatever they serve. */
const ALWAYS_NEAREST = 4;

/**
 * The stops worth walking to — chosen for the lines they reach, not for being close.
 *
 * Taking the ten nearest looked reasonable and was not. From one origin the ten nearest
 * are all on the same corridor and between them serve eight lines; the twelfth, at
 * 535 m, serves nine more, including every line on the ring road. So the planner could
 * not see a one-bus trip and instead offered to ride a bus for a single stop — one
 * minute on the bus after three waiting — just to reach
 * the stop a seven-minute walk would have reached anyway.
 *
 * The point of walking further is to reach a line you cannot reach nearer, so past the
 * nearest few a stop earns its place only by serving a line none of the closer ones do.
 * The candidate count is unchanged, so this costs nothing: the same ten slots, spent on
 * ten different answers instead of ten versions of one.
 */
function boardingCandidates(
  res: LocationResolution,
  directWalkMinutes: number,
  measured?: (stopId: string) => number | undefined,
): BoardingCandidate[] {
  const reachable = getNearbyStops(res.lat, res.lng)
    // A measured walk replaces the estimate before anything is filtered or ranked on it.
    // Ranking on the estimate and then correcting the clock afterwards is what put a bus
    // on screen that the reader could not reach.
    .map((s) => {
      const real = measured?.(s.id);
      return real === undefined ? s : { ...s, walkMinutes: real };
    })
    .filter(
      (s) =>
        s.lines.length > 0 &&
        s.walkMeters <= MAX_BOARDING_WALK_M &&
        // Never walk further to reach the bus than to reach the destination.
        s.walkMinutes < directWalkMinutes,
    );

  const chosen: typeof reachable = [];
  const served = new Set<string>();
  for (const stop of reachable) {
    if (chosen.length >= MAX_BOARDING_CANDIDATES) break;
    const addsALine = stop.lines.some((id) => !served.has(id));
    if (chosen.length >= ALWAYS_NEAREST && !addsALine) continue;
    chosen.push(stop);
    stop.lines.forEach((id) => served.add(id));
  }

  return chosen.map((s) => ({ stop: s, walkMeters: s.walkMeters, walkMinutes: s.walkMinutes }));
}

/**
 * Just walking the whole way.
 *
 * Lugo is about an hour across on foot, so a 90-minute bus itinerary with two changes
 * is worse than walking and the app should say so rather than hide it. Always offered;
 * it sorts on duration like anything else, so it only leads when it deserves to.
 */
function walkingOnlyPlan(
  lang: Lang,
  fromRes: LocationResolution,
  toRes: LocationResolution,
  now: Date,
): RoutePlanResult {
  const walk = estimateWalk(getDistanceMeters(fromRes.lat, fromRes.lng, toRes.lat, toRes.lng));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const arrival = nowMinutes + walk.minutes;

  return {
    durationMinutes: walk.minutes,
    fare: { busLegs: 0, transfersFree: true, transferSpanMinutes: 0, singleTicketEuros: 0, citizenCardEuros: 0 },
    departureTime: formatMinutes(nowMinutes),
    arrivalTime: formatMinutes(arrival),
    // Nothing to be late for, so there is nothing to set off later for either.
    slackMinutes: 0,
    totalWaitMinutes: 0,
    isServiceActive: true,
    walkToStartMeters: 0,
    walkFromEndMeters: 0,
    segments: [
      {
        type: 'walk',
        durationMinutes: walk.minutes,
        walkMeters: walk.meters,
        departureTime: formatMinutes(nowMinutes),
        arrivalTime: formatMinutes(arrival),
        instruction: translations(lang).engine.walkWholeWay(fromRes.name, toRes.name),
      },
    ],
  };
}

function planBetweenStops(
  lang: Lang,
  fromRes: LocationResolution,
  toRes: LocationResolution,
  from: BoardingCandidate,
  to: BoardingCandidate,
  now: Date,
): RoutePlanResult[] {
  const startStop = from.stop;
  const endStop = to.stop;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const leadIn: RoutePlanResult['segments'] = [];
  let cursor = nowMinutes;

  // 1. Walk to the boarding stop.
  if (from.walkMinutes > 0 && from.walkMeters > 50) {
    const start = cursor;
    cursor += from.walkMinutes;
    leadIn.push({
      type: 'walk',
      durationMinutes: from.walkMinutes,
      walkMeters: from.walkMeters,
      departureTime: formatMinutes(start),
      arrivalTime: formatMinutes(cursor),
      instruction: translations(lang).engine.walkToStop(fromRes.name, startStop.name, startStop.code),
    });
  }

  // 2. Compare a direct ride against every interchange, and take whichever gets there
  //    first. Taking the direct line unconditionally meant a 3-a-day line like 5ES made
  //    the planner propose a four-hour wait when a transfer would arrive in twenty
  //    minutes.
  const directLines = startStop.lines.filter((l) => endStop.lines.includes(l));
  const options = [
    buildLeg(lang, directLines, startStop, endStop, cursor, now),
    ...connectingHubs(startStop, endStop).map(([hubIn, hubOut]) =>
      buildTransfer(lang, startStop, endStop, hubIn, hubOut, cursor, now),
    ),
  ].filter((o): o is Itinerary => o !== null);

  // Every option becomes a full itinerary. The caller picks, or shows them all.
  return options.map((option) => buildResult(option));

  function buildResult(option: Itinerary): RoutePlanResult {
    const segments = [...leadIn, ...option.segments];
    let end = option.arrivalMinutes;

    /**
     * Standing at the pole is not part of the trip.
     *
     * Every plan used to start at `now` whatever the timetable said, so asking at 09:00
     * for a bus at 09:28 gave a seven-minute walk followed by twenty-one minutes of
     * standing, and called the result a fifty-minute journey. Worse, it made the options
     * indistinguishable: five itineraries "took" fifty minutes and arrived at 09:50,
     * because they were five ways of catching the same 4.2 and the only difference
     * between them was how the wait was spent. The reader was offered a choice that was
     * not one.
     *
     * So the departure slides forward until only the margin is left. Nothing about the
     * bus moves -- same boarding time, same arrival -- but the answer becomes "leave at
     * 09:19" instead of "leave now and wait".
     *
     * This reverses a deliberate decision, and the reason it reverses is that the
     * decision was answering a different question: the old note here argued for leaving
     * now because a plan must not print two departure times, which is true and still is.
     * There is still exactly one. What it did not weigh is that the padding was being
     * counted as journey time, and that is what made four cards look alike.
     *
     * The margin is the one the transfers already use, for the same reason: this network
     * publishes no vehicle positions and its buses have been seen running early, so a
     * couple of minutes in hand is the difference between catching one and losing a whole
     * headway.
     */
    const firstBusAt = segments.findIndex((seg) => seg.type === 'bus');
    const waitAt = firstBusAt - 1;
    let slack = 0;
    if (firstBusAt > 0 && segments[waitAt].type === 'wait') {
      const margin =
        segments[firstBusAt].precision === 'published'
          ? TRANSFER_BUFFER_MIN
          : TRANSFER_BUFFER_ESTIMATED_MIN;
      slack = Math.max(0, segments[waitAt].durationMinutes - margin);
    }
    if (slack > 0) {
      const later = (t: string | undefined) => (t ? formatMinutes(parseTimeToMinutes(t) + slack) : t);
      // These segment objects are shared with every other option built from the same
      // lead-in, so they are replaced rather than edited.
      for (let i = 0; i < firstBusAt; i++) {
        const seg = segments[i];
        const isWait = seg.type === 'wait';
        segments[i] = {
          ...seg,
          durationMinutes: isWait ? seg.durationMinutes - slack : seg.durationMinutes,
          departureTime: later(seg.departureTime),
          // The wait still ends when the bus arrives; it just starts later.
          arrivalTime: isWait ? seg.arrivalTime : later(seg.arrivalTime),
        };
      }
      if (segments[waitAt].durationMinutes <= 0) segments.splice(waitAt, 1);
    }

    // 3. Walk from the alighting stop to the destination.
    if (to.walkMinutes > 0 && to.walkMeters > 50) {
      const start = end;
      end += to.walkMinutes;
      segments.push({
        type: 'walk',
        durationMinutes: to.walkMinutes,
        walkMeters: to.walkMeters,
        departureTime: formatMinutes(start),
        arrivalTime: formatMinutes(end),
        instruction: translations(lang).engine.walkToDestination(toRes.name),
      });
    }

    // One departure time, and it is the one the itinerary starts with. There used to be
    // a second `leaveAt` beside a summary that said to leave now, which is the bug that
    // must not come back: whatever `slack` does above, these two agree.
    return {
      durationMinutes: Math.round(end - nowMinutes - slack),
      fare: fareFor(segments),
      departureTime: formatMinutes(nowMinutes + slack),
      arrivalTime: formatMinutes(end),
      slackMinutes: slack,
      totalWaitMinutes: option.totalWaitMinutes - slack,
      isServiceActive: option.isServiceActive,
      serviceNotice: option.serviceNotice,
      walkToStartMeters: from.walkMeters,
      walkFromEndMeters: to.walkMeters,
      segments,
    };
  }
}

// Plan route between two stops (backwards compatibility)
export function planRouteBetweenStops(fromStopId: string, toStopId: string): RoutePlanResult | null {
  return planSmartTrip(fromStopId, toStopId);
}

