/**
 * Whether this device agrees with Lugo about what time it is. Every hour in the app is
 * `Date.getHours()`, every hour in the timetable is Lugo's; on a device in another zone
 * the whole board is shifted, so the board says so rather than rewriting eight "now"s.
 */
const TIMETABLE_ZONE = 'Europe/Madrid';

/** Lugo's UTC offset in minutes for an instant, or null on an engine without the tz database. */
function timetableOffsetMinutes(at: Date): number | null {
  try {
    const name = new Intl.DateTimeFormat('en', { timeZone: TIMETABLE_ZONE, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
    // "GMT+2", "GMT+05:30", or plain "GMT" at zero.
    const match = name?.match(/GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/);
    if (!match) return null;
    if (!match[1]) return 0;
    const magnitude = Number(match[2]) * 60 + Number(match[3] ?? 0);
    return match[1] === '-' ? -magnitude : magnitude;
  } catch {
    return null;
  }
}

/**
 * Lugo's UTC offset by the rule it keeps: CET, and CEST from the last Sunday of March to
 * the last Sunday of October, changing at 01:00 UTC. A shortcut, never the last word: see
 * below for what happens when a device disagrees with it.
 */
export function lugoOffsetByRule(at: Date): number {
  const year = at.getUTCFullYear();
  const lastSundayAt1 = (month: number): number => {
    const day = new Date(Date.UTC(year, month + 1, 0, 1)); // the month's last day, 01:00 UTC
    day.setUTCDate(day.getUTCDate() - day.getUTCDay());
    return day.getTime();
  };
  const t = at.getTime();
  return t >= lastSundayAt1(2) && t < lastSundayAt1(9) ? 120 : 60;
}

/**
 * Minutes this device runs ahead of Lugo, or 0 when they agree or it cannot be told.
 *
 * A phone in Lugo agrees with the rule, and that needs no time-zone database: building the
 * first Intl formatter with a timeZone loads one, 150 ms of main thread at 6x CPU inside the
 * first render of every board -- the home screen's included. Only a device that disagrees
 * asks Intl. The answer is the one Intl alone gives for as long as the rule is Spain's;
 * tools/test.ts compares the two at every change of the clocks from 2026 to 2032, and fails
 * the day a time-zone database says otherwise.
 */
export function clockDriftFromTimetable(at: Date = new Date()): number {
  const here = -at.getTimezoneOffset();
  if (here === lugoOffsetByRule(at)) return 0;
  const there = timetableOffsetMinutes(at);
  return there === null ? 0 : here - there;
}

/** The device's own zone, for naming it in the warning. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}
