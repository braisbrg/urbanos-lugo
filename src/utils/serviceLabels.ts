import { BusLine } from '../types';
import { Lang, translations } from '../i18n';

/**
 * Human labels for when a line runs and how often, derived from the structured service
 * data rather than read from a pre-rendered string.
 *
 * The dataset also carries `line.days` and `line.frequency` as Spanish prose. Those were
 * written once, in one language, and cannot follow the interface — a Galician UI was
 * printing "De lunes a viernes". `services[].days` and `services[].headwayMinutes` are
 * the same facts in a form that can be said in any language, so they are the source here
 * and the prose fields are left unread.
 */
export function daysLabel(line: BusLine, lang: Lang): string {
  const days = new Set(line.services.flatMap((s) => s.days));
  const weekday = days.has('laborable');
  const weekend = days.has('sabado') || days.has('domingo');
  const t = translations(lang).service;
  if (weekday && weekend) return t.everyday;
  if (weekend) return t.weekend;
  return t.weekday;
}

/**
 * How often the line comes.
 *
 * `headwayMinutes` is only filled in for some services, but the published times
 * themselves say it: line 1.1 declares no headway and departs 07:15, 08:45, 10:15 —
 * ninety minutes apart every time. So the gaps are measured, and a figure is only
 * printed when they are actually even. An uneven timetable gets "check the timetable"
 * rather than an average no bus keeps.
 */
const REGULAR_TOLERANCE_MIN = 3;

/**
 * Past two hours nobody thinks in headways any more — "every 420 min" is a school run
 * twice a day dressed up as a frequency. Those lines get pointed at their timetable.
 */
const MAX_USEFUL_HEADWAY_MIN = 120;

function measuredHeadway(times: string[]): number | null {
  if (times.length < 3) return null;
  const minutes = times
    .map((t) => {
      const [h, m] = t.split(':').map(Number);
      return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
    })
    .filter((n) => Number.isFinite(n));
  if (minutes.length < 3) return null;

  const gaps = minutes.slice(1).map((m, i) => m - minutes[i]).filter((g) => g > 0);
  if (gaps.length < 2) return null;

  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const even = gaps.every((g) => Math.abs(g - median) <= REGULAR_TOLERANCE_MIN);
  return even && median <= MAX_USEFUL_HEADWAY_MIN ? median : null;
}

export function frequencyLabel(line: BusLine, lang: Lang): string {
  const headways = new Set<number>();
  for (const service of line.services) {
    const declared = service.headwayMinutes;
    if (typeof declared === 'number') {
      headways.add(declared);
      continue;
    }
    const measured = measuredHeadway(service.rows?.[0]?.times ?? []);
    if (measured !== null) headways.add(measured);
  }

  const t = translations(lang).service;
  if (headways.size === 0) return t.checkTimetable;

  const values = [...headways].sort((a, b) => a - b);
  return values.length === 1 ? t.every(values[0]) : t.everyRange(values[0], values[values.length - 1]);
}
