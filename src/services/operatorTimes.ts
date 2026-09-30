/**
 * What the operator says is coming, stop by stop. Server-side only: they send no CORS header.
 *
 * Behind the QR sticker on every pole is `info.urbanoslugo.com/qr-demo-paradas/<code>`,
 * keyed by the codes this app already uses. Whether those minutes are a vehicle's
 * position is not settled in writing (their countdown drops two minutes in sixty-one
 * seconds, and their markup calls itself `sae-`), so nothing here calls them measured:
 * they are what the operator says, and the interface says so. Their robots.txt is an
 * empty `Disallow:`; this asks once per stop somebody opens, cached for twenty seconds.
 */
import { REPO_URL } from '../project';
import { poleCode } from '../data/transitData';
import { findStop } from '../utils/places';
import { asciiLower, plainText } from '../utils/html';
import { readCapped } from './readCapped';

const ENDPOINT = 'https://info.urbanoslugo.com/qr-demo-paradas';
const UA = `UrbanosLugoBot/1.0 (+${REPO_URL}; unofficial timetable reader)`;
/** Their own page refreshes every 30 s, so nothing is gained by asking more often. */
const CACHE_TTL_MS = 20_000;

export interface OperatorDeparture {
  /** "3.1", or occasionally a word: they label one service AVENIDA rather than 5.1. */
  line: string;
  /** The corridor, as they write it: "TOLDA-MONTIRON-FONTIÑAS-SINDICATOS-MURALLA". */
  towards: string;
  minutes: number;
}

export interface OperatorTimes {
  code: string;
  departures: OperatorDeparture[];
  /** ISO instant. The view says when, rather than implying "now". */
  fetchedAt: string;
}

const BLOCK_OPEN = '<div class="sae-content-info">';

/**
 * Each departure block: from its opening to the first `</div>` followed, past any
 * whitespace, by a second one. Walked with indexOf, because the lazy pattern it replaces
 * backtracked from every opening that never closed -- half a second at the 512 KB
 * readCapped allows, which was reckoned as "once per stop every 20 s" while a server reads
 * every coded pole in the network and the Deno worker runs the same code.
 */
function* departureBlocks(html: string): Generator<string> {
  for (let from = 0; ; ) {
    const start = html.indexOf(BLOCK_OPEN, from);
    if (start === -1) return;
    let end = -1;
    for (let at = html.indexOf('</div>', start); at !== -1 && end === -1; at = html.indexOf('</div>', at + 6)) {
      let next = at + 6;
      while (next < html.length && /\s/.test(html[next])) next++;
      if (html.startsWith('</div>', next)) end = next + 6;
    }
    // No pair anywhere after this opening means none after any later one either.
    if (end === -1) return;
    yield html.slice(start, end);
    from = end;
  }
}

/** The text of the first `<p>` after `class="cls"`, found the same way. */
function classedText(block: string, lower: string, cls: string): string {
  const at = lower.indexOf(`class="${cls}"`);
  const open = at === -1 ? -1 : lower.indexOf('<p>', at);
  const close = open === -1 ? -1 : lower.indexOf('</p>', open + 3);
  return close === -1 ? '' : plainText(block.slice(open + 3, close), '');
}

/**
 * Their page is HTML for a phone, honestly marked up: one `sae-content-info` block per
 * departure, each field in its own classed div.
 */
export function parseOperatorTimes(html: string): OperatorDeparture[] {
  const departures: OperatorDeparture[] = [];
  for (const block of departureBlocks(html)) {
    const lower = asciiLower(block);
    const text = (cls: string) => classedText(block, lower, cls);
    const minutes = /^(\d+)/.exec(text('sae-content-info-time'));
    if (!minutes) continue;
    departures.push({
      line: text('sae-content-info-line').replace(/^L(?=[\d])/i, '').trim(),
      towards: text('sae-content-info-itinerary'),
      minutes: Number(minutes[1]),
    });
  }
  return departures;
}

const cache = new Map<string, OperatorTimes>();
/** Concurrent misses wait for the same read: fifty at once on a cold cache were fifty outbound requests and fifty 502s. */
const inFlight = new Map<string, Promise<OperatorTimes | null>>();

/** Null rather than an empty list when the page cannot be read: "no departures" and "we could not ask" are different things. */
export async function operatorTimesForStop(code: string): Promise<OperatorTimes | null> {
  const cached = cache.get(code);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS) return cached;
  const already = inFlight.get(code);
  if (already) return already;

  const read = (async (): Promise<OperatorTimes | null> => {
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(code)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const result: OperatorTimes = { code, departures: parseOperatorTimes(await readCapped(res)), fetchedAt: new Date().toISOString() };
      cache.set(code, result);
      return result;
    } catch {
      return null;
    } finally {
      inFlight.delete(code); // a failed read is retried by the next caller, not cached
    }
  })();
  inFlight.set(code, read);
  return read;
}

/**
 * The answer to "the operator's minutes at this stop", shared by the express route and the
 * Deno worker so the two deployments cannot disagree. Only stops this app knows about:
 * otherwise either deployment could fire arbitrary codes at the operator's site.
 */
export async function operatorTimesResponse(rawCode: string): Promise<{ status: number; body: unknown }> {
  const stop = findStop(rawCode);
  if (!stop) return { status: 404, body: { error: 'Unknown stop' } };
  const code = poleCode(stop);
  if (!code) return { status: 404, body: { error: 'That stop has no operator code' } };
  const times = await operatorTimesForStop(code);
  // Null means their page could not be read: 502, so the app shows only its own estimates.
  if (!times) return { status: 502, body: { error: 'The operator could not be read' } };
  return { status: 200, body: times };
}
