/**
 * Do the parsers still read the real pages the same way through readCapped as through an
 * uncapped res.text()? Neither site has a schema to check against, so each page is fetched
 * both ways and the parsed results compared field by field. It also checks the ceiling
 * actually stops the read: a cap that does not cap is worse than none.
 *
 *   pnpm exec tsx tools/checkParsersUnchanged.ts
 */
import { parseOperatorTimes } from '../src/services/operatorTimes';
import { extractConcelloNotices } from '../src/services/alertSyncService';
import { readCapped, MAX_BODY_BYTES } from '../src/services/readCapped';

const UA = 'Mozilla/5.0 (compatible; UrbanosLugoOpenData/1.0)';

const SOURCES: { title: string; url: string; kind: string; unit: string; parse: (body: string) => unknown[] }[] = [
  { title: 'the operator’s stop page', kind: 'page', unit: 'departure', parse: parseOperatorTimes,
    url: 'https://info.urbanoslugo.com/qr-demo-paradas/oTWQ' },
  { title: 'the council’s traffic feed', kind: 'feed', unit: 'notice', parse: extractConcelloNotices,
    url: 'https://concellodelugo.gal/es/taxonomy/term/707/feed' },
];

let failures = 0;

const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '   ' + detail : ''}`);
  if (!ok) failures++;
};

const get = (url: string) => fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });

async function bothWays(url: string): Promise<[string, string] | null> {
  try {
    const a = await get(url);
    if (!a.ok) return null;
    const uncapped = await a.text();
    const b = await get(url);
    if (!b.ok) return null;
    return [uncapped, await readCapped(b)];
  } catch {
    return null;
  }
}

async function main() {
  for (const { title, url, kind, unit, parse } of SOURCES) {
    console.log(`\n${title}`);
    const both = await bothWays(url);
    if (!both) {
      console.log(`  the ${kind} could not be read; nothing compared, nothing claimed`);
      continue;
    }
    const [uncapped, capped] = both;
    check(`the capped read returns the whole ${kind}`, uncapped.length === capped.length,
      `${uncapped.length} vs ${capped.length} chars`);
    const parsed = parse(uncapped);
    check(`the same ${unit}s come out`, JSON.stringify(parsed) === JSON.stringify(parse(capped)),
      `${parsed.length} ${unit}(s)`);
    // Comparing nothing to nothing proves nothing: outside service hours the page is
    // legitimately empty, and that has to be said rather than ticked.
    if (parsed.length === 0) console.log(`  --   but the ${kind} carried no ${unit}s, so that told us nothing`);
  }

  console.log('\nthe ceiling');
  // A body well past the cap, served locally so nobody else's bandwidth pays for it.
  const oversized = 'y'.repeat(MAX_BODY_BYTES * 3);
  const read = await readCapped(new Response(oversized));
  check('a body three times the cap is cut off', read.length < oversized.length,
    `${read.length} of ${oversized.length} chars`);
  check('and it keeps at least the cap', read.length >= MAX_BODY_BYTES - 65536,
    `${read.length} chars, cap ${MAX_BODY_BYTES}`);

  console.log('');
  if (failures) process.exitCode = 1;
}

main();
