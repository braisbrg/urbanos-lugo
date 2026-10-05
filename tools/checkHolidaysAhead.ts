/**
 * The holidays file runs out on 1 January, and the suite fails that morning on purpose: a
 * holiday the file does not list runs the weekday timetable, labelled official. Failing then
 * also stops the hourly Pages build, which tests before it builds. So from November this
 * says so every Monday, in the weekly job, while there is time to read the DOG: the Galician
 * decree comes out in June or July, Lugo's two local days in a resolution in late October.
 * It reads the file only.
 *
 *   pnpm exec tsx tools/checkHolidaysAhead.ts
 */
import { pathToFileURL } from 'node:url';
import festivos from '../src/data/festivos.json';

/** From November, next year's entry if the file lacks it; otherwise nothing is due. */
export function holidaysDue(years: string[], now: Date): string | null {
  const next = String(now.getFullYear() + 1);
  if (now.getMonth() < 10 || years.includes(next)) return null;
  return (
    `src/data/festivos.json has no ${next}, and the suite fails on 1 January without it. Add its ` +
    `days with both DOG sources, as the ${now.getFullYear()} entry has them: the Xunta's calendar ` +
    `decree, and the resolution of local holidays with Lugo's two. If the resolution is not out ` +
    `yet, this stays red until it is.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const years = Object.keys(festivos);
  const due = holidaysDue(years, new Date());
  console.log(due ?? `festivos.json covers ${years.join(', ')}; nothing due yet.`);
  if (due) process.exit(1);
}
