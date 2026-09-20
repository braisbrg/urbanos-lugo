/**
 * How far this app's estimates sit from the operator's own numbers, read from the page
 * behind the pole QR stickers. It reads and prints; it changes and decides nothing.
 *
 *   npx tsx tools/compareOperatorTimes.ts --stops uilP,gJRz
 *   npx tsx tools/compareOperatorTimes.ts --repeat 90 --interval 120 --out run.jsonl
 */
import { appendFileSync } from 'node:fs';
import { getArrivalsForStop } from '../src/utils/arrivals';
import { parseOperatorTimes, type OperatorDeparture } from '../src/services/operatorTimes';
import { REPO_URL } from '../src/project';
import { mean, median, sleep } from './lib';

// Their robots.txt disallows nothing; still one request per stop per pass, a minute
// apart by default, with a User-Agent that says who is asking and links back.
const OPERATOR = 'https://info.urbanoslugo.com/qr-demo-paradas';
const UA = `UrbanosLugoBot/1.0 (+${REPO_URL}; unofficial timetable reader)`;
const DEFAULT_STOPS = ['uilP', 'qFuw', 'RnND', 'XpKC', 'gJRz'];

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const outFile = arg('out');

/** One JSON line per observation, so a long run can be looked at afterwards. */
function record(row: Record<string, unknown>) {
  if (outFile) appendFileSync(outFile, JSON.stringify(row) + '\n');
}

const min = (n: number) => String(n).padStart(3);
const signed = (n: number, text = String(n)) => (n > 0 ? '+' : '') + text;

async function operatorTimes(code: string): Promise<OperatorDeparture[] | null> {
  try {
    const res = await fetch(`${OPERATOR}/${encodeURIComponent(code)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return parseOperatorTimes(await res.text());
  } catch {
    return null;
  }
}

interface Comparison {
  code: string;
  line: string;
  diff: number;
  precision: 'published' | 'estimated';
}

const differences: Comparison[] = [];

async function pass(stops: string[], at: Date) {
  for (const code of stops) {
    const theirs = await operatorTimes(code);
    const { stop, arrivals } = getArrivalsForStop(code, at);
    const name = stop ? stop.name : code;
    // `theirs-only` is how a late bus looks from here (it fell out of our window and the
    // board advertises the next one); `ours-only` a scheduled bus their tracker is not showing.
    const row = (extra: Record<string, unknown>) => record({ at: at.toISOString(), code, name, ...extra });

    console.log(`\n${code}  ${name}`);
    if (theirs === null) {
      console.log("  the operator's page could not be read");
      continue;
    }
    if (theirs.length === 0 && arrivals.length === 0) {
      console.log('  neither has a departure right now');
      continue;
    }

    for (const dep of theirs) {
      // Their first departure for a line against ours for the same line: matching further
      // would need their itinerary names mapped to our directions.
      const ours = arrivals.find((a) => a.lineNumber === dep.line);
      if (!ours) {
        console.log(`  ${dep.line.padEnd(5)} theirs ${min(dep.minutes)} min   ours —          ${dep.towards.slice(0, 30)}`);
        row({ line: dep.line, kind: 'theirs-only', theirs: dep.minutes });
        continue;
      }
      const diff = ours.etaMinutes - dep.minutes;
      differences.push({ code, line: dep.line, diff, precision: ours.precision });
      row({ line: dep.line, kind: 'both', theirs: dep.minutes, ours: ours.etaMinutes, diff, precision: ours.precision });
      console.log(
        `  ${dep.line.padEnd(5)} theirs ${min(dep.minutes)} min   ` +
          `ours ${min(ours.etaMinutes)} min  ${signed(diff).padStart(4)}  (${ours.precision})`,
      );
    }

    for (const ours of arrivals.slice(0, 3)) {
      if (theirs.some((d) => d.line === ours.lineNumber)) continue;
      console.log(`  ${ours.lineNumber.padEnd(5)} theirs   — min   ours ${min(ours.etaMinutes)} min        (${ours.precision})`);
      row({ line: ours.lineNumber, kind: 'ours-only', ours: ours.etaMinutes, precision: ours.precision });
    }
  }
}

/** Bias (a constant this app could subtract) and spread (a bus running early or late) are different problems. */
function report(what: string, rows: Comparison[]) {
  if (rows.length === 0) {
    console.log(`\n${what}: no comparisons`);
    return;
  }
  const diffs = rows.map((r) => r.diff).sort((a, b) => a - b);
  const within2 = diffs.filter((d) => Math.abs(d) <= 2).length;
  console.log(`\n${what}: ${rows.length} comparisons`);
  console.log(`  bias    median ${signed(median(diffs))} min (positive = this app says later than they do)`);
  console.log(`  spread  median |difference| ${median(diffs.map(Math.abs))} min, range ${diffs[0]} to ${diffs[diffs.length - 1]}`);
  console.log(`  within 2 min: ${within2}/${diffs.length}`);
}

/**
 * A pair wrong the same way every pass is a model error with an address; one that swings
 * is traffic. Single sightings say nothing, so they are left out.
 */
function worstPairs(rows: Comparison[]) {
  const byPair = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.code}/${r.line}`;
    byPair.set(key, [...(byPair.get(key) ?? []), r.diff]);
  }
  const repeated = [...byPair.entries()]
    .filter(([, diffs]) => diffs.length > 1)
    .map(([key, diffs]) => ({ key, n: diffs.length, mean: mean(diffs), min: Math.min(...diffs), max: Math.max(...diffs) }))
    .sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));

  if (repeated.length === 0) return;
  console.log('\nseen more than once, worst first');
  for (const p of repeated.slice(0, 12)) {
    console.log(
      `  ${p.key.padEnd(14)} n=${p.n}  mean ${signed(p.mean, p.mean.toFixed(1))} min  ` +
        `(${p.min} to ${p.max})${p.min === p.max ? '  always the same, so not traffic' : ''}`,
    );
  }
}

async function main() {
  const stops = (arg('stops') ?? DEFAULT_STOPS.join(',')).split(',').map((s) => s.trim());
  const repeat = Number(arg('repeat') ?? 1);
  // A minute is right for watching a single countdown move; a run measured in hours has
  // no reason to ask that often, and their server is somebody else's.
  const intervalMs = Number(arg('interval') ?? 60) * 1000;

  for (let n = 0; n < repeat; n++) {
    const at = new Date();
    console.log(`\n===== ${at.toTimeString().slice(0, 8)} =====`);
    await pass(stops, at);
    if (n < repeat - 1) await sleep(intervalMs);
  }

  if (differences.length > 0) {
    report('printed by the operator for this stop', differences.filter((c) => c.precision === 'published'));
    report('interpolated by this app', differences.filter((c) => c.precision === 'estimated'));
    worstPairs(differences);
  }
  console.log('');
}

main();
