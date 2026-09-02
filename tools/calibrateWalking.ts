/**
 * Measures how far a walk in Lugo really is, against the straight line.
 *
 *   npx tsx tools/calibrateWalking.ts
 *
 * The app estimates walking times offline, so it needs a detour factor. That factor was
 * a textbook constant (1.35) never checked against this city, which has a walled old
 * town, a river and a railway — all of which force detours a generic number cannot know.
 *
 * This samples real pedestrian routes from OSM's foot router and reports the factor that
 * actually fits, plus the error the current constants produce. It changes no code: read
 * the output and set the constants in transitEngine.ts.
 */
import stops from '../src/data/stops.json';
import { getDistanceMeters as haversine } from '../src/utils/geo';

const FOOT_ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
const PAUSE_MS = 350;
const SAMPLE_PAIRS = 120;

/** Keep the current values here so the report can show the error they cause. */
const CURRENT_DETOUR = 1.35;
const CURRENT_M_PER_MIN = 78;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


const median = (xs: number[]) => percentile(xs, 50);
const percentile = (xs: number[], p: number) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))];

/** How the estimate would score with a given pair of constants. */
function score(pairs: { straight: number; realMinutes: number }[], detour: number, mPerMin: number) {
  const errors = pairs.map((x) => Math.max(1, Math.round((x.straight * detour) / mPerMin)) - x.realMinutes);
  const abs = errors.map(Math.abs);
  return {
    within2: Math.round((abs.filter((e) => e <= 2).length / abs.length) * 100),
    within3: Math.round((abs.filter((e) => e <= 3).length / abs.length) * 100),
    late: Math.round((errors.filter((e) => e < 0).length / errors.length) * 100),
    mean: errors.reduce((n, e) => n + e, 0) / errors.length,
    worst: Math.max(...abs),
  };
}

async function realWalk(a: any, b: any): Promise<{ meters: number; seconds: number } | null> {
  const coords = `${a.lng},${a.lat};${b.lng},${b.lat}`;
  try {
    const res = await fetch(`${FOOT_ROUTER}/${coords}?overview=false`, {
      headers: { 'User-Agent': 'UrbanosLugoCalibration/1.0 (one-off walking calibration)' },
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    if (json.code !== 'Ok' || !json.routes?.length) return null;
    return { meters: json.routes[0].distance, seconds: json.routes[0].duration };
  } catch {
    return null;
  }
}

async function main() {
  // A deterministic spread of urban pairs at walkable distances.
  const urban = (stops as any[]).filter((s) => s.zone !== 'Rural');
  const pairs: [any, any][] = [];
  for (let i = 0; pairs.length < SAMPLE_PAIRS && i < urban.length * 4; i++) {
    const a = urban[(i * 17) % urban.length];
    const b = urban[(i * 53 + 7) % urban.length];
    if (a.id === b.id) continue;
    const straight = haversine(a.lat, a.lng, b.lat, b.lng);
    if (straight < 200 || straight > 3500) continue; // the range that matters for a leg
    pairs.push([a, b]);
  }

  console.log(`sampling ${pairs.length} real pedestrian routes...\n`);

  const factors: number[] = [];
  const speeds: number[] = [];
  const errors: number[] = [];
  const measured: { straight: number; realMinutes: number }[] = [];
  let failed = 0;

  for (const [a, b] of pairs) {
    const real = await realWalk(a, b);
    await sleep(PAUSE_MS);
    if (!real) {
      failed++;
      continue;
    }
    const straight = haversine(a.lat, a.lng, b.lat, b.lng);
    factors.push(real.meters / straight);
    speeds.push(real.meters / (real.seconds / 60));
    measured.push({ straight, realMinutes: real.seconds / 60 });

    const estimatedMinutes = Math.max(1, Math.round((straight * CURRENT_DETOUR) / CURRENT_M_PER_MIN));
    errors.push(estimatedMinutes - real.seconds / 60);
  }

  if (!factors.length) {
    console.log('no routes returned; the router may be unavailable.');
    return;
  }

  const meanError = errors.reduce((n, e) => n + e, 0) / errors.length;
  const absError = errors.map(Math.abs);

  console.log(`routes measured : ${factors.length}${failed ? ` (${failed} failed)` : ''}`);
  console.log('');
  console.log('detour factor (real distance / straight line)');
  console.log(`  median ${median(factors).toFixed(3)}   min ${Math.min(...factors).toFixed(2)}   max ${Math.max(...factors).toFixed(2)}`);
  console.log(`  currently using ${CURRENT_DETOUR}`);
  console.log('');
  console.log("router's own walking speed (m/min)");
  console.log(`  median ${median(speeds).toFixed(1)}`);
  console.log(`  currently using ${CURRENT_M_PER_MIN}`);
  console.log('');
  console.log('error of the current estimate, in minutes (positive = we over-state)');
  console.log(`  mean ${meanError.toFixed(1)}   median ${median(errors).toFixed(1)}   worst ${Math.max(...absError).toFixed(1)}`);
  console.log(`  within 2 min: ${Math.round((absError.filter((e) => e <= 2).length / absError.length) * 100)}%`);
  console.log('');
  console.log('detour percentiles: ' + [50, 60, 70, 75, 80, 90].map((p) => `p${p}=${percentile(factors, p).toFixed(2)}`).join('  '));
  console.log('');
  console.log('candidate constants (late% = we under-state and you miss the bus)');
  console.log('  detour  m/min   ±2min  ±3min   late   mean   worst');
  for (const detour of [1.26, 1.3, 1.35, 1.4, 1.45, 1.5]) {
    for (const speed of [75]) {
      const r = score(measured, detour, speed);
      console.log(
        `   ${detour.toFixed(2)}    ${speed}     ${String(r.within2).padStart(3)}%   ${String(r.within3).padStart(3)}%   ${String(r.late).padStart(3)}%  ${r.mean.toFixed(1).padStart(5)}   ${r.worst.toFixed(1).padStart(5)}`,
      );
    }
  }
}

main();
