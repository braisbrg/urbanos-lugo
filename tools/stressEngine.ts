/**
 * What the computing costs when nobody is being gentle.
 *
 *   pnpm exec tsx tools/stressEngine.ts
 *
 * Everything this app answers is computed from bundled data, in the browser on a phone and
 * on the server for the public API. None of it has ever been measured outside the happy
 * path, and two of the paths have numbers riding on them: the rate limiter was written
 * around "a plan costs about 24 ms", and the stop board recomputes every 15 seconds for as
 * long as somebody leaves it open.
 *
 * This reports the worst case, not the average. An average hides the one pair of stops
 * across the city that takes ten times the rest, and that pair is what somebody will type.
 */
import { BUS_STOPS } from '../src/data/transitData';
import { planTrips, getArrivalsForStop, findStop } from '../src/utils/transitEngine';
import { matchesQuery, calculateRelevanceScore, MAX_QUERY_LENGTH } from '../src/utils/searchUtils';

const AT = new Date(2026, 7, 19, 13, 30, 0); // a Wednesday lunchtime, as the suite uses

const ms = (run: () => unknown): number => {
  const started = process.hrtime.bigint();
  run();
  return Number(process.hrtime.bigint() - started) / 1e6;
};

function report(label: string, times: number[], budget?: number) {
  const sorted = [...times].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const worst = sorted[sorted.length - 1];
  const flag = budget !== undefined && worst > budget ? `   <-- over ${budget} ms` : '';
  console.log(
    `  ${label.padEnd(44)} n=${String(times.length).padStart(5)}  ` +
      `median ${p(0.5).toFixed(1).padStart(7)} ms  p95 ${p(0.95).toFixed(1).padStart(7)} ms  ` +
      `worst ${worst.toFixed(1).padStart(8)} ms${flag}`,
  );
  return worst;
}

console.log('\nthe stop board, every stop in the network');
const boards = BUS_STOPS.map((s) => ms(() => getArrivalsForStop(s.id, AT)));
report('getArrivalsForStop', boards);

// A board left open recomputes every 15 s. An hour is 240 passes; a phone left on the
// stop all afternoon is more. This is looking for growth, not for speed.
console.log('\nthe same board, 500 times over, looking for drift');
const busiest = BUS_STOPS.reduce((a, b) => (b.lines.length > a.lines.length ? b : a));
const repeated: number[] = [];
for (let i = 0; i < 500; i++) repeated.push(ms(() => getArrivalsForStop(busiest.id, AT)));
report(`${busiest.name} (${busiest.lines.length} lines)`, repeated);
const firstTen = repeated.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
const lastTen = repeated.slice(-10).reduce((a, b) => a + b, 0) / 10;
console.log(
  `  first ten passes ${firstTen.toFixed(2)} ms, last ten ${lastTen.toFixed(2)} ms ` +
    `-> ${lastTen > firstTen * 2 ? 'GROWING' : 'flat'}`,
);

console.log('\nthe planner, across the city and back');
// The farthest pairs, which is what a worst case means here: opposite ends of the network.
const byLat = [...BUS_STOPS].sort((a, b) => a.lat - b.lat);
const byLng = [...BUS_STOPS].sort((a, b) => a.lng - b.lng);
const extremes = [byLat[0], byLat[byLat.length - 1], byLng[0], byLng[byLng.length - 1]];
const plans: number[] = [];
for (const from of extremes) {
  for (const to of extremes) {
    if (from.id === to.id) continue;
    plans.push(ms(() => planTrips(from.name, to.name, { now: AT })));
  }
}
// And a spread of ordinary pairs, so the worst case has something to be worse than.
for (let i = 0; i < 60; i++) {
  const from = BUS_STOPS[(i * 37) % BUS_STOPS.length];
  const to = BUS_STOPS[(i * 91 + 13) % BUS_STOPS.length];
  if (from.id !== to.id) plans.push(ms(() => planTrips(from.name, to.name, { now: AT })));
}
// 24 ms is the figure the rate limiter's comment is built on. Worth knowing if it holds.
report('planTrips', plans, 24);

console.log('\nsearch, with the input a form would actually allow');
const hostile: [string, string][] = [
  ['a single letter', 'a'],
  ['the cap, all one letter', 'a'.repeat(MAX_QUERY_LENGTH)],
  ['the cap, regex metacharacters', '('.repeat(MAX_QUERY_LENGTH)],
  ['the cap, combining accents', 'á'.repeat(MAX_QUERY_LENGTH / 2)],
  ['the cap, spaces', ' '.repeat(MAX_QUERY_LENGTH)],
  ['a real street', 'Ronda da Muralla'],
];
for (const [label, query] of hostile) {
  const times = BUS_STOPS.slice(0, 200).map((s) =>
    ms(() => {
      matchesQuery(s.name, query);
      calculateRelevanceScore(s.name, s.code, s.id, query, s.zone);
    }),
  );
  const total = times.reduce((a, b) => a + b, 0);
  console.log(`  ${label.padEnd(32)} 200 stops in ${total.toFixed(1)} ms`);
}

console.log('\nresolving a stop code, including nonsense');
for (const [label, q] of [
  ['a real code', 'uilP'],
  ['a real numeric id', '101'],
  ['nonsense', 'x'.repeat(MAX_QUERY_LENGTH)],
  ['empty', ''],
] as [string, string][]) {
  const times = Array.from({ length: 200 }, () => ms(() => findStop(q)));
  report(`findStop, ${label}`, times);
}

console.log('');
