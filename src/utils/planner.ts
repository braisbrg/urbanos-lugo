/**
 * The trip planner: direct rides, one transfer, walking, and the ranking between them.
 * Pure functions over the shipped dataset, no React and no DOM.
 */
import { BUS_STOPS, FARES, lineById } from '../data/transitData';
import { directionLabel } from './serviceLabels';
import { Lang, translations } from '../i18n';
import { BusDirection, BusStop, BusLine, Precision, RoutePlanResult, TripFare, TripSegment } from '../types';
import { getDistanceMeters } from './geo';
import { formatMinutes, parseTimeToMinutes } from './schedule';
import { LocationResolution, estimateWalk, getNearbyStops, resolveLocationQuery } from './places';
import { LineDeparture, getNextLineDeparture } from './arrivals';

/** How long to allow for changing bus: two minutes on a printed connecting time, four on an interpolated one. */
const TRANSFER_BUFFER_MIN = 2;
export const TRANSFER_BUFFER_ESTIMATED_MIN = 4;
const bufferFor = (precision: Precision | undefined) => (precision === 'published' ? TRANSFER_BUFFER_MIN : TRANSFER_BUFFER_ESTIMATED_MIN);

/** How far somebody will walk between one bus and the next: about four minutes, two streets. */
const MAX_TRANSFER_WALK_M = 300;
/** Each candidate costs two timetable lookups; these caps keep a plan under 100 ms. */
const MAX_SAME_POLE_HUBS = 40;
const MAX_WALKING_HUBS = 20;

/** Above this a wait is worded as a departure time, not a countdown. Presentation only. */
export const LONG_WAIT_MIN = 90;

/**
 * Above this a wait stops being a connection and the transfer is not offered. Three hours,
 * because the largest published headway is 60 min; the cluster of "waits" past twelve
 * hours is the next morning rendered as the same hour. Refusing costs nothing: the direct
 * rides and the walk are always offered.
 */
const MAX_TRANSFER_WAIT_MIN = 180;

/**
 * A walk only leads when it wins clearly; a bus takes the near-ties — a walk that beats a
 * bus by a minute is a win on paper and a loss in the rain.
 */
export const WALK_MUST_BEAT_BUS_BY_MIN = 5;
/** Past this a walk stays in the list but never leads it, however bad the bus is (~5.6 km). */
const MAX_HEADLINE_WALK_MIN = 75;

/**
 * How far to look for a stop worth walking to. Measured over 40 trips: widening past 2 km
 * buys nothing. `boardingCandidates` refuses any approach walk longer than walking the
 * whole way, so a wide radius cannot produce silly suggestions.
 */
const MAX_BOARDING_WALK_M = 2000;
const MAX_BOARDING_CANDIDATES = 10;
/** The closest poles are the cheapest to reach, so they are tried whatever they serve. */
const ALWAYS_NEAREST = 4;

/** How far back to look for a departure that still arrives in time. */
const ARRIVE_BY_LOOKBACK_MIN = 180;
const ARRIVE_BY_STEP_MIN = 5;

/**
 * A one-stop ride is never offered: measured over 2,254 legs it costs what the walk costs
 * (1.2 min riding after 5.3 waiting, against a 5-minute walk) and is not yours to control.
 */
const isNotWorthBoarding = (stopsCount: number) => stopsCount <= 1;

/** Real in-vehicle time and distance between two stops of one direction, from the measured road legs. */
function rideBetween(direction: BusDirection, fromIndex: number, toIndex: number): { minutes: number; meters: number; stopsCount: number } {
  let seconds = 0;
  let meters = 0;
  for (let i = fromIndex; i < toIndex; i++) {
    seconds += (direction.legSeconds?.[i] ?? 90) + 20; // + dwell
    meters += direction.legMeters?.[i] ?? 400;
  }
  return { minutes: Math.max(1, Math.round(seconds / 60)), meters: Math.round(meters), stopsCount: Math.max(1, toIndex - fromIndex) };
}

interface Boarding {
  line: BusLine;
  direction: BusDirection;
  departure: LineDeparture;
}

/**
 * Of every line serving both stops in the right order, the one that gets you there
 * soonest — a running line first. Taking `lines[0]` once picked one that had stopped.
 */
function pickBestBoarding(lang: Lang, candidateLineIds: string[], fromStopId: string, toStopId: string, readyAt: number, now: Date): Boarding | null {
  let best: (Boarding & { arrival: number }) | null = null;
  for (const lineId of candidateLineIds) {
    const line = lineById(lineId);
    if (!line) continue;
    for (const direction of line.directions) {
      const from = direction.stops.indexOf(fromStopId);
      const to = direction.stops.indexOf(toStopId);
      if (from === -1 || to === -1 || to <= from) continue;
      const departure = getNextLineDeparture(lang, line, direction.id, fromStopId, readyAt, now, toStopId);
      const arrival = departure.arrivalMinutes ?? departure.departureMinutes + rideBetween(direction, from, to).minutes;
      const better =
        !best ||
        (departure.isServiceActive && !best.departure.isServiceActive) ||
        (departure.isServiceActive === best.departure.isServiceActive && arrival < best.arrival);
      if (better) best = { line, direction, departure, arrival };
    }
  }
  return best;
}

/** A single ticket pays per boarding; the Tarxeta Cidadá pays once while every transfer is inside the window. */
function fareFor(segments: TripSegment[]): TripFare {
  const boardings = segments.filter((s) => s.type === 'bus' && s.departureTime).map((s) => parseTimeToMinutes(s.departureTime!));
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
  arrivalMinutes: number;
  arrivalPrecision: Precision;
  segments: TripSegment[];
  totalWaitMinutes: number;
  isServiceActive: boolean;
  serviceNotice?: string;
}

const walkSegment = (start: number, walk: { meters: number; minutes: number }, instruction: string): TripSegment => ({
  type: 'walk',
  durationMinutes: walk.minutes,
  walkMeters: walk.meters,
  departureTime: formatMinutes(start),
  arrivalTime: formatMinutes(start + walk.minutes),
  instruction,
});

/**
 * Ride one line from `fromStop` to `toStop`, boarding no earlier than `readyAt`.
 *
 * `waitingFrom` is when the standing about begins when that is earlier than `readyAt`: at
 * a transfer `readyAt` carries the safety buffer, which decides which departure can be
 * caught but is still time spent at the pole, so the wait segment starts from it.
 */
function buildLeg(lang: Lang, candidateLineIds: string[], fromStop: BusStop, toStop: BusStop, readyAt: number, now: Date, hubLabel?: string, waitingFrom?: number): Itinerary | null {
  const option = pickBestBoarding(lang, candidateLineIds, fromStop.id, toStop.id, readyAt, now);
  if (!option) return null;
  const { line, direction, departure } = option;
  const ride = rideBetween(direction, direction.stops.indexOf(fromStop.id), direction.stops.indexOf(toStop.id));
  if (isNotWorthBoarding(ride.stopsCount)) return null;

  const t = translations(lang).engine;
  const segments: TripSegment[] = [];
  const waitStart = Math.min(readyAt, waitingFrom ?? readyAt);
  const waitMinutes = Math.max(0, departure.departureMinutes - waitStart);
  if (waitMinutes > 0) {
    segments.push({
      type: 'wait',
      fromStop,
      durationMinutes: waitMinutes,
      departureTime: formatMinutes(waitStart),
      arrivalTime: formatMinutes(departure.departureMinutes),
      instruction: hubLabel ? t.transferAt(fromStop.name, line.number) : t.waitAt(fromStop.name, line.number, direction.destination),
    });
  }

  const boardTime = departure.departureMinutes;
  const arriveTime = departure.arrivalMinutes ?? boardTime + ride.minutes;
  const arrivalPrecision = departure.arrivalPrecision ?? 'estimated';
  segments.push({
    type: 'bus',
    line,
    directionId: direction.id,
    precision: departure.precision,
    arrivalPrecision,
    fromStop,
    toStop,
    // Read off the printed ends, so the duration and the two times beside it agree; where
    // the timetable puts two stops in the same minute the leg is allowed to say 0.
    durationMinutes: Math.round(arriveTime) - Math.round(boardTime),
    stopsCount: ride.stopsCount,
    departureTime: formatMinutes(boardTime),
    arrivalTime: formatMinutes(arriveTime),
    instruction: t.board(line.number, directionLabel(direction, lang), formatMinutes(boardTime), toStop.name, ride.stopsCount, (ride.meters / 1000).toFixed(1), formatMinutes(arriveTime)),
  });

  return { arrivalMinutes: arriveTime, arrivalPrecision, segments, totalWaitMinutes: waitMinutes, isServiceActive: departure.isServiceActive, serviceNotice: departure.serviceNotice };
}

/** Every stop reachable from `stopId` without changing bus (`forward`), or every stop that reaches it. */
function reachable(stopId: string, lines: string[], forward: boolean): Set<string> {
  const out = new Set<string>();
  for (const lineId of lines) {
    for (const direction of lineById(lineId)?.directions ?? []) {
      const at = direction.stops.indexOf(stopId);
      if (at === -1) continue;
      const [from, to] = forward ? [at + 1, direction.stops.length] : [0, at];
      for (let i = from; i < to; i++) out.add(direction.stops[i]);
    }
  }
  return out;
}

/** Chain two legs through one interchange, allowing time to change platform. */
function buildTransfer(lang: Lang, startStop: BusStop, endStop: BusStop, hubIn: BusStop, hubOut: BusStop, readyAt: number, now: Date): Itinerary | null {
  if (hubIn.id === startStop.id || hubOut.id === endStop.id) return null;
  const leg1Lines = startStop.lines.filter((l) => hubIn.lines.includes(l));
  const leg2Lines = endStop.lines.filter((l) => hubOut.lines.includes(l));
  if (!leg1Lines.length || !leg2Lines.length) return null;

  const first = buildLeg(lang, leg1Lines, startStop, hubIn, readyAt, now);
  if (!first) return null;

  // Getting off at one pole and on at another a couple of streets away is how half the
  // network connects; requiring one shared pole walked people 700 m to a different line.
  const change: TripSegment[] = [];
  let freeAt = first.arrivalMinutes;
  if (hubIn.id !== hubOut.id) {
    const walk = estimateWalk(getDistanceMeters(hubIn.lat, hubIn.lng, hubOut.lat, hubOut.lng));
    change.push(walkSegment(first.arrivalMinutes, walk, translations(lang).engine.walkToStop(hubIn.name, hubOut.name, hubOut.code)));
    freeAt += walk.minutes;
  }

  const second = buildLeg(lang, leg2Lines, hubOut, endStop, freeAt + bufferFor(first.arrivalPrecision), now, hubOut.name, freeAt);
  if (!second) return null;

  // A connection you would have to sleep through is not a connection: past the last bus
  // "the next departure" is tomorrow morning, rendered as the same hour.
  const changeWait = second.segments.find((s) => s.type === 'wait')?.durationMinutes ?? 0;
  if (changeWait > MAX_TRANSFER_WAIT_MIN) return null;

  // Getting off a bus to wait for the same line is never the answer ("5.1 -> 5.1").
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

/** Interchanges that genuinely connect these two stops: reachable onward from the origin AND able to reach the destination. */
function connectingHubs(startStop: BusStop, endStop: BusStop): [BusStop, BusStop][] {
  const forward = reachable(startStop.id, startStop.lines, true);
  const backward = reachable(endStop.id, endStop.lines, false);
  const arrivals = BUS_STOPS.filter((s) => forward.has(s.id) && s.id !== endStop.id);
  const departures = BUS_STOPS.filter((s) => backward.has(s.id) && s.id !== startStop.id);

  // The same pole first: no walk, no risk, and it is most of the network.
  const same = arrivals
    .filter((s) => backward.has(s.id))
    .sort((a, b) => b.lines.length - a.lines.length)
    .slice(0, MAX_SAME_POLE_HUBS)
    .map((s): [BusStop, BusStop] => [s, s]);

  // Then pairs a short walk apart.
  const pairs: { pair: [BusStop, BusStop]; walk: number }[] = [];
  for (const a of arrivals) {
    if (backward.has(a.id)) continue;
    for (const b of departures) {
      if (a.id === b.id) continue;
      const metres = getDistanceMeters(a.lat, a.lng, b.lat, b.lng);
      if (metres <= MAX_TRANSFER_WALK_M) pairs.push({ pair: [a, b], walk: metres });
    }
  }
  pairs.sort((x, y) => x.walk - y.walk);
  return [...same, ...pairs.slice(0, MAX_WALKING_HUBS).map((p) => p.pair)];
}

export interface PlanOptions {
  /** Which language the itinerary sentences come back in. */
  lang?: Lang;
  userLocation?: [number, number];
  now?: Date;
  /** Leave at this time instead of now, in minutes from midnight. */
  departAt?: number;
  /** Be there by this time: the LATEST departure that still makes it. */
  arriveBy?: number;
  /**
   * The walk to a stop as the pedestrian router measured it, minutes from the origin, or
   * undefined for a stop nobody has measured. Every other walk is the straight line times
   * 1.35, which is good enough to build a plan from and bad to promise a bus on.
   */
  measuredWalkToStop?: (stopId: string) => number | undefined;
}

/** Every distinct way of making the trip, quickest first. */
export function planTrips(fromQuery: string, toQuery: string, options: PlanOptions = {}): RoutePlanResult[] {
  const { userLocation, now = new Date(), lang = 'gl', measuredWalkToStop } = options;
  if (options.arriveBy !== undefined) return planArrivingBy(fromQuery, toQuery, options.arriveBy, options);
  const at = new Date(now);
  if (options.departAt !== undefined) at.setHours(Math.floor(options.departAt / 60), Math.round(options.departAt % 60), 0, 0);
  return planDeparting(lang, fromQuery, toQuery, userLocation, at, measuredWalkToStop);
}

const journeyKey = (plan: RoutePlanResult, by: (seg: TripSegment) => string | undefined) =>
  plan.segments.filter((seg) => seg.type === 'bus').map(by).join('>');

/** Walk departure times backwards from the deadline; each probe is a normal forward plan. */
function planArrivingBy(fromQuery: string, toQuery: string, arriveBy: number, options: PlanOptions): RoutePlanResult[] {
  const now = options.now ?? new Date();
  const earliest = Math.max(now.getHours() * 60 + now.getMinutes(), arriveBy - ARRIVE_BY_LOOKBACK_MIN);
  // The latest departure per journey that still arrives in time.
  const byJourney = new Map<string, RoutePlanResult>();
  for (let depart = earliest; depart <= arriveBy; depart += ARRIVE_BY_STEP_MIN) {
    const at = new Date(now);
    at.setHours(Math.floor(depart / 60), depart % 60, 0, 0);
    for (const plan of planDeparting(options.lang ?? 'gl', fromQuery, toQuery, options.userLocation, at, options.measuredWalkToStop)) {
      if (!plan.isServiceActive || parseTimeToMinutes(plan.arrivalTime) > arriveBy) continue;
      byJourney.set(journeyKey(plan, (seg) => `${seg.line?.id}/${seg.directionId}`), plan);
    }
  }
  return [...byJourney.values()].sort((a, b) => parseTimeToMinutes(b.departureTime) - parseTimeToMinutes(a.departureTime));
}

function planDeparting(lang: Lang, fromQuery: string, toQuery: string, userLocation: [number, number] | undefined, now: Date, measuredWalkToStop?: PlanOptions['measuredWalkToStop']): RoutePlanResult[] {
  const fromRes = resolveLocationQuery(fromQuery, userLocation, lang);
  const toRes = resolveLocationQuery(toQuery, userLocation, lang);
  // One of the two places is not in the dataset: no itinerary beats one from somewhere else.
  if (!fromRes || !toRes) return [];

  const onFoot = walkingOnlyPlan(lang, fromRes, toRes, now);
  const starts = boardingCandidates(fromRes, onFoot.durationMinutes, measuredWalkToStop);
  const ends = boardingCandidates(toRes, onFoot.durationMinutes);

  const all: RoutePlanResult[] = [onFoot];
  for (const from of starts) for (const to of ends) if (from.stop.id !== to.stop.id) all.push(...planBetweenStops(lang, fromRes, toRes, from, to, now));

  // Two itineraries wearing the same badges are one journey to a passenger: keep the quickest.
  const byJourney = new Map<string, RoutePlanResult>();
  for (const plan of all) {
    const key = journeyKey(plan, (seg) => seg.line?.number) || 'walk';
    const current = byJourney.get(key);
    if (!current || isBetterPlan(plan, current)) byJourney.set(key, plan);
  }
  return [...byJourney.values()].sort((a, b) => (isBetterPlan(a, b) ? -1 : 1));
}

const isWalkOnly = (p: RoutePlanResult) => !p.segments.some((seg) => seg.type === 'bus');
const busLegCount = (p: RoutePlanResult) => p.segments.filter((s) => s.type === 'bus').length;
/** When this plan puts you there, counted from the moment the question was asked. */
const reachedAt = (p: RoutePlanResult): number => p.slackMinutes + p.durationMinutes;

/** A running service first, then whichever arrives sooner — except that a long walk never leads. */
function isBetterPlan(a: RoutePlanResult, b: RoutePlanResult): boolean {
  if (a.isServiceActive !== b.isServiceActive) return a.isServiceActive;
  if (isWalkOnly(a) !== isWalkOnly(b)) {
    const walk = isWalkOnly(a) ? a : b;
    const bus = isWalkOnly(a) ? b : a;
    const walkWins = walk.durationMinutes <= MAX_HEADLINE_WALK_MIN && walk.durationMinutes + WALK_MUST_BEAT_BUS_BY_MIN <= reachedAt(bus);
    return isWalkOnly(a) ? walkWins : !walkWins;
  }
  if (reachedAt(a) !== reachedAt(b)) return reachedAt(a) < reachedAt(b);
  // Same arrival: leaving later is strictly better than waiting at the pole.
  if (a.durationMinutes !== b.durationMinutes) return a.durationMinutes < b.durationMinutes;
  // Still level: the simpler trip. A change you do not need is still a change you can miss.
  return busLegCount(a) < busLegCount(b);
}

interface BoardingCandidate {
  stop: BusStop;
  walkMeters: number;
  walkMinutes: number;
}

/**
 * The stops worth walking to, chosen for the lines they reach rather than for being
 * close: past the nearest few a stop earns its place only by serving a line none of the
 * closer ones do. The ten nearest from one origin were all on one corridor.
 */
function boardingCandidates(res: LocationResolution, directWalkMinutes: number, measured?: PlanOptions['measuredWalkToStop']): BoardingCandidate[] {
  const reachable = getNearbyStops(res.lat, res.lng)
    // A measured walk replaces the estimate before anything is filtered or ranked on it.
    .map((s) => {
      const real = measured?.(s.id);
      return real === undefined ? s : { ...s, walkMinutes: real };
    })
    // Never walk further to reach the bus than to reach the destination.
    .filter((s) => s.lines.length > 0 && s.walkMeters <= MAX_BOARDING_WALK_M && s.walkMinutes < directWalkMinutes);

  const chosen: typeof reachable = [];
  const served = new Set<string>();
  for (const stop of reachable) {
    if (chosen.length >= MAX_BOARDING_CANDIDATES) break;
    if (chosen.length >= ALWAYS_NEAREST && !stop.lines.some((id) => !served.has(id))) continue;
    chosen.push(stop);
    stop.lines.forEach((id) => served.add(id));
  }
  return chosen.map((s) => ({ stop: s, walkMeters: s.walkMeters, walkMinutes: s.walkMinutes }));
}

/** Just walking the whole way. Always offered; it only leads when it deserves to. */
function walkingOnlyPlan(lang: Lang, fromRes: LocationResolution, toRes: LocationResolution, now: Date): RoutePlanResult {
  const walk = estimateWalk(getDistanceMeters(fromRes.lat, fromRes.lng, toRes.lat, toRes.lng));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return {
    durationMinutes: walk.minutes,
    fare: { busLegs: 0, transfersFree: true, transferSpanMinutes: 0, singleTicketEuros: 0, citizenCardEuros: 0 },
    departureTime: formatMinutes(nowMinutes),
    arrivalTime: formatMinutes(nowMinutes + walk.minutes),
    slackMinutes: 0,
    totalWaitMinutes: 0,
    isServiceActive: true,
    walkToStartMeters: 0,
    walkFromEndMeters: 0,
    segments: [walkSegment(nowMinutes, walk, translations(lang).engine.walkWholeWay(fromRes.name, toRes.name))],
  };
}

function planBetweenStops(lang: Lang, fromRes: LocationResolution, toRes: LocationResolution, from: BoardingCandidate, to: BoardingCandidate, now: Date): RoutePlanResult[] {
  const startStop = from.stop;
  const endStop = to.stop;
  const t = translations(lang).engine;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // 1. Walk to the boarding stop.
  const leadIn: TripSegment[] = [];
  let cursor = nowMinutes;
  if (from.walkMinutes > 0 && from.walkMeters > 50) {
    leadIn.push(walkSegment(cursor, { meters: from.walkMeters, minutes: from.walkMinutes }, t.walkToStop(fromRes.name, startStop.name, startStop.code)));
    cursor += from.walkMinutes;
  }

  // 2. A direct ride against every interchange; whichever gets there first. Taking the
  //    direct line unconditionally once proposed a four-hour wait on a 3-a-day line.
  const directLines = startStop.lines.filter((l) => endStop.lines.includes(l));
  const options = [
    buildLeg(lang, directLines, startStop, endStop, cursor, now),
    ...connectingHubs(startStop, endStop).map(([hubIn, hubOut]) => buildTransfer(lang, startStop, endStop, hubIn, hubOut, cursor, now)),
  ].filter((o): o is Itinerary => o !== null);

  return options.map((option) => {
    const segments = [...leadIn, ...option.segments];
    let end = option.arrivalMinutes;

    // Standing at the pole is not part of the trip: the departure slides forward until
    // only the margin is left, so the answer is "leave at 09:19", not "leave now and wait".
    // Nothing about the bus moves, and the plan still prints exactly one departure time.
    const firstBusAt = segments.findIndex((seg) => seg.type === 'bus');
    const waitAt = firstBusAt - 1;
    let slack = 0;
    if (firstBusAt > 0 && segments[waitAt].type === 'wait') {
      slack = Math.max(0, segments[waitAt].durationMinutes - bufferFor(segments[firstBusAt].precision));
    }
    if (slack > 0) {
      const later = (time: string | undefined) => (time ? formatMinutes(parseTimeToMinutes(time) + slack) : time);
      // Shared with every option built from the same lead-in, so replaced rather than edited.
      for (let i = 0; i < firstBusAt; i++) {
        const seg = segments[i];
        const isWait = seg.type === 'wait';
        segments[i] = {
          ...seg,
          durationMinutes: isWait ? seg.durationMinutes - slack : seg.durationMinutes,
          departureTime: later(seg.departureTime),
          arrivalTime: isWait ? seg.arrivalTime : later(seg.arrivalTime),
        };
      }
      if (segments[waitAt].durationMinutes <= 0) segments.splice(waitAt, 1);
    }

    // 3. Walk from the alighting stop to the destination.
    if (to.walkMinutes > 0 && to.walkMeters > 50) {
      segments.push(walkSegment(end, { meters: to.walkMeters, minutes: to.walkMinutes }, t.walkToDestination(toRes.name)));
      end += to.walkMinutes;
    }

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
  });
}
