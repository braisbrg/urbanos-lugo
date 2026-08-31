/**
 * Do the parsers still read the real pages the same way after being made linear?
 *
 *   pnpm exec tsx tools/checkParsersUnchanged.ts
 *
 * Changing how a scan walks its input is exactly the change that quietly reads one field
 * differently, and neither of these sites has a schema to check against. So both pages are
 * fetched twice -- once uncapped through res.text() the way it used to be, once through
 * readCapped the way it does now -- and the two results are compared field by field.
 *
 * It also checks the ceiling actually stops the read, because a cap that does not cap is
 * worse than none: it reads as protection in the diff and is not there at run time.
 */
import { parseOperatorTimes } from '../src/services/operatorTimes';
import { extractConcelloNotices } from '../src/services/alertSyncService';
import { readCapped, MAX_BODY_BYTES } from '../src/services/readCapped';

const UA = 'Mozilla/5.0 (compatible; UrbanosLugoOpenData/1.0)';
const OPERATOR = 'https://info.urbanoslugo.com/qr-demo-paradas/oTWQ';
const FEED = 'https://concellodelugo.gal/es/taxonomy/term/701/feed';

let failures = 0;

const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '   ' + detail : ''}`);
  if (!ok) failures++;
};

async function bothWays(url: string): Promise<[string, string] | null> {
  try {
    const a = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    if (!a.ok) return null;
    const uncapped = await a.text();
    const b = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    if (!b.ok) return null;
    return [uncapped, await readCapped(b)];
  } catch {
    return null;
  }
}

async function main() {
  console.log('\nthe operator’s stop page');
  const operator = await bothWays(OPERATOR);
  if (!operator) {
    console.log('  the page could not be read; nothing compared, nothing claimed');
  } else {
    const [uncapped, capped] = operator;
    check('the capped read returns the whole page', uncapped.length === capped.length,
      `${uncapped.length} vs ${capped.length} chars`);
    const before = JSON.stringify(parseOperatorTimes(uncapped));
    const after = JSON.stringify(parseOperatorTimes(capped));
    const n = JSON.parse(before).length;
    check('the same departures come out', before === after, `${n} departure(s)`);
    // Comparing nothing to nothing proves nothing. Outside service hours the page is
    // legitimately empty, and this has to say so rather than print a tick.
    if (n === 0) console.log('  --   but the page carried no departures, so that told us nothing');
  }

  console.log('\nthe council’s bus feed');
  const feed = await bothWays(FEED);
  if (!feed) {
    console.log('  the feed could not be read; nothing compared, nothing claimed');
  } else {
    const [uncapped, capped] = feed;
    check('the capped read returns the whole feed', uncapped.length === capped.length,
      `${uncapped.length} vs ${capped.length} chars`);
    const before = JSON.stringify(extractConcelloNotices(uncapped, true));
    const after = JSON.stringify(extractConcelloNotices(capped, true));
    const n = JSON.parse(before).length;
    check('the same notices come out', before === after, `${n} notice(s)`);
    if (n === 0) console.log('  --   but the feed carried no notices, so that told us nothing');
  }

  console.log('\nthe ceiling');
  // A body well past the cap, served locally so nobody else's bandwidth pays for it.
  const oversized = 'y'.repeat(MAX_BODY_BYTES * 3);
  const fake = new Response(oversized);
  const read = await readCapped(fake);
  check('a body three times the cap is cut off', read.length < oversized.length,
    `${read.length} of ${oversized.length} chars`);
  check('and it keeps at least the cap', read.length >= MAX_BODY_BYTES - 65536,
    `${read.length} chars, cap ${MAX_BODY_BYTES}`);

  console.log('');
  if (failures) process.exitCode = 1;
}

main();
