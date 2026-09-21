/**
 * What the computing costs when nobody is being gentle.
 *
 *   pnpm exec tsx tools/stressEngine.ts
 *
 * Reports the worst case, not the average: an average hides the one pair of stops across
 * the city that takes ten times the rest, and that pair is what somebody will type. Two
 * paths have numbers riding on them: the rate limiter was written around "a plan costs
 * about 24 ms", and the stop board recomputes every 15 seconds for as long as it is open.
 */
import { BUS_STOPS } from '../src/data/transitData';
import { getArrivalsForStop } from '../src/utils/arrivals';
import { findStop } from '../src/utils/places';
import { planTrips } from '../src/utils/planner';
import { calculateRelevanceScore, matchesQuery, MAX_QUERY_LENGTH } from '../src/utils/searchUtils';
import { mean, percentile, timed } from './lib';

const AT = new Date(2026, 7, 19, 13, 30, 0); // a Wednesday lunchtime, as the suite uses

function report(label: string, times: number[], budget?: number) {
  const worst = percentile(times, 100);
  const flag = budget !== undefined && worst > budget ? `   <-- over ${budget} ms` : '';
  console.log(`  ${label.padEnd(44)} n=${String(times.length).padStart(5)}  median ${percentile(times, 50).toFixed(1).padStart(7)} ms  p95 ${percentile(times, 95).toFixed(1).padStart(7)} ms  worst ${worst.toFixed(1).padStart(8)} ms${flag}`);
}

const plan = (from: { name: string }, to: { name: string }) => timed(() => planTrips(from.name, to.name, { now: AT }));

console.log('\nthe stop board, every stop in the network');
report('getArrivalsForStop', BUS_STOPS.map((s) => timed(() => getArrivalsForStop(s.id, AT))));

// A board left open recomputes every 15 s; this is looking for growth, not for speed.
console.log('\nthe same board, 500 times over, looking for drift');
const busiest = BUS_STOPS.reduce((a, b) => (b.lines.length > a.lines.length ? b : a));
const repeated = Array.from({ length: 500 }, () => timed(() => getArrivalsForStop(busiest.id, AT)));
report(`${busiest.name} (${busiest.lines.length} lines)`, repeated);
const firstTen = mean(repeated.slice(0, 10));
const lastTen = mean(repeated.slice(-10));
console.log(`  first ten passes ${firstTen.toFixed(2)} ms, last ten ${lastTen.toFixed(2)} ms -> ${lastTen > firstTen * 2 ? 'GROWING' : 'flat'}`);

console.log('\nthe planner, across the city and back');
// The farthest pairs, opposite ends of the network, then a spread of ordinary ones so the
// worst case has something to be worse than.
const byLat = [...BUS_STOPS].sort((a, b) => a.lat - b.lat);
const byLng = [...BUS_STOPS].sort((a, b) => a.lng - b.lng);
const extremes = [byLat[0], byLat[byLat.length - 1], byLng[0], byLng[byLng.length - 1]];
const plans: number[] = [];
for (const from of extremes) for (const to of extremes) if (from.id !== to.id) plans.push(plan(from, to));
for (let i = 0; i < 60; i++) {
  const from = BUS_STOPS[(i * 37) % BUS_STOPS.length];
  const to = BUS_STOPS[(i * 91 + 13) % BUS_STOPS.length];
  if (from.id !== to.id) plans.push(plan(from, to));
}
// 24 ms is the figure the rate limiter's comment is built on.
report('planTrips', plans, 24);

console.log('\nsearch, with the input a form would actually allow');
const hostile: [string, string][] = [
  ['a single letter', 'a'],
  ['the cap, all one letter', 'a'.repeat(MAX_QUERY_LENGTH)],
  ['the cap, regex metacharacters', '('.repeat(MAX_QUERY_LENGTH)],
  ['the cap, combining accents', 'á'.repeat(MAX_QUERY_LENGTH / 2)],
  ['the cap, spaces', ' '.repeat(MAX_QUERY_LENGTH)],
  ['a real street', 'Ronda da Muralla'],
];
for (const [label, query] of hostile) {
  const total = BUS_STOPS.slice(0, 200).reduce(
    (sum, s) =>
      sum +
      timed(() => {
        matchesQuery(s.name, query);
        calculateRelevanceScore(s.name, s.code, s.id, query, s.zone);
      }),
    0,
  );
  console.log(`  ${label.padEnd(32)} 200 stops in ${total.toFixed(1)} ms`);
}

console.log('\nresolving a stop code, including nonsense');
for (const [label, q] of [
  ['a real code', 'uilP'],
  ['a real numeric id', '101'],
  ['nonsense', 'x'.repeat(MAX_QUERY_LENGTH)],
  ['empty', ''],
] as [string, string][]) {
  report(`findStop, ${label}`, Array.from({ length: 200 }, () => timed(() => findStop(q))));
}

console.log('');
