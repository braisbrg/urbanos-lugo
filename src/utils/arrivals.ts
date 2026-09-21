/**
 * What a departure board shows: the next passes at a stop and the next departure of a
 * line, read from the published timetable and never measured.
 *
 * Pure functions over the shipped dataset, no React and no DOM. One of the four files
 * the old transitEngine.ts was split into, by subject.
 */
import { BUS_STOPS, BUS_LINES } from '../data/transitData';
import { daysLabel } from './serviceLabels';
import { Lang, translations } from '../i18n';
import { BusStop, BusLine, StopArrival } from '../types';
import { MINUTES_PER_DAY, anchorIndex, buildRuns, dayKind, formatMinutes, isHoliday, lineRunsOn, parseTimeToMinutes } from './schedule';
import { findStop } from './places';

/**
 * Expected crowding, from the time of day alone. There is no occupancy feed, so this is
 * a prior, not a measurement — every surface that shows it labels it as expected.
 */
export function occupancyAt(minutes: number): 'low' | 'medium' | 'high' {
  const peak = (minutes >= 7 * 60 + 30 && minutes <= 9 * 60 + 30) || (minutes >= 13 * 60 && minutes <= 15 * 60) || (minutes >= 18 * 60 && minutes <= 20 * 60);
  const quiet = minutes < 7 * 60 + 30 || minutes > 21 * 60;
  return peak ? 'high' : quiet ? 'low' : 'medium';
}

/**
 * How far ahead a departure board looks. Past this the answer people want is
 * "first bus at 07:15", not "next bus in 195 min", so the board goes empty and the
 * view shows the service notice instead.
 */
const ARRIVALS_HORIZON_MINUTES = 120;

/**
 * How long a departure stays on the board after its printed time.
 *
 * Measured, not chosen: 389 comparisons against the operator's own tracker at stops where
 * they publish the time -- so our minute is theirs, and the difference is the bus. Half of
 * departures ran at least a minute late, a quarter four or more, one in ten eight or more.
 * Five covers 84% of them.
 *
 * The old value was one minute, and it produced the worst failure this board had: a bus
 * five minutes down dropped off, the next service appeared in its place, and the board
 * went from "Chegando" to "88 min" while the bus was three minutes from the stop.
 */
const OVERDUE_GRACE_MINUTES = 5;

/**
 * Next arrivals at a stop, taken from the operator's published timetable.
 * Returns an empty board outside the service window instead of inventing buses.
 */
/**
 * How many stops the operator actually prints a time for, out of how many exist.
 *
 * The board tells a reader why their stop shows only estimates, and that sentence used
 * to carry "23 of the 429" as literal prose in three languages. Those are facts about
 * the dataset, so they are counted from it — a regenerated dataset can no longer leave
 * the explanation contradicting the screen above it.
 */
let timingPointCounts: { published: number; total: number } | null = null;

export function timingPointStopCount(): { published: number; total: number } {
  if (timingPointCounts) return timingPointCounts;

  const published = new Set<string>();
  for (const line of BUS_LINES) {
    for (const direction of line.directions) {
      const names = direction.stops.map((id) => BUS_STOPS.find((s) => s.id === id)?.name ?? id);
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

export function getArrivalsForStop(
  stopIdOrCode: string,
  now: Date = new Date(),
): { stop: BusStop | undefined; arrivals: StopArrival[] } {
  const stop = findStop(stopIdOrCode);
  if (!stop) return { stop: undefined, arrivals: [] };

  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const today = dayKind(now);
  const arrivals: StopArrival[] = [];

  for (const lineId of stop.lines) {
    const line = BUS_LINES.find((l) => l.id === lineId);
    if (!line || !lineRunsOn(line, today)) continue;

    line.directions.forEach((direction, dirIndex) => {
      const stopIndex = direction.stops.indexOf(stop.id);
      if (stopIndex === -1) return;

      // The last stop of a direction is where the run ends. Those buses arrive here and
      // go out of service; listing them on a departure board offers a ride nobody can
      // take — and at a terminus it reads as "the bus to here leaves in 10 min" to
      // somebody already standing there.
      if (stopIndex === direction.stops.length - 1) return;

      const runs = buildRuns(line, dirIndex, BUS_STOPS, today);
      const upcoming = runs
        .map((run) => ({
          minutes: run.minutesByStopIndex[stopIndex],
          // Per run, not per direction: the operator prints times for some runs of a
          // line and not others, and a headway-generated run passing a timing point has
          // no published time of its own to claim.
          published: run.publishedStopIndices.includes(stopIndex),
        }))
        .filter((r) => r.minutes !== undefined)
        // A run listed as 23:50 is still "next" at 00:05, so compare on the same day arc.
        // The same constant as the grace window on purpose: a departure inside the window
        // is still today's, and one outside it is tomorrow's and falls past the horizon.
        .map((r) => ({
          ...r,
          minutes:
            r.minutes < nowMinutes - OVERDUE_GRACE_MINUTES ? r.minutes + MINUTES_PER_DAY : r.minutes,
        }))
        .filter(
          (r) =>
            r.minutes >= nowMinutes - OVERDUE_GRACE_MINUTES &&
            r.minutes <= nowMinutes + ARRIVALS_HORIZON_MINUTES,
        )
        .sort((a, b) => a.minutes - b.minutes)
        // Three, so the by-line view can show a line's next few departures and derive
        // a headway from them instead of asserting a frequency nobody measured.
        .slice(0, 3);

      upcoming.forEach(({ minutes, published }) => {
        // Late is counted from the minute the board prints, not from the half-minute an
        // interpolated time can really fall on. Rounded separately, a run at 08:16.5 was
        // printed as 08:17 and marked one minute overdue at 08:17:00 -- late before the
        // time on its own row. Found by the edge probe in tools/stressInvariants.ts.
        const late = Math.floor(nowMinutes) - Math.round(minutes);
        arrivals.push({
          lineId: line.id,
          lineNumber: line.number,
          lineName: line.name,
          lineColor: line.color,
          destination: direction.destination,
          etaMinutes: Math.max(0, Math.round(minutes - nowMinutes)),
          etaTime: formatMinutes(Math.round(minutes)),
          precision: published ? 'published' : 'estimated',
          overdueMinutes: late > 0 ? late : undefined,
        });
      });
    });
  }

  // Overdue departures all sit at zero minutes, so the tie is broken by how long they have
  // been waiting: the one that was due a minute ago is likelier to still turn up than the
  // one due five minutes ago, and it goes first.
  arrivals.sort(
    (a, b) => a.etaMinutes - b.etaMinutes || (a.overdueMinutes ?? 0) - (b.overdueMinutes ?? 0),
  );
  return { stop, arrivals };
}

/**
 * When this stop next has a bus, looking past the arrivals horizon and past today.
 *
 * An empty board is the right answer at 03:00, but "no departures right now" is not what
 * someone standing there needs: they need to know whether to wait ten minutes or go home.
 * This is only ever asked when the board is empty, so it can afford to scan the day.
 */
export function nextServiceAtStop(
  stopIdOrCode: string,
  now: Date = new Date(),
): { lineNumber: string; destination: string; time: string; minutesAway: number } | null {
  const stop = findStop(stopIdOrCode);
  if (!stop) return null;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  let best: { lineNumber: string; destination: string; time: string; minutesAway: number } | null = null;

  // Today first, then the next service day, so a Sunday night gets Monday's first bus.
  for (let dayAhead = 0; dayAhead < 7 && !best; dayAhead++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayAhead);
    const kind = dayKind(day);
    const offset = dayAhead * MINUTES_PER_DAY;

    for (const lineId of stop.lines) {
      const line = BUS_LINES.find((l) => l.id === lineId);
      if (!line || !lineRunsOn(line, kind)) continue;

      line.directions.forEach((direction, dirIndex) => {
        const stopIndex = direction.stops.indexOf(stop.id);
        if (stopIndex === -1) return;

        for (const run of buildRuns(line, dirIndex, BUS_STOPS, kind)) {
          const minutes = run.minutesByStopIndex[stopIndex];
          if (minutes === undefined) continue;
          const away = minutes + offset - nowMinutes;
          if (away <= 0) continue;
          if (!best || away < best.minutesAway) {
            best = {
              lineNumber: line.number,
              destination: direction.destination,
              time: formatMinutes(Math.round(minutes % MINUTES_PER_DAY)),
              minutesAway: Math.round(away),
            };
          }
        }
      });
    }
  }

  return best;
}


/**
 * When does the next bus of this line leave `stopId`, at or after `targetMinutes`?
 * Reads the published timetable; no synthetic slots.
 *
 * Exported for the trip companion, whose answer to a missed bus is this same question
 * asked again at the pole — not a new plan from a moving position.
 */
export function getNextLineDeparture(
  lang: Lang,
  line: BusLine,
  directionId: string,
  stopId: string,
  targetMinutes: number,
  _nowMinutes: number,
  now: Date = new Date(),
  toStopId?: string,
): {
  departureMinutes: number;
  waitMinutes: number;
  isServiceActive: boolean;
  serviceNotice?: string;
  /** 'published' when the operator prints this time for this stop. */
  precision: 'published' | 'estimated';
  /** When that same run reaches `toStopId`, and whether the operator prints it. */
  arrivalMinutes?: number;
  arrivalPrecision?: 'published' | 'estimated';
} {
  const dirIndex = Math.max(0, line.directions.findIndex((d) => d.id === directionId));
  const direction = line.directions[dirIndex];
  const stopIndex = Math.max(0, direction.stops.indexOf(stopId));
  const toIndex = toStopId ? direction.stops.indexOf(toStopId) : -1;

  const runsToday = lineRunsOn(line, dayKind(now));
  const runs = runsToday ? buildRuns(line, dirIndex, BUS_STOPS, dayKind(now)) : [];

  const candidates = runs
    .filter((r) => r.minutesByStopIndex[stopIndex] !== undefined)
    .sort((a, b) => a.minutesByStopIndex[stopIndex] - b.minutesByStopIndex[stopIndex]);

  // A timetable covers one day, but the caller may already be asking about tomorrow —
  // the second half of a transfer whose first leg rolled over. Ask the timetable about
  // the time of day, then put the answer back on the right date. Doing this by adding a
  // flat day to the first departure used to hand back a connecting bus that left before
  // the bus it connects from.
  const dayOffset = Math.floor(targetMinutes / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  const targetToday = targetMinutes - dayOffset;

  let run = candidates.find((r) => r.minutesByStopIndex[stopIndex] >= targetToday);
  let offset = dayOffset;
  if (!run && candidates.length) {
    run = candidates[0]; // nothing left today: the first run of the next service day
    offset += MINUTES_PER_DAY;
  }

  const published = runs.some((r) => r.publishedStopIndices.includes(stopIndex));

  if (run) {
    const departureMinutes = run.minutesByStopIndex[stopIndex] + offset;
    const rolled = offset > 0;
    return {
      departureMinutes: Math.round(departureMinutes),
      waitMinutes: Math.max(0, Math.round(departureMinutes - targetMinutes)),
      isServiceActive: !rolled,
      serviceNotice: rolled
        ? `Servizo finalizado por hoxe (última saída ás ${line.lastDeparture}). Primeira saída ás ${line.firstDeparture}.`
        : undefined,
      precision: published ? 'published' : 'estimated',
      // Read off the very run being boarded, on the same date, so the arrival honours
      // every printed timing point along the way instead of re-deriving it from road
      // times — and cannot land on a different day than its own boarding.
      arrivalMinutes:
        toIndex > stopIndex ? Math.round(run.minutesByStopIndex[toIndex] + offset) : undefined,
      arrivalPrecision: run.publishedStopIndices.includes(toIndex) ? 'published' : 'estimated',
    };
  }

  // The line has no run we can place at all: it does not serve this stop today. The
  // next departure is on the next day it does run, which is not always tomorrow -- a
  // weekday-only line asked about on a Saturday used to be offered at "tomorrow 07:19",
  // a Sunday, when it does not run either. Found by the weekend pass in
  // tools/stressPlanner.ts. Seven days is the whole calendar; a line that runs on no day
  // at all keeps the old answer rather than none.
  let daysAhead = 1;
  for (; daysAhead < 7; daysAhead++) {
    const then = new Date(now);
    then.setDate(then.getDate() + daysAhead);
    if (lineRunsOn(line, dayKind(then))) break;
  }
  if (daysAhead === 7) daysAhead = 1;
  const fallback = parseTimeToMinutes(line.firstDeparture) + dayOffset + daysAhead * MINUTES_PER_DAY;
  return {
    departureMinutes: Math.round(fallback),
    waitMinutes: Math.max(0, Math.round(fallback - targetMinutes)),
    isServiceActive: false,
    serviceNotice:
      translations(lang).engine.notRunningToday(line.number, daysLabel(line, lang)) +
      (isHoliday(now) ? ` ${translations(lang).lines.holidayToday}` : ''),
    precision: published ? 'published' : 'estimated',
  };
}

