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
import { violations } from './lib';

const { fail, report } = violations('every journey held together', 'inconsistent journey');
const CLOCK = /^\d{1,2}:\d{2}$/;
const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const HOURS = [7, 9, 12, 15, 18, 21, 23];
let planned = 0;
let offered = 0;

for (const hour of HOURS) {
  const at = new Date(2026, 7, 19, hour, 20, 0);
  for (let i = 0; i < 90; i++) {
    // A spread of pairs rather than neighbours: prime strides walk the whole list.
    const from = BUS_STOPS[(i * 53 + hour * 7) % BUS_STOPS.length];
    const to = BUS_STOPS[(i * 131 + hour * 11 + 17) % BUS_STOPS.length];
    if (from.id === to.id) continue;
    planned++;
    const where = `${from.name} -> ${to.name} at ${hour}:20`;

    for (const plan of planTrips(from.name, to.name, { now: at })) {
      offered++;
      for (const field of ['departureTime', 'arrivalTime'] as const) {
        if (!CLOCK.test(plan[field])) fail(`a plan's ${field} is not a clock time`, `${where}: "${plan[field]}"`);
      }
      if (plan.durationMinutes <= 0 || !Number.isFinite(plan.durationMinutes)) fail('a plan takes zero or nonsense time', `${where}: ${plan.durationMinutes}`);
      // The clock and the stated duration must agree with each other.
      const span = toMinutes(plan.arrivalTime) - toMinutes(plan.departureTime);
      const crossed = span < 0 ? span + 24 * 60 : span;
      if (Math.abs(crossed - plan.durationMinutes) > 1) fail('a plan’s stated duration disagrees with its own clock times', `${where}: ${plan.departureTime} -> ${plan.arrivalTime} called ${plan.durationMinutes} min`);
      if (plan.walkToStartMeters < 0 || plan.walkFromEndMeters < 0) fail('a plan has a negative walk', where);
      if (plan.totalWaitMinutes < 0) fail('a plan has a negative wait', where);
      if (!plan.segments.length) fail('a plan has no segments at all', where);

      let busLegs = 0;
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
      }

      if (plan.fare) {
        if (plan.fare.busLegs !== busLegs) fail('the fare counts a different number of bus legs than the plan has', `${where}: fare ${plan.fare.busLegs}, plan ${busLegs}`);
        if (plan.fare.singleTicketEuros < 0 || plan.fare.citizenCardEuros < 0) fail('a fare is negative', where);
        if (busLegs > 0 && plan.fare.singleTicketEuros === 0) fail('a journey with a bus leg costs nothing', where);
      }
    }
  }
}

console.log(`\n${planned.toLocaleString('en')} pairs planned, ${offered.toLocaleString('en')} journeys offered`);
report();
