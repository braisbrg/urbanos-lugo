/**
 * Turns the operator's published timetable into a passing time for every stop.
 *
 * The old engine derived arrivals from `wallClockMinutes % frequency`, which produced
 * buses at 03:00 and ignored the real cadence. Here each published run is anchored to
 * the timing points it lists, and the stops in between are interpolated using the real
 * road travel time measured for each leg.
 *
 * Every time here is wall clock, not elapsed time: a bus published at 07:20 leaves at
 * 07:20 on the two nights a year the clocks move, so minute arithmetic is the right
 * model and Date arithmetic would be the wrong one. The one artefact is that a plan
 * spanning 02:00-03:00 on the March night names an hour the clock skips. Nothing in
 * this network runs then -- the first departure anywhere is 07:00 -- so only a
 * walking plan can span it. Not worth a second time model.
 */
import { BusLine, BusStop } from '../types';
import { normalizeText } from './searchUtils';

type DayKind = 'laborable' | 'sabado' | 'domingo';

export const MINUTES_PER_DAY = 1440;

export function parseTimeToMinutes(time: string): number {
  const [h, m] = (time || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function formatMinutes(total: number): string {
  // Interpolated passing times are fractional; without rounding they render as
  // "02:59.370277078085564".
  const rounded = Math.round(total);
  const n = ((rounded % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
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

/**
 * Does this line run at all on this kind of day? Answered from the published service
 * patterns, which carry Saturday and Sunday separately; the old version guessed from a
 * free-text "days" label and reported weekend service the operator does not run.
 */
export function lineRunsOn(line: BusLine, kind: DayKind): boolean {
  return line.services.some((p) => p.days.includes(kind));
}

/**
 * Is `minutes` inside the line's service window? Handles night lines whose window
 * crosses midnight (22:30 -> 06:30), which the previous code reported as "finished".
 */
export function isWithinServiceWindow(line: BusLine, minutes: number): boolean {
  const first = parseTimeToMinutes(line.firstDeparture);
  const last = parseTimeToMinutes(line.lastDeparture);
  return first <= last ? minutes >= first && minutes <= last : minutes >= first || minutes <= last;
}

export function isLineInService(line: BusLine, now: Date = new Date()): boolean {
  return (
    lineRunsOn(line, dayKind(now)) &&
    isWithinServiceWindow(line, now.getHours() * 60 + now.getMinutes())
  );
}

/** Cumulative seconds from the first stop of a direction to each of its stops. */
function cumulativeSeconds(legSeconds: number[], stopCount: number): number[] {
  const out = [0];
  for (let i = 1; i < stopCount; i++) {
    // Two allowances the operator does not publish: 90 s for a leg whose road time the
    // dataset build could not measure, and 20 s standing at each stop, which is the usual
    // urban dwell. Both only apply where measurement failed; a measured leg overrides the
    // first entirely.
    out.push(out[i - 1] + (legSeconds[i - 1] ?? 90) + 20);
  }
  return out;
}

/**
 * A single scheduled run: what time the bus passes each stop of one direction.
 * `minutes` may exceed 1440 for a run that finishes after midnight.
 */
interface ScheduledRun {
  lineId: string;
  directionId: string;
  /** Passing time in minutes-from-midnight, per stop index of the direction. */
  minutesByStopIndex: number[];
  /**
   * Stop indices whose time comes straight from the published table. Everything else
   * is derived from measured road time, and the UI says so rather than presenting an
   * estimate as a promise.
   */
  publishedStopIndices: number[];
}

const runCache = new Map<string, ScheduledRun[]>();

/** Every departure between `first` and `last` at the stated cadence. */
function expandHeadway(first: number, last: number, headwayMinutes: number): number[] {
  const end = last < first ? last + MINUTES_PER_DAY : last; // service running past midnight
  const step = Math.max(5, headwayMinutes);
  const out: number[] = [];
  // 288 is a full day at the 5-minute floor, so this bounds a bad headway (0, negative,
  // NaN) without ever truncating a real service.
  for (let t = first; t <= end && out.length < 288; t += step) out.push(t);
  return out;
}

/**
 * Best-matching stop index for a timetable timing point such as "Sindicatos".
 *
 * A plain substring test is not enough. "HULA" appears in both "HULA (Ent. Principal)"
 * and "Estda. Fonsagrada 102 (dir. HULA)" — the second is a stop on the way that merely
 * names the destination on its sign. Since a timing point sets an official time for
 * whatever it matches, landing on the signpost instead of the terminus moves a printed
 * time several stops up the route. So a name that *starts* with the timing point beats
 * one that merely contains it; ties still go to the earliest stop on the route, which is
 * where a timetable row for a departure point belongs.
 */
export function anchorIndex(timingPoint: string, stopNames: string[]): number {
  const target = normalizeText(timingPoint);
  if (!target) return -1;

  let best = -1;
  let bestScore = 0;
  stopNames.forEach((name, i) => {
    const n = normalizeText(name);
    let score = 0;
    if (n === target) score = 100;
    else if (n.startsWith(target)) score = 80;
    else if (n.includes(target)) score = 60;
    else {
      const words = target.split(' ').filter((w) => w.length > 3);
      if (words.length && words.every((w) => n.includes(w))) score = 40;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return bestScore >= 40 ? best : -1;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * The printed timing points we can safely chain, and the official minutes between them.
 *
 * A cyclic line prints each timing point once for the whole loop, and the same street
 * often has a pole in each direction, so two rows can name stops that no single run
 * visits in that order. Pairing those column-by-column mixes the outbound and return
 * legs and produces departures that run backwards or land in the small hours — which is
 * why this used to trust exactly one anchor and model everything else.
 *
 * Chaining is safe once the pair is checked: the printed gap must be positive, plausible
 * as one leg, and in the same league as the measured road time. A return-leg mismatch
 * fails that by tens of minutes (line 5.1 prints 40 minutes for a stretch the road says
 * is 18), so it drops out and the model covers that stretch as before.
 */
function publishedChain(
  anchors: { index: number; times: number[] }[],
  cum: number[],
): { index: number; times: number[]; fromPrevious?: number }[] {
  const chain: { index: number; times: number[]; fromPrevious?: number }[] = [];
  for (const anchor of anchors) {
    const previous = chain[chain.length - 1];
    if (!previous) {
      chain.push(anchor);
      continue;
    }

    const gaps: number[] = [];
    const columns = Math.min(previous.times.length, anchor.times.length);
    for (let k = 0; k < columns; k++) {
      const gap = anchor.times[k] - previous.times[k];
      if (gap > 0 && gap <= 60) gaps.push(gap);
    }
    if (gaps.length < Math.max(2, columns / 2)) continue;

    const printed = median(gaps);
    const measured = (cum[anchor.index] - cum[previous.index]) / 60;
    if (measured <= 0) continue;
    const ratio = printed / measured;
    if (ratio < 0.5 || ratio > 2) continue; // the pair does not describe one run

    chain.push({ ...anchor, fromPrevious: printed });
  }
  return chain;
}

/**
 * Minutes after the run's departure at which it passes each stop.
 *
 * Between two published timing points the measured road times are stretched to land
 * exactly on both, so the official times are honoured and the error in between is
 * bounded by that stretch instead of accumulating across the whole route. Outside the
 * published range there is nothing to interpolate against, so the road time stands.
 */
function offsetsFromChain(
  chain: { index: number; times: number[]; fromPrevious?: number }[],
  cum: number[],
): number[] {
  const head = chain[0];
  const offsets = cum.map((c) => (c - cum[head.index]) / 60);

  let published = 0;
  for (let i = 1; i < chain.length; i++) {
    const from = chain[i - 1].index;
    const to = chain[i].index;
    const measured = (cum[to] - cum[from]) / 60;
    const scale = chain[i].fromPrevious! / measured;
    const base = published;
    for (let j = from + 1; j <= to; j++) {
      offsets[j] = base + ((cum[j] - cum[from]) / 60) * scale;
    }
    published += chain[i].fromPrevious!;
  }

  // Past the last published point the road time carries on from where it left off.
  const tail = chain[chain.length - 1].index;
  for (let j = tail + 1; j < cum.length; j++) {
    offsets[j] = published + (cum[j] - cum[tail]) / 60;
  }
  return offsets;
}

/**
 * Build every run of a line's direction for one service day.
 * Returns [] when the line does not run that day.
 */
export function buildRuns(
  line: BusLine,
  directionIndex: number,
  stops: BusStop[],
  dayType: DayKind = 'laborable',
): ScheduledRun[] {
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

    // Anchor the published timing points onto this direction's stop list.
    const anchors: { index: number; times: number[] }[] = [];
    for (const row of pattern?.rows || []) {
      const idx = anchorIndex(row.timingPoint, stopNames);
      if (idx >= 0 && !anchors.some((a) => a.index === idx)) {
        anchors.push({ index: idx, times: row.times.map(parseTimeToMinutes) });
      }
    }
    anchors.sort((a, b) => a.index - b.index);

    const chain = publishedChain(anchors, cum);
    const head = chain[0];
    if (head) {
      // With a stated cadence the operator prints only the first and last departure;
      // fill the day in at that headway rather than running the line twice.
      const departures =
        pattern?.headwayMinutes && head.times.length === 2
          ? expandHeadway(head.times[0], head.times[1], pattern.headwayMinutes)
          : head.times;

      const offsets = offsetsFromChain(chain, cum);

      // A stop counts as published for a run only when the time we work out for it is
      // literally in the operator's table for that timing point. Marking every anchor of
      // every run over-claimed twice: runs filled in at the stated headway are inferences
      // (line 2 prints 07:15, 21:15 and "cada 30 min.", never 07:45), and where a table
      // prints more departures at one timing point than another, the leg time is a median
      // that lands a few minutes off the printed time for some individual runs.
      const anchorTimes = chain.map((a) => new Set(a.times));

      for (const departure of departures) {
        const minutesByStopIndex = offsets.map((o) => departure + o);
        result.push({
          lineId: line.id,
          directionId: direction.id,
          minutesByStopIndex,
          publishedStopIndices: chain
            .map((a) => a.index)
            .filter((index, j) => anchorTimes[j].has(Math.round(minutesByStopIndex[index]))),
        });
      }
    }

    // No timing point of this direction appears in the published table: fall back to
    // the headway between the first and last departure.
    //
    // Nothing here is published, so nothing here claims to be. This used to mark stop 0
    // as official, which would put a printed-time badge on a departure the operator never
    // printed. No direction in the current dataset reaches this branch — every one has at
    // least one timing point that resolves — so that was a latent bug rather than a live
    // one, and `npm test` cannot catch a regression here for the same reason. It is kept
    // because a future line with unmatched timing points would land on it.
    if (!result.length) {
      const first = parseTimeToMinutes(line.firstDeparture);
      let last = parseTimeToMinutes(line.lastDeparture);
      if (last < first) last += MINUTES_PER_DAY; // night line
      // The headway of the pattern being built, not of whichever service happens to
      // declare one first: a Saturday service can run at a different cadence.
      const headway = Math.max(10, pattern?.headwayMinutes ?? 30);
      for (let t = first; t <= last; t += headway) {
        result.push({
          lineId: line.id,
          directionId: direction.id,
          minutesByStopIndex: direction.stops.map((_, i) => t + cum[i] / 60),
          publishedStopIndices: [],
        });
      }
    }
  }

  runCache.set(key, result);
  return result;
}
