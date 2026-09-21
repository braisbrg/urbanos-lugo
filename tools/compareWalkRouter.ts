/**
 * Is our walking router right, or only fast?
 *
 * `src/utils/walkRouter.ts` replaced a request to OSM's own foot router, and replacing
 * something is a claim that the answers are as good. Sampled pairs of real endpoints are
 * routed here and at routing.openstreetmap.de, and the difference reported as a
 * distribution: some disagreement is expected (different profiles, different foot speed),
 * a long tail is what a wrong turn or a missing connection looks like.
 *
 * Not in CI and not on a schedule: it hits somebody else's free server at their stated
 * one request a second, by hand, when the router or the network changes, and cached:
 *   pnpm run compare:walk
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BUS_STOPS } from '../src/data/transitData';
import { metresBetween } from '../src/utils/geo';
import { LUGO_LANDMARKS } from '../src/utils/places';
import { routeOnFoot } from '../src/utils/walkRouter';
import { percentile, readJson, sleep } from './lib';

const FOOT_ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
const CACHE = '.cache/walk-comparison.json';
/** Their stated limit, and the only rate this may ever run at. */
const MIN_GAP_MS = 1100;
const PAIRS = 40;

interface Theirs {
  meters: number;
  minutes: number;
}
type Point = [number, number];

const cache: Record<string, Theirs | null> = existsSync(CACHE) ? readJson(CACHE) : {};
const keyOf = (from: Point, to: Point) => `${from[0].toFixed(5)},${from[1].toFixed(5)}>${to[0].toFixed(5)},${to[1].toFixed(5)}`;
let lastCall = 0;

async function theirRoute(key: string, from: Point, to: Point): Promise<Theirs | null> {
  const wait = MIN_GAP_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  try {
    const res = await fetch(`${FOOT_ROUTER}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=false`, {
      headers: { 'User-Agent': 'UrbanosLugoOpenData/1.0 (walk router comparison, run by hand)' },
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    if (json.code !== 'Ok' || !json.routes?.length) throw new Error(json.code ?? 'no route');
    const route = json.routes[0];
    return { meters: Math.round(route.distance), minutes: Math.round(route.duration / 60) };
  } catch (error) {
    console.warn(`  ! ${key}: ${(error as Error).message}`);
    return null;
  }
}

// Deterministic sample, so two runs compare the same walks.
let seed = 20260908;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)];

const points: { name: string; at: Point }[] = [...BUS_STOPS, ...LUGO_LANDMARKS].map((p) => ({ name: p.name, at: [p.lat, p.lng] }));

async function main() {
  mkdirSync(dirname(CACHE), { recursive: true });
  console.log(`Comparing ${PAIRS} walks against ${FOOT_ROUTER}.\n`);

  const rows: { name: string; ours: number; theirs: number; oursMin: number; theirsMin: number }[] = [];
  let noRouteHere = 0;
  let noRouteThere = 0;
  let asked = 0;

  for (let i = 0; rows.length + noRouteHere + noRouteThere < PAIRS && i < PAIRS * 4; i++) {
    const a = pick(points);
    const b = pick(points);
    const straight = metresBetween(a.at[0], a.at[1], b.at[0], b.at[1]);
    // Under 300 m the two routers mostly agree by accident; over 6 km nobody walks it.
    if (straight < 300 || straight > 6000) continue;

    const ours = await routeOnFoot(a.at, b.at);
    if (!ours) {
      noRouteHere++;
      console.log(`  -  no route here: ${a.name} -> ${b.name}`);
      continue;
    }
    const key = keyOf(a.at, b.at);
    if (!(key in cache)) {
      asked++;
      cache[key] = await theirRoute(key, a.at, b.at);
    }
    const theirs = cache[key];
    if (!theirs) {
      noRouteThere++;
      continue;
    }
    rows.push({ name: `${a.name} -> ${b.name}`, ours: ours.meters, theirs: theirs.meters, oursMin: ours.minutes, theirsMin: theirs.minutes });
    process.stdout.write('.');
  }

  writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`\n\n${rows.length} walks compared. ${asked} asked of the router, the rest read from ${CACHE}.`);
  if (noRouteHere) console.log(`${noRouteHere} had no route here; ${noRouteThere} had none there.`);
  if (!rows.length) return;

  const pct = rows.map((r) => ((r.ours - r.theirs) / r.theirs) * 100);
  console.log('\ndistance, ours against theirs:');
  console.log(`  median  ${percentile(pct, 50).toFixed(1)}%`);
  console.log(`  p10 ${percentile(pct, 10).toFixed(1)}%   p90 ${percentile(pct, 90).toFixed(1)}%`);
  console.log(`  worst   ${Math.min(...pct).toFixed(1)}%  /  ${Math.max(...pct).toFixed(1)}%`);

  const within = (limit: number) => pct.filter((p) => Math.abs(p) <= limit).length;
  console.log(`\n  ${within(10)} of ${rows.length} within 10%, ${within(25)} within 25%`);

  console.log('\nthe five that disagree most:');
  for (const row of [...rows].sort((a, b) => Math.abs(b.ours - b.theirs) - Math.abs(a.ours - a.theirs)).slice(0, 5)) {
    console.log(`  ours ${String(row.ours).padStart(5)} m / ${String(row.oursMin).padStart(3)} min   theirs ${String(row.theirs).padStart(5)} m / ${String(row.theirsMin).padStart(3)} min   ${row.name}`);
  }
}

main();
