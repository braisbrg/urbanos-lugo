/**
 * How far this app's estimates sit from the operator's own numbers.
 *
 *   npx tsx tools/compareOperatorTimes.ts                 # one pass over a few stops
 *   npx tsx tools/compareOperatorTimes.ts --repeat 6      # six passes, a minute apart
 *   npx tsx tools/compareOperatorTimes.ts --stops uilP,gJRz
 *   npx tsx tools/compareOperatorTimes.ts --repeat 90 --interval 120 --out run.jsonl
 *
 * The whole project is built on separating a time the operator published from one this
 * app worked out, and there was nothing to check the second kind against: an estimate
 * could be twelve minutes wrong and nobody would ever find out. Then
 * `info.urbanoslugo.com/qr-demo-paradas/<code>` turned up — the page behind the QR
 * stickers on the poles — and it answers with the next departures for a stop, keyed by
 * the very codes this app already uses.
 *
 * Two things come out of running this. Whether their numbers move like a countdown or like
 * something being tracked: a countdown computed from a fixed departure falls exactly one
 * minute per minute, so a stall or a two-minute drop in sixty seconds is proof it is not
 * that. And, line by line, how wrong this app is.
 *
 * It reads and prints. It changes nothing, and it decides nothing: what the operator's
 * numbers actually are, and whether their terms allow leaning on them, are questions for a
 * person.
 *
 * Their robots.txt is `Disallow:` with nothing after it, so this is polite by their own
 * machine-readable answer. One request per stop per pass, a minute apart, with a
 * User-Agent that says who is asking and links back.
 */
import { appendFileSync } from 'node:fs';
import { getArrivalsForStop } from '../src/utils/transitEngine';
import { parseOperatorTimes, type OperatorDeparture } from '../src/services/operatorTimes';
import { REPO_URL } from '../src/project';

const OPERATOR = 'https://info.urbanoslugo.com/qr-demo-paradas';
const UA = `UrbanosLugoBot/1.0 (+${REPO_URL}; unofficial timetable reader)`;

/** Rda. Muralla 56, three consecutive poles on the Ronda, and As Pedreiras. */
const DEFAULT_STOPS = ['uilP', 'qFuw', 'RnND', 'XpKC', 'gJRz'];

/**
 * One JSON line per observation, so a three-hour run can be looked at afterwards.
 *
 * `kind` matters as much as the difference. `both` is a comparison; `theirs-only` is a
 * departure the operator has and this app does not, which is how a late bus looks from
 * here -- it falls out of our window and the board advertises the next one instead;
 * `ours-only` is the reverse, a scheduled bus their tracker is not showing.
 */
const out = (): string | undefined => arg('out');

function record(row: Record<string, unknown>) {
  const file = out();
  if (file) appendFileSync(file, JSON.stringify(row) + '\n');
}

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

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

    if (theirs === null) {
      console.log(`\n${code}  ${name}\n  the operator's page could not be read`);
      continue;
    }

    console.log(`\n${code}  ${name}`);
    if (theirs.length === 0 && arrivals.length === 0) {
      console.log('  neither has a departure right now');
      continue;
    }

    for (const dep of theirs) {
      // Their first departure for a line against ours for the same line: matching any
      // further than that would need their itinerary names mapped to our directions,
      // and the first one is the one somebody standing at the pole is waiting for.
      const ours = arrivals.find((a) => a.lineNumber === dep.line);
      if (!ours) {
        console.log(`  ${dep.line.padEnd(5)} theirs ${String(dep.minutes).padStart(3)} min   ours —          ${dep.towards.slice(0, 30)}`);
        record({ at: at.toISOString(), code, name, line: dep.line, kind: 'theirs-only', theirs: dep.minutes });
        continue;
      }
      const diff = ours.etaMinutes - dep.minutes;
      differences.push({ code, line: dep.line, diff, precision: ours.precision });
      record({
        at: at.toISOString(),
        code,
        name,
        line: dep.line,
        kind: 'both',
        theirs: dep.minutes,
        ours: ours.etaMinutes,
        diff,
        precision: ours.precision,
      });
      const sign = diff > 0 ? `+${diff}` : `${diff}`;
      console.log(
        `  ${dep.line.padEnd(5)} theirs ${String(dep.minutes).padStart(3)} min   ` +
          `ours ${String(ours.etaMinutes).padStart(3)} min  ${sign.padStart(4)}  (${ours.precision})`,
      );
    }

    for (const ours of arrivals.slice(0, 3)) {
      if (!theirs.some((d) => d.line === ours.lineNumber)) {
        console.log(`  ${ours.lineNumber.padEnd(5)} theirs   — min   ours ${String(ours.etaMinutes).padStart(3)} min        (${ours.precision})`);
        record({
          at: at.toISOString(),
          code,
          name,
          line: ours.lineNumber,
          kind: 'ours-only',
          ours: ours.etaMinutes,
          precision: ours.precision,
        });
      }
    }
  }
}

/**
 * Bias and spread are different problems.
 *
 * A median of +2 across the board is a constant this app could subtract. A median of 0
 * with half the comparisons four minutes out in either direction is a bus running early
 * or late, and no arithmetic on a timetable will touch it. Printing only "median" hid
 * which of the two was being looked at.
 */
function report(what: string, rows: Comparison[]) {
  if (rows.length === 0) {
    console.log(`\n${what}: no comparisons`);
    return;
  }
  const diffs = rows.map((r) => r.diff).sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  const spread = [...diffs].map(Math.abs).sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
  const within2 = diffs.filter((d) => Math.abs(d) <= 2).length;
  console.log(`\n${what}: ${rows.length} comparisons`);
  console.log(`  bias    median ${median > 0 ? '+' : ''}${median} min (positive = this app says later than they do)`);
  console.log(`  spread  median |difference| ${spread} min, range ${diffs[0]} to ${diffs[diffs.length - 1]}`);
  console.log(`  within 2 min: ${within2}/${diffs.length}`);
}

/**
 * A stop-and-line pair that is wrong the same way every pass is a model error with an
 * address; one that swings either way is traffic. Only pairs seen more than once say
 * anything, so single sightings are left out rather than listed as if they meant something.
 */
function worstPairs(rows: Comparison[]) {
  const byPair = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.code}/${r.line}`;
    byPair.set(key, [...(byPair.get(key) ?? []), r.diff]);
  }
  const repeated = [...byPair.entries()]
    .filter(([, diffs]) => diffs.length > 1)
    .map(([key, diffs]) => ({
      key,
      n: diffs.length,
      mean: diffs.reduce((a, b) => a + b, 0) / diffs.length,
      min: Math.min(...diffs),
      max: Math.max(...diffs),
    }))
    .sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean));

  if (repeated.length === 0) return;
  console.log('\nseen more than once, worst first');
  for (const p of repeated.slice(0, 12)) {
    const sign = p.mean > 0 ? '+' : '';
    console.log(
      `  ${p.key.padEnd(14)} n=${p.n}  mean ${sign}${p.mean.toFixed(1)} min  ` +
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
    if (n < repeat - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }

  if (differences.length > 0) {
    report('printed by the operator for this stop', differences.filter((c) => c.precision === 'published'));
    report('interpolated by this app', differences.filter((c) => c.precision === 'estimated'));
    worstPairs(differences);
  }
  console.log('');
}

main();
