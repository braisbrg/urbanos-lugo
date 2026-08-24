/**
 * How much of what the app shows is the operator's own time, and how wrong the rest
 * could be.
 *
 *   npm run validate:times
 *
 * Departures come from the published table; everything between timing points is
 * stretched onto measured road time. Two things are worth watching. How much of a route
 * sits inside a published bracket, where the error is pinned at both ends — and, for the
 * stretches with nothing to pin them, how far the road model drifts from the printed
 * times we can check it against. The second number is the residual risk of a "~" time.
 */
import { BUS_LINES, BUS_STOPS } from '../src/data/transitData';
import { buildRuns } from '../src/utils/schedule';

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;

const byId = new Map(BUS_STOPS.map((s) => [s.id, s]));

let bracketed = 0;
let extrapolated = 0;
let anchoredDirections = 0;
let directions = 0;

interface Leg {
  line: string;
  from: string;
  to: string;
  published: number;
  modelled: number;
}
const legs: Leg[] = [];

for (const line of BUS_LINES) {
  line.directions.forEach((direction, di) => {
    const runs = buildRuns(line, di, BUS_STOPS, 'laborable');
    if (!runs.length) return;
    directions++;

    // The widest published bracket any run of this direction has.
    const anchors = runs.reduce<number[]>(
      (best, r) => (r.publishedStopIndices.length > best.length ? r.publishedStopIndices : best),
      [],
    );
    if (anchors.length > 1) anchoredDirections++;

    const first = anchors[0] ?? 0;
    const last = anchors[anchors.length - 1] ?? 0;
    direction.stops.forEach((_, i) => {
      if (anchors.length > 1 && i >= first && i <= last) bracketed++;
      else extrapolated++;
    });

    // Road time vs printed time, on the one thing we can check: consecutive anchors.
    const cum = [0];
    for (let i = 0; i < direction.stops.length - 1; i++) {
      cum.push(cum[i] + (direction.legSeconds?.[i] ?? 90) + 20);
    }
    const run = runs.find((r) => r.publishedStopIndices.length > 1);
    if (!run) return;
    for (let k = 1; k < run.publishedStopIndices.length; k++) {
      const a = run.publishedStopIndices[k - 1];
      const b = run.publishedStopIndices[k];
      legs.push({
        line: line.number,
        from: byId.get(direction.stops[a])?.name ?? '?',
        to: byId.get(direction.stops[b])?.name ?? '?',
        published: run.minutesByStopIndex[b] - run.minutesByStopIndex[a],
        modelled: (cum[b] - cum[a]) / 60,
      });
    }
  });
}

console.log(`${anchoredDirections}/${directions} directions run between two or more published timing points`);
console.log(`stops with their time pinned at both ends : ${bracketed}`);
console.log(`stops beyond the last published point     : ${extrapolated}`);

if (!legs.length) {
  console.log('\nno checkable legs.');
} else {
  const errors = legs.map((l) => l.modelled - l.published);
  console.log(`\nroad model vs printed time, on ${legs.length} checkable legs (minutes, + = we run late)`);
  console.log(`  median ${median(errors).toFixed(1)}   mean ${mean(errors).toFixed(1)}   worst fast ${Math.min(...errors).toFixed(1)}   worst slow ${Math.max(...errors).toFixed(1)}`);
  console.log(`  within 2 min: ${Math.round((errors.filter((e) => Math.abs(e) <= 2).length / errors.length) * 100)}%`);
  console.log('');
  console.log('  line   printed  modelled   diff   from -> to');
  for (const l of [...legs].sort((x, y) => x.modelled - x.published - (y.modelled - y.published))) {
    console.log(
      `  ${l.line.padEnd(5)}  ${l.published.toFixed(0).padStart(7)}  ${l.modelled.toFixed(1).padStart(8)}  ${(l.modelled - l.published).toFixed(1).padStart(6)}   ${l.from} -> ${l.to}`,
    );
  }
}
