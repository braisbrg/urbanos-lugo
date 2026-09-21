/**
 * Sweep the whole network across the whole day, looking for answers that cannot be true.
 *
 *   pnpm exec tsx tools/stressInvariants.ts
 *
 * The other stress tools ask how long things take. This one asks whether what comes back
 * makes sense, which is the failure this app cares about more: a board that is fast and
 * wrong sends somebody to a pole for a bus that is not coming.
 *
 * Every stop, every ten minutes, on each kind of day. That is roughly 180,000 boards, and
 * the point is the edges -- first departure, last departure, the rollover past midnight,
 * and the five-minute window where a departure is overdue but still listed.
 */
import { BUS_STOPS, BUS_LINES } from '../src/data/transitData';
import { getArrivalsForStop } from '../src/utils/arrivals';
import { scheduledDuration } from '../src/utils/schedule';

const violations: string[] = [];
const seen = new Set<string>();

/** One line per kind of problem, however many times it happens. */
function fail(kind: string, detail: string) {
  if (seen.has(kind)) return;
  seen.add(kind);
  violations.push(`  ${kind}\n      first seen: ${detail}`);
}

const lineIds = new Set(BUS_LINES.map((l) => l.id));
const lineNumbers = new Set(BUS_LINES.map((l) => l.number));

// A Wednesday, a Saturday and a Sunday in the same week, so every service kind is covered,
// and a public holiday on a Monday, which runs as a Sunday and used to run as a Monday.
const DAYS: [string, Date][] = [
  ['weekday', new Date(2026, 7, 19)],
  ['saturday', new Date(2026, 7, 22)],
  ['sunday', new Date(2026, 7, 23)],
  ['holiday', new Date(2026, 9, 12)],
];

let boards = 0;
let rows = 0;

for (const [dayName, day] of DAYS) {
  for (let minute = 0; minute < 24 * 60; minute += 10) {
    const at = new Date(day);
    at.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
    const clock = `${dayName} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;

    for (const stop of BUS_STOPS) {
      const { arrivals } = getArrivalsForStop(stop.id, at);
      boards++;
      let previous = -Infinity;

      for (const a of arrivals) {
        rows++;
        const where = `${stop.name} ${a.lineNumber} at ${clock}`;

        if (!Number.isFinite(a.etaMinutes) || a.etaMinutes < 0) {
          fail('a departure is a negative or non-finite number of minutes away', `${where}: ${a.etaMinutes}`);
        }
        // The board looks two hours ahead and keeps five minutes of overdue behind it.
        if (a.etaMinutes > 120) {
          fail('a departure is past the board’s own horizon', `${where}: ${a.etaMinutes} min`);
        }
        if (a.overdueMinutes !== undefined && (a.overdueMinutes <= 0 || a.overdueMinutes > 5)) {
          fail('an overdue departure is outside the five-minute window', `${where}: ${a.overdueMinutes} min`);
        }
        if (a.overdueMinutes !== undefined && a.etaMinutes !== 0) {
          fail('an overdue departure is not sitting at zero minutes', `${where}: eta ${a.etaMinutes}`);
        }
        if (!lineIds.has(a.lineId)) fail('a board names a line id that is not in the dataset', where);
        if (!lineNumbers.has(a.lineNumber)) fail('a board names a line number that is not in the dataset', where);
        if (!a.destination) fail('a departure has no destination', where);
        if (!/^\d{1,2}:\d{2}$/.test(a.etaTime)) fail('a departure time is not a clock time', `${where}: "${a.etaTime}"`);
        if (a.precision !== 'published' && a.precision !== 'estimated') {
          fail('a departure has no provenance', `${where}: "${a.precision}"`);
        }
        // The list is sorted, and a reader takes that for granted.
        if (a.etaMinutes < previous) fail('the board is out of order', `${where}: ${a.etaMinutes} after ${previous}`);
        previous = a.etaMinutes;
      }

      // The stop only ever lists lines that call there.
      for (const a of arrivals) {
        if (!stop.lines.includes(a.lineId)) {
          fail('a stop lists a line its own record says does not call there', `${stop.name} ${a.lineId}`);
        }
      }
    }
  }
}

console.log(`\n${boards.toLocaleString('en')} boards, ${rows.toLocaleString('en')} departures examined`);

/*
 * The edges of the window, at the exact minute.
 *
 * A ten-minute grid samples the overdue window statistically -- thousands of overdue rows
 * at every offset from one to five -- and would catch a row that lingers past five. What
 * it cannot catch is a departure dropped early: if the board let go at three minutes,
 * every overdue value the grid ever saw would still be between one and five. So the
 * contract is probed where it turns: a departure due at m is on the board at m with no
 * overdue, still there at m+4 marked overdue, gone by m+7, and not yet there at m-122.
 * Four rather than five and seven rather than six, because an interpolated time can sit
 * half a minute either side of the whole minute the board prints.
 */
const same = (a: { lineId: string; destination: string; etaTime: string }, b: typeof a) =>
  a.lineId === b.lineId && a.destination === b.destination && a.etaTime === b.etaTime;
let probed = 0;
for (const [dayName, day] of DAYS) {
  for (const hour of [8, 13, 19]) {
    const anchor = new Date(day);
    anchor.setHours(hour, 0, 0, 0);
    for (const stop of BUS_STOPS) {
      for (const row of getArrivalsForStop(stop.id, anchor).arrivals.slice(0, 3)) {
        if (row.overdueMinutes !== undefined || row.etaMinutes === 0) continue;
        const due = new Date(anchor.getTime() + row.etaMinutes * 60_000);
        const at = (offset: number) => getArrivalsForStop(stop.id, new Date(due.getTime() + offset * 60_000)).arrivals;
        const where = `${stop.name} ${row.lineNumber} -> ${row.destination} due ${row.etaTime} (${dayName})`;
        probed++;
        const onTime = at(0).find((a) => same(a, row));
        if (!onTime) fail('a departure is missing from the board at the minute it is due', where);
        else if (onTime.etaMinutes !== 0 || onTime.overdueMinutes !== undefined) {
          fail('a departure at its own minute is not shown as "now"', `${where}: eta ${onTime.etaMinutes}, overdue ${onTime.overdueMinutes}`);
        }
        const late = at(4).find((a) => same(a, row));
        if (!late) fail('a departure four minutes overdue has already been dropped', where);
        else if (late.overdueMinutes === undefined || late.overdueMinutes < 3 || late.overdueMinutes > 5) {
          fail('a departure four minutes overdue is not marked as such', `${where}: overdue ${late.overdueMinutes}`);
        }
        if (at(7).some((a) => same(a, row))) fail('a departure seven minutes overdue is still on the board', where);
        if (at(-122).some((a) => same(a, row))) fail('a departure is on the board before the two-hour horizon', where);
      }
    }
  }
}
console.log(`${probed.toLocaleString('en')} departures probed at the edges of the window`);

// And the line pages, which read the same timetable a different way.
for (const line of BUS_LINES) {
  for (const [i, direction] of line.directions.entries()) {
    const minutes = scheduledDuration(line, i, BUS_STOPS);
    if (minutes === undefined) fail('a direction has no buildable run', `${line.id}/${i}`);
    else if (minutes <= 0 || minutes > 180) fail('a direction takes an impossible time', `${line.id}/${i}: ${minutes} min`);
    if (direction.stops.length < 2) fail('a direction has fewer than two stops', `${line.id}/${i}`);
    if (direction.legSeconds.length !== direction.stops.length - 1) {
      fail('a direction has the wrong number of legs',
        `${line.id}/${i}: ${direction.legSeconds.length} legs for ${direction.stops.length} stops`);
    }
    if (new Set(direction.stops).size !== direction.stops.length) {
      fail('a direction visits the same stop twice in one run', `${line.id}/${i}`);
    }
  }
}

if (violations.length === 0) {
  console.log('every answer held up\n');
} else {
  console.log(`\n${violations.length} kind(s) of impossible answer:\n`);
  violations.forEach((v) => console.log(v));
  console.log('');
  process.exitCode = 1;
}
