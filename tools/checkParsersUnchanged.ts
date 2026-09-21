/**
 * Do the parsers still read the real pages, and read them the same way capped?
 *
 *   pnpm run check:parsers
 *
 * Four requests to other people's servers, so this runs by hand or on the weekly
 * schedule in .github/workflows/check-source.yml -- never as a gate on a push. It was one,
 * inside `check:deep`, and a gate that needs somebody else's site is not a gate: offline
 * it said "nothing compared, nothing claimed" and went green.
 *
 * Two things drift here without anyone changing a line in this repository:
 *
 * - the shape of the pages. Neither site has a schema, so the only test is to read them
 *   through the same parsers the server uses and see whether anything comes out. The
 *   pole page carries departures in service hours and nothing outside them, so the
 *   check says when it is looking and when it is not;
 * - the capped read against the real transport. `readCapped` is proven locally in
 *   tools/test.ts, byte by byte and across split characters; this is the same proof
 *   against the chunking the real servers actually send.
 */
import { parseOperatorTimes } from '../src/services/operatorTimes';
import { extractConcelloNotices } from '../src/services/alertSyncService';
import { readCapped } from '../src/services/readCapped';

const UA = 'Mozilla/5.0 (compatible; UrbanosLugoOpenData/1.0)';
const OPERATOR = 'https://info.urbanoslugo.com/qr-demo-paradas/oTWQ';
const FEED = 'https://concellodelugo.gal/es/taxonomy/term/707/feed';

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

/**
 * Whether the pole page can be expected to carry departures right now, Lugo time.
 *
 * The first buses leave around 07:15 and the last around 22:45, and the page lists the
 * next few departures at that pole. Between 08:00 and 21:00 an empty page is the markup
 * having changed, not the timetable; outside those hours it proves nothing either way.
 */
function inServiceHours(now = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/Madrid' }).format(now));
  return hour >= 8 && hour < 21;
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
    // The drift check. In service hours the page has departures or the markup changed;
    // outside them an empty page is the timetable, and comparing nothing to nothing
    // proves nothing, so it says so rather than print a tick.
    if (inServiceHours()) {
      check('the parser still finds departures on the page, in service hours', n > 0,
        n > 0 ? `${n} departure(s)` : 'none: the markup the parser expects may be gone');
    } else if (n === 0) {
      console.log('  --   but it is outside service hours and the page carried no departures, so that told us nothing');
    }
  }

  console.log('\nthe council’s traffic feed');
  const feed = await bothWays(FEED);
  if (!feed) {
    console.log('  the feed could not be read; nothing compared, nothing claimed');
  } else {
    const [uncapped, capped] = feed;
    check('the capped read returns the whole feed', uncapped.length === capped.length,
      `${uncapped.length} vs ${capped.length} chars`);
    const before = JSON.stringify(extractConcelloNotices(uncapped));
    const after = JSON.stringify(extractConcelloNotices(capped));
    const n = JSON.parse(before).length;
    check('the same notices come out', before === after, `${n} notice(s)`);
    // The feed is a feed whatever the week holds: items or not, it has <item> elements
    // and a <channel>, and losing those is the shape changing under the parser.
    const items = (uncapped.match(/<item\b/gi) ?? []).length;
    check('the feed still has the shape of a feed', /<channel\b/i.test(uncapped) && items > 0,
      `${items} item(s) in the raw feed, ${n} of them closures or diversions from the last week`);
  }

  console.log('');
  if (failures) process.exitCode = 1;
}

main();
