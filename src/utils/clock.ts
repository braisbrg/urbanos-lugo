/**
 * Whether this device agrees with Lugo about what time it is.
 *
 * Every hour in the app comes from `Date.getHours()`, which is the device's local time,
 * and every hour in the timetable is Lugo's. For somebody standing at a pole those are
 * the same number and there is nothing to say. For a device on another timezone — a
 * phone that has not switched yet, a desktop with the wrong region — the whole board is
 * shifted by the difference and nothing on screen admits it.
 *
 * Rewriting eight "now" derivations to read a fixed zone would be the thorough fix, and
 * it would put the risk on the one thing this app must not get wrong. Saying so costs a
 * sentence, and the app already refuses to present a time as something it is not.
 */
const TIMETABLE_ZONE = 'Europe/Madrid';

/** Lugo's UTC offset in minutes for a given instant, summer time included. */
function timetableOffsetMinutes(at: Date): number | null {
  try {
    const name = new Intl.DateTimeFormat('en', {
      timeZone: TIMETABLE_ZONE,
      timeZoneName: 'longOffset',
    })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
    // "GMT+2", "GMT+05:30", or plain "GMT" at zero.
    const match = name?.match(/GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/);
    if (!match) return null;
    if (!match[1]) return 0;
    const magnitude = Number(match[2]) * 60 + Number(match[3] ?? 0);
    return match[1] === '-' ? -magnitude : magnitude;
  } catch {
    // An engine without the full tz database. Better to say nothing than to guess.
    return null;
  }
}

/**
 * How far this device's clock is from Lugo's, in minutes, or 0 when they agree.
 *
 * Positive means the device runs ahead of Lugo. Returns 0 rather than null when the
 * comparison cannot be made, because an unverifiable warning is worse than none.
 */
export function clockDriftFromTimetable(at: Date = new Date()): number {
  const there = timetableOffsetMinutes(at);
  if (there === null) return 0;
  return -at.getTimezoneOffset() - there;
}

/** The device's own zone, for naming it in the warning. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}
