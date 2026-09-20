/**
 * Measures how far a walk in Lugo really is, against the straight line.
 *
 *   npx tsx tools/calibrateWalking.ts
 *
 * The app estimates walking times offline from a detour factor, and a textbook constant
 * cannot know about the walled old town, the river or the railway. This samples real
 * pedestrian routes from OSM's foot router and reports the factor that fits, plus the
 * error the current constants produce. It changes no code: set src/utils/places.ts by hand.
 */
import stops from '../src/data/stops.json';
import { getDistanceMeters as haversine } from '../src/utils/geo';
import { mean, median, percentile, sleep } from './lib';

const FOOT_ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
const PAUSE_MS = 350;
const SAMPLE_PAIRS = 120;

/** Keep the current values here so the report can show the error they cause. */
const CURRENT_DETOUR = 1.35;
const CURRENT_M_PER_MIN = 78;

type Measured = { straight: number; realMinutes: number };

/** How the estimate would score with a given pair of constants. */
function score(pairs: Measured[], detour: number, mPerMin: number) {
  const errors = pairs.map((x) => Math.max(1, Math.round((x.straight * detour) / mPerMin)) - x.realMinutes);
  const abs = errors.map(Math.abs);
  const pct = (n: number) => Math.round((n / errors.length) * 100);
  return {
    within2: pct(abs.filter((e) => e <= 2).length),
    within3: pct(abs.filter((e) => e <= 3).length),
    late: pct(errors.filter((e) => e < 0).length),
    mean: mean(errors),
    median: median(errors),
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
  // A deterministic spread of urban pairs at the distances a walking leg can have.
  const urban = (stops as any[]).filter((s) => s.zone !== 'Rural');
  const pairs: { a: any; b: any; straight: number }[] = [];
  for (let i = 0; pairs.length < SAMPLE_PAIRS && i < urban.length * 4; i++) {
    const a = urban[(i * 17) % urban.length];
    const b = urban[(i * 53 + 7) % urban.length];
    const straight = haversine(a.lat, a.lng, b.lat, b.lng);
    if (a.id !== b.id && straight >= 200 && straight <= 3500) pairs.push({ a, b, straight });
  }

  console.log(`sampling ${pairs.length} real pedestrian routes...\n`);

  const factors: number[] = [];
  const speeds: number[] = [];
  const measured: Measured[] = [];
  let failed = 0;

  for (const { a, b, straight } of pairs) {
    const real = await realWalk(a, b);
    await sleep(PAUSE_MS);
    if (!real) {
      failed++;
      continue;
    }
    factors.push(real.meters / straight);
    speeds.push(real.meters / (real.seconds / 60));
    measured.push({ straight, realMinutes: real.seconds / 60 });
  }

  if (!factors.length) {
    console.log('no routes returned; the router may be unavailable.');
    return;
  }

  const current = score(measured, CURRENT_DETOUR, CURRENT_M_PER_MIN);

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
  console.log(`  mean ${current.mean.toFixed(1)}   median ${current.median.toFixed(1)}   worst ${current.worst.toFixed(1)}`);
  console.log(`  within 2 min: ${current.within2}%`);
  console.log('');
  console.log('detour percentiles: ' + [50, 60, 70, 75, 80, 90].map((p) => `p${p}=${percentile(factors, p).toFixed(2)}`).join('  '));
  console.log('');
  console.log('candidate constants (late% = we under-state and you miss the bus)');
  console.log('  detour  m/min   ±2min  ±3min   late   mean   worst');
  const speed = 75;
  const pct = (n: number) => `${String(n).padStart(3)}%`;
  for (const detour of [1.26, 1.3, 1.35, 1.4, 1.45, 1.5]) {
    const r = score(measured, detour, speed);
    console.log(
      `   ${detour.toFixed(2)}    ${speed}     ${pct(r.within2)}   ${pct(r.within3)}   ${pct(r.late)}  ${r.mean.toFixed(1).padStart(5)}   ${r.worst.toFixed(1).padStart(5)}`,
    );
  }
}

main();
