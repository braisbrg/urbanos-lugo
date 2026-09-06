/**
 * Does a speed per line category fit the printed times, when one global speed does not?
 *
 * The residuals of the single-speed fit are not noise: the long rural legs of the 11 run
 * early and the long urban runs to the hospital run late. If that is a real difference in
 * how fast a bus moves on those corridors, a factor per category should collapse it.
 */
import { BUS_LINES, BUS_STOPS } from '../src/data/transitData';
import { buildRuns } from '../src/utils/schedule';

const byId = new Map(BUS_STOPS.map((s) => [s.id, s]));

interface Leg {
  line: string;
  category: string;
  printed: number;
  roadSeconds: number;
  stops: number;
}
const legs: Leg[] = [];

for (const line of BUS_LINES) {
  line.directions.forEach((direction, di) => {
    const run = buildRuns(line, di, BUS_STOPS, 'laborable').find((r) => r.publishedStopIndices.length > 1);
    if (!run) return;
    for (let k = 1; k < run.publishedStopIndices.length; k++) {
      const a = run.publishedStopIndices[k - 1];
      const b = run.publishedStopIndices[k];
      let roadSeconds = 0;
      for (let i = a; i < b; i++) roadSeconds += direction.legSeconds?.[i] ?? 90;
      legs.push({
        line: line.number,
        category: (line as unknown as { category?: string }).category ?? 'urbano',
        printed: run.minutesByStopIndex[b] - run.minutesByStopIndex[a],
        roadSeconds,
        stops: b - a,
      });
    }
  });
}

const categories = [...new Set(legs.map((l) => l.category))];
console.log(`${legs.length} legs across categories: ${categories.join(', ')}`);
for (const c of categories) console.log(`  ${c.padEnd(10)} ${legs.filter((l) => l.category === c).length} legs`);

const report = (label: string, speedOf: (l: Leg) => number, dwell: number) => {
  const errors = legs.map((l) => (l.roadSeconds * speedOf(l) + dwell * l.stops) / 60 - l.printed);
  const within = errors.filter((e) => Math.abs(e) <= 2).length / errors.length;
  const worst = Math.max(...errors.map(Math.abs));
  const sse = errors.reduce((n, e) => n + e * e, 0);
  console.log(`  ${label.padEnd(42)} within 2 min ${(within * 100).toFixed(0).padStart(3)}%   worst ${worst.toFixed(1).padStart(4)} min   sse ${sse.toFixed(0)}`);
  return sse;
};

console.log('');
report('in use: one speed x1.00, dwell 20 s', () => 1, 20);

// Best factor per category, with the dwell searched alongside.
let best = { dwell: 20, byCategory: new Map(categories.map((c) => [c, 1])), sse: Infinity };
for (let dwell = 0; dwell <= 45; dwell += 1) {
  const byCategory = new Map<string, number>();
  for (const c of categories) {
    const subset = legs.filter((l) => l.category === c);
    let bestSpeed = 1;
    let bestSse = Infinity;
    for (let speed = 0.4; speed <= 2.2; speed += 0.01) {
      const sse = subset.reduce((n, l) => {
        const e = (l.roadSeconds * speed + dwell * l.stops) / 60 - l.printed;
        return n + e * e;
      }, 0);
      if (sse < bestSse) {
        bestSse = sse;
        bestSpeed = speed;
      }
    }
    byCategory.set(c, bestSpeed);
  }
  const sse = legs.reduce((n, l) => {
    const e = (l.roadSeconds * byCategory.get(l.category)! + dwell * l.stops) / 60 - l.printed;
    return n + e * e;
  }, 0);
  if (sse < best.sse) best = { dwell, byCategory, sse };
}

console.log('');
console.log(`  best per-category fit: dwell ${best.dwell} s, ${[...best.byCategory].map(([c, s]) => `${c} x${s.toFixed(2)}`).join(', ')}`);
report('per-category speed', (l) => best.byCategory.get(l.category)!, best.dwell);

// How much of the error the operator's own rounding could account for on its own.
const grid = legs.every((l) => l.printed % 5 === 0);
console.log(`\n  every printed value a multiple of 5 minutes: ${grid ? 'yes' : 'no'}`);
console.log(`  so a perfect model still lands up to 2.5 min from the printed figure.`);
