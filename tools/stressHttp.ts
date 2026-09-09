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

  /*
   * Where it stops keeping up.
   *
   * One burst says it survived fifty; it does not say what the ceiling is, and "it holds"
   * is not a number. So the same request is fired at rising concurrency until something
   * gives.
   *
   * What gives is the rate limiter, and that is the answer rather than a problem with the
   * measurement: `app.use('/api', rateLimit)` caps one address at 120 requests a minute, so
   * a client asking harder than that is refused rather than served slowly. The first
   * attempt at this ran the ramp before the limiter check above and spent that budget, which
   * turned "14 of 40 refused" into "40 of 40" -- so it runs last, and waits out the window
   * first, or it measures its own footprints.
   *
   * The arrival board rather than the operator proxy: `/agora` answers from a 20 s cache and
   * would measure the cache, while the board is computed from the dataset on every request,
   * which is the work this server actually does.
   */
  console.log('\nwhere it stops keeping up (arrival board, rising concurrency)');
  console.log('  waiting out the rate-limit window so this measures the server, not the last test...');
  await new Promise((r) => setTimeout(r, 61_000));

  const quantile = (xs: number[], q: number) =>
    [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * q))];
  let served = 0;
  let firstRefusalAt = 0;
  for (const level of [1, 10, 25, 50, 100, 200]) {
    const at = Date.now();
    const wave = await Promise.all(
      Array.from({ length: level }, (_, i) => hit(`n${level}-${i}`, '/api/arrivals/uilP')),
    );
    const elapsed = Math.max(1, Date.now() - at);
    const ok200 = wave.filter((r) => r.status === 200);
    const refused = wave.filter((r) => r.status === 429).length;
    const failed = wave.filter((r) => r.status >= 500 || r.status === -1).length;
    served += ok200.length;
    if (refused && !firstRefusalAt) firstRefusalAt = level;

    const ms = ok200.map((r) => r.ms);
    console.log(
      `  ${String(level).padStart(3)} at once   ${String(ok200.length).padStart(3)} served   ` +
        (ms.length
          ? `p50 ${String(quantile(ms, 0.5)).padStart(4)} ms   p95 ${String(quantile(ms, 0.95)).padStart(4)} ms   ` +
            `p99 ${String(quantile(ms, 0.99)).padStart(4)} ms   ${((ok200.length / elapsed) * 1000).toFixed(0).padStart(4)} req/s`
          : '                                              ') +
        `${refused ? `   ${String(refused).padStart(3)} refused` : ''}${failed ? `   <-- ${failed} failed` : ''}`,
    );
    if (failed) bad++;
  }
  console.log(
    `  ${served} served before the cap, first refusal at ${firstRefusalAt || 'no'} concurrent. ` +
      'The ceiling is the limiter, not the CPU: over it the server refuses rather than queues.',
  );

  console.log(`\n${bad === 0 ? 'nothing broke' : `${bad} thing(s) worth looking at`}\n`);
  if (bad) process.exitCode = 1;
}

main();
