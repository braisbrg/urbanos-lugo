/**
 * The prose the dataset carries (`line.days`, `line.frequency`, `direction.name`) is
 * written once, in one language, and cannot follow the reader. These say the same facts
 * from the structured fields, in any of the three. Place names stay as published.
 */
import { BusDirection, BusLine } from '../types';
import { Lang, translations } from '../i18n';
import { median } from './schedule';

export function directionLabel(direction: BusDirection, lang: Lang): string {
  return translations(lang).service.towards(direction.destination);
}

export function daysLabel(line: BusLine, lang: Lang): string {
  const days = new Set(line.services.flatMap((s) => s.days));
  const weekday = days.has('laborable');
  const weekend = days.has('sabado') || days.has('domingo');
  const t = translations(lang).service;
  return weekday && weekend ? t.everyday : weekend ? t.weekend : t.weekday;
}

/** A headway is only printed when the gaps are actually even, within this. */
const REGULAR_TOLERANCE_MIN = 3;
/** Past two hours "every 420 min" is a school run dressed up as a frequency. */
const MAX_USEFUL_HEADWAY_MIN = 120;

/** The gap between printed departures, when there is one they keep; null otherwise. */
function measuredHeadway(times: string[]): number | null {
  const minutes = times
    .map((t) => {
      const [h, m] = t.split(':').map(Number);
      return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
    })
    .filter((n) => Number.isFinite(n));
  if (minutes.length < 3) return null;
  const gaps = minutes.slice(1).map((m, i) => m - minutes[i]).filter((g) => g > 0);
  if (gaps.length < 2) return null;
  const mid = median(gaps);
  const even = gaps.every((g) => Math.abs(g - mid) <= REGULAR_TOLERANCE_MIN);
  return even && mid <= MAX_USEFUL_HEADWAY_MIN ? mid : null;
}

/** "Every 30 min", "every 30-60 min", or "check the timetable" for an uneven one. */
export function frequencyLabel(line: BusLine, lang: Lang): string {
  const headways = new Set<number>();
  for (const service of line.services) {
    const headway = typeof service.headwayMinutes === 'number' ? service.headwayMinutes : measuredHeadway(service.rows?.[0]?.times ?? []);
    if (headway !== null) headways.add(headway);
  }
  const t = translations(lang).service;
  if (headways.size === 0) return t.checkTimetable;
  const values = [...headways].sort((a, b) => a - b);
  return values.length === 1 ? t.every(values[0]) : t.everyRange(values[0], values[values.length - 1]);
}
