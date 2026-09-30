/**
 * What a departure board shows: the next passes at a stop and the next departure of a
 * line, read from the published timetable and never measured. Pure functions, no React.
 */
import { BUS_STOPS, BUS_LINES, lineById, stopName } from '../data/transitData';
import { dayWord, daysLabel } from './serviceLabels';
import { Lang, translations } from '../i18n';
import { BusStop, BusLine, DayKind, Precision, StopArrival } from '../types';
import { MINUTES_PER_DAY, anchorIndex, buildRuns, dayKind, formatMinutes, isHoliday, lineRunsOn, minutesNow, parseTimeToMinutes, type ScheduledRun } from './schedule';
import { findStop } from './places';

/** Expected crowding from the time of day alone: a prior, labelled as such wherever shown. */
export function occupancyAt(minutes: number): 'low' | 'medium' | 'high' {
  const peak = (minutes >= 450 && minutes <= 570) || (minutes >= 780 && minutes <= 900) || (minutes >= 1080 && minutes <= 1200);
  return peak ? 'high' : minutes < 450 || minutes > 1260 ? 'low' : 'medium';
}

/** Past this the answer people want is "first bus at 07:15", not "next bus in 195 min". */
const ARRIVALS_HORIZON_MINUTES = 120;

/**
 * How long a departure stays on the board after its printed time. Measured against the
 * operator's own tracker over 389 comparisons: five minutes covers 84% of late buses. At
 * one minute the board jumped from "Chegando" to "88 min" while the bus was three minutes away.
 */
const OVERDUE_GRACE_MINUTES = 5;

let timingPointCounts: { published: number; total: number } | null = null;

/** How many stops the operator prints a time for, counted from the dataset rather than written into prose. */
export function timingPointStopCount(): { published: number; total: number } {
  if (timingPointCounts) return timingPointCounts;
  const published = new Set<string>();
  for (const line of BUS_LINES) {
    for (const direction of line.directions) {
      const names = direction.stops.map(stopName);
      for (const service of line.services) {
        for (const row of service.rows ?? []) {
          const index = anchorIndex(row.timingPoint, names);
          if (index >= 0) published.add(direction.stops[index]);
        }
      }
    }
  }
  timingPointCounts = { published: published.size, total: BUS_STOPS.length };
  return timingPointCounts;
}

/** Next arrivals at a stop; an empty board outside the service window rather than invented buses. */
export function getArrivalsForStop(stopIdOrCode: string, now: Date = new Date()): { stop: BusStop | undefined; arrivals: StopArrival[] } {
  const stop = findStop(stopIdOrCode);
  if (!stop) return { stop: undefined, arrivals: [] };

  const nowMinutes = minutesNow(now);
  const today = dayKind(now);
  const arrivals: StopArrival[] = [];

  for (const lineId of stop.lines) {
    const line = lineById(lineId);
    if (!line || !lineRunsOn(line, today)) continue;

    line.directions.forEach((direction, dirIndex) => {
      const stopIndex = direction.stops.indexOf(stop.id);
      // The last stop is where the run ends: listing those offers a ride nobody can take.
      if (stopIndex === -1 || stopIndex === direction.stops.length - 1) return;

      buildRuns(line, dirIndex, BUS_STOPS, today)
        .map((run) => ({
          minutes: run.minutesByStopIndex[stopIndex],
          // Per run: a headway-generated run passing a timing point has no published time of its own.
          published: run.publishedStopIndices.includes(stopIndex),
        }))
        .filter((r) => r.minutes !== undefined)
        // A run listed as 23:50 is still "next" at 00:05, so compare on the same day arc.
        .map((r) => ({ ...r, minutes: r.minutes < nowMinutes - OVERDUE_GRACE_MINUTES ? r.minutes + MINUTES_PER_DAY : r.minutes }))
        .filter((r) => r.minutes >= nowMinutes - OVERDUE_GRACE_MINUTES && r.minutes <= nowMinutes + ARRIVALS_HORIZON_MINUTES)
        .sort((a, b) => a.minutes - b.minutes)
        // Three, so the by-line view can derive a headway instead of asserting a frequency.
        .slice(0, 3)
        .forEach(({ minutes, published }) => {
          // Late is counted from the minute the board prints: rounded separately, a run at
          // 08:16.5 printed as 08:17 was marked overdue at 08:17:00, before its own row's time.
          const late = Math.floor(nowMinutes) - Math.round(minutes);
          arrivals.push({
            lineId: line.id,
            lineNumber: line.number,
            lineName: line.name,
            lineColor: line.color,
            destination: direction.destination,
            etaMinutes: Math.max(0, Math.round(minutes - nowMinutes)),
            etaTime: formatMinutes(minutes),
            precision: published ? 'published' : 'estimated',
            overdueMinutes: late > 0 ? late : undefined,
          });
        });
    });
  }

  // Overdue departures all sit at zero, so the one due a minute ago goes before the one due five ago.
  arrivals.sort((a, b) => a.etaMinutes - b.etaMinutes || (a.overdueMinutes ?? 0) - (b.overdueMinutes ?? 0));
  return { stop, arrivals };
}

/**
 * Whether any bus is on the road, and when the next one sets off: what the night banner says.
 *
 * It asked each line whether the clock sat between its first and last departure from the
 * terminus, and printed the earliest `firstDeparture` of any line on any day. So it said "no
 * service" for the 25 minutes the last buses are still on the road after that -- 34 on a
 * weekday, the boards meanwhile showing them -- and "first bus at 07:00" on weekend mornings,
 * which begin at 07:10. Read from the same runs the boards read, on the day each belongs to.
 */
export function networkAtRest(now: Date = new Date()): { atRest: boolean; firstBus: string; daysAhead: number } {
  const nowMinutes = minutesNow(now);
  const runsOn = (days: number): ScheduledRun[] => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    const kind = dayKind(date);
    return BUS_LINES.filter((line) => lineRunsOn(line, kind)).flatMap((line) => line.directions.flatMap((_, d) => buildRuns(line, d, BUS_STOPS, kind)));
  };
  const today = runsOn(0);
  // Yesterday's too, shifted back a day: a night run is still on the road after midnight.
  const onRoad = (runs: ScheduledRun[], shift: number) =>
    runs.some((r) => r.minutesByStopIndex[0] + shift <= nowMinutes && nowMinutes <= r.minutesByStopIndex[r.minutesByStopIndex.length - 1] + shift);
  const atRest = !onRoad(today, 0) && !onRoad(runsOn(-1), -MINUTES_PER_DAY);

  const earliest = (runs: ScheduledRun[]) => runs.reduce<ScheduledRun | undefined>((best, r) => (!best || r.minutesByStopIndex[0] < best.minutesByStopIndex[0] ? r : best), undefined);
  let first = earliest(today.filter((r) => r.minutesByStopIndex[0] > nowMinutes));
  let daysAhead = 0;
  for (let ahead = 1; !first && ahead <= 7; ahead++) {
    first = earliest(runsOn(ahead));
    daysAhead = ahead;
  }
  if (!first) return { atRest, firstBus: '', daysAhead: 0 };
  // The first stop of the first run is not always a timing point; then its time is ours, and says so.
  const time = formatMinutes(first.minutesByStopIndex[0]);
  return { atRest, firstBus: first.publishedStopIndices.includes(0) ? time : `~${time}`, daysAhead };
}

export interface NextService {
  lineId: string;
  lineNumber: string;
  destination: string;
  time: string;
  minutesAway: number;
  /** 0 today, 1 tomorrow, and so on: said beside the time whenever it is not today. */
  daysAhead: number;
  /** Whether that run prints this stop: the sentence carries the tilde like every other time. */
  precision: Precision;
}

/**
 * When this stop next has a bus, past the horizon and past today: what somebody standing
 * at an empty board at 03:00 needs, so a Sunday night gets Monday's first bus.
 */
export function nextServiceAtStop(stopIdOrCode: string, now: Date = new Date()): NextService | null {
  const stop = findStop(stopIdOrCode);
  if (!stop) return null;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let best: NextService | null = null;

  for (let dayAhead = 0; dayAhead < 7 && !best; dayAhead++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayAhead);
    const kind = dayKind(day);
    const offset = dayAhead * MINUTES_PER_DAY;

    for (const lineId of stop.lines) {
      const line = lineById(lineId);
      if (!line || !lineRunsOn(line, kind)) continue;
      line.directions.forEach((direction, dirIndex) => {
        const stopIndex = direction.stops.indexOf(stop.id);
        // The board leaves out the bus that ends its run here, and so does this: at 03:00 the
        // HULA pole offered "5ES at 07:30 to HULA" -- a bus nobody can board there.
        if (stopIndex === -1 || stopIndex === direction.stops.length - 1) return;
        for (const run of buildRuns(line, dirIndex, BUS_STOPS, kind)) {
          const minutes = run.minutesByStopIndex[stopIndex];
          if (minutes === undefined) continue;
          const away = minutes + offset - nowMinutes;
          if (away > 0 && (!best || away < best.minutesAway)) {
            best = {
              lineId: line.id,
              lineNumber: line.number,
              destination: direction.destination,
              time: formatMinutes(minutes % MINUTES_PER_DAY),
              minutesAway: Math.round(away),
              daysAhead: Math.floor((minutes + offset) / MINUTES_PER_DAY),
              precision: run.publishedStopIndices.includes(stopIndex) ? 'published' : 'estimated',
            };
          }
        }
      });
    }
  }
  return best;
}

export interface LineDeparture {
  departureMinutes: number;
  waitMinutes: number;
  isServiceActive: boolean;
  serviceNotice?: string;
  precision: Precision;
  /** When that same run reaches `toStopId`, and whether the operator prints it. */
  arrivalMinutes?: number;
  arrivalPrecision?: Precision;
  /** Which day the departure is on, counted from `now`'s date: 0 today, 1 tomorrow. */
  daysAhead: number;
}

const runsByStop = new Map<string, ScheduledRun[]>();

/**
 * The runs of one direction that pass one of its stops on one kind of day, earliest there
 * first. The timetable does not change under a session, so this is sorted once: the
 * planner asks it thousands of times a plan, and filtering and sorting on every question
 * was a tenth of a plan's time. Read-only for callers.
 */
function runsPassing(line: BusLine, dirIndex: number, kind: DayKind, stopIndex: number): ScheduledRun[] {
  const key = `${line.id}|${dirIndex}|${kind}|${stopIndex}`;
  let runs = runsByStop.get(key);
  if (!runs) {
    runs = buildRuns(line, dirIndex, BUS_STOPS, kind)
      .filter((r) => r.minutesByStopIndex[stopIndex] !== undefined)
      .sort((a, b) => a.minutesByStopIndex[stopIndex] - b.minutesByStopIndex[stopIndex]);
    runsByStop.set(key, runs);
  }
  return runs;
}

interface NextRun {
  run: ScheduledRun | undefined;
  /** Days after `now` the run is on. */
  day: number;
  /** The last run past the stop on the day asked, for "the last one was at ...". */
  lastAsked: number | undefined;
}

/*
 * Which run a question lands on, remembered while `now` stays the same instant. A plan asks
 * the same line, direction, stop and minute again and again with only the alighting stop
 * changing, which does not change the bus: 3,686 questions in one plan, 1,098 of them
 * distinct. One instant's answers at a time, so this never outgrows a single plan.
 */
let nextRunAt = Number.NaN;
const nextRuns = new Map<string, NextRun>();

function nextRun(line: BusLine, dirIndex: number, stopIndex: number, targetMinutes: number, now: Date): NextRun {
  if (now.getTime() !== nextRunAt) {
    nextRuns.clear();
    nextRunAt = now.getTime();
  }
  const key = `${line.id}|${dirIndex}|${stopIndex}|${targetMinutes}`;
  const known = nextRuns.get(key);
  if (known) return known;

  /** The runs passing this stop on the day `days` after `now`, earliest first; [] if the line is off. */
  const runsOnDay = (days: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    const kind = dayKind(date);
    return lineRunsOn(line, kind) ? runsPassing(line, dirIndex, kind, stopIndex) : [];
  };

  // The caller may already be asking about a later day (a transfer whose first leg rolled
  // over): ask that day's timetable about the time of day, then put the answer back on the date.
  const askedDay = Math.floor(targetMinutes / MINUTES_PER_DAY);
  const askedRuns = runsOnDay(askedDay);
  let run = askedRuns.find((r) => r.minutesByStopIndex[stopIndex] >= targetMinutes - askedDay * MINUTES_PER_DAY);
  let day = askedDay;
  // Nothing left: the first run of the next day the line runs, read from THAT day's
  // timetable. It used to be today's first run moved to tomorrow, so on a Friday night
  // 664 of 1,136 departures offered for Saturday were wrong and 398 were on lines that do
  // not run on Saturdays at all.
  for (let ahead = 1; !run && ahead <= 7; ahead++) {
    const next = runsOnDay(askedDay + ahead);
    if (next.length) {
      run = next[0];
      day = askedDay + ahead;
    }
  }
  const found = { run, day, lastAsked: askedRuns[askedRuns.length - 1]?.minutesByStopIndex[stopIndex] };
  nextRuns.set(key, found);
  return found;
}

/**
 * The next bus of this line leaving `stopId` at or after `targetMinutes`, from the
 * published timetable. Also the trip companion's answer to a missed bus: the same question
 * asked again at the pole.
 */
export function getNextLineDeparture(
  lang: Lang,
  line: BusLine,
  directionId: string,
  stopId: string,
  targetMinutes: number,
  now: Date = new Date(),
  toStopId?: string,
): LineDeparture {
  const dirIndex = Math.max(0, line.directions.findIndex((d) => d.id === directionId));
  const direction = line.directions[dirIndex];
  const stopIndex = Math.max(0, direction.stops.indexOf(stopId));
  const toIndex = toStopId ? direction.stops.indexOf(toStopId) : -1;
  const t = translations(lang).engine;
  const askedDay = Math.floor(targetMinutes / MINUTES_PER_DAY);
  const { run, day, lastAsked } = nextRun(line, dirIndex, stopIndex, targetMinutes, now);

  if (run) {
    const offset = day * MINUTES_PER_DAY;
    const departureMinutes = run.minutesByStopIndex[stopIndex] + offset;
    const rolled = day > askedDay;
    const when = dayWord(lang, day, now);
    return {
      departureMinutes: Math.round(departureMinutes),
      waitMinutes: Math.max(0, Math.round(departureMinutes - targetMinutes)),
      isServiceActive: !rolled,
      serviceNotice: !rolled
        ? undefined
        : lastAsked !== undefined
          ? t.serviceOverToday(formatMinutes(lastAsked), formatMinutes(run.minutesByStopIndex[stopIndex]), when)
          : t.notRunningToday(line.number, daysLabel(line, lang)) + (isHoliday(now) ? ` ${translations(lang).lines.holidayToday}` : ''),
      // Per run, as on the board: a headway-filled departure has no printed time of its own.
      // Asked of the direction, 485 of 16,468 planner departures were labelled official.
      precision: run.publishedStopIndices.includes(stopIndex) ? 'published' : 'estimated',
      // Read off the very run being boarded, so the arrival honours every printed timing point.
      arrivalMinutes: toIndex > stopIndex ? Math.round(run.minutesByStopIndex[toIndex] + offset) : undefined,
      arrivalPrecision: run.publishedStopIndices.includes(toIndex) ? 'published' : 'estimated',
      daysAhead: day,
    };
  }

  // No run in a week: the line does not serve this stop at all. Tomorrow at its first
  // departure, marked as not running, rather than nothing.
  const fallback = parseTimeToMinutes(line.firstDeparture) + (askedDay + 1) * MINUTES_PER_DAY;
  return {
    departureMinutes: Math.round(fallback),
    waitMinutes: Math.max(0, Math.round(fallback - targetMinutes)),
    isServiceActive: false,
    serviceNotice: t.notRunningToday(line.number, daysLabel(line, lang)) + (isHoliday(now) ? ` ${translations(lang).lines.holidayToday}` : ''),
    precision: 'estimated',
    daysAhead: askedDay + 1,
  };
}
