/**
 * Proves that `npm run reconcile` can actually fail.
 *
 *   npm run reconcile:selftest
 *
 * A checker that always reports "all clean" is indistinguishable from one that checks
 * nothing, and this one has invented failures twice already. So each check gets a fault
 * built for it: the data is corrupted in one specific way, the reconciler is run, and the
 * section that should notice has to be the one that does. The files are restored after.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { at, ROOT } from './lib';

const STOPS = at('src', 'data', 'stops.json');
const LINES = at('src', 'data', 'lines.json');
const BACKUPS = [STOPS, LINES].map((f) => [f, f + '.selftest-backup'] as const);

interface Mutation {
  name: string;
  /** The reconcile section that must notice. Matched as a prefix of the heading. */
  section: string;
  apply: (stops: any[], lines: any[]) => string;
}

const MUTATIONS: Mutation[] = [
  {
    name: 'a stop moved 200 m from where the operator puts it',
    // "Stop position" alone also matches the OSM section, which would mask this result.
    section: 'Stop position vs the coordinate',
    apply: (stops) => {
      const stop = stops.find((s) => s.officialIds?.length)!;
      stop.lat += 0.0018; // ~200 m north
      return stop.name;
    },
  },
  {
    name: 'a stop dropped from an itinerary the operator publishes',
    section: 'Itineraries',
    apply: (_stops, lines) => {
      const dir = lines.find((l) => l.directions?.[0]?.stops?.length > 5)!.directions[0];
      dir.stopPathIndex?.splice(3, 1);
      return dir.stops.splice(3, 1)[0];
    },
  },
  {
    name: 'a stop badging a line that never calls there',
    section: 'Lines serving each stop',
    apply: (stops) => {
      const stop = stops.find((s) => s.lines?.length === 1)!;
      stop.lines.push('99-invented');
      return stop.name;
    },
  },
  {
    name: 'a departure time that does not match the printed table',
    section: 'Timetables',
    apply: (_stops, lines) => {
      const line = lines.find((l) => l.services?.[0]?.rows?.[0]?.times?.length)!;
      line.services[0].rows[0].times[0] = '03:33';
      return `line ${line.number}`;
    },
  },
  {
    name: 'a stop renamed to something the operator never prints',
    section: 'Stop names',
    apply: (stops) => {
      const stop = stops.find((s) => s.officialIds?.length)!;
      stop.name = 'Parada Inventada 42';
      return stop.name;
    },
  },
];

/** Which sections of a reconcile run reported at least one disagreement. */
function sectionsThatFired(output: string): string[] {
  const lines = output.split(/\r?\n/);
  const fired: string[] = [];
  let current = '';
  lines.forEach((line, i) => {
    if (/^-{3,}$/.test(line.trim()) && i > 0) current = lines[i - 1].trim();
    if (line.trimStart().startsWith('! ') && current && !fired.includes(current)) fired.push(current);
  });
  return fired;
}

function runReconcile(): string {
  try {
    // Quoted: the repository path carries an accent, and could carry a space.
    return execSync(`npx tsx "${at('tools', 'reconcile.ts')}"`, { encoding: 'utf8', cwd: ROOT });
  } catch (err: any) {
    return String(err.stdout ?? '') + String(err.stderr ?? '');
  }
}

const backUp = () => BACKUPS.forEach(([file, backup]) => copyFileSync(file, backup));
function restore(): void {
  for (const [file, backup] of BACKUPS) {
    if (!existsSync(backup)) continue;
    copyFileSync(backup, file);
    unlinkSync(backup);
  }
}

process.on('SIGINT', () => {
  restore();
  process.exit(130);
});

let passed = 0;
let failed = 0;
try {
  backUp();
  console.log('Baseline: reconciling the data as it stands.');
  const baseline = sectionsThatFired(runReconcile());
  console.log(`  sections reporting something today: ${baseline.length ? baseline.join(', ') : 'none'}\n`);

  for (const mutation of MUTATIONS) {
    restore();
    backUp();
    const stops = JSON.parse(readFileSync(STOPS, 'utf8'));
    const lines = JSON.parse(readFileSync(LINES, 'utf8'));
    const target = mutation.apply(stops, lines);
    writeFileSync(STOPS, JSON.stringify(stops));
    writeFileSync(LINES, JSON.stringify(lines));

    const fired = sectionsThatFired(runReconcile());
    const noticed = fired.some((s) => s.startsWith(mutation.section));
    // A different section noticing is not a pass: the two checks would be testing the
    // same thing. Nor is a section that was already firing before the fault.
    const wasAlreadyFiring = baseline.some((s) => s.startsWith(mutation.section));
    if (noticed && !wasAlreadyFiring) {
      passed++;
      console.log(`  caught  ${mutation.name}\n          -> "${mutation.section}" noticed (${target})`);
    } else {
      failed++;
      if (wasAlreadyFiring) console.log(`  BLIND   ${mutation.name}\n          -> "${mutation.section}" was already reporting before the fault, so this proves nothing`);
      else console.log(`  MISSED  ${mutation.name}\n          -> "${mutation.section}" stayed quiet; sections that fired: ${fired.join(', ') || 'none'}`);
    }
  }
} finally {
  restore();
}

console.log(`\n${passed}/${MUTATIONS.length} faults caught by the check meant to catch them.`);
if (failed) {
  console.log('A check that cannot fail is not a check. Fix it before trusting a clean run.\n');
  process.exit(1);
}
console.log('The data files are back as they were.\n');
