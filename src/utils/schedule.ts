/**
 * Turns the operator's published timetable into a passing time for every stop.
 *
 * Each published run is anchored to the timing points it lists; the stops in between are
 * interpolated with the road time measured for each leg. Every time is wall-clock minutes,
 * not elapsed time: a bus published at 07:20 leaves at 07:20 on the nights the clocks
 * move, so minute arithmetic is the right model and Date arithmetic the wrong one.
 */
import { BusLine, BusStop, DayKind } from '../types';
import { normalizeText } from './searchUtils';

export const MINUTES_PER_DAY = 1440;

export function parseTimeToMinutes(time: string): number {
  const [h, m] = (time || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** "HH:MM", wrapped past midnight. Rounded: interpolated times are fractional. */
export function formatMinutes(total: number): string {
  const n = (((Math.round(total) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/** Minutes since midnight, seconds included so every view agrees on "now". */
export function minutesNow(date: Date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

export function dayKind(date: Date): DayKind {
  const d = date.getDay();
  return d === 0 ? 'domingo' : d === 6 ? 'sabado' : 'laborable';
}

/** Answered from the published service patterns, which carry Saturday and Sunday apart. */
export function lineRunsOn(line: BusLine, kind: DayKind): boolean {
  return line.services.some((p) => p.days.includes(kind));
}

/** Inside the line's window, including a night line whose window crosses midnight. */
export function isWithinServiceWindow(line: BusLine, minutes: number): boolean {
  const first = parseTimeToMinutes(line.firstDeparture);
  const last = parseTimeToMinutes(line.lastDeparture);
  return first <= last ? minutes >= first && minutes <= last : minutes >= first || minutes <= last;
}

export function isLineInService(line: BusLine, now: Date = new Date()): boolean {
  return lineRunsOn(line, dayKind(now)) && isWithinServiceWindow(line, now.getHours() * 60 + now.getMinutes());
}

/**
 * Cumulative seconds from the first stop to each stop. Two allowances the operator does
 * not publish: 90 s for a leg the build could not measure, 20 s standing at each stop.
 */
function cumulativeSeconds(legSeconds: number[], stopCount: number): number[] {
  const out = [0];
  for (let i = 1; i < stopCount; i++) out.push(out[i - 1] + (legSeconds[i - 1] ?? 90) + 20);
  return out;
}

/** One scheduled run: when the bus passes each stop of one direction. Minutes may exceed 1440. */
export interface ScheduledRun {
  lineId: string;
  directionId: string;
  minutesByStopIndex: number[];
  /** Stop indices whose time is literally in the operator's table; everything else is derived. */
  publishedStopIndices: number[];
  /** Last stop pinned to a printed timing point; past it the clock is measured road time. */
  lastTimingPointIndex: number;
}

const runCache = new Map<string, ScheduledRun[]>();

/** Every departure between `first` and `last` at the stated cadence, bounded to a day. */
function expandHeadway(first: number, last: number, headwayMinutes: number): number[] {
  const end = last < first ? last + MINUTES_PER_DAY : last;
  const step = Math.max(5, headwayMinutes);
  const out: number[] = [];
  for (let t = first; t <= end && out.length < 288; t += step) out.push(t);
  return out;
}

/**
 * Best-matching stop index for a timing point such as "Sindicatos". A name that starts
 * with the timing point beats one that merely contains it ("HULA" is in both "HULA (Ent.
 * Principal)" and "Estda. Fonsagrada 102 (dir. HULA)"); ties go to the earliest stop.
 */
export function anchorIndex(timingPoint: string, stopNames: string[]): number {
  const target = normalizeText(timingPoint);
  if (!target) return -1;
  const words = target.split(' ').filter((w) => w.length > 3);
  let best = -1;
  let bestScore = 0;
  stopNames.forEach((name, i) => {
    const n = normalizeText(name);
    const score =
      n === target ? 100
      : n.startsWith(target) ? 80
      : n.includes(target) ? 60
      : words.length && words.every((w) => n.includes(w)) ? 40
      : 0;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return bestScore >= 40 ? best : -1;
}

export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

interface Anchor {
  index: number;
  times: number[];
  fromPrevious?: number;
}

/**
 * The printed timing points that can be chained, with the official minutes between them.
 *
 * A cyclic line prints each timing point once for the whole loop, so two rows can name
 * stops no single run visits in that order. A pair is chained only when its printed gap
 * is positive, plausible as one leg, and in the same league as the measured road time; a
 * return-leg mismatch fails that by tens of minutes and drops out.
 */
function publishedChain(anchors: Anchor[], cum: number[]): Anchor[] {
  const chain: Anchor[] = [];
  for (const anchor of anchors) {
    const previous = chain[chain.length - 1];
    if (!previous) {
      chain.push(anchor);
      continue;
    }
    const columns = Math.min(previous.times.length, anchor.times.length);
    const gaps: number[] = [];
    for (let k = 0; k < columns; k++) {
      const gap = anchor.times[k] - previous.times[k];
      if (gap > 0 && gap <= 60) gaps.push(gap);
    }
    if (gaps.length < Math.max(2, columns / 2)) continue;
    const printed = median(gaps);
    const measured = (cum[anchor.index] - cum[previous.index]) / 60;
    if (measured <= 0) continue;
    const ratio = printed / measured;
    if (ratio < 0.5 || ratio > 2) continue;
    chain.push({ ...anchor, fromPrevious: printed });
  }
  return chain;
}

/**
 * Minutes after departure at which the run passes each stop. Between two published points
 * the road times are stretched to land on both; outside the published range they stand.
 */
function offsetsFromChain(chain: Anchor[], cum: number[]): number[] {
  const head = chain[0];
  const offsets = cum.map((c) => (c - cum[head.index]) / 60);
  let published = 0;
  for (let i = 1; i < chain.length; i++) {
    const from = chain[i - 1].index;
    const to = chain[i].index;
    const scale = chain[i].fromPrevious! / ((cum[to] - cum[from]) / 60);
    for (let j = from + 1; j <= to; j++) offsets[j] = published + ((cum[j] - cum[from]) / 60) * scale;
    published += chain[i].fromPrevious!;
  }
  const tail = chain[chain.length - 1].index;
  for (let j = tail + 1; j < cum.length; j++) offsets[j] = published + (cum[j] - cum[tail]) / 60;
  return offsets;
}

/** Every run of a line's direction for one service day; [] when it does not run. */
export function buildRuns(line: BusLine, directionIndex: number, stops: BusStop[], dayType: DayKind = 'laborable'): ScheduledRun[] {
  const key = `${line.id}|${directionIndex}|${dayType}`;
  const cached = runCache.get(key);
  if (cached) return cached;

  const direction = line.directions[directionIndex];
  const result: ScheduledRun[] = [];
  const pattern = line.services?.find((p) => p.days.includes(dayType));

  if (direction && direction.stops.length >= 2 && (pattern || !line.services?.length)) {
    const byId = new Map(stops.map((s) => [s.id, s]));
    const stopNames = direction.stops.map((id) => byId.get(id)?.name || id);
    const cum = cumulativeSeconds(direction.legSeconds || [], direction.stops.length);

    const anchors: Anchor[] = [];
    for (const row of pattern?.rows || []) {
      const idx = anchorIndex(row.timingPoint, stopNames);
      if (idx >= 0 && !anchors.some((a) => a.index === idx)) anchors.push({ index: idx, times: row.times.map(parseTimeToMinutes) });
    }
    anchors.sort((a, b) => a.index - b.index);

    const chain = publishedChain(anchors, cum);
    const head = chain[0];
    if (head) {
      // With a stated cadence the operator prints only the first and last departure.
      const departures =
        pattern?.headwayMinutes && head.times.length === 2 ? expandHeadway(head.times[0], head.times[1], pattern.headwayMinutes) : head.times;
      const offsets = offsetsFromChain(chain, cum);
      // A stop is published for a run only when its time is literally in the table for that
      // timing point: headway-filled runs are inferences, and a median leg time can land a
      // few minutes off the printed time for some runs.
      const anchorTimes = chain.map((a) => new Set(a.times));
      const lastTimingPointIndex = chain[chain.length - 1].index;
      for (const departure of departures) {
        const minutesByStopIndex = offsets.map((o) => departure + o);
        result.push({
          lineId: line.id,
          directionId: direction.id,
          minutesByStopIndex,
          publishedStopIndices: chain.map((a) => a.index).filter((index, j) => anchorTimes[j].has(Math.round(minutesByStopIndex[index]))),
          lastTimingPointIndex,
        });
      }
    }

    // No timing point resolves: fall back to the headway between first and last departure,
    // and claim nothing as published. No current direction reaches this; kept for the next.
    if (!result.length) {
      const first = parseTimeToMinutes(line.firstDeparture);
      let last = parseTimeToMinutes(line.lastDeparture);
      if (last < first) last += MINUTES_PER_DAY;
      const headway = Math.max(10, pattern?.headwayMinutes ?? 30);
      for (let t = first; t <= last; t += headway) {
        result.push({
          lineId: line.id,
          directionId: direction.id,
          minutesByStopIndex: direction.stops.map((_, i) => t + cum[i] / 60),
          publishedStopIndices: [],
          lastTimingPointIndex: 0,
        });
      }
    }
  }

  runCache.set(key, result);
  return result;
}

const handoverCache = new Map<string, Map<string, number>>();

/**
 * The minute at which each run's marker gives way to the same bus's next leg.
 *
 * A line's two directions are one vehicle turning around, and where the modelled arrival
 * lands after the printed departure of the leg it turns into, the map drew the bus twice.
 * So a run stops being drawn at the earliest opposite-direction departure inside it — never
 * before its last printed timing point, where the clock is still the operator's and such a
 * departure is the other bus of a two-bus line. A departure ends only the run whose arrival
 * it is nearest to, so two markers never vanish into one. Keyed `${directionIndex}|${runIndex}`.
 */
export function handoverMinutes(line: BusLine, stops: BusStop[], dayType: DayKind): Map<string, number> {
  const key = `${line.id}|${dayType}`;
  const cached = handoverCache.get(key);
  if (cached) return cached;

  const legs = line.directions.flatMap((_, dir) =>
    buildRuns(line, dir, stops, dayType).map((run, runIndex) => {
      const t = run.minutesByStopIndex;
      return { key: `${dir}|${runIndex}`, dir, start: t[0], end: t[t.length - 1], pinnedUntil: t[run.lastTimingPointIndex] ?? t[0] };
    }),
  );

  // successor leg index -> the leg it ends, and how far short of that leg's arrival.
  const claims = new Map<number, { by: number; gap: number }>();
  legs.forEach((leg, i) => {
    let best = -1;
    legs.forEach((other, j) => {
      if (other.dir === leg.dir) return;
      if (!(other.start > leg.start && other.start < leg.end && other.start >= leg.pinnedUntil)) return;
      if (best < 0 || other.start < legs[best].start) best = j;
    });
    if (best < 0) return;
    const gap = leg.end - legs[best].start;
    const held = claims.get(best);
    if (!held || gap < held.gap) claims.set(best, { by: i, gap });
  });

  const result = new Map<string, number>();
  for (const [successor, { by }] of claims) result.set(legs[by].key, legs[successor].start);
  handoverCache.set(key, result);
  return result;
}

/**
 * How long one whole trip takes, read off a built run (first index to last), which honours
 * every printed timing point and every dwell. Summing `legSeconds` was a median of five
 * minutes short. `undefined` when no run can be built, so the caller says "no timetable".
 */
export function scheduledDuration(line: BusLine, directionIndex: number, stops: BusStop[]): number | undefined {
  const direction = line.directions[directionIndex];
  if (!direction) return undefined;
  const lastIndex = direction.stops.length - 1;
  for (const kind of ['laborable', 'sabado', 'domingo'] as const) {
    for (const run of buildRuns(line, directionIndex, stops, kind)) {
      const first = run.minutesByStopIndex[0];
      const last = run.minutesByStopIndex[lastIndex];
      if (first !== undefined && last !== undefined && last > first) return Math.round(last - first);
    }
  }
  return undefined;
}
