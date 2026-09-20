/**
 * What a departure board shows: the next passes at a stop and the next departure of a
 * line, read from the published timetable and never measured. Pure functions, no React.
 */
import { BUS_STOPS, BUS_LINES, lineById, stopName } from '../data/transitData';
import { daysLabel } from './serviceLabels';
import { Lang, translations } from '../i18n';
import { BusStop, BusLine, Precision, StopArrival } from '../types';
import { MINUTES_PER_DAY, anchorIndex, buildRuns, dayKind, formatMinutes, lineRunsOn, minutesNow, parseTimeToMinutes } from './schedule';
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
          const late = Math.round(nowMinutes - minutes);
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

export interface NextService {
  lineNumber: string;
  destination: string;
  time: string;
  minutesAway: number;
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
        if (stopIndex === -1) return;
        for (const run of buildRuns(line, dirIndex, BUS_STOPS, kind)) {
          const minutes = run.minutesByStopIndex[stopIndex];
          if (minutes === undefined) continue;
          const away = minutes + offset - nowMinutes;
          if (away > 0 && (!best || away < best.minutesAway)) {
            best = { lineNumber: line.number, destination: direction.destination, time: formatMinutes(minutes % MINUTES_PER_DAY), minutesAway: Math.round(away) };
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

  const runs = lineRunsOn(line, dayKind(now)) ? buildRuns(line, dirIndex, BUS_STOPS, dayKind(now)) : [];
  const candidates = runs.filter((r) => r.minutesByStopIndex[stopIndex] !== undefined).sort((a, b) => a.minutesByStopIndex[stopIndex] - b.minutesByStopIndex[stopIndex]);

  // The caller may already be asking about tomorrow (a transfer whose first leg rolled
  // over): ask the timetable about the time of day, then put the answer back on the date.
  const dayOffset = Math.floor(targetMinutes / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  const targetToday = targetMinutes - dayOffset;

  let run = candidates.find((r) => r.minutesByStopIndex[stopIndex] >= targetToday);
  let offset = dayOffset;
  if (!run && candidates.length) {
    run = candidates[0]; // nothing left today: the first run of the next service day
    offset += MINUTES_PER_DAY;
  }

  const precision: Precision = runs.some((r) => r.publishedStopIndices.includes(stopIndex)) ? 'published' : 'estimated';

  if (run) {
    const departureMinutes = run.minutesByStopIndex[stopIndex] + offset;
    const rolled = offset > 0;
    return {
      departureMinutes: Math.round(departureMinutes),
      waitMinutes: Math.max(0, Math.round(departureMinutes - targetMinutes)),
      isServiceActive: !rolled,
      serviceNotice: rolled ? t.serviceOverToday(line.lastDeparture, line.firstDeparture) : undefined,
      precision,
      // Read off the very run being boarded, so the arrival honours every printed timing point.
      arrivalMinutes: toIndex > stopIndex ? Math.round(run.minutesByStopIndex[toIndex] + offset) : undefined,
      arrivalPrecision: run.publishedStopIndices.includes(toIndex) ? 'published' : 'estimated',
    };
  }

  // No run at all: the line does not serve this stop today.
  const fallback = parseTimeToMinutes(line.firstDeparture) + dayOffset + MINUTES_PER_DAY;
  return {
    departureMinutes: Math.round(fallback),
    waitMinutes: Math.max(0, Math.round(fallback - targetMinutes)),
    isServiceActive: false,
    serviceNotice: t.notRunningToday(line.number, daysLabel(line, lang)),
    precision,
  };
}
