/**
 * The HTTP surface, under load and under nonsense.
 *
 *   PORT=3002 pnpm start        # in another terminal
 *   pnpm exec tsx tools/stressHttp.ts
 *
 * What the server does when several people ask at once, and when the thing being asked is
 * not a stop code. The bar is not speed: nothing 500s, nothing hangs, and nothing answers
 * with a stack trace.
 */
import { percentile, sleep } from './lib';

const BASE = process.env.BASE ?? 'http://localhost:3002';

interface Result {
  label: string;
  status: number;
  ms: number;
  body: string;
}

async function hit(label: string, path: string): Promise<Result> {
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(30_000) });
    return { label, status: res.status, ms: Date.now() - started, body: (await res.text()).slice(0, 120) };
  } catch (error) {
    return { label, status: -1, ms: Date.now() - started, body: String(error).slice(0, 80) };
  }
}

/** A 500, a hang, or a stack trace in the body is a failure. Anything else is an answer. */
function judge(r: Result): string {
  if (r.status === -1) return '   <-- did not answer';
  if (r.status >= 500) return '   <-- server error';
  if (/\bat \w+ \(|Error:|node:internal/.test(r.body)) return '   <-- leaked a stack trace';
  return '';
}

let bad = 0;

async function probe(title: string, cases: [string, string][], path: (value: string) => string) {
  console.log(`\n${title}`);
  for (const [label, value] of cases) {
    const r = await hit(label, path(value));
    const note = judge(r);
    if (note) bad++;
    console.log(`  ${r.label.padEnd(46)} ${String(r.status).padStart(4)}  ${String(r.ms).padStart(6)} ms ${note}`);
  }
}

const wave = (n: number, path: string, label = 'n') => Promise.all(Array.from({ length: n }, (_, i) => hit(`${label} ${i}`, path)));
const failed = (rs: Result[]) => rs.filter((r) => r.status >= 500 || r.status === -1).length;

async function main() {
  const alive = await hit('is anything there?', '/api/alerts');
  if (alive.status === -1) return console.log(`\nNothing is listening on ${BASE}. Start it with PORT=3002 pnpm start.\n`);

  await probe(
    'nonsense where a stop code goes',
    [
      ['a real code', 'uilP'],
      ['empty', ''],
      ['a very long code', 'x'.repeat(2000)],
      ['path traversal', '..%2F..%2Fetc%2Fpasswd'],
      ['a null byte', 'uilP%00'],
      ['angle brackets', '%3Cscript%3Ealert(1)%3C%2Fscript%3E'],
      ['unicode', '%F0%9F%9A%8C%F0%9F%9A%8C'],
      ['a newline', 'uilP%0D%0AX-Injected:%20yes'],
    ],
    (code) => `/api/paradas/${code}/agora`,
  );
  await probe(
    'nonsense where a search goes',
    [
      ['a real street', 'Ronda'],
      ['the length cap, exceeded tenfold', 'a'.repeat(1200)],
      ['regex metacharacters', '('.repeat(500)],
      ['a percent sign on its own', '%'],
    ],
    (q) => `/api/stops?q=${encodeURIComponent(q)}`,
  );
  await probe(
    'nonsense where a plan goes',
    [
      ['two real places', 'from=Praza%20Maior&to=Fontinas'],
      ['neither exists', 'from=zzzz&to=qqqq'],
      ['no parameters at all', ''],
      ['one enormous parameter', 'from=' + 'a'.repeat(3000) + '&to=b'],
    ],
    (qs) => `/api/plan?${qs}`,
  );

  console.log('\nfifty at once on the endpoint the app really uses');
  const started = Date.now();
  const burst = await wave(50, '/api/paradas/uilP/agora', 'burst');
  const statuses = burst.reduce<Record<number, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  console.log(`  50 concurrent requests in ${Date.now() - started} ms, slowest ${Math.max(...burst.map((r) => r.ms))} ms, statuses ${JSON.stringify(statuses)}`);
  if (failed(burst)) bad++;

  console.log('\nand the rate limiter still says no');
  const refused = (await wave(40, '/api/plan?from=Praza%20Maior&to=Fontinas', 'plan')).filter((r) => r.status === 429).length;
  console.log(`  40 plans in one window -> ${refused} refused with 429`);
  if (refused === 0) {
    console.log('  <-- nothing was refused; the plan cap is not being applied');
    bad++;
  }

  // Where it stops keeping up: the same request at rising concurrency until something
  // gives. What gives is the rate limiter (120 requests a minute per address), which is
  // the answer: over it the server refuses rather than queues. Runs last and waits out
  // the window first, or it measures its own footprints; the arrival board rather than
  // /agora, which answers from a 20 s cache.
  console.log('\nwhere it stops keeping up (arrival board, rising concurrency)');
  console.log('  waiting out the rate-limit window so this measures the server, not the last test...');
  await sleep(61_000);

  let served = 0;
  let firstRefusalAt = 0;
  for (const level of [1, 10, 25, 50, 100, 200]) {
    const at = Date.now();
    const rs = await wave(level, '/api/arrivals/uilP', `n${level}-`);
    const elapsed = Math.max(1, Date.now() - at);
    const ok = rs.filter((r) => r.status === 200);
    const refused = rs.filter((r) => r.status === 429).length;
    const lost = failed(rs);
    served += ok.length;
    if (refused && !firstRefusalAt) firstRefusalAt = level;

    const ms = ok.map((r) => r.ms);
    const timing = ms.length
      ? `p50 ${String(percentile(ms, 50)).padStart(4)} ms   p95 ${String(percentile(ms, 95)).padStart(4)} ms   p99 ${String(percentile(ms, 99)).padStart(4)} ms   ${((ok.length / elapsed) * 1000).toFixed(0).padStart(4)} req/s`
      : ' '.repeat(46);
    console.log(`  ${String(level).padStart(3)} at once   ${String(ok.length).padStart(3)} served   ${timing}${refused ? `   ${String(refused).padStart(3)} refused` : ''}${lost ? `   <-- ${lost} failed` : ''}`);
    if (lost) bad++;
  }
  console.log(`  ${served} served before the cap, first refusal at ${firstRefusalAt || 'no'} concurrent. The ceiling is the limiter, not the CPU: over it the server refuses rather than queues.`);

  console.log(`\n${bad === 0 ? 'nothing broke' : `${bad} thing(s) worth looking at`}\n`);
  if (bad) process.exitCode = 1;
}

main();
