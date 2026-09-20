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

/** Minutes this device runs ahead of Lugo, or 0 when they agree or it cannot be told. */
export function clockDriftFromTimetable(at: Date = new Date()): number {
  const there = timetableOffsetMinutes(at);
  return there === null ? 0 : -at.getTimezoneOffset() - there;
}

/** The device's own zone, for naming it in the warning. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}
