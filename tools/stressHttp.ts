/**
 * The HTTP surface, under load and under nonsense.
 *
 *   PORT=3002 pnpm start        # in another terminal
 *   pnpm exec tsx tools/stressHttp.ts
 *
 * Round one of the stress work measured the parsers and the computing. This measures the
 * other half: what the server does when several people ask at once, and what it does when
 * the thing being asked is not a stop code.
 *
 * The bar is not speed. It is that nothing 500s, nothing hangs, and nothing answers with
 * somebody else's data or with a stack trace.
 */
const BASE = process.env.BASE ?? 'http://localhost:3002';

interface Result { label: string; status: number; ms: number; body: string }

async function hit(label: string, path: string): Promise<Result> {
  const started = Date.now();
  try {
    const res = await fetch(BASE + path, { signal: AbortSignal.timeout(30_000) });
    const body = (await res.text()).slice(0, 120);
    return { label, status: res.status, ms: Date.now() - started, body };
  } catch (error) {
    return { label, status: -1, ms: Date.now() - started, body: String(error).slice(0, 80) };
  }
}

const line = (r: Result, note = '') =>
  console.log(`  ${r.label.padEnd(46)} ${String(r.status).padStart(4)}  ${String(r.ms).padStart(6)} ms ${note}`);

/** A 500, a hang, or a stack trace in the body is a failure. Anything else is an answer. */
function judge(r: Result): string {
  if (r.status === -1) return '   <-- did not answer';
  if (r.status >= 500) return '   <-- server error';
  if (/\bat \w+ \(|Error:|node:internal/.test(r.body)) return '   <-- leaked a stack trace';
  return '';
}

let bad = 0;

async function main() {
  const alive = await hit('is anything there?', '/api/alerts');
  if (alive.status === -1) {
    console.log(`\nNothing is listening on ${BASE}. Start it with PORT=3002 pnpm start.\n`);
    return;
  }

  console.log('\nnonsense where a stop code goes');
  const codes: [string, string][] = [
    ['a real code', 'uilP'],
    ['empty', ''],
    ['a very long code', 'x'.repeat(2000)],
    ['path traversal', '..%2F..%2Fetc%2Fpasswd'],
    ['a null byte', 'uilP%00'],
    ['angle brackets', '%3Cscript%3Ealert(1)%3C%2Fscript%3E'],
    ['unicode', '%F0%9F%9A%8C%F0%9F%9A%8C'],
    ['a newline', 'uilP%0D%0AX-Injected:%20yes'],
  ];
  for (const [label, code] of codes) {
    const r = await hit(label, `/api/paradas/${code}/agora`);
    const note = judge(r);
    if (note) bad++;
    line(r, note);
  }

  console.log('\nnonsense where a search goes');
  for (const [label, q] of [
    ['a real street', 'Ronda'],
    ['the length cap, exceeded tenfold', 'a'.repeat(1200)],
    ['regex metacharacters', '('.repeat(500)],
    ['a percent sign on its own', '%'],
  ] as [string, string][]) {
    const r = await hit(label, `/api/stops?q=${encodeURIComponent(q)}`);
    const note = judge(r);
    if (note) bad++;
    line(r, note);
  }

  console.log('\nnonsense where a plan goes');
  for (const [label, qs] of [
    ['two real places', 'from=Praza%20Maior&to=Fontinas'],
    ['neither exists', 'from=zzzz&to=qqqq'],
    ['no parameters at all', ''],
    ['one enormous parameter', 'from=' + 'a'.repeat(3000) + '&to=b'],
  ] as [string, string][]) {
    const r = await hit(label, `/api/plan?${qs}`);
    const note = judge(r);
    if (note) bad++;
    line(r, note);
  }

  console.log('\nfifty at once on the endpoint the app really uses');
  const started = Date.now();
  const burst = await Promise.all(
    Array.from({ length: 50 }, (_, i) => hit(`burst ${i}`, '/api/paradas/uilP/agora')),
  );
  const statuses = burst.reduce<Record<number, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const slowest = Math.max(...burst.map((r) => r.ms));
  console.log(
    `  50 concurrent requests in ${Date.now() - started} ms, slowest ${slowest} ms, ` +
      `statuses ${JSON.stringify(statuses)}`,
  );
  if (burst.some((r) => r.status >= 500 || r.status === -1)) bad++;

  console.log('\nand the rate limiter still says no');
  const flood = await Promise.all(
    Array.from({ length: 40 }, (_, i) => hit(`plan ${i}`, '/api/plan?from=Praza%20Maior&to=Fontinas')),
  );
  const refused = flood.filter((r) => r.status === 429).length;
  console.log(`  40 plans in one window -> ${refused} refused with 429`);
  if (refused === 0) {
    console.log('  <-- nothing was refused; the plan cap is not being applied');
    bad++;
  }

  console.log(`\n${bad === 0 ? 'nothing broke' : `${bad} thing(s) worth looking at`}\n`);
  if (bad) process.exitCode = 1;
}

main();
