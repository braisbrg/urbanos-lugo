/**
 * Do the journeys the planner offers hold together?
 *
 *   pnpm exec tsx tools/stressPlanner.ts
 *
 * The board sweep asks whether a departure can be true. This asks the same of a whole
 * journey: a plan that arrives before it leaves, or rides a line that does not stop where
 * it boards, would look perfectly ordinary on screen. Hundreds of pairs across the
 * network, at times spread through the service day.
 *
 * Only internal consistency is checked. Two judgements about the service were removed
 * because each run needed a new exception: a plan for tomorrow morning is a rollover, not
 * a fault, and a 3 h 36 best journey is the timetable's answer where a line does not call
 * until 10:00.
 */
import { BUS_STOPS } from '../src/data/transitData';
import { planTrips } from '../src/utils/planner';
import { dayKind, lineRunsOn } from '../src/utils/schedule';
import { violations } from './lib';

const { fail, report } = violations('every journey held together', 'inconsistent journey');
const CLOCK = /^\d{1,2}:\d{2}$/;
const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
/** Minutes from `a` to `b` on a clock: more than twelve hours means `b` came first. */
const minutesAfter = (a: number, b: number) => (b - a + 24 * 60) % (24 * 60);

const HOURS = [7, 9, 12, 15, 18, 21, 23];
// A Wednesday with the full spread, and a Saturday and a Sunday with a third of it: the
// weekend is where lines stop running, and a plan that rides one of them is wrong in a
// way no weekday sweep can see.
const DAYS: [Date, number][] = [
  [new Date(2026, 7, 19), 90],
  [new Date(2026, 7, 22), 30],
  [new Date(2026, 7, 23), 30],
];
let planned = 0;
let offered = 0;

for (const [day, pairs] of DAYS) {
  for (const hour of HOURS) {
    const at = new Date(day);
    at.setHours(hour, 20, 0, 0);
    const kind = dayKind(at);
    for (let i = 0; i < pairs; i++) {
      // A spread of pairs rather than neighbours: prime strides walk the whole list.
      const from = BUS_STOPS[(i * 53 + hour * 7) % BUS_STOPS.length];
      const to = BUS_STOPS[(i * 131 + hour * 11 + 17) % BUS_STOPS.length];
      if (from.id === to.id) continue;
      planned++;
      const where = `${from.name} -> ${to.name} at ${hour}:20 (${kind})`;

      for (const plan of planTrips(from.name, to.name, { now: at })) {
        offered++;
        for (const field of ['departureTime', 'arrivalTime'] as const) {
          if (!CLOCK.test(plan[field])) fail(`a plan's ${field} is not a clock time`, `${where}: "${plan[field]}"`);
        }
        if (plan.durationMinutes <= 0 || !Number.isFinite(plan.durationMinutes)) fail('a plan takes zero or nonsense time', `${where}: ${plan.durationMinutes}`);
        // The clock and the stated duration must agree with each other.
        const crossed = minutesAfter(toMinutes(plan.departureTime), toMinutes(plan.arrivalTime));
        if (Math.abs(crossed - plan.durationMinutes) > 1) fail('a plan’s stated duration disagrees with its own clock times', `${where}: ${plan.departureTime} -> ${plan.arrivalTime} called ${plan.durationMinutes} min`);
        if (plan.walkToStartMeters < 0 || plan.walkFromEndMeters < 0) fail('a plan has a negative walk', where);
        if (plan.totalWaitMinutes < 0) fail('a plan has a negative wait', where);
        if (!plan.segments.length) fail('a plan has no segments at all', where);

        let busLegs = 0;
        let lastArrival: number | null = null;
        for (const seg of plan.segments) {
          if (!['walk', 'wait', 'bus'].includes(seg.type)) fail('a segment has an unknown type', `${where}: ${seg.type}`);
          if (seg.durationMinutes < 0) fail('a segment lasts a negative time', where);
          if (!seg.instruction) fail('a segment has no instruction to read', `${where}: ${seg.type}`);
          if (seg.type === 'walk' && (seg.walkMeters ?? 0) < 0) fail('a walk segment is negative', where);
          if (seg.type !== 'bus') continue;
          busLegs++;
          if (!seg.line) fail('a bus segment rides no line', where);
          if (!seg.fromStop || !seg.toStop) fail('a bus segment has no boarding or alighting stop', where);
          if (seg.fromStop && seg.toStop && seg.fromStop.id === seg.toStop.id) fail('a bus segment boards and alights at the same stop', `${where}: ${seg.fromStop.name}`);
          // The one that would be invisible on screen.
          if (seg.line && seg.fromStop && !seg.fromStop.lines.includes(seg.line.id)) fail('a bus segment boards a line that does not call at that stop', `${where}: ${seg.line.id} at ${seg.fromStop.name}`);
          if (seg.line && seg.toStop && !seg.toStop.lines.includes(seg.line.id)) fail('a bus segment alights from a line that does not call at that stop', `${where}: ${seg.line.id} at ${seg.toStop.name}`);
          // The direction the leg names has to visit the boarding stop before the alighting
          // stop: a leg riding the itinerary backwards reads perfectly well on screen.
          const direction = seg.line?.directions.find((d) => d.id === seg.directionId);
          if (seg.line && !direction) fail('a bus segment names a direction its line does not have', `${where}: ${seg.line.id}/${seg.directionId}`);
          if (direction && seg.fromStop && seg.toStop) {
            const fromIndex = direction.stops.indexOf(seg.fromStop.id);
            const toIndex = direction.stops.indexOf(seg.toStop.id);
            if (fromIndex === -1 || toIndex === -1) fail('a bus segment boards or alights at a stop its direction does not visit', `${where}: ${seg.line?.id}/${seg.directionId} ${seg.fromStop.name} -> ${seg.toStop.name}`);
            else if (fromIndex >= toIndex) fail('a bus segment rides its direction backwards', `${where}: ${seg.line?.id}/${seg.directionId} ${seg.fromStop.name} (${fromIndex}) -> ${seg.toStop.name} (${toIndex})`);
            else if (seg.stopsCount !== undefined && seg.stopsCount !== toIndex - fromIndex) fail('a bus segment counts a different number of stops than its direction has between them', `${where}: says ${seg.stopsCount}, direction has ${toIndex - fromIndex}`);
          }
          // A line that does not run today may still be offered (tomorrow's first buses for
          // a reader asking late) but never as a live plan: marked inactive, and saying why.
          if (seg.line && !lineRunsOn(seg.line, kind) && (plan.isServiceActive || !plan.serviceNotice)) {
            fail('a plan rides a line that does not run today and does not say so', `${where}: ${seg.line.id}, active ${plan.isServiceActive}, notice "${plan.serviceNotice ?? ''}"`);
          }
          // Every time says where it came from; an unlabelled time is a bug.
          if (seg.precision !== 'published' && seg.precision !== 'estimated') fail('a bus segment has no provenance on its boarding time', `${where}: ${seg.line?.id} "${seg.precision}"`);
          if (seg.arrivalPrecision !== 'published' && seg.arrivalPrecision !== 'estimated') fail('a bus segment has no provenance on its alighting time', `${where}: ${seg.line?.id} "${seg.arrivalPrecision}"`);
          // And the legs chain: nobody boards the next bus before leaving the last one.
          if (seg.departureTime && seg.arrivalTime) {
            const dep = toMinutes(seg.departureTime);
            const arr = toMinutes(seg.arrivalTime);
            if (lastArrival !== null && minutesAfter(lastArrival, dep) > 12 * 60) fail('a bus segment departs before the previous one arrived', `${where}: boards ${seg.departureTime}, previous leg arrived ${lastArrival}`);
            if (minutesAfter(dep, arr) > 12 * 60) fail('a bus segment arrives before it departs', `${where}: ${seg.departureTime} -> ${seg.arrivalTime}`);
            lastArrival = arr;
          }
        }

        if (plan.fare) {
          if (plan.fare.busLegs !== busLegs) fail('the fare counts a different number of bus legs than the plan has', `${where}: fare ${plan.fare.busLegs}, plan ${busLegs}`);
          if (plan.fare.singleTicketEuros < 0 || plan.fare.citizenCardEuros < 0) fail('a fare is negative', where);
          if (busLegs > 0 && plan.fare.singleTicketEuros === 0) fail('a journey with a bus leg costs nothing', where);
        }
      }
    }
  }
}

console.log(`\n${planned.toLocaleString('en')} pairs planned, ${offered.toLocaleString('en')} journeys offered`);
report();
