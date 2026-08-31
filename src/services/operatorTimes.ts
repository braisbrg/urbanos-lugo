/** Server-side only: the operator sends no CORS header, so a browser cannot ask directly. */
import { REPO_URL } from '../project';

/**
 * What the operator says is coming, stop by stop.
 *
 * Behind the QR sticker on every pole is `info.urbanoslugo.com/qr-demo-paradas/<code>`,
 * keyed by the very codes this app already uses — checked across forty stops spread
 * through the network on 28 Aug 2026, and all forty answered, fifteen of them poles that
 * carry no QR token in our own data.
 *
 * Whether those minutes are a vehicle's position or something else is not settled in
 * writing, so nothing here calls them measured. What is certain is who said them, and
 * that is what the interface says: the operator's number, beside ours.
 *
 * Two observations, neither of them proof:
 *  - Their countdown stalls and drops two minutes in sixty-one seconds. A countdown from
 *    a fixed departure time cannot do that; it falls one minute per minute and nothing
 *    else. So the number is being recomputed against something that moves.
 *  - Their markup calls itself `sae-`, which in this industry is *sistema de ayuda a la
 *    explotación* — the fleet system that knows where the buses are.
 *
 * Their robots.txt is an empty `Disallow:`, which is a machine-readable yes. This still
 * asks once per stop somebody actually opens, cached for twenty seconds, which is less
 * than their own page asks for itself every thirty.
 */

const ENDPOINT = 'https://info.urbanoslugo.com/qr-demo-paradas';
const UA = `UrbanosLugoBot/1.0 (+${REPO_URL}; unofficial timetable reader)`;

import { readCapped } from './readCapped';

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

/**
 * Their page is HTML for a phone, not an API, but it is honestly marked up: one
 * `sae-content-info` block per departure, each field in its own classed div. Reading the
 * classes beats counting cells, which mistook that AVENIDA label for a stray fragment.
 */
export function parseOperatorTimes(html: string): OperatorDeparture[] {
  const text = (block: string, cls: string): string => {
    const m = new RegExp(`class="${cls}"[\\s\\S]*?<p>([\\s\\S]*?)</p>`, 'i').exec(block);
    return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  };

  // ponytail: this scan is quadratic on markup whose blocks never close -- 101 ms for
  // 256 KB, 1.6 s for a megabyte. The ceiling is readCapped's 512 KB, so the worst case is
  // about 400 ms, once per stop per 20 s cache window, on a self-hosted server only. Left
  // as it is because the bound is real and the linear rewrite is fiddlier than the regex;
  // walk it with indexOf the way the RSS scan is if that ever stops being true.
  const departures: OperatorDeparture[] = [];
  for (const block of html.match(/<div class="sae-content-info">[\s\S]*?<\/div>\s*<\/div>/g) ?? []) {
    const minutes = /^(\d+)/.exec(text(block, 'sae-content-info-time'));
    if (!minutes) continue;
    departures.push({
      line: text(block, 'sae-content-info-line').replace(/^L(?=[\d])/i, '').trim(),
      towards: text(block, 'sae-content-info-itinerary'),
      minutes: Number(minutes[1]),
    });
  }
  return departures;
}

const cache = new Map<string, OperatorTimes>();

/**
 * Null rather than an empty list when the page cannot be read.
 *
 * "No departures" and "we could not ask" are different things, and this app does not get
 * to round the second down to the first — the same rule the service notices follow.
 */
export async function operatorTimesForStop(code: string): Promise<OperatorTimes | null> {
  const cached = cache.get(code);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL_MS) return cached;

  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(code)}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const result: OperatorTimes = {
      code,
      departures: parseOperatorTimes(await readCapped(res)),
      fetchedAt: new Date().toISOString(),
    };
    cache.set(code, result);
    return result;
  } catch {
    return null;
  }
}
