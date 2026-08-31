/**
 * What the two HTML/XML parsers do when the page they are handed is hostile.
 *
 *   pnpm exec tsx tools/stressParsers.ts
 *
 * Both read `await res.text()` with no size cap, and both find their fields with lazy
 * `[\s\S]*?` runs. That pairing is worth measuring rather than arguing about: a lazy run
 * that never finds its closing tag backtracks from every start position, which is
 * quadratic, and a body with no ceiling decides how big n is.
 *
 * Neither is reachable from a browser -- these run on the server, against buslugo.com and
 * concellodelugo.gal. So the threat is not a stranger; it is those sites having a bad day,
 * or being replaced by something that answers with a megabyte of angle brackets. The
 * question this answers is what happens then: a slow response, or a server that stops.
 */
import { parseOperatorTimes } from '../src/services/operatorTimes';
import { extractConcelloNotices } from '../src/services/alertSyncService';

const time = (label: string, run: () => unknown): number => {
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
  return ms;
};

console.log('\noperatorTimes.parseOperatorTimes');

// The shape it expects, repeated. This is the "it is fine" baseline.
const goodBlock =
  '<div class="sae-content-info">' +
  '<div class="sae-content-info-line"><p>3.1</p></div>' +
  '<div class="sae-content-info-destination"><p>TOLDA-MONTIRON</p></div>' +
  '<div class="sae-content-info-time"><p>4</p></div>' +
  '</div></div>';
for (const n of [10, 100, 1000]) {
  time(`${n} well-formed departures`, () => parseOperatorTimes(goodBlock.repeat(n)));
}

// The class is there and the <p> never is: the lazy run has to walk to the end of the
// block from every start, which is where a quadratic cost would show.
for (const kb of [64, 256, 1024]) {
  const filler = 'x'.repeat(kb * 1024);
  const block =
    '<div class="sae-content-info">' +
    '<div class="sae-content-info-line">' + filler + '</div>' +
    '</div></div>';
  time(`${kb} KB block, class present, no <p> to close it`, () => parseOperatorTimes(block));
}

// Opening tags that never close: `match` has to fail across the whole string.
for (const kb of [64, 256, 1024]) {
  const opens = '<div class="sae-content-info">'.repeat((kb * 1024) / 30);
  time(`${kb} KB of unclosed sae-content-info opens`, () => parseOperatorTimes(opens));
}

// Sheer size, well formed. This is what "no cap on res.text()" costs on a good day.
for (const mb of [1, 4, 16]) {
  const big = goodBlock.repeat((mb * 1024 * 1024) / goodBlock.length);
  time(`${mb} MB of well-formed departures`, () => parseOperatorTimes(big));
}

console.log('\nalertSyncService.extractConcelloNotices');

const item = (body: string) =>
  `<item><title>Corte de tráfico na rúa Nova</title><description>${body}</description>` +
  `<pubDate>${new Date(Date.now() - 86400000).toUTCString()}</pubDate>` +
  `<link>https://concellodelugo.gal/x</link></item>`;

for (const n of [10, 100, 1000]) {
  time(`${n} well-formed items`, () =>
    extractConcelloNotices(`<rss><channel>${item('corpo').repeat(n)}</channel></rss>`));
}

// Entity-encoded markup is decoded before tags are stripped, so a body that is nothing but
// entities is the worst case for that pass.
for (const kb of [64, 256, 1024]) {
  time(`${kb} KB of entity-encoded markup in one item`, () =>
    extractConcelloNotices(`<rss><channel>${item('&lt;p&gt;'.repeat((kb * 1024) / 8))}</channel></rss>`));
}

// An <item> that never closes.
for (const kb of [64, 256, 1024]) {
  const opens = '<item><title>x</title>'.repeat((kb * 1024) / 22);
  time(`${kb} KB of unclosed items`, () => extractConcelloNotices(`<rss><channel>${opens}`));
}

console.log('');
