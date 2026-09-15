/** Server-side only: the browser cannot fetch buslugo.com because of CORS. */
import { readCapped } from './readCapped';
import { plainText } from '../utils/html';
import { ServiceAlert } from '../types';
import { REPO_URL } from '../project';

export interface AlertSyncResult {
  alerts: ServiceAlert[];
  /** ISO instant of the sync. Formatted for the reader's locale in the view. */
  lastSyncTime: string;
  sourceUrl: string;
  /**
   * `unreachable` is not a synonym for "nothing wrong". It says the operator's page
   * could not be read, which is the one thing this app must never round down to "all
   * normal" — a network blip during the hourly job would otherwise replace real service
   * notices with a claim that everything is running.
   */
  status: 'operational_normal' | 'active_incidents' | 'unreachable';
  message: string;
  /**
   * Present only on the snapshot committed by the scheduled job, which is what a static
   * deploy reads when there is no server to ask. The type used to omit it, so the view
   * needed a double cast through `unknown` to load its own data file.
   */
  fetchedAt?: string;
}

let cachedAlerts: AlertSyncResult | null = null;
let lastFetchTimestamp = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache
const MIN_OUTBOUND_INTERVAL_MS = 60 * 1000; // 60 seconds minimum cooldown between external requests to buslugo.com

/**
 * An answer is held for half an hour; a failure only for the outbound cooldown.
 *
 * They were held alike, so one timed-out read of buslugo.com -- a six-second hiccup --
 * was served as "we could not read the operator's page" to everyone for the next thirty
 * minutes, with the notices it had replaced gone from the cache. A failure is a fact
 * about one moment, and a minute later it is worth asking again.
 */
function cacheHolds(cached: AlertSyncResult, elapsed: number, forceRefresh: boolean): boolean {
  if (elapsed < MIN_OUTBOUND_INTERVAL_MS) return true;
  return !forceRefresh && cached.status !== 'unreachable' && elapsed < CACHE_TTL_MS;
}


/**
 * The city's traffic notices, and nothing else of the city's.
 *
 * The Concello publishes a press feed per subject tag (`/es/taxonomy/term/N/feed` is the
 * one that answers with RSS). Three of them were read -- Buses urbanos, Obras, Tráfico --
 * and audited on 15 September 2026 against what they had carried in sixty days: the bus
 * tag was ridership records, plan presentations and a note about emergency services, with
 * one operational item in a year; the works tag gave one political statement about a
 * street Adif had shut; the traffic tag gave the road closures for a Saturday race -- the
 * one thing a passenger could use, and it would have stayed on screen for two months
 * after the race. So: the traffic tag alone, only headlines announcing a closure, a
 * diversion or a restriction, and only for a week, which is how long such a thing lasts.
 */
const CONCELLO_FEED_URL = 'https://concellodelugo.gal/es/taxonomy/term/707/feed';

/** Seven days. A closure or a diversion is news for about that long; after it, history. */
const CONCELLO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a headline announces something that changes how you get around.
 *
 * Only the headline: matching the body as well let through a police communiqué and a
 * speech about sustainable architecture, both of which mention the streets in passing.
 * And only the event words. "Tráfico" on its own matched the council signing an agreement
 * with the Jefatura Provincial de Tráfico about road-safety courses; "apertura" matched a
 * demand that Adif reopen a street, which is a position, not a change. A real closure says
 * corte or cierre, a real diversion says desvío, a restriction says so.
 */
const ABOUT_GETTING_AROUND =
  /\b(cortes?|cortad[oa]s?|cierres?|cerrad[oa]s?|peches?|pechad[oa]s?|desv[íi]os?|desviad[oa]s?|restricci[óo]n(?:es)?|restrici[óo]ns?)\b/i;

/**
 * Plain prose out of an RSS field.
 *
 * The council's feed carries its body as entity-encoded markup — `&lt;div class=&quot;field
 * field-name-field-entradilla&quot;&gt;` and onwards. Stripping tags is not enough, because
 * at that point there are no tags: there is text that looks like tags. Decode first, then
 * strip, then collapse. Otherwise the reader is shown Drupal's internals, which is what
 * happened, in a line long enough to push the card off the side of the screen.
 *
 * Rendered as text by React, never as HTML, so decoding introduces nothing.
 */
function decodedText(raw: string): string {
  const decoded = raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    // Last, so an escaped `&amp;lt;` does not become a tag on the way through.
    .replace(/&amp;/g, '&');
  return plainText(decoded);
}

/** A press release runs for pages; a card wants the first thought. */
const CONCELLO_EXCERPT = 220;

/**
 * Each `<open ... </close>` block, in one pass.
 *
 * Replaces three patterns of the shape `/<tag[\s\S]*?<\/tag>/gi`. That run restarts from
 * every opening tag and scans to the end of the string when the closing one never comes,
 * which is quadratic. Measured on markup whose tags never close, at the 512 KB ceiling
 * `readCapped` allows: `<item>` cost 13.2 seconds for a megabyte, `<article>` 3.8 seconds
 * and `<li>` 4.0 seconds. A truncated page or a CDN error page is enough to trigger it,
 * and buslugo.com's home page runs two of the three.
 *
 * `lower` is the same string lower-cased, passed in so a caller scanning twice does not
 * lower-case twice; it keeps the old patterns' case-insensitivity without a second pass.
 */
function* blocks(text: string, lower: string, open: string, close: string): Generator<string> {
  for (let from = 0; ; ) {
    const start = lower.indexOf(open, from);
    if (start === -1) return;
    const end = lower.indexOf(close, start);
    if (end === -1) return;
    yield text.slice(start, end + close.length);
    from = end + close.length;
  }
}

export function extractConcelloNotices(xml: string): ServiceAlert[] {
  const field = (block: string, name: string): string => {
    const m = new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, 'i').exec(block);
    return m ? decodedText(m[1]) : '';
  };

  const notices: ServiceAlert[] = [];
  // Walked with indexOf rather than matched with /<item>[\s\S]*?<\/item>/g. The lazy run
  // in that pattern restarts from every `<item>` and scans to the end when the closing tag
  // is missing, which is quadratic: measured at 55 ms for 64 KB of unclosed items, 808 ms
  // for 256 KB and 13.2 seconds for a megabyte. A truncated feed is enough to cause it.
  // The lower-cased copy keeps the old pattern's case-insensitivity without a second scan.
  const haystack = xml.toLowerCase();
  for (const block of blocks(xml, haystack, '<item>', '</item>')) {
    const title = field(block, 'title');
    if (!title) continue;
    if (!ABOUT_GETTING_AROUND.test(title)) continue;

    // Their pubDate is RFC 822 and occasionally missing a timezone. An unparseable or an
    // old one is dropped rather than shown: the feed holds ten items going back more than
    // a year, and last month's race closure beside an incident happening now would read as
    // if both were current.
    const published = new Date(field(block, 'pubDate'));
    if (Number.isNaN(published.getTime())) continue;
    if (Date.now() - published.getTime() > CONCELLO_MAX_AGE_MS) continue;

    notices.push({
      id: `concello-${notices.length + 1}`,
      title: title.length > 110 ? `${title.slice(0, 107)}...` : title,
      severity: 'info',
      linesAffected: ['Todas'],
      date: published.toISOString(),
      description: (() => {
        const body = field(block, 'description');
        return body.length > CONCELLO_EXCERPT ? `${body.slice(0, CONCELLO_EXCERPT - 1)}…` : body;
      })(),
      active: true,
      source: 'concello',
      link: field(block, 'link') || undefined,
    });
  }
  return notices;
}

/**
 * Best effort, and deliberately so: the operator's notices are the ones that matter, and
 * nothing here may take them down with it. One request per sync against the council's
 * traffic feed, with a User-Agent that says who is asking.
 */
async function fetchConcelloNotices(): Promise<ServiceAlert[]> {
  const headers = { 'User-Agent': `UrbanosLugoBot/1.0 (+${REPO_URL}; unofficial timetable reader)` };
  try {
    const res = await fetch(CONCELLO_FEED_URL, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    return extractConcelloNotices(await readCapped(res)).sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

/** Warnings rather than notes: something is being held up, cut or withdrawn. */
const SERIOUS = /retenc|corte|peche|suprim|desv[ií]o|cancel/i;

/** "Liña 1.2", "L5", "L-4.1" — whatever the notice happens to call them. */
function linesNamedIn(text: string): string[] {
  return Array.from(
    new Set(
      (text.match(/(?:liña|l[ií]nea|L-?)\s*([0-9]+(?:\.[0-9]+)?(?:ES|DS)?)/gi) || []).map((s) =>
        s.replace(/(?:liña|l[ií]nea|L-?)\s*/i, '').trim(),
      ),
    ),
  );
}

/**
 * The notices the operator puts in its own navigation bar.
 *
 * buslugo.com does not publish incidents as articles or as a feed. It publishes them as a
 * bell in the top navigation: a red badge carrying the count, and a `msg_list` dropdown
 * holding one list item per notice. Nothing in that markup says "alert" to a general
 * scraper, which is exactly how this went wrong — the page was read, no <article> was
 * found, and the app told people the network was running normally on a day the operator's
 * own header read "Retenciones en zona Estación Tren".
 *
 * That is the worst direction for this to fail in. An alert we cannot parse is a missing
 * warning; silence reported as "everything normal" is a wrong one.
 */
function extractNavNotices(html: string): ServiceAlert[] {
  const list = html.match(/<ul[^>]*class="[^"]*msg_list[^"]*"[^>]*>([\s\S]*?)<\/ul>/i);
  if (!list) return [];

  const notices: ServiceAlert[] = [];
  const inner = list[1];
  for (const item of blocks(inner, inner.toLowerCase(), '<li', '</li>')) {
    const text = plainText(item);
    // The dropdown holds a bare "no notices" item on a quiet day in some templates, and
    // an empty <li> in others. Neither is an incident.
    if (text.length < 6) continue;

    notices.push({
      id: `nav-notice-${notices.length + 1}`,
      title: text.length > 90 ? `${text.slice(0, 87)}...` : text,
      severity: SERIOUS.test(text) ? 'warning' : 'info',
      linesAffected: linesNamedIn(text).length > 0 ? linesNamedIn(text) : ['Todas'],
      // An ISO instant, not a formatted date: one scrape serves every language.
      date: new Date().toISOString(),
      description: text,
      active: true,
    });
  }
  return notices;
}

/**
 * Parses raw HTML or text from buslugo.com to detect any active service notices or traffic alerts.
 */
export function extractAlertsFromHtml(html: string): ServiceAlert[] {
  const alerts: ServiceAlert[] = extractNavNotices(html);
  
  // Look for alert containers or notices in buslugo HTML
  const matches = [...blocks(html, html.toLowerCase(), '<article', '</article>')];

  for (let i = 0; i < matches.length; i++) {
    const block = matches[i];
    const cleanText = plainText(block);
    
    // Check if it contains alert keywords
    if (/desv[ií]o|corte|obras|reforzo|aviso|modificaci[oó]n|parada/i.test(cleanText) && cleanText.length > 20) {
      // Extract title if possible
      const titleMatch = block.match(/<h[234][^>]*>(.*?)<\/h[234]>/i);
      const title = titleMatch ? plainText(titleMatch[1], '') : `Aviso de servizo en Lugo`;
      
      const linesFound = linesNamedIn(cleanText);

      alerts.push({
        id: `article-alert-${i + 1}`,
        title,
        severity: SERIOUS.test(cleanText) ? 'warning' : 'info',
        linesAffected: linesFound.length > 0 ? linesFound : ['Todas'],
        // An ISO instant, not a formatted date. This payload is scraped once on the
        // server and served to every reader, so it cannot carry one language's format;
        // the view formats it with the reader's locale.
        date: new Date().toISOString(),
        description: cleanText.length > 250 ? cleanText.slice(0, 247) + '...' : cleanText,
        active: true,
      });
    }
  }

  return alerts;
}

/**
 * Synchronizes real alerts from official sources:
 * 1. https://buslugo.com/ (AULUSA Monbus portal)
 * 2. concellodelugo.gal / datosabertos.lugo.gal
 * 
 * Enforces rate limiting: Max 1 external request per 60 seconds.
 */
export async function syncOfficialAlerts(forceRefresh = false, now = Date.now()): Promise<AlertSyncResult> {
  // Share one outbound request between everyone waiting for it.
  //
  // The cooldown below only applies once there IS a cache, so on a cold start every
  // request that arrives before the first response returns went out to buslugo.com on
  // its own. Small window, well-known shape: hold the promise and hand it to whoever
  // asks meanwhile.
  if (inFlight) return inFlight;

  // `now` is a parameter so a test can move the clock; nothing else passes it.
  if (cachedAlerts && cacheHolds(cachedAlerts, now - lastFetchTimestamp, forceRefresh)) {
    return cachedAlerts;
  }

  inFlight = fetchAlerts(now);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

let inFlight: Promise<AlertSyncResult> | null = null;

async function fetchAlerts(now: number): Promise<AlertSyncResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    // Fetch official portal
    const response = await fetch('https://buslugo.com/', {
      signal: controller.signal,
      headers: {
        // Say what this actually is. The previous value read "(OpenData; Concello de
        // Lugo)", which tells the operator's server that the city council is calling —
        // it is not, and DATA.md says so in as many words. A scraper should be
        // identifiable and honest about who it is.
        'User-Agent': `UrbanosLugoBot/1.0 (+${REPO_URL}; unofficial timetable reader)`,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      // Capped like the other two outbound reads. This one was missed on the first pass
      // because the grep looked for `res.text()` and this call names its variable
      // `response` -- which is why the rule is to fix every caller, not the one the
      // report named.
      const html = await readCapped(response);
      const operatorAlerts = extractAlertsFromHtml(html).map((a) => ({ ...a, source: 'operator' as const }));
      // The city's feed second, and only ever after the operator's: what the company
      // says about its own service outranks a press release that happens to mention a
      // bus. A failure there returns nothing and changes none of this.
      const cityNotices = await fetchConcelloNotices();
      const liveAlerts = [...operatorAlerts, ...cityNotices];

      const result: AlertSyncResult = {
        alerts: liveAlerts,
        lastSyncTime: new Date().toISOString(),
        sourceUrl: 'https://buslugo.com',
        // The state of the network is the operator's to declare. A press release from
        // the Concello about free buses for Arde Lucus is worth reading and is not an
        // incident, and counting it as one would put a warning on a normal day.
        status: operatorAlerts.length > 0 ? 'active_incidents' : 'operational_normal',
        message: operatorAlerts.length > 0
          ? `${operatorAlerts.length} aviso(s) oficial(is) activo(s) detectado(s) en buslugo.com`
          : 'Rede de transporte operando con total normalidade en todas as liñas e paradas.',
      };

      cachedAlerts = result;
      lastFetchTimestamp = now;
      return result;
    }
  } catch {
    // Network or timeout: return operational normal if no cache
  }

  // The fetch failed, timed out, or the page answered with an error. We know nothing
  // about the service — say that, rather than the opposite.
  const fallback: AlertSyncResult = {
    alerts: [],
    lastSyncTime: new Date().toISOString(),
    sourceUrl: 'https://buslugo.com',
    status: 'unreachable',
    message: 'Non se puido ler a páxina do operador, así que non sabemos se hai avisos.',
  };

  cachedAlerts = fallback;
  lastFetchTimestamp = now;
  return fallback;
}
