/**
 * What the two HTML/XML parsers do when the page they are handed is hostile.
 *
 *   pnpm exec tsx tools/stressParsers.ts
 *
 * Both find their fields with lazy `[\s\S]*?` runs, and a lazy run that never finds its
 * closing tag backtracks from every start position, which is quadratic. Neither is
 * reachable from a browser: the threat is buslugo.com or concellodelugo.gal having a bad
 * day, or answering with a megabyte of angle brackets. This says whether that is a slow
 * response or a server that stops.
 */
import { extractConcelloNotices } from '../src/services/alertSyncService';
import { parseOperatorTimes } from '../src/services/operatorTimes';

const time = (label: string, run: () => unknown): void => {
  const started = process.hrtime.bigint();
  let note = '';
  try {
    const out = run();
    note = Array.isArray(out) ? `${out.length} item(s)` : String(out).slice(0, 30);
  } catch (error) {
    note = `threw ${(error as Error).message.slice(0, 40)}`;
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`  ${label.padEnd(52)} ${ms.toFixed(0).padStart(7)} ms   ${note}`);
};

const KB = [64, 256, 1024];

console.log('\noperatorTimes.parseOperatorTimes');
const goodBlock =
  '<div class="sae-content-info">' +
  '<div class="sae-content-info-line"><p>3.1</p></div>' +
  '<div class="sae-content-info-destination"><p>TOLDA-MONTIRON</p></div>' +
  '<div class="sae-content-info-time"><p>4</p></div>' +
  '</div></div>';
for (const n of [10, 100, 1000]) time(`${n} well-formed departures`, () => parseOperatorTimes(goodBlock.repeat(n)));
// The class is there and the <p> never is: the lazy run walks to the end from every start.
for (const kb of KB) {
  const block = '<div class="sae-content-info"><div class="sae-content-info-line">' + 'x'.repeat(kb * 1024) + '</div></div></div>';
  time(`${kb} KB block, class present, no <p> to close it`, () => parseOperatorTimes(block));
}
// Opening tags that never close: `match` has to fail across the whole string.
for (const kb of KB) time(`${kb} KB of unclosed sae-content-info opens`, () => parseOperatorTimes('<div class="sae-content-info">'.repeat((kb * 1024) / 30)));
// Sheer size, well formed: what "no cap on res.text()" costs on a good day.
for (const mb of [1, 4, 16]) time(`${mb} MB of well-formed departures`, () => parseOperatorTimes(goodBlock.repeat((mb * 1024 * 1024) / goodBlock.length)));

console.log('\nalertSyncService.extractConcelloNotices');
const item = (body: string) =>
  `<item><title>Corte de tráfico na rúa Nova</title><description>${body}</description><pubDate>${new Date(Date.now() - 86400000).toUTCString()}</pubDate><link>https://concellodelugo.gal/x</link></item>`;
const feed = (items: string) => `<rss><channel>${items}</channel></rss>`;
for (const n of [10, 100, 1000]) time(`${n} well-formed items`, () => extractConcelloNotices(feed(item('corpo').repeat(n))));
// Entity-encoded markup is decoded before tags are stripped: the worst case for that pass.
for (const kb of KB) time(`${kb} KB of entity-encoded markup in one item`, () => extractConcelloNotices(feed(item('&lt;p&gt;'.repeat((kb * 1024) / 8)))));
for (const kb of KB) time(`${kb} KB of unclosed items`, () => extractConcelloNotices(`<rss><channel>${'<item><title>x</title>'.repeat((kb * 1024) / 22)}`));

console.log('\nthe operator home page scans: the pattern that was, and the walk that is');
// The home-page scans are not exported, so the two shapes are measured side by side: the
// lazy pattern they used, and the indexOf walk they use now. 512 KB is readCapped's ceiling.
const walk = (text: string, open: string, close: string): number => {
  const lower = text.toLowerCase();
  let n = 0;
  for (let from = 0; ; ) {
    const start = lower.indexOf(open, from);
    if (start === -1) return n;
    const end = lower.indexOf(close, start);
    if (end === -1) return n;
    n++;
    from = end + close.length;
  }
};
for (const [tag, unit] of [
  ['article', '<article class="x">'],
  ['li', '<li class="x">'],
] as const) {
  for (const kb of [256, 512]) {
    const opens = unit.repeat((kb * 1024) / unit.length);
    const pattern = new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, 'gi');
    time(`${kb} KB unclosed <${tag}>  was: lazy pattern`, () => (opens.match(pattern) || []).length);
    time(`${kb} KB unclosed <${tag}>  now: indexOf walk`, () => walk(opens, `<${tag}`, `</${tag}>`));
  }
}

console.log('');
