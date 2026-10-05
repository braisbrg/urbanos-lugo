/**
 * Do the parsers still read the real pages, and read them the same way capped?
 *
 *   pnpm run check:parsers
 *
 * Four to six requests to other people's servers, so by hand or on the weekly schedule in
 * .github/workflows/check-source.yml, never as a gate on a push. Two things drift without
 * anyone changing a line here: the shape of the pages (no schema on either site, so the
 * only test is whether the server's own parsers still find anything; in service hours one
 * of three busy poles has departures, and outside them nothing proves anything, and the
 * check says which it is), and the capped read against the real transport, which
 * tools/test.ts can only prove locally.
 */
import { parseOperatorTimes } from '../src/services/operatorTimes';
import { extractConcelloNotices } from '../src/services/alertSyncService';
import { readCapped } from '../src/services/readCapped';

const UA = 'Mozilla/5.0 (compatible; UrbanosLugoOpenData/1.0)';
/**
 * Busy poles in three parts of town. A pole's page lists only the buses on their way to it
 * that minute, so a single pole is empty more often than it seems: oTWQ was, at 14:25 and
 * again at 19:53 on a San Froilán Monday, while Zjge listed a 6 in eight minutes.
 */
const POLES = ['uilP', 'Zjge', 'mivY'];
const poleUrl = (code: string) => `https://info.urbanoslugo.com/qr-demo-paradas/${code}`;
/** The page is up and its departures container holds nothing before the closing marker. */
const emptyArea = (page: string) => /<div class="sae-content"[^>]*>\s*<!-- \/app -->/.test(page);
const FEED = 'https://concellodelugo.gal/es/taxonomy/term/707/feed';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '   ' + detail : ''}`);
  if (!ok) failures++;
};

/** Both reads, or the reason there are none: a 403 to a cloud runner recurs every week, a timeout is weather. */
async function bothWays(url: string): Promise<[string, string] | string> {
  try {
    const a = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    if (!a.ok) return `HTTP ${a.status}`;
    const uncapped = await a.text();
    const b = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    if (!b.ok) return `HTTP ${b.status}`;
    return [uncapped, await readCapped(b)];
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    return e.cause?.code ?? e.name;
  }
}

/** One plain read, or the reason there is none. */
async function readOnce(url: string): Promise<string | { error: string }> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    return r.ok ? await r.text() : { error: `HTTP ${r.status}` };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    return { error: e.cause?.code ?? e.name };
  }
}

/**
 * Whether the pole page can be expected to carry departures right now, Lugo time.
 *
 * The first buses leave around 07:15 and the last around 22:45, and the page lists the
 * buses on their way to that pole. Between 08:00 and 21:00 three busy poles all empty is
 * the markup having changed, or the operator publishing nothing; outside those hours it
 * proves nothing either way.
 */
function inServiceHours(now = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/Madrid' }).format(now));
  return hour >= 8 && hour < 21;
}

async function main() {
  console.log('\nthe operator’s stop page');
  const operator = await bothWays(poleUrl(POLES[0]));
  if (typeof operator === 'string') {
    console.log(`  the page could not be read (${operator}); nothing compared, nothing claimed`);
  } else {
    const [uncapped, capped] = operator;
    check('the capped read returns the whole page', uncapped.length === capped.length,
      `${uncapped.length} vs ${capped.length} chars`);
    const before = JSON.stringify(parseOperatorTimes(uncapped));
    const after = JSON.stringify(parseOperatorTimes(capped));
    const n = JSON.parse(before).length;
    check('the same departures come out', before === after, `${n} departure(s) at ${POLES[0]}`);
    // The drift check. In service hours a busy pole has departures, or the markup changed;
    // outside them an empty page is the timetable, and comparing nothing to nothing proves
    // nothing, so it says so rather than print a tick. One empty pole is not enough to say
    // either: on 5 October 2026 it was one gap read as a broken parser, so the next busy
    // pole is asked before anything is claimed, and an empty container is told apart from
    // markup the parser no longer recognises.
    if (inServiceHours()) {
      let found = n;
      let allEmptyAreas = emptyArea(uncapped);
      const asked = [POLES[0]];
      for (const code of POLES.slice(1)) {
        if (found > 0) break;
        const page = await readOnce(poleUrl(code));
        if (typeof page !== 'string') continue; // weather on that one; the others decide
        asked.push(code);
        found = parseOperatorTimes(page).length;
        allEmptyAreas &&= emptyArea(page);
      }
      check('the parser still finds departures at a busy pole, in service hours', found > 0,
        found > 0
          ? `${found} departure(s) at ${asked[asked.length - 1]}`
          : allEmptyAreas
            ? `none at ${asked.join(', ')}: each page is up with its departures area empty, so the operator is publishing nothing (the parser is not the problem)`
            : `none at ${asked.join(', ')}: the markup the parser expects may be gone`);
    } else if (n === 0) {
      console.log('  --   but it is outside service hours and the page carried no departures, so that told us nothing');
    }
  }

  console.log('\nthe council’s traffic feed');
  const feed = await bothWays(FEED);
  if (typeof feed === 'string') {
    console.log(`  the feed could not be read (${feed}); nothing compared, nothing claimed`);
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
