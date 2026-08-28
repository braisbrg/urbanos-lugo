/**
 * How far this app's estimates sit from the operator's own numbers.
 *
 *   npx tsx tools/compareOperatorTimes.ts                 # one pass over a few stops
 *   npx tsx tools/compareOperatorTimes.ts --repeat 6      # six passes, a minute apart
 *   npx tsx tools/compareOperatorTimes.ts --stops uilP,gJRz
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
import { getArrivalsForStop } from '../src/utils/transitEngine';
import { parseOperatorTimes, type OperatorDeparture } from '../src/services/operatorTimes';
import { REPO_URL } from '../src/project';

const OPERATOR = 'https://info.urbanoslugo.com/qr-demo-paradas';
const UA = `UrbanosLugoBot/1.0 (+${REPO_URL}; unofficial timetable reader)`;

/** Rda. Muralla 56, three consecutive poles on the Ronda, and As Pedreiras. */
const DEFAULT_STOPS = ['uilP', 'qFuw', 'RnND', 'XpKC', 'gJRz'];

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

const differences: number[] = [];

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
        continue;
      }
      const diff = ours.etaMinutes - dep.minutes;
      differences.push(diff);
      const sign = diff > 0 ? `+${diff}` : `${diff}`;
      console.log(
        `  ${dep.line.padEnd(5)} theirs ${String(dep.minutes).padStart(3)} min   ` +
          `ours ${String(ours.etaMinutes).padStart(3)} min  ${sign.padStart(4)}  (${ours.precision})`,
      );
    }

    for (const ours of arrivals.slice(0, 3)) {
      if (!theirs.some((d) => d.line === ours.lineNumber)) {
        console.log(`  ${ours.lineNumber.padEnd(5)} theirs   — min   ours ${String(ours.etaMinutes).padStart(3)} min        (${ours.precision})`);
      }
    }
  }
}

async function main() {
  const stops = (arg('stops') ?? DEFAULT_STOPS.join(',')).split(',').map((s) => s.trim());
  const repeat = Number(arg('repeat') ?? 1);

  for (let n = 0; n < repeat; n++) {
    const at = new Date();
    console.log(`\n===== ${at.toTimeString().slice(0, 8)} =====`);
    await pass(stops, at);
    if (n < repeat - 1) await new Promise((r) => setTimeout(r, 60_000));
  }

  if (differences.length > 0) {
    const sorted = [...differences].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const within2 = differences.filter((d) => Math.abs(d) <= 2).length;
    console.log(`\n${differences.length} comparisons`);
    console.log(`  median difference ${median > 0 ? '+' : ''}${median} min (positive = this app says later than they do)`);
    console.log(`  range ${sorted[0]} to ${sorted[sorted.length - 1]} min`);
    console.log(`  within 2 min: ${within2}/${differences.length}`);
  }
  console.log('');
}

main();
